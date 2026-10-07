// scripts/provision.mjs
// Creates the Twilio Memory Store and the Orchestrator Configuration
// (GROUP_BY_PROFILE, SMS + WhatsApp) and writes their ids into .env.
//
//   pnpm provision
//
// Needs TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_SMS_NUMBER,
// TWILIO_WHATSAPP_NUMBER and PUBLIC_BASE_URL to be set in .env first.
// Already-set MEMORY_STORE_ID / ORCHESTRATOR_CONFIG_ID are reused, not recreated.
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const ENV_FILE = process.env.ENV_FILE ?? ".env";
const SUFFIX = process.env.NAME_SUFFIX ?? "";
if (!existsSync(ENV_FILE)) {
  console.error("No .env found. Run `cp .env.example .env` and fill it in first.");
  process.exit(1);
}
process.loadEnvFile(ENV_FILE);

const required = ["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_SMS_NUMBER", "TWILIO_WHATSAPP_NUMBER", "PUBLIC_BASE_URL"];
const missing = required.filter((k) => !process.env[k]);
if (missing.length) {
  console.error(`Missing in .env: ${missing.join(", ")}`);
  process.exit(1);
}

const { TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_SMS_NUMBER, TWILIO_WHATSAPP_NUMBER } = process.env;
const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL.replace(/\/$/, "");
const authorization = `Basic ${Buffer.from(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`).toString("base64")}`;

async function call(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: { Authorization: authorization, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${url} -> ${res.status}\n${text}`);
  return text ? JSON.parse(text) : {};
}

// Both create calls return 202 with a statusUrl. Poll it until COMPLETED, then
// read the new resource id. Memory puts it in `result.id`; Conversations
// returns it up front in `related.configurationId`.
async function waitForOperation(statusUrl) {
  for (let i = 0; i < 30; i++) {
    const op = await call("GET", statusUrl);
    if (process.env.DEBUG) console.log(JSON.stringify(op, null, 2));
    const status = String(op.status ?? "").toUpperCase();
    if (status === "FAILED") throw new Error(`Operation failed:\n${JSON.stringify(op, null, 2)}`);
    if (status === "COMPLETED") return op;
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error(`Timed out waiting for ${statusUrl}`);
}

function saveEnv(key, value) {
  let env = readFileSync(ENV_FILE, "utf8");
  const line = `${key}=${value}`;
  env = new RegExp(`^${key}=.*$`, "m").test(env)
    ? env.replace(new RegExp(`^${key}=.*$`, "m"), line)
    : `${env.replace(/\n*$/, "\n")}${line}\n`;
  writeFileSync(ENV_FILE, env);
}

// A placeholder from .env.example counts as unset.
const isSet = (v, prefix) => typeof v === "string" && v.startsWith(prefix) && !v.endsWith("xxxxxxxx");

let storeId = process.env.MEMORY_STORE_ID;
if (isSet(storeId, "mem_store_")) {
  console.log(`Reusing Memory Store ${storeId}`);
} else {
  console.log("Creating Memory Store...");
  const { statusUrl } = await call("POST", "https://memory.twilio.com/v1/ControlPlane/Stores", {
    displayName: `elephant-agent-store${SUFFIX}`,
  });
  storeId = (await waitForOperation(statusUrl)).result?.id;
  if (!storeId) throw new Error("Operation completed but result.id is missing (re-run with DEBUG=1)");
  saveEnv("MEMORY_STORE_ID", storeId);
  console.log(`  MEMORY_STORE_ID=${storeId}`);
}

if (isSet(process.env.ORCHESTRATOR_CONFIG_ID, "conv_configuration_")) {
  console.log(`Reusing Orchestrator Configuration ${process.env.ORCHESTRATOR_CONFIG_ID}`);
} else {
  console.log("Creating Orchestrator Configuration...");
  const both = (address) => [
    { from: "*", to: address, metadata: {} },
    { from: address, to: "*", metadata: {} },
  ];
  const { statusUrl } = await call("POST", "https://conversations.twilio.com/v2/ControlPlane/Configurations", {
    displayName: `elephant-agent-config${SUFFIX}`,
    description:
      "Cross-channel Conversation Orchestrator for the elephant-agent memory demo. Groups SMS and WhatsApp traffic by customer profile and hands turns to the eve runtime.",
    conversationGroupingType: "GROUP_BY_PROFILE",
    memoryStoreId: storeId,
    memoryExtractionEnabled: true,
    channelSettings: {
      SMS: { captureRules: both(TWILIO_SMS_NUMBER) },
      WHATSAPP: { captureRules: both(TWILIO_WHATSAPP_NUMBER) },
    },
    statusCallbacks: [{ method: "POST", url: `${PUBLIC_BASE_URL}/eve/v1/twilio-orchestrator/webhook` }],
  });
  const configId = (await waitForOperation(statusUrl)).related?.configurationId;
  if (!configId) throw new Error("Operation completed but related.configurationId is missing (re-run with DEBUG=1)");
  saveEnv("ORCHESTRATOR_CONFIG_ID", configId);
  console.log(`  ORCHESTRATOR_CONFIG_ID=${configId}`);
}

console.log("Done. .env is up to date.");
