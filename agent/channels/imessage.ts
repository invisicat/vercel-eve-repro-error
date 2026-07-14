/**
 * iMessage channel (Approach B): mounts the Photon `@photon-ai/chat-adapter-imessage`
 * transport inside a custom eve channel.
 *
 * eve does not use the Chat SDK runtime, so we run a `Chat` bot ourselves for
 * the iMessage transport (HMAC-verified webhooks + DM sending over spectrum-ts)
 * and expose its webhook/gateway entrypoints as eve routes.
 *
 * The DM handler doubles as a live exercise of the adapter v2 surface:
 *   - replies post as `{ markdown }` → native iMessage styled text
 *   - every inbound message gets a read receipt (`markRead`)
 *   - `react` / `unreact`  → tapback add + removal (session reaction cache)
 *   - `delete`             → unsend the bot's previous reply
 *   - `fetch`              → single-message lookup by id (`fetchMessage`)
 *   - POST /imessage/dm    → cold-start a DM by phone number (`openDM`)
 *
 * Going live needs Photon cloud credentials in the environment:
 *   IMESSAGE_PROJECT_ID, IMESSAGE_PROJECT_SECRET, IMESSAGE_WEBHOOK_SECRET
 *
 * Without those, the adapter can't be constructed, so the channel boots in a
 * dormant state and its routes return 503 — the rest of the agent still runs.
 */

import { defineChannel, GET, POST } from "eve/channels";
import { Chat, type SentMessage } from "chat";
import { createMemoryState } from "@chat-adapter/state-memory";
import {
  createiMessageAdapter,
  type iMessageAdapter,
  type iMessageEffectName,
} from "@photon-ai/chat-adapter-imessage";
import { buildReply, HELP } from "../lib/respond.js";

const projectId = process.env.IMESSAGE_PROJECT_ID;
const projectSecret = process.env.IMESSAGE_PROJECT_SECRET;
const configured = Boolean(projectId && projectSecret);

// Chat SDK reactions are passed by *name* ("heart", "thumbs_up", ...), which
// the adapter maps to iMessage tapback glyphs — raw emoji characters throw.
/** Tapback used by the `react` / `unreact` demo commands. */
const REACTION = "heart";

// Hold a direct reference to the adapter: `startGatewayListener`, `openDM`,
// `markRead`, and reacting to *inbound* messages live on the adapter, and
// Chat only wraps mutation methods on messages the bot itself sent.
let imessage: iMessageAdapter | undefined;
let bot: Chat<{ imessage: iMessageAdapter }> | undefined;

if (configured) {
  const adapter = createiMessageAdapter({
    projectId,
    projectSecret,
    webhookSecret: process.env.IMESSAGE_WEBHOOK_SECRET,
  });
  imessage = adapter;

  bot = new Chat({
    userName: process.env.IMESSAGE_USERNAME ?? "assistant",
    adapters: { imessage: adapter },
    // In-memory thread state (subscriptions, dedupe, locks). Fine for the dev
    // milestone; swap for a durable adapter (e.g. Redis) for production
    // serverless so state survives across invocations.
    state: createMemoryState(),
  });

  // Per-thread bookkeeping for the demo commands. In-memory like the state
  // adapter above: `delete`/`unreact` need the message posted or reacted to in
  // this same session anyway (the adapter can only unsend handles it holds).
  const lastReply = new Map<string, SentMessage>();
  const lastReacted = new Map<string, string>();

  // Command router over inbound DMs. Posting back to a DM works even on a
  // cold webhook invocation: the adapter rebuilds the DM's spectrum-ts Space
  // from its address.
  bot.onDirectMessage(async (thread, message) => {
    // Read receipt for the inbound message. Best-effort: only supported in
    // remote mode, and only for messages resolvable in this session.
    await adapter.markRead(message.threadId, message.id).catch(() => {});

    const command = message.text.trim().toLowerCase();
    try {
      // `effect` / `effect <name>` — expressive send. Prefix-matched here
      // because the switch below is exact-match only. An unknown name throws a
      // ValidationError listing the supported effects, which the catch below
      // surfaces to the conversation.
      if (command === "effect" || command.startsWith("effect ")) {
        const name = (command.slice("effect".length).trim() ||
          "confetti") as iMessageEffectName;
        // Returns a RawMessage, not a Chat SDK SentMessage, so it can't feed
        // the `delete` demo via lastReply.
        await adapter.sendEffect(
          message.threadId,
          { markdown: `✨ Sent with the **${name}** effect!` },
          name,
        );
        return;
      }

      // `miniapp` / `miniapp <url>` — send the URL as an MSMessageExtension
      // mini-app balloon (the lightweight `app(url)` form, no extension
      // identifiers). URL is taken from the raw text since paths are
      // case-sensitive and `command` is lowercased.
      if (command === "miniapp" || command.startsWith("miniapp ")) {
        const url =
          message.text.trim().slice("miniapp".length).trim() ||
          "https://natural.co/signin";
        await adapter.sendMiniApp(message.threadId, url);
        return;
      }

      switch (command) {
        case "help": {
          lastReply.set(thread.id, await thread.post({ markdown: HELP }));
          return;
        }

        case "react": {
          await adapter.addReaction(message.threadId, message.id, REACTION);
          lastReacted.set(thread.id, message.id);
          return;
        }

        case "unreact": {
          const target = lastReacted.get(thread.id);
          if (!target) {
            lastReply.set(
              thread.id,
              await thread.post({
                markdown: "Nothing to retract — send `react` first.",
              }),
            );
            return;
          }
          await adapter.removeReaction(message.threadId, target, REACTION);
          lastReacted.delete(thread.id);
          return;
        }

        case "delete": {
          const last = lastReply.get(thread.id);
          if (!last) {
            lastReply.set(
              thread.id,
              await thread.post({
                markdown: "I have no earlier reply to unsend.",
              }),
            );
            return;
          }
          await last.delete();
          lastReply.delete(thread.id);
          // Acknowledge on the user's message — a posted confirmation would
          // itself become the next `delete` target, which reads oddly.
          await adapter.addReaction(message.threadId, message.id, "thumbs_up");
          return;
        }

        case "fetch": {
          const fetched = await adapter.fetchMessage(
            message.threadId,
            message.id,
          );
          const body = fetched
            ? `Fetched your message by id: "${fetched.text}" (id \`${fetched.id}\`)`
            : "I couldn't resolve that message by id.";
          lastReply.set(thread.id, await thread.post({ markdown: body }));
          return;
        }

        default: {
          lastReply.set(
            thread.id,
            await thread.post({ markdown: buildReply(message.text) }),
          );
        }
      }
    } catch (error) {
      // Surface adapter errors (e.g. NotImplementedError in local mode) to the
      // conversation — this is a test agent, transparency beats polish.
      const reason = error instanceof Error ? error.message : String(error);
      await thread.post(`⚠️ ${reason}`);
    }
  });
} else {
  console.warn(
    "[imessage] IMESSAGE_PROJECT_ID / IMESSAGE_PROJECT_SECRET not set — " +
      "channel is dormant and its routes will return 503.",
  );
}

const notConfigured = () =>
  Response.json(
    {
      error:
        "iMessage channel not configured: set IMESSAGE_PROJECT_ID and IMESSAGE_PROJECT_SECRET.",
    },
    { status: 503 },
  );

export default defineChannel({
  routes: [
    // Spectrum Cloud delivers signed message events here.
    POST("/webhooks/imessage", async (req, { waitUntil }) => {
      if (!bot) return notConfigured();
      return bot.webhooks.imessage(req, { waitUntil: (p) => waitUntil(p) });
    }),

    // Fallback ingestion: a long-poll gateway listener driven by Vercel Cron
    // (e.g. `*/9 * * * *`). Works before any dashboard webhook is registered.
    GET("/gateway", async (_req, { waitUntil }) => {
      if (!bot || !imessage) return notConfigured();
      // The webhook path initializes the Chat instance lazily, but direct
      // adapter calls (gateway, openDM) need it done explicitly first.
      await bot.initialize();
      return imessage.startGatewayListener(
        { waitUntil: (p) => waitUntil(p) },
        600_000,
      );
    }),

    // Cold-start a DM: `openDM` resolves (or creates) the 1:1 conversation
    // from a phone number / handle the bot has never received from.
    //   curl -X POST .../imessage/dm -d '{"to":"+15551234567","text":"hi"}'
    POST("/imessage/dm", async (req) => {
      if (!bot || !imessage) return notConfigured();
      await bot.initialize();

      let payload: { to?: unknown; text?: unknown };
      try {
        payload = await req.json();
      } catch {
        return Response.json(
          { error: "expected a JSON body: { to, text? }" },
          { status: 400 },
        );
      }

      const to = typeof payload.to === "string" ? payload.to.trim() : "";
      if (!to) {
        return Response.json(
          { error: "missing `to` (phone number or handle)" },
          { status: 400 },
        );
      }
      const text =
        typeof payload.text === "string" && payload.text.trim()
          ? payload.text
          : "👋 Hello! Cold-start DM from the eve iMessage agent. Text `help` to see what I can do.";

      // Phone numbers aren't a globally distinguishable user-id format, so use
      // the adapter's openDM directly and wrap the thread id it returns.
      const threadId = await imessage.openDM(to);
      const sent = await bot.thread(threadId).post({ markdown: text });
      return Response.json({ threadId, messageId: sent.id });
    }),
  ],
});
