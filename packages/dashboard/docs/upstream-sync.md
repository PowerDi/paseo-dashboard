# Dashboard UI 上游同步

## 目的

`packages/dashboard/web` 是独立 Expo/Metro 项目，不导入 `packages/app`。Dashboard 按 Paseo App 的明确 commit 同步选定 UI 模块；运行时、构建时和部署时都不读取 App 源码。

同步记录只证明已经审查和移植的模块。不能把分支名、未提交工作树或“latest”写成同步基线。

## 当前基线

- 状态：首次 Expo 模块同步完成，等待本次改动提交
- Paseo App commit：`da0ffeddf5d69edf51f98cdaa018bbdd3dbe1a1d`
- Paseo App version：`0.3.1`
- commit 日期：2026-08-16
- 同步日期：2026-08-18
- 同步方式：复制该 commit 的 Expo Router、React Native Web、Metro、Unistyles 和工作面源码到 `packages/dashboard/web`，再应用 Dashboard 登录与账号 Host 边界。

## 最近五次同步

| Paseo App commit                           | App version | 日期       | 模块                                                                            | 状态   | 验证 |
| ------------------------------------------ | ----------- | ---------- | ------------------------------------------------------------------------------- | ------ | ---- |
| `da0ffeddf5d69edf51f98cdaa018bbdd3dbe1a1d` | `0.3.1`     | 2026-08-18 | Expo 外壳、Host/Pairing、Workspace、Agent/Timeline、Terminal/Composer、Settings | 已同步 | 通过 |

这里只保留最近五次记录。更早记录由 Git 历史保存。

## 模块表

| Dashboard 模块       | Paseo App 上游范围                              | Dashboard 固定差异                                    | 状态   | 最近同步 |
| -------------------- | ----------------------------------------------- | ----------------------------------------------------- | ------ | -------- |
| Expo 外壳与设计系统  | Expo Router、React Native Web、Metro、Unistyles | Dashboard 自有 app config、Metro API proxy 和登录门槛 | 已同步 | `da0ffe` |
| 认证外壳             | Dashboard 自有                                  | 登录完成前不启动 Host 或 daemon 连接                  | 已同步 | `da0ffe` |
| Host 与 Pairing      | Host 列表、pairing link 交互                    | 删除 direct/localhost/匿名 pairing；成功后写入账号    | 已同步 | `da0ffe` |
| Workspace            | Workspace 页面、文件浏览和通用工作区组件        | Host 只来自当前账号                                   | 已同步 | `da0ffe` |
| Agent 与 Timeline    | Agent 树、状态、Timeline 和权限交互             | Dashboard Server 不进入 daemon 数据路径               | 已同步 | `da0ffe` |
| Terminal 与 Composer | Terminal、输入框、新会话和权限处理              | 浏览器经 Paseo client 直接连接 daemon                 | 已同步 | `da0ffe` |
| Settings 与主题      | 设置页面、设计 token 和基础组件                 | 独立账号入口管理 pairing、Host 刷新/删除和登出        | 已同步 | `da0ffe` |

## Dashboard 固定差异

- Dashboard Web 必须先登录。
- pairing 只在登录后出现，导入成功后必须立即属于当前账号。
- Host 列表只来自账号，不自动连接 localhost，不允许任意地址直连。
- Dashboard Server 不代理 Agent、Timeline、Terminal、文件或 RPC 数据。
- Dashboard Web 不 import、symlink 或运行时读取 `packages/app`。
- Dashboard 使用自己的 Metro 入口；不能把请求转发给 Paseo App 的 Metro。

## 同步流程

1. 选择一个已提交的 Paseo App commit。未提交工作树不能作为基线。
2. 记录该 commit 中 `packages/app/package.json` 的版本。
3. 确认 Dashboard workspace 和 Expo 配置使用相同版本；Dashboard 配置只读取自己的 package。
4. 在模块表中写明本次范围。
5. 对比 App 模块与 Dashboard 对应模块，只移植选定变化。
6. 保留 Dashboard 固定差异。
7. 更新目标测试、模块表和最近同步记录。
8. 运行构建、目标测试、typecheck、lint、format 和依赖边界扫描。
9. 验证通过后把记录中的验证状态改为“通过”。

## 验证要求

- `packages/app` 相对基线没有 Dashboard 集成改动；
- `packages/dashboard/web` 的源码和 manifest 不依赖 `packages/app`；
- 未登录页面不显示 Host 或 pairing，也不连接 Relay/daemon；
- 登录后才显示账号 Host 和 pairing；
- pairing 导入失败不会留下本地正式 Host；
- Dashboard Web 不提供 localhost 或任意地址直连；
- Metro `8082` 的 `/api/*` 只代理到内部 Dashboard API；
- `npm run build:dashboard`、Dashboard typecheck、目标测试、lint 和格式检查通过。

本次结果：Expo Web 构建、Dashboard typecheck、根 lint 和格式检查通过；21 个 Dashboard Web 定向测试、73 个路由与多语言定向测试和 3 个浏览器认证/账号边界测试通过。契约测试已完成定向验证。
