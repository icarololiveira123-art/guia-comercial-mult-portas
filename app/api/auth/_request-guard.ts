const MAX_AUTH_BODY_LENGTH = 8_192;
const MAX_RATE_KEYS = 2_000;

type RateEntry = { count: number; startedAt: number; windowMs: number };
const authAttempts = new Map<string, RateEntry>();

function requestIp(request: Request) {
  return request.headers.get("cf-connecting-ip")
    ?? request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    ?? "unknown";
}

function pruneRateKeys(now: number) {
  for (const [key, entry] of authAttempts) {
    if (now - entry.startedAt >= entry.windowMs) authAttempts.delete(key);
  }
  while (authAttempts.size >= MAX_RATE_KEYS) {
    const oldest = authAttempts.keys().next().value as string | undefined;
    if (!oldest) break;
    authAttempts.delete(oldest);
  }
}

function consumeRateKey(key: string, limit: number, windowMs: number) {
  const now = Date.now();
  pruneRateKeys(now);
  const current = authAttempts.get(key);
  if (!current || now - current.startedAt >= windowMs) {
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
  return [`login:ip:${ip}`, `login:user:${ip}:${normalizedUsername}`];
}

export function consumeLoginQuota(keys: string[]) {
  const ipRetry = consumeRateKey(keys[0], 20, 10 * 60 * 1_000);
  const accountRetry = consumeRateKey(keys[1], 8, 10 * 60 * 1_000);
  return Math.max(ipRetry ?? 0, accountRetry ?? 0) || null;
}

export function consumeRegistrationQuota(request: Request) {
  return consumeRateKey(`register:ip:${requestIp(request)}`, 5, 10 * 60 * 1_000);
}

export function clearAuthQuota(keys: string[]) {
  keys.forEach((key) => authAttempts.delete(key));
}

export function rateLimitResponse(retryAfter: number) {
  return Response.json(
    { error: "Muitas tentativas em sequência. Aguarde um pouco e tente novamente." },
    { status: 429, headers: { "Cache-Control": "no-store", "Retry-After": String(retryAfter) } },
  );
}

export async function readBoundedAuthJson(request: Request, errorMessage: string) {
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(contentLength) && contentLength > MAX_AUTH_BODY_LENGTH) {
    return { response: Response.json({ error: "Os dados enviados ultrapassaram o limite." }, { status: 413 }) } as const;
  }
  try {
    const raw = await request.text();
    if (raw.length > MAX_AUTH_BODY_LENGTH) {
      return { response: Response.json({ error: "Os dados enviados ultrapassaram o limite." }, { status: 413 }) } as const;
    }
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { response: Response.json({ error: errorMessage }, { status: 400 }) } as const;
    }
    return { value: parsed as Record<string, unknown> } as const;
  } catch {
    return { response: Response.json({ error: errorMessage }, { status: 400 }) } as const;
  }
}
