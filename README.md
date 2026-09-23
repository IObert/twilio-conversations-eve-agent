# twilio-conversations-eve-agent

A multi-channel AI agent that unifies **SMS and WhatsApp** into a single conversation and remembers customers across sessions — built with [eve](https://eve.dev) and [Twilio Conversations](https://www.twilio.com/en-us/blog/developers/tutorials/product/orchestrate-multi-call-conversations-with-llm-twilio-conversation-memory).

> **This repo is the companion project to the blog post [TBD — link]**, which walks through every file end-to-end. The README stays minimal on purpose. Read the post for the *why*; read the code for the *how*.

## What it does

- Receives inbound messages on both SMS and WhatsApp through **Twilio Conversation Orchestrator** with `GROUP_BY_PROFILE`, so the same person on both channels lands in **one** conversation.
- Uses **Twilio Memory Store** for long-term per-customer memory. Traits and observations are injected into the model prompt on every session.
- Uses **eve** for the short-term per-conversation transcript, model calls, and durable session state.
- Lets you swap the model in one line via the [AI SDK](https://ai-sdk.dev).

## Architecture

```
      ┌───────────────────── Twilio Conversations ─────────────────────┐
SMS ──▶│  Orchestrator  ──▶  Memory Store  ──▶  Intelligence           │
WhatsApp ──▶ (GROUP_BY_PROFILE)  (traits + observations)  (extraction) │
      └────────────────┬───────────────────────────────────────────────┘
                       │ COMMUNICATION_CREATED webhook
                       ▼
              ┌────────────────────┐
              │        eve         │
              │  session transcript│  ──▶  any AI SDK model
              │  dynamic prompt    │
              └────────────────────┘
```

Short-term memory (this conversation) lives in eve. Long-term memory (this customer, across every past conversation) lives in Twilio.

## Repo layout

```
agent/
├── agent.ts                              # model + runtime config
├── instructions.md                       # base system prompt
├── channels/
│   ├── eve.ts                            # local CLI channel (pnpm dev)
│   ├── twilio-orchestrator.ts            # Orchestrator webhook + reply routing
│   └── twilio-builtin.ts.example         # illustrative only — see comments inside
├── instructions/
│   └── customer-context.ts               # injects Memory Store traits/observations
└── lib/
    └── memory.ts                         # Memory Store REST helpers
```

Two files carry the interesting logic: [agent/channels/twilio-orchestrator.ts](agent/channels/twilio-orchestrator.ts) and [agent/lib/memory.ts](agent/lib/memory.ts). The blog post walks through both.

## Why not the built-in `twilioChannel()`?

eve ships a `twilioChannel()` adapter that gets you a working SMS agent in ~10 lines. It's the right starting point for a POC, but it drops MMS media, treats voice as a single `<Gather>` turn, and gives every phone number its own session identity — so SMS and WhatsApp from the same person become two separate customers. See [agent/channels/twilio-builtin.ts.example](agent/channels/twilio-builtin.ts.example) for the full contrast. The blog post explains the tradeoffs.

## Getting started

Follow the blog post — it covers prerequisites, Twilio provisioning (Memory Store + Orchestrator Configuration with `GROUP_BY_PROFILE`), env vars, and ngrok setup. When you're ready to run the agent:

```bash
pnpm install
cp .env.example .env    # fill in the values
pnpm dev
```

## License

Apache 2.0 — see [LICENSE](LICENSE).
