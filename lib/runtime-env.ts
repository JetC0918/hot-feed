import { env } from "cloudflare:workers";

export type RuntimeEnv = {
  PROTOTYPE_AUTH_EMAIL?: string;
  PROTOTYPE_AUTH_PASSWORD?: string;
  SESSION_SECRET?: string;
  API_KEY?: string;
  DB?: D1Database;
};

export function getRuntimeEnv() {
  return env as unknown as RuntimeEnv;
}
