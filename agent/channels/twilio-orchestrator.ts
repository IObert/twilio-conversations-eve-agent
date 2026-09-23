// agent/channels/twilio-orchestrator.ts
import { defineChannel, POST } from "eve/channels";
import { resolveTwilioAuthToken, sendTwilioMessage, type TwilioChannelCredentials } from "eve/channels/twilio";
import twilio from "twilio";
import { linkCrossChannelIdentity } from "../lib/memory";

const publicOrigin = process.env.PUBLIC_BASE_URL!;
const credentials: TwilioChannelCredentials = {};

// Passive capture rules also fire on our own outbound, so filter echoes.
// Self-registering: every address we send from is added below. Seeded with
// known senders from .env so restarts don't reopen the loop before the first send.
const AGENT_ADDRESSES = new Set<string>([
  process.env.TWILIO_SMS_NUMBER!,
  process.env.TWILIO_WHATSAPP_NUMBER!,
]);

// Shape of the Orchestrator webhook body we actually read. Extend as
// you handle more event types.
type WebhookEvent = {
  eventType: string;
  data?: {
    conversationId?: string;
    author?: { address?: string; channel?: string; participantId?: string };
    content?: { type: "TEXT" | "TRANSCRIPTION"; text?: string };
    recipients?: Array<{ address?: string; channel?: string }>;
    // PARTICIPANT_ADDED shape
    type?: string;
    profileId?: string;
    addresses?: Array<{ channel?: string; address?: string }>;
  };
};

// The routing info we stash on auth.attributes so it refreshes on every send.
type RouteAttrs = {
  channel?: string;
  customerAddress?: string;
  agentAddress?: string;
};

// Twilio expects the "whatsapp:" prefix on outbound WhatsApp addresses.
function withChannel(channel: string | undefined, address: string): string {
  if (channel === "WHATSAPP" && !address.startsWith("whatsapp:")) return `whatsapp:${address}`;
  return address;
}

// ...continues below
// ...continued from above

function toPublicUrl(request: Request): string {
  const url = new URL(request.url);
  return `${publicOrigin}${url.pathname}${url.search}`;
}

export default defineChannel({
  routes: [
    POST("/eve/v1/twilio-orchestrator/webhook", async (request, { from, waitUntil }) => {
      const rawBody = await request.text();
      const signature = request.headers.get("x-twilio-signature") ?? "";
      const authToken = await resolveTwilioAuthToken(credentials.authToken);
      if (!twilio.validateRequestWithBody(authToken, signature, toPublicUrl(request), rawBody)) {
        return new Response("unauthorized", { status: 401 });
      }
      // ...continues below
      // ...continued from above
      const ok = new Response("ok", { status: 200 });
      const event = JSON.parse(rawBody) as WebhookEvent;

      // Hydrate the sibling identifier (phone <-> whatsapp) on the CUSTOMER's
      // profile so the next inbound on the other channel resolves to this same
      // profile and, under GROUP_BY_PROFILE, joins the same conversation.
      if (event.eventType === "PARTICIPANT_ADDED") {
        const d = event.data;
        const addr = d?.addresses?.[0];
        if (d?.type === "CUSTOMER" && d.profileId && addr?.address) {
          waitUntil(linkCrossChannelIdentity(d.profileId, addr.address, addr.channel));
        }
        return ok;
      }

      if (event.eventType !== "COMMUNICATION_CREATED") return ok;

      const { conversationId, author, content, recipients } = event.data ?? {};
      const customerAddress = author?.address;
      // Voice arrives as TRANSCRIPTION; skip until voice replies are wired up.
      const text = content?.type === "TEXT" ? content.text : undefined;
      if (!conversationId || !customerAddress || !text) return ok;
      if (AGENT_ADDRESSES.has(customerAddress)) return ok;
      // ...continues below
      // ...continued from above
      const recipient = recipients?.[0];
      const channel = author?.channel ?? recipient?.channel;
      const agentAddress = recipient?.address;

      waitUntil(
        from(conversationId).send(text, {
          auth: {
            attributes: {
              customerAddress,
              ...(channel ? { channel } : {}),
              ...(agentAddress ? { agentAddress } : {}),
            },
            authenticator: "twilio-orchestrator-webhook",
            issuer: "twilio",
            principalId: `twilio-orchestrator:${author?.participantId ?? customerAddress}`,
            principalType: "user",
          },
        }),
      );

      return ok;
    }),
  ],
  // ...continues below
  // ...continued from above
  context(_state, session) {
    const { channel, customerAddress, agentAddress } =
      (session.auth.current?.attributes ?? {}) as RouteAttrs;
    return {
      async sendMessage(body: string) {
        if (!customerAddress || !agentAddress) return null;
        const from = withChannel(channel, agentAddress);
        AGENT_ADDRESSES.add(from);   // register before send, so the echo comes back to a known sender
        return sendTwilioMessage({
          credentials,
          to: withChannel(channel, customerAddress),
          from,
          body,
        });
      },
    };
  },
  // ...continues below
  // ...continued from above
  events: {
    async "message.completed"(event, channel) {
      if (event.finishReason === "tool-calls" || !event.message) return;
      await channel.sendMessage(event.message);
    },
    async "turn.failed"(_event, channel) {
      await channel.sendMessage(
        "I hit an error while handling your request. Please try again.",
      );
    },
  },
});
