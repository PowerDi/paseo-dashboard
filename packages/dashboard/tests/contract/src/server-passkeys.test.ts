import { createHash, generateKeyPairSync, randomBytes, sign, type KeyObject } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { encodeCBOR, type CBORType } from "@levischuck/tiny-cbor";
import { buildApp } from "@getpaseo/dashboard-server/app";
import type { ServerConfig } from "@getpaseo/dashboard-server/config";
import type { LoginResponse, Passkey, Session } from "@getpaseo/dashboard-shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const ORIGIN = "http://localhost:5173";
const RP_ID = "localhost";
const EMAIL = "passkey@example.com";
const PASSWORD = "test-password-123";

interface RegistrationOptionsResult {
  ceremonyId: string;
  options: { challenge: string };
}

interface AuthenticationOptionsResult {
  ceremonyId: string;
  options: { challenge: string };
}

function makeTestConfig(): { config: ServerConfig; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), "paseo-passkey-test-"));
  const kekPath = join(dir, ".kek");
  writeFileSync(kekPath, randomBytes(32), { mode: 0o600 });
  const config: ServerConfig = {
    host: "127.0.0.1",
    port: 0,
    dataDir: dir,
    logLevel: "silent",
    corsOrigin: ORIGIN,
    kekFile: kekPath,
    accessTokenTtl: 900,
    refreshTokenTtl: 7 * 24 * 3600,
    refreshTokenBytes: 32,
    argon2MemoryCost: 1024,
    argon2TimeCost: 1,
    argon2Parallelism: 1,
    registrationOpen: true,
    trustedProxies: [],
    rateLimitEnabled: false,
    webauthnOrigin: ORIGIN,
    webauthnRpId: RP_ID,
    webauthnRpName: "Paseo Test",
  };
  return { config, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

function sha256(value: string | Uint8Array): Buffer {
  return createHash("sha256").update(value).digest();
}

function uint32(value: number): Buffer {
  const result = Buffer.alloc(4);
  result.writeUInt32BE(value);
  return result;
}

function uint16(value: number): Buffer {
  const result = Buffer.alloc(2);
  result.writeUInt16BE(value);
  return result;
}

function b64url(value: Uint8Array | string): string {
  return Buffer.from(value).toString("base64url");
}

function credentialKey() {
  const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const jwk = publicKey.export({ format: "jwk" });
  if (!jwk.x || !jwk.y) throw new Error("P-256 coordinates were not exported");
  const cose = encodeCBOR(
    new Map<string | number, CBORType>([
      [1, 2],
      [3, -7],
      [-1, 1],
      [-2, new Uint8Array(Buffer.from(jwk.x, "base64url"))],
      [-3, new Uint8Array(Buffer.from(jwk.y, "base64url"))],
    ]),
  );
  return { privateKey, cose, credentialId: randomBytes(32) };
}

function clientData(type: "webauthn.create" | "webauthn.get", challenge: string, origin: string) {
  return Buffer.from(JSON.stringify({ type, challenge, origin, crossOrigin: false }));
}

function registrationResponse(
  challenge: string,
  key: ReturnType<typeof credentialKey>,
  origin = ORIGIN,
) {
  const authenticatorData = Buffer.concat([
    sha256(RP_ID),
    Buffer.from([0x45]), // user present, user verified, attested credential data
    uint32(0),
    Buffer.alloc(16),
    uint16(key.credentialId.length),
    key.credentialId,
    key.cose,
  ]);
  const attestationObject = encodeCBOR(
    new Map<string | number, CBORType>([
      ["fmt", "none"],
      ["attStmt", new Map()],
      ["authData", new Uint8Array(authenticatorData)],
    ]),
  );

  return {
    id: b64url(key.credentialId),
    rawId: b64url(key.credentialId),
    response: {
      clientDataJSON: b64url(clientData("webauthn.create", challenge, origin)),
      attestationObject: b64url(attestationObject),
      transports: ["internal"],
      publicKeyAlgorithm: -7,
    },
    authenticatorAttachment: "platform",
    clientExtensionResults: {},
    type: "public-key",
  };
}

function authenticationResponse(
  challenge: string,
  userId: string,
  key: { privateKey: KeyObject; credentialId: Uint8Array },
  counter: number,
) {
  const authenticatorData = Buffer.concat([
    sha256(RP_ID),
    Buffer.from([0x05]), // user present and user verified
    uint32(counter),
  ]);
  const encodedClientData = clientData("webauthn.get", challenge, ORIGIN);
  const signature = sign(
    "sha256",
    Buffer.concat([authenticatorData, sha256(encodedClientData)]),
    key.privateKey,
  );

  return {
    id: b64url(key.credentialId),
    rawId: b64url(key.credentialId),
    response: {
      clientDataJSON: b64url(encodedClientData),
      authenticatorData: b64url(authenticatorData),
      signature: b64url(signature),
      userHandle: b64url(userId),
    },
    authenticatorAttachment: "platform",
    clientExtensionResults: {},
    type: "public-key",
  };
}

function cookieRecord(cookie: { name: string; value: string }): Record<string, string> {
  return { [cookie.name]: cookie.value };
}

describe("Passkey authentication", () => {
  let app: ReturnType<typeof buildApp>;
  let cleanup: () => void;
  let userId: string;
  let passwordCookie: { name: string; value: string };
  const key = credentialKey();

  beforeAll(async () => {
    const testConfig = makeTestConfig();
    cleanup = testConfig.cleanup;
    app = buildApp(testConfig.config);
    await app.ready();

    const registration = await app.inject({
      method: "POST",
      url: "/api/v1/auth/register",
      headers: {
        "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) Safari/617.1",
      },
      remoteAddress: "203.0.113.21",
      payload: {
        email: EMAIL,
        password: PASSWORD,
        device: { installationId: "password-device", name: "Mac", platform: "web" },
      },
    });
    expect(registration.statusCode).toBe(200);
    userId = (registration.json() as LoginResponse).user.id;
    passwordCookie = registration.cookies[0];
  });

  afterAll(async () => {
    await app.close();
    cleanup();
  });

  it("requires the current password before registration", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/passkeys/registration/options",
      cookies: cookieRecord(passwordCookie),
      payload: { currentPassword: "wrong-password" },
    });

    expect(response.statusCode).toBe(401);
  });

  it("registers a discoverable passkey and signs in with a real assertion", async () => {
    const beginRegistration = await app.inject({
      method: "POST",
      url: "/api/v1/passkeys/registration/options",
      cookies: cookieRecord(passwordCookie),
      payload: { currentPassword: PASSWORD },
    });
    expect(beginRegistration.statusCode).toBe(200);
    const registrationOptions = beginRegistration.json() as RegistrationOptionsResult;

    const finishRegistration = await app.inject({
      method: "POST",
      url: "/api/v1/passkeys/registration/verify",
      cookies: cookieRecord(passwordCookie),
      payload: {
        ceremonyId: registrationOptions.ceremonyId,
        name: "MacBook Touch ID",
        response: registrationResponse(registrationOptions.options.challenge, key),
      },
    });
    expect(finishRegistration.statusCode).toBe(200);
    expect((finishRegistration.json() as { passkey: Passkey }).passkey).toMatchObject({
      name: "MacBook Touch ID",
      deviceType: "singleDevice",
      backedUp: false,
      lastUsedAt: null,
    });

    const list = await app.inject({
      method: "GET",
      url: "/api/v1/passkeys",
      cookies: cookieRecord(passwordCookie),
    });
    expect(list.statusCode).toBe(200);
    expect(list.json()).toHaveLength(1);

    const beginLogin = await app.inject({
      method: "POST",
      url: "/api/v1/auth/passkey/login/options",
    });
    expect(beginLogin.statusCode).toBe(200);
    const loginOptions = beginLogin.json() as AuthenticationOptionsResult;
    const assertion = authenticationResponse(loginOptions.options.challenge, userId, key, 1);

    const finishLogin = await app.inject({
      method: "POST",
      url: "/api/v1/auth/passkey/login/verify",
      headers: {
        "user-agent": "Mozilla/5.0 (X11; Linux x86_64) Chrome/132.0.0.0 Safari/537.36",
      },
      remoteAddress: "198.51.100.87",
      payload: {
        ceremonyId: loginOptions.ceremonyId,
        response: assertion,
        device: { installationId: "passkey-device", name: "Linux laptop", platform: "web" },
      },
    });
    expect(finishLogin.statusCode).toBe(200);
    expect((finishLogin.json() as LoginResponse).user.id).toBe(userId);
    const passkeyCookie = finishLogin.cookies[0];

    const sessionsResponse = await app.inject({
      method: "GET",
      url: "/api/v1/sessions",
      cookies: cookieRecord(passkeyCookie),
    });
    expect(sessionsResponse.statusCode).toBe(200);
    const sessions = sessionsResponse.json() as (Session & { isCurrentSession: boolean })[];
    expect(sessions.find((session) => session.isCurrentSession)).toMatchObject({
      authMethod: "passkey",
      ipPrefix: "198.51.100.0",
      userAgentSummary: "Chrome 132 · Linux",
    });

    const replay = await app.inject({
      method: "POST",
      url: "/api/v1/auth/passkey/login/verify",
      payload: {
        ceremonyId: loginOptions.ceremonyId,
        response: assertion,
        device: { installationId: "replay", name: "Replay", platform: "web" },
      },
    });
    expect(replay.statusCode).toBe(401);
  });

  it("binds registration to the configured origin and authenticated session", async () => {
    const beginRegistration = await app.inject({
      method: "POST",
      url: "/api/v1/passkeys/registration/options",
      cookies: cookieRecord(passwordCookie),
      payload: { currentPassword: PASSWORD },
    });
    const registrationOptions = beginRegistration.json() as RegistrationOptionsResult;
    const wrongOriginKey = credentialKey();

    const wrongOrigin = await app.inject({
      method: "POST",
      url: "/api/v1/passkeys/registration/verify",
      cookies: cookieRecord(passwordCookie),
      payload: {
        ceremonyId: registrationOptions.ceremonyId,
        response: registrationResponse(
          registrationOptions.options.challenge,
          wrongOriginKey,
          "https://evil.example",
        ),
      },
    });
    expect(wrongOrigin.statusCode).toBe(400);

    const otherRegistration = await app.inject({
      method: "POST",
      url: "/api/v1/auth/register",
      payload: {
        email: "other-passkey@example.com",
        password: PASSWORD,
        device: { installationId: "other-device", name: "Other", platform: "web" },
      },
    });
    const otherCookie = otherRegistration.cookies[0];

    const crossSession = await app.inject({
      method: "POST",
      url: "/api/v1/passkeys/registration/verify",
      cookies: cookieRecord(otherCookie),
      payload: {
        ceremonyId: registrationOptions.ceremonyId,
        response: registrationResponse(registrationOptions.options.challenge, wrongOriginKey),
      },
    });
    expect(crossSession.statusCode).toBe(400);
  });

  it("deletes a passkey without exposing another user's credential", async () => {
    const list = await app.inject({
      method: "GET",
      url: "/api/v1/passkeys",
      cookies: cookieRecord(passwordCookie),
    });
    const [passkey] = list.json() as Passkey[];

    const otherRegistration = await app.inject({
      method: "POST",
      url: "/api/v1/auth/register",
      payload: {
        email: "passkey-delete-other@example.com",
        password: PASSWORD,
        device: { installationId: "delete-other", name: "Other", platform: "web" },
      },
    });
    const otherCookie = otherRegistration.cookies[0];
    const crossUserDelete = await app.inject({
      method: "DELETE",
      url: `/api/v1/passkeys/${passkey.id}`,
      cookies: cookieRecord(otherCookie),
    });
    expect(crossUserDelete.statusCode).toBe(404);

    const deletion = await app.inject({
      method: "DELETE",
      url: `/api/v1/passkeys/${passkey.id}`,
      cookies: cookieRecord(passwordCookie),
    });
    expect(deletion.statusCode).toBe(200);

    const emptyList = await app.inject({
      method: "GET",
      url: "/api/v1/passkeys",
      cookies: cookieRecord(passwordCookie),
    });
    expect(emptyList.json()).toEqual([]);
  });
});
