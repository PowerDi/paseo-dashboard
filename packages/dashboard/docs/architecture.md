# 架构

## 状态标记

- **源码事实**：已从 `/root/workspace/code/paseo` 验证。
- **已定决策**：本项目必须遵守。
- **设计建议**：MVP 推荐实现，可在记录理由后调整。
- **开放问题**：见 `open-decisions.md`。

## 系统边界

**已定决策：** Dashboard 是 control/configuration plane。agent data plane 保持为客户端 ↔ Relay ↔ daemon。

```text
┌──────────────────────┐       HTTPS        ┌────────────────────────┐
│ Browser / Harmony    │ ─────────────────▶ │ Dashboard API          │
│                      │ ◀───────────────── │ Auth + Host Sync       │
│ Paseo client runtime │                    └────────────────────────┘
│          │           │
└──────────┼───────────┘
           │ Existing Paseo E2EE WebSocket
           ▼
   ┌──────────────┐          outbound          ┌──────────────┐
   │ Paseo Relay  │ ◀──────────────────────── │ Paseo daemon │
   │ untrusted    │                           │ agents/data  │
   └──────────────┘                           └──────────────┘
```

Dashboard 后端不得创建到 Relay 或 daemon 的业务连接。首次连接验证由用户客户端执行。

## 应用划分

项目明确包含三个独立应用：

1. **Web**：浏览器版本，负责页面、Dashboard 登录、Host 同步，以及直接连接 Relay/daemon。
2. **Harmony**：HarmonyOS 版本，使用相同 Dashboard API，独立处理平台网络、安全存储和页面。
3. **Server**：Dashboard 服务端，只负责用户、session、设备、Host 存储、同步和审计。

Web 与 Harmony 都直接连接 Relay/daemon。Server 永远不连接 Relay/daemon。

## 开发目录

```text
paseo-board/
├── AGENTS.md
├── web/                  # 浏览器应用
├── harmony/              # HarmonyOS 应用
├── server/               # Dashboard API 服务
├── packages/
│   └── contracts/        # 三个应用共用的 Dashboard API 格式
├── tests/
│   ├── contract/         # Web、Harmony、Server 的 API 一致性测试
│   └── e2e/              # 登录、Host 同步和 Relay 连接流程测试
└── docs/                 # 当前设计事实来源
```

当前只建立目录，不初始化具体框架。

## 技术栈 (P0.1 决定)

**已定决策：** 以下决策在 P0.1 阶段确定，记录于 `docs/open-decisions.md`。

| 层                 | 选择                                  | 理由                                                                                                  |
| ------------------ | ------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| 运行时             | Node.js v22                           | 环境唯一可用运行时                                                                                    |
| 语言               | TypeScript                            | 与 web/contracts 共享类型，Paseo 官方包（`@getpaseo/client`/`protocol`）均为 TypeScript               |
| 后端框架           | Fastify                               | 内置 pino 结构化日志 redaction；`@fastify/cookie`/`csrf-protection`/`rate-limit` 成熟插件覆盖安全需求 |
| 数据库             | SQLite + Drizzle ORM                  | M1 单用户自托管零运维；Drizzle 同一 schema API 可迁移至 PostgreSQL                                    |
| Web 框架           | React + Vite + React Router + Zustand | 独立实现，不引入 Paseo App 的 Expo Router / React Native store                                        |
| 测试               | vitest                                | 与 Paseo 官方包一致                                                                                   |
| 包管理             | npm workspaces                        | 与 Paseo 一致，原生支持 monorepo                                                                      |
| Session（Web）     | opaque HttpOnly Cookie                | 前端不可读，防 XSS                                                                                    |
| Session（Harmony） | bearer + rotating refresh token       | 平台安全存储                                                                                          |

这些选择是 M1 阶段默认，后续可调整；更改时需更新本条记录和相关文档。

## 目录职责

### `web`

- 自己实现 Web 页面、路由、状态管理和设计系统。
- 调用 Dashboard API 完成登录、Host 同步和设备管理。
- 使用 `@getpaseo/client` 与 `@getpaseo/protocol` 直接连接 daemon。
- 页面不直接创建多个 `DaemonClient`；应用内部统一管理 Host 连接。
- 不导入 Paseo App 页面、store、Expo Router 或 React Native 代码。

### `harmony`

- 自己实现 Harmony 页面、导航、网络和安全存储。
- 使用与 Web 相同的 Dashboard API 和 Host sync 格式。
- 是否能直接使用 `@getpaseo/client` 必须通过 Harmony 真机或模拟器验证。
- 如果运行环境不兼容，只实现平台适配，不修改 Paseo Relay 的加密格式。
- 不为了与 Web 共享代码而引入不适合 Harmony 的浏览器依赖。

### `server`

- 提供注册、登录、session、设备、Host、同步、审计和账户管理 API。
- 加密保存 pairing capability 和 HostConnection。
- 不导入 `@getpaseo/client`，不建立 daemon WebSocket，不代理 agent 数据。
- 不承担 Host 在线检测；在线状态由 Web/Harmony 直接连接后得出。

### `packages/contracts`

- 只保存 Dashboard API 的请求、响应、错误 code 和 Host sync 格式。
- Web、Harmony、Server 必须使用同一份格式定义或由它生成的目标语言类型。
- 不包含页面、数据库、Cookie、平台安全存储或 daemon 连接代码。
- 除非出现第二个真实使用场景，不新增其他共享 package。

### `tests/contract`

- 验证 Web、Harmony 和 Server 对 Dashboard API 的理解一致。
- 固定注册、登录、refresh、Host sync、冲突和错误响应样例。

### `tests/e2e`

- 验证浏览器 A 配置后浏览器 B 能同步并连接 daemon。
- 后续加入 Harmony 与 Web 使用同一账号和 Host 配置的流程。
- 验证 Dashboard Server 不接收 timeline、terminal、prompt 或 daemon RPC。

## 依赖方向

```text
web      ──▶ packages/contracts
harmony  ──▶ packages/contracts
server   ──▶ packages/contracts

web      ──▶ Paseo client/protocol
harmony  ──▶ Paseo client/protocol 或 Harmony 平台适配
server   ──X Paseo client/Relay/daemon
```

不要创建一个同时包含 Web、Harmony、Server 和 daemon 连接的通用大包。只有 Dashboard API 格式是当前确定需要共享的内容。

## 数据模型

字段类型为逻辑模型，不指定 ORM。

### User

| 字段                            | 说明                             |
| ------------------------------- | -------------------------------- | ------ | --------------- |
| `id`                            | UUID/ULID 主键                   |
| `emailNormalized`               | 唯一、明文可查询；显示邮箱可另存 |
| `passwordHash`                  | Argon2id 输出，敏感但不可逆      |
| `status`                        | `active                          | locked | pending_delete` |
| `syncRevision`                  | 账号 Host 同步单调整数           |
| `createdAt/updatedAt/deletedAt` | 生命周期                         |

第一阶段 Host 归属用户。未来共享不改变 Host 身份，而通过 `HostGrant` 扩展。

### Device

| 字段                               | 说明                                                  |
| ---------------------------------- | ----------------------------------------------------- |
| `id`                               | 主键                                                  |
| `userId`                           | 所有者 FK                                             |
| `installationIdHash`               | 客户端随机 installation id 的 HMAC；不使用硬件唯一 ID |
| `displayName/platform`             | 明文元数据                                            |
| `devicePublicKey`                  | 可选，未来绑定 refresh token/签名                     |
| `firstSeenAt/lastSeenAt/revokedAt` | 生命周期                                              |

唯一约束建议为 `(userId, installationIdHash)`。

### Session

| 字段                             | 说明                                |
| -------------------------------- | ----------------------------------- |
| `id`                             | 主键                                |
| `userId/deviceId`                | 所有者                              |
| `refreshTokenHash`               | 只存哈希，refresh token 单次轮换    |
| `familyId/rotationCounter`       | 重用检测与 token family 撤销        |
| `expiresAt/lastUsedAt/revokedAt` | 生命周期                            |
| `ipPrefix/userAgentSummary`      | 限量审计元数据，不存完整敏感 header |

### Host

| 字段                            | 说明                                         |
| ------------------------------- | -------------------------------------------- |
| `id`                            | Dashboard 稳定主键                           |
| `ownerUserId`                   | 创建者/所有者                                |
| `label/appearance`              | 明文可查询的 UI 元数据                       |
| `capabilityFingerprint`         | 服务端 HMAC 盲索引，用于同账号去重；不可还原 |
| `version`                       | 乐观并发整数                                 |
| `createdAt/updatedAt/deletedAt` | 删除使用 tombstone                           |

不要把 `serverId` 当 Dashboard 主键；它是 Paseo daemon 身份的一部分，也属于敏感 capability 上下文。

### HostConnection

| 字段                            | 说明                                  |
| ------------------------------- | ------------------------------------- |
| `id`                            | 主键                                  |
| `hostId`                        | Host FK                               |
| `kind`                          | `relay`；MVP 只同步可跨设备使用的连接 |
| `encryptedPayload`              | 完整规范化 connection 的 AEAD 密文    |
| `encryptedDek`                  | 被 KEK 包装的行级/Host 级 DEK         |
| `keyVersion`                    | `EncryptionKeyVersion` FK             |
| `nonce/authTag`                 | 加密元数据                            |
| `createdAt/updatedAt/deletedAt` | 生命周期                              |

密文应覆盖 `serverId`、`relayEndpoint`、`useTls`、`daemonPublicKeyB64`。如果必须去重，使用独立 HMAC fingerprint，不拆出可被日志或查询工具无意暴露的 capability 字段。

### HostGrant

| 字段                            | 说明                           |
| ------------------------------- | ------------------------------ | ---------------- |
| `id`                            | 主键                           |
| `hostId/granteeUserId`          | 唯一关系                       |
| `role`                          | MVP 仅 `owner`；预留 `operator | viewer` 但不启用 |
| `createdBy/createdAt/revokedAt` | 授权生命周期                   |

`HostGrant` 为未来多人共享保留结构。当前 daemon 协议没有只读或按操作授权，因此 `viewer` 不能在协议能力存在前启用。

### PairingCapability

用于导入过程，不长期保存原始 URL。

| 字段                   | 说明                                     |
| ---------------------- | ---------------------------------------- | -------- | -------- | -------- |
| `id/userId/deviceId`   | 导入主体                                 |
| `offerFingerprint`     | HMAC 去重/审计关联                       |
| `encryptedOffer`       | 仅在需要两阶段提交时短暂保存；默认不保存 |
| `status`               | `validated                               | consumed | rejected | expired` |
| `expiresAt/consumedAt` | 短生命周期                               |

推荐单请求完成验证后的持久化，直接生成 `HostConnection`，避免新增原始 offer 暂存表；模型仅为未来异步审批保留。

### AuditEvent

| 字段                           | 说明                                                 |
| ------------------------------ | ---------------------------------------------------- |
| `id/userId/deviceId/sessionId` | 主体                                                 |
| `type`                         | 如 `host.imported`、`host.deleted`、`device.revoked` |
| `targetType/targetId`          | Dashboard 内部标识                                   |
| `metadata`                     | allowlist 后的非秘密 JSON                            |
| `createdAt`                    | 不可变时间                                           |

禁止记录 offer、public-key capability、token、完整 endpoint、完整 `HostConnection` 或密文解密结果。

### EncryptionKeyVersion

| 字段                  | 说明                                  |
| --------------------- | ------------------------------------- | ------------ | -------- |
| `id/version`          | 主键和单调版本                        |
| `kmsKeyRef`           | secret manager/KMS 引用，不是原始 KEK |
| `status`              | `active                               | decrypt_only | retired` |
| `createdAt/retiredAt` | 轮换生命周期                          |

轮换采用新写入用 active key、后台重包 `encryptedDek`、旧 key 保持 decrypt-only，完成后再 retired。

## 删除语义

- Host 删除创建同步 tombstone，而不是立即丢失所有记录。
- tombstone 至少保留到所有活跃设备确认的 revision 超过删除 revision，另设最长保留期。
- 账户删除先撤销 session，再异步清除 capability 密文；法务/安全审计只保留去秘密的事件。
- 删除 Dashboard 数据不能撤销已经复制到离线设备的 daemon capability。

## API

基础路径：`/api/v1`。所有敏感响应使用 `Cache-Control: no-store`。错误格式统一：

```json
{
  "error": {
    "code": "host_version_conflict",
    "message": "Host 已在其他设备更新",
    "requestId": "req_...",
    "details": { "currentVersion": 4 }
  }
}
```

### 认证

```http
POST /api/v1/auth/register
POST /api/v1/auth/login
POST /api/v1/auth/refresh
POST /api/v1/auth/logout
POST /api/v1/auth/forgot-password   # 暂不提供（无邮件基础设施时存在攻击面）
POST /api/v1/auth/reset-password     # 暂不提供（同上）
POST /api/v1/auth/change-password
GET  /api/v1/me
DELETE /api/v1/me
```

```json
// login request
{ "email": "user@example.com", "password": "...", "device": { "installationId": "dev_...", "name": "Chrome on Laptop", "platform": "web" } }

// login response body; Web 的 refresh credential 使用 HttpOnly Cookie
{ "user": { "id": "usr_...", "email": "user@example.com" }, "deviceId": "dev_...", "accessToken": "opaque-or-jwt", "expiresIn": 900 }
```

Web 可选择完全 Cookie session；Harmony 使用 bearer access token 和一次性 refresh token。两种 transport profile 调用同一 endpoint、返回同一业务对象。不得把 refresh token 放 URL。

### 设备和 session

```http
GET    /api/v1/devices
DELETE /api/v1/devices/{deviceId}
GET    /api/v1/sessions
DELETE /api/v1/sessions/{sessionId}
```

### Host

```http
GET    /api/v1/hosts
POST   /api/v1/hosts/import
PATCH  /api/v1/hosts/{hostId}
DELETE /api/v1/hosts/{hostId}
```

```json
// import request：客户端已完成 Relay/E2EE 验证
{
  "label": "Home Server",
  "connection": {
    "type": "relay",
    "serverId": "srv_...",
    "relayEndpoint": "relay.paseo.sh:443",
    "useTls": true,
    "daemonPublicKeyB64": "..."
  },
  "clientVerification": { "verifiedAt": "2026-08-11T10:00:00Z", "serverVersion": "0.3.0" },
  "idempotencyKey": "..."
}

// response
{ "host": { "id": "hst_...", "label": "Home Server", "version": 1, "connection": { "type": "relay", "serverId": "srv_...", "relayEndpoint": "relay.paseo.sh:443", "useTls": true, "daemonPublicKeyB64": "..." } }, "syncRevision": 12 }
```

`clientVerification` 仅是 UX 证据，不是服务端信任边界。Dashboard 仍校验结构，但不连接 daemon。

更新请求包含 `baseVersion`，冲突返回 `409 host_version_conflict`。删除必须幂等。

### 增量同步

```http
GET /api/v1/host-sync?after=12&limit=100
```

```json
{
  "fromRevision": 12,
  "toRevision": 15,
  "changes": [
    {
      "revision": 13,
      "operation": "upsert",
      "host": { "id": "hst_...", "version": 2, "label": "Build Box", "connection": {} }
    },
    {
      "revision": 15,
      "operation": "delete",
      "hostId": "hst_old",
      "deletedAt": "2026-08-11T10:20:00Z"
    }
  ],
  "hasMore": false
}
```

账号内每个 Host mutation 在同一事务中递增 `User.syncRevision` 并写变更。客户端持久化最后应用 revision；重复应用必须幂等。MVP 可先全量 `GET /hosts`，但 API 语义从一开始保留 revision。

### 审计

```http
GET /api/v1/audit-events?cursor=...&limit=50
```

只返回去秘密事件，例如设备名称、动作、时间和 Dashboard 内部 Host label/id。

## 明确不提供的 API

- 不提供 `/agents`、`/timeline`、`/terminal`、`/permissions` 或 daemon RPC passthrough。
- 不提供服务端 Host 在线探测。
- 不提供 Relay WebSocket endpoint 的代理 URL。
- 不接收 Paseo binary frame。

## 客户端 bootstrap

1. 登录 Dashboard。
2. 同步 Host registry。
3. Dashboard Web 把 Host registry 交给自己的连接管理代码。
4. 连接管理代码调用 `@getpaseo/client`：relay URL + `e2ee.enabled` + `daemonPublicKeyB64`。
5. daemon `server_info.features.*` 进入 Paseo 的 capability gate，Dashboard 不解释 daemon 协议。
