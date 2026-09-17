import { getDb } from "../../../../db";
import { employeeUsers } from "../../../../db/schema";

function storageReason(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  if (/binding.*unavailable|env\.DB|d1 binding/i.test(message)) return "binding";
  if (/no such table|does not exist/i.test(message)) return "schema";
  return "database";
}

export async function GET() {
  try {
    const db = getDb();
    await db.select({ id: employeeUsers.id }).from(employeeUsers).limit(1);
    return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const reason = storageReason(error);
    console.error("storage_health_failed", { reason, message: error instanceof Error ? error.message : String(error) });
    return Response.json({ ok: false, reason }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
