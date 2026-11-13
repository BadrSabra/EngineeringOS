# Local Preview Agent client

This first client supports Linux and the server's existing Ed25519 pairing and heartbeat contracts. It only pairs and reports heartbeat; it does not read project files, execute commands, pull jobs, build Candidates, or start Preview Runtime.

## Requirements

- Node.js 20 or newer.
- A Linux Secret Service implementation and `secret-tool` on `PATH`.
- An unlocked user keyring and D-Bus session.
- The pairing response from the authenticated Workspace: `nodeId`, `storeId`, one-time `pairingCode`, and its exact `expiresAt`.
- The HTTPS origin of the EngineeringOS API. Plain HTTP is accepted only for `localhost`, `127.0.0.1`, or `::1` development.

The current Replit container has no `secret-tool`/desktop keyring, so it can test the store contract but cannot act as a real Local Agent host. The client fails closed when the Linux Secret Service is unavailable.

## Pair and run

From the repository checkout:

```sh
pnpm --filter @workspace/preview-agent-client run build
node lib/preview-agent-client/dist/cli.js doctor
node lib/preview-agent-client/dist/cli.js pair \
  --api https://YOUR-ENGINEERINGOS-API \
  --node NODE_UUID \
  --store STORE_UUID \
  --expires 2026-11-13T12:10:00.000Z
node lib/preview-agent-client/dist/cli.js run \
  --api https://YOUR-ENGINEERINGOS-API \
  --node NODE_UUID
```

`doctor` writes a random, non-sensitive probe to the Linux Secret Service, verifies the read-back, and clears it. It makes no API request and creates no Agent identity. A successful preflight does not prove a real pairing or heartbeat.

The pairing code is entered through a non-echoing terminal prompt, not a flag or environment variable. The Ed25519 private key, temporary one-time pairing code, heartbeat sequence, and pending exact heartbeat proof are kept as one Secret Service item. The pairing code is removed from that item after the server confirms pairing. A private, PID-fenced lock under the user's state directory prevents two client processes from using the same node; a stale lock is reclaimed only after the recorded Linux process identity is proven dead or reused.

## Safety behavior

- The sequence is persisted before the signed challenge request, so crashes may skip a number but do not intentionally reuse one.
- A lost challenge response is not retried with the same sequence; the client waits out the server's challenge TTL and then advances.
- A lost heartbeat response is retried with the exact stored proof so the server's idempotent receipt can return the original acceptance.
- HTTP redirects, cookies, API origins with credentials/query/path, and non-HTTPS non-loopback origins are rejected.
- Server response bodies, private keys, pairing codes, and signatures are never written to normal logs.
- The process lock is local ownership only; server-side signatures, sequence checks, one-time challenge consumption, and revocation remain authoritative.
