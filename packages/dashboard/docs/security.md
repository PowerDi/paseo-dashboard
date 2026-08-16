# 安全设计

## 保护目标

- 未授权用户不能读取或修改任何 Host capability。
- 数据库或备份泄露时，攻击者不能仅凭数据库内容直接恢复 capability。
- Dashboard 不进入 agent 数据路径。
- session 撤销、设备撤销、Host 删除和账户删除具有明确、可测试且不夸大的语义。

## 信任边界

1. **设备 ↔ Dashboard TLS**：保护认证和 Host 同步传输。
2. **Dashboard 存储加密**：保护数据库、快照和备份中的 capability。
3. **设备 ↔ daemon E2EE**：Paseo 当前使用 Curve25519 派生共享密钥和 XSalsa20-Poly1305；Dashboard 不参与。
4. **Relay**：不可信转发层，可观察 IP、时间、大小和 session identifier，但不应读取 agent 内容。
5. **Dashboard 服务器**：MVP 是受信任可解密方；服务器完全攻陷时 capability 可被窃取。

## Pairing capability 事实

`daemonPublicKeyB64` 单独是公钥，但完整 offer 包含 Relay 寻址信息与 daemon identity。当前 daemon 对完成 E2EE handshake 的客户端没有 per-client allowlist 或独立 credential 校验，因此完整 offer 实际授予 daemon operator capability。

源码显示：

- `$PASEO_HOME/server-id` 跨重启持久化。
- `$PASEO_HOME/daemon-keypair.json` 跨重启持久化并以 `0600` 保存。
- 普通 daemon 重启不会轮换二者，也不会撤销已泄露 capability。
- 当前没有 per-client credential、按设备撤销或权限范围。

任何“删除 Host”“撤销 Dashboard 设备”都只能阻止后续同步，不能可靠撤销已下载 capability。

## Offer 导入安全

1. pairing URL 使用 fragment，浏览器不会在正常 HTTP request 中把 fragment 发给 Dashboard 服务端。
2. Dashboard 前端必须在加载分析、错误追踪或第三方脚本前解析 offer，并立即 `history.replaceState` 清除 fragment。
3. 前端用 Paseo parser/schema 校验；禁止把原始输入插入错误日志。
4. 首次连接验证在客户端完成，连接路径是浏览器 → Relay → daemon。
5. 只在验证和用户确认后，把规范化 connection 通过 Dashboard TLS API 提交。
6. 服务端 schema 再验证并加密保存；请求 body logging、APM body capture 和 reverse-proxy body dump 必须关闭。
7. 服务端不保留原始 URL。审计仅保存 action、主体、内部 Host id 和 offer HMAC fingerprint。

二维码包含相同 capability。扫码图像不上传 Dashboard；处理尽量在本地内存完成。

## MVP 存储加密

### Envelope encryption

- 为每个 HostConnection 生成随机 256-bit DEK。
- 使用 AEAD（建议 AES-256-GCM 或平台审计过的等价方案）加密完整 capability JSON。
- AAD 包含 schema version、`userId`、`hostId`、connection id 和 key version，防止密文换位。
- 使用部署 KEK 包装 DEK。生产 KEK 来自 KMS/secret manager；简单自托管部署可由独立文件或环境 secret 提供，但不能与数据库/备份放在一起。
- 数据库保存 `encryptedPayload`、`encryptedDek`、nonce/tag 和 `keyVersion`。
- 去重使用服务端 secret 派生的 HMAC fingerprint，不使用裸 `serverId` 或公钥索引。

### 泄露影响

| 事件               | 影响                                                                                           |
| ------------------ | ---------------------------------------------------------------------------------------------- |
| 仅数据库/备份泄露  | 无 KEK 时不能恢复 capability；可见用户与 Host 元数据取决于明文字段                             |
| 应用服务器完全攻陷 | 攻击者可使用运行时 KEK 解密 capability，并可能窃取 session；MVP 不防此威胁                     |
| 用户设备被攻陷     | 已同步 capability、access token 和本地 agent 数据可能泄露                                      |
| Relay 被攻陷       | 仍不能解密 E2EE 内容，但可拒绝服务、观察元数据；若 capability 已泄露，攻击者可作为新客户端连接 |

## 零知识 vault 边界

MVP 选择 **服务端可解密的 envelope encryption**，原因是账号恢复、多设备首次登录、服务端密钥轮换和运维可控。必须在产品中如实说明。

未来零知识方案可用用户解锁秘密在客户端派生 vault key，服务端只保存密文。但它引入：

- 忘记密码后 capability 无法恢复，除非设计恢复密钥。
- 新设备引导、设备间密钥分享和多人 Host 分享协议。
- 浏览器内存/XSS 成为主要威胁。
- 服务端无法做内容去重和格式迁移。

零知识设计必须作为独立版本，不在 MVP envelope encryption 上叠加模糊的“半零知识”承诺。

## 认证方案

### 选择

- 首个有效用户为 `admin`。首用户判定与写入在同一数据库事务中，并发启动只能创建一个管理员。
- `PASEO_BOARD_REGISTRATION_OPEN` 只控制首用户之后的公开注册。关闭时，admin 可签发绑定邮箱、限时、单次使用的邀请；新用户角色为 `member`。
- 邀请原始 token 只在创建响应中返回一次，服务端只存哈希。同邮箱重发会撤销之前未使用的邀请。
- Dashboard 定位为自托管自用，不验证邮箱所有权。邮箱是唯一登录标识和邀请匹配条件；邀请 token 的持有证明管理员授权，管理员应通过可信私密渠道传递 token。
- 后续继续支持邮箱密码；Passkey 作为强认证和无密码登录；OAuth 仅在明确部署需求后增加。
- 不把“单用户模式”做成无认证模式。

### 密码和 session

- 密码使用 Argon2id，参数按部署内存基准配置，并保存算法版本便于升级。
- access session 短时有效；refresh token 高熵、单次轮换、服务端只存哈希。
- 检测 refresh token reuse 后撤销整个 token family。
- Web 优先使用 `Secure`、`HttpOnly`、`SameSite=Lax/Strict` Cookie；状态改变请求使用 CSRF token 或严格 same-origin + Origin 校验。
- Harmony 使用 bearer access token，refresh token 存平台安全存储；不得依赖浏览器 Cookie。
- 修改密码默认撤销其他 session；设备撤销撤销该设备所有 session。

### 防护

- 注册和登录按 IP、normalized email 与 installation id 三个独立 bucket 限流；refresh 按 IP 与 token hash；Host 导入按 IP 与认证账号；修改密码按 IP。
- bucket identity 先做 SHA-256，不在内存键中保留邮箱、installation id 或 refresh token 原文。路径匹配忽略 query string，拒绝响应包含 `Retry-After`。
- 当前 limiter 是单进程内存状态。多实例部署必须改用共享限流存储，否则每个实例各自计数。
- 不提供邮件找回或公开重置密码 endpoint。未来的本地管理员 recovery code/CLI 必须独立定义授权、审计和撤销边界；若增加网络入口，再补对应限流。
- 登录错误不暴露账号是否存在；指数退避和临时锁定必须避免永久 DoS。
- CORS 默认只允许配置的 Dashboard origin；不使用 `*` 与凭据。
- CSP 至少限制 `default-src 'self'`、明确 `connect-src` 为 Dashboard API 与用户配置 Relay 所需策略；禁止不受控第三方脚本。
- 敏感页面设置 `Referrer-Policy: no-referrer`、`Cache-Control: no-store`。
- 生产日志采用字段 allowlist；错误对象在进入 logger 前做 redaction。`inviteToken` 和邀请创建响应 token 与 access/refresh token 使用相同的脱敏规则。
- 数据库备份加密、限制访问、验证恢复，并包含密钥版本恢复演练。

## 撤销和删除

### Dashboard 层

- session 撤销：立即拒绝 refresh；每次受保护请求都会查 session、账户和设备状态，因此撤销或停用不依赖 access token 自然过期。
- 设备撤销：撤销设备全部 session，记录审计事件。
- Host 删除：同步 tombstone，阻止未来下载，清除服务端密文。
- 账户删除：撤销所有 session，清除 capability 和个人数据。

### daemon capability 层

当前只能做全局轮换：安全停止 daemon，轮换/删除 daemon keypair，并根据 Relay identity 方案同步轮换 `serverId`，再给保留设备重新 pairing。项目需要向 Paseo 提议正式、原子、可审计的 rotation/revocation 命令；不建议用户手工删除文件作为产品流程。

未来真正撤销需要 daemon 协议新增以下一种或组合：

- daemon 签发的 per-client credential/allowlist；
- 客户端公钥注册和吊销；
- credential epoch 或 key id；
- 范围化权限和到期时间；
- 主动断开已撤销 client。

这些都是未来 Paseo 协议变更，必须保持 wire compatibility 和 capability gating。

## 审计

至少记录：注册、登录成功/失败聚合、密码变更/重置、session/device 撤销、Host 导入/更新/删除、账户删除、加密 key rotation。

审计不得记录：原始 URL、offer JSON、公钥 capability、完整 endpoint、access/refresh token、Cookie、密码、DEK/KEK、daemon 数据。

## 安全测试

- 越权读取/更新/删除其他用户 Host 返回统一 404/403 策略。
- Host import 的 idempotency key 和 capability fingerprint 只在账号内去重；不同用户的相同值不能复用或暴露其他用户 Host。
- SSE 只向当前认证用户的订阅发送配置事件。
- 关闭公开注册时，无邀请注册失败；邀请必须匹配邮箱、未过期、未撤销、未使用，且并发首用户注册只能产生一个管理员。
- 注册、登录、refresh 和 Host 导入分别验证 IP、账号、installation 或 credential bucket；更换 query string、IP、账号或 installation 不能绕过仍适用的其他维度。
- revoked session 无法 refresh、sync 或读取 Host。
- response/cache/proxy/APM/log fixture 中不存在 capability 原文。
- 数据库 dump 不能在无 KEK 情况下恢复 connection。
- 并发 Host 更新产生确定的 409，不静默覆盖。
- XSS 测试覆盖 URL fragment 和二维码内容。
- 网络测试证明 Dashboard 服务端未接收 daemon frame。
- key rotation 演练验证旧 key decrypt-only、新写入 active、重包后退休。
