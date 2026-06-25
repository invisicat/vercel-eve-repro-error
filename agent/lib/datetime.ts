/**
 * Pure date/time helpers shared by the iMessage channel (deterministic replies)
 * and the `get_current_datetime` tool. No I/O, no framework deps — easy to test.
 */

export interface CurrentDateTime {
  /** Machine-readable ISO 8601 timestamp (always UTC instant). */
  iso: string;
  /** Human-readable date + time rendered in `timezone`. */
  human: string;
  /** The IANA timezone the `human` string was rendered in. */
  timezone: string;
}

/** Return `true` if `tz` is a valid IANA timezone the runtime understands. */
export function isValidTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/**
 * Current date/time. Pass an IANA timezone (e.g. "Asia/Tokyo"); invalid or
 * omitted falls back to the host timezone. `now` is injectable for tests.
 */
export function currentDateTime(
  options: { timezone?: string } = {},
  now: Date = new Date(),
): CurrentDateTime {
  const hostTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const timezone =
    options.timezone && isValidTimezone(options.timezone)
      ? options.timezone
      : hostTz;

  const human = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    dateStyle: "full",
    timeStyle: "long",
  }).format(now);

  return { iso: now.toISOString(), human, timezone };
}
