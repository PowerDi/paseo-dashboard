# Dashboard 架构

## 系统边界

Dashboard 是账号与 Host 配置控制面。独立 Dashboard Web 使用 Dashboard Server 保存账号数据，使用 Paseo Relay/E2EE 直接连接 daemon。

```text
Dashboard Web ── HTTPS ── Dashboard Server
      │                         │
      │                         └── User / Session / Device / encrypted Host
      │
      └── Paseo E2EE WebSocket ── Relay ── daemon
```

Dashboard Server 不连接 Relay 或 daemon，不接收 timeline、terminal、prompt、文件内容、权限请求或 daemon RPC。

## 目录职责

```text
packages/dashboard/
├── shared/src/           # Dashboard API 契约和共享实体
├── server/src/           # 持久化、认证、加密、同步和审计
├── web/src/              # 独立 Expo/Metro 登录优先 UI 与 daemon 工作面
├── tests/contract/       # 服务端契约与安全边界
├── tests/e2e/            # 浏览器边界与跨包兼容性
└── docs/                 # 核心设计与 UI 上游同步记录
```

Paseo 仓库包含 Dashboard 运行所需的完整源码。代码、manifest、symlink、运行时加载和文档命令都不得把仓库外目录作为依赖。

## 依赖方向

```text
dashboard/web ────────────▶ dashboard/shared
dashboard/web ────────────▶ Dashboard API
dashboard/web ────────────▶ Paseo client/protocol/relay

dashboard/server ─────────▶ dashboard/shared
dashboard/tests/contract ─▶ dashboard/server + dashboard/shared
```

`dashboard/shared` 先编译到 `dist`。Server 和 Web 使用相同契约，但不共享页面或状态实现。

`dashboard/web` 拥有自己的 Expo Router、React Native Web、Metro、Unistyles、页面和状态。它不导入 `packages/app`。开发时可以按明确 commit 移植 Paseo App UI；同步完成后的源码必须留在 Dashboard 内。

## Host 数据流

1. 未登录页面只初始化认证状态。
2. 登录成功后，Web 从 Dashboard Server 拉取当前账号 Host。
3. Web 使用 Host 内的加密 Relay connection 直接连接 daemon。
4. 添加 pairing 时，浏览器先验证 offer 和 daemon，再调用 Dashboard API 保存 Host。
5. API 成功后，Host 才进入正式列表。
6. 重命名和删除以服务端确认结果更新 UI；删除写入 tombstone，其他登录设备在同步后移除 Host。

Dashboard Web 不从本机 Host 注册表导入正式 Host，不自动连接 localhost，也不支持任意地址直连。

## UI 同步边界

Paseo App 是 Dashboard Web 的 UI 上游，不是运行时依赖。每次同步只移植 [`upstream-sync.md`](upstream-sync.md) 指定模块，并保留以下差异：

- Dashboard 必须先登录；
- pairing 成功必须写入账号；
- Host 只来自账号；
- Dashboard Server 不代理 daemon 数据。
