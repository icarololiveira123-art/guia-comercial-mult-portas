import { clearedSessionCookie, deleteSession } from "../_lib";
import { clearedAdminCookie, deleteAdminSession } from "../../admin/_lib";
import { rejectUntrustedMutation } from "../../_security";

export async function POST(request: Request) {
  const originError = rejectUntrustedMutation(request);
  if (originError) return originError;
  try {
    await deleteSession(request);
    await deleteAdminSession(request);
  } catch {
    // The browser session is still cleared even when the database is unavailable.
  }
  const headers = new Headers({ "Cache-Control": "no-store" });
  headers.append("Set-Cookie", clearedSessionCookie(request));
  headers.append("Set-Cookie", clearedAdminCookie(request));
  return Response.json({ ok: true }, { headers });
}
