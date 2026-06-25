# iMessage eve Agent — Design

**Date:** 2026-06-25
**Status:** Approved (build phase)

## Goal

An eve agent reachable over iMessage, acting as a general personal assistant.
First milestone is a **zero-credential** version: it echoes messages back and
answers date/time questions deterministically, with **no LLM API key required**.
Real LLM behavior is a deferred, low-effort upgrade.

## Core constraint

`chat-adapter-imessage` is a **Vercel Chat SDK** adapter (`new Chat({ adapters })`,
built on `spectrum-ts` gRPC). eve does **not** use the Chat SDK runtime
(`node_modules/eve/docs/channels/overview.mdx:39`); it has its own channel layer
(`defineChannel`, `send()`, `message.completed`). So integration = bridging the
adapter's transport into a custom eve channel. **Approach B** (chosen): wrap the
adapter inside a custom eve channel. (A = reimplement on `spectrum-ts`; C =
standalone Chat bot calling eve over HTTP — both rejected.)

## Architecture

### `agent/channels/imessage.ts` (custom eve channel)

- **Module load:** construct the Chat bot with the iMessage adapter in cloud mode:
  `new Chat({ userName, adapters: { imessage: createiMessageAdapter({ local: false, projectId, projectSecret }) } })`,
  and register `bot.onNewMessage((thread, message) => ...)` once.
- **`POST /webhook`:** run `bot.webhooks.imessage(req, { waitUntil })` to HMAC-verify
  + parse. That fires the `onNewMessage` handler, which computes the reply
  (echo / date-time) and posts it back directly with `thread.post(reply)`.
- **`GET /gateway`:** calls `startGatewayListener(...)` as a fallback ingestion path
  (Vercel cron `*/9 * * * *`) so it works before a dashboard webhook is registered.
- **DMs only.** The adapter cold-rebuilds a DM thread from its address, so a DM reply
  works even on a cold serverless invocation. Group cold-sends are unsupported by the
  adapter — acceptable for a personal DM assistant.

### Response behavior (zero-credential milestone)

The `onNewMessage` handler responds **directly, without invoking the eve agent or any
model** (so no `send()`, no `message.completed`, no LLM key):
- Detects date/time intent (e.g. "time", "date", "what time in <tz>") →
  returns formatted current date/time via a shared `lib/datetime.ts` helper.
- Otherwise → echoes the user's message back (short, plain-text framing).

Because milestone 1 never calls the eve agent, the model in `agent.ts` and the
`get_current_datetime` tool are defined but **not exercised** until the upgrade.
Plain text only (iMessage strips markdown).

### `lib/datetime.ts`

Shared, pure function `currentDateTime({ timezone? })` → `{ iso, human, timezone }`.
Used by the channel now; reused by the tool below.

### `agent/tools/get_current_datetime.ts`

A real `defineTool` (Zod `inputSchema: { timezone?: string }`) wrapping
`lib/datetime.ts`. Defined now for correctness and so the LLM upgrade is trivial,
even though the model isn't invoked in the zero-credential milestone.

### `agent/instructions.md`

General-personal-assistant prompt: concise, conversational, text-appropriate
(short plain-text replies), with an AI-disclosure line. Used once a model is wired.

### `agent/agent.ts`

Leave `model: "anthropic/claude-sonnet-4.6"` in place (unused until a key is added).

## Upgrade path (later, out of scope for milestone 1)

Route the channel through eve's `send()` so the model handles all turns and calls
`get_current_datetime` itself. The `onNewMessage` handler is module-scoped while
`send` is request-scoped, so this step introduces an `AsyncLocalStorage` carrying
the route's `send`/`auth` into the handler, plus a `message.completed` event handler
that delivers the model's reply via `thread.post`. Requires a model credential (free
Gemini via `@ai-sdk/google` + `GEMINI_API_KEY`, any provider key, or Vercel AI Gateway).

## Going live on real iMessage (separate setup step)

Requires Photon cloud credentials, driven via the Photon CLI when ready:
- Photon login (device authorization).
- Create project → `IMESSAGE_PROJECT_ID` + `IMESSAGE_PROJECT_SECRET`.
- Provision an iMessage line to send from.
- `IMESSAGE_WEBHOOK_SECRET` + register the webhook endpoint (or use the cron gateway).

## Verification

1. `tsc` typecheck passes.
2. `npm exec -- eve dev --no-ui` boots; server URL appears.
3. POST a (locally) simulated message to the channel webhook → confirm echo /
   date-time response is produced. (Real send requires Photon creds.)

## Dependencies to add

`chat`, `chat-adapter-imessage` (per the adapter README).

## Out of scope (YAGNI for milestone 1)

Group chat sends, message history, reactions/tapbacks, file attachments, the LLM
model call, multi-line provisioning.
