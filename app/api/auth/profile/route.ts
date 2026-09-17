import { eq } from "drizzle-orm";
import { getDb } from "../../../../db";
import { employeeSessions, employeeUsers } from "../../../../db/schema";
import { rejectUntrustedMutation } from "../../_security";
import {
  createSession,
  getSessionUser,
  hashPassword,
  normalizeUsername,
  userPayload,
  verifyPassword,
} from "../_lib";

const allowedBranches = new Set(["Araraquara", "São Carlos"]);

function jsonResponse(body: Record<string, unknown>, status = 200, headers?: HeadersInit) {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store", ...Object.fromEntries(new Headers(headers)) },
  });
}

export async function PATCH(request: Request) {
  try {
    const originError = rejectUntrustedMutation(request);
    if (originError) return originError;

    const sessionUser = await getSessionUser(request);
    if (!sessionUser) return jsonResponse({ error: "Sessão expirada." }, 401);

    let body: unknown;
    try {
      body = await request.json() as unknown;
    } catch {
      return jsonResponse({ error: "Não foi possível ler os dados do perfil." }, 400);
    }

    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return jsonResponse({ error: "Não foi possível ler os dados do perfil." }, 400);
    }

    const source = body as Record<string, unknown>;
    const displayName = typeof source.displayName === "string" ? source.displayName.trim() : "";
    const username = typeof source.username === "string" ? source.username.trim() : "";
    const usernameNormalized = normalizeUsername(username);
    const branch = typeof source.branch === "string" ? source.branch.trim() : "";
    const currentPassword = typeof source.currentPassword === "string" ? source.currentPassword : "";
    const newPassword = typeof source.newPassword === "string" ? source.newPassword : "";

    if (displayName.length < 2 || displayName.length > 80) {
      return jsonResponse({ error: "Informe seu nome completo." }, 400);
    }
    if (!/^[a-zA-Z0-9._-]{3,40}$/.test(username) || usernameNormalized === "admin") {
      return jsonResponse({ error: "O usuário deve ter de 3 a 40 caracteres, sem espaços." }, 400);
    }
    if (!allowedBranches.has(branch)) {
      return jsonResponse({ error: "Selecione Araraquara ou São Carlos." }, 400);
    }
    if (newPassword && (newPassword.length < 8 || newPassword.length > 120)) {
      return jsonResponse({ error: "A nova senha deve ter de 8 a 120 caracteres." }, 400);
    }
    const db = getDb();
    const [storedUser] = await db
      .select({ id: employeeUsers.id, usernameNormalized: employeeUsers.usernameNormalized, passwordHash: employeeUsers.passwordHash })
      .from(employeeUsers)
      .where(eq(employeeUsers.id, sessionUser.id))
      .limit(1);
    if (!storedUser) return jsonResponse({ error: "Sessão expirada." }, 401);

    const usernameChanged = usernameNormalized !== storedUser.usernameNormalized;
    if ((newPassword || usernameChanged) && !currentPassword) {
      return jsonResponse({ error: "Informe a senha atual para alterar o usuário ou a senha." }, 400);
    }
    if ((newPassword || usernameChanged) && !(await verifyPassword(currentPassword, storedUser.passwordHash))) {
      return jsonResponse({ error: "A senha atual está incorreta." }, 401);
    }

    const [sameUsername] = await db
      .select({ id: employeeUsers.id })
      .from(employeeUsers)
      .where(eq(employeeUsers.usernameNormalized, usernameNormalized))
      .limit(1);
    if (sameUsername && sameUsername.id !== sessionUser.id) {
      return jsonResponse({ error: "Esse usuário já está cadastrado." }, 409);
    }

    const updateValues: { displayName: string; username: string; usernameNormalized: string; branch: string; passwordHash?: string } = {
      displayName,
      username,
      usernameNormalized,
      branch,
    };
    if (newPassword) updateValues.passwordHash = (await hashPassword(newPassword)).encoded;

    await db.update(employeeUsers).set(updateValues).where(eq(employeeUsers.id, sessionUser.id)).run();

    let sessionCookie: string | null = null;
    if (newPassword) {
      await db.delete(employeeSessions).where(eq(employeeSessions.userId, sessionUser.id)).run();
      sessionCookie = (await createSession(request, sessionUser.id)).cookie;
    }

    const [updatedUser] = await db
      .select({
        id: employeeUsers.id,
        username: employeeUsers.username,
        displayName: employeeUsers.displayName,
        branch: employeeUsers.branch,
      })
      .from(employeeUsers)
      .where(eq(employeeUsers.id, sessionUser.id))
      .limit(1);

    const headers = new Headers();
    if (sessionCookie) headers.append("Set-Cookie", sessionCookie);
    return jsonResponse({ user: updatedUser ? userPayload(updatedUser) : null }, 200, headers);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/unique|constraint/i.test(message)) return jsonResponse({ error: "Esse usuário já está cadastrado." }, 409);
    console.error("employee_profile_update_failed", { message });
    return jsonResponse({ error: "Não foi possível atualizar seu perfil." }, 503);
  }
}
