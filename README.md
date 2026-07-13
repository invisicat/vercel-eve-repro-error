# vercel-eve-repro-error

Minimal reproduction of the iMessage channel breaking in an [eve](https://eve.dev/docs)
agent after upgrading the iMessage chat adapter to the scoped
`@photon-ai/chat-adapter-imessage` package.

Based on the [`photon-hq/vercel-eve-imessage-example`](https://github.com/photon-hq/vercel-eve-imessage-example)
example, reduced to the pieces needed to trigger the failure.

## Status

**Broken at runtime.** `eve build` succeeds and the app boots, but the iMessage
channel fails at runtime on the adapter initialization path (constructing the
adapter / opening the Spectrum Cloud client). This repo exists to reproduce that,
not to work.

## What changed to trigger it

Two dependency changes vs. the working example:

```diff
- "@vercel/connect": "0.2.2",
+ "@vercel/connect": "0.3.2",

- "chat-adapter-imessage": "^1.1.0",
+ "@photon-ai/chat-adapter-imessage": "^2.2.0",
```

And the corresponding import in `agent/channels/imessage.ts`:

```diff
  import {
    createiMessageAdapter,
    type iMessageAdapter,
- } from "chat-adapter-imessage";
+ } from "@photon-ai/chat-adapter-imessage";
```

Everything else is the stock example. The break appears only with the
`@photon-ai/chat-adapter-imessage@^2.2.0` + `@vercel/connect@0.3.2` combination.

## Where it breaks

The relevant file is `agent/channels/imessage.ts`. In Photon cloud mode
(`local: false`) it:

1. Calls `createiMessageAdapter({ local: false, projectId, projectSecret, webhookSecret })`.
2. Wraps that adapter in a Chat SDK `bot`.
3. Exposes two eve routes: `POST /webhooks/imessage` and `GET /gateway`
   (`imessage.startGatewayListener(...)`).

The failure is in the initialization done at (1)/(3), not in eve or the routing.

## How iMessage initialization actually flows (debugging notes)

Tracing what "init" means for iMessage through the layers, top to bottom:

- **`@photon-ai/chat-adapter-imessage`** — `createiMessageAdapter(...)` builds the
  adapter and, in cloud mode, drives spectrum-ts's iMessage platform.
- **`spectrum-ts` (`@spectrum-ts/core` + `packages/imessage`)** — there is **no**
  public `init()`/`initialize()` on the iMessage package. Initialization happens in
  the platform lifecycle **`createClient`** hook (`packages/imessage/src/index.ts`),
  which runs when the Spectrum instance is constructed and picks a mode:
  - `config.local` → `new IMessageSDK()` (on-device, reads `~/Library/Messages/chat.db`)
  - `config.clients` → `createClient({ address, token, tls, ... })` per phone
  - otherwise (cloud) → `createCloudClients(projectId, projectSecret)`, which calls
    `cloud.issueImessageTokens(...)` and auto-renews the tokens (`packages/imessage/src/auth.ts`).
- **`@photon-ai/imessage-kit`** (local mode only) — the literal `init()` lives on
  `PluginManager.init()`: it runs every registered plugin's `onInit` hook once,
  marks the SDK initialized, and is idempotent (late `use()` registrations are
  flushed on the next call). This is the plugin init, not a channel setup call.

So "initialize for iMessage" is not a function you call — it's the `createClient`
lifecycle work that runs when the adapter/Spectrum instance is built. That is the
code path that fails after the adapter upgrade.

## Reproduce

```bash
npm install

# .env.local — cloud mode needs real Photon/Spectrum Cloud credentials
cat > .env.local <<'EOF'
IMESSAGE_PROJECT_ID=your_project_id
IMESSAGE_PROJECT_SECRET=your_project_secret
IMESSAGE_WEBHOOK_SECRET=whsec_...
IMESSAGE_USERNAME=assistant
EOF

npm run build     # succeeds
npm run dev       # boot, then hit the iMessage channel to trigger the failure
```

The iMessage channel is dormant (routes return 503) unless
`IMESSAGE_PROJECT_ID` and `IMESSAGE_PROJECT_SECRET` are set, so real credentials
are required to hit the failing init path.

## Layout

```text
agent/
|-- agent.ts                    # Model/runtime config
|-- instructions.md             # Always-on assistant instructions
|-- channels/
|   |-- eve.ts                  # Built-in eve HTTP API
|   `-- imessage.ts             # Photon iMessage channel  <-- the repro
|-- lib/
|   |-- datetime.ts
|   `-- respond.ts              # Deterministic iMessage reply logic
`-- tools/
    `-- get_current_datetime.ts

Prereqs: Node.js 24.x, npm, a Photon/Spectrum Cloud project (https://app.photon.codes).
```

## Paste the exact error here

Fill in the runtime stack trace / error message you hit so the team has the exact
signature:

```text
<paste error output>
```
