import { getRuntimeEnv } from "@/lib/runtime-env";
import { readCookie, requireSessionSecret, SESSION_COOKIE, verifySessionToken } from "@/lib/session";
import { assertEmptyBody, assertRequestBoundary, RequestBoundaryError } from "@/lib/request-boundary";

export async function GET(request: Request) {
  try { assertRequestBoundary(request, { method: "GET", mediaType: "empty", maxBytes: 0 }); await assertEmptyBody(request); }
  catch (cause) { if (cause instanceof RequestBoundaryError) return Response.json({ error: cause.message, code: cause.code }, { status: cause.status }); return Response.json({ error: "Invalid request", code: "invalid_request" }, { status: 400 }); }
  const runtime = getRuntimeEnv();
  let authenticated = false;
  try {
    requireSessionSecret(runtime.SESSION_SECRET);
    authenticated = await verifySessionToken(readCookie(request, SESSION_COOKIE), runtime.SESSION_SECRET);
  } catch {
    return Response.json({ error: "Session authentication is not configured", code: "not_configured" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
  return Response.json({ authenticated }, { headers: { "Cache-Control": "no-store" } });
}
