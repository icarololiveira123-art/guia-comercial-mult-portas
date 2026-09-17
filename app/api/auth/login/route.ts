import { eq } from "drizzle-orm";
import { getDb } from "../../../../db";
import { employeeUsers } from "../../../../db/schema";
import { ADMIN_PASSWORD, ADMIN_USERNAME, clearedAdminCookie, createAdminSession } from "../../admin/_lib";
import { rejectUntrustedMutation } from "../../_security";
import {
  clearAuthQuota,
  consumeLoginQuota,
  loginRateKeys,
  rateLimitResponse,
  readBoundedAuthJson,
} from "../_request-guard";
import {
  constantTimeEqual,
  clearedSessionCookie,
  createSession,
  digest,
  hashPassword,
  normalizeUsername,
  passwordNeedsRehash,
  passwordRequiresReset,
  userPayload,
  verifyPassword,
} from "../_lib";

export async function POST(request: Request) {
  try {
    return await handleLogin(request);
  } catch (error) {
    console.error("auth_login_failed", { message: error instanceof Error ? error.message : String(error) });
    return Response.json({ error: "Não foi possível concluir o login. Tente novamente em alguns segundos." }, { status: 503 });
  }
}

async function handleLogin(request: Request) {
  const originError = rejectUntrustedMutation(request);
  if (originError) return originError;

  const parsedBody = await readBoundedAuthJson(request, "Não foi possível ler o login.");
  if ("response" in parsedBody) return parsedBody.response;
  if (typeof parsedBody.value.username !== "string" || typeof parsedBody.value.password !== "string") {
    return Response.json({ error: "Informe usuário e senha válidos." }, { status: 400 });
  }

  const username = parsedBody.value.username.trim();
  const password = parsedBody.value.password;
  if (!username || !password) return Response.json({ error: "Informe usuário e senha." }, { status: 400 });
  const rateKeys = loginRateKeys(request, username);
  const retryAfter = consumeLoginQuota(rateKeys);
  if (retryAfter !== null) return rateLimitResponse(retryAfter);

  const adminPasswordMatches = Boolean(ADMIN_PASSWORD) && constantTimeEqual(await digest(password), await digest(ADMIN_PASSWORD));
  if (username.toLocaleLowerCase("pt-BR") === ADMIN_USERNAME && adminPasswordMatches) {
    const session = await createAdminSession(request);
    const headers = new Headers({ "Cache-Control": "no-store" });
    headers.append("Set-Cookie", session.cookie);
    headers.append("Set-Cookie", clearedSessionCookie(request));
    clearAuthQuota(rateKeys);
    return Response.json({ admin: true }, { headers });
  }

  const db = await getDb();
  const [user] = await db.select().from(employeeUsers).where(eq(employeeUsers.usernameNormalized, normalizeUsername(username))).limit(1);
  if (!user) {
    // Keep unknown-user and wrong-password requests in the same cost range so
    // login timing does not disclose which employee names exist.
    await hashPassword(password, "mult-portas-login-timing-salt");
    return Response.json({ error: "Usuário ou senha incorretos." }, { status: 401 });
  }
  if (passwordRequiresReset(user.passwordHash)) {
    console.warn("auth_password_reset_required", { userId: user.id });
    return Response.json({ error: "Esta conta precisa que o administrador redefina a senha." }, { status: 409 });
  }
  if (!(await verifyPassword(password, user.passwordHash))) {
    return Response.json({ error: "Usuário ou senha incorretos." }, { status: 401 });
  }

  const session = await createSession(request, user.id);
  if (passwordNeedsRehash(user.passwordHash)) {
    try {
      const upgraded = await hashPassword(password);
      await db.update(employeeUsers).set({ passwordHash: upgraded.encoded }).where(eq(employeeUsers.id, user.id)).run();
    } catch (error) {
      // A manutenção do formato do hash não pode impedir uma senha válida de
      // abrir a conta. A próxima autenticação tentará a atualização novamente.
      console.warn("auth_password_rehash_failed", {
        userId: user.id,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const headers = new Headers({ "Cache-Control": "no-store" });
  headers.append("Set-Cookie", session.cookie);
  headers.append("Set-Cookie", clearedAdminCookie(request));
  clearAuthQuota(rateKeys);
  return Response.json({ user: userPayload(user) }, { headers });
}
