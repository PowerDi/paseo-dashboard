# 路线图

时间估算不是承诺。每个里程碑先满足退出条件，再扩大范围。

## M0：架构验证

**范围**

- 最小本地 Dashboard API 和临时持久层。
- 一个用户、一个 Host、一个 Web 客户端。
- 初始化独立 Web/API 项目，验证 `@getpaseo/client` 和 `@getpaseo/protocol` 能在 Web build 中使用。
- 浏览器 A 保存 capability，浏览器 B 同步后直接通过 Relay/E2EE 连接 daemon。
- 网络抓包/测试证明 Dashboard 不接收 daemon 数据。

**退出条件**

- 第二浏览器收到 `server_info`，且 Dashboard 后端只看到 auth/Host API。
- capability 在数据库中为密文，日志和错误追踪 fixture 无原文。
- 得到 Dashboard connection manager 的最小接口和官方 client 缺口清单。

**风险**

- 官方 client 的公开接口可能不足以覆盖现有 App 的全部能力。
- Web bundler 对 Relay E2EE、`tweetnacl` 或 binary frame 的处理可能需要配置。

**不包含**

- 完整 UI、生产认证、Harmony、共享、零知识。

## M1：单用户自托管 MVP

**范围**

- 首个用户注册后关闭公开注册。
- 邮箱/用户名密码、session、refresh rotation、密码重置的本地管理方案。
- Host 导入、客户端连接验证、命名、列表、更新和删除。
- envelope encryption、基础审计、备份恢复说明。
- 粘贴 offer；浏览器支持时本地扫码，始终保留粘贴回退。

**退出条件**

- 单用户可在两浏览器登录、同步和删除 Host。
- session/device 撤销语义通过测试且 UI 提示 daemon capability 限制。
- daemon/Relay 离线不影响 Dashboard 账户功能。

**风险**

- 自托管邮件不可用导致忘记密码流程困难；需要管理员 recovery code/CLI 方案。
- KEK 部署错误导致备份不可恢复或数据库与 key 同时泄露。

**不包含**

- 多用户开放注册、Host 分享、完整 Paseo 主面板。

## M2：多设备登录与 Host 同步

**范围**

- 账号级 revision、增量 sync、tombstone、乐观并发和幂等键。
- 设备/session 页面、远程撤销和最近活动。
- 多标签页实时失效通知，可用 SSE/WebSocket 仅承载 Dashboard 配置事件，不承载 daemon 数据。
- 完整 rate limit、CSRF、CSP、日志 redaction 和审计查询。

**退出条件**

- 三个设备并发修改、删除、离线恢复时状态最终一致。
- revoked session 不能继续 sync；refresh reuse 可被检测。
- 删除 tombstone 在离线设备恢复后生效。

**风险**

- 用户误解“设备撤销”等于 daemon access 撤销。
- revision 压缩和 tombstone 清理过早造成 Host 复活。

**不包含**

- 多人授权、daemon per-client revoke。

## M3：主要 Paseo 功能实现

**范围**

- 在 Dashboard 独立 Web 项目中实现 projects、workspaces、agents、timeline、terminal、prompt、权限和 Host 切换。
- 页面、路由、状态管理和设计系统都由 Dashboard 自己维护。
- `@getpaseo/client` 的调用统一经过 Dashboard connection manager。
- 建立 daemon 版本矩阵和主要功能的兼容测试。
- 对旧 daemon 走现有 protocol compatibility 与 feature gating。

**退出条件**

- Dashboard 登录后可完成目标清单中的主要 daemon 操作。
- agent 数据只出现在浏览器 ↔ Relay/daemon 网络连接。
- 页面可独立调整，不依赖 Paseo App build 或 source tree。
- 新旧 daemon 兼容 smoke tests 通过。

**风险**

- timeline、terminal 和权限等功能重新实现的工作量较大。
- 官方 client/API 缺口可能迫使 Dashboard 写更多连接管理代码。

**不包含**

- 复制或 fork Paseo App；要求页面视觉与 Paseo App 长期一致。

## M4：多用户与设备安全

**范围**

- 开放注册/邀请、管理员策略。认证边界见 `security.md`。
- Passkey、风险登录提示、精细 session/device 审计。
- 生产 KMS、在线 key rotation、备份/恢复演练。
- `HostGrant` 数据模型启用前的授权审查，但不在 daemon 无 scope 时提供虚假只读权限。

**退出条件**

- 租户隔离和越权测试覆盖所有 Host/API。
- key rotation 不停机且旧 key 可安全退休。
- 注册、登录、refresh 和导入 abuse tests 通过。

**风险**

- 多用户使 capability 泄露影响半径增大。
- Host 分享受 daemon credential 模型限制。

**不包含**

- 在协议不支持时实现细粒度 daemon RBAC。

## M5：Harmony 客户端

**范围**

- Harmony runtime capability probe 和 adapter。
- Dashboard auth、Host sync、平台安全 token 存储。
- 复用 Paseo daemon connection core，完成 binary frame/E2EE 测试向量。
- 最小 Host/Agent UI，再逐步扩展功能。

**退出条件**

- Harmony 与 Web 通过同一 API contract test。
- Harmony 用同步 capability 经 Relay 与 daemon 完成 E2EE。
- token 和 Host capability 存平台安全存储，日志无秘密。

**风险**

- WebSocket、CSPRNG、`tweetnacl` 或二进制语义不兼容。
- ArkTS 与 npm/TypeScript package 互操作限制。

**不包含**

- 独立重写加密协议。

## M6：可选高级能力

**范围**

- 零知识 client-side vault 与恢复模型。
- Host 分享，前提是 daemon 有可撤销、可范围化 credential。
- 自托管 Relay 部署配置；逻辑仍与 Dashboard 独立。
- daemon per-client credential、allowlist、rotation 和 revoke 的 Paseo 协议演进。

**退出条件**

- 零知识威胁模型、恢复和多设备引导经独立安全审查。
- 单个共享用户/设备可被 daemon 真正撤销，不要求轮换所有用户。
- 自托管 Relay 故障不影响 Dashboard 认证和配置管理。

**风险**

- 密钥恢复与零知识目标冲突。
- 新 daemon credential 协议需要长周期兼容。

**不包含**

- Dashboard 代理 agent 数据或与 Relay 合并为单一信任域。
