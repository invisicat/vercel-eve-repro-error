# vercel-eve-repro-error

Reproduction of the iMessage channel breaking in an [eve](https://eve.dev/docs)
agent deployed on Vercel with Photon/Spectrum Cloud iMessage.

This is a complete, self-contained agent on the latest packages. Nothing to add
or change — deploy it and it breaks.

## Status

**Broken at runtime.** `eve build` succeeds and the app boots, but the iMessage
channel fails at runtime on the adapter initialization path (constructing the
adapter / opening the Spectrum Cloud client).

## Reproduce

1. Deploy this repo to **Vercel**.
2. Set the environment variables below with **correct Photon/Spectrum Cloud
   credentials** in the Vercel project.
3. Send an iMessage DM to the connected number (or hit the gateway route).

The iMessage channel fails on initialization once real credentials are present.

### Environment variables

```bash
IMESSAGE_PROJECT_ID=your_project_id
IMESSAGE_PROJECT_SECRET=your_project_secret
IMESSAGE_WEBHOOK_SECRET=whsec_...      # from the Spectrum Cloud webhook config
IMESSAGE_USERNAME=assistant            # optional display name
```

Without `IMESSAGE_PROJECT_ID` / `IMESSAGE_PROJECT_SECRET` the channel stays
dormant and its routes return 503, so real credentials are required to hit the
failing init path.

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
code path that fails on Vercel with real credentials.

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
```
