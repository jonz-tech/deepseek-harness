# Agent Note: Remote access — token login and Cloudflare Tunnel for the web surface

Status: implemented

English | [中文](2026-08-21-remote-access.zh.md)

## Problem

The dsh web surface binds to `127.0.0.1` and trusts the local network. That is fine for a single user on one machine, but it leaves no way to (a) authenticate remote or shared access and (b) expose the surface through a firewall without a bespoke deployment. The transport layer needs a login gate and an optional public tunnel that a maintainer can switch on per machine, without changing the agent loop.

## Decision

`@deepseek-ai/dsh-remote-access` is one plugin that owns both concerns. It registers a `remote_access` storage domain (a `tokens` table holding only scrypt hashes plus a soft-delete `revokedAt`, and an `access` table logging each login), `/auth/login` and `/auth/logout` routes on the webserver, a `RequestGate` that rejects every request without a valid session cookie, and a `/token create|list|revoke` command. When `domain` is non-empty and a Cloudflare API token resolves through `credentials`, it additionally creates a tunnel, downloads/launches `cloudflared` under `$DSH_HOME/cloudflared`, and forwards `localPort`.

The core change is an optional request gate on the webserver. `@deepseek-ai/dsh-host-webserver` grows `setRequestGate(gate)`, returning a disposer; the webserver answers every accepted request through the gate and short-circuits rejections (`401` for API/upgrade, a redirect for browser navigations) with no change to the agent loop. The gate is the extension point; `remote-access` is its first consumer.

Storage and secrets are owned where the harness already owns them. Tokens live in a `storage-domain` table, so persistence is governed by the machine's configured storage backend. The session HMAC secret and the Cloudflare API token are `credentials` references, resolved and (for the session secret) auto-generated and persisted on first boot. The plugin holds no separate vault.

Revoke is a soft delete. `revokedAt` is set and the record (hash plus history) is kept, so a revoked token stops authenticating while audit history survives. This mirrors the storage-domain delete semantics rather than destroying rows.

The plugin is mounted in the `dsh-web-app` bundle with an empty `domain` (auth-only) and a one-month session TTL. Enabling tunneling is per-machine: an operator sets `domain` and the Cloudflare credential reference on the machine that should be public.

## Alternatives considered

**Authentication as a separate plugin from tunneling.** Rejected. Both share the same storage domain, the same `credentials` resolution, and the same lifecycle (open domain, resolve secret, register gate); splitting them would duplicate the domain open and force an ordering contract between two effects.

**Enforcing auth in each route handler.** Rejected. That couples every future route to authentication and is easy to bypass for routes a handler forgets to wrap. A single webserver-level gate covers all requests uniformly.

**Hard-coded gateway in the app rather than a webserver extension point.** Rejected. A `RequestGate` on the webserver keeps the mechanism in the transport layer, testable in isolation and reusable by other plugins, instead of baking remote-access into the server.

**Storing tokens or the session secret in the plugin's own files.** Rejected. The harness already owns durable storage (`storage-domain`) and secrets (`credentials`); owning a private vault here would duplicate that machinery and fragment where a machine's secrets live.

**Hard revoke that deletes the token row.** Rejected. Deleting the row loses the login audit trail and the ability to correlate past `access` records; a soft delete preserves both at a trivial cost.

## Consequences

The web surface is auth-gated by default after this mount: unauthenticated browser access redirects to `/auth/login`, and API/upgrade calls fail with `401`. A deployment that wants an open surface must disable the plugin row.

A single plugin keeps the feature cohesive but couples authentication to tunneling in one `Config` and one lifecycle; an operator enabling the tunnel must also accept the auth gate, and vice versa. Multi-machine deployment is per-machine by construction: `domain` is single-valued, each machine owns its `$DSH_HOME` token store and session secret, and access through one tunnel is authorized by that machine's store.

The session secret auto-generates on first boot and persists through `credentials`; the initial token prints once to the server log and cannot be recovered later, so an operator who loses it uses `/token create` to mint a replacement. Tunnel establishment is best-effort and non-blocking: a missing Cloudflare token logs a warning and the surface stays available on the local port behind the auth gate.
