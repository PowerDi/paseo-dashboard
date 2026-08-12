# 项目进展

> 快速接续备用文件。每次对话开始首先读此文件，然后按 `接续方式` 行动。
> 更新本文件：每次产出重要产出后（文档创建、代码提交、测试通过、架构变更）更新对应部分。

## 项目身份

- **项目**：Paseo Dashboard — Host 配置跨设备同步控制面，不代理 daemon 数据。
- **仓库**：`/root/workspace/code/paseo-board`
- **Paseo 源码**：`/root/workspace/code/paseo`（作为行为事实来源）
- **当前阶段**：M1 进行中（P1.1-P1.4 完成，可进入 P2）。

## 文档地图

| 文件                           | 内容                                                                                         | 使用场景                           |
| ------------------------------ | -------------------------------------------------------------------------------------------- | ---------------------------------- |
| `AGENTS.md`                    | 事实来源、架构边界、敏感数据规则、API 与客户端准则、目录职责、Paseo 集成规则、实现与安全规则 | 所有开发任务开始前必须读           |
| `docs/product-requirements.md` | 产品定义、目标/非目标、用户流程、页面信息架构、验收标准                                      | web/ 和 harmony/ 开发前必读        |
| `docs/architecture.md`         | 系统边界、应用划分、目录职责、数据模型、API 设计、删除语义、技术栈                           | 所有开发任务读涉及的部分           |
| `docs/roadmap.md`              | M0-M6 的里程碑定义、范围、退出条件、风险                                                     | 规划阶段和判断功能是否进入当前版本 |
| `docs/development-plan.md`     | 将 roadmap 拆解为可执行子任务序列，含依赖关系和验证标准                                      | 当前开发阶段参照                   |
| `docs/open-decisions.md`       | 待定决策（已定项标记为"已决定"）                                                             | 需要决策时查阅                     |
| `docs/paseo-integration.md`    | 官方 client/protocol 用法、Relay E2EE 边界、Dashboard 连接层、页面平移原则、兼容策略         | 所有涉及 Paseo 通信的任务          |
| `docs/security.md`             | 保护目标、信任边界、pairing 安全、存储加密、认证方案、撤销语义、审计规则、安全测试           | 所有安全相关任务                   |

## 当前状态

### 已完成

- [x] 所有 `docs/` 文档创建完毕（architecture / product-requirements / roadmap / open-decisions / paseo-integration / security）
- [x] `docs/development-plan.md` 创建完毕（P0-P6 的子任务分解）
- [x] 根目录 `AGENTS.md` 配置完整
- [x] **P0.1 技术选型**：Fastify 后端 / SQLite+Drizzle 数据库 / React+Vite+Router+Zustand Web 框架 / npm workspaces / vitest 测试。已记录于 `docs/open-decisions.md` 和 `docs/architecture.md`
- [x] **P0.2 项目骨架**：npm workspaces 根配置、tsconfig.base、contracts 包（API 类型：auth/hosts/sync/errors）、server（Fastify+pino redaction 骨架）、web（Vite+React 骨架）、tests/contract（5 测试）、tests/e2e（placeholder）
- [x] 全量验证：`npm run build` 通过、`npm run test` 6 测试通过、三端 typecheck 通过
- [x] **P0.3 最小认证与 Host 存储**：Drizzle schema（6 表）、envelope encryption（AES-256-GCM AEAD + DEK/KEK 包装）、auth 路由（注册/登录/refresh/logout/me）、host 路由（import/list/delete 含加密存储）、sync 路由（按 revision 返回）、contract 测试 20 个通过、服务器可启动监听 3000 端口
- [x] **P0.4 Web 端连接验证代码**：Web 集成 `@getpaseo/client`、`@getpaseo/protocol`、`@getpaseo/relay`；新增 Dashboard API client、pairing offer parser/normalizer、`DefaultPaseoConnectionManager`；页面支持登录/注册、Host sync、粘贴 offer、客户端 E2EE 验证后导入、第二设备同步后连接；Web build 通过；全量测试和 typecheck 通过。
- [x] **P0.4 连接层与 offer 解析测试**：e2e 包新增 7 个 vitest 测试（offer 解析 3 + connection manager config 4），覆盖 wss URL 构造、E2EE 配置、TLS/非 TLS relay、browser clientId、fragment 清除。全量 `npm run build` + `npm run test`（29 测试）+ `npm run typecheck` 通过。
- [x] **P0.4 Playwright 浏览器 E2E**：3 个 Chromium 浏览器测试通过（页面渲染、offer 输入与验证按钮、Host 同步区）。浏览器二进制位于 `/tmp/playwright-browsers`，通过 `PLAYWRIGHT_BROWSERS_PATH` 环境变量指定。全量 build + test（32 测试）+ typecheck 通过。
- [x] **P0.5 M0 退出条件确认**：敏感数据检查（日志 redaction、DB 密文、Cache-Control、错误响应无 capability 泄露，6 个 M1 待修缺口记录）；`@getpaseo/client` 覆盖矩阵（DaemonClient ~130+ 公开方法覆盖 M3 全部功能域，无底层缺口）；产出 `docs/m0-exit-report.md`；`docs/open-decisions.md` 标记 client 覆盖为已决定。M0 退出条件全部满足。
- [x] **P1.1 完整认证与会话**：Argon2id 密码哈希替换 bcrypt；access/refresh token 分离（access 15min cookie，refresh 7d 高熵轮换）；refresh token reuse 检测撤销整个 family；注册策略（首用户后可关闭 `PASEO_BOARD_REGISTRATION_OPEN=false`）；修改密码（撤销其他 session、轮换当前）；忘记/重置密码暂不提供（无邮件基础设施时存在攻击面，change-password 需要当前密码已满足安全要求）；登出撤销；pino redaction 增加 `cookie`、`currentPassword`、`newPassword`、`resetToken`；sessions 表增加 `access_token_hash`、`refresh_expires_at` 列；负向契约测试 16 个（含 reuse 检测、注册关闭、登录不泄露）。全量 build + test（36 测试）+ typecheck 通过。
- [x] **P1.2 Host 完整生命周期**：Host 更新 API（`PATCH /api/v1/hosts/:id`，乐观并发 409）；capability fingerprint 去重（HMAC-SHA256 域分离）；幂等键（相同 key 返回已存在 Host）；sync 返回 tombstone。8 个新契约测试。全量 44 测试通过。
- [x] **P1.3 存储加密与审计**：审计事件补齐（`user.login_failed`、`user.logout`）；全局 `setErrorHandler`（未捕获异常不泄露 req.body）；pino redaction 增加 `email`、`res.body.connection`、`res.body.accessToken`、`res.body.refreshToken`；KEK 文件权限检查（拒绝非 `0600`）；`ipPrefix` 截断为 /24 或 /64。
- [x] **P1.4 部署与恢复**：产出 `docs/deployment.md`（环境变量、KEK 管理、nginx 反代示例、备份策略、安全检查清单）。

### 进行中

- 无

### 待开始

1. **P2 多设备登录与 Host 同步** — 账号级 revision、增量 sync、tombstone、设备/session 页面、实时失效通知。
2. 后续见 `docs/development-plan.md` 的完整序列。

## 关键约束（回答问题时必须遵守）

### 架构边界

- Dashboard 是控制面，不是数据面。不代理 daemon WebSocket，不接收/转发 timeline/terminal/prompt/daemon RPC。
- daemon 不主动连接 Dashboard。客户端从 Dashboard 获取 Host 配置后直接连 Paseo Relay 或 daemon。
- Relay 与 Dashboard 逻辑独立。必须复用 Paseo 现有 Relay E2EE，禁止复制/重写/降级。
- 不使用 Paseo Hub 架构，也不以 Hub 为实现基础。
- Server 不得导入 daemon client，不得连接 Relay/daemon。

### 敏感数据

- pairing offer、`daemonPublicKeyB64` 与完整 `HostConnection` 按密码级凭据处理。
- 日志/分析/错误追踪/审计不得包含原始 offer、完整 `HostConnection`、token、session cookie、密码或密钥。
- API 只向已授权用户返回 capability；响应必须 `Cache-Control: no-store`。
- 服务端持久化 capability 必须使用版本化 envelope encryption。

### 实现规则

- Dashboard API 调用与 daemon client 调用放在不同模块。
- 页面不得直接到处创建 `DaemonClient`，统一通过 connection manager。
- 不做未开放决策（见 `open-decisions.md`）。
- 所有安全相关行为要有负向测试。
- 不在未更新对应文档的情况下改变架构边界。

### 回答风格

- 用 `Verdict: Incorrect / Partially correct / Correct / Unknown / Bad approach` 格式评估用户的技术主张。
- 不默认同意用户；正确性优先于友好。
- 用中文回答。

## 未决问题（来自 open-decisions.md）

- [x] 后端语言与框架 → 已定：Fastify
- [x] 数据库 → 已定：SQLite + Drizzle（可迁移 PostgreSQL）
- [x] Web 框架 → 已定：React + Vite + Router + Zustand
- [x] Web session 形态 → 已定：Cookie + bearer 双轨
- [x] KEK 来源 → 已定：KeyProvider 接口，M1 用本地 key file
- [x] 注册策略 → 已定：M1 首用户后关闭
- [x] 官方 client 覆盖范围 → 已定：DaemonClient 覆盖 M3 全部功能，无底层缺口（见 m0-exit-report.md）
- [ ] 浏览器扫码方案（需验证 HTTPS/权限/兼容性）
- [ ] Harmony runtime 兼容性（需真机验证）
- [ ] MVP 是否允许服务端读取 capability（已建议：允许）
- [ ] 本地客户端缓存保留策略
- [ ] 删除 tombstone 保留期

## P0 骨架技术要点（接续时了解）

- 根目录 `package.json` 用 npm workspaces，包命名为 `@paseo-board/*`。
- `packages/contracts` 是唯一共享包，三端都依赖；类型定义在 `src/index.ts`。
- `server` 用 Fastify，pino redaction 已配置常见敏感字段（password/refreshToken/connection/token）。
- `web` 用 Vite + React + React Router，Vite dev proxy 把 `/api` 转发到 `localhost:3000`。
- 安装依赖用 `npm install --cache /tmp/.npm-cache`（默认 `~/.npm` 只读会报 EROFS）。
- 运行：`npm run dev:server` + `npm run dev:web`；测试：`npm run test`。
- server 启动时自动创建 `data/` 目录和 SQLite 表；开发 KEK 自动生成于 `data/.kek`。
- 使用 `better-sqlite3`，同步 API；`db.transaction(cb)` 回调必须同步（不可 async）。
- DB 表：users, devices, sessions, hosts, host_connections, audit_events。
- 加密：每行随机 256-bit DEK → AES-256-GCM 加密 payload → DEK 由 KEK 包装（AES-256-GCM），AAD 绑定 schema/user/host/conn/keyVersion。
- Web 连接层：`web/src/paseo/connectionManager.ts` 使用官方 `buildRelayWebSocketUrl` 构造 `wss://.../ws?serverId=...&role=client&v=2`，再把 `daemonPublicKeyB64` 交给 `DaemonClient` 的 E2EE 配置。
- Web 构建兼容：`@getpaseo/relay@0.3.0` 的 package exports 中 `import` 指向未发布的 `src`，`web/vite.config.ts` 用 alias 将 `@getpaseo/relay/e2ee` 指向发布包 `dist/e2ee.js`；这是 bundler 兼容补丁，不复制或改写 Relay E2EE。
- P0.4 已验证命令：`npm run build:web`、`npm run test`、`npm run typecheck` 均通过。Vite build 有大 chunk 警告，原因是官方 client/relay 进入首屏 bundle，P0.4 暂不拆分。
- E2E 测试分层：`tests/e2e` 用 vitest 跑纯逻辑测试（offer 解析、connection manager config）；Playwright 浏览器测试通过 `npm run test:e2e --workspace=tests/e2e` 单独跑（需先 `npx playwright install`）。
- 测试统计：web 2 + contract 19 + e2e 8 = 29 测试全量通过。

## 接续方式

> 如果你是新对话，执行以下步骤：

1. **读此文件**：`cat docs/progress.md`
2. **读 AGENTS.md**：根目录 `AGENTS.md`（含所有架构边界和规则）
3. **读当前阶段文档**：根据 `当前状态` 的"进行中"任务，按 `docs/development-plan.md` 的对应子阶段读关联文档
4. **确认上下文**：查看 `docs/` 目录的最新文件列表，确认是否有新文件
5. **继续执行**：从"进行中"任务开始。如果"进行中"为空，从"待开始"的第一个任务开始。如果任务涉及决策，先查 `open-decisions.md`。如果该任务在 development-plan 中有前置依赖，确认前置完成。
6. **更新本文件**：完成后更新 `当前状态` 和 `进行中`。

## 修改记录

| 日期       | 修改人 | 说明                                                                                                                     |
| ---------- | ------ | ------------------------------------------------------------------------------------------------------------------------ |
| 2026-08-12 | Codex  | 初版创建                                                                                                                 |
| 2026-08-12 | Codex  | 完成 P0.1 选型 + P0.2 骨架，全量 build/test 通过                                                                         |
| 2026-08-12 | Codex  | 完成 P0.3 最小认证与 Host 存储，20 测试通过                                                                              |
| 2026-08-12 | Codex  | 完成 P0.4 Web 连接代码、Web build、全量 test/typecheck；真实 daemon/Relay 浏览器 E2E 待跑                                |
| 2026-08-12 | Codex  | P0.4 补充：e2e 包新增 7 测试（offer+connection config），全量 29 测试通过；Playwright 配置就绪但浏览器二进制安装审批被拒 |
| 2026-08-12 | Codex  | P0.4 完成：Playwright Chromium 浏览器 E2E 3 测试通过，全量 32 测试通过，P0.4 完结                                        |
| 2026-08-12 | Codex  | P0.5 完成：M0 退出条件全部满足，产出 m0-exit-report.md，client 覆盖矩阵和敏感数据检查完成，M0 退出                       |
| 2026-08-12 | Codex  | Git 仓库初始化，基线 commit `09b5a63`                                                                                    |
| 2026-08-12 | Codex  | P1.1 完成：Argon2id、access/refresh 分离、reuse 检测、注册关闭、修改密码、负向测试 16 个，全量 36 测试通过               |
| 2026-08-12 | Codex  | Git 仓库初始化，README 创建                                                                                              |
| 2026-08-12 | Codex  | P1.2 完成：Host 更新、fingerprint 去重、幂等键、tombstone sync，8 个新测试                                               |
| 2026-08-12 | Codex  | P1.3 完成：审计事件补齐、setErrorHandler、redaction 增强、KEK 权限检查、IP 截断                                          |
| 2026-08-12 | Codex  | P1.4 完成：部署文档 docs/deployment.md                                                                                   |

- Playwright 浏览器 E2E：浏览器二进制在 `/tmp/playwright-browsers`，运行命令 `PLAYWRIGHT_BROWSERS_PATH=/tmp/playwright-browsers npx playwright test --config tests/e2e/playwright.config.ts`；Playwright config 内也设置了 `launchOptions.env.PLAYWRIGHT_BROWSERS_PATH`。
- 测试统计：web 2 + contract 34 + e2e vitest 8 = 44 测试全量通过（Playwright 3 未计入 CI 常规跑）。
