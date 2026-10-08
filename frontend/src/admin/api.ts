export class AuthError extends Error {}

/** POST to an ADMIN_TOKEN route on the same origin (the beta Worker). */
export async function adminFetch<T>(path: string, token: string, body: object): Promise<T> {
  const response = await fetch(path, {
    method: 'POST', cache: 'no-store',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (response.status === 401) throw new AuthError('That admin token was not accepted.');
  const json = await response.json().catch(() => null);
  if (!response.ok) throw new Error(json?.error?.message ?? `Request failed (${response.status})`);
  return json as T;
}
