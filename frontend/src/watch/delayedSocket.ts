import type { DbConnection } from '../module_bindings';

type Factory = Parameters<ReturnType<typeof DbConnection.builder>['withWSFn']>[0];
type Adapter = Awaited<ReturnType<Factory>>;
type Args = Parameters<Factory>[0];

/**
 * The broadcast delay. Server frames are held back at the socket, so ticks, rows and events all arrive late by the
 * same amount and nothing above it needs to know: the picture is simply the world as it was. Used with
 * `withCompression('none')`, as frames carry a one-byte compression tag the SDK's own adapter would strip.
 */
export function holdFrames(socket: { onmessage: ((event: { data: ArrayBuffer }) => void) | null; onclose: ((event: any) => void) | null; onopen: (() => void) | null; onerror: ((event: any) => void) | null; send(data: unknown): void; close(): void; protocol: string; readyState: number },
  delayMs: number, later: (fn: () => void, ms: number) => unknown = setTimeout): Adapter {
  let closed = false;
  return {
    get protocol() { return socket.protocol; },
    get readyState() { return socket.readyState; },
    send(data) { socket.send(data); },
    close() { closed = true; socket.close(); },
    set onopen(handler: Adapter['onopen']) { socket.onopen = handler; },
    set onerror(handler: Adapter['onerror']) { socket.onerror = handler as (event: unknown) => void; },
    // A dropped link shows up after the frames that came before it.
    set onclose(handler: Adapter['onclose']) { socket.onclose = (event) => { later(() => handler(event), closed ? 0 : delayMs); }; },
    set onmessage(handler: Adapter['onmessage']) {
      socket.onmessage = (event) => {
        const bytes = new Uint8Array(event.data);
        later(() => { if (!closed && bytes[0] === 0) handler({ data: bytes.subarray(1) }); }, delayMs);
      };
    },
  };
}

/** Same handshake as the SDK's: a short-lived token in the URL, so the pass itself never appears in one. */
export function delayedSocket(delayMs: number): Factory {
  return async (args: Args) => {
    const http = new URL('v1/identity/websocket-token', args.url);
    http.protocol = args.url.protocol === 'wss:' ? 'https:' : 'http:';
    const response = await fetch(http, { method: 'POST', headers: { Authorization: `Bearer ${args.authToken}` } });
    if (!response.ok) throw new Error('Could not verify the watch pass');
    const { token } = await response.json();
    const url = new URL(`v1/database/${args.nameOrAddress}/subscribe`, args.url);
    url.searchParams.set('token', token);
    url.searchParams.set('compression', 'None');
    if (args.lightMode) url.searchParams.set('light', 'true');
    if (args.confirmedReads !== undefined) url.searchParams.set('confirmed', String(args.confirmedReads));
    const socket = new WebSocket(url, args.wsProtocol);
    socket.binaryType = 'arraybuffer';
    return holdFrames(socket as unknown as Parameters<typeof holdFrames>[0], delayMs);
  };
}
