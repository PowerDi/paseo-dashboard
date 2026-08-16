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

| 变量                             | 必填 | 默认值                      | 说明                                                  |
| -------------------------------- | ---- | --------------------------- | ----------------------------------------------------- |
| `PASEO_BOARD_HOST`               | 否   | `127.0.0.1`                 | 监听地址，生产应设为 `0.0.0.0` 或反代后端地址         |
| `PASEO_BOARD_PORT`               | 否   | `3000`                      | 监听端口                                              |
| `PASEO_BOARD_DATA_DIR`           | 是   | `./data`                    | 数据目录（SQLite + key registry），应挂载到持久卷     |
| `PASEO_BOARD_KEY_PROVIDER`       | 否   | `file`                      | `file` 或 `aws-kms`                                   |
| `PASEO_BOARD_KEK_FILE`           | 条件 | 空（仅开发自动生成）        | file provider 的 32 字节 KEK 路径，权限必须 `0600`    |
| `PASEO_BOARD_AWS_KMS_KEY_ID`     | 条件 | 空                          | aws-kms provider 使用的 KMS key id 或 alias           |
| `PASEO_BOARD_AWS_KMS_REGION`     | 否   | SDK 默认 region             | AWS KMS region                                        |
| `PASEO_BOARD_CORS_ORIGIN`        | 否   | `http://localhost:5173`     | 前端域名                                              |
| `PASEO_BOARD_REGISTRATION_OPEN`  | 否   | `true`                      | 是否允许首用户之后的公开注册                          |
| `PASEO_BOARD_LOG_LEVEL`          | 否   | `info`                      | 日志级别                                              |
| `PASEO_BOARD_RATE_LIMIT_ENABLED` | 否   | `true`                      | 是否启用内存限流；生产不要关闭                        |
| `PASEO_BOARD_TRUSTED_PROXIES`    | 否   | 空                          | 反代 IP，逗号分隔，如 `10.0.0.1,10.0.0.2`             |
| `PASEO_BOARD_WEBAUTHN_ORIGIN`    | 否   | 与 CORS origin 相同         | WebAuthn 页面 origin，例如 `https://dash.example.com` |
| `PASEO_BOARD_WEBAUTHN_RP_ID`     | 否   | WebAuthn origin 的 hostname | WebAuthn RP ID，例如 `dash.example.com`               |
| `PASEO_BOARD_WEBAUTHN_RP_NAME`   | 否   | `Paseo Dashboard`           | 浏览器 Passkey 提示中显示的服务名                     |

## 3. KEK 管理

Dashboard 使用版本化 `KeyProvider`。数据库只保存 key 版本、provider 和引用；不保存 file KEK 原文或 AWS KMS data key 明文。

### file provider

本地自托管可使用独立 32 字节文件：

```bash
head -c 32 /dev/urandom > /run/secrets/paseo-dashboard-k1
chmod 600 /run/secrets/paseo-dashboard-k1
```

```bash
export NODE_ENV=production
export PASEO_BOARD_KEY_PROVIDER=file
export PASEO_BOARD_KEK_FILE=/run/secrets/paseo-dashboard-k1
```

生产环境缺少 `PASEO_BOARD_KEK_FILE` 时拒绝启动。文件不存在、长度不是 32 字节或 group/other 权限不为零时也拒绝启动。非 production 且未配置文件时，服务端在 `PASEO_BOARD_DATA_DIR/.kek` 生成开发 key 并打印警告。

每个 key 版本使用不同的绝对路径。不要覆盖当前文件；中断轮换时，decrypt-only 版本仍需要旧文件。

### AWS KMS provider

```bash
export NODE_ENV=production
export PASEO_BOARD_KEY_PROVIDER=aws-kms
export PASEO_BOARD_AWS_KMS_KEY_ID=alias/paseo-dashboard
export PASEO_BOARD_AWS_KMS_REGION=us-east-1
```

服务端用 KMS `GenerateDataKey` 创建 256-bit data key，并把 KMS 返回的密文 blob 保存为 `keyRef`。启动和解密时用相同 encryption context 调用 KMS；运行身份需要生成和解密 data key 的权限。数据库泄露不包含 data key 明文。

### 启动检查

启动时必须满足：

- key registry 恰好有一个 `active` 版本；
- `active` 和 `decrypt_only` 版本都能由记录中的 provider/reference 解析；
- `retired` 版本不再加载，因此其旧文件可在确认退休后移除；
- 旧数据库首次启动会登记现有 key 为 `k1`，并补齐 payload AAD 版本，不重加密 payload。

### 在线轮换

先以 admin 登录并保存 HttpOnly session cookie。状态接口不返回 key reference：

```bash
curl --fail-with-body -b cookies.txt   https://dashboard.example.com/api/v1/admin/encryption-keys
```

file provider 先创建新文件，再提交当前密码和新路径。不要在共享 shell history 中直接写密码；下面的 payload 文件权限必须为 `0600`，请求后立即删除：

```bash
head -c 32 /dev/urandom > /run/secrets/paseo-dashboard-k2
chmod 600 /run/secrets/paseo-dashboard-k2

umask 077
cat > /tmp/paseo-key-rotate.json <<'JSON'
{"currentPassword":"ADMIN_CURRENT_PASSWORD","keyFile":"/run/secrets/paseo-dashboard-k2"}
JSON
curl --fail-with-body -b cookies.txt   -H 'Content-Type: application/json'   --data-binary @/tmp/paseo-key-rotate.json   https://dashboard.example.com/api/v1/admin/encryption-keys/rotate
rm -f /tmp/paseo-key-rotate.json
```

AWS KMS provider 的请求只提交 `currentPassword`；服务端生成新 data key。

轮换按以下顺序执行：

1. 当前 active 变为 `decrypt_only`，新版本变为 `active`；新 Host 立即使用新版本。
2. 服务端逐条解包并重包 `encryptedDek`，不重加密 capability payload；每条后让出事件循环，读写请求可以继续。
3. capability fingerprint secret 重包到新版本，去重值保持不变。
4. 旧版本没有连接或 secret 引用后标记 `retired`，记录 `encryption_key.rotated` 审计事件。

如果进程在重包期间中断，registry 保留 active/decrypt-only 状态。重新启动后再次调用同一轮换接口；file provider 在已有 decrypt-only 版本时可以省略 `keyFile`，服务端继续剩余重包。只有状态显示旧版本为 `retired` 且 `encryptedConnectionCount` 为 0 后，才能删除旧 key 文件。

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

- 内存限流依赖正确的 `req.ip`。设置 `PASEO_BOARD_TRUSTED_PROXIES` 后才信任对应反代提供的 forwarded IP。
- 当前限流状态不跨进程共享。多实例部署前接入共享限流存储，不能把流量轮询当作扩容限流额度。
- **禁止 body dump / APM body capture**：pairing offer 包含 daemon capability，不得记录请求体
- 设置 `PASEO_BOARD_TRUSTED_PROXIES` 为反代 IP，确保 `req.ip` 正确
- CSP 建议至少 `default-src 'self'`，`connect-src` 允许 Dashboard API 域名 + 用户配置的 Relay 域名

## 5. 注册流程

1. 第一个成功注册的用户自动成为 `admin`；即使公开注册关闭，空数据库仍允许这次 bootstrap 注册。
2. `PASEO_BOARD_REGISTRATION_OPEN=true` 时，后续用户可以公开注册，角色为 `member`。
3. `PASEO_BOARD_REGISTRATION_OPEN=false` 时，后续用户必须提交 admin 创建的邀请 token。
4. admin 通过 `POST /api/v1/invitations` 提交目标邮箱。响应只返回一次原始 token；当前版本不发送邀请邮件，管理员需通过安全渠道传递 token。
5. 邀请绑定邮箱、默认 72 小时过期、仅可使用一次。同邮箱重发邀请会立即撤销旧 token。

关闭公开注册不需要为了每次邀请重启服务。修改环境变量本身仍按部署方式重启或滚动更新。

## 6. 数据备份

始终备份 `PASEO_BOARD_DATA_DIR/dashboard.db`。复制前停止 Dashboard server，或使用 SQLite 在线备份机制，不能只复制仍有未 checkpoint WAL 的主数据库文件。

provider 还需要以下恢复材料：

| provider  | 恢复材料                                                                |
| --------- | ----------------------------------------------------------------------- |
| `file`    | 所有 `active`/`decrypt_only` 版本的 key 文件；路径按 registry 记录恢复  |
| `aws-kms` | 可访问原 KMS key 的运行身份和 region；加密 data-key blob 已随数据库备份 |

file key 与数据库分开加密保存。不要备份 `node_modules/` 或 `dist/`。开发用 `data/.kek` 只有在需要恢复该开发数据库时才与生产 key 相同对待。

### 恢复演练

每次轮换后执行一次隔离恢复：

1. 把数据库副本恢复到独立 `PASEO_BOARD_DATA_DIR`。
2. file provider 按原路径挂载当前 active key；AWS KMS provider 使用能解密原 blob 的身份。
3. 启动 server，确认 key 状态只有一个 active，且没有无法解析的 decrypt-only 版本。
4. 用测试账号列出并解密轮换前后的 Host，再验证相同 capability 仍被判定为重复。
5. 记录演练日期、备份版本和结果；不要把密码、key reference 或 capability 写入记录。

只有数据库无法恢复 capability。只有 file key 或 KMS 权限也无法恢复业务数据。

## 7. 安全检查清单

- [ ] `NODE_ENV=production`，且 KeyProvider 配置完整
- [ ] file key 权限为 `0600`、每个版本路径不同，并与数据库分开保存
- [ ] AWS KMS 运行身份只具备所需 key 的 data-key 生成/解密权限
- [ ] 已完成包含 active/decrypt-only key 的恢复演练
- [ ] 按部署策略设置 `PASEO_BOARD_REGISTRATION_OPEN`；关闭时使用 admin 邀请新增用户
- [ ] 反向代理启用 TLS
- [ ] WebAuthn origin/RP ID 与浏览器实际 HTTPS 域名一致
- [ ] `PASEO_BOARD_RATE_LIMIT_ENABLED=true`，trusted proxy 只包含实际反代
- [ ] 请求体 logging / APM body capture 已关闭
- [ ] 日志中无 offer/token/connection/cookie/password 原文
- [ ] API 响应包含 `Cache-Control: no-store`
- [ ] CSP 头已设置
- [ ] `Referrer-Policy: no-referrer` 已设置
