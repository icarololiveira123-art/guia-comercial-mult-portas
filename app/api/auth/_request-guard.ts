import { readLimitedRequestText, RequestBodyLimitError } from "../_request-body";

const MAX_AUTH_BODY_LENGTH = 8_192;
const MAX_RATE_KEYS = 2_000;

type RateEntry = { count: number; startedAt: number; windowMs: number };
const authAttempts = new Map<string, RateEntry>();

function authJsonError(error: string, status: number) {
  return Response.json({ error }, { status, headers: { "Cache-Control": "no-store" } });
}

function requestIp(request: Request) {
  return request.headers.get("cf-connecting-ip")
    ?? request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    ?? "unknown";
}

function pruneRateKeys(now: number) {
  for (const [key, entry] of authAttempts) {
    if (now - entry.startedAt >= entry.windowMs) authAttempts.delete(key);
  }
}

function consumeRateKey(key: string, limit: number, windowMs: number) {
  const now = Date.now();
  pruneRateKeys(now);
  const current = authAttempts.get(key);
  if (!current || now - current.startedAt >= windowMs) {
    if (authAttempts.size >= MAX_RATE_KEYS) {
      // Never evict an active block to admit an attacker-controlled new key.
      let retryMs = windowMs;
      for (const entry of authAttempts.values()) {
        retryMs = Math.min(retryMs, entry.windowMs - (now - entry.startedAt));
      }
      return Math.max(1, Math.ceil(retryMs / 1_000));
    }
    authAttempts.set(key, { count: 1, startedAt: now, windowMs });
    return null;
  }
  if (current.count >= limit) {
    return Math.max(1, Math.ceil((windowMs - (now - current.startedAt)) / 1_000));
  }
  current.count += 1;
  return null;
}

export function loginRateKeys(request: Request, username: string) {
  const ip = requestIp(request);
  const normalizedUsername = username.trim().toLocaleLowerCase("pt-BR").slice(0, 40) || "empty";
  return [`login:ip:${ip}`, `login:user:${normalizedUsername}`];
}

export function consumeLoginQuota(keys: string[]) {
  // Several employees can share one office gateway; the account-specific
  // limit remains strict while the shared IP budget tolerates a normal shift.
  const ipRetry = consumeRateKey(keys[0], 100, 10 * 60 * 1_000);
  if (ipRetry !== null) return ipRetry;
  const accountRetry = consumeRateKey(keys[1], 8, 10 * 60 * 1_000);
  return Math.max(ipRetry ?? 0, accountRetry ?? 0) || null;
}

export function consumeRegistrationQuota(request: Request, username: string) {
  const normalizedUsername = username.trim().toLocaleLowerCase("pt-BR").slice(0, 40) || "empty";
  const ipRetry = consumeRateKey(`register:ip:${requestIp(request)}`, 5, 10 * 60 * 1_000);
  if (ipRetry !== null) return ipRetry;
  const accountRetry = consumeRateKey(`register:user:${normalizedUsername}`, 3, 10 * 60 * 1_000);
  return Math.max(ipRetry ?? 0, accountRetry ?? 0) || null;
}

export function clearAuthQuota(keys: string[]) {
  // Keep the shared IP budget so a valid credential cannot reset brute-force
  // protection for every other account behind the same request source.
  keys.slice(1).forEach((key) => authAttempts.delete(key));
}

export function rateLimitResponse(retryAfter: number) {
  return Response.json(
    { error: "Muitas tentativas em sequência. Aguarde um pouco e tente novamente." },
    { status: 429, headers: { "Cache-Control": "no-store", "Retry-After": String(retryAfter) } },
  );
}

export async function readBoundedAuthJson(request: Request, errorMessage: string) {
  try {
    const raw = await readLimitedRequestText(request, MAX_AUTH_BODY_LENGTH);
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { response: authJsonError(errorMessage, 400) } as const;
    }
    return { value: parsed as Record<string, unknown> } as const;
  } catch (error) {
    if (error instanceof RequestBodyLimitError) {
      return { response: authJsonError("Os dados enviados ultrapassaram o limite.", 413) } as const;
    }
    return { response: authJsonError(errorMessage, 400) } as const;
  }
}

