// agent/lib/memory.ts
const BASE = "https://memory.twilio.com/v1";

export function extractE164(raw: string | undefined): string | null {
  if (!raw) return null;
  const bare = raw.startsWith("whatsapp:") ? raw.slice("whatsapp:".length) : raw;
  return /^\+\d{7,15}$/.test(bare) ? bare : null;
}

function authHeader(): string | null {
  const { TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN } = process.env;
  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN) return null;
  return `Basic ${Buffer.from(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`).toString("base64")}`;
}

// Hydrate the sibling identifier (phone <-> whatsapp) so the same person
// on the other channel resolves to this profile on the next interaction.
// Under GROUP_BY_PROFILE that keeps SMS and WhatsApp in one conversation.
export async function linkCrossChannelIdentity(
  profileId: string,
  address: string,
  channel: string | undefined,
): Promise<void> {
  const auth = authHeader();
  const storeId = process.env.MEMORY_STORE_ID;
  if (!auth || !storeId) return;

  const phone = extractE164(address);
  if (!phone) return;

  const sibling = channel === "WHATSAPP"
    ? { idType: "phone", value: phone }
    : { idType: "whatsapp", value: `whatsapp:${phone}` };

  await fetch(`${BASE}/Stores/${storeId}/Profiles/${profileId}/Identifiers`, {
    method: "POST",
    headers: { Authorization: auth, "Content-Type": "application/json" },
    body: JSON.stringify(sibling),
  });
}

// Twilio treats `phone` and `whatsapp` as separate identity types, so
// Orchestrator creates the profile under whichever channel arrived first.
// Try both when looking up.
async function lookupProfileId(storeId: string, auth: string, phone: string): Promise<string | null> {
  for (const [idType, value] of [
    ["phone", phone],
    ["whatsapp", `whatsapp:${phone}`],
  ] as const) {
    const res = await fetch(`${BASE}/Stores/${storeId}/Profiles/Lookup`, {
      method: "POST",
      headers: { Authorization: auth, "Content-Type": "application/json" },
      body: JSON.stringify({ idType, value }),
    });
    if (!res.ok) continue;
    const { profiles } = (await res.json()) as { profiles?: string[] };
    if (profiles?.[0]) return profiles[0];
  }
  return null;
}

export async function fetchCustomerContext(phoneE164: string) {
  const auth = authHeader();
  const storeId = process.env.MEMORY_STORE_ID;
  if (!auth || !storeId) return null;

  const profileId = await lookupProfileId(storeId, auth, phoneE164);
  if (!profileId) return null;

  const [profileRes, obsRes] = await Promise.all([
    fetch(`${BASE}/Stores/${storeId}/Profiles/${profileId}`, { headers: { Authorization: auth } }),
    fetch(`${BASE}/Stores/${storeId}/Profiles/${profileId}/Observations?PageSize=20`, { headers: { Authorization: auth } }),
  ]);

  const profile = profileRes.ok ? await profileRes.json() : null;
  const observations = obsRes.ok ? (await obsRes.json()).observations ?? [] : [];
  return { traits: profile?.traits ?? {}, observations };
}
