import { expiredSessionCookie } from "@/lib/session";

export async function POST(request: Request) {
  const secure = new URL(request.url).protocol === "https:";
  return Response.json({ authenticated: false }, { headers: { "Set-Cookie": expiredSessionCookie(secure), "Cache-Control": "no-store" } });
}
