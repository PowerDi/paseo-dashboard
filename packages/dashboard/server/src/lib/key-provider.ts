import { randomBytes, timingSafeEqual } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import {
  DecryptCommand,
  GenerateDataKeyCommand,
  KMSClient,
  type KMSClientConfig,
} from "@aws-sdk/client-kms";
import type { ServerConfig } from "../config.js";

export type KeyProviderType = "file" | "aws-kms";

export interface KeyMaterial {
  key: Buffer;
  reference: string;
}

export class KeyProviderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "KeyProviderError";
  }
}

export interface AwsKmsTransport {
  generateDataKey(
    keyId: string,
    encryptionContext: Record<string, string>,
  ): Promise<{ plaintext: Uint8Array; ciphertextBlob: Uint8Array }>;
  decrypt(
    ciphertextBlob: Uint8Array,
    encryptionContext: Record<string, string>,
  ): Promise<Uint8Array>;
}

class AwsSdkKmsTransport implements AwsKmsTransport {
  private client: KMSClient;

  constructor(region: string | undefined) {
    const clientConfig: KMSClientConfig = region ? { region } : {};
    this.client = new KMSClient(clientConfig);
  }

  async generateDataKey(
    keyId: string,
    encryptionContext: Record<string, string>,
  ): Promise<{ plaintext: Uint8Array; ciphertextBlob: Uint8Array }> {
    const result = await this.client.send(
      new GenerateDataKeyCommand({
        KeyId: keyId,
        KeySpec: "AES_256",
        EncryptionContext: encryptionContext,
      }),
    );
    if (!result.Plaintext || !result.CiphertextBlob) {
      throw new KeyProviderError("AWS KMS GenerateDataKey 未返回完整 key material");
    }
    return { plaintext: result.Plaintext, ciphertextBlob: result.CiphertextBlob };
  }

  async decrypt(
    ciphertextBlob: Uint8Array,
    encryptionContext: Record<string, string>,
  ): Promise<Uint8Array> {
    const result = await this.client.send(
      new DecryptCommand({
        CiphertextBlob: ciphertextBlob,
        EncryptionContext: encryptionContext,
      }),
    );
    if (!result.Plaintext) {
      throw new KeyProviderError("AWS KMS Decrypt 未返回 plaintext key");
    }
    return result.Plaintext;
  }
}

function validateKey(key: Buffer, description: string): Buffer {
  if (key.length !== 32) {
    throw new KeyProviderError(`${description} 必须为 32 字节（当前 ${key.length} 字节）`);
  }
  return key;
}

function loadKeyFile(path: string): Buffer {
  if (!existsSync(path)) {
    throw new KeyProviderError(`KEK 文件 ${path} 不存在。请创建 32 字节密钥文件`);
  }
  const stat = statSync(path);
  const groupOrOtherMode = stat.mode & 0o077;
  if (groupOrOtherMode !== 0) {
    throw new KeyProviderError(
      `KEK 文件 ${path} 权限过宽（当前 ${stat.mode.toString(8)}）。请设置为 0600：chmod 600 ${path}`,
    );
  }
  return validateKey(readFileSync(path), `KEK 文件 ${path}`);
}

class FileKeyProvider {
  readonly type = "file" as const;

  constructor(
    private dataDir: string,
    private configuredPath: string,
    private allowGeneratedKey: boolean,
  ) {}

  async bootstrap(): Promise<KeyMaterial> {
    if (this.configuredPath) {
      return { key: loadKeyFile(this.configuredPath), reference: this.configuredPath };
    }

    if (!this.allowGeneratedKey) {
      throw new KeyProviderError("生产环境的 file KeyProvider 必须设置 PASEO_BOARD_KEK_FILE");
    }

    mkdirSync(this.dataDir, { recursive: true });
    const path = `${this.dataDir}/.kek`;
    if (!existsSync(path)) {
      writeFileSync(path, randomBytes(32), { mode: 0o600 });
      console.warn("[WARN] 已自动生成开发 KEK，生产环境必须配置 file 或 aws-kms KeyProvider");
    }
    return { key: loadKeyFile(path), reference: path };
  }

  async create(reference?: string): Promise<KeyMaterial> {
    if (!reference) {
      throw new KeyProviderError("file KeyProvider 轮换必须通过 --key-file 指定新 KEK 文件");
    }
    return { key: loadKeyFile(reference), reference };
  }

  async resolve(reference: string): Promise<Buffer> {
    return loadKeyFile(reference);
  }
}

class AwsKmsKeyProvider {
  readonly type = "aws-kms" as const;
  private transport: AwsKmsTransport;

  constructor(
    private keyId: string,
    region: string | undefined,
    transport?: AwsKmsTransport,
  ) {
    this.transport = transport ?? new AwsSdkKmsTransport(region);
  }

  private encryptionContext(version: string): Record<string, string> {
    return {
      paseoDashboardPurpose: "host-connection-kek",
      paseoDashboardKeyVersion: version,
    };
  }

  async create(version: string): Promise<KeyMaterial> {
    if (!this.keyId) {
      throw new KeyProviderError("aws-kms KeyProvider 必须设置 PASEO_BOARD_AWS_KMS_KEY_ID");
    }
    const result = await this.transport.generateDataKey(
      this.keyId,
      this.encryptionContext(version),
    );
    return {
      key: validateKey(Buffer.from(result.plaintext), "AWS KMS data key"),
      reference: Buffer.from(result.ciphertextBlob).toString("base64"),
    };
  }

  async resolve(reference: string, version: string): Promise<Buffer> {
    const plaintext = await this.transport.decrypt(
      Buffer.from(reference, "base64"),
      this.encryptionContext(version),
    );
    return validateKey(Buffer.from(plaintext), "AWS KMS data key");
  }
}

export interface KeyProviderSetOptions {
  activeProvider: KeyProviderType;
  dataDir: string;
  kekFile: string;
  awsKmsKeyId?: string;
  awsKmsRegion?: string;
  awsKmsTransport?: AwsKmsTransport;
  allowGeneratedFileKey?: boolean;
}

export class KeyProviderSet {
  private file: FileKeyProvider;
  private aws: AwsKmsKeyProvider;

  constructor(private options: KeyProviderSetOptions) {
    this.file = new FileKeyProvider(
      options.dataDir,
      options.kekFile,
      options.allowGeneratedFileKey ?? false,
    );
    this.aws = new AwsKmsKeyProvider(
      options.awsKmsKeyId ?? "",
      options.awsKmsRegion,
      options.awsKmsTransport,
    );
  }

  get activeProvider(): KeyProviderType {
    return this.options.activeProvider;
  }

  async bootstrap(version: string): Promise<KeyMaterial> {
    if (this.activeProvider === "aws-kms") return this.aws.create(version);
    return this.file.bootstrap();
  }

  async create(version: string, reference?: string): Promise<KeyMaterial> {
    if (this.activeProvider === "aws-kms") return this.aws.create(version);
    return this.file.create(reference);
  }

  async resolve(provider: KeyProviderType, reference: string, version: string): Promise<Buffer> {
    if (provider === "aws-kms") return this.aws.resolve(reference, version);
    return this.file.resolve(reference);
  }
}

export function createKeyProviderSet(config: ServerConfig): KeyProviderSet {
  return new KeyProviderSet({
    activeProvider: config.keyProvider ?? "file",
    dataDir: config.dataDir,
    kekFile: config.kekFile,
    awsKmsKeyId: config.awsKmsKeyId,
    awsKmsRegion: config.awsKmsRegion,
    allowGeneratedFileKey: process.env.NODE_ENV !== "production",
  });
}

export function assertDifferentKeys(current: Buffer, next: Buffer): void {
  if (current.length === next.length && timingSafeEqual(current, next)) {
    throw new KeyProviderError("新 KEK 必须与当前 active key 不同");
  }
}
