/** Bounded, memory-only gameplay history. Never collect chat, names, identities or reducer arguments. */
export type DiagnosticEvent = { at: number; kind: string; data: Record<string, string | number | boolean> };
const recent: DiagnosticEvent[] = [];
const LIMIT = 120;
export function recordDiagnostic(kind: string, data: DiagnosticEvent['data']) {
  recent.push({ at: Date.now(), kind, data });
  if (recent.length > LIMIT) recent.splice(0, recent.length - LIMIT);
}
export function diagnosticHistory() { return recent.map(event => ({ ...event, data: { ...event.data } })); }
export function clearDiagnostics() { recent.length = 0; }

/** Asset basename identifies the deployed build without exposing URL tokens. */
export function diagnosticAsset(url: string): string {
  try { return new URL(url, 'https://berigame.com').pathname.split('/').pop()?.replace(/[^a-zA-Z0-9_.-]/g, '').slice(0, 100) ?? ''; }
  catch { return ''; }
}
