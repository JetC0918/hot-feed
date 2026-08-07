import { constantTimeEqual, createSessionToken, sessionCookie } from "@/lib/session";
import { getRuntimeEnv } from "@/lib/runtime-env";

export async function POST(request: Request) {
  let payload: unknown;
  try { payload = await request.json(); } catch { return Response.json({ error: "Invalid request" }, { status: 400 }); }
  const body = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body.password === "string" ? body.password : "";
  const runtime = getRuntimeEnv();
  const configuredEmail = runtime.PROTOTYPE_AUTH_EMAIL?.trim().toLowerCase() ?? "";
  const configuredPassword = runtime.PROTOTYPE_AUTH_PASSWORD ?? "";
  const secret = runtime.SESSION_SECRET ?? "";
  if (!configuredEmail || !configuredPassword || secret.length < 32) {
    return Response.json({ error: "Prototype login is not configured" }, { status: 503 });
  }
  const emailValid = constantTimeEqual(email, configuredEmail);
  const passwordValid = constantTimeEqual(password, configuredPassword);
  const valid = emailValid && passwordValid;
  if (!valid) return Response.json({ error: "Invalid email or password" }, { status: 401 });
  const token = await createSessionToken(secret);
  const secure = new URL(request.url).protocol === "https:";
  return Response.json({ authenticated: true }, { headers: { "Set-Cookie": sessionCookie(token, secure), "Cache-Control": "no-store" } });
}
