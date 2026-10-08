const DAY_MS = 86_400_000;

export const dayLabel = (day: number) => new Date(day * DAY_MS).toISOString().slice(5, 10);
export const dayDate = (day: number) => new Date(day * DAY_MS).toISOString().slice(0, 10);

export function dateTime(ms: number | null | undefined) {
  if (!ms) return '—';
  return new Date(ms).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function ago(ms: number | null | undefined, now = Date.now()) {
  if (!ms) return '—';
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export function duration(seconds: number) {
  if (!seconds) return '0m';
  const h = Math.floor(seconds / 3600), m = Math.floor((seconds % 3600) / 60);
  return h ? `${h}h ${m}m` : `${m}m`;
}

export const pct = (part: number, whole: number) => (whole ? `${Math.round((part / whole) * 100)}%` : '—');
export const num = (n: number) => n.toLocaleString();
export const shortId = (id: string) => `${id.slice(0, 6)}…${id.slice(-4)}`;
