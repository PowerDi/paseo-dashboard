# Dashboard 实现状态

## 已实现

- Dashboard Server 提供账号、session、设备、Passkey、加密 Host、增量同步、审计和 tombstone。
- Dashboard Web 是独立 Expo Router、React Native Web、Metro 和 Unistyles 项目。
- Dashboard Web 的 Workspace、Agent、Timeline、Terminal、Composer、Settings 和设计系统来自明确 Paseo App commit 的源码快照。
- 未登录时只请求 `/api/v1/me`，不加载 Host，不处理 pairing，不连接 Relay 或 daemon。
- 登录后从账号加载 Relay Host，并注入 Dashboard 模式 HostRuntime。
- Settings 提供独立账号入口，可查看账号、刷新已 pairing Host、添加 pairing、删除 Host 和退出登录。
- Pairing 先验证 Relay/E2EE daemon，再写入 Dashboard API；API 成功后才进入正式 Host 列表。
- Host 重命名和删除先等待 Dashboard API 成功，再更新 UI。
- Dashboard 模式不读取本地 Host registry，不启动 Desktop daemon，不处理 initial hint，不自动连接 `localhost:6767`，也没有 direct connection UI。
- Dashboard Web 不依赖 `packages/app`；Paseo App 已还原为原有本地产品。
- 本地入口使用 Metro `8082`，其 `/api/*` 在开发机内部代理到 API `3002`。
- Dashboard CI 已配置构建、契约测试和登录边界浏览器 smoke test。

## 发布前待完成

- [ ] 执行真实 Dashboard Server、真实账号、真实 Relay/daemon 的登录—Pairing—跨浏览器恢复—注销 E2E。
- [ ] 在 Dashboard Settings 增加设备撤销、Passkey 和审计事件页面。账号与已 pairing Host 管理已完成。
- [ ] 验证生产 CORS、WebAuthn origin/RP ID、CSP 和 Relay `connect-src`。

Paseo App 若未来接入 Dashboard，必须先满足 [`paseo-integration.md`](paseo-integration.md) 的持久化待同步操作和平台安全 token 存储要求。

## 验证

按根测试规则运行修改过的目标文件。Dashboard 全量行为由 CI 执行：

```bash
npm run build:dashboard
npm run typecheck:dashboard
npm run test:dashboard
npm run test:browser --workspace=@getpaseo/dashboard-tests-e2e
```
