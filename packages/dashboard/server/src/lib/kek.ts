import { readFileSync, existsSync, mkdirSync, writeFileSync, statSync } from "node:fs";
import { randomBytes } from "node:crypto";

export function loadKek(kekFile: string): Buffer {
  if (kekFile && existsSync(kekFile)) {
    const stat = statSync(kekFile);
    // Reject group/other readable/writable keys
    const mode = stat.mode & 0o077;
    if (mode !== 0) {
      throw new Error(
        `KEK 文件 ${kekFile} 权限过宽（当前 ${stat.mode.toString(8)}）。请设置为 0600：chmod 600 ${kekFile}`,
      );
    }
    const raw = readFileSync(kekFile);
    if (raw.length !== 32) {
      throw new Error(`KEK 文件 ${kekFile} 必须为 32 字节（当前 ${raw.length} 字节）`);
    }
    return raw;
  }

  // Dev mode: generate on first run if no path specified
  if (!kekFile) {
    const dir = process.env.PASEO_BOARD_DATA_DIR || "./data";
    const devPath = `${dir}/.kek`;
    mkdirSync(dir, { recursive: true });
    if (!existsSync(devPath)) {
      const key = randomBytes(32);
      writeFileSync(devPath, key, { mode: 0o600 });
      console.warn("[WARN] 已自动生成开发 KEK，生产环境必须通过 PASEO_BOARD_KEK_FILE 指定外部密钥");
      return key;
    }
    // Dev KEK already exists — load it (permissions don't matter in dev mode)
    return readFileSync(devPath);
  }

  throw new Error(`KEK 文件 ${kekFile} 不存在。请创建 32 字节密钥文件`);
}
