# Paseo Dashboard

Paseo Dashboard 是 Paseo monorepo 内的 Host 配置跨设备同步控制面。它管理用户身份和 Host capability（pairing offer 加密存储 + 多设备同步），浏览器/Harmony 客户端从 Dashboard 获取配置后直接通过 Paseo Relay/E2EE 连接 daemon。Dashboard 不代理 daemon 数据。

## 在 monorepo 中的位置

```
packages/dashboard/
├── shared/           # API 契约类型（@getpaseo/dashboard-shared）
├── server/            # Dashboard API（@getpaseo/dashboard-server）
├── web/               # 浏览器应用（@getpaseo/dashboard-web）
├── tests/
│   ├── contract/      # API 契约测试
│   └── e2e/           # 端到端测试
└── docs/              # 设计文档
```

Dashboard 依赖 `@getpaseo/client` 和 `@getpaseo/protocol`（monorepo 内直接引用），不依赖 `@getpaseo/app`。

## 开发

```bash
# 从 monorepo 根目录

# 构建 dashboard 依赖（client/protocol/relay）
npm run build:client && npm run build:relay

# 构建 dashboard
npm run build:dashboard

# 启动后端（端口 3000）
npm run dev:dashboard:server

# 启动前端 dev server（端口 5173）
npm run dev:dashboard:web

# 测试
npm run test:dashboard

# 类型检查
npm run typecheck:dashboard
```

## 环境变量

| 变量                            | 默认值                  | 说明                             |
| ------------------------------- | ----------------------- | -------------------------------- |
| `PASEO_BOARD_HOST`              | `127.0.0.1`             | 监听地址                         |
| `PASEO_BOARD_PORT`              | `3000`                  | 监听端口                         |
| `PASEO_BOARD_DATA_DIR`          | `./data`                | 数据目录（SQLite + KEK）         |
| `PASEO_BOARD_KEK_FILE`          | 空（开发自动生成）      | 生产必须指定外部 32 字节密钥文件 |
| `PASEO_BOARD_CORS_ORIGIN`       | `http://localhost:5173` | CORS 允许来源                    |
| `PASEO_BOARD_REGISTRATION_OPEN` | `true`                  | 注册开关，首用户后设 `false`     |

## 当前状态

M1 完成：用户认证、Host 生命周期、加密存储、审计。Agent 面板（M3）待实现。

详见 `docs/progress.md`。
