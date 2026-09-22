// agent/instructions/customer-context.ts
import { defineDynamic, defineInstructions } from "eve/instructions";
import { extractE164, fetchCustomerContext } from "../lib/memory";

export default defineDynamic({
  events: {
    "session.started": async (_event, ctx) => {
      const attrs = ctx.session.auth.initiator?.attributes as
        | { from?: string; customerAddress?: string }
        | undefined;
      const phone = extractE164(attrs?.from ?? attrs?.customerAddress);
      if (!phone) return null;

      const context = await fetchCustomerContext(phone);
      if (!context) return null;

      const lines: string[] = [];
      for (const [group, traits] of Object.entries(context.traits)) {
        for (const [key, value] of Object.entries(traits)) {
          if (value !== null && value !== undefined && value !== "") {
            lines.push(`${group}.${key}: ${typeof value === "string" ? value : JSON.stringify(value)}`);
          }
        }
      }
      if (context.observations.length > 0) {
        lines.push("recent_observations:");
        for (const obs of context.observations) lines.push(`- ${obs.content}`);
      }
      if (lines.length === 0) return null;

      return defineInstructions({
        content: ["<customer_context>", ...lines, "</customer_context>"].join("\n"),
      });
    },
  },
});
