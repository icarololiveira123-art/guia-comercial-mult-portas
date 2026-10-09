import { createSharedApi } from "./shared-api.mjs";
import { createRestStore } from "./rest-store.mjs";

// Local declaration keeps the repository's Node/React typecheck independent
// from Deno's ambient declarations. Supabase supplies this runtime in production.
declare const Deno: {
  env: { get(key: string): string | undefined };
  serve(handler: (request: Request) => Promise<Response>): void;
};

function secretKey() {
  const legacy = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (legacy) return legacy;
  const raw = Deno.env.get("SUPABASE_SECRET_KEYS");
  if (!raw) return "";
  const values = JSON.parse(raw) as Record<string, unknown>;
  return Object.values(values).find((value): value is string => typeof value === "string" && value.startsWith("sb_secret_")) ?? "";
}

const store = createRestStore({ url: Deno.env.get("SUPABASE_URL") ?? "", serviceKey: secretKey() });
const handler = createSharedApi({
  store,
  accessPassword: Deno.env.get("MP_ACCESS_PASSWORD") ?? "",
  // This is an origin (no repository path), not an arbitrary caller-provided URL.
  allowedOrigins: ["https://icarololiveira123-art.github.io"],
  // Do not use client-provided X-Forwarded-For for security decisions.
  onError: ({ code, name }: { code: string; name: string }) => console.error(code, { name }),
});

Deno.serve(handler);
