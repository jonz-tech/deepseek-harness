# @deepseek-ai/dsh-remote-access

English | [中文](README.zh.md)

Token-based login authentication plus an opt-in Cloudflare Tunnel for the DeepSeek Harness web surface. When `domain` is empty the plugin authenticates requests to the local dsh webserver; filling `domain` (and configuring a Cloudflare API token) additionally establishes a public tunnel that forwards the same local port.

## Plugin responsibilities

The plugin mounts four services and wires them into the host plane:

- **Token store.** A `remote_access` storage domain with a `tokens` table (hashed, with `revokedAt` soft-delete) and an `access` table (login audit log: token id, timestamp, IP, user agent).
- **Login routes.** `GET /auth/login` serves a minimal password-form page; `POST /auth/login` verifies the presented token against stored hashes and issues an HMAC-SHA256-signed session cookie; `POST /auth/logout` clears it.
- **Request gate.** A webserver `RequestGate` rejects every request that does not carry a valid, unexpired session cookie, redirecting browser navigations to `/auth/login` and answering API/upgrade requests with `401`. `/auth/login` and `/auth/logout` stay public.
- **`/token` command.** `create` mints a token and prints the plaintext once to the server log; `list` enumerates tokens with their revoke/last-used state; `revoke` soft-deletes a token so it no longer authenticates.

The session secret is resolved through the `credentials` service under `sessionSecretRef`. On first boot the plugin generates a random secret and persists it, and mints an initial token logged once (never recoverable afterward).

## Config

| Field | Default | Meaning |
|---|---|---|
| `sessionTtlMs` | (required) | Session cookie lifetime in milliseconds. |
| `cookieName` | (required) | Name of the session cookie. |
| `sessionSecretRef` | (required) | Credential reference holding the HMAC session secret. |
| `domain` | `''` | Public hostname for the tunnel; empty disables tunneling. |
| `localPort` | `3080` | Local dsh port the tunnel forwards to. |
| `cloudflareApiTokenRef` | `CLOUDFLARE_API_TOKEN` | Credential reference for the Cloudflare API token. |
| `enabled` | `true` | Master switch; `false` registers no routes, gate, or command. |
| `lanBypass` | `false` | Skip auth for trusted direct LAN/loopback requests (private source and no Cloudflare edge headers); tunnel traffic always requires auth. |

The web-app bundle mounts the plugin with a one-month `sessionTtlMs`, `cookieName: dsh_session`, an empty `domain` (auth-only; tunnel opt-in), and `lanBypass: true` (LAN direct access skips auth).

## Managing tokens

`/token create --name <label>` writes a new token and prints its plaintext once to the server log — treat that line as a secret. `/token list` shows ids, names, and last-use time. `/token revoke <id>` soft-deletes a token so it stops authenticating.

## Enabling the tunnel

1. Set the Cloudflare API token under the credential reference named by `cloudflareApiTokenRef`.
2. Set `domain` to the public hostname (for example `home.example.com`) that the tunnel should expose.
3. Restart the app. The plugin resolves the token, creates the tunnel through the Cloudflare API, downloads/launches `cloudflared` under `$DSH_HOME/cloudflared`, and logs the public URL once established.

## Multi-machine deployment

`domain` is single-valued, so each machine running a dsh surface owns one distinct public hostname. Give every machine its own `domain`; the storage domain and session secret stay machine-local under that machine's `$DSH_HOME`. Access through one tunnel is authorized by that machine's token store, independent of any other machine's.

## Security model

- Tokens are stored only as scrypt hashes (`salt:hash`); plaintext appears once in the server log at creation and is never persisted.
- Session cookies are HMAC-SHA256-signed with the resolved secret and carry `HttpOnly; Secure`, expiring at `sessionTtlMs`.
- The gate compares signatures with a constant-time `timingSafeEqual`.
- Revoke is a soft-delete: the record keeps its hash and history, but `revokedAt` is set so the token no longer authenticates.

## Model Experience

None, as the token and session never reach the request body, prompt, or model-visible content.

#### KV Cache effect

None; the gate and login exchange no model-visible prefix.

## Known Limitations and Deferred Work

- **Plaintext token logged once** — the initial and `create`-minted tokens print to the server log; a misconfigured log sink could leak them. No recovery path exists for a lost initial token; `create` is the intended remedy.
- **Single active tunnel per machine** — `domain` is one value, so a machine cannot host several public hostnames at once; deploy separate machines for separate domains.
- **Cloudflare-only tunneling** — only the Cloudflare Tunnel path is implemented; other tunnel providers are out of scope.
- **No cross-machine token sync** — tokens and the session secret live under one machine's `$DSH_HOME`; multi-machine setups authenticate per machine.
