/**
 * Deterministic, model-free reply logic for the zero-credential milestone.
 *
 * The iMessage channel calls `buildReply(text)` to answer a DM without invoking
 * any LLM: it recognizes date/time questions and otherwise echoes the message.
 * Replies are CommonMark — the adapter (v2) sends them through spectrum's
 * `markdown()` builder so iMessage renders them as native styled text.
 * Pure and synchronous so it can be unit-tested directly. When a model is wired
 * up later, this is replaced by routing through the eve agent.
 */

import { currentDateTime } from "./datetime.js";

/** Common city / keyword → IANA timezone hints for "what time in X" questions. */
const TZ_HINTS: Record<string, string> = {
  tokyo: "Asia/Tokyo",
  london: "Europe/London",
  paris: "Europe/Paris",
  berlin: "Europe/Berlin",
  "new york": "America/New_York",
  nyc: "America/New_York",
  "los angeles": "America/Los_Angeles",
  la: "America/Los_Angeles",
  chicago: "America/Chicago",
  sydney: "Australia/Sydney",
  utc: "UTC",
};

const DATETIME_INTENT = /\b(date|time|day|clock|what.?s the (date|time)|o.?clock)\b/i;

/** Pull a timezone hint out of a "...in <place>" phrase, if present. */
function timezoneFromText(text: string): string | undefined {
  const lower = text.toLowerCase();
  for (const [needle, tz] of Object.entries(TZ_HINTS)) {
    if (lower.includes(needle)) return tz;
  }
  return undefined;
}

/**
 * Build a markdown reply for an inbound DM. `now` is injectable for tests.
 */
export function buildReply(text: string, now: Date = new Date()): string {
  const trimmed = text.trim();

  if (DATETIME_INTENT.test(trimmed)) {
    const { human, timezone } = currentDateTime(
      { timezone: timezoneFromText(trimmed) },
      now,
    );
    return `It's currently **${human}** (${timezone}).`;
  }

  if (!trimmed) return "I didn't catch that — try sending some text.";

  return `You said: "${trimmed}"`;
}

/**
 * Markdown help text for the `help` command: the demo commands the iMessage
 * channel routes on, each exercising one adapter v2 capability.
 */
export const HELP = [
  "**eve iMessage test agent** — things to try:",
  "- `react` — I'll ❤️ your message",
  "- `unreact` — I'll retract that ❤️",
  "- `delete` — I'll unsend my previous reply (and 👍 yours to confirm)",
  "- `fetch` — I'll look your message up by id and echo what I found",
  "- `effect <name>` — expressive send (bare `effect` = confetti). Screen: confetti, fireworks, balloons, heart, lasers, celebration, sparkles, spotlight, echo. Bubble: slam, loud, gentle, invisible",
  "- `miniapp <url>` — send the URL as a mini-app card (bare `miniapp` = example.com/menu)",
  '- a date/time question ("what time is it in Tokyo?")',
  "- anything else gets echoed back as **native styled text**",
].join("\n");
