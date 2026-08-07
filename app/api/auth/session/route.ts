import { getRuntimeEnv } from "@/lib/runtime-env";
import { readCookie, SESSION_COOKIE, verifySessionToken } from "@/lib/session";

export async function GET(request: Request) {
  const runtime = getRuntimeEnv();
  const authenticated = await verifySessionToken(readCookie(request, SESSION_COOKIE), runtime.SESSION_SECRET);
  return Response.json({ authenticated }, { headers: { "Cache-Control": "no-store" } });
}
