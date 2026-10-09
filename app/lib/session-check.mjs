const fallback = "Não foi possível verificar o acesso. Tente novamente.";

export async function readAccessSession(request, signal) {
  const response = await request("/api/auth/me", { cache: "no-store", signal });
  let payload;
  try { payload = await response.json(); } catch { throw new Error(fallback); }
  if (!response.ok) {
    throw new Error(typeof payload?.error === "string" && payload.error ? payload.error : fallback);
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error(fallback);
  if (payload.admin === true) return { user: null, admin: true, workspaceAccess: false };
  if (payload.user === null && payload.admin === false) return { user: null, admin: false, workspaceAccess: false };
  const user = payload.user;
  if (!user || !Number.isSafeInteger(user.id) || user.id <= 0
    || typeof user.username !== "string" || typeof user.displayName !== "string"
    || !["Araraquara", "São Carlos"].includes(user.branch)) throw new Error(fallback);
  return { user, admin: false, workspaceAccess: payload.workspaceAccess === true };
}
