export type RequestBoundaryOptions = {
  method: string;
  mediaType: "json" | "empty";
  maxBytes: number;
};

export class RequestBoundaryError extends Error {
  readonly status: 400 | 413;
  readonly code: string;

  constructor(status: 400 | 413, code: string, message = "Invalid request") {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function normalizedMediaType(request: Request) {
  return (request.headers.get("content-type") ?? "").split(";", 1)[0].trim().toLowerCase();
}

function assertSameOrigin(request: Request) {
  const site = request.headers.get("sec-fetch-site")?.trim().toLowerCase();
  if (site === "cross-site") throw new RequestBoundaryError(400, "cross_origin");

  const origin = request.headers.get("origin");
  if (origin) {
    let expected: string;
    try { expected = new URL(request.url).origin; } catch { throw new RequestBoundaryError(400, "invalid_origin"); }
    let actual: string;
    try { actual = new URL(origin).origin; } catch { throw new RequestBoundaryError(400, "invalid_origin"); }
    if (actual !== expected) throw new RequestBoundaryError(400, "cross_origin");
  }
}

/** Enforce the shared browser request boundary before parsing or doing work. */
export function assertRequestBoundary(request: Request, options: RequestBoundaryOptions) {
  if (request.method.toUpperCase() !== options.method.toUpperCase()) {
    throw new RequestBoundaryError(400, "method_not_allowed");
  }
  assertSameOrigin(request);
  const mediaType = normalizedMediaType(request);
  if (options.mediaType === "json" && mediaType !== "application/json") {
    throw new RequestBoundaryError(400, "unsupported_media_type");
  }
  if (options.mediaType === "empty" && mediaType) {
    throw new RequestBoundaryError(400, "unsupported_media_type");
  }
  const declaredLength = request.headers.get("content-length");
  if (declaredLength !== null) {
    const length = Number(declaredLength);
    if (!Number.isFinite(length) || length < 0) throw new RequestBoundaryError(400, "invalid_content_length");
    if (length > options.maxBytes) throw new RequestBoundaryError(413, "request_too_large", "Request body is too large");
  }
}

/** Read an empty request body without allowing a body hidden behind chunked encoding. */
export async function assertEmptyBody(request: Request) {
  if (!request.body) return;
  const reader = request.body.getReader();
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      if (chunk.value.byteLength > 0) throw new RequestBoundaryError(400, "body_not_allowed");
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}

export async function readBoundedJson(request: Request, maxBytes: number): Promise<unknown> {
  const declaredLength = request.headers.get("content-length");
  if (declaredLength !== null) {
    const length = Number(declaredLength);
    if (!Number.isFinite(length) || length < 0) throw new RequestBoundaryError(400, "invalid_content_length");
    if (length > maxBytes) throw new RequestBoundaryError(413, "request_too_large", "Request body is too large");
  }
  const reader = request.body?.getReader();
  if (!reader) return JSON.parse(new TextDecoder().decode(new Uint8Array(await request.arrayBuffer())));
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) throw new RequestBoundaryError(413, "request_too_large", "Request body is too large");
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  const merged = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { merged.set(chunk, offset); offset += chunk.byteLength; }
  return JSON.parse(new TextDecoder().decode(merged));
}
