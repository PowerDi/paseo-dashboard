# 部署指南

## 前提

- Node.js ≥ 22
- 一个运行中的 Paseo daemon（用户已有 pairing offer）
- 一个 Paseo Relay（daemon 可连接的）

## 1. 构建和启动

```bash
# 安装依赖
npm install --cache /tmp/.npm-cache

# 编译所有包
npm run build

# 启动后端
node server/dist/index.js

# 前端静态文件托管
# web/dist/ 下的文件用 nginx 或其他静态服务器托管
```

## 2. 环境变量

| 变量                            | 必填   | 默认值                  | 说明                                          |
| ------------------------------- | ------ | ----------------------- | --------------------------------------------- |
| `PASEO_BOARD_HOST`              | 否     | `127.0.0.1`             | 监听地址，生产应设为 `0.0.0.0` 或反代后端地址 |
| `PASEO_BOARD_PORT`              | 否     | `3000`                  | 监听端口                                      |
| `PASEO_BOARD_DATA_DIR`          | 是     | `./data`                | 数据目录（SQLite + KEK），应挂载到持久卷      |
| `PASEO_BOARD_KEK_FILE`          | **是** | 空（开发自动生成）      | 32 字节 KEK 密钥文件路径，权限必须 `0600`     |
| `PASEO_BOARD_CORS_ORIGIN`       | 否     | `http://localhost:5173` | 前端域名                                      |
| `PASEO_BOARD_REGISTRATION_OPEN` | 否     | `true`                  | 首用户注册后设 `false` 关闭                   |
| `PASEO_BOARD_LOG_LEVEL`         | 否     | `info`                  | 日志级别                                      |
| `PASEO_BOARD_TRUSTED_PROXIES`   | 否     | 空                      | 反代 IP，逗号分隔，如 `10.0.0.1,10.0.0.2`     |

## 3. KEK 管理

### 生成 KEK

```bash
# 生成 32 字节随机密钥
head -c 32 /dev/urandom > /path/to/kek
chmod 600 /path/to/kek
```

### 启动检查

服务端启动时：

- 如果 `PASEO_BOARD_KEK_FILE` 指定的文件不存在 → 拒绝启动
- 如果文件权限不是 `0600` → 拒绝启动
- 如果文件长度不是 32 字节 → 拒绝启动
- 如果未设置 `PASEO_BOARD_KEK_FILE` → 开发模式自动生成，打印 WARN

### 备份恢复

- **必须同时备份**：KEK 文件 + SQLite 数据库（`data/dashboard.db`）
- 仅有数据库无法恢复 capability（envelope encryption）
- 仅有 KEK 无法获取任何数据
- 恢复步骤：将 KEK 文件和数据库放回对应路径，确保权限 `0600`，启动服务

### KEK 轮换（未来）

当前版本不支持在线 KEK 轮换。P4.3 将实现：

- 新写入使用 active key
- 后台重包旧 `encryptedDek`
- 旧 key 标记 decrypt-only
- 重包完成后退休旧 key

## 4. 反向代理（nginx 示例）

```nginx
server {
    listen 443 ssl http2;
    server_name dashboard.example.com;

    ssl_certificate /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;

    # 前端静态文件
    root /var/www/paseo-board/web/dist;
    index index.html;

    # SPA fallback
    location / {
        try_files $uri $uri/ /index.html;
    }

    # API 反代到后端
    location /api/ {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $https;

        # 禁止 body dump
        proxy_request_buffering on;
        proxy_buffer_size 4k;
    }

    # 安全头
    add_header Cache-Control "no-store" always;
    add_header Referrer-Policy "no-referrer" always;
}
```

### 反代注意事项

- **禁止 body dump / APM body capture**：pairing offer 包含 daemon capability，不得记录请求体
- 设置 `PASEO_BOARD_TRUSTED_PROXIES` 为反代 IP，确保 `req.ip` 正确
- CSP 建议至少 `default-src 'self'`，`connect-src` 允许 Dashboard API 域名 + 用户配置的 Relay 域名

## 5. 注册流程

1. 首次启动，`PASEO_BOARD_REGISTRATION_OPEN` 默认为 `true`
2. 打开前端页面，注册第一个用户
3. 设置 `PASEO_BOARD_REGISTRATION_OPEN=false`，重启服务
4. 后续注册请求被拒绝（已有用户 + 注册关闭）

## 6. 数据备份

需要备份的文件：

| 文件                   | 内容                               | 敏感度                |
| ---------------------- | ---------------------------------- | --------------------- |
| `PASEO_BOARD_KEK_FILE` | KEK 密钥                           | 密码级，权限 `0600`   |
| `data/dashboard.db`    | SQLite 数据库（含加密 capability） | 敏感，与 KEK 分开存储 |

**不要备份**：

- `node_modules/`、`dist/`（可从源码重建）
- `data/.kek`（开发 KEK，生产用 `PASEO_BOARD_KEK_FILE`）

备份策略：

- KEK 和数据库**分开存储**在不同物理位置
- 备份加密
- 定期验证恢复

## 7. 安全检查清单

- [ ] KEK 文件权限为 `0600`
- [ ] KEK 与数据库存储在不同位置
- [ ] `PASEO_BOARD_REGISTRATION_OPEN=false`（首用户注册后）
- [ ] 反向代理启用 TLS
- [ ] 请求体 logging / APM body capture 已关闭
- [ ] 日志中无 offer/token/connection/cookie/password 原文
- [ ] API 响应包含 `Cache-Control: no-store`
- [ ] CSP 头已设置
- [ ] `Referrer-Policy: no-referrer` 已设置
