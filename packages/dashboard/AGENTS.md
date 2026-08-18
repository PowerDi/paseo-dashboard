# Paseo Dashboard Agent Instructions

## 范围

Dashboard 包含账号核心和独立 Web UI：

- `shared/` 定义 API 请求、响应和持久化 Host 契约。
- `server/` 管理用户、session、设备、加密 Host、同步和审计。
- `web/` 是独立构建和部署的登录优先 Dashboard UI。
- `tests/contract/` 验证 API、租户隔离、撤销和 tombstone 语义。
- `tests/e2e/` 验证浏览器边界和跨包兼容性。

Agent、Workspace、Timeline、Terminal、Composer 和文件浏览器只能进入 `web/`，不能进入 `shared` 或 `server`。

## 开发前阅读

- 修改目录或依赖方向：`docs/architecture.md`
- 修改账号、Pairing 或 Host 行为：`docs/product-requirements.md`
- 修改 Dashboard Web 或同步 Paseo App UI：`docs/upstream-sync.md`
- 修改 Paseo App 边界：`docs/paseo-integration.md`
- 修改认证、密钥、日志或租户边界：`docs/security.md`
- 修改启动方式：`docs/local-development.md`

仓库根目录 `CLAUDE.md` 的测试、格式化、daemon 保护和平台规则始终适用。

## 依赖规则

- `server` 只能依赖 `shared`，不得连接 Relay 或 daemon。
- `web` 可以依赖 Dashboard API、Paseo client、protocol 和 relay。
- `web` 不得 import、symlink、运行时加载或通过 manifest 依赖 `packages/app`。
- `web` 可以按 `docs/upstream-sync.md` 从已提交的 Paseo App commit 移植选定模块；移植后的源码必须保存在 `web` 内并独立构建。
- Paseo 不得通过 import、manifest、symlink、文件系统路径或运行时加载依赖仓库外代码。
- 新 API 字段保持兼容；敏感 connection、token 和密码不得进入普通日志。

## Dashboard Web 固定行为

- 登录完成前不加载 Host，不处理 pairing，不连接 Relay 或 daemon。
- 登录后允许 pairing；验证和确认成功后立即写入当前账号。
- 不自动连接 `localhost:6767`，不提供任意地址直连。
- 正式 Host 只来自当前账号，不能留下只存在浏览器本地的正式 Host。
- Dashboard Server 不代理 daemon 数据。

## 上游 UI 同步

每次同步 Paseo App UI 时：

1. 先读取 `docs/upstream-sync.md`。
2. 使用完整、已提交的 Paseo App commit SHA；不能使用分支名、`latest` 或未提交工作树。
3. 只同步任务明确列出的模块，不覆盖整个 Dashboard Web。
4. 保留 Dashboard Web 固定行为，不增加对 `packages/app` 的依赖。
5. 运行目标测试、Dashboard 构建、typecheck、lint 和格式检查。
6. 验证通过后更新当前基线、模块表和最近同步记录。
7. 最近同步记录最多保留五条；更早记录留在 Git 历史。
8. 代码和同步文档放在同一个 commit。测试失败时不能标记为已同步。

新增、删除或拆分 Dashboard Web 模块时，同一次修改必须更新 `docs/upstream-sync.md` 的模块表。
