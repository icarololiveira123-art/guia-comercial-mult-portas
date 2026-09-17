function isLocalDevelopmentOrigin(origin: string) {
  try {
    const url = new URL(origin);
    return url.protocol === "http:" && ["localhost", "127.0.0.1", "terminal.local"].includes(url.hostname);
  } catch {
    return false;
  }
}

export function isTrustedAppOrigin(origin: string) {
  try {
    const normalized = new URL(origin).origin;
    return normalized.startsWith("https://") || isLocalDevelopmentOrigin(normalized);
  } catch {
    return false;
  }
}

/**
 * State-changing routes accept only the published application (plus local
 * development). Browsers send Origin on cross-site writes, which prevents a
 * third-party page from reusing the cross-site session cookie.
 */
export function isTrustedAppRequest(request: Request) {
  try {
    const requestOrigin = new URL(request.url).origin;
    if (!isTrustedAppOrigin(requestOrigin)) return false;
    const origin = request.headers.get("origin");
    if (!origin) return true;
    return new URL(origin).origin === requestOrigin;
  } catch {
    return false;
  }
}

export function rejectUntrustedMutation(request: Request) {
  if (["GET", "HEAD", "OPTIONS"].includes(request.method.toUpperCase())) return null;
  if (isTrustedAppRequest(request)) return null;
  return Response.json(
    { error: "Solicitação não autorizada." },
    { status: 403, headers: { "Cache-Control": "no-store" } },
  );
}

export function withApiSecurityHeaders(response: Response) {
  const headers = new Headers(response.headers);
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("X-Frame-Options", "DENY");
  headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  headers.set("X-Robots-Tag", "noindex, nofollow, noarchive");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
