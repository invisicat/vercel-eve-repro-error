import { defineTool } from "eve/tools";
import { z } from "zod";
import { currentDateTime } from "../lib/datetime.js";

/**
 * The agent's first typed tool. Returns the current date and time, optionally in
 * a specific IANA timezone. Defined for the LLM upgrade path; in the
 * zero-credential milestone the channel answers date/time questions directly
 * (see `agent/lib/respond.ts`) without invoking the model.
 */
export default defineTool({
  description:
    "Get the current date and time, optionally in a specific IANA timezone " +
    '(e.g. "Asia/Tokyo", "America/New_York"). Omit the timezone for the host timezone.',
  inputSchema: z.object({
    timezone: z
      .string()
      .optional()
      .describe('IANA timezone name, e.g. "Europe/London". Optional.'),
  }),
  outputSchema: z.object({
    iso: z.string(),
    human: z.string(),
    timezone: z.string(),
  }),
  async execute({ timezone }) {
    return currentDateTime({ timezone });
  },
});
