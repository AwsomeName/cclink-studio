# Subscription

Subscription and entitlement documentation now follows the CCLink boundary in
[`../cclink-studio-boundary-and-migration.md`](../cclink-studio-boundary-and-migration.md).

CCLink Studio OSS does not keep subscription UI, payment flows, entitlement
truth, quota, or commercial feature gates in the default path. If a local UI
touchpoint needs to reference a paid capability, it should degrade gracefully or
be injected by the commercial overlay.

Server-side plans, orders, payment callbacks, quota, entitlement truth, and
official account operations belong to `/Users/apple/Desktop/chat-cc/deploy`.
Official desktop integration and release wiring belong to
`/Users/apple/Desktop/cclink-dev`.

`private-serv` is a deprecated historical project and is no longer the target
for subscription work.
