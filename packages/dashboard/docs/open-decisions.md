# 开放决策

## 需要在 M0 前决定

### 后端语言与框架

**推荐默认：** 选择团队最熟悉、支持结构化日志 redaction、成熟 session/CSRF 和 AEAD/KMS 的框架。当前阶段不初始化。

**需要证据：** 部署目标、维护者技术栈和前端共享 TypeScript schema 的价值。

**已决定（2026-08-12）：** Node.js + TypeScript + Fastify。原因：pino 结构化日志原生支持日志 redaction 需求；`@fastify/cookie`/`csrf-protection`/`rate-limit` 等成熟插件覆盖安全需求；与 web/contracts 共享 TypeScript 类型，避免跨语言维护成本。环境仅有 Node v22 可用，TypeScript 为唯一可行选择。

### 数据库

**选项：** SQLite 适合单机 M1；PostgreSQL 更适合多用户、并发 revision 和在线 key rotation。

**推荐默认：** 如果 M2/M4 是确定路线，直接 PostgreSQL；如果首要目标是单二进制/极简自托管，先 SQLite，但 schema 和事务语义必须可迁移。

**已决定（2026-08-12）：** SQLite + Drizzle ORM。原因：M1 首要目标是单用户自托管，SQLite 提供零运维单二进制部署。使用 Drizzle ORM 抽象层，schema 与查询保持 PostgreSQL 兼容，M2 阶段可迁移。Drizzle 同一 schema API 同时支持 SQLite 和 PostgreSQL，迁移成本低。

### Web session 形态

**推荐默认：** Web 使用 opaque HttpOnly Cookie session；Harmony 使用 bearer access + rotating refresh token。共享 endpoint 与业务 schema，不强求相同 credential transport。

**已决定（2026-08-12）：** 如推荐默认。Web 使用 opaque HttpOnly Cookie session；Harmony 使用 bearer access + rotating refresh token。共享 endpoint 与业务 schema，不强求相同 credential transport。已记录于 `architecture.md` 和 `security.md`。

### KEK 来源

**推荐默认：** 生产使用 KMS/secret manager；本地自托管允许挂载独立 32-byte key file。启动时拒绝缺失或权限过宽的 key，不自动生成后写入数据库卷。

**已决定（2026-08-12）：** 实现 KeyProvider 接口。生产使用 KMS/secret manager；本地自托管允许挂载独立 32-byte key file。启动时拒绝缺失或权限过宽的 key，不自动生成后写入数据库卷。M1 先实现本地 key file 模式。

### 注册策略

**推荐默认：** M1 首个用户注册后关闭注册。M4 再增加邀请或开放注册。

**已决定（2026-08-16）：** 首个有效用户为 admin。`registrationOpen` 控制首用户之后的公开注册；关闭时仅允许 admin 签发的 email-bound、限时、单次邀请。邀请 token 只存哈希并在创建响应中返回一次。邮箱所有权与恢复边界见 `security.md`。

## 需要在 M0 验证

### 官方 client 是否覆盖所需功能

**已决定（2026-08-12）：** `@getpaseo/client` 的 `DaemonClient` 覆盖 M3 所需全部 daemon 操作（连接/重连、server_info、projects、workspaces、agents、timeline、terminal、prompt、权限、providers、git、文件、chat、schedules、loops 等，~130+ 公开方法）。无底层 client 缺口。

SDK 层 `createPaseoClient()` 只包装 workspaces/agents/providers/config 四个域，缺少 terminal、git、文件、权限等 M3 必需功能。Dashboard 直接使用 `DaemonClient` 类（已公开导出），通过 Connection Manager 管理多 Host 生命周期，不经过 SDK 层。

管理层缺口（由 Dashboard Connection Manager 补齐）：多 Host 生命周期、登出清理、session 失效断连、页面统一获取 client。详见 `docs/m0-exit-report.md`。

### 前端框架和页面状态

Dashboard 不使用 Paseo App 的 Expo Router、React Native store 或页面结构。M0 前需要选择独立 Web 框架，并确认：

- 路由和登录恢复方式；
- agent 实时事件如何进入页面状态；
- timeline 和 terminal 大数据量如何处理；
- 多 Host 连接由哪个全局模块管理；
- 页面大改时如何保持 daemon 操作测试不变。

推荐默认：页面只依赖 Dashboard 自己的 connection manager，不直接依赖 Paseo App store。

### 浏览器扫码

当前 Paseo Web 明确不支持 `pair-scan`。决定使用本地摄像头/二维码库前，验证 HTTPS、权限、移动浏览器兼容和不上传图像。

### Harmony runtime

不能把第三方文档或推测当作已验证事实。用真机/模拟器验证 WebSocket binary frame、CSPRNG、TextEncoder、tweetnacl、关闭码和 npm package 打包。

## 安全开放问题

### MVP 是否允许 Dashboard 读取 capability

**已建议：允许。** 使用 envelope encryption，并明确服务器完全攻陷可读取。若产品要求运营方不可读，必须把零知识 vault 提前为独立架构，不可仅增加一层数据库加密后宣称零知识。

### 本地客户端缓存保留多久

Paseo 需要离线连接能力，但缓存 capability 增加撤销延迟。决定 Web 是否只保存在 IndexedDB、是否需要用户显式“记住此设备”、登出是否清除、后台 session 过期是否锁 vault。

### 删除 tombstone 保留期

需要结合最大离线周期。推荐按“所有活跃设备确认 + 固定最长保留期”清理；长期离线设备回来时可强制全量 resync。

### capability 泄露的产品化恢复

当前只能全局 key/identity rotation。需要向 Paseo 设计正式命令，明确是否保留 `serverId`、如何通知 Relay、如何断开现有连接和如何生成新 offer。

### Host 分享

在 daemon 没有 scoped/per-client credential 前，分享等于授予完整 operator capability。MVP 不启用。未来 `HostGrant.role` 不能超出 daemon 实际能力。

### 审计保留和隐私

决定 IP 保存粒度、保留期、用户导出/删除语义和部署管理员可见范围。默认保存截断 IP 或哈希，而非无限期完整 IP。

## 下一阶段最小技术验证

### 目标

验证“配置一次，第二浏览器直接使用现有 Paseo E2EE transport 连接 daemon”，而不是验证完整 UI。

### 步骤

1. 启动隔离的测试 daemon 和 Relay；禁止使用或重启主 daemon `6767`。
2. 浏览器 A 本地解析测试 offer，直接经 Relay/E2EE 获取 `server_info`。
3. 浏览器 A 将规范化 capability 提交最小 Dashboard API；数据库只保存 envelope-encrypted payload。
4. 浏览器 B 登录同一账号并调用 Host sync。
5. 浏览器 B 使用返回配置构造公开 `DaemonClient`，直接连 Relay，验证 `serverId` 和 `server_info`。
6. 断开 Dashboard，确认已拿到配置的浏览器 B 与 daemon 连接不经过 Dashboard。
7. 断开 daemon、断开 Relay、撤销 Dashboard session、删除 Host，分别验证错误和同步语义。
8. 检查 Dashboard、反向代理、APM、浏览器 telemetry 和数据库 dump，不得出现 offer/token/完整 connection 或 daemon payload。

### 成功判据

- 第二浏览器无需重新 pairing 即完成 E2EE handshake。
- Dashboard 服务端没有到 Relay/daemon 的 socket，也没有 agent 数据请求或 frame。
- 独立 Web build 能使用官方 client/protocol 完成连接，不需要 Paseo App 源码。
- revoked session 不能再 sync；Host tombstone 能传播。
- daemon 或 Relay 离线不影响 Dashboard 登录。

### 失败判据

- 需要 Dashboard 代理 WebSocket 才能工作。
- 需要复制/修改 Relay crypto。
- capability 出现在普通日志或明文数据库列。
- 必须引入或 fork Paseo App 才能完成基本 daemon 连接。
- 对旧 daemon 的支持依赖未标记的 fallback，而不是现有 protocol compatibility/feature gate。
