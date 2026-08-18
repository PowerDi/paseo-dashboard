# Paseo App 边界

## 当前状态

Paseo App 不接入 Dashboard 账号、session 或 Host 同步代码。`packages/app` 保持原有本地 Host、direct、desktop 和 pairing 行为。

Dashboard Web 使用自己的 Expo/Metro 服务和源码快照。它不映射 `packages/app` 的 Expo 服务，不导入 App 源码，也不要求 App 一起部署。Paseo App 只作为 UI 上游；同步规则见 [`upstream-sync.md`](upstream-sync.md)。

## 禁止的耦合

- 不在 `packages/app` 中添加 Dashboard Account 路由或 adapter。
- 不让 `packages/dashboard/web` import、symlink 或运行时读取 `packages/app`。
- 不让 Dashboard 入口转发到 Paseo App 的 Metro 服务。
- 不通过仓库外的 Dashboard 项目补齐运行时代码。

Dashboard 正式入口可以使用 Expo Web，但必须由 `packages/dashboard/web` 自己构建和运行。

## 未来重新接入 App 的门槛

如果以后重新要求 Paseo App 使用 Dashboard 账号，先单独设计并验证以下两项：

1. Host 重命名和删除需要持久化待同步操作。网络失败或 App 重启后仍要自动完成，远端旧数据不能恢复用户已经删除或改名的 Host。
2. refresh token 必须保存在 iOS Keychain 或 Android Keystore 等平台安全存储，不能放入 AsyncStorage。

满足这两项前，不在 App 中恢复 Dashboard 账号集成。
