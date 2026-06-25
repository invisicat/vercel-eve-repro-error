/**
 * iMessage channel (Approach B): mounts the Photon `chat-adapter-imessage`
 * transport inside a custom eve channel.
 *
 * eve does not use the Chat SDK runtime, so we run a `Chat` bot ourselves for
 * the iMessage transport (HMAC-verified webhooks + DM sending over spectrum-ts)
 * and expose its webhook/gateway entrypoints as eve routes.
 *
 *
 * Going live needs Photon cloud credentials in the environment:
 *   IMESSAGE_PROJECT_ID, IMESSAGE_PROJECT_SECRET, IMESSAGE_WEBHOOK_SECRET
 *
 * Without those, the adapter can't be constructed, so the channel boots in a
 * dormant state and its routes return 503 — the rest of the agent still runs.
 */

import { defineChannel, GET, POST } from "eve/channels";
import { Chat } from "chat";
import { createMemoryState } from "@chat-adapter/state-memory";
import {
  createiMessageAdapter,
  type iMessageAdapter,
} from "chat-adapter-imessage";
import { buildReply } from "../lib/respond.js";

const projectId = process.env.IMESSAGE_PROJECT_ID;
const projectSecret = process.env.IMESSAGE_PROJECT_SECRET;
const configured = Boolean(projectId && projectSecret);

// Hold a direct reference to the adapter: `startGatewayListener` lives on the
// adapter, and Chat does not expose its adapters publicly.
let imessage: iMessageAdapter | undefined;
let bot: Chat<{ imessage: iMessageAdapter }> | undefined;

if (configured) {
  imessage = createiMessageAdapter({
    local: false, // cloud (Spectrum) mode
    projectId,
    projectSecret,
    webhookSecret: process.env.IMESSAGE_WEBHOOK_SECRET,
  });

  bot = new Chat({
    userName: process.env.IMESSAGE_USERNAME ?? "assistant",
    adapters: { imessage },
    // In-memory thread state (subscriptions, dedupe, locks). Fine for the dev
    // milestone; swap for a durable adapter (e.g. Redis) for production
    // serverless so state survives across invocations.
    state: createMemoryState(),
  });

  // Every inbound DM gets a deterministic, plain-text reply. Posting back to a
  // DM works even on a cold webhook invocation: the adapter rebuilds the DM's
  // spectrum-ts Space from its address.
  bot.onDirectMessage(async (thread, message) => {
    await thread.post(buildReply(message.text));
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
      if (!imessage) return notConfigured();
      return imessage.startGatewayListener(
        { waitUntil: (p) => waitUntil(p) },
        600_000,
      );
    }),
  ],
});
