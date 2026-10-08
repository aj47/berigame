import { ApiError } from '../agent-api/portable';

export const unauthorized = () => new ApiError(401, 'invalid_session', 'A valid, unexpired session bearer token is required.');
export const errorBody = (error: ApiError) => ({ error: { code: error.code, message: error.message } });
export function send(status: number, body?: unknown, retryAfter?: number) {
  return new Response(body === undefined ? null : JSON.stringify(body), { status, headers: {
    'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
    'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
    ...(body === undefined ? {} : { 'Content-Type': 'application/json; charset=utf-8' }),
    ...(retryAfter ? { 'Retry-After': String(retryAfter) } : {}),
  } });
}
/** A JSON body that is already serialized (admin snapshots from the module), sent without re-encoding. */
export function sendJsonText(status: number, text: string) {
  const response = send(status, null);
  return new Response(text, { status, headers: response.headers });
}
export function bearer(request: Request) {
  const value = request.headers.get('Authorization');
  if (!value || !/^Bearer bg[isharku]_[A-Za-z0-9_-]{43}$/.test(value)) throw unauthorized();
  return value.slice(7);
}
export async function readJson(request: Request, limit = 4096): Promise<unknown> {
  if (request.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase() !== 'application/json'
    || ![null, 'identity'].includes(request.headers.get('Content-Encoding'))) {
    throw new ApiError(415, 'json_required', 'Send uncompressed application/json.');
  }
  if (Number(request.headers.get('Content-Length')) > limit) throw new ApiError(413, 'body_too_large', `JSON bodies are limited to ${limit} bytes.`);
  const reader = request.body?.getReader();
  if (!reader) throw new ApiError(400, 'invalid_json', 'Send a JSON object.');
  let timer: ReturnType<typeof setTimeout> | undefined;
  let size = 0;
  try {
    const text = await Promise.race([
      (async () => {
        const chunks: Uint8Array[] = [];
        while (true) {
          const next = await reader.read();
          if (next.done) break;
          size += next.value.length;
          if (size > limit) throw new ApiError(413, 'body_too_large', `JSON bodies are limited to ${limit} bytes.`);
          chunks.push(next.value);
        }
        return Buffer.concat(chunks).toString('utf8');
      })(),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new ApiError(408, 'body_timeout', 'Request body timed out.')), 3000); }),
    ]);
    try { return JSON.parse(text); } catch { throw new ApiError(400, 'invalid_json', 'Send a JSON object.'); }
  } finally { clearTimeout(timer); void reader.cancel().catch(() => {}); }
}

