# Agent Note: 远程访问——web 界面的 token 登录与 Cloudflare Tunnel

Status: implemented

[English](2026-08-21-remote-access.md) | 中文

## 问题

dsh 的 web 界面绑定在 `127.0.0.1` 并信任本机网络。对单用户单机来说够用,但既无法(a)对远程或共享访问做鉴权,也无法(b)在不做定制部署的情况下穿过防火墙暴露界面。传输层需要一道登录闸门,以及一条可由运维按机器启用的可选公网隧道,而无需改动 agent loop。

## 决策

`@deepseek-ai/dsh-remote-access` 是同时负责这两件事的单一插件。它注册一个 `remote_access` 存储领域(`tokens` 表只存 scrypt 哈希并带软删除 `revokedAt`,以及记录每次登录的 `access` 表)、webserver 上的 `/auth/login` 与 `/auth/logout` 路由、一个拒绝所有未携带有效会话 cookie 请求的 `RequestGate`,以及 `/token create|list|revoke` 命令。当 `domain` 非空且能通过 `credentials` 解析到 Cloudflare API token 时,它还会创建隧道,在 `$DSH_HOME/cloudflared` 下下载/启动 `cloudflared`,并转发 `localPort`。

核心改动是 webserver 上的一道可选请求闸门。`@deepseek-ai/dsh-host-webserver` 新增 `setRequestGate(gate)`,返回一个释放函数;webserver 通过闸门应答每个已接受的请求,并对被拒绝的请求做短路处理(`401` 用于 API/升级,重定向用于浏览器导航),agent loop 无需改动。闸门是扩展点,`remote-access` 是它的首个消费方。

存储与密钥归属在 harness 既有归属处。token 位于 `storage-domain` 表,持久化由机器的已配置存储后端决定。会话 HMAC 密钥与 Cloudflare API token 是 `credentials` 引用;会话密钥首次启动时自动生成并落盘。插件不另设密钥库。

吊销是软删除。`revokedAt` 被设置且记录(哈希加历史)保留,因此被吊销的 token 停止鉴权,同时审计历史得以存续。这对应 storage-domain 的删除语义,而非销毁数据行。

插件以 `domain` 为空(仅鉴权)、会话有效期一个月挂载进 `dsh-web-app` bundle。启用隧道是按机器进行的:运维在需要公开的机器上配置 `domain` 与 Cloudflare credential 引用。

## 备选方案

**鉴权与隧道分成两个插件。** 否决。两者共享同一存储领域、同一 `credentials` 解析、同一生命周期(打开领域、解析密钥、注册闸门);拆分会在两个 effect 之间重复领域打开并强制一个排序约定。

**在每条路由处理器里单独做鉴权。** 否决。这会令未来每条路由都与鉴权耦合,而且处理器一旦漏包某条路由就容易绕过。单道 webserver 级闸门可统一覆盖所有请求。

**在应用里硬编码闸门,而不是做成 webserver 扩展点。** 否决。webserver 上的 `RequestGate` 把机制留在传输层,可独立测试、可被其他插件复用,而非把远程访问写死进服务器。

**把 token 或会话密钥存在插件自己的文件里。** 否决。harness 已拥有持久存储(`storage-domain`)与密钥(`credentials`);在此另建私有密钥库会重复这套机制,并割裂一台机器上密钥的归属。

**吊销采用硬删除,直接删掉 token 行。** 否决。删行会丢失登录审计轨迹,以及将历史 `access` 记录关联到该 token 的能力;软删除以极小代价同时保全两者。

## 后果

本次挂载后,web 界面默认启用鉴权闸门:未认证的浏览器访问被重定向到 `/auth/login`,API/升级调用返回 `401`。需要开放界面的部署必须禁用该插件行。

单一插件让该特性保持内聚,但也把鉴权与隧道耦合在同一个 `Config` 与生命周期里;启用隧道的运维也必须接受鉴权闸门,反之亦然。多机部署按构造天然按机器隔离:`domain` 是单值,每台机器拥有自己的 `$DSH_HOME` token 存储与会话密钥,经由某台隧道访问由该机器的存储授权。

会话密钥首次启动自动生成并经 `credentials` 落盘;初始 token 只在服务端日志打印一次、之后无法恢复,因此丢失时用 `/token create` 铸造替代。隧道建立是 best-effort 且非阻塞:缺少 Cloudflare token 只记录一条告警,界面仍可通过本地端口在鉴权闸门之后访问。
