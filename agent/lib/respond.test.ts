import { test, expect } from "bun:test";
import { buildReply, HELP } from "./respond.js";
import { currentDateTime, isValidTimezone } from "./datetime.js";

// A fixed instant: 2026-06-25T15:30:00Z
const NOW = new Date("2026-06-25T15:30:00.000Z");

test("echoes arbitrary text", () => {
  expect(buildReply("hello there", NOW)).toBe('You said: "hello there"');
});

test("handles empty input", () => {
  expect(buildReply("   ", NOW)).toBe(
    "I didn't catch that — try sending some text.",
  );
});

test("answers a time question with markdown styling", () => {
  const reply = buildReply("what time is it?", NOW);
  expect(reply.startsWith("It's currently ")).toBe(true);
  expect(reply).toContain("**");
});

test("help lists the demo commands", () => {
  for (const command of ["react", "unreact", "delete", "fetch"]) {
    expect(HELP).toContain(`\`${command}\``);
  }
});

test("answers a date question", () => {
  expect(buildReply("what's the date today", NOW)).toContain("2026");
});

test("resolves a timezone hint", () => {
  const reply = buildReply("what time is it in Tokyo?", NOW);
  expect(reply).toContain("Asia/Tokyo");
});

test("currentDateTime renders the given timezone", () => {
  const dt = currentDateTime({ timezone: "UTC" }, NOW);
  expect(dt.timezone).toBe("UTC");
  expect(dt.iso).toBe("2026-06-25T15:30:00.000Z");
  expect(dt.human).toContain("2026");
});

test("invalid timezone falls back to host", () => {
  const dt = currentDateTime({ timezone: "Not/AZone" }, NOW);
  expect(dt.timezone).not.toBe("Not/AZone");
  expect(isValidTimezone("Not/AZone")).toBe(false);
});
