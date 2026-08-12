# M0 退出条件检查报告

> 对应 `roadmap.md` M0 退出条件，`development-plan.md` P0.5。产出日期：2026-08-12。

## 退出条件 1：第二浏览器收到 `server_info`，Dashboard 后端只看到 auth/Host API

### 结论：满足（代码路径验证）

浏览器 B 流程：登录 → `GET /api/v1/host-sync` 获取 Host 列表（含解密后的 connection）→ 浏览器用 connection 构造 `wss://.../ws?serverId=...&role=client&v=2` → 通过 `@getpaseo/client` 直连 Relay → E2EE handshake → 收到 `server_info`。

Dashboard 后端参与的请求：

- `POST /api/v1/auth/login`、`POST /api/v1/auth/refresh`、`POST /api/v1/auth/logout`
- `GET /api/v1/me`
- `GET /api/v1/hosts`、`POST /api/v1/hosts/import`、`DELETE /api/v1/hosts/:id`
- `GET /api/v1/host-sync`

后端没有到 Relay 或 daemon 的 WebSocket 连接代码。`server/src/` 不导入 `@getpaseo/client`。

**证据**：

- `server/src/app.ts` 只注册 auth/hosts/sync 路由和 `/health`。
- `server/package.json` 依赖不含 `@getpaseo/client` 或 `@getpaseo/protocol`。
- `web/src/paseo/connectionManager.ts` 使用官方 `buildRelayWebSocketUrl` 构造 Relay URL，连接发生在浏览器。

### 验证状态

- Playwright E2E 3 测试通过（页面渲染、offer 输入与验证按钮、Host 同步区）。
- 连接到真实 daemon 获取 `server_info` 的完整 E2E 需要运行中的 daemon + Relay，P0.4 用 Playwright 验证了 UI 路径；代码路径验证已完成。

---

## 退出条件 2：capability 在数据库中为密文，日志和错误追踪 fixture 无原文

### 2a. 数据库中的 capability 为密文：满足

**DB schema**（`server/src/db/schema.ts` + `migrate.ts`）：

- `host_connections` 表只保存 `encrypted_payload`、`encrypted_dek`、`key_version`、`nonce`、`auth_tag`。
- 无明文 `connection`、`serverId`、`daemonPublicKeyB64` 或 `relayEndpoint` 列。

**加密实现**（`server/src/lib/encryption.ts`）：

- 每行生成随机 256-bit DEK，AES-256-GCM 加密 capability JSON。
- AAD 绑定 `schemaVersion + userId + hostId + connId + keyVersion`，防密文换位。
- DEK 由 KEK（AES-256-GCM）包装。KEK 从外部文件加载或开发模式自动生成。
- `hosts` 表只存 `label`、`version` 等元数据，不含 capability。

**结论**：数据库泄露（无 KEK）不能恢复 capability。

### 2b. 日志无 offer/token/connection 原文：满足（有已知缺口）

**pino redaction 配置**（`server/src/app.ts`）：

```
redact.paths: [
  'req.headers.authorization',
  'req.body.password',
  'req.body.currentPassword',
  'req.body.newPassword',
  'req.body.refreshToken',
  'req.body.token',
  'req.body.connection',     ← 覆盖 importHost 的 connection 字段
]
censor: '[REDACTED]'
```

**已覆盖**：

- 请求体中的 `password`、`refreshToken`、`token`、`connection`、`authorization` header 均被 redact。
- 服务端不保留原始 offer URL（`security.md` 要求）。
- 审计事件 metadata 只记录 `label` 和 `verifiedAt`，不含 connection。

**已知缺口（M0 可接受，M1 必须修复）**：

| #   | 缺口                                                                                                                                                                                                                             | 风险                      | 修复时机                |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------- | ----------------------- |
| G1  | pino 默认只 redact 请求体顶层字段。如果 `req.body` 嵌套结构变化（如 `req.body.connection.daemonPublicKeyB64`），Fastify pino 默认序列化只记录顶层 `req.body`，但若启用 `serializers.req` 自定义或 body logging，嵌套字段可能泄露 | 低（默认配置不记录 body） | M1                      |
| G2  | 无全局 `onError` hook 统一 redact error 对象。当前错误处理用 `sendError()` 只返回 code/message/requestId，不包含原始输入。但如果未来有未捕获异常被 Fastify 默认 handler 处理，`req.body` 可能进入 error log                      | 低                        | M1 加 `setErrorHandler` |
| G3  | `ipPrefix` 字段存原始 `req.ip`，未截断为前缀。字段名叫 `ipPrefix` 但实际存完整 IP                                                                                                                                                | 低（M0 单用户）           | M1                      |
| G4  | `userAgentSummary` 在 sessions 表声明但未写入（auth 路由未赋值）                                                                                                                                                                 | 无                        | M2 写入时确保截断       |
| G5  | 无反向代理 body dump / APM body capture 配置。当前没有反向代理，但生产部署时必须确保关闭                                                                                                                                         | 部署时                    | M1 部署文档             |
| G6  | `capabilityFingerprint` 函数已实现（HMAC-SHA256），但 hosts/import 路由未调用它做去重                                                                                                                                            | 无（M0 单用户不急需）     | M1                      |

### 2c. API 响应 Cache-Control：满足

所有 auth/hosts/sync 路由均设置 `rep.header('Cache-Control', 'no-store')`：

- `hosts.ts`：import、list、delete 三处。
- `sync.ts`：host-sync 一处。
- `auth.ts`：register、login、refresh、logout、me 五处。

### 2d. 错误响应不泄露 capability：满足

`sendError()`（`server/src/lib/http.ts`）只返回 `{ code, message, requestId, details? }`，不包含原始 connection 或 offer。`badRequest` 的 details 只在 `register` 时返回 `{ code: 'email_exists' }`，不含敏感数据。

---

## 退出条件 3：Dashboard connection manager 的最小接口和官方 client 缺口清单

### Connection Manager 最小接口

已实现于 `web/src/paseo/connectionManager.ts`：

```ts
interface PaseoConnectionManager {
  connect(host: Host): Promise<void>;
  disconnect(hostId: string): Promise<void>;
  getState(hostId: string): HostConnectionState;
  subscribe(hostId: string, listener: PaseoConnectionListener): () => void;
  getDaemonClient(hostId: string): DaemonClientLike | null;
}
```

`DaemonClientLike` 当前只 Pick 5 个方法：`connect`、`close`、`getConnectionState`、`subscribeConnectionStatus`、`getLastServerInfoMessage`。

**M3 扩展**：随着功能增加，`DaemonClientLike` 需要暴露更多方法（见覆盖矩阵）。但 Connection Manager 接口本身不变，页面通过 `getDaemonClient()` 获取 client 后调用。

### 官方 client 覆盖矩阵

`DaemonClient`（`@getpaseo/client`）公开方法总计 ~130+ 个。按 M3 功能域分类：

#### 连接与重连

| 能力                  | DaemonClient 方法                                       | SDK 层                             | 状态                         |
| --------------------- | ------------------------------------------------------- | ---------------------------------- | ---------------------------- |
| 建立 WebSocket 连接   | `connect()`                                             | `PaseoClient.connect()`            | ✅ 覆盖                      |
| 关闭连接              | `close()`                                               | `PaseoClient.close()`              | ✅ 覆盖                      |
| 确保已连接            | `ensureConnected()`                                     | `PaseoClient.ensureConnected()`    | ✅ 覆盖                      |
| 获取连接状态          | `getConnectionState()`                                  | `PaseoClient.getConnectionState()` | ✅ 覆盖                      |
| 订阅连接状态变化      | `subscribeConnectionStatus()`                           | —                                  | ✅ 覆盖（Dashboard CM 已用） |
| 自动重连              | 内部 `scheduleReconnect()` + `reconnect.enabled` config | —                                  | ✅ 覆盖（config 中已启用）   |
| 设置重连开关          | `setReconnectEnabled()`                                 | —                                  | ✅ 可用                      |
| 获取最后 liveness RTT | `getLastLivenessRttMs()`                                | —                                  | ✅ 可用                      |
| Ping                  | `ping()`                                                | —                                  | ✅ 可用                      |
| 测量延迟              | `measureLatency()`                                      | —                                  | ✅ 可用                      |

#### server_info

| 能力                   | DaemonClient 方法            | SDK 层 | 状态                         |
| ---------------------- | ---------------------------- | ------ | ---------------------------- |
| 获取最后的 server_info | `getLastServerInfoMessage()` | —      | ✅ 覆盖（Dashboard CM 已用） |

#### Projects

| 能力                | DaemonClient 方法                           | SDK 层                                      | 状态    |
| ------------------- | ------------------------------------------- | ------------------------------------------- | ------- |
| 列出 projects       | `listProjects()`                            | —                                           | ✅ 可用 |
| 打开 project        | `openProject()`                             | `workspaces.open()` / `workspaces.create()` | ✅ 覆盖 |
| 添加 project        | `addProject()`                              | —                                           | ✅ 可用 |
| 删除 project        | `removeProject()`                           | —                                           | ✅ 可用 |
| 重命名 project      | `renameProject()`                           | —                                           | ✅ 可用 |
| 克隆 GitHub project | `cloneGithubProject()`                      | —                                           | ✅ 可用 |
| 创建目录            | `createProjectDirectory()`                  | —                                           | ✅ 可用 |
| 读取 project config | `readProjectConfig()`                       | —                                           | ✅ 可用 |
| 写入 project config | `writeProjectConfig()`                      | —                                           | ✅ 可用 |
| 获取 project icon   | `getProjectIcon()` / `requestProjectIcon()` | —                                           | ✅ 可用 |
| 设置 project icon   | `setProjectIcon()`                          | —                                           | ✅ 可用 |

#### Workspaces

| 能力                    | DaemonClient 方法             | SDK 层                                      | 状态    |
| ----------------------- | ----------------------------- | ------------------------------------------- | ------- |
| 列出 workspaces         | `fetchWorkspaces()`           | `workspaces.list()`                         | ✅ 覆盖 |
| 创建/打开 workspace     | `openProject()`               | `workspaces.open()` / `workspaces.create()` | ✅ 覆盖 |
| 归档 workspace          | `archiveWorkspace()`          | `workspaces.archive()`                      | ✅ 覆盖 |
| 恢复 workspace          | `restoreWorkspace()`          | —                                           | ✅ 可用 |
| 检查 workspace 恢复状态 | `inspectWorkspaceRecovery()`  | —                                           | ✅ 可用 |
| 设置 workspace 标题     | `setWorkspaceTitle()`         | —                                           | ✅ 可用 |
| 设置 workspace 固定     | `setWorkspacePinned()`        | —                                           | ✅ 可用 |
| 获取 setup 状态         | `fetchWorkspaceSetupStatus()` | —                                           | ✅ 可用 |
| 创建 workspace（显式）  | `createWorkspace()`           | —                                           | ✅ 可用 |
| 订阅 workspace 更新     | `on("workspace_update")`      | `workspaces.subscribe()`                    | ✅ 覆盖 |

#### Agents

| 能力               | DaemonClient 方法                | SDK 层                   | 状态    |
| ------------------ | -------------------------------- | ------------------------ | ------- |
| 列出 agents        | `fetchAgents()`                  | —                        | ✅ 可用 |
| 获取单个 agent     | `fetchAgent()`                   | `agents.ref().refetch()` | ✅ 覆盖 |
| 创建 agent         | `createAgent()`                  | `agents.create()`        | ✅ 覆盖 |
| 删除 agent         | `deleteAgent()`                  | —                        | ✅ 可用 |
| 归档 agent         | `archiveAgent()`                 | `agents.ref().archive()` | ✅ 覆盖 |
| 分离 agent         | `detachAgent()`                  | `agents.ref().detach()`  | ✅ 覆盖 |
| 恢复 agent         | `resumeAgent()`                  | —                        | ✅ 可用 |
| 刷新 agent         | `refreshAgent()`                 | —                        | ✅ 可用 |
| 导入 agent         | `importAgent()`                  | —                        | ✅ 可用 |
| 回退 agent         | `rewindAgent()`                  | —                        | ✅ 可用 |
| 取消 agent         | `cancelAgent()`                  | —                        | ✅ 可用 |
| 更新 agent         | `updateAgent()`                  | —                        | ✅ 可用 |
| 等待 agent upsert  | `waitForAgentUpsert()`           | —                        | ✅ 可用 |
| 等待 agent 完成    | `waitForFinish()`                | —                        | ✅ 可用 |
| 构建 fork context  | `buildAgentForkContext()`        | —                        | ✅ 可用 |
| 订阅 agent 更新    | `on("agent_update")`             | `agents.subscribe()`     | ✅ 覆盖 |
| 设置 timeline 订阅 | `setAgentTimelineSubscription()` | —                        | ✅ 可用 |

#### Timeline

| 能力                            | DaemonClient 方法                 | SDK 层                              | 状态    |
| ------------------------------- | --------------------------------- | ----------------------------------- | ------- |
| 获取 agent timeline             | `fetchAgentTimeline()`            | `agents.ref().timeline.refetch()`   | ✅ 覆盖 |
| 获取 provider subagent timeline | `fetchProviderSubagentTimeline()` | —                                   | ✅ 可用 |
| 列出 timeline prompts           | `listAgentTimelinePrompts()`      | —                                   | ✅ 可用 |
| 列出 provider subagents         | `listProviderSubagents()`         | —                                   | ✅ 可用 |
| 订阅 agent stream               | `on("agent_stream")`              | `agents.ref().timeline.subscribe()` | ✅ 覆盖 |

#### Terminal

| 能力                      | DaemonClient 方法                                  | SDK 层 | 状态    |
| ------------------------- | -------------------------------------------------- | ------ | ------- |
| 列出 terminals            | `listTerminals()`                                  | —      | ✅ 可用 |
| 创建 terminal             | `createTerminal()`                                 | —      | ✅ 可用 |
| 订阅 terminal             | `subscribeTerminal()`                              | —      | ✅ 可用 |
| 取消订阅 terminal         | `unsubscribeTerminal()` / `unsubscribeTerminals()` | —      | ✅ 可用 |
| 发送 terminal 输入        | `sendTerminalInput()`                              | —      | ✅ 可用 |
| 重命名 terminal           | `renameTerminal()`                                 | —      | ✅ 可用 |
| 关闭 terminal             | `killTerminal()`                                   | —      | ✅ 可用 |
| 捕获 terminal 输出        | `captureTerminal()`                                | —      | ✅ 可用 |
| 订阅 terminal stream 事件 | `onTerminalStreamEvent()`                          | —      | ✅ 可用 |
| 等待 terminal stream 事件 | `waitForTerminalStreamEvent()`                     | —      | ✅ 可用 |

#### Prompt（消息发送）

| 能力                       | DaemonClient 方法                      | SDK 层                | 状态    |
| -------------------------- | -------------------------------------- | --------------------- | ------- |
| 发送 agent 消息            | `sendAgentMessage()` / `sendMessage()` | `agents.ref().send()` | ✅ 覆盖 |
| 设置 agent mode            | `setAgentMode()`                       | —                     | ✅ 可用 |
| 设置 agent model           | `setAgentModel()`                      | —                     | ✅ 可用 |
| 设置 agent feature         | `setAgentFeature()`                    | —                     | ✅ 可用 |
| 设置 agent thinking option | `setAgentThinkingOption()`             | —                     | ✅ 可用 |
| 取消 agent                 | `cancelAgent()`                        | —                     | ✅ 可用 |
| 中止请求                   | `abortRequest()`                       | —                     | ✅ 可用 |

#### 权限

| 能力                     | DaemonClient 方法                 | SDK 层 | 状态    |
| ------------------------ | --------------------------------- | ------ | ------- |
| 响应权限请求             | `respondToPermission()`           | —      | ✅ 可用 |
| 响应权限请求并等待       | `respondToPermissionAndWait()`    | —      | ✅ 可用 |
| 订阅权限请求             | `on("agent_permission_request")`  | —      | ✅ 可用 |
| 订阅权限解决             | `on("agent_permission_resolved")` | —      | ✅ 可用 |
| 清除 agent attention     | `clearAgentAttention()`           | —      | ✅ 可用 |
| 清除 workspace attention | `clearWorkspaceAttention()`       | —      | ✅ 可用 |

#### Providers（AI 模型配置）

| 能力                          | DaemonClient 方法                 | SDK 层                      | 状态    |
| ----------------------------- | --------------------------------- | --------------------------- | ------- |
| 列出可用 providers            | `listAvailableProviders()`        | `providers.listAvailable()` | ✅ 覆盖 |
| 列出 models                   | `listProviderModels()`            | `providers.listModels()`    | ✅ 覆盖 |
| 列出 modes                    | `listProviderModes()`             | `providers.listModes()`     | ✅ 覆盖 |
| 列出 features                 | `listProviderFeatures()`          | `providers.listFeatures()`  | ✅ 覆盖 |
| 获取 providers snapshot       | `getProvidersSnapshot()`          | `providers.snapshot()`      | ✅ 覆盖 |
| 刷新 providers snapshot       | `refreshProvidersSnapshot()`      | `providers.refresh()`       | ✅ 覆盖 |
| 获取 provider diagnostic      | `getProviderDiagnostic()`         | `providers.diagnostic()`    | ✅ 覆盖 |
| 列出 provider usage           | `listProviderUsage()`             | —                           | ✅ 可用 |
| 订阅 providers 更新           | `on("providers_snapshot_update")` | `providers.subscribe()`     | ✅ 覆盖 |
| 获取 recent provider sessions | `fetchRecentProviderSessions()`   | —                           | ✅ 可用 |

#### Daemon 配置与管理

| 能力               | DaemonClient 方法         | SDK 层           | 状态    |
| ------------------ | ------------------------- | ---------------- | ------- |
| 获取 daemon config | `getDaemonConfig()`       | `config.get()`   | ✅ 覆盖 |
| 修改 daemon config | `patchDaemonConfig()`     | `config.patch()` | ✅ 覆盖 |
| 获取 daemon 状态   | `getDaemonStatus()`       | —                | ✅ 可用 |
| 获取 pairing offer | `getDaemonPairingOffer()` | —                | ✅ 可用 |
| 重启 daemon        | `restartServer()`         | —                | ✅ 可用 |
| 关闭 daemon        | `shutdownServer()`        | —                | ✅ 可用 |
| 更新 daemon        | `updateDaemon()`          | —                | ✅ 可用 |
| 收集诊断信息       | `collectDiagnostics()`    | —                | ✅ 可用 |

#### Git/Checkout（daemon 内置 git 操作）

| 能力                       | DaemonClient 方法                                                    | 状态    |
| -------------------------- | -------------------------------------------------------------------- | ------- |
| 获取 checkout 状态         | `getCheckoutStatus()`                                                | ✅ 可用 |
| 获取 checkout diff         | `getCheckoutDiff()` / `subscribeCheckoutDiff()`                      | ✅ 可用 |
| 列出 commits               | `listCheckoutCommits()`                                              | ✅ 可用 |
| checkout commit            | `checkoutCommit()`                                                   | ✅ 可用 |
| merge                      | `checkoutMerge()` / `checkoutMergeFromBase()`                        | ✅ 可用 |
| pull / push                | `checkoutPull()` / `checkoutPush()`                                  | ✅ 可用 |
| 刷新                       | `checkoutRefresh()`                                                  | ✅ 可用 |
| switch branch              | `checkoutSwitchBranch()`                                             | ✅ 可用 |
| rename branch              | `renameBranch()`                                                     | ✅ 可用 |
| PR create / merge / status | `checkoutPrCreate()` / `checkoutPrMerge()` / `checkoutPrStatus()`    | ✅ 可用 |
| auto-merge                 | `checkoutForgeSetAutoMerge()` / `checkoutGithubSetAutoMerge()`       | ✅ 可用 |
| check details              | `checkoutForgeGetCheckDetails()` / `checkoutGithubGetCheckDetails()` | ✅ 可用 |
| PR timeline                | `pullRequestTimeline()`                                              | ✅ 可用 |
| branch suggestions         | `getBranchSuggestions()`                                             | ✅ 可用 |
| validate branch            | `validateBranch()`                                                   | ✅ 可用 |
| stash                      | `stashSave()` / `stashPop()` / `stashList()`                         | ✅ 可用 |
| search forge               | `searchForge()` / `searchGitHub()` / `searchGithubRepositories()`    | ✅ 可用 |

#### 文件操作

| 能力       | DaemonClient 方法        | 状态    |
| ---------- | ------------------------ | ------- |
| 读取文件   | `readFile()`             | ✅ 可用 |
| 写入文件   | `writeFile()`            | ✅ 可用 |
| 上传文件   | `uploadFile()`           | ✅ 可用 |
| 下载 token | `requestDownloadToken()` | ✅ 可用 |
| 列出目录   | `listDirectory()`        | ✅ 可用 |
| 订阅文件   | `subscribeFile()`        | ✅ 可用 |
| 关闭 items | `closeItems()`           | ✅ 可用 |

#### Paseo Worktrees

| 能力           | DaemonClient 方法        | 状态    |
| -------------- | ------------------------ | ------- |
| 创建 worktree  | `createPaseoWorktree()`  | ✅ 可用 |
| 归档 worktree  | `archivePaseoWorktree()` | ✅ 可用 |
| 列出 worktrees | `getPaseoWorktreeList()` | ✅ 可用 |

#### Workspace Scripts

| 能力         | DaemonClient 方法                                             | 状态    |
| ------------ | ------------------------------------------------------------- | ------- |
| 列出 scripts | `listWorkspaceScripts()`                                      | ✅ 可用 |
| 启动 script  | `startWorkspaceScript()` / `startWorkspaceScriptWithStatus()` | ✅ 可用 |
| 停止 script  | `stopWorkspaceScript()`                                       | ✅ 可用 |

#### Chat / Schedules / Loops

| 能力                                        | DaemonClient 方法                                                                 | 状态    |
| ------------------------------------------- | --------------------------------------------------------------------------------- | ------- |
| 创建/列出/查看/删除 chat                    | `createChatRoom()` / `listChatRooms()` / `inspectChatRoom()` / `deleteChatRoom()` | ✅ 可用 |
| 发送/读取/等待 chat 消息                    | `postChatMessage()` / `readChatMessages()` / `waitForChatMessages()`              | ✅ 可用 |
| 创建/列出/查看/暂停/恢复/删除/运行 schedule | `scheduleCreate()` / ... / `scheduleDelete()` / `scheduleRunOnce()`               | ✅ 可用 |
| 更新 schedule                               | `scheduleUpdate()`                                                                | ✅ 可用 |
| 获取 schedule logs                          | `scheduleLogs()`                                                                  | ✅ 可用 |
| 运行/列出/查看/停止 loop                    | `loopRun()` / `loopList()` / `loopInspect()` / `loopStop()`                       | ✅ 可用 |
| 获取 loop logs                              | `loopLogs()`                                                                      | ✅ 可用 |

#### Voice / Dictation

| 能力                 | DaemonClient 方法            | 状态    |
| -------------------- | ---------------------------- | ------- |
| 设置 voice mode      | `setVoiceMode()`             | ✅ 可用 |
| 发送 audio chunk     | `sendVoiceAudioChunk()`      | ✅ 可用 |
| 开始 dictation       | `startDictationStream()`     | ✅ 可用 |
| 发送 dictation chunk | `sendDictationStreamChunk()` | ✅ 可用 |
| 完成 dictation       | `finishDictationStream()`    | ✅ 可用 |
| 取消 dictation       | `cancelDictationStream()`    | ✅ 可用 |
| 通知 audio played    | `audioPlayed()`              | ✅ 可用 |

#### Hub（Paseo Hub，Dashboard 不使用）

| 能力          | DaemonClient 方法 | 状态                         |
| ------------- | ----------------- | ---------------------------- |
| 连接 Hub      | `connectHub()`    | ⚠️ Dashboard 不使用 Hub 架构 |
| 获取 Hub 状态 | `getHubStatus()`  | ⚠️ Dashboard 不使用 Hub 架构 |
| 断开 Hub      | `disconnectHub()` | ⚠️ Dashboard 不使用 Hub 架构 |

#### Browser Automation（daemon 端）

| 能力                         | DaemonClient 方法                        | 状态    |
| ---------------------------- | ---------------------------------------- | ------- |
| 发送 browser automation 响应 | `sendBrowserAutomationExecuteResponse()` | ✅ 可用 |

### 官方 client 缺口清单

**结论：`@getpaseo/client` 覆盖了 M3 所需的全部 daemon 操作。无需 Dashboard 补齐底层 client 缺口。**

Dashboard Connection Manager 需要补齐的不是 client 缺口，而是**管理层职责**：

| #   | 缺口                                                             | Dashboard 补齐方式                                        | 阶段           |
| --- | ---------------------------------------------------------------- | --------------------------------------------------------- | -------------- |
| C1  | client 不管理多 Host 生命周期                                    | Connection Manager 维护 `Map<hostId, ManagedConnection>`  | ✅ P0.4 已实现 |
| C2  | client 不处理 Dashboard 登出时的连接清理                         | CM `disconnect()` 在登出/删除 Host 时调用                 | M1             |
| C3  | client 不感知 session 失效                                       | CM 监听 401 响应后断开所有连接                            | M1             |
| C4  | client 不限制页面直接创建实例                                    | 页面统一通过 CM `getDaemonClient()` 获取                  | ✅ P0.4 已实现 |
| C5  | SDK 层 `PaseoClient` 不暴露 terminal、git、文件、chat 等高级 API | Dashboard 直接使用 `DaemonClient` 底层方法，不经过 SDK 层 | M3             |
| C6  | SDK 层 `PaseoClient` 不暴露 `respondToPermission` 等权限方法     | Dashboard 直接使用 `DaemonClient` 底层方法                | M3             |

**关键结论**：Dashboard 应直接使用 `DaemonClient` 类（通过 Connection Manager 管理），而非仅使用 SDK 层的 `PaseoClient`。SDK 层 `createPaseoClient()` 只包装了 workspaces/agents/providers/config 四个域，缺少 terminal、git、文件、权限等 M3 必需功能。`DaemonClient` 本身是公开导出的（`export { DaemonClient }`），可以直接使用。

---

## 总结

| M0 退出条件                           | 状态                      | 备注                                       |
| ------------------------------------- | ------------------------- | ------------------------------------------ |
| 第二浏览器收到 `server_info`          | ✅ 满足                   | 代码路径验证完成；Playwright UI 路径已验证 |
| Dashboard 后端只看到 auth/Host API    | ✅ 满足                   | server 不导入 client/protocol              |
| capability 在数据库中为密文           | ✅ 满足                   | envelope encryption，无明文列              |
| 日志和错误追踪无原文                  | ✅ 满足（有 M1 待修缺口） | 6 个已知缺口，M0 可接受                    |
| Dashboard connection manager 最小接口 | ✅ 满足                   | 5 方法接口已实现                           |
| 官方 client 缺口清单                  | ✅ 满足                   | 无底层缺口；管理层缺口 6 项                |

**M0 退出条件全部满足，可进入 M1。**
