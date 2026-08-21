# @deepseek-ai/dsh-remote-access

[English](README.md) | 中文

为 DeepSeek Harness 的 web 界面提供基于 token 的登录鉴权与可选的 Cloudflare Tunnel 内网穿透。当 `domain` 为空时,插件只对本机 dsh webserver 的请求做鉴权;填入 `domain`(并配置 Cloudflare API token)后,还会额外建立一条指向同一本机端口的公网隧道。

## 插件职责

插件挂载四个服务并接入 host 平面:

- **token 存储**。一个 `remote_access` 存储领域,含 `tokens` 表(哈希存储,带 `revokedAt` 软删除)与 `access` 表(登录审计日志:token id、时间、IP、user agent)。
- **登录路由**。`GET /auth/login` 提供极简密码表单页;`POST /auth/login` 校验提交的 token 与存储哈希,签发 HMAC-SHA256 签名的会话 cookie;`POST /auth/logout` 清除该 cookie。
- **请求闸门**。一个 webserver `RequestGate` 拒绝所有未携带有效且未过期会话 cookie 的请求:浏览器导航重定向到 `/auth/login`,API/升级请求返回 `401`。`/auth/login` 与 `/auth/logout` 保持公开。
- **`/token` 命令**。`create` 生成 token 并把明文一次性打印到服务端日志;`list` 列出 token 及其吊销/最后使用状态;`revoke` 软删除 token,使其不再具备鉴权能力。

会话密钥通过 `credentials` 服务按 `sessionSecretRef` 解析。首次启动时,插件会生成随机密钥并落盘。不再自动铸造初始 token:请在可信(局域网免鉴权)会话里用 `/token create` 创建后再暴露隧道。

## Config

| 字段 | 默认值 | 含义 |
|---|---|---|
| `sessionTtlMs` | (必填) | 会话 cookie 有效期(毫秒)。 |
| `cookieName` | (必填) | 会话 cookie 名。 |
| `sessionSecretRef` | (必填) | 持有 HMAC 会话密钥的 credential 引用名。 |
| `domain` | `''` | 隧道公网主机名;为空则禁用隧道。 |
| `localPort` | `3080` | 隧道回源的本机 dsh 端口。 |
| `cloudflareApiTokenRef` | `CLOUDFLARE_API_TOKEN` | Cloudflare API token 的 credential 引用名(`api` provider)。 |
| `tunnelTokenRef` | `CLOUDFLARE_TUNNEL_TOKEN` | 云端托管隧道 run token 的 credential 引用名(`token` provider)。 |
| `tunnelProvider` | `token` | 隧道 provider:`token` 复用已有云端托管隧道 + dashboard 路由;`api` 通过 Cloudflare API 自动建隧道与 DNS。 |
| `enabled` | `true` | 总开关;为 `false` 时不注册任何路由/闸门/命令。 |
| `lanBypass` | `false` | 局域网/本机直连免鉴权(来源为私网地址且无 Cloudflare 边缘头);隧道流量始终要求鉴权。 |

web-app bundle 以一个月 `sessionTtlMs`、`cookieName: dsh_session`、`domain` 为空(仅鉴权;隧道按需开启)、`lanBypass: true`(局域网直连免鉴权)挂载本插件。

## 管理 token

`/token create --name <标签>` 写入新 token,并把明文一次性打印到服务端日志——请将该行视为机密。`/token list` 显示 id、名称与最后使用时间。`/token revoke <id>` 软删除 token,使其停止鉴权。

## 开启隧道

**`token` provider(默认;复用已有云端托管隧道):**
1. 在 Cloudflare dashboard 建好隧道及其 Public Hostname 路由(`homedsh.example.com` -> `http://localhost:<端口>`)。
2. 把该隧道的 run token(`cloudflared tunnel run --token ...`)配置到 `tunnelTokenRef`(`CLOUDFLARE_TUNNEL_TOKEN`)。
3. 将 `domain` 设为该公网主机名。重启后插件在 `$DSH_HOME/cloudflared` 下载/启动 `cloudflared` 并连接已有隧道;无需 API token。

**`api` provider(自动创建):** 设 `tunnelProvider: 'api'`,把 Cloudflare API token(Account/Cloudflare-Tunnel Edit + Zone/DNS Edit)配置到 `cloudflareApiTokenRef`,并设 `domain`。插件随后每次启动通过 API 建隧道与 DNS 并打印公网地址。

## 多机部署

`domain` 是单值配置,因此每台运行 dsh 界面的机器各持有一个独立公网主机名。请为每台机器配置各自的 `domain`;存储领域与会话密钥保持在各自 `$DSH_HOME` 之下。经由某台隧道访问,由该机器自己的 token 存储授权,与其他机器互不影响。

## 安全模型

- token 仅以 scrypt 哈希(`salt:hash`)存储;明文只在创建时一次性出现在服务端日志,从不落盘。
- 会话 cookie 使用解析到的密钥做 HMAC-SHA256 签名,携带 `HttpOnly; Secure`,并在 `sessionTtlMs` 后过期。
- 闸门用常数时间的 `timingSafeEqual` 比较签名。
- 吊销是软删除:记录保留哈希与历史,但 `revokedAt` 一旦设置,token 即不再具备鉴权能力。

## 模型体验

无,因为 token 与会话绝不会进入请求正文、提示词或模型可见内容。

#### KV Cache 影响

无;闸门与登录不交换模型可见前缀。

## 已知限制与暂缓工作

- **明文 token 仅记录一次**——初始与 `create` 铸造的 token 会打印到服务端日志;配置不当的日志汇可能泄露它们。初始 token 丢失后无法恢复;`create` 是预期补救手段。
- **每台机器单条活动隧道**——`domain` 是单值,一台机器无法同时托管多个公网主机名;多域名请部署多台机器。
- **仅支持 Cloudflare 隧道**——只实现了 Cloudflare Tunnel 路径;其他隧道厂商不在范围内。
- **无跨机 token 同步**——token 与会话密钥位于同一台机器的 `$DSH_HOME`;多机部署按机器分别鉴权。
