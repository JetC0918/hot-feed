export const SESSION_COOKIE = "hotfeed_session";
const SESSION_TTL_SECONDS = 60 * 60 * 12;
export const SESSION_SECRET_MIN_LENGTH = 32;

export class SessionConfigurationError extends Error {
  constructor() { super("Session authentication is not configured"); }
}

export function requireSessionSecret(secret: string | undefined) {
  if (!secret || secret.length < SESSION_SECRET_MIN_LENGTH) throw new SessionConfigurationError();
  return secret;
}

const encoder = new TextEncoder();

function base64Url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function signature(payload: string, secret: string) {
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return base64Url(new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(payload))));
}

export function constantTimeEqual(left: string, right: string) {
  const a = encoder.encode(left);
  const b = encoder.encode(right);
  let mismatch = a.length ^ b.length;
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index += 1) mismatch |= (a[index] ?? 0) ^ (b[index] ?? 0);
  return mismatch === 0;
}

export async function createSessionToken(secret: string, now = Date.now()) {
  requireSessionSecret(secret);
  const payload = `prototype.${Math.floor(now / 1000) + SESSION_TTL_SECONDS}`;
  return `${payload}.${await signature(payload, secret)}`;
}

export async function verifySessionToken(token: string | undefined, secret: string | undefined, now = Date.now()) {
  if (!token) return false;
  const validSecret = requireSessionSecret(secret);
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== "prototype") return false;
  const payload = `${parts[0]}.${parts[1]}`;
  const expiry = Number(parts[1]);
  if (!Number.isSafeInteger(expiry) || expiry <= Math.floor(now / 1000)) return false;
  return constantTimeEqual(parts[2], await signature(payload, validSecret));
}

export function readCookie(request: Request, name: string) {
  const cookies = request.headers.get("cookie") ?? "";
  for (const part of cookies.split(";")) {
    const [key, ...value] = part.trim().split("=");
    if (key === name) return value.join("=");
  }
}

export function sessionCookie(token: string, secure = true) {
  return `${SESSION_COOKIE}=${token}; Path=/; Max-Age=${SESSION_TTL_SECONDS}; HttpOnly; SameSite=Lax${secure ? "; Secure" : ""}`;
}

export function expiredSessionCookie(secure = true) {
  return `${SESSION_COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax${secure ? "; Secure" : ""}`;
}
