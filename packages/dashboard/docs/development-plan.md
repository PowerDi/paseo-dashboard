# 开发计划

本文档将 `roadmap.md` 的里程碑拆解为可执行的任务序列，标注依赖、产出与验证方式。时间估算不是承诺；每个任务先满足退出条件再进入下一任务。

## 执行原则

- 每个里程碑开始前先阅读 `architecture.md` 的对应部分，确认边界不变。
- 所有安全相关任务必须同时编写负向测试（越权、撤销、重放、日志泄露、缓存泄露、并发冲突）。
- 数据面边界不可突破：Dashboard 服务端不连接 Relay/daemon，不接收 agent 数据。
- 阶段划分按依赖顺序，不提前做未开放决策（见 `open-decisions.md`）。

## P0：项目骨架与 M0 验证

> 对应 `roadmap.md` M0。目标：证明“配置一次，第二浏览器直接经 Relay/E2EE 连接 daemon”，并确定技术选型。

### P0.1 技术选型（先做，阻塞后续）

**任务**

1. 决定后端语言/框架：需支持结构化日志 redaction、成熟 session/CSRF、AEAD/KMS 集成。
2. 决定数据库：单机 M1 用 SQLite，多用户/并发 revision 用 PostgreSQL；schema 必须可迁移。
3. 决定 Web 框架：独立选择，不引入 Expo Router / React Native store / Paseo App 页面。
4. 决定 Web session 形态：Web 用 opaque HttpOnly Cookie，Harmony 用 bearer + rotating refresh token。

**产出**

- 更新 `open-decisions.md`，将已定决策移到 `architecture.md`。

**验证**

- 三个应用（web/server/contracts）均可独立构建。
- server 不依赖 daemon client 相关包。

### P0.2 初始化项目结构

**任务**

1. 初始化 `packages/contracts`：定义 API 请求/响应类型、错误 code、Host sync 格式。
2. 初始化 `server`：最小 HTTP 服务、配置加载、日志 redaction 框架接入。
3. 初始化 `web`：路由、状态管理、设计系统基础骨架。
4. 初始化 `tests/contract` 与 `tests/e2e` 的测试框架。

**产出**

- API contract 类型定义（`packages/contracts`）。
- 三个应用的构建脚本。

**验证**

- `tests/contract` 能对最小 fixture 断言。

### P0.3 最小认证与 Host 存储

**任务**

1. 实现注册、登录、获得 session 的最简路径（可通过临时持久层）。
2. 实现 Host 导入 API 的最简路径：结构校验 + envelope encryption 存储。
3. 实现 Host sync API 的最简路径：按账号 revision 返回 Host 列表。

**产出**

- 可运行的本地 Dashboard API（临时持久层）。

**验证**

- 数据库中的 capability 为密文，日志无 offer/token 原文。
- API 响应设置 `Cache-Control: no-store`。

### P0.4 Web 端连接验证

**任务**

1. 在 web 中集成 `@getpaseo/client` 与 `@getpaseo/protocol`，验证 Web build 可用。
2. 实现最小 `PaseoConnectionManager` 接口（`connect`/`disconnect`/`getState`/`subscribe`/`getDaemonClient`）。
3. 实现浏览器 A：解析测试 offer → 直接连接 Relay/E2EE → 获取 `server_info` → 提交规范化 capability。
4. 实现浏览器 B：登录 → Host sync → 使用返回配置连接 daemon。

**产出**

- 最小可运行的端到端流程（浏览器 A 配置，浏览器 B 连接）。

**验证**

- 第二浏览器无需重新 pairing 即完成 E2EE handshake。
- Dashboard 服务端没有到 Relay/daemon 的 socket，无 agent 数据请求。
- 独立 Web build 不依赖 Paseo App 源码。

### P0.5 M0 退出条件确认

**任务**

1. 检查 Dashboard、反向代理、数据库、日志 fixture 中无 offer/token/完整 connection 原文。
2. 验证 `@getpaseo/client` 覆盖范围：连接、重连、`server_info`、projects、workspaces、agents、timeline、terminal、prompt、权限。
3. 记录官方 client 缺口清单，决定哪些由 Dashboard connection manager 补齐。

**产出**

- 官方 client 功能覆盖矩阵。
- M0 退出条件检查报告。

**验证**

- 所有 M0 退出条件满足（见 `roadmap.md`）。

## P1：单用户自托管 MVP（M1）

> 对应 `roadmap.md` M1。目标：单用户在两浏览器完成登录、同步和删除 Host。

### P1.1 完整认证与会话

**任务**

1. 注册策略：首个用户注册后关闭公开注册。
2. 密码：Argon2id 哈希，参数按部署基准配置。
3. Session：access token 短时有效，refresh token 高熵、单次轮换、服务端只存哈希。
4. Refresh token reuse 检测：撤销整个 token family。
5. 修改密码：撤销其他 session，轮换当前 refresh token。
6. 忘记密码：不提供邮件找回。未来按 `security.md` 的恢复边界设计本地管理员 recovery code/CLI。
7. 登出：撤销当前 session。

**产出**

- 完整认证 API（`/api/v1/auth/*`）与 Web 登录、注册和修改密码页面。

**验证**

- 负向测试：revoked session 不能 refresh/sync；reuse 检测生效。
- 登录错误不暴露账号是否存在。

### P1.2 Host 完整生命周期

**任务**

1. 粘贴 offer 流程：前端读取 URL fragment → Paseo parser 校验 → 立即移除 fragment → 客户端连接验证 → 用户命名 → 提交服务端。
2. 扫码流程：浏览器支持时本地扫码（不上传图像），始终保留粘贴回退。
3. 服务端：结构校验（不连接 daemon）、envelope encryption 持久化、审计写入。
4. Host 列表、更新（乐观并发）、删除（tombstone）。
5. 同步：账号级 `syncRevision`，增量 sync 语义（MVP 可先全量，但保留 revision 语义）。

**产出**

- Host 完整 CRUD + 同步 API，Web 端 Host 列表/添加/设置页面。

**验证**

- 两个浏览器登录同一账号，A 配置后 B 直接看到 Host。
- 并发更新返回确定 409，不静默覆盖。
- 删除 Host 后其他在线设备收到 tombstone。

### P1.3 存储加密与审计

**任务**

1. Envelope encryption：随机 256-bit DEK，AEAD 加密 capability JSON，AAD 含 schema/user/host/keyVersion。
2. KEK 来源：KMS/secret manager 或独立 32-byte key file；启动时拒绝缺失/权限过宽。
3. 审计事件：注册/登录失败聚合/密码变更/Host 导入删除/账户删除/设备撤销。
4. 日志 redaction：字段 allowlist，错误对象在进入 logger 前 redact。

**产出**

- 加密存储模块、审计事件表、日志 redaction 中间件。

**验证**

- 数据库 dump 无 KEK 不能恢复 capability。
- 日志/错误追踪/APM fixture 无 offer/token/完整 connection 原文。

### P1.4 部署与恢复

**任务**

1. 部署文档：反向代理、TLS、CSP、备份加密与恢复演练。
2. KEK 管理文档：启动检查、备份恢复说明。

**产出**

- `docs/deployment.md`（新增）。

**验证**

- 按文档可恢复备份；KEK 缺失时启动失败并有明确提示。

## P2：多设备登录与 Host 同步（M2）

> 对应 `roadmap.md` M2。目标：多设备并发修改、删除、离线恢复时状态最终一致。

### P2.1 增量同步与冲突

**任务**

1. 实现账号级 revision 单调递增，每个 Host mutation 同一事务写变更。
2. 增量 sync API：`after` 游标、`limit`、`hasMore`、幂等应用。
3. Tombstone 保留策略：至少保留到所有活跃设备确认的 revision 超过删除 revision，另设最长保留期。
4. 冲突检测：更新请求携带 `baseVersion`，冲突返回 409。

**产出**

- 完整增量同步语义（`/api/v1/host-sync`），客户端同步状态机。

**验证**

- 三设备并发修改/删除/离线恢复后状态最终一致。
- 长期离线设备回来时可强制全量 resync。

### P2.2 设备与 Session 管理

**任务**

1. 设备模型：`installationIdHash`（不使用硬件唯一 ID）、名称、平台、首/末次在线。
2. 设备列表与远程撤销 API。
3. Session 列表与撤销 API。
4. Web 端设备/session 管理页面。

**产出**

- `/api/v1/devices`、`/api/v1/sessions` 及对应页面。

**验证**

- 撤销设备后该设备全部 session 失效；已下载 capability 仍可直接连接（UI 明确提示限制）。

### P2.3 实时配置事件

**任务**

1. 用 SSE/WebSocket 承载多标签页配置事件（仅 Dashboard 配置事件，不承载 daemon 数据）。
2. 服务端事件推送：Host 变更、设备撤销、session 撤销。

**产出**

- 配置事件通道（与 daemon 数据面分离）。

**验证**

- 网络断言证明该通道只承载配置事件，无 agent 数据。

### P2.4 安全加固

**任务**

1. 完整 rate limit（登录/注册/重置/导入按 IP、账号、设备维度）。
2. CSRF token 或严格 same-origin + Origin 校验。
3. CSP：`default-src 'self'`，明确 `connect-src`，禁止不受控第三方脚本。
4. 审计查询 API（`/api/v1/audit-events`，cursor 分页）。

**产出**

- 安全中间件与审计查询 API。

**验证**

- 越权访问其他用户 Host/审计返回统一 404/403。
- XSS 测试覆盖 URL fragment 和二维码内容。

## P3：主要 Paseo 功能实现（M3）

> 对应 `roadmap.md` M3。目标：登录后完成目标清单中的主要 daemon 操作。

进度以 `progress.md` 为准，本节只标到子任务粒度（截至 2026-08-13）。

### P3.1 Connection Manager 完善

**已完成。**

**任务**

1. ~~完善 `PaseoConnectionManager`：多 Host 连接管理、重连策略、状态订阅。~~ 完成。
2. ~~登出/删除 Host/session 失效时清理本地连接和 capability。~~ 完成。
3. 使用 `server_info.features.*` 的 capability gate 决定功能显示。**完成**：`paseo/features.ts` 提供 `getDaemonFeatures(serverInfo)` 集中提取 feature flags；`selectiveAgentTimeline` 在 `viewAgent`/`leaveAgent` 中 gate（COMPAT 标签）；`terminalRestoreModes` 在 `terminalSession.ts` 中 gate（已有 COMPAT 标签）。10 单测覆盖。

**产出**

- 全局连接管理模块（页面不直接创建 `DaemonClient`）。
- Feature detection 模块 `paseo/features.ts`。

**验证**

- 官方 client 缺口清单中的项由 connection manager 补齐并通过测试。
- Feature gating 在需要的地方生效（selective timeline 和 terminal restore modes）。

### P3.2 Agent 主面板

**任务**

1. ~~Project / Workspace 列表与切换。~~ 完成。
2. Agent 列表、创建、停止、恢复、归档。**全部完成**（创建与恢复在 P3.4 落地：新建会话 composer + Agents 页归档区恢复入口）。
3. ~~Agent 实时输出订阅与页面状态管理。~~ 完成（`agent_update`/`workspace_update`/`project.update` 订阅 + 重连补拉）。
4. ~~路由（`roadmap.md` M3 范围里的「路由」）：~~ 完成。`navigation/routes.ts` 集中解析 URL，`App.tsx` 以 pathname 作为页面与 agent 选择的唯一来源。页面路径是 `/workspace`、`/hosts`、`/agents`、`/devices`、`/audit`、`/settings`；agent 深链是 `/agent/:hostId/:agentId`。

**产出**

- Agent 主面板页面。

**验证**

- 使用官方 client 调用 daemon 成功；页面状态与 daemon 事件一致。

### P3.3 Timeline 与 Terminal

**任务**

1. ~~Timeline：daemon timeline 消息的展示与分页。~~ 完成（tail + `before` 分页、epoch/seq 切割合并、7 种条目类型全渲染）。
2. ~~Terminal：使用现有 daemon binary frame 规则，自行实现 Web terminal 页面。~~ 完成（`paseo/terminalSession.ts` 订阅/输入/resize claim-update/退出 + `components/terminal-view.tsx` xterm 渲染 + Workspace 头部 Timeline/Terminal 切换 + 终端列表创建/结束）。restore 走 `features["terminal-restore-modes"]` gate，无 feature 时回退 snapshot 帧。
3. ~~大数据量处理：分页、虚拟滚动、内存上限。~~ 完成：分页（已有）+ 条目内存上限（timeline-store 每 agent 500 条，裁掉的历史经 `startCursor` 回翻）+ 渲染上限（timeline 条目 `content-visibility: auto` 跳过屏幕外渲染，未引入虚拟列表库——条目数已被内存上限约束）。

**产出**

- Timeline 与 Terminal 页面。

**验证**

- 参考 Paseo `docs/timeline-sync.md`、`docs/terminal-performance.md` 与对应 client 源码实现并通过测试。

### P3.4 Prompt 与权限请求

**已完成。**

**任务**

1. Prompt 输入区：通过 client 发送（`sendMessage`/`sendAgentMessage`），并补上 P3.2 遗留的 `createAgent`/`resumeAgent` 入口。**完成**：Workspace composer 接 `runtime.sendAgentMessage`（Enter 发送）；空态 composer 变成新建会话入口（`components/new-session-composer.tsx`：主机·项目选择 + provider 选择 + initialPrompt → `runtime.createAgent`，成功后自动选中新 agent）；Agents 页新增「已归档」区，带 `persistence` handle 的条目可恢复（`runtime.resumeAgent` 走 handle，恢复后选中返回的快照 id）。
2. 权限请求：订阅并响应 daemon 权限消息。**完成**：`components/permission-requests.tsx` 渲染 agent 快照的 `pendingPermissions`。按钮请求沿用 provider 的 `actions`；question 请求解析 `input.questions`，支持单选、多选、自由输入、可选空回答并把结果写入 `updatedInput.answers`；plan、shell、edit 等请求先展示审批上下文；Claude `suggestions` 显式提供「允许并记住」。点击走 `runtime.respondToPermission`，内部使用 `respondToPermissionAndWait` 等待 daemon 的 `agent_permission_resolved`，失败保留卡片和内联错误，成功后本地移除并由 `agent_update` 广播兜底。权限卡片渲染在 timeline 末尾，未按 timeline 条目建模。

**产出**

- Workspace composer（发消息 + 新建会话）、权限请求卡片、Agents 页归档区与恢复入口；runtime 新增 `sendAgentMessage`/`createAgent`/`resumeAgent`/`respondToPermission` 四个方法（`DaemonClientLike` Pick 同步扩展）。

**验证**

- runtime 与 question response 的单测覆盖 daemon resolved/error、provider action id、计划正文、问题表单序列化和 permission suggestions。Playwright QA fixture 用 Codex plan、Claude shell + suggestions、OpenCode/Claude question 三种真实协议形状验证深色/亮色渲染和问题提交；真实 daemon + provider 的审批触发按 2026-08-16 决定后置，不阻塞 M3。创建→对话→追问→归档链路已用真实 daemon + codex 验证。

### UI 交互打磨（对齐 zeno 结构，不改协议）

**已完成第一、二轮。** 不进 roadmap 编号；缺的是 UI，不是 RPC。约定见 [`docs/ui.md`](./ui.md)。

**第一轮**：markdown / 代码高亮 / radix Select·Dialog / AlertDialog 替换 `window.alert` / autosize textarea。见 `progress.md`。

**第二轮**：

1. Composer 改成 protrusion 条焊在输入卡片上，发送按钮独立成底栏，不再和文字抢同一行。
2. 侧栏「添加主机」从导航行改成带虚线方标的次级动作。
3. 运行状态两层：侧栏 `SessionStatusMarker`（running 转圈 / error 红叉 / idle 点）；时间线末尾 `TimelineLiveStatus`（shimmer「正在回复…」或工具摘要 + 计时）。phase 从最新 timeline 条目推断，因为 daemon 只报 running/idle/error。
4. 用户消息右对齐气泡；header 状态 / Timeline·Terminal / 操作分成三组；上翻时出「回到底部」按钮。
5. **层叠修复**：`globals.css` 的 `* { margin: 0; padding: 0 }` 原先在 layer 外，按 CSS 规则无层级样式恒定压过 `@layer utilities`，全站 `p-*`/`m-*`/`space-y-*` 静默失效（权限卡片 `p-3.5` 计算值是 `padding: 0`）。重置迁入 `@layer base`。组件类留在 layer 外，继续压过 utilities。

**验证**：`deriveLiveActivity` 6 单测 + `formatElapsed` 4 单测。盒模型实测权限卡片 padding 0→14px。Playwright 确认 protrusion composer、运行中会话末尾 live status 计时在走。

### P3.5 兼容性测试

**已完成。** 随 commit `4638617ce` 提交。

**任务**

1. ~~建立 daemon 版本矩阵（新旧 daemon × 新 client）。~~ 完成：v0.1.80 / v0.1.81 / v0.1.106 三个版本覆盖 feature detection、兼容性判断与 gating 行为。
2. ~~主要功能兼容 smoke tests。~~ 完成：15 个 vitest 用例在 `tests/e2e/src/compatibility.vitest.test.ts`。
3. ~~新功能使用 `server_info.features.*` gating，不使用未标记 fallback。~~ 完成：`selectiveAgentTimeline` 与 `terminal-restore-modes` 两处 gate，COMPAT 标签在代码站点。`docs/compatibility-matrix.md` 记录矩阵与添加新 gate 流程。

**产出**

- 兼容测试套件与版本矩阵记录。

**验证**

- 旧 daemon 经现有 protocol compatibility 工作；无能力依赖未标记 fallback。

### P3.6 历史 Web 缺口补齐

**已完成。** 随 commit `4638617ce` 提交。M1/M2 里服务端和 contract 测试做完、Web 端从未接上的部分。这些子任务当时按服务端交付就记为完成，所以要单列出来，不要重复整个 P1/P2。

**任务**

1. `POST /auth/change-password`（P1.1）：Web 端没有 client 方法也没有页面。
2. `PATCH /hosts/:id` 改名（P1.2）：带 `baseVersion` 的乐观并发 409 路径 Web 端从未调用过。
3. `GET /audit-events`（P2.4）：`product-requirements.md` 里「审计记录」是独立页面，现在没有。
4. `GET /me`：`app-store` 靠 localStorage 缓存 user，刷新后显示的是缓存值。
5. SSE 重连（P2.3）：server 已发 `id:` 并支持 `Last-Event-ID`，`dashboardEvents.ts` 能解析 id 但从不回传，也没有重连循环。流断掉（代理超时/网络抖动）后 Host 配置更新静默停止，直到用户刷新页面。
6. 测试可达性：已修好，`web/package.json` 有 `test` 脚本，`test:dashboard` 三个包都跑。CI 不跑 dashboard 测试是有意的决定，不要加。

**产出**

- 上述路由的 Web client 方法与页面；SSE 断线自动恢复。

**验证**

- 每项都有 Web 端调用路径的测试；改名冲突走 409 分支；断开 SSE 后配置更新能自动恢复且不重复消费事件。

### P3.7 新增功能（当前优先级）

M3 退出条件已满足，以下是对照 `DaemonClient` 完整 API 后发现的 UI 层缺口。各项优先级由用户按实际情况决定。

**任务**

1. **文件浏览器**：`listDirectory`、`readFile`、`writeFile`、`createFileEntry`、`renameFileEntry`、`duplicateFileEntry`、`deleteFileEntry`、`uploadFile`、`requestDownloadToken`、`subscribeFile`。用户无法从 Dashboard 查看 agent 正在修改的文件。
2. **Git 操作**：`checkoutRefresh`、`checkoutPull`、`checkoutPush`、`checkoutCommit`、`checkoutMerge`、`checkoutMergeFromBase`、`checkoutSwitchBranch`、`checkoutPrCreate`、`checkoutPrMerge`、`checkoutForgeSetAutoMerge`、`checkoutGithubSetAutoMerge`、`checkoutPrStatus`、`pullRequestTimeline`、`checkoutDiscardChanges`、`stashSave`、`stashPop`、`stashList`、`validateBranch`、`getBranchSuggestions`、`subscribeCheckoutDiff`、`unsubscribeCheckoutDiff`、`searchForge`、`searchGitHub`、`renameBranch`。WorkspacePage 只展示 `currentBranch`，不能操作。
3. **Workspace/Project 管理**：`createWorkspace`、`createPaseoWorktree`、`archivePaseoWorktree`、`getPaseoWorktreeList`、`archiveWorkspace`、`inspectWorkspaceRecovery`、`restoreWorkspace`、`setWorkspaceTitle`、`setWorkspacePinned`、`renameProject`、`setProjectIcon`、`removeProject`、`addProject`、`openProject`、`createProjectDirectory`、`cloneGithubProject`、`searchGithubRepositories`、`startWorkspaceScript`、`stopWorkspaceScript`、`listWorkspaceScripts`。侧栏树展示 project/workspace 列表但不能增删改。
4. **Agent 高级操作**：`deleteAgent`（彻底删除，非归档）、`detachAgent`、`updateAgent`（更新标题等元数据）、`importAgent`、`rewindAgent`（回退到某条消息，conversation/files/both）、`fetchAgentHistory`、`fetchRecentProviderSessions`、`listCommands`。
5. **Provider/Model 详情**：`listProviderModels`、`listProviderModes`、`listProviderFeatures`、`listAvailableProviders`、`refreshProvidersSnapshot`、`getProviderDiagnostic`、`listProviderUsage`、`getDaemonConfig`、`patchDaemonConfig`、`readProjectConfig`、`writeProjectConfig`。当前只有 `getProvidersSnapshot` + `applyAgentConfig` model 切换。
6. **定时任务**：`scheduleCreate`、`scheduleUpdate`、`scheduleDelete`、`scheduleList`、`scheduleInspect`、`schedulePause`、`scheduleResume`、`scheduleRunOnce`、`scheduleLogs`。完全无 UI。
7. **扫码导入**：`product-requirements.md` 要求浏览器支持摄像头扫码读取 pairing offer，不支持时回退粘贴。当前 `ImportHostModal` 只支持粘贴文本。
8. **Daemon 管理**：`getDaemonStatus`、`getDaemonPairingOffer`、`collectDiagnostics`、`connectHub`、`getHubStatus`、`disconnectHub`。
9. **其他**：`captureTerminal`（终端截图）、`closeItems`（批量关闭 tab）、`clearAgentAttention`、`clearWorkspaceAttention`、`sendHeartbeat`、`measureLatency`、`ping`、`registerPushToken`、`unregisterPushToken`。多 agent 同时查看（当前只能看一个）。

**执行顺序**

| 子阶段         | 先交付的功能                 | 范围与边界                                                                      | 退出条件                                                           |
| -------------- | ---------------------------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| P3.7.1（完成） | 文件浏览器只读基础           | `listDirectory`、`readFile`、`subscribeFile`；先不开放写入、删除和上传          | 能浏览项目目录、打开文本文件、看到文件变更；路径校验和错误态有测试 |
| P3.7.2         | Git 状态与差异               | `checkoutRefresh`、分支/状态展示、diff、`subscribeCheckoutDiff`、PR 状态/时间线 | Workspace 能查看当前分支和变更；不引入写操作确认前的 push/merge    |
| P3.7.3         | Workspace/Project 管理       | project/workspace 新建、打开、改名、归档、置顶；脚本先只展示状态                | 侧栏树可完成基本管理，恢复和归档语义有合同测试                     |
| P3.7.4         | Agent 高级操作               | 删除、detach、标题更新、历史/回退；高风险动作逐项确认                           | 不影响现有归档/恢复语义，危险操作有明确反馈                        |
| P3.7.5         | Provider/Model 详情          | provider、model、mode、feature、诊断和 usage；配置写入单独评审                  | Model 配置路径有 feature gating 和调用测试                         |
| P3.7.6         | 定时任务、扫码和 daemon 管理 | schedule、摄像头 pairing、daemon 状态/诊断；按独立页面拆分                      | 每个模块有 API contract、失败态和权限边界验证                      |

P5.1 Harmony Runtime 暂缓，不改变 P4.4 的审查结论。P3.7.2 继续保持只读，不并行实现文件写入、Git push/merge 或 Host 分享。

**产出**

- 各功能模块的页面、组件和 runtime 方法；每个新增 RPC 调用经过 `DaemonClientLike` Pick 扩展。

**验证**

- 每个子阶段都有 `DaemonClientLike` 调用路径测试、失败态测试和 feature gating；feature gating 按 `docs/compatibility-matrix.md` 流程添加。
- 文件、Git 和 pairing 数据不进入普通日志、APM body capture 或错误消息；写操作使用显式确认和可恢复错误。
- Web 完成真实浏览器验证后，再评估 native/Harmony 是否需要独立适配。

## P4：多用户与设备安全（M4）

> 对应 `roadmap.md` M4。目标：租户隔离、key rotation、注册/登录防御。

### P4.1 多用户（完成）

**任务**

1. **完成**：开放注册、admin/member 角色与 admin 邀请已完成。邀请绑定邮箱、限时、单次使用，服务端只存 token 哈希；邮箱验证不在产品范围，认证边界见 `security.md`。
2. ~~租户隔离：所有 Host/API 的越权测试覆盖。~~ **完成**：Host import/list/update/delete、Host sync、Session、Device、SSE 和审计均有跨用户合同；认证边界额外拒绝 locked/deleted user、revoked device 和 session/device 所属不一致。
3. **完成**：注册、登录、refresh 与 Host 导入 abuse tests 已完成。邮件找回和公开重置密码 endpoint 不在范围内；未来若增加本地恢复入口，按其凭据和调用边界单独设计防护。

**产出**

- 多用户注册与隔离测试。

**验证**

- 任何用户不能读取/修改其他用户 Host。

### P4.2 强认证与风险提示（部分完成）

**任务**

1. **完成**：Web Passkey/WebAuthn 注册、登录、列表和删除；密码登录继续保留。
2. **完成**：session/device 保存截断 IP、User-Agent 摘要和认证方式，并在设备页展示。
3. **暂缓**：风险登录和新设备提示。2026-08-16 按用户决定不进入当前实现。

**产出**

- discoverable Passkey 登录、当前密码保护的注册流程、credential 管理和审计增强。
- session/device 登录环境审计。

**验证**

- Passkey 与密码登录共存；真实 P-256 assertion、错误密码、错误 origin、跨 session challenge、重放和跨用户删除均有合同测试。
- Passkey ceremony 有独立 IP/credential 限流测试。

### P4.3 生产密钥管理（完成）

**任务**

1. **完成**：版本化 `KeyProvider`，支持独立 file key 和 AWS KMS data key；production file 模式缺少显式 key 时拒绝启动。
2. **完成**：在线 key rotation。active 原子切换后，新写入使用新版本；旧版本 decrypt-only，逐条重包 `encryptedDek` 后 retired；中断状态可继续。
3. **完成**：file/AWS KMS 恢复路径和隔离恢复演练写入部署文档。

**产出**

- `encryption_key_versions` registry、加密 fingerprint secret、admin rotation/status API 和审计事件。
- AWS KMS provider 与 file provider 轮换工具。

**验证**

- 合同测试覆盖 file 在线轮换、旧 key 退休后恢复、旧数据库迁移、中断轮换继续、AWS KMS 密文 reference 重启解密和轮换接口限流。

### P4.4 HostGrant 模型审查（完成）

**任务**

1. **完成**：确定 `HostGrant` 的主体、角色、生命周期、撤销和历史约束；不创建表或启用分享语义。
2. **完成**：确认 Host 身份继续由 `hosts.ownerUserId` 定义，未来分享只通过 grant 扩展。

**产出**

- 架构文档中的 HostGrant 逻辑模型：owner 不落 grant 行，active grant 按 Host/用户唯一，撤销保留历史。
- 安全边界：admin 不自动获得 Host capability，`operator`/`viewer` 等待 daemon per-client scope、credential 和 revoke 支持。
- 明确 sync projection/outbox 是未来实现依赖，不能直接复用当前 owner-only sync 查询。

**验证**

- 文档明确 grant role 不能超出 daemon 实际能力；未新增分享 API、数据库表或 UI。

## P5：Harmony 客户端（M5）

> 对应 `roadmap.md` M5。目标：Harmony 使用同一 API 与同步格式完成 daemon 连接。

### P5.1 Runtime 验证

**任务**

1. 真机/模拟器验证：WebSocket binary frame、`ArrayBuffer`、安全随机数、文本编码、`tweetnacl`、npm package 打包。
2. 决定直接使用 `@getpaseo/client` 或编写 Harmony 运行环境适配。

**产出**

- Harmony runtime capability probe 结论（更新 `docs/paseo-integration.md`）。

**验证**

- 结论基于真机/模拟器事实，不按浏览器环境推测。

### P5.2 认证与安全存储

**任务**

1. Dashboard auth 集成：bearer access + rotating refresh，refresh token 存平台安全存储。
2. Host sync 集成。

**产出**

- Harmony 端认证与同步模块。

**验证**

- 与 Web 通过同一 API contract test；token 与 capability 存平台安全存储，日志无秘密。

### P5.3 Daemon 连接与最小 UI

**任务**

1. 复用 Paseo daemon connection core，完成 binary frame/E2EE 测试向量。
2. 最小 Host/Agent UI，再逐步扩展。

**产出**

- Harmony 最小可用客户端。

**验证**

- Harmony 用同步 capability 经 Relay 与 daemon 完成 E2EE。

## P6：可选高级能力（M6）

> 对应 `roadmap.md` M6。仅在退出条件满足后启动。

### P6.1 零知识 Vault

**任务**

1. 设计独立零知识架构（用户解锁秘密派生 vault key，服务端只保存密文）。
2. 恢复模型与新设备引导设计。

**验证**

- 经独立安全审查后上线；不叠加“半零知识”承诺。

### P6.2 Host 分享与 Protocol 演进

**任务**

1. 在 daemon credental 支持可撤销、可范围化后实现 Host 分享。
2. 向 Paseo 提议 daemon per-client credential/rotation/revoke 协议变更。

**验证**

- 单用户/设备可被 daemon 真正撤销，不要求轮换所有用户。

### P6.3 自托管 Relay 部署

**任务**

1. 独立 Relay 部署配置（逻辑与 Dashboard 独立）。

**验证**

- Relay 故障不影响 Dashboard 认证与配置管理。

## 依赖关系总览

```text
P0.1 选型 → P0.2 骨架 → P0.3 最小认证/存储 → P0.4 Web 连接验证 → P0.5 退出确认
   │
P1.1 认证 ──────────────▶ P1.2 Host 生命周期 ──▶ P1.3 加密审计 ──▶ P1.4 部署
   │
P2.1 增量同步 ──▶ P2.2 设备/session ──▶ P2.3 实时事件 ──▶ P2.4 安全加固
   │
P3.1 Connection Manager ──▶ P3.2 Agent 面板 ──▶ P3.3 Timeline/Terminal ──▶ P3.4 Prompt/权限 ──▶ P3.5 兼容
   │                                                                                      ▲
   └─ P3.1 任务 3（features gating）───────────────────────────────────────────────────────┘
P3.6 历史 Web 缺口（M1/M2 遗留，不阻塞 P3.2-P3.5，M3 退出前补齐）
   │
P3.7 功能缺口（M3 退出后识别，按实际优先级开发）
   │
P4.1 多用户 ──▶ P4.2 强认证 ──▶ P4.3 密钥管理 ──▶ P4.4 Grant 审查
   │
P5.1 Runtime 验证 ──▶ P5.2 认证/存储 ──▶ P5.3 连接/UI
   │
P6.1 零知识 ──▶ P6.2 分享/协议 ──▶ P6.3 自托管 Relay
```

## 关键验收口径（贯穿所有阶段）

- 每个阶段结束前运行 `tests/contract` 与 `tests/e2e`。
- 所有安全负向测试通过（越权、撤销、重放、日志泄露、缓存泄露、并发冲突）。
- 网络断言证明 Dashboard 域名无 timeline/terminal/prompt/daemon RPC 流量。
- 任何 UI 或文档不得暗示“删除 Host/撤销设备”已实现 daemon 层撤销。
