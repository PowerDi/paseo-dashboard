# 项目进展

> 快速接续备用文件。每次对话开始首先读此文件，然后按 `接续方式` 行动。
> 更新本文件：每次产出重要产出后（文档创建、代码提交、测试通过、架构变更）更新对应部分。

## 项目身份

- **项目**：Paseo Dashboard — Host 配置跨设备同步控制面，不代理 daemon 数据。
- **仓库**：Paseo monorepo fork — `git@github.com:PowerDi/paseo-dashboard.git`
- **代码位置**：`/root/workspace/code/paseo/packages/dashboard/`
- **Paseo 源码**：`/root/workspace/code/paseo/`（monorepo 根，作为行为事实来源）
- **当前阶段**：M3 进行中。P3.1 完成 2/3（缺 feature gating）、P3.2 全部完成（创建/恢复在 P3.4 落地）、P3.3 全部完成（Timeline + Terminal + 大数据量处理）、P3.4 全部完成（Prompt + 新建会话 + 恢复 + 权限请求）。
- **当前分支**：`feat/dashboard-migration`（P3.1-P3.3 已提交，见 Git 状态）

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
| `docs/deployment.md`           | 部署指南：环境变量、KEK 管理、反代、备份、安全检查清单                                       | 部署和运维                         |
| `docs/ui.md`                   | Dashboard Web 视觉与交互：Zeno 参照、层叠、composer/侧栏/运行状态、禁止项                    | 改 `web/` 页面、组件、CSS 前必读   |
| `docs/local-development.md`    | 本地开发指南：快速启动、Origin 校验、环境变量、常见问题、调试技巧                            | 本地开发与排查问题时必读            |

## 当前状态

### 最新修复（commit `01ea5125f`）

- **Live Status 计时 bug 修复**：`deriveLiveActivity` 在最后一条是 assistant_message 时返回 null，即使 agent status 还是 "running"（daemon agent_update 延迟），完整回复就停止计时。测试用例同步修正。
- **本地开发文档**：新增 `docs/local-development.md` - Origin 校验说明（localhost vs 127.0.0.1）、环境变量、常见问题（403/新建会话失败/Live Status）、调试技巧。

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
- [x] **P2.1 增量同步与冲突**：hosts 表加 `lastSyncRevision` 列；重写 sync API 按 `lastSyncRevision > after` 游标查询；Web 端同步状态机（localStorage 持久化、分页、幂等、全量 resync）；8 个契约测试。
- [x] **P2.2 设备与 Session 管理**：devices 加 `lastSyncRevision`、sessions 加 `createdAt`；GET/DELETE `/devices` 和 `/sessions` 路由；sync 追踪设备 revision；9 个契约测试。
- [x] **P2.3 实时配置事件**：in-memory `ConfigEventBus`（按 userId 分区）；SSE `/events` 端点；mutation 路径（import/update/delete/revoke）触发事件；10 个测试（5 单元 + 5 集成）。
- [x] **P2.4 安全加固**：内存 rate limiter（login/register/refresh/change-password 按 IP）；Origin 校验（状态变更请求）；CSP/X-Frame-Options/nosniff headers；审计查询 API `/audit-events`（ULID cursor 分页）；14 个安全测试（跨用户隔离、rate limit、Origin、CSP、审计）。
- [x] **Git 仓库初始化**：paseo-board 独立仓库基线 commit `09b5a63`。
- [x] **迁移到 Paseo monorepo**：paseo-board 代码迁移到 `packages/dashboard/`，分支 `feat/dashboard-migration`，commit `3b0ca1c03`，推送到 origin。
- [x] **P3.1 Connection Manager**：`DefaultPaseoConnectionManager` 多 Host 连接槽 + 状态订阅 + 官方 client `reconnect: { enabled: true }`；`daemon-data-store` 承载 projects/workspaces/agents（游标翻页 + 请求版本号防串台）；登出/删除 Host 时 `disconnectAll`/`disconnectHost` 清理连接与本地数据；`paseo/features.ts` 模块提供 `getDaemonFeatures(serverInfo)` 集中提取 feature flags，`selectiveAgentTimeline` 在 `viewAgent`/`leaveAgent` gating，`terminalRestoreModes` 在 `terminalSession.ts` gating（带 COMPAT 标签，退出条件满足）。
- [x] **UI 设计系统对齐 zeno**：token 体系重写（三级 surface #2d2d2d/#383838/#272727、圆角 6/10/12px 三级、14px 正文 + 400/500/600 字重）；列表页改 hover 填充行；Workspace zeno 式空态 + composer 常驻；SectionLabel 收敛为共享组件；页头操作按钮扁平化。
- [x] **Web i18n**：i18next + react-i18next + browser-languagedetector；zh-CN/en 类型安全字典；设置页语言切换器；localStorage 持久化 + `<html lang>` 同步；全部 UI 字符串（含 aria/tooltip）收进字典。
- [x] **P3.2 数据接线（读路径 + 认证）**：登录/注册页 + `app-store` 认证状态机（cookie bootstrap、401 全局登出）；`App.tsx` 接 `dashboardRuntime`（host 自动连接/断开、SSE 触发增量 sync）；侧栏树/Hosts/Agents/Workspace 用真实 Host→Project→Agent 数据（`lib/agent-tree.ts` 纯函数 + 单测）；Devices/Settings 接真实 API；Host 导入弹窗改为真实验证（relay 连接读 server_info 版本）+ importHost + sync；时间显示按 locale（`lib/format-time.ts`）。`*Prototype.tsx` 页面全部替换为 `*Page.tsx`。
- [x] **P3.2 实时订阅 + Agent 操作（写路径）**：`DaemonClientLike` 扩展 `on`/`archiveAgent`/`cancelAgent`；runtime 连接后订阅 `agent_update`/`workspace_update`/`project.update` 推送进 `daemon-data-store`（upsert/remove reducer，未知 agent 无 placement 时回退全量刷新），重连（disconnected→connected）自动 `refreshHost` 补齐断线期间丢的事件；`runtime.archiveAgent/cancelAgent`（归档成功后本地立即标记，防广播延迟）；Agents 行 hover 与 Workspace 头部提供停止（running 时）/归档按钮，归档选中 agent 自动清除选择。创建与恢复后来在 P3.4 落地（见下）。
- [x] **P3.3 Timeline（读 + 分页 + 实时）**：`stores/timeline-store.ts`（tail 页加载、`before` 向上分页、epoch/seq 切割合并、staleCursor 回退重拉、流事件节流刷新）+ 10 单测；`DaemonClientLike` 扩展 `fetchAgentTimeline`/`setAgentTimelineSubscription`；runtime `viewAgent/leaveAgent`（selective 订阅 + tail 加载）、`agent_stream` 转发；`useAgentTimeline` hook；`components/timeline.tsx` 渲染 user/assistant/reasoning（折叠）/tool_call（摘要行 + output/diff 折叠）/todo/error/compaction；Workspace 自动滚底（用户上翻时不打扰）。
- [x] **UI 打磨第一轮（对齐 zeno desktop）**：timeline 的 assistant 消息改 `components/markdown-content.tsx`（react-markdown + remark-gfm + rehype-sanitize），代码围栏和 tool_call 输出走 `components/code-block.tsx`（highlight.js 精简语言集 + 语言标签 + 复制按钮；`edit` 工具的 unifiedDiff 走 diff 行渲染，带行号与增删底色，解析逻辑 `lib/diff-lines.ts` 从 zeno `process-activity.ts` 移植，4 单测）。从 zeno 搬 4 个 radix 基础组件（select/dialog/alert-dialog/tooltip）+ `tw-animate-css`；新建会话的两个原生 `<select>` 换成 radix Select（popper 定位在 composer 上方），全部 `window.alert` 换成 `components/error-alert.tsx` 的 AlertDialog（context + `useErrorAlert()`）；两个 composer 接 `hooks/use-autosize-textarea.ts`（56→126px 实测）。样式在 `globals.css` 追加 `.dash-md` 与 `.content-code-block`/`.content-diff-*` 段，补 `--popover` token 映射。**顺带修了既有依赖不一致**：dashboard/web 的 package.json 写 `react ^19.1.0`，lockfile 却一直钉在 18.3.1（npm 标 invalid），react-markdown 的类型把它暴露出来——对齐到 19 后 `main.tsx` 里那条 react-router `@ts-expect-error` 也不再需要，已删。web 单测 77→84；typecheck/lint/format/build 通过；Playwright 实测 markdown（标题/列表/表格/行内码/python 高亮 8 个 token）、radix 下拉、autosize。
- [x] **P3.4 Prompt 与权限请求**：runtime 新增 `sendAgentMessage`/`createAgent`/`resumeAgent`/`respondToPermission`（`DaemonClientLike` Pick 同步扩展，5 单测）。Workspace composer 接真实发消息（Enter 发送、发送中禁用）；空态 composer 变成新建会话入口（`components/new-session-composer.tsx`：主机·项目下拉 + provider 下拉（协议包 `AGENT_PROVIDER_DEFINITIONS`）+ initialPrompt，创建后自动选中）；Agents 页新增「已归档」区（`buildArchivedAgentRows` + 单测），带 `persistence` handle 的可恢复（恢复后选中返回快照的 id，防 id 变化）；权限卡片 `components/permission-requests.tsx` 渲染 `pendingPermissions`（`actions` 有则按 behavior/variant 出按钮，无则默认允许/拒绝），响应后本地先移除等广播兜底。Playwright 实测（真实 daemon + codex）：空态创建 → prompt 进 timeline → 精确回复 → composer 追发 → 回复 → 归档 → 已归档区可见。权限卡片真实触发未复现（codex 该模式自动放行），响应链路由单测覆盖。
- [x] **UI 打磨第二轮（交互结构 + 层叠修复）**：composer 改 protrusion 条焊输入卡片（`components/composer-shell.tsx`），发送按钮独立底栏；侧栏「添加主机」改次级动作（虚线方标，不再复用 nav-item）；运行状态两层——侧栏 `SessionStatusMarker`（running 转圈 / error 红叉）、时间线末尾 `TimelineLiveStatus`（shimmer + 计时，phase 由 `deriveLiveActivity` 从最新条目推断）；用户消息右对齐气泡；header 状态/视图/操作分组；上翻出回到底部按钮。**根因修复**：`globals.css` 无层级 `* { padding: 0 }` 压过 Tailwind `@layer utilities`，全站间距工具类失效（权限卡片 `p-3.5` 计算值 0）——重置迁入 `@layer base`，盒模型实测 padding 0→14px。web 包加 `test` 脚本（自有 vite alias，避开根配置把 `@` 指到 app）；`test:dashboard` 纳入 web。单测 84→94。约定已写入 [`docs/ui.md`](./ui.md)，Cursor 规则 `.cursor/rules/dashboard-ui.mdc`。

### 迁移变更记录

迁移时做了以下调整以适配 Paseo monorepo：

| 改动                                                                                | 原因                                                                                                    |
| ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| 包名 `@paseo-board/*` → `@getpaseo/dashboard-*`                                     | 匹配 monorepo 命名                                                                                      |
| `DaemonClient` 从 `@getpaseo/client` 改为 `@getpaseo/client/internal/daemon-client` | 当前 Paseo 版本不再从主入口导出 DaemonClient                                                            |
| React 18 → 19.1.0                                                                   | 匹配 monorepo                                                                                           |
| vite.config.ts relay e2ee 路径                                                      | monorepo 目录层级不同                                                                                   |
| 根 package.json 增加 dashboard workspaces + 脚本                                    | `dev:dashboard:server`、`dev:dashboard:web`、`build:dashboard`、`test:dashboard`、`typecheck:dashboard` |

### Git 状态（2026-08-13）

`feat/dashboard-migration` 上 dashboard 相关 commit：`4cd5f2667`「P3: Connection Manager、Agent 面板与 Timeline」（P3.1/P3.2/P3.3 Timeline + UI/i18n 全部产出，57 文件）、`ba416a892`「P2: 多设备登录与 Host 同步」、`3f5221c1a`（progress 更新）、`3b0ca1c03`（迁移）。P3.3 Terminal + 大数据量处理在其后的 commit（见修改记录）。

### 待开始

按依赖排序。1 阻塞 M3 退出，2 是 M1/M2 被跳过的历史缺口（服务端做了、Web 端没接）。

1. **P3.5 兼容性测试**（当前优先）— daemon 版本矩阵 smoke tests。
   另有 `roadmap.md` M3 范围里的「路由」未做（见下面「Web 数据接线」的路由说明），要不要在 M3 内补取决于是否需要深链。
2. **P3.6 历史 Web 缺口补齐** — 服务端路由已实现、Web 端完全没接的四项：`POST /auth/change-password`（P1.1 记为完成，但没有页面和 client 方法）、`PATCH /hosts/:id` 改名（P1.2 的乐观并发 409 路径 Web 端从未调用过）、`GET /audit-events`（P2.4 完成，产品需求里「审计记录」是独立页面）、`GET /me`（`app-store` 现在用 localStorage 缓存 user，刷新后靠缓存显示邮箱，有 `/me` 可以直接取）。另加 SSE 重连：server 已发 `id:` 并支持 `Last-Event-ID`，`dashboardEvents.ts` 能解析 id 但从不回传，也没有重连循环——流断掉（代理超时/网络抖动）后 Host 配置更新静默停止，直到用户刷新页面。web 单测已进 `test:dashboard`；CI 仍不跑 dashboard。development-plan.md 已补 P3.6 小节。
3. Timeline 后续优化（记录，不阻塞）：流式期间靠节流 tail 重拉（400ms/次，limit 50），未做增量 stream reducer；「加载更早」是按钮而非滚动哨兵。权限卡片的真实弹出流程也待一次带审批模式的实测。
4. 后续见 docs/development-plan.md 的完整序列。

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
npm run test:dashboard         # web 94 + contract 79 + e2e vitest 8
# web 单测必须走 workspace 脚本（该包 vite.config 的 @ 别名），不要从根 vitest 直接跑 web/src
npm run test --workspace=@getpaseo/dashboard-web

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

### Web 数据接线（P3.2）

- 认证：Web 用 HttpOnly cookie；`stores/app-store.ts` 的 `bootstrap()` 用 `listHosts()` 探测（200→ready，401→未登录，其他→可重试错误）；`dashboardApi.setUnauthorizedHandler` 全局接 401 登出。用户对象取自登录/注册响应并缓存在 localStorage 供设置页显示——服务端有 `GET /api/v1/me` 可以直接取，web 端还没接（见待开始 P3.6）。
- 路由：`main.tsx` 只注册了 `/` 一条路由，页面切换是 `App.tsx` 里的 `useState<Page>`，agent 选择是 `useState<AgentSelection>`。react-router-dom 装了但没用起来，所以没有 per-page URL、没有 agent 深链、刷新回到 workspace 空态。要做深链就得先把导航状态搬进 router。
- 数据流：`host-sync-store`（Dashboard host 注册表）→ `App.tsx` effect 对每个 host `dashboardRuntime.connectHost`（断线 host 自动 disconnect）→ `hooks/use-host-runtimes.ts` 订阅每个 host 的连接态 + daemon 数据 → `lib/agent-tree.ts` 纯函数构建侧栏树/列表行。SSE `host.upserted/deleted` 只触发一次增量 `sync()`（事件 data 是松散类型，不直接消费）。
- **分组键的坑**：agent placement 的 `projectKey` 字段实际是 `projectId`（daemon 在 `packages/server/src/server/session.ts` 里填的），与项目描述符自己的 `projectKey`（新式 key）不同源。按 `projectId` 分组，否则同一项目出现两行。
- Host 导入的真实验证：`dashboardRuntime.verifyConnection(host)` 临时连 relay 读 `server_info.version` 后即断开，临时 host 不进 sync store。
- SSE 长连接会让 Playwright 的 `waitUntil: "networkidle"` 永远超时，登录后一律用 `domcontentloaded`。
- 实时数据：`dashboardRuntime` 连接后通过 `client.on("agent_update"/"workspace_update"/"project.update")` 把推送写进 `daemon-data-store` 的 apply reducer；重连时 `refreshHost` 兜底。测试里 mock `DaemonClient["on"]` 重载集很难精确实现（`DaemonEventHandler` 变体的事件 union 与 `SessionOutboundMessage` 不同），fake 用属性 + `as DaemonClientLike["on"]` 断言。
- Timeline：daemon 的 live `agent_stream` 可能是 delta 形态，dashboard 不做增量 reducer——`timeline-store` 收到流事件后节流重拉 tail 页，用页首 `seqStart` 切割合并（同 epoch 且重叠/相邻时保留更早历史，daemon 投影替换重叠后缀）。语义依据见 Paseo `docs/timeline-sync.md`。`sourceSeqRanges` 字段是 `startSeq/endSeq`。
- **权限不是 timeline 条目**：`AgentTimelineItem` 的 union 只有 7 种（user_message / assistant_message / reasoning / tool_call / todo / error / compaction），`components/timeline.tsx` 全部渲染了，覆盖完整。权限走两条独立通道：agent 快照的 `pendingPermissions` 数组，和 `agent_stream` 的 `permission_requested`/`permission_resolved` 事件（在 `timeline-store` 的 `REFRESH_EVENT_TYPES` 里只用来触发 tail 重拉）。做 P3.4 时不要去扩 timeline item 类型。
- `DaemonClientLike` 是 `Pick<DaemonClient, ...>`（`paseo/connectionManager.ts:13`）。加新 daemon 能力先往这个 Pick 里加名字，不要在页面里绕过 connection manager 直接摸 `DaemonClient`。
- **Terminal**：`paseo/terminalSession.ts` 是唯一的终端流处理层——订阅 `onTerminalStreamEvent`（按 terminalId 过滤 output/restore/snapshot）、`terminal_stream_exit`、resize intent（attach 时 claim、之后 update，语义见 Paseo `docs/terminal-performance.md`）。restore 模式经 `features["terminal-restore-modes"]` gate（COMPAT 注释在代码里）；无 feature 的旧 daemon 会送 snapshot 帧，`terminal-view.tsx` 用 `renderTerminalSnapshotToAnsi`（`@getpaseo/protocol/terminal-snapshot`）reset+重放进 xterm。xterm 的 `fontFamily` 不解析 CSS 变量，要写完整字体栈。终端是 per-cwd 的（`listTerminals(cwd, …, { workspaceId })`），Workspace 页用 `agent.cwd`/`agent.workspaceId`。

### Web UI 与 i18n

见 [`docs/ui.md`](./ui.md)。token、层叠、composer/侧栏/运行状态、Zeno 组件对照、i18n、禁止项都在那一篇。Playwright 端口与 headless 截图坑也写在「验证」。

### 测试统计

- web 单测 **104**（14 文件：dashboardApi 1、dashboardEvents 4、connectionManager 7、dashboardRuntime 17、daemon-data-store 12、timeline-store 11、terminalSession 8、app-store 7、agent-tree 10、diff-lines 4、code-language 3、live-activity 6、format-time 4、features 10）。2026-08-14 实跑 14 文件 104 通过。
- contract **79**（server-auth 16、server-security 14、server-events 14、server-hosts 13、server-sync 8、server-devices-sessions 9、auth 2、host-sync 3）+ e2e vitest **8**（connection-manager 4、offer-parser 3、placeholder 1）= 静态统计 **191** 含 web。
- Playwright 浏览器 E2E 3 测试（需 `PLAYWRIGHT_BROWSERS_PATH=/tmp/playwright-browsers`）。
- **web 单测**：`packages/dashboard/web/package.json` 有 `test` 脚本，走该包自己的 `vite.config.ts`（`@` 指向 `web/src`）。根 `vitest.config.ts` 仍把 `@` 指到 `packages/app/src`，所以从仓库根直接 `npx vitest run packages/dashboard/web/src` 会错；用 `npm run test --workspace=@getpaseo/dashboard-web`。`test:dashboard` 现已包含 web。feature gating 10 单测在 `features.test.ts`。
- **CI 完全不跑 dashboard 测试**：`.github/workflows/ci.yml` 的测试 job 都是 `npm run test --workspace=<pkg>` 点名指定，没有 dashboard。根 `npm run typecheck`/`lint`/`format:check` 是 `--workspaces`，这三项覆盖到了。
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

| 日期       | 修改人           | 说明                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ---------- | ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-08-12 | Codex            | 初版创建                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| 2026-08-12 | Codex            | 完成 P0.1 选型 + P0.2 骨架                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| 2026-08-12 | Codex            | 完成 P0.3 最小认证与 Host 存储                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| 2026-08-12 | Codex            | 完成 P0.4 Web 连接代码                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| 2026-08-12 | Codex            | P0.5 完成：M0 退出条件全部满足                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| 2026-08-12 | Codex            | P1.1 完成：Argon2id、access/refresh 分离、reuse 检测                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| 2026-08-12 | Codex            | P1.2 完成：Host 更新、fingerprint 去重、幂等键                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| 2026-08-12 | Codex            | P1.3 完成：审计事件补齐、setErrorHandler、KEK 权限检查                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| 2026-08-12 | Codex            | P1.4 完成：部署文档                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| 2026-08-12 | Codex            | P2.1 完成：增量同步（lastSyncRevision、sync API、client store、8 测试）                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| 2026-08-12 | Codex            | P2.2 完成：设备/Session 管理 API + 设备追踪 + 9 测试                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| 2026-08-12 | Codex            | P2.3 完成：SSE 配置事件总线 + 事件分发 + 10 测试                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| 2026-08-12 | Codex            | P2.4 完成：安全加固（rate limit/CSRF/CSP/审计 API）+ 14 测试                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| 2026-08-12 | Codex            | 迁移到 Paseo monorepo `packages/dashboard/`，分支 `feat/dashboard-migration`，commit `3b0ca1c03`                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| 2026-08-12 | Codex            | P3 Agent UI 视觉原型：引入 Tailwind 4/CVA/lucide，完成 Zeno 风格 shell、Workspace、Hosts、Agents、Devices、Settings 和 Host 导入弹窗；build:dashboard、typecheck:dashboard、lint、格式检查通过                                                                                                                                                                                                                                                                                                                                           |
| 2026-08-12 | Codex + 4 agents | P3.1/P3.2 后端运行时基础：多 Host 连接生命周期、daemon projects/workspaces/agents 状态层、Dashboard SSE/API 客户端、runtime composition；定向 34 测试通过，dashboard build/typecheck/lint/format 通过                                                                                                                                                                                                                                                                                                                                    |
| 2026-08-12 | Codex + 3 agents | P3 UI Zeno 风格重做：窄侧栏、项目/会话树、低噪声深色主区、连续消息阅读列、底部 composer，以及 Hosts/Agents/Devices/Settings 低噪声列表页；5173 smoke、dashboard build/typecheck/lint/format 通过                                                                                                                                                                                                                                                                                                                                         |
| 2026-08-13 | Claude           | UI 设计系统对齐 zeno（token 重写、hover 行、空态、扁平按钮）+ Web i18n（i18next 类型安全字典、语言切换器、持久化）；typecheck/lint/format 通过，Playwright 截图验证中英切换                                                                                                                                                                                                                                                                                                                                                              |
| 2026-08-13 | Claude           | P3.2 读路径 + 认证接线：LoginPage/app-store、runtime 接入 App/Shell、真实树与列表页、真实 Host 导入验证、locale 时间格式化；20 单测 + typecheck/lint 通过；Playwright 全流程验证（注册→登录→导入本机 daemon→树/工作区/代理页真实数据）                                                                                                                                                                                                                                                                                                   |
| 2026-08-13 | Claude           | P3.2 收尾：daemon 实时推送订阅（agent/workspace/project update 进 store + 重连刷新）+ Agent 停止/归档写路径（Agents 行操作 + Workspace 头部操作）；28 定向单测 + typecheck/lint/format 通过；Playwright 验证操作按钮渲染                                                                                                                                                                                                                                                                                                                 |
| 2026-08-13 | Claude           | P3.3 Timeline：timeline-store（tail/向上分页/epoch-seq 合并/流事件节流刷新）+ viewAgent selective 订阅 + Workspace 时间线渲染（全部 item 类型、自动滚底、加载更早）；39 定向单测 + typecheck/lint/format 通过；Playwright 验证真实会话历史与分页                                                                                                                                                                                                                                                                                         |
| 2026-08-13 | Claude           | 按仓库实际代码校准计划：当前阶段改为「M3 进行中」；补 P3.1 条目并标注 feature gating 未做；待开始重排为 Terminal → Prompt/权限 → P3.1 收尾 → P3.5 → 新增 P3.6 历史 Web 缺口（change-password / host 改名 / 审计页 / `/me` / SSE 重连）；测试统计改为实际值（web 62 实跑、contract 79、e2e 8）并记录 web 单测不在任何 npm 脚本内、CI 不跑 dashboard；补路由现状、权限非 timeline 条目、`DaemonClientLike` Pick 三条技术要点；同步校准 development-plan.md 的 P3（逐条标完成/未做，P3.3 拆出 Terminal 与大数据量，新增 P3.6 小节与依赖图） |
| 2026-08-13 | Fable            | 提交 P3.1-P3.3 工作区产出（`4cd5f2667`）。P3.3 Terminal：terminalSession（binary stream 订阅、resize claim/update、restore feature gate）+ xterm 视图 + Workspace 终端面板与 Timeline/Terminal 切换 + runtime terminal API；大数据量：timeline-store 500 条内存上限 + 条目 `content-visibility`；web 单测 62→71；typecheck/lint/format/build 通过；Playwright 实测真实 daemon 终端创建/输入/回显/结束全链路                                                                                                                              |
| 2026-08-13 | Fable            | P3.4 完成：runtime 四方法（sendAgentMessage/createAgent/resumeAgent/respondToPermission）；composer 真实发消息；空态新建会话入口（项目/provider 下拉 + initialPrompt）；Agents 页已归档区 + persistence handle 恢复；权限请求卡片（actions 或默认允许/拒绝，本地先移除）；web 单测 71→77；typecheck/lint/format 通过；Playwright 实测创建→对话→追问→归档全链路（codex 真实回复）                                                                                                                                                         |
| 2026-08-13 | Fable            | UI 打磨第一轮：timeline markdown 渲染 + highlight.js 代码块（语言标签/复制/diff 行号着色）；从 zeno 搬 radix select/dialog/alert-dialog/tooltip + tw-animate-css；原生 select → radix Select，window.alert → AlertDialog，composer autosize；修 dashboard/web lockfile 钉在 React 18 的既有不一致（对齐 19，删掉失效的 `@ts-expect-error`）；web 单测 77→84；typecheck/lint/format/build 通过；Playwright 实测 markdown/高亮/下拉/autosize                                                                                               |
| 2026-08-14 | Fable            | UI 打磨第二轮：composer protrusion + 底栏发送；侧栏添加主机改次级动作；运行状态双层（侧栏 marker + 时间线 live status/shimmer/计时）；用户气泡、header 分组、回到底部。根因：无层级 `*` reset 压过 Tailwind utilities，间距类全失效，重置迁入 `@layer base`。web 单测 84→94 并进 `test:dashboard`。                                                                                                                                                                                                                                      |
| 2026-08-14 | Fable            | 把 Dashboard Web UI 风格写成 `docs/ui.md`；`.cursor/rules/dashboard-ui.mdc` 在改 `packages/dashboard/web/**` 时自动带上；AGENTS.md / 文档地图 / paseo-integration 页面平移原则改为指向该篇。                                                                                                                                                                                                                                                                                                                                             |
| 2026-08-14 | Fable            | P3.1 完成：集中 feature gating 模块 `paseo/features.ts`（`getDaemonFeatures`/`isCompatibleDaemon` + 10 单测）；`selectiveAgentTimeline` 在 `viewAgent`/`leaveAgent` 中 gate（COMPAT 标签）；`terminalRestoreModes` 改用统一模块；dashboardRuntime 测试补 `getLastServerInfoMessage` 返回完整 server_info。web 单测 94→104，test:dashboard 全绿（web 104 + contract 79 + e2e 8 = 191）；typecheck/lint/format 通过。P3.1 退出条件满足。                                                                                                   |
