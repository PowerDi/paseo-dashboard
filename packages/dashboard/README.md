# Paseo Dashboard

Dashboard 是 Paseo 的账号与多 Host 持久化控制面。它保存用户、设备、session 和加密的 Relay Host 配置。独立 Dashboard Web 登录后从账号加载 Host，再由浏览器经 Relay/E2EE 直连 daemon。

Dashboard Server 不代理 Agent、Timeline、Terminal、文件或其他 daemon 数据。

## 目录

```text
packages/dashboard/
├── shared/          # Dashboard API 契约
├── server/          # 账号、设备、Host 持久化与同步 API
├── web/             # 独立 Expo/Metro Dashboard Web
├── tests/contract/  # API 契约和安全边界测试
├── tests/e2e/       # 浏览器边界与跨包兼容测试
└── docs/            # Dashboard 文档和 UI 上游同步记录
```

Dashboard Web 使用自己的 Expo Router、React Native Web、Metro 和 Unistyles 源码。它不依赖 `packages/app`。UI 按 [`docs/upstream-sync.md`](docs/upstream-sync.md) 从明确的 Paseo App commit 同步，移植后的源码保存在 `web/` 内。

## 本地开发

```bash
# Dashboard API，127.0.0.1:3002
npm run dev:dashboard:server

# Dashboard Expo/Metro，8082；内部代理 /api 到 3002
npm run dev:dashboard:web
```

浏览器只需要访问或映射 `http://localhost:8082`。不要把 API `3002` 单独暴露给浏览器入口。

## 验证

```bash
npm run build:dashboard
npm run typecheck:dashboard
npm run test:browser --workspace=@getpaseo/dashboard-tests-e2e
```
