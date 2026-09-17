import { and, eq } from "drizzle-orm";
import { getDb } from "../../../db";
import { employeeData } from "../../../db/schema";
import { getSessionUser } from "../auth/_lib";
import { rejectUntrustedMutation } from "../_security";
import { normalizeEmployeeState } from "./state-contract.mjs";

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

function emptyResponse() {
  return jsonResponse({ state: null, revision: null });
}

const MAX_REQUEST_BODY_LENGTH = 450_000;

export async function GET(request: Request) {
  try {
    return await readData(request);
  } catch {
    return jsonResponse({ error: "Não foi possível carregar os dados deste funcionário." }, 503);
  }
}

async function readData(request: Request) {
  const user = await getSessionUser(request);
  if (!user) return jsonResponse({ error: "Sessão expirada." }, 401);

  const db = await getDb();
  const [record] = await db.select({ stateJson: employeeData.stateJson, updatedAt: employeeData.updatedAt }).from(employeeData).where(eq(employeeData.userId, user.id)).limit(1);
  if (!record) return emptyResponse();

  try {
    const state = JSON.parse(record.stateJson) as unknown;
    return Response.json({ state: normalizeEmployeeState(state), revision: record.updatedAt }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return jsonResponse({ error: "Os dados salvos estão temporariamente indisponíveis. Nenhuma alteração foi feita.", revision: record.updatedAt }, 503);
  }
}

export async function PUT(request: Request) {
  try {
    return await writeData(request);
  } catch {
    return jsonResponse({ error: "Não foi possível salvar os dados deste funcionário." }, 503);
  }
}

async function writeData(request: Request) {
  const originError = rejectUntrustedMutation(request);
  if (originError) return originError;

  const user = await getSessionUser(request);
  if (!user) return jsonResponse({ error: "Sessão expirada." }, 401);

  let body: { state?: unknown; baseRevision?: unknown };
  try {
    const contentLength = Number(request.headers.get("content-length") ?? 0);
    if (Number.isFinite(contentLength) && contentLength > MAX_REQUEST_BODY_LENGTH) {
      return jsonResponse({ error: "Os dados enviados ultrapassaram o limite." }, 413);
    }
    const raw = await request.text();
    if (raw.length > MAX_REQUEST_BODY_LENGTH) {
      return jsonResponse({ error: "Os dados enviados ultrapassaram o limite." }, 413);
    }
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return jsonResponse({ error: "Dados inválidos." }, 400);
    }
    body = parsed as typeof body;
  } catch {
    return jsonResponse({ error: "Dados inválidos." }, 400);
  }

  if (!body.state || typeof body.state !== "object" || Array.isArray(body.state)) {
    return jsonResponse({ error: "Os dados do funcionário precisam estar em um objeto." }, 400);
  }
  if (body.baseRevision !== undefined && body.baseRevision !== null && typeof body.baseRevision !== "string") {
    return jsonResponse({ error: "A versão dos dados é inválida." }, 400);
  }

  const stateJson = JSON.stringify(normalizeEmployeeState(body.state));
  if (stateJson.length > 400_000) return jsonResponse({ error: "Os dados salvos ultrapassaram o limite." }, 413);

  const db = await getDb();
  // Keep the ISO prefix sortable/readable for the admin panel while the UUID
  // guarantees a distinct optimistic-lock revision even within one millisecond.
  const revision = `${new Date().toISOString()}|${crypto.randomUUID()}`;
  if (Object.hasOwn(body, "baseRevision")) {
    const baseRevision = body.baseRevision ?? null;
    const writeResult = baseRevision === null
      ? await db.insert(employeeData).values({ userId: user.id, stateJson, updatedAt: revision }).onConflictDoNothing().run()
      : await db.update(employeeData)
        .set({ stateJson, updatedAt: revision })
        .where(and(eq(employeeData.userId, user.id), eq(employeeData.updatedAt, baseRevision)))
        .run();
    if ((writeResult.meta?.changes ?? 0) !== 1) {
      const [current] = await db.select({ stateJson: employeeData.stateJson, updatedAt: employeeData.updatedAt }).from(employeeData).where(eq(employeeData.userId, user.id)).limit(1);
      // A pagehide keepalive may have committed the exact same state while the
      // browser closed. Treat that retry as idempotent instead of a conflict.
      if (current?.stateJson === stateJson) return jsonResponse({ ok: true, revision: current.updatedAt });
      return jsonResponse({ error: "Estes dados foram alterados em outra aba. Recarregue antes de salvar.", revision: current?.updatedAt ?? null }, 409);
    }
  } else {
    // Compatibility path for a tab that was already open during this release.
    await db.insert(employeeData).values({ userId: user.id, stateJson, updatedAt: revision }).onConflictDoUpdate({
      target: employeeData.userId,
      set: { stateJson, updatedAt: revision },
    }).run();
  }

  return jsonResponse({ ok: true, revision });
}
