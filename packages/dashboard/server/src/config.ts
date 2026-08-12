export interface ServerConfig {
  host: string;
  port: number;
  dataDir: string;
  logLevel: string;
  corsOrigin: string;
  kekFile: string;
  accessTokenTtl: number; // access token 有效期（秒）
  refreshTokenTtl: number; // refresh token 有效期（秒）
  refreshTokenBytes: number;
  argon2MemoryCost: number; // KiB
  argon2TimeCost: number; // iterations
  argon2Parallelism: number; // threads
  registrationOpen: boolean; // 首用户注册后自动关闭
  trustedProxies: string[];
}

export function loadConfig(): ServerConfig {
  return {
    host: process.env.PASEO_BOARD_HOST || "127.0.0.1",
    port: parseInt(process.env.PASEO_BOARD_PORT || "3000", 10),
    dataDir: process.env.PASEO_BOARD_DATA_DIR || "./data",
    logLevel: process.env.PASEO_BOARD_LOG_LEVEL || "info",
    corsOrigin: process.env.PASEO_BOARD_CORS_ORIGIN || "http://localhost:5173",
    kekFile: process.env.PASEO_BOARD_KEK_FILE || "",
    accessTokenTtl: 900, // 15 min
    refreshTokenTtl: 7 * 24 * 3600, // 7 days
    refreshTokenBytes: 32,
    argon2MemoryCost: 65536, // 64 MiB
    argon2TimeCost: 3,
    argon2Parallelism: 4,
    registrationOpen: process.env.PASEO_BOARD_REGISTRATION_OPEN !== "false",
    trustedProxies: (process.env.PASEO_BOARD_TRUSTED_PROXIES || "").split(",").filter(Boolean),
  };
}
