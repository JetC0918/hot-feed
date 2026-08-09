import { expiredSessionCookie } from "@/lib/session";
import { requireSessionSecret } from "@/lib/session";
import { getRuntimeEnv } from "@/lib/runtime-env";
import { assertEmptyBody, assertRequestBoundary, RequestBoundaryError } from "@/lib/request-boundary";

export async function POST(request: Request) {
  try {
    assertRequestBoundary(request, { method: "POST", mediaType: "empty", maxBytes: 0 });
    await assertEmptyBody(request);
    requireSessionSecret(getRuntimeEnv().SESSION_SECRET);
  } catch (cause) {
    if (cause instanceof RequestBoundaryError) return Response.json({ error: cause.message, code: cause.code }, { status: cause.status });
    return Response.json({ error: "Session authentication is not configured", code: "not_configured" }, { status: 503 });
  }
  const secure = new URL(request.url).protocol === "https:";
  return Response.json({ authenticated: false }, { headers: { "Set-Cookie": expiredSessionCookie(secure), "Cache-Control": "no-store" } });
}
