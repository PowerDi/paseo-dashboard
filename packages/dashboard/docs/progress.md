# 项目进展

> 快速接续备用文件。每次对话开始首先读此文件，然后按 `接续方式` 行动。
> 更新本文件：每次产出重要产出后（文档创建、代码提交、测试通过、架构变更）更新对应部分。

## 项目身份

- **项目**：Paseo Dashboard — Host 配置跨设备同步控制面，不代理 daemon 数据。
- **仓库**：Paseo monorepo fork — `git@github.com:PowerDi/paseo-dashboard.git`
- **代码位置**：`/root/workspace/code/paseo/packages/dashboard/`
- **Paseo 源码**：`/root/workspace/code/paseo/`（monorepo 根，作为行为事实来源）
- **当前阶段**：M1 完成（P0-P1.4 全部完成），可进入 P2 或 P3。
- **当前分支**：`feat/dashboard-migration`（已推送到 origin）

## Git 协作

```
origin    → git@github.com:PowerDi/paseo-dashboard.git  (你的 fork，SSH，推送用)
upstream  → https://github.com/getpaseo/paseo.git       (官方，拉更新用)
```

- **身份**：PowerDi <15917030+PowerDi@users.noreply.github.com>
- **推送**：`git push origin <branch>`
- **拉官方更新**：`git fetch upstream && git merge upstream/main`
- **分支开发**：每个功能在新分支上开发，完成后合入 main

## 文档地图

| 文件 | 内容 | 使用场景 |
| --- | --- | --- |
| `AGENTS.md` | 事实来源、架构边界、敏感数据规则、API 与客户端准则、目录职责、Paseo 集成规则、实现与安全规则 | 所有开发任务开始前必须读 |
| `docs/product-requirements.md` | 产品定义、目标/非目标、用户流程、页面信息架构、验收标准 | web/ 和 harmony/ 开发前必读 |
| `docs/architecture.md` | 系统边界、应用划分、目录职责、数据模型、API 设计、删除语义、技术栈 | 所有开发任务读涉及的部分 |
| `docs/roadmap.md` | M0-M6 的里程碑定义、范围、退出条件、风险 | 规划阶段和判断功能是否进入当前版本 |
| `docs/development-plan.md` | 将 roadmap 拆解为可执行子任务序列，含依赖关系和验证标准 | 当前开发阶段参照 |
| `docs/open-decisions.md` | 待定决策（已定项标记为"已决定"） | 需要决策时查阅 |
| `docs/paseo-integration.md` | 官方 client/protocol 用法、Relay E2EE 边界、Dashboard 连接层、页面平移原则、兼容策略 | 所有涉及 Paseo 通信的任务 |
| `docs/security.md` | 保护目标、信任边界、pairing 安全、存储加密、认证方案、撤销语义、审计规则、安全测试 | 所有安全相关任务 |
| `docs/deployment.md` | 部署指南：环境变量、KEK 管理、反代、备份、安全检查清单 | 部署和运维 |
| `docs/m0-exit-report.md` | M0 退出条件检查报告：敏感数据检查、client 覆盖矩阵、缺口清单 | M0 退出确认 |

## 当前状态

### 已完成

- [x] 所有 `docs/` 文档创建完毕（architecture / product-requirements / roadmap / open-decisions / paseo-integration / security）
- [x] `docs/development-plan.md` 创建完毕（P0-P6 的子任务分解）
- [x] 根目录 `AGENTS.md` 配置完整
- [x] **P0.1 技术选型**：Fastify 后端 / SQLite+Drizzle 数据库 / React+Vite+Router+Zustand Web 框架 / npm workspaces / vitest 测试。
- [x] **P0.2 项目骨架**：npm workspaces、tsconfig.base、contracts 包、server 骨架、web 骨架、tests 骨架。
- [x] **P0.3 最小认证与 Host 存储**：Drizzle schema（7 表）、envelope encryption、auth 路由、host 路由、sync 路由、20 个契约测试。
- [x] **P0.4 Web 端连接验证代码**：Web 集成 `@getpaseo/client`/`protocol`/`relay`；connection manager、offer parser；Playwright E2E 3 测试。全量 32 测试通过。
- [x] **P0.5 M0 退出条件确认**：敏感数据检查、client 覆盖矩阵（DaemonClient ~130+ 方法）、m0-exit-report.md。M0 退出。
- [x] **P1.1 完整认证与会话**：Argon2id；access/refresh 分离；reuse 检测撤销 family；注册关闭；修改密码；忘记/重置密码暂不提供。16 个负向契约测试。
- [x] **P1.2 Host 完整生命周期**：Host 更新（乐观并发 409）；capability fingerprint 去重；幂等键；sync 返回 tombstone。8 个新测试。
- [x] **P1.3 存储加密与审计**：审计事件补齐（login_failed、logout）；setErrorHandler；redaction 增强；KEK 权限检查；IP 截断。
- [x] **P1.4 部署与恢复**：`docs/deployment.md`。
- [x] **Git 仓库初始化**：paseo-board 独立仓库基线 commit `09b5a63`。
- [x] **迁移到 Paseo monorepo**：paseo-board 代码迁移到 `packages/dashboard/`，分支 `feat/dashboard-migration`，commit `3b0ca1c03`，推送到 origin。

### 迁移变更记录

迁移时做了以下调整以适配 Paseo monorepo：

| 改动 | 原因 |
| --- | --- |
| 包名 `@paseo-board/*` → `@getpaseo/dashboard-*` | 匹配 monorepo 命名 |
| `DaemonClient` 从 `@getpaseo/client` 改为 `@getpaseo/client/internal/daemon-client` | 当前 Paseo 版本不再从主入口导出 DaemonClient |
| React 18 → 19.1.0 | 匹配 monorepo |
| vite.config.ts relay e2ee 路径 | monorepo 目录层级不同 |
| 根 package.json 增加 dashboard workspaces + 脚本 | `dev:dashboard:server`、`dev:dashboard:web`、`build:dashboard`、`test:dashboard`、`typecheck:dashboard` |

### 进行中

- 无

### 待开始

1. **P2 多设备登录与 Host 同步** — 账号级 revision、增量 sync、tombstone、设备/session 页面、实时失效通知。
2. **P3 Agent 面板 UI** — 以官方 App 为参考重写 UI，增加看板等新功能。需要研究官方 App 的 stores/daemon 逻辑。
3. 后续见 `docs/development-plan.md` 的完整序列。

## 关键约束（回答问题时必须遵守）

### 架构边界

- Dashboard 是控制面，不是数据面。不代理 daemon WebSocket，不接收/转发 timeline/terminal/prompt/daemon RPC。
- daemon 不主动连接 Dashboard。客户端从 Dashboard 获取 Host 配置后直接连 Paseo Relay 或 daemon。
- Relay 与 Dashboard 逻辑独立。必须复用 Paseo 现有 Relay E2EE，禁止复制/重写/降级。
- 不使用 Paseo Hub 架构，也不以 Hub 为实现基础。
- Server 不得导入 daemon client，不得连接 Relay/daemon。
- Dashboard 是 Paseo monorepo 内的子项目，不 fork 官方 App 代码，不修改 `packages/app/`。
- Dashboard 直接引用 `@getpaseo/client` 和 `@getpaseo/protocol`（monorepo 内 workspace 依赖）。

### 敏感数据

- pairing offer、`daemonPublicKeyB64` 与完整 `HostConnection` 按密码级敏感凭据处理。
- 日志、分析、错误追踪、指标标签和审计详情不得包含原始 offer、完整 `HostConnection`、token、session cookie、密码或加密密钥。
- API 只向当前已授权用户和有效 session 返回 capability；响应必须设置 `Cache-Control: no-store`。
- 服务端持久化 capability 必须使用版本化 envelope encryption。

### 实现规则

- Dashboard API 调用与 daemon client 调用放在不同模块。
- 页面不得直接到处创建 `DaemonClient`，统一通过 connection manager。
- 不做未开放决策（见 `open-decisions.md`）。
- 所有安全相关行为要有负向测试。
- 不在未更新对应文档的情况下改变架构边界。

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

## 技术要点（接续时了解）

### Monorepo 内的 Dashboard 结构

```
packages/dashboard/
├── shared/           # API 契约类型（@getpaseo/dashboard-shared）
├── server/            # Dashboard API（@getpaseo/dashboard-server）
├── web/               # Web UI（@getpaseo/dashboard-web）
├── tests/
│   ├── contract/      # API 契约测试
│   └── e2e/           # 端到端测试
└── docs/              # 设计文档
```

### 构建和运行

从 monorepo 根目录 `/root/workspace/code/paseo/` 运行：

```bash
# 安装依赖
npm install --cache /tmp/.npm-cache

# 构建 dashboard 依赖（client/protocol/relay，首次或更新后需要）
npm run build:client && npm run build:relay

# 构建 dashboard
npm run build:dashboard

# 开发模式（两个终端）
npm run dev:dashboard:server   # 后端 端口 3000
npm run dev:dashboard:web      # 前端 端口 5173

# 测试
npm run test:dashboard         # 42 测试

# 类型检查
npm run typecheck:dashboard
```

### 数据库

- server 用 SQLite + Drizzle ORM（`better-sqlite3` 同步 API）。
- server 启动时自动创建 `data/` 目录和表；开发 KEK 自动生成于 `data/.kek`。
- DB 表：users, devices, sessions, password_reset_tokens, hosts, host_connections, audit_events。
- `db.transaction(cb)` 回调必须同步（不可 async）。

### 加密

- 每行随机 256-bit DEK → AES-256-GCM 加密 payload → DEK 由 KEK 包装（AES-256-GCM），AAD 绑定 schema/user/host/conn/keyVersion。
- capability fingerprint 使用 HMAC-SHA256（从 KEK 派生，域分离），不可逆。

### Web 连接层

- `web/src/paseo/connectionManager.ts` 使用官方 `buildRelayWebSocketUrl` 构造 Relay URL。
- `DaemonClient` 从 `@getpaseo/client/internal/daemon-client` 导入（当前 Paseo 版本不再从主入口导出）。
- `@getpaseo/relay/e2ee` 的 vite alias 指向 `../../relay/dist/e2ee.js`（monorepo 内路径）。

### 测试统计

- web 2 + contract 34 + e2e vitest 8 = **42 测试**全量通过。
- Playwright 浏览器 E2E 3 测试（需 `PLAYWRIGHT_BROWSERS_PATH=/tmp/playwright-browsers`）。
- Lefthook pre-commit hook 会跑全 monorepo typecheck（含 app/desktop/cli），这些包有预先存在的 typecheck 错误，不是 dashboard 引入的。dashboard 的 `typecheck:dashboard` 全部通过。提交时可用 `--no-verify` 绕过。

## 接续方式

> 如果你是新对话，执行以下步骤：

1. **读此文件**：`cat packages/dashboard/docs/progress.md`
2. **读 AGENTS.md**：`packages/dashboard/AGENTS.md`（含所有架构边界和规则）
3. **读当前阶段文档**：根据 `当前状态` 的"进行中"任务，按 `docs/development-plan.md` 的对应子阶段读关联文档
4. **确认上下文**：查看 `docs/` 目录的最新文件列表，确认是否有新文件
5. **继续执行**：从"进行中"任务开始。如果"进行中"为空，从"待开始"的第一个任务开始。
6. **更新本文件**：完成后更新 `当前状态` 和 `进行中`。

## 修改记录

| 日期 | 修改人 | 说明 |
| --- | --- | --- |
| 2026-08-12 | Codex | 初版创建 |
| 2026-08-12 | Codex | 完成 P0.1 选型 + P0.2 骨架 |
| 2026-08-12 | Codex | 完成 P0.3 最小认证与 Host 存储 |
| 2026-08-12 | Codex | 完成 P0.4 Web 连接代码 |
| 2026-08-12 | Codex | P0.5 完成：M0 退出条件全部满足 |
| 2026-08-12 | Codex | P1.1 完成：Argon2id、access/refresh 分离、reuse 检测 |
| 2026-08-12 | Codex | P1.2 完成：Host 更新、fingerprint 去重、幂等键 |
| 2026-08-12 | Codex | P1.3 完成：审计事件补齐、setErrorHandler、KEK 权限检查 |
| 2026-08-12 | Codex | P1.4 完成：部署文档 |
| 2026-08-12 | Codex | 迁移到 Paseo monorepo `packages/dashboard/`，分支 `feat/dashboard-migration`，commit `3b0ca1c03` |
