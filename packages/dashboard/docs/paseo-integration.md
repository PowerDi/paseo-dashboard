# Paseo 通信集成

## 最终方向

Paseo Dashboard 是独立项目，不是 Paseo App 的分支，也不与 `packages/app` 共享页面、路由、状态管理或设计系统。

前期“平移 Paseo App 功能”只表示功能范围先与现有 App 接近：Host、Project、Workspace、Agent、Timeline、Terminal、Prompt 和权限处理。所有页面和前端结构在 Dashboard 中重新实现，后期可以自由改版。

Dashboard 只与 Paseo 保持三项兼容：

1. pairing offer 格式；
2. Relay 加密连接方式；
3. daemon WebSocket 消息格式。

## 两个官方包的作用

### `@getpaseo/client`

这是运行在浏览器里的 daemon 连接代码。名字中的 `client` 指“daemon 的客户端”，不是 Dashboard 账号系统。

它负责：

- 建立直接或 Relay WebSocket；
- 在 Relay 连接中启用 Paseo 现有 E2EE；
- 断线重连和连接状态；
- 接收 agent 实时输出；
- 发送 prompt；
- 处理权限请求；
- 创建、停止、恢复和归档 agent；
- 调用 daemon 的其他功能。

Dashboard Web 在浏览器中调用它。Dashboard API 服务端不调用它，也不连接 daemon。

### `@getpaseo/protocol`

这是浏览器与 daemon 共同使用的消息格式定义。

它负责：

- 校验 pairing offer；
- 定义 daemon 请求和响应字段；
- 定义 `server_info`、agent、workspace、timeline 和权限消息；
- 帮助新客户端保持对旧 daemon 的兼容。

Dashboard 使用其中的格式，不自行发明另一套 daemon 消息。

### Relay E2EE

正常情况下 Dashboard 不直接调用单独的 Relay 加密模块。浏览器把 Relay 地址、`serverId` 和 `daemonPublicKeyB64` 交给 `@getpaseo/client`，由 client 内部使用 Paseo 官方加密实现。

如果现有 client 缺少某个接口，先在 Dashboard 中增加连接管理代码；不能修改加密格式，也不能另写一套与官方不同的 Relay 协议。

## 与 Paseo App 的关系

`/root/workspace/code/paseo/packages/app` 只作为功能和行为参考：

- 确认现有功能有哪些；
- 理解 daemon 消息如何转换成页面状态；
- 核对错误、重连、timeline 和 terminal 的处理细节；
- 为验收测试提供对照。

Dashboard 不做以下事情：

- 不 fork Paseo App；
- 不维护 Paseo App 下游分支；
- 不复制整个 `packages/app`；
- 不使用 Expo Router、React Native stores 或 AsyncStorage 作为项目基础；
- 不要求 Paseo 拆分共享 UI 包；
- 不要求 Dashboard 页面持续与 Paseo App 相同。

如果确实需要参考某段纯逻辑，应在 Dashboard 中按自己的数据结构实现，并记录参考的 Paseo 文件和 commit。不要把 React 页面或完整 store 原样搬入。

## 已验证的 Paseo 事实

- pairing offer schema 位于 `packages/protocol/src/connection-offer.ts`，包含 `serverId`、`daemonPublicKeyB64`、relay endpoint 和 TLS 标记。
- 当前 App 把 `HostProfile[]` 保存到本地 `AsyncStorage` key `@paseo:daemon-registry`。
- 当前粘贴 offer 流程会在客户端解析并直接连接 Relay/daemon，成功后再保存 Host。
- 当前 Paseo Web 不支持现有 native 扫码页，Dashboard Web 扫码需要自行实现。
- daemon 主动连接 Relay；Relay 可同时转发多个客户端连接。
- `DaemonClient` 已有连接状态和重连处理。
- Relay E2EE 使用 Paseo 官方实现，Dashboard 不进入加密数据路径。
- `serverId` 和 daemon keypair 跨普通重启持久化；普通重启不能撤销泄露的 pairing capability。

## Dashboard 中的连接层

Dashboard Web 在自己的代码中建立一个很薄的连接层，用来隔离页面和官方 client：

```ts
interface PaseoConnectionManager {
  connect(host: SyncedHost): Promise<void>;
  disconnect(hostId: string): Promise<void>;
  getState(hostId: string): HostConnectionState;
  subscribe(hostId: string, listener: () => void): () => void;
  getDaemonClient(hostId: string): unknown;
}
```

这个接口属于 Dashboard 项目内部，不发布给 Paseo App，也不要求 Paseo 上游采用。页面只访问 Dashboard 的连接层，不在各页面重复构造 `DaemonClient`。

连接层负责：

- 把 Dashboard 同步的 Host 转成 client 配置；
- 为每个 Host 保存连接状态；
- 管理建立、关闭和重连；
- 把 `DaemonClient` 事件交给 Dashboard 自己的页面状态；
- 在登出、删除 Host 或 session 失效时清理本地连接和 capability。

连接层不负责：

- Dashboard 登录；
- Host 服务端存储；
- Relay 加密实现；
- daemon 消息格式定义；
- 页面布局。

## 页面平移原则

第一阶段按功能逐项实现，不按 Paseo 文件逐项复制：

| 功能                   | Dashboard 实现方式                                            |
| ---------------------- | ------------------------------------------------------------- |
| Host 列表和切换        | 使用 Dashboard Host sync 数据，自行实现页面                   |
| Project/Workspace 列表 | 通过 client 调 daemon，自行建立页面状态                       |
| Agent 列表和生命周期   | 调用 client 对应方法，自行实现交互                            |
| Timeline               | 使用 daemon timeline 消息，自行实现展示和分页                 |
| 实时输出               | 订阅 client 事件，自行管理页面更新                            |
| Prompt                 | 通过 client 发送，自行实现输入区                              |
| 权限请求               | 订阅并响应 daemon 权限消息                                    |
| Terminal               | 使用现有 daemon binary frame 规则，自行实现 Web terminal 页面 |

前期可以先做到功能可用，不要求视觉一致。后期页面重构不应影响底层 daemon 连接测试。

## 兼容策略

Dashboard 不跟踪 Paseo App 版本，只跟踪 daemon 协议：

- 定期更新 `@getpaseo/client` 和 `@getpaseo/protocol`；
- 记录验证过的 daemon 版本范围；
- 使用旧 daemon/new client 测试；
- 新功能读取 `server_info.features.*` 后决定是否显示；
- 不用 Dashboard API 模拟 daemon 不支持的功能；
- Relay 连接测试使用官方测试向量和真实二进制 frame。

## Harmony

Harmony 与 Web 共用 Dashboard API、Host sync 格式和错误 code。

Harmony 是否能直接运行 `@getpaseo/client` 需要实机验证：WebSocket text/binary frame、`ArrayBuffer`、安全随机数、文本编码和 `tweetnacl` 都必须可用。

如果不能直接运行，应为相同 client 行为编写 Harmony 运行环境适配，而不是改变 Relay 加密格式。适配代码放在 Paseo Dashboard 项目中，不要求与 Paseo App 共享。

## 可能需要 Paseo 主仓库配合的事项

独立项目不要求 Paseo 为 Dashboard 拆分 App 或 UI。只有 daemon/Relay 必须共同支持的能力需要改 Paseo：

1. 正式的 daemon pairing key 轮换命令；
2. 未来 per-device credential 和撤销；
3. 新 daemon 功能及对应 `server_info.features.*`；
4. wire protocol 或 Relay E2EE 的兼容性修复。

本阶段不修改 `/root/workspace/code/paseo`。
