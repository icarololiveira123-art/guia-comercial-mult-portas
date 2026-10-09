// The private service key stays in the Edge Function. A browser only receives
// opaque app sessions; it never queries Postgres/PostgREST directly.
export function createRestStore({ url, serviceKey, fetchImpl = fetch }) {
  const base = new URL(url);
  if (base.protocol !== "https:" && !["localhost", "127.0.0.1"].includes(base.hostname)) throw new Error("A secure database URL is required.");
  if (typeof serviceKey !== "string" || !serviceKey) throw new Error("A server service key is required.");
  const endpoint = new URL("/rest/v1/rpc/mp_shared_store", base).href;
  return {
    async execute(action, payload = {}, auth = null) {
      // New sb_secret keys are API keys, not JWT bearer tokens. Legacy service
      // JWTs need both headers for compatibility with the PostgREST gateway.
      const headers = { "Content-Type": "application/json", apikey: serviceKey };
      if (!serviceKey.startsWith("sb_secret_")) headers.Authorization = `Bearer ${serviceKey}`;
      const response = await fetchImpl(endpoint, {
        method: "POST", headers, redirect: "error", cache: "no-store",
        body: JSON.stringify({ p_action: action, p_payload: payload,
          p_auth: auth ? { tokenHash: auth.tokenHash, adminVersion: auth.adminVersion, now: auth.now } : null }),
        signal: AbortSignal.timeout(12_000),
      });
      if (!response.ok) {
        // The unique index remains the final authority when two profile edits
        // choose the same username concurrently. Return a useful conflict DTO
        // without relaying any private Postgres error text to the browser.
        if (response.status === 409 && ["update_user", "admin_update_user"].includes(action)) {
          try {
            const failure = await response.json();
            if (failure?.code === "23505") return { status: "username-conflict" };
          } catch { /* A malformed database response remains a server failure. */ }
        }
        throw new Error(`private_store_http_${response.status}`);
      }
      const result = await response.json();
      if (!result || typeof result !== "object" || Array.isArray(result)) throw new Error("private_store_invalid_response");
      return result;
    },
  };
}
