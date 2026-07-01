# eve + Photon iMessage example

This repo is a minimal example of wiring an [eve](https://eve.dev/docs)
filesystem-first agent to iMessage through Photon's
`chat-adapter-imessage` package.

It is useful if you want to see how to:

- Structure an eve agent under `agent/`
- Add the built-in eve HTTP channel for local development and debugging
- Mount Photon iMessage webhooks and gateway polling as a custom eve channel
- Keep iMessage replies plain text
- Run the iMessage transport without requiring model credentials for the first
  milestone

## How the example works

eve discovers capabilities from files under `agent/`:

```text
agent/
|-- agent.ts                    # Model/runtime config
|-- instructions.md             # Always-on assistant instructions
|-- channels/
|   |-- eve.ts                  # Built-in eve HTTP API with auth policy
|   `-- imessage.ts             # Photon iMessage custom channel
|-- lib/
|   |-- datetime.ts             # Shared date/time helper
|   `-- respond.ts              # Deterministic iMessage reply logic
`-- tools/
    `-- get_current_datetime.ts # Typed eve tool for the model path
```

The important integration is `agent/channels/imessage.ts`.

That file creates a Chat SDK bot with `chat-adapter-imessage`, then exposes the
adapter through eve `defineChannel()` routes:

- `POST /webhooks/imessage` receives signed Spectrum Cloud webhook deliveries.
- `GET /gateway` starts the adapter's long-poll gateway listener for deployments
  that use cron polling.

Incoming iMessage DMs are currently answered by `agent/lib/respond.ts`, a small
deterministic function that handles date/time questions and otherwise echoes the
message. This is intentional for the example's first milestone: the iMessage
transport can be tested without a working model credential. The eve agent config,
instructions, and `get_current_datetime` tool are already present for the next
step, where iMessage turns can be routed through eve's model loop.

## Prerequisites

- Node.js 24.x
- npm
- A Photon/Spectrum Cloud project from <https://app.photon.codes>
- For model-backed eve sessions, a model credential for the gateway model in
  `agent/agent.ts`

The iMessage channel uses Photon cloud mode (`local: false`), so it runs on
Linux, Vercel, or any Node host. Local on-device iMessage mode requires macOS and
is not what this repo is configured for.

## Setup

Install dependencies:

```bash
npm install
```

Create `.env.local` in the repo root:

```bash
# Photon / Spectrum Cloud
IMESSAGE_PROJECT_ID=your_project_id
IMESSAGE_PROJECT_SECRET=your_project_secret

# Required when using Spectrum Cloud webhooks
IMESSAGE_WEBHOOK_SECRET=whsec_...

# Optional display name used by the Chat SDK bot
IMESSAGE_USERNAME=assistant

# Needed when you use the eve HTTP channel/model loop directly.
# A string model id in agent/agent.ts routes through Vercel AI Gateway.
AI_GATEWAY_API_KEY=...
```

If you deploy on Vercel and link the project, eve can also authenticate
gateway-routed model ids with Vercel OIDC instead of `AI_GATEWAY_API_KEY`.

## Run locally

Start the eve development server:

```bash
npm run dev
```

Useful eve commands:

```bash
npm run typecheck  # Type-check authored agent files
npm run build      # Compile eve artifacts and host output
npm run start      # Serve the built output
npx eve info       # Inspect discovered channels, tools, and routes
```

The built-in eve channel is available under `/eve/v1/session*`. For example:

```bash
curl -X POST http://127.0.0.1:3000/eve/v1/session \
  -H 'content-type: application/json' \
  -d '{"message":"What time is it in Tokyo?"}'
```

The iMessage webhook route needs a public HTTPS URL because Spectrum Cloud must
call it. For local end-to-end webhook testing, put a tunnel such as ngrok,
Cloudflare Tunnel, or a Vercel preview deployment in front of the dev server.

## Configure Photon webhooks

1. Open your Spectrum Cloud project at <https://app.photon.codes>.
2. Register this endpoint:

   ```text
   https://<your-deployment>/webhooks/imessage
   ```

3. Copy the webhook signing secret into `IMESSAGE_WEBHOOK_SECRET`.
4. Send an iMessage DM to the connected number.

The adapter verifies the `X-Spectrum-Signature` HMAC before routing the delivery
to the bot. DMs can be answered from a cold webhook invocation because the
adapter can rebuild the DM space from its address.

## Optional gateway polling

The repo also exposes:

```text
GET /gateway
```

That route calls `imessage.startGatewayListener(..., 600_000)`, keeping the
Photon gateway open for up to 10 minutes. On serverless hosts, schedule it about
every 9 minutes if you want polling as a fallback before webhooks are configured
or for gateway-only behavior.

For production, protect this route with a cron secret or another trusted auth
check before exposing it publicly.

## Deploying

For Vercel, set the environment variables above in the project settings and
deploy normally. `eve build` writes Vercel Build Output when the `VERCEL`
environment variable is present.

For a generic Node host:

```bash
npm run build
PORT=3000 npm run start -- --host 0.0.0.0
```

Make sure your deployment has:

- Photon credentials and webhook secret
- Model credentials if you use the eve model loop
- A real auth policy in `agent/channels/eve.ts` before production browser or
  external API traffic
- A protected cron path if you use `/gateway`

## Extending this example

Common next changes:

- Route iMessage DMs through eve instead of `buildReply()`.
- Replace `createMemoryState()` with a durable state adapter for production
  serverless deployments.
- Add real auth to `agent/channels/eve.ts` instead of `placeholderAuth()`.
- Add more typed tools under `agent/tools/`; eve names tools from their file
  paths, so `agent/tools/foo_bar.ts` becomes tool `foo_bar`.
- Keep iMessage output plain text. The adapter strips rich formatting, and the
  current instructions already avoid markdown for SMS/iMessage UX.

## Notes and limitations

- This repo is configured for Photon cloud mode, not local macOS mode.
- Webhooks are the recommended serverless ingestion path.
- DMs are the safest path for cold replies. Group chats may require the gateway
  stream to have seen the group in the current session.
- The current iMessage channel does not call the LLM. It answers from
  `agent/lib/respond.ts` until you wire the inbound message to the eve runtime.
