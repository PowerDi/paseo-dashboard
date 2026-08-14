# 本地开发指南

## 快速启动

```bash
# 终端 1 - 启动 API 服务器 (端口 3000)
cd packages/dashboard/server
npm run dev

# 终端 2 - 启动 Web 前端 (端口 5173)
cd packages/dashboard/web
npm run dev
```

访问：`http://localhost:5173`（**必须用 localhost，不能用 127.0.0.1**）

## Origin 校验

Dashboard API 默认只接受来自 `http://localhost:5173` 的请求。**必须使用 localhost 访问前端**，否则会遇到 403 Forbidden 错误：

- ✅ `http://localhost:5173` - 正常
- ❌ `http://127.0.0.1:5173` - 403（Origin 不匹配）

### 原因

服务器在 `lib/security.ts` 中对所有状态变更请求（POST/PATCH/PUT/DELETE）进行 Origin 校验：

```typescript
if (origin && !originMatches(origin, allowedOrigin)) {
  return 403; // "Origin 不被允许"
}
```

`http://localhost:5173` 和 `http://127.0.0.1:5173` 在浏览器中被视为不同的 origin。

### 自定义 Origin

如果需要从其他地址访问（比如远程调试），设置环境变量：

```bash
export PASEO_BOARD_CORS_ORIGIN="http://localhost:5173"  # 默认
# 或
export PASEO_BOARD_CORS_ORIGIN="*"  # 开发环境临时禁用校验（不推荐）

cd packages/dashboard/server
npm run dev
```

**生产环境**必须设置实际的前端域名，不能使用 `*`。

## 环境变量

所有 Dashboard 服务器配置通过环境变量控制（见 `server/src/config.ts`）：

| 变量                             | 默认值                  | 说明                                     |
| -------------------------------- | ----------------------- | ---------------------------------------- |
| `PASEO_BOARD_HOST`               | `127.0.0.1`             | 监听地址                                 |
| `PASEO_BOARD_PORT`               | `3000`                  | 监听端口                                 |
| `PASEO_BOARD_CORS_ORIGIN`        | `http://localhost:5173` | 允许的前端 Origin                        |
| `PASEO_BOARD_DATA_DIR`           | `./data`                | 数据目录（SQLite + 加密密钥）            |
| `PASEO_BOARD_KEK_FILE`           | （空）                  | 密钥加密密钥路径（生产必填）             |
| `PASEO_BOARD_LOG_LEVEL`          | `info`                  | 日志级别（debug/info/warn/error）        |
| `PASEO_BOARD_REGISTRATION_OPEN`  | `true`                  | 是否开放注册（首次注册后自动关闭）       |
| `PASEO_BOARD_RATE_LIMIT_ENABLED` | `true`                  | 是否启用限流（认证端点）                 |
| `PASEO_BOARD_TRUSTED_PROXIES`    | （空）                  | 信任的反向代理 IP（逗号分隔，读真实 IP） |

## 常见问题

### 1. 403 Forbidden - Origin 不被允许

**症状**：登录、注册、所有 POST 请求都返回 403。

**原因**：浏览器访问的地址与服务器配置的 `PASEO_BOARD_CORS_ORIGIN` 不匹配。

**解决**：

1. 检查浏览器地址栏，确保是 `http://localhost:5173`
2. 如果必须用 `127.0.0.1`，设置 `export PASEO_BOARD_CORS_ORIGIN="http://127.0.0.1:5173"` 后重启服务器

### 2. 新建会话失败

**症状**：点击"创建会话"没有反应，或者报错。

**排查**：

1. 检查是否有连接的 Host（侧栏应该有在线的 Host）
2. 检查 Host 是否已加载 projects（下拉框应该有可选项目）
3. 打开浏览器开发者工具 Console 查看具体错误
4. 如果是 403，回到问题 1

### 3. Live Status 一直计时

**症状**：Agent 已经回复完成，但 timeline 底部还在显示"正在回复"并计时。

**原因**：已在 commit `<待提交>` 修复。如果仍有问题，检查：

1. Timeline 最后一条是否是完整的 assistant_message
2. 侧栏 agent 状态是否仍是"运行中"（转圈图标）
3. 如果侧栏显示 idle 但 live status 还在，说明前端状态更新有延迟，刷新页面即可

## 开发工作流

1. **启动服务**（首次）

   ```bash
   # 确保在 monorepo 根目录
   npm install
   npm run build:dashboard  # 构建 shared + contracts

   # 启动服务
   cd packages/dashboard/server && npm run dev &
   cd packages/dashboard/web && npm run dev
   ```

2. **代码修改后**
   - Web 代码：Vite 自动热更新
   - Server 代码：nodemon 自动重启
   - Contracts 修改：`npm run build:dashboard` 重新构建

3. **运行测试**

   ```bash
   npm run test:dashboard      # 全部测试（web + contract + e2e）
   npm run typecheck:dashboard # 类型检查
   npm run lint                # 代码检查
   ```

4. **提交前**
   ```bash
   npm run format              # 自动格式化
   npm run typecheck:dashboard
   npm run lint
   npm run test:dashboard
   ```

## 调试

### API 请求日志

服务器默认输出所有请求：

```
{"level":30,"time":...,"req":{"method":"POST","url":"/api/v1/auth/login",...},"msg":"incoming request"}
{"level":30,"time":...,"res":{"statusCode":200},"responseTime":120.75,"msg":"request completed"}
```

403 错误通常伴随 Origin 不匹配。

### 前端网络请求

浏览器开发者工具 → Network → 筛选 XHR：

- Status 403 → 检查 Request Headers 的 Origin
- Status 401 → 未登录或 token 过期
- Status 500 → 服务器错误，查看服务器日志

### Timeline 数据

打开 React DevTools → Components → 搜索 `WorkspacePage`：

- `timeline.entries` - 当前加载的条目
- `status` - agent 状态（running/idle/error）
- `liveActivity` - 计算出的运行状态（应该在回复完成后变为 null）

## 端口占用

如果 3000 或 5173 被占用：

```bash
# 查看占用进程
lsof -i :3000
lsof -i :5173

# 杀掉进程
kill -9 <PID>

# 或修改端口
export PASEO_BOARD_PORT=3001  # API
# Vite 端口在 web/vite.config.ts 中修改 server.port
```

## 下一步

- [产品需求](./product-requirements.md) - 了解功能范围
- [架构文档](./architecture.md) - 系统设计与数据模型
- [UI 设计](./ui.md) - 视觉与交互规范
- [Paseo 集成](./paseo-integration.md) - 如何连接 daemon
