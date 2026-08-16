# 项目进展

> 快速接续备用文件。每次对话开始首先读此文件，然后按 `接续方式` 行动。
> 更新本文件：每次产出重要产出后（文档创建、代码提交、测试通过、架构变更）更新对应部分。

## 项目身份

- **项目**：Paseo Dashboard — Host 配置跨设备同步控制面，不代理 daemon 数据。
- **仓库**：Paseo monorepo fork — `git@github.com:PowerDi/paseo-dashboard.git`
- **代码位置**：`/root/workspace/code/paseo/packages/dashboard/`
- **Paseo 源码**：`/root/workspace/code/paseo/`（monorepo 根，作为行为事实来源）
- **当前阶段**：P4.3 生产密钥管理已完成；风险登录和新设备提示继续暂缓，下一阶段是 P4.4 HostGrant 模型审查。
- **当前分支**：`feat/dashboard-multi-user`。注册邀请策略和 abuse 防护已分别提交到 `0ac903003`、`f1082fe09`。

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
| `docs/local-development.md`    | 本地开发快速启动、Origin 校验、环境变量、常见问题（403/新建会话/Live Status）                | 本地开发与调试                     |
| `docs/compatibility-matrix.md` | Daemon 版本兼容矩阵、feature gating 列表、添加新 gate 流程、COMPAT 标签清理                  | 添加 feature gate 或验证版本兼容性 |

## 当前状态

### 权限卡片增强（2026-08-16，已提交）

- question 权限不再退化成允许/拒绝按钮：按 provider 的 `input.questions` 渲染单选、多选、自由输入和可选回答，提交 `updatedInput.answers`。
- plan、shell、edit 与其他 tool detail 在决策前展示；Claude `suggestions` 变成独立的「允许并记住」，不会随普通允许自动应用。
- provider `actions` 保留 action id、behavior、variant 与顺序；请求中的主按钮、危险按钮和次级按钮不在 Dashboard 重新发明。
- runtime 从 fire-and-forget `respondToPermission` 改为 `respondToPermissionAndWait`。daemon 拒绝或请求过期时卡片保留并显示内联错误；收到 `agent_permission_resolved` 后才本地移除。
- 新增 `permission-request-form.test.ts` 8 个用例，`dashboardRuntime` 新增失败保留请求用例。Playwright QA fixture 用 Codex plan、Claude shell + suggestions、question 三种真实协议形状完成深色/亮色截图和问题提交验证；没有把 fixture 留在仓库。

### P4.1 会话、租户与注册策略（2026-08-16，已完成）

- `requireAuth` 与 refresh 统一检查 session 对应的 active user、未删除账户、未撤销 device，并拒绝 session 指向其他用户 device 的不一致记录。
- Session 列表 join 同时按 `sessions.userId` 和 `devices.userId` 收口，避免坏数据把另一用户的设备名带入当前租户。
- Host import 的 idempotency key 和 capability fingerprint 明确只在账号内去重；不同用户导入同一 capability 不复用或泄露其他用户 Host。
- 真实 HTTP SSE 双用户连接验证事件按认证用户隔离；Host、Host sync、Session、Device、SSE 和审计的跨用户合同矩阵已覆盖。
- 首个有效用户为 admin，后续用户为 member；公开注册关闭时只接受 admin 签发的 email-bound、限时、单次邀请。同邮箱重发会撤销旧 token，原始 token 只返回一次且数据库只存哈希。
- 首用户判定、注册关闭判定、邀请消费和用户写入在同一个 `IMMEDIATE` 事务中；并发 bootstrap 只能成功一个管理员。
- `inviteToken` 与邀请创建响应 token 已加入日志脱敏。新增 11 个注册策略合同测试（含公开注册、并发 bootstrap 与旧库角色迁移）。
- rate limiter 从仅 IP 扩展为分层 bucket：注册/登录按 IP、normalized email、installation；refresh 按 IP、credential hash；Host 导入按 IP、认证账号。bucket identity 只存 SHA-256，query string 不能绕过路由限流，429 带 `Retry-After`。
- 新增 7 个 abuse protection 合同测试；当前 contract 测试为 106 个。邮件找回和公开重置密码 endpoint 不在产品范围内。

### P4.2 Passkey 与登录环境审计（2026-08-16，已完成当前范围）

- device/session 记录截断 IP、浏览器/操作系统摘要和 `password`/`passkey` 认证方式；设备与会话页面展示这些信息，不保存完整 User-Agent。
- Web 支持 discoverable Passkey 登录；设置页可在当前密码重新认证后注册、列出和删除 Passkey。密码登录继续保留。
- WebAuthn ceremony challenge 只存哈希、五分钟过期、单次消费；注册绑定当前 user/session，验证强制 RP ID、origin、user verification 和 signature counter。
- 服务端只保存 credential id、公钥、counter、transport、device type 和 backup state；WebAuthn response 加入日志脱敏。
- Passkey options/verify 加入 IP 与 credential bucket。新增 6 个合同测试和 2 个 Web 单测；contract 106→112，web 128→130，静态总数 257→265。
- 风险登录和新设备提示按 2026-08-16 的决定暂缓；本轮只记录 `newDevice` 审计事实，不弹提示。

### 亮色主题视觉验证（2026-08-16）

- Playwright 临时 fixture 同屏渲染 TypeScript code block、diff 和真实 xterm `TerminalView`，分别截取深色/亮色主题。
- 两个主题均无 page error；代码语法色、diff 增删与 hunk、terminal 前景/背景/ANSI 色对比正常。
- 截图保存在 `/tmp/dashboard-theme-qa-dark.png` 和 `/tmp/dashboard-theme-qa-light.png`，fixture 已删除，不进入仓库。

### 工作区未提交改动（2026-08-15）

历史性条目。`dfd41caec`（refine timeline and theme）与 `160b7bd1b`（URL routing + incremental timeline reducer）已分别提交，下列四项已全部落地：

- **Agent 列表实时订阅**：`daemon-data-store.refreshAgents` 首页请求带 `subscribe: { subscriptionId: "dashboard:<hostId>" }`，daemon 在 Session 里记下订阅后用 `agent_update` 推后续变化。之前只在首连、重连和主动建 Agent 时刷新，别处新建的会话不会出现在侧栏。订阅只在第一页建立，翻页请求不带 subscribe，否则会重置订阅。
- **乐观消息与 canonical 对账**：runtime 发消息时生成 `messageId`，先写进 `timeline-store.submissions` 再发 RPC；daemon 把它当 `user_message.clientMessageId` 回来，`reconcileSubmissions` 按 ID 移除对应乐观条目，RPC 失败走 `rejectSubmission` 只回滚这一条。不按文本匹配（连发同样内容会错配），不靠 agent `running` 状态清理（状态与 timeline 不同帧到达，会闪空）。canonical 与乐观气泡用同一个 `submission:<id>` React key。
- **活动指示器**：`TimelineLiveStatus` 去掉「正在回复…」这类固定文案，只留图标 + 计时（参照 zeno `TimelineRow.tsx` 的 `liveStatusIcon`，thinking 用 `Brain`）。计时曾恒为 0s——daemon 时间戳可能比浏览器快，负数被 `formatElapsed` 钳成 0；现在时间戳缺失或超前 1s 以上就从组件挂载时刻起算。
- **亮色主题**：`globals.css` 新增 `[data-theme="light"]`，`stores/theme-store.ts` 持久化到 `localStorage`（`paseo-dashboard-theme`）并写 `data-theme` + `color-scheme`，设置页「偏好」和侧栏底部都能切。代码块配色（hljs 语法色、diff 增删、代码底色）原先写死深色值，已全部抽成 `--code-*` token 两套主题各给一份；滚动条、选区、composer 聚焦背景同样 token 化。xterm 不读 CSS 变量，`terminal-view.tsx` 用 `getComputedStyle` 取色并监听 `THEME_CHANGE_EVENT` 换主题。

### 已完成

- [x] 所有 `docs/` 文档创建完毕（architecture / product-requirements / roadmap / open-decisions / paseo-integration / security）
- [x] `docs/development-plan.md` 创建完毕（P0-P6 的子任务分解）
- [x] 根目录 `AGENTS.md` 配置完整
- [x] **P0.1 技术选型**：Fastify 后端 / SQLite+Drizzle 数据库 / React+Vite+Router+Zustand Web 框架 / npm workspaces / vitest 测试。
- [x] **P0.2 项目骨架**：npm workspaces、tsconfig.base、contracts 包、server 骨架、web 骨架、tests 骨架。
- [x] **P0.3 最小认证与 Host 存储**：Drizzle schema（7 表）、envelope encryption、auth 路由、host 路由、sync 路由、20 个契约测试。
- [x] **P0.4 Web 端连接验证代码**：Web 集成 `@getpaseo/client`/`protocol`/`relay`；connection manager、offer parser；Playwright E2E 3 测试。全量 32 测试通过。
- [x] **P0.5 M0 退出条件确认**：敏感数据检查、client 覆盖矩阵（DaemonClient ~130+ 方法）、m0-exit-report.md。M0 退出。
- [x] **P1.1 完整认证与会话**：Argon2id；access/refresh 分离；reuse 检测撤销 family；注册关闭；修改密码；不提供邮件找回或公开重置。16 个负向契约测试。
- [x] **P1.2 Host 完整生命周期**：Host 更新（乐观并发 409）；capability fingerprint 去重；幂等键；sync 返回 tombstone。8 个新测试。
- [x] **P1.3 存储加密与审计**：审计事件补齐（login_failed、logout）；setErrorHandler；redaction 增强；KEK 权限检查；IP 截断。
- [x] **P1.4 部署与恢复**：`docs/deployment.md`。
- [x] **P2.1 增量同步与冲突**：hosts 表加 `lastSyncRevision` 列；重写 sync API 按 `lastSyncRevision > after` 游标查询；Web 端同步状态机（localStorage 持久化、分页、幂等、全量 resync）；8 个契约测试。
- [x] **P2.2 设备与 Session 管理**：devices 加 `lastSyncRevision`、sessions 加 `createdAt`；GET/DELETE `/devices` 和 `/sessions` 路由；sync 追踪设备 revision；9 个契约测试。
- [x] **P2.3 实时配置事件**：in-memory `ConfigEventBus`（按 userId 分区）；SSE `/events` 端点；mutation 路径（import/update/delete/revoke）触发事件；10 个测试（5 单元 + 5 集成）。
- [x] **P2.4 安全加固**：内存 rate limiter（P4.1 已扩展为 IP/账号/installation/credential 分层）；Origin 校验（状态变更请求）；CSP/X-Frame-Options/nosniff headers；审计查询 API `/audit-events`（ULID cursor 分页）。
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
- [x] **UI 打磨第二轮（交互结构 + 层叠修复）**：composer 改 protrusion 条焊输入卡片（`components/composer-shell.tsx`），发送按钮独立底栏；侧栏「添加主机」改次级动作（虚线方标，不再复用 nav-item）；运行状态两层——侧栏 `SessionStatusMarker`（running 转圈 / error 红叉）、时间线末尾 `TimelineLiveStatus`（shimmer + 计时，phase 由 `deriveLiveActivity` 从最新条目推断）；用户消息右对齐气泡；header 状态/视图/操作分组；上翻出回到底部按钮。**根因修复**：`globals.css` 无层级 `* { padding: 0 }` 压过 Tailwind `@layer utilities`，全站间距工具类失效（权限卡片 `p-3.5` 计算值 0）——重置迁入 `@layer base`，盒模型实测 padding 0→14px。web 包加 `test` 脚本（自有 vite alias，避开根配置把 `@` 指到 app）；`test:dashboard` 纳入 web。单测 84→94。约定已写入 [`docs/ui.md`](./ui.md)。
- [x] **Bug 修复（Live Status 计时 + Origin 文档）**：`live-activity.ts` 的 `deriveLiveActivity` 修正——如果最后一条 timeline entry 是 `assistant_message`，即使 status 还是 "running" 也返回 null（避免回复完成后仍计时）；6 个单测同步修正。新增 `docs/local-development.md` 完整开发指南（Origin 校验说明、环境变量、常见问题 403/新建会话/Live Status）。单测 94→104。commit `01ea5125f` + `08abec18c`。
- [x] **P3.5 兼容性测试**：`tests/e2e/src/compatibility.vitest.test.ts` 新增 15 个兼容性测试（feature detection 7 个、兼容性判断 4 个、feature gating 行为 4 个），覆盖 v0.1.80/v0.1.81/v0.1.106 daemon 版本矩阵；`docs/compatibility-matrix.md` 记录版本矩阵、特性门控列表（selectiveAgentTimeline/terminalRestoreModes）、添加新 gate 流程、COMPAT 标签清理规则；`AGENTS.md` 文档地图新增兼容性条目。E2E 测试 8→23。随 commit `4638617ce` 提交。
- [x] **P3.6 历史 Web 缺口补齐**（commit `4638617ce`）：`GET /me` 接线（`bootstrap()` 改 `Promise.all([getMe, listHosts])`，刷新后不再靠 localStorage 显示邮箱）；SSE 断流指数退避重连（1s→30s，回传 `Last-Event-ID` 让 server 跳过已发事件）；Host 内联改名（乐观并发 `baseVersion`）；修改密码表单；审计记录页 + 侧栏入口；「加载更早」从按钮改 `IntersectionObserver` 滚动哨兵（200px 预触发）。
- [x] **新建会话体验**（commit `d434c283d`）：新建会话入口、项目栏新建图标、已有会话切换 model。
- [x] **路由与 agent 深链**：导航状态搬进 react-router。`main.tsx` 注册 `path: "*"`，URL 是唯一的导航来源——`navigation/routes.ts` 的 `parseDashboardRoute` 把 pathname 解析成 `{ page, selection }`，`App.tsx` 不再持有 `useState<Page>` / `useState<AgentSelection>`。页面各有 URL（`/workspace`、`/hosts`、`/agents`、`/devices`、`/audit`、`/settings`），agent 深链是 `/agent/:hostId/:agentId`，刷新回到同一会话。`/` 和未知路径 `replace` 到 `/workspace`，不留下一个渲染 workspace 的野路径。id 走 `encodeURIComponent`，坏的百分号转义按未知路径处理而不是抛异常（5 单测）。生产部署要求静态服务器有 SPA fallback（`deployment.md` 的 nginx 示例已有 `try_files ... /index.html`）。
- [x] **Timeline 增量 reducer**：`timeline-store` 直接消费带 `epoch`/`seq` 的 positioned `agent_stream` timeline 行，连续的 assistant/reasoning chunk 在本地合并，tool lifecycle 按 `callId` 原地更新；遇到重复或未定位事件丢弃，遇到 sequence gap 只做一次权威 tail catch-up，不再用 400ms 节流重拉每个事件。内存上限与 optimistic submission 对账保留。`timeline-store` 与 `dashboardRuntime` 测试覆盖（32/32）。

### 迁移变更记录

迁移时做了以下调整以适配 Paseo monorepo：

| 改动                                                                                | 原因                                                                                                    |
| ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| 包名 `@paseo-board/*` → `@getpaseo/dashboard-*`                                     | 匹配 monorepo 命名                                                                                      |
| `DaemonClient` 从 `@getpaseo/client` 改为 `@getpaseo/client/internal/daemon-client` | 当前 Paseo 版本不再从主入口导出 DaemonClient                                                            |
| React 18 → 19.1.0                                                                   | 匹配 monorepo                                                                                           |
| vite.config.ts relay e2ee 路径                                                      | monorepo 目录层级不同                                                                                   |
| 根 package.json 增加 dashboard workspaces + 脚本                                    | `dev:dashboard:server`、`dev:dashboard:web`、`build:dashboard`、`test:dashboard`、`typecheck:dashboard` |

### 待开始

M3、P4.1、P4.2 当前范围、P4.3 和 P4.4 已完成。Dashboard 不验证邮箱所有权；风险登录和新设备提示暂缓。

已搁置，不阻塞 M3：

- **权限卡片真实 provider 实测**：协议形状、交互和 daemon resolved/error 已由单测与 Playwright QA fixture 覆盖。真实审批 provider 的 daemon 端到端手工验证按 2026-08-16 决定后置。

下一步：

1. 开始 P3.7.1 文件浏览器只读基础：目录树、文本读取、文件变更订阅和路径/错误边界。
2. P3.7.1 完成后进入 P3.7.2 Git 状态与差异查看；先不做 push、merge 等写操作。
3. P5.1 Harmony Runtime 暂缓；P4.4 HostGrant 只保留审查结论，不启用分享语义。
4. 风险登录、新设备提示、密码恢复和权限卡片真实 provider 手工验证继续后置。

完整序列见 `docs/development-plan.md`（P4 多用户与设备安全 / P5 Harmony / P6 可选高级能力）。

Dashboard 测试不进 CI，本地用 `test:dashboard` 跑。

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
- [x] 注册策略 → 已定：首用户 admin；公开注册开关；关闭时使用 admin 的 email-bound 单次邀请
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
npm run test:dashboard         # web 130 + contract 112 + e2e vitest 23
# web 单测必须走 workspace 脚本（该包 vite.config 的 @ 别名），不要从根 vitest 直接跑 web/src
npm run test --workspace=@getpaseo/dashboard-web

# 类型检查
npm run typecheck:dashboard
```

### 数据库

- server 用 SQLite + Drizzle ORM（`better-sqlite3` 同步 API）。
- server 启动时自动创建 `data/` 目录和表；非 production 的 file provider 可自动生成 `data/.kek`，production 必须显式配置 file key 或 AWS KMS。
- DB 表：users, invitations, devices, sessions, passkeys, webauthn_challenges, hosts, host_connections, encryption_key_versions, encryption_secrets, audit_events。
- `db.transaction(cb)` 回调必须同步（不可 async）。

### 加密

- 每行随机 256-bit DEK → AES-256-GCM 加密 payload → DEK 由版本化 KEK 包装（AES-256-GCM）；AAD 绑定 schema/user/host/conn/payloadKeyVersion。
- `KeyProvider` 支持 file 与 AWS KMS。registry 保存 provider/reference 和 active/decrypt-only/retired 状态；轮换只重包 DEK，新写入在切换后使用 active 版本。
- capability fingerprint 使用独立 secret；首次迁移保持旧派生值，后续随 key rotation 重包，不改变去重结果。

### Web 连接层

- `web/src/paseo/connectionManager.ts` 使用官方 `buildRelayWebSocketUrl` 构造 Relay URL。
- `DaemonClient` 从 `@getpaseo/client/internal/daemon-client` 导入（当前 Paseo 版本不再从主入口导出）。
- `@getpaseo/relay/e2ee` 的 vite alias 指向 `../../relay/dist/e2ee.js`（monorepo 内路径）。

### Web 数据接线（P3.2）

- 认证：Web 用 HttpOnly cookie；`stores/app-store.ts` 的 `bootstrap()` 用 `listHosts()` 探测（200→ready，401→未登录，其他→可重试错误）；`dashboardApi.setUnauthorizedHandler` 全局接 401 登出。用户对象取自登录/注册响应并缓存在 localStorage 供设置页显示——服务端有 `GET /api/v1/me` 可以直接取，web 端还没接（见待开始 P3.6）。
- 路由：`main.tsx` 的 catch-all 路由交给 `App.tsx`，`navigation/routes.ts` 是 URL 的唯一解析点。页面路径是 `/workspace`、`/hosts`、`/agents`、`/devices`、`/audit`、`/settings`；`/agent/:hostId/:agentId` 打开指定 agent。未知路径 replace 到 `/workspace`。
- 数据流：`host-sync-store`（Dashboard host 注册表）→ `App.tsx` effect 对每个 host `dashboardRuntime.connectHost`（断线 host 自动 disconnect）→ `hooks/use-host-runtimes.ts` 订阅每个 host 的连接态 + daemon 数据 → `lib/agent-tree.ts` 纯函数构建侧栏树/列表行。SSE `host.upserted/deleted` 只触发一次增量 `sync()`（事件 data 是松散类型，不直接消费）。
- **分组键的坑**：agent placement 的 `projectKey` 字段实际是 `projectId`（daemon 在 `packages/server/src/server/session.ts` 里填的），与项目描述符自己的 `projectKey`（新式 key）不同源。按 `projectId` 分组，否则同一项目出现两行。
- Host 导入的真实验证：`dashboardRuntime.verifyConnection(host)` 临时连 relay 读 `server_info.version` 后即断开，临时 host 不进 sync store。
- SSE 长连接会让 Playwright 的 `waitUntil: "networkidle"` 永远超时，登录后一律用 `domcontentloaded`。
- 实时数据：`dashboardRuntime` 连接后通过 `client.on("agent_update"/"workspace_update"/"project.update")` 把推送写进 `daemon-data-store` 的 apply reducer；重连时 `refreshHost` 兜底。测试里 mock `DaemonClient["on"]` 重载集很难精确实现（`DaemonEventHandler` 变体的事件 union 与 `SessionOutboundMessage` 不同），fake 用属性 + `as DaemonClientLike["on"]` 断言。
- Timeline：live `agent_stream` 里带 `epoch`+`seq` 的 timeline 行由 `timeline-store.applyStreamEvent` 增量应用（assistant/reasoning 相邻 chunk 拼接，tool lifecycle 按 `callId` 原地更新）。**seq 只能连续推进**：`seq <= maxSeq` 丢弃，`seq > maxSeq + 1` 说明漏了行，只能回到权威 tail 重拉，不要凭 delta 猜中间内容。没有 `seq`/`epoch` 的事件（turn*\*、permission*\*）不动 timeline。tail 页合并仍用页首 `seqStart` 切割（同 epoch 且重叠/相邻时保留更早历史，daemon 投影替换重叠后缀）。语义依据见 Paseo `docs/timeline-sync.md`。`sourceSeqRanges` 字段是 `startSeq/endSeq`。
- **权限不是 timeline 条目**：`AgentTimelineItem` 的 union 只有 7 种（user_message / assistant_message / reasoning / tool_call / todo / error / compaction），`components/timeline.tsx` 全部渲染了，覆盖完整。权限走两条独立通道：agent 快照的 `pendingPermissions` 数组，和 `agent_stream` 的 `permission_requested`/`permission_resolved` 事件（在 `timeline-store` 的 `REFRESH_EVENT_TYPES` 里只用来触发 tail 重拉）。卡片按 request kind 处理：question 写 `updatedInput.answers`，plan/tool 展示决策上下文，permission suggestions 只能由显式「允许并记住」发送。响应必须等 `respondToPermissionAndWait` 收到 `agent_permission_resolved` 后再移除；不要去扩 timeline item 类型。
- `DaemonClientLike` 是 `Pick<DaemonClient, ...>`（`paseo/connectionManager.ts:13`）。加新 daemon 能力先往这个 Pick 里加名字，不要在页面里绕过 connection manager 直接摸 `DaemonClient`。
- **Terminal**：`paseo/terminalSession.ts` 是唯一的终端流处理层——订阅 `onTerminalStreamEvent`（按 terminalId 过滤 output/restore/snapshot）、`terminal_stream_exit`、resize intent（attach 时 claim、之后 update，语义见 Paseo `docs/terminal-performance.md`）。restore 模式经 `features["terminal-restore-modes"]` gate（COMPAT 注释在代码里）；无 feature 的旧 daemon 会送 snapshot 帧，`terminal-view.tsx` 用 `renderTerminalSnapshotToAnsi`（`@getpaseo/protocol/terminal-snapshot`）reset+重放进 xterm。xterm 的 `fontFamily` 不解析 CSS 变量，要写完整字体栈。终端是 per-cwd 的（`listTerminals(cwd, …, { workspaceId })`），Workspace 页用 `agent.cwd`/`agent.workspaceId`。

### Web UI 与 i18n

见 [`docs/ui.md`](./ui.md)。token、层叠、composer/侧栏/运行状态、Zeno 组件对照、i18n、禁止项都在那一篇。Playwright 端口与 headless 截图坑也写在「验证」。

### 测试统计

- web 单测 **130**（16 文件：dashboardRuntime 18、timeline-store 15、daemon-data-store 13、features 10、agent-tree 10、permission-request-form 8、app-store 9、terminalSession 8、connectionManager 7、live-activity 7、dashboardEvents 6、routes 5、format-time 4、diff-lines 4、code-language 3、dashboardApi 3）。
- contract **112**（server-auth 16、server-security 16、server-events 15、server-hosts 13、server-devices-sessions 9、server-registration-policy 11、server-sync 8、server-abuse-protection 9、server-passkeys 4、server-auth-boundaries 5、server-host-import-isolation 1、auth 2、host-sync 3）+ e2e vitest **23**（connection-manager 4、offer-parser 3、compatibility 15、placeholder 1）= 静态统计 **265** 含 web。
- Playwright 浏览器 E2E 3 测试（需 `PLAYWRIGHT_BROWSERS_PATH=/tmp/playwright-browsers`）。
- **web 单测**：`packages/dashboard/web/package.json` 有 `test` 脚本，走该包自己的 `vite.config.ts`（`@` 指向 `web/src`）。根 `vitest.config.ts` 仍把 `@` 指到 `packages/app/src`，所以从仓库根直接 `npx vitest run packages/dashboard/web/src` 会错；用 `npm run test --workspace=@getpaseo/dashboard-web`。`test:dashboard` 现已包含 web。P3.5 兼容性测试 15 单测在 `tests/e2e/src/compatibility.vitest.test.ts`。
- **CI 不跑 dashboard 测试，这是有意的**：`.github/workflows/ci.yml` 的测试 job 点名指定包，不要往里加 dashboard。dashboard 测试在本地跑 `test:dashboard`。根 `npm run typecheck`/`lint`/`format:check` 是 `--workspaces`，这三项会覆盖到 dashboard。
- Lefthook pre-commit hook 会跑全 monorepo typecheck（含 app/desktop/cli），这些包有预先存在的 typecheck 错误，不是 dashboard 引入的。dashboard 的 `typecheck:dashboard` 全部通过。提交时可用 `--no-verify` 绕过。

## 接续方式

> 如果你是新对话，执行以下步骤：

1. **读此文件**：`cat packages/dashboard/docs/progress.md`
2. **读 AGENTS.md**：`packages/dashboard/AGENTS.md`（含所有架构边界和规则）
3. **读当前阶段文档**：按 `待开始` 第一项对应的子阶段，读 `docs/development-plan.md` 的关联文档
4. **确认上下文**：`git log --oneline -5` 和 `git status`，确认工作区是否还有未提交改动
5. **继续执行**：从 `待开始` 第一项开始
6. **更新本文件**：完成后更新 `当前状态`、`待开始` 和 `修改记录`

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
| 2026-08-14 | Fable            | 把 Dashboard Web UI 风格写成 `docs/ui.md`；AGENTS.md / 文档地图 / paseo-integration 页面平移原则改为指向该篇。                                                                                                                                                                                                                                                                                                                                                                                                                           |
| 2026-08-14 | Fable            | P3.1 完成：集中 feature gating 模块 `paseo/features.ts`（`getDaemonFeatures`/`isCompatibleDaemon` + 10 单测）；`selectiveAgentTimeline` 在 `viewAgent`/`leaveAgent` 中 gate（COMPAT 标签）；`terminalRestoreModes` 改用统一模块；dashboardRuntime 测试补 `getLastServerInfoMessage` 返回完整 server_info。web 单测 94→104，test:dashboard 全绿（web 104 + contract 79 + e2e 8 = 191）；typecheck/lint/format 通过。P3.1 退出条件满足。                                                                                                   |
| 2026-08-15 | Fable            | Agent 列表实时订阅（`fetch_agents.subscribe` 只在首页建立）；发送消息乐观气泡 + 稳定 `clientMessageId` 对账（不按文本匹配、不靠 `running` 状态清理）；活动指示器去文案留计时并修复 daemon 时钟超前导致恒为 0s；亮色主题 + 主题切换（`theme-store` 持久化、代码块/滚动条/选区/xterm 配色 token 化）。web 单测 104→112；typecheck/lint/format 通过。progress.md 与 ui.md 同步。按用户决定，dashboard 测试不进 CI，从待办中移除。                                                                                                           |
| 2026-08-15 | Claude           | P3 路由与 Timeline 增量同步：页面 URL 与 `/agent/:hostId/:agentId` 深链成为唯一选择来源；带 `epoch` + `seq` 的 live timeline 行在前端按 daemon projection 规则增量合并，seq gap 才权威重拉 tail。Dashboard 完整测试通过：web 119、contract 79、e2e 23，共 221 项。                                                                                                                                                                                                                                                                       |
| 2026-08-16 | Claude           | progress.md 与 reality 对齐：工作区已干净（`dfd41caec` + `160b7bd1b` 已提交，原先记成未提交的四项落地）；当前 commit 标为 `160b7bd1b`；测试统计从 web 112/214 修订为 web 119/221（timeline-store 13→15、新增 routes 5）；`待开始` 去掉已完成的「提交推送」，保留权限卡片实测与亮色 Playwright 截图；development-plan.md P3.5「未开始」改为「已完成」。                                                                                                                                                                                   |
| 2026-08-16 | Codex            | 权限卡片增强：question 表单支持单选/多选/自由输入/可选空回答，plan 与 tool detail 展示审批上下文，Claude suggestions 提供显式「允许并记住」；runtime 改用 `respondToPermissionAndWait`，失败保留卡片并显示内联错误。新增 9 个 web 单测（web 119→128，静态总数 221→230）；Playwright QA fixture 以三种真实协议形状完成深色/亮色截图和问题提交验证。真实 provider 端到端审批仍在待办，按用户决定后置、不阻塞 M3。                                                                                                                          |
| 2026-08-16 | Codex            | 用户决定搁置权限卡片真实 provider 手工验证，不再阻塞 M3。M3 只剩亮色主题代码块/diff/terminal 截图与提交当前收尾改动；之后进入 P4.1，先建立租户隔离测试矩阵和注册/邀请策略。                                                                                                                                                                                                                                                                                                                                                              |
| 2026-08-16 | Codex            | 完成亮色主题视觉验证：Playwright 临时 fixture 同屏检查 TypeScript code block、diff 与真实 xterm TerminalView；深色/亮色截图均无 page error，语法色、diff 增删/hunk 和 terminal ANSI 色对比正常。fixture 已删除，M3 只剩提交当前收尾改动。                                                                                                                                                                                                                                                                                                |
| 2026-08-16 | Codex            | M3 收尾提交完成：`feat(dashboard): complete permission request cards`。P3.1-P3.6、权限卡片增强与亮色主题视觉验证全部落地；下一阶段切到 P4.1 多用户。                                                                                                                                                                                                                                                                                                                                                                                     |
| 2026-08-16 | Codex            | P4.1 首轮认证边界：受保护请求与 refresh 统一校验 active user/device，Session 列表按租户同时约束 session/device 所属；新增 auth boundary 5 测试，补跨用户 Session 列表与撤销测试。目标测试文件 54 项通过。                                                                                                                                                                                                                                                                                                                                |
| 2026-08-16 | Codex            | P4.1 租户隔离矩阵补齐：Host import 的 idempotency key/capability fingerprint 按账号隔离，真实 HTTP SSE 双用户连接不串事件；新增 2 个合同测试，contract 86→88。Host、sync、Session、Device、SSE 与审计跨用户合同已覆盖。                                                                                                                                                                                                                                                                                                                  |
| 2026-08-16 | Codex            | P4.1 注册策略：首用户 admin、后续 member；关闭公开注册时仅接受 admin 创建的 email-bound、限时、单次邀请；同邮箱重发撤销旧 token，原始 token 只返回一次且日志脱敏。注册判定和写入改为 `IMMEDIATE` 事务，并发 bootstrap 只能产生一个管理员。新增 11 个合同测试，contract 88→99，静态总数 239→250；邮箱验证与 abuse tests 继续。                                                                                                                                                                                                            |
| 2026-08-16 | Codex            | P4.1 abuse 防护：注册/登录按 IP、normalized email、installation 分层限流，refresh 按 IP/credential hash，Host 导入按 IP/认证账号；bucket identity 只保留 SHA-256，query string 不再绕过匹配，429 返回 `Retry-After`。新增 7 个合同测试，contract 99→106，静态总数 250→257；重置密码防护随未来恢复 endpoint 实现。                                                                                                                                                                                                                        |
| 2026-08-16 | Codex            | 产品决策收口：Dashboard 定位为自托管自用，不验证邮箱所有权，也不引入邮件找回。邮箱只作为登录标识和邀请匹配条件，邀请 token 的持有证明管理员授权；P4.1 据此完成，下一阶段转入 P4.2 session/device 风险审计与 Passkey。                                                                                                                                                                                                                                                                                                                    |
| 2026-08-16 | Codex            | P4.2 当前范围完成：device/session 增加截断 IP、User-Agent 摘要和认证方式；Web 增加 discoverable Passkey 注册、登录、列表和删除；challenge 哈希化、五分钟、单次消费并校验 RP/origin/UV/counter，credential 与 ceremony 有独立 abuse bucket。新增 6 个合同测试和 2 个 Web 单测，contract 106→112、web 128→130、静态总数 257→265。风险登录与新设备提示按用户决定暂缓，下一阶段 P4.3。                                                                                                                                                       |
| 2026-08-16 | Codex            | P4.3 完成：版本化 KeyProvider 支持 file 与 AWS KMS data key；新增 key registry、加密 fingerprint secret、admin 状态/轮换 API、当前密码校验、IP 限流、日志脱敏和审计。轮换先切 active，再在线重包 encryptedDek，支持中断后从 decrypt-only 继续，完成后退休旧 key。新增 6 个合同测试，contract 112→118、静态总数 265→271；部署文档补 file/KMS 轮换和隔离恢复演练。                                                                                                                                                                         |
| 2026-08-16 | Codex            | P4.4 完成：完成 HostGrant 逻辑模型和授权边界审查；owner 继续由 hosts.ownerUserId 定义，active grant 按 Host/用户唯一，撤销保留历史；admin 不自动获得 capability，operator/viewer 等待 daemon per-client scope、credential 和 revoke 支持。未新增 grant 表、API 或 UI。                                                                                                                                                                                                                                                                   |
| 2026-08-16 | Codex            | 开发优先级调整：暂缓 P5.1 Harmony Runtime，回到 P3.7 新增功能；先实施 P3.7.1 文件浏览器只读基础，再做 Git 状态/差异查看，暂不并行开放文件写入或 Git push/merge。                                                                                                                                                                                                                                                                                                                                                                         |
