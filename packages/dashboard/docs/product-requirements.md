# 产品需求

## 产品定义

Paseo Dashboard 解决的是 **Paseo Host 配置无法随账号跨设备同步** 的问题。当前 Paseo App 把 `HostProfile[]` 保存到客户端本地的 `AsyncStorage`，浏览器或设备之间没有账号、授权、同步、设备撤销和审计层。Dashboard 增加这层控制配置面，同时不改变现有 daemon 数据协议。

### 第一阶段用户

- 在家用服务器、VPS、工作站或多台开发机运行一个或多个 Paseo daemon 的个人开发者。
- 需要从多台电脑和手机浏览器查看、控制同一批 agent 的用户。
- 接受自托管服务，并希望代码和 agent 数据继续留在 daemon 所在机器的用户。

### 为什么不用当前 daemon Web UI

daemon 托管的 Web UI 能自动连接同源 daemon，也能添加多个 Host，但 Host 注册表仍保存在当前浏览器本地。它没有 Dashboard 账号、跨设备授权、设备列表或服务端审计。将 daemon Web UI 暴露到公网还会扩大 daemon 本身的网络暴露面。

### 为什么不用浏览器同步或密码管理器

- 浏览器不会可靠同步应用的 `AsyncStorage`/IndexedDB Host 注册表，也不能覆盖 Harmony 等非浏览器客户端。
- 密码管理器可以保存文本秘密，但不提供 Host 数据模型、版本冲突、删除 tombstone、设备撤销、审计或未来共享授权。
- 将完整 pairing URL 当普通密码条目手工复制，仍要求每台设备重复配置，并容易进入剪贴板历史和日志。

## 已定目标

- 用户注册、登录、刷新 session、登出和管理登录设备。
- 导入或扫描 pairing offer，完成格式校验、客户端 E2EE 连接验证和 Host 命名。
- 按用户加密持久化 Host 配置并同步到其他已登录设备。
- 登录后由 Dashboard 自己的页面实现 Paseo 的主要 daemon 功能；数据由浏览器直接从 daemon 获取。
- 支持多个 daemon、在线/离线/连接失败状态和多 Host 切换。
- 提供 Host 删除、账户管理、pairing 操作审计和敏感数据生命周期。
- 为 Harmony 提供同一版本化 API 与同步协议。

## 非目标

- 不新增 daemon → Dashboard 协议，不让 daemon 注册或上报到 Dashboard。
- 不代理或缓存 daemon WebSocket、timeline、terminal、prompt、文件、权限请求或 agent 状态。
- 不使用 Hub 架构，不把 Paseo Hub 当实现基础。
- 不复制或重新实现 Relay 加密。
- MVP 不承诺零知识存储、多人 Host 分享或单设备 daemon credential 撤销。
- Dashboard 不判断 daemon 在线状态；在线状态由登录客户端直接连接后得出。

## 用户流程

### 注册与登录

1. 用户打开 Dashboard，创建首个账号或登录已有账号。
2. 服务端创建 `Device` 与 `Session`，Web 使用安全 Cookie，显示设备名称和最近活动。
3. 客户端完成 Host 初始全量同步；没有 Host 时显示解释边界的空状态。

### 首次 pairing

1. 用户在 daemon 侧生成 pairing URL/QR。
2. 粘贴流程：Dashboard 前端读取 URL fragment，使用 Paseo `ConnectionOfferSchema`/parser 校验，立即从地址栏移除 fragment。
3. 扫码流程：浏览器在用户授权后读取二维码；不支持摄像头时回退到粘贴。现有 Paseo `pair-scan` 在 Web 上明确不可用，因此 Dashboard Web 扫码是新增 UI，不是假定可直接复用。
4. 前端只允许 `v: 2` 和合法的 `serverId`、`daemonPublicKeyB64`、relay endpoint、TLS 标记；拒绝额外协议猜测。
5. 前端用 offer 构造现有 `DaemonClient`，直接连接 Relay 并完成 E2EE 握手，等待 `server_info`，确认响应身份与 offer 一致。
6. 验证失败时不保存；区分 Relay 不可达、daemon 离线、E2EE 握手失败、协议不兼容和超时。
7. 用户确认 Host 名称和外观后，通过 TLS 将规范化 Host 配置提交 Dashboard。服务端再次做结构校验，但不连接 Relay。
8. Dashboard 加密保存 capability，写入审计事件，返回新的同步 revision。

### 多设备同步和使用

1. 第二台设备登录同一账号，调用 Host sync API。
2. 客户端获得授权的 relay `HostConnection`，只保存在受控客户端存储中。
3. 客户端直接连接 Relay/daemon，并使用 Paseo UI 加载 projects、workspaces、agents、timeline、terminal 和权限请求。
4. daemon 离线不影响 Dashboard 登录或 Host 列表；Host 显示离线，客户端按现有重连策略重试。
5. Relay 不可用时显示“Relay 不可达”，不要把它显示成登录失败或 Host 未授权。

### 删除、设备和账户

- 删除 Host：Dashboard 写 tombstone 并推进账号 revision；在线设备立即删除，本地离线设备在下次同步删除。
- 撤销 session：该 session 后续 refresh 和同步请求失败；已下载 capability 仍可能直接连接 daemon，这是当前协议限制。
- 撤销设备：撤销该设备全部 session；不声称能远程擦除离线客户端保存的 capability。
- 修改密码：撤销其他 session，轮换当前 refresh token；是否保留当前设备由用户选择。
- 忘记密码：暂不提供（无邮件基础设施时存在攻击面）。用户使用修改密码功能（需当前密码）或管理员 CLI 重置。
- 删除账户：立即撤销 session，软删除并排队清除 Host 密文、grant、设备和审计保留字段；保留期写入部署策略。
- capability 泄露：立即从 Dashboard 删除 Host、撤销可疑 session，并在 daemon 侧轮换 keypair/server identity 后重新 pairing。普通重启不会轮换。

## 页面与信息架构

| 页面             | 归属               | 说明                                                                    |
| ---------------- | ------------------ | ----------------------------------------------------------------------- |
| 登录、注册       | Dashboard 新增     | 账号和 session 入口（忘记密码暂不提供）                                 |
| Host 列表/空状态 | Dashboard 自行实现 | 展示同步配置，不由服务端探测在线                                        |
| 添加 Host        | Dashboard 新增     | 粘贴、Web 扫码、校验、验证、命名                                        |
| Agent 主面板     | Dashboard 自行实现 | 前期覆盖 projects、workspaces、agents、timeline、terminal、prompt、权限 |
| 多 Host 切换     | Dashboard 自行实现 | 使用 Dashboard 同步的 Host 和自己的连接管理                             |
| 账户设置         | Dashboard 新增     | 资料、密码、删除账户                                                    |
| 登录设备管理     | Dashboard 新增     | session、最后活动、撤销                                                 |
| 安全设置         | Dashboard 新增     | 密钥状态、敏感操作、未来 vault                                          |
| 审计记录         | Dashboard 新增     | 不含 capability 原文                                                    |
| 离线/连接失败    | Dashboard 自行实现 | 使用官方 client 状态，按 Relay、daemon、协议错误区分                    |

## 可测试验收标准

- 浏览器 A 配置一次后，浏览器 B 登录同一账号能直接看到 Host。
- 浏览器 B 能使用同步的 Host 配置，通过 Relay 与 daemon 建立 E2EE，并收到 `server_info`。
- Dashboard 服务端、反向代理和数据库观测链路不接收 agent timeline 或 daemon WebSocket frame。
- pairing offer、`daemonPublicKeyB64`、token 和完整 `HostConnection` 不出现在普通日志、错误追踪和分析事件。
- 撤销 session 后，该设备不能继续调用同步 API 或刷新 token。
- 删除 Host 后，其他在线设备收到 tombstone；离线设备下次同步删除。
- daemon 离线时用户仍可登录 Dashboard、管理账户和查看 Host 元数据。
- Relay 不可用时客户端显示明确、可重试的 Relay 错误。
- 新客户端连接旧 daemon 时遵守 Paseo wire compatibility，并用 `server_info.features.*` gating 新功能。
- Web 与 Harmony 对相同 API fixture 得到相同业务结果和错误 code。
- 自动化网络断言证明 Dashboard 域名没有 timeline、terminal、prompt 或 daemon RPC 请求。
