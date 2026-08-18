# Dashboard 产品要求

## 核心功能

Dashboard 为同一账号持久化多个 Relay Host。用户登录后添加 pairing，后续在其他浏览器登录同一账号即可恢复这些 Host。

## 登录门槛

- 未登录只显示认证页面。
- 未登录不读取 Host，不解析 pairing，不连接 Relay 或 daemon。
- 登录成功后才加载 Dashboard 工作面和账号 Host。

## 添加 Pairing

1. 已登录用户粘贴 pairing offer。
2. 浏览器验证 daemon 身份和 E2EE 连接。
3. 用户确认后，Dashboard Web 立即把 Host 导入当前账号。
4. 导入成功后 Host 才进入正式列表。
5. 导入失败时显示错误，不能留下只存在浏览器本地的正式 Host。

Dashboard Web 不自动连接 `localhost:6767`，不提供任意地址直连，也不读取 Paseo App 的本机 Host 列表。

## 使用 Host

- 正式 Host 列表只来自当前账号。
- 浏览器经 Relay/E2EE 直接连接 daemon。
- Dashboard Server 不代理 Agent、Workspace、Timeline、Terminal、Composer 或文件数据。
- 退出登录立即断开全部 Host，并清除账号 UI 状态。

## 修改与删除

- 重命名和删除在 Dashboard API 成功后更新 UI。
- 服务端冲突或网络失败必须显示失败，不能在本地假装操作已经完成。
- 删除写入 tombstone，并允许用户以后重新 pairing 同一个 daemon。
- 如果未来改为离线乐观更新，必须先增加持久化待同步队列，覆盖刷新页面和浏览器重启。

## 账号入口

Dashboard Web 提供：

- 登录和注册；
- 当前账号与角色；
- 已保存的 pairing；
- 登录后添加 pairing；
- 设备列表与撤销；
- 审计事件；
- 登出。

## 非目标

- 不在 Dashboard Server 代理 daemon 数据；
- 不持久化 direct/desktop connection；
- 不把 Dashboard Web 作为匿名或本地优先客户端；
- 不让 Dashboard Web 在运行时或构建时依赖 `packages/app`；
- 不从 Paseo 仓库外加载 Dashboard 运行时代码。

## 验收

- 未登录时不能读取 Host、处理 pairing 或连接 daemon。
- 登录后可以完成 pairing，并把 Host 立即保存到当前账号。
- 另一浏览器登录同一账号后能恢复全部 Host。
- 不自动连接 localhost，不允许任意地址直连，不保留未写入账号的正式 Host。
- 添加、重命名和删除 Host 会更新账号数据。
- tombstone 会使其他登录设备在下一次同步移除已删除 Host。
- 无效或撤销的 session 不能继续同步。
- 日志不包含 token、密码或完整 Host connection。
