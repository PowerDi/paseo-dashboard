# 本地开发

## Dashboard Server + Expo Web

```bash
# 终端 1：先构建 shared，再启动 Dashboard API
# 监听 127.0.0.1:3002，允许 http://localhost:8082
npm run dev:dashboard:server

# 终端 2：启动 Dashboard 自己的 Expo/Metro
# 监听 8082，并把 /api/* 代理到 127.0.0.1:3002
npm run dev:dashboard:web
```

浏览器只访问或映射 `8082`。登录 Cookie、`/api/v1/me` 和 Host 请求都使用 `8082` 的同源 `/api/*` 路径；Metro 在开发机内部转发到 `3002`。

`packages/dashboard/web` 使用自己的 Expo Router、React Native Web 和 Unistyles 源码。它不启动或读取 `packages/app` 的 Expo 服务。

要更换内部 API 地址，设置：

```bash
PASEO_DASHBOARD_API_URL=http://127.0.0.1:3002 \
npm run dev --workspace=@getpaseo/dashboard-web
```

Dashboard 模式由 Web 脚本设置 `EXPO_PUBLIC_PASEO_DASHBOARD=1`。不要去掉它；HostRuntime 依靠这个边界跳过本地 Host registry、Desktop daemon、initial hint 和 `localhost:6767`。

## CORS 与 WebAuthn

根开发脚本把 CORS 和 WebAuthn origin 设为 `http://localhost:8082`。自定义启动时保持页面 origin 一致：

```bash
PASEO_BOARD_PORT=3002 \
PASEO_BOARD_CORS_ORIGIN=http://localhost:8082 \
PASEO_BOARD_WEBAUTHN_ORIGIN=http://localhost:8082 \
npm run dev --workspace=@getpaseo/dashboard-server
```

Passkey 要求页面 origin、`PASEO_BOARD_WEBAUTHN_ORIGIN` 和 RP ID 匹配。生产使用实际 HTTPS 域名。

## 验证

```bash
npm run build:dashboard
npm run typecheck:dashboard
npm run test:browser --workspace=@getpaseo/dashboard-tests-e2e
```
