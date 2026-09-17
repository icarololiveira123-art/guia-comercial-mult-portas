import { getSessionUser, userPayload } from "../_lib";
import { getAdminSession } from "../../admin/_lib";

export async function GET(request: Request) {
  try {
    const headers = new Headers({ "Cache-Control": "no-store" });
    if (await getAdminSession(request)) {
      return Response.json({ user: null, admin: true }, { headers });
    }
    const user = await getSessionUser(request);
    return Response.json({ user: user ? userPayload(user) : null, admin: false }, { headers });
  } catch {
    return Response.json({ user: null, admin: false }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
