import { eq } from "drizzle-orm";
import { getDb } from "../../../../../db";
import { employeeData, employeeSessions, employeeUsers } from "../../../../../db/schema";
import { adminNotFound, getAdminSession } from "../../_lib";
import { hashPassword, userPayload } from "../../../auth/_lib";
import { parseEmployeeProfile } from "../_validation";
import { rejectUntrustedMutation } from "../../../_security";
import { normalizeEmployeeState, summarizeEmployeeState } from "../../../data/state-contract.mjs";

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

async function readUserId(context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (!/^\d+$/.test(id)) return null;
  const userId = Number.parseInt(id, 10);
  return Number.isInteger(userId) && userId > 0 ? userId : null;
}

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    if (!(await getAdminSession(request))) return adminNotFound();

    const userId = await readUserId(context);
    if (!userId) return adminNotFound();

    const db = getDb();
    const [row] = await db
      .select({
        id: employeeUsers.id,
        username: employeeUsers.username,
        displayName: employeeUsers.displayName,
        branch: employeeUsers.branch,
        createdAt: employeeUsers.createdAt,
        stateJson: employeeData.stateJson,
        dataUpdatedAt: employeeData.updatedAt,
      })
      .from(employeeUsers)
      .leftJoin(employeeData, eq(employeeData.userId, employeeUsers.id))
      .where(eq(employeeUsers.id, userId))
      .limit(1);

    if (!row) return adminNotFound();

    let state: unknown = null;
    if (row.stateJson) {
      try {
        const parsed = JSON.parse(row.stateJson) as unknown;
        state = normalizeEmployeeState(parsed);
      } catch {
        state = null;
      }
    }

    return jsonResponse({
      user: {
        id: row.id,
        username: row.username,
        displayName: row.displayName,
        branch: row.branch,
        createdAt: row.createdAt,
        dataUpdatedAt: row.dataUpdatedAt,
      },
      state,
      summary: summarizeEmployeeState(state),
    });
  } catch (error) {
    console.error("admin_user_data_failed", { message: error instanceof Error ? error.message : String(error) });
    return jsonResponse({ error: "Não foi possível abrir os dados da conta." }, 503);
  }
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const originError = rejectUntrustedMutation(request);
    if (originError) return originError;
    if (!(await getAdminSession(request))) return adminNotFound();

    const userId = await readUserId(context);
    if (!userId) return adminNotFound();

    let body: unknown;
    try {
      body = await request.json() as unknown;
    } catch {
      return jsonResponse({ error: "Não foi possível ler os dados do funcionário." }, 400);
    }

    const parsed = parseEmployeeProfile(body, { passwordRequired: false });
    if (!parsed.value) return jsonResponse({ error: parsed.error }, 400);

    const db = getDb();
    const [existing] = await db
      .select({ id: employeeUsers.id })
      .from(employeeUsers)
      .where(eq(employeeUsers.id, userId))
      .limit(1);
    if (!existing) return adminNotFound();

    const [sameUsername] = await db
      .select({ id: employeeUsers.id })
      .from(employeeUsers)
      .where(eq(employeeUsers.usernameNormalized, parsed.value.usernameNormalized))
      .limit(1);
    if (sameUsername && sameUsername.id !== userId) return jsonResponse({ error: "Esse usuário já está cadastrado." }, 409);

    const values: {
      username: string;
      usernameNormalized: string;
      displayName: string;
      branch: string;
      passwordHash?: string;
    } = {
      username: parsed.value.username,
      usernameNormalized: parsed.value.usernameNormalized,
      displayName: parsed.value.displayName,
      branch: parsed.value.branch,
    };
    if (parsed.value.password) {
      const passwordData = await hashPassword(parsed.value.password);
      values.passwordHash = passwordData.encoded;
    }

    if (values.passwordHash) {
      await db.batch([
        db.update(employeeUsers).set(values).where(eq(employeeUsers.id, userId)),
        db.delete(employeeSessions).where(eq(employeeSessions.userId, userId)),
      ]);
    } else {
      await db.update(employeeUsers).set(values).where(eq(employeeUsers.id, userId)).run();
    }

    const [user] = await db
      .select({ id: employeeUsers.id, username: employeeUsers.username, displayName: employeeUsers.displayName, branch: employeeUsers.branch })
      .from(employeeUsers)
      .where(eq(employeeUsers.id, userId))
      .limit(1);
    return jsonResponse({ user: user ? userPayload(user) : null });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/unique|constraint/i.test(message)) return jsonResponse({ error: "Esse usuário já está cadastrado." }, 409);
    console.error("admin_user_update_failed", { message });
    return jsonResponse({ error: "Não foi possível atualizar o funcionário." }, 503);
  }
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const originError = rejectUntrustedMutation(request);
    if (originError) return originError;
    if (!(await getAdminSession(request))) return adminNotFound();

    const userId = await readUserId(context);
    if (!userId) return adminNotFound();

    const db = getDb();
    const [existing] = await db
      .select({ id: employeeUsers.id })
      .from(employeeUsers)
      .where(eq(employeeUsers.id, userId))
      .limit(1);
    if (!existing) return adminNotFound();

    await db.batch([
      db.delete(employeeSessions).where(eq(employeeSessions.userId, userId)),
      db.delete(employeeData).where(eq(employeeData.userId, userId)),
      db.delete(employeeUsers).where(eq(employeeUsers.id, userId)),
    ]);
    return jsonResponse({ ok: true, id: userId });
  } catch (error) {
    console.error("admin_user_delete_failed", { message: error instanceof Error ? error.message : String(error) });
    return jsonResponse({ error: "Não foi possível apagar o funcionário." }, 503);
  }
}
