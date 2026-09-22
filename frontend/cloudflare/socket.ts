import type { ConnectionOptions } from '../agent-api/game';
type Adapter = Awaited<ReturnType<NonNullable<ConnectionOptions['webSocketFactory']>>>;

/** Cloudflare opens outbound WebSockets through fetch(), not new WebSocket(). */
export const openCloudflareSocket: NonNullable<ConnectionOptions['webSocketFactory']> = async (args) => {
  const url = new URL(`/v1/database/${encodeURIComponent(args.nameOrAddress)}/subscribe`, args.url);
  url.protocol = args.url.protocol === 'wss:' ? 'https:' : 'http:';
  url.search = args.url.search;
  url.searchParams.set('compression', 'None');
  if (args.lightMode) url.searchParams.set('light', 'true');
  if (args.confirmedReads !== undefined) url.searchParams.set('confirmed', String(args.confirmedReads));
  const response = await fetch(url, { headers: {
    Upgrade: 'websocket', 'Sec-WebSocket-Protocol': args.wsProtocol.join(', '),
    ...(args.authToken ? { Authorization: `Bearer ${args.authToken}` } : {}),
  }, redirect: 'manual' });
  const socket = response.webSocket;
  if (response.status !== 101 || !socket) throw new Error('Game connection unavailable');
  let opened: (() => void) | undefined;
  return {
    protocol: response.headers.get('Sec-WebSocket-Protocol') ?? '',
    get readyState() { return socket.readyState; },
    send(data) { socket.send(data); },
    close() { socket.close(1000, 'Session closed'); },
    set onclose(handler: Adapter['onclose']) { socket.addEventListener('close', handler); },
    set onerror(handler: Adapter['onerror']) { socket.addEventListener('error', handler as EventListener); },
    set onopen(handler: Adapter['onopen']) { opened = handler; },
    set onmessage(handler: Adapter['onmessage']) {
      socket.addEventListener('message', event => {
        if (!(event.data instanceof ArrayBuffer)) { socket.close(1003, 'Binary messages required'); return; }
        const bytes = new Uint8Array(event.data);
        // The SDK protocol prefixes every server frame with its compression tag.
        if (bytes[0] !== 0) { socket.close(1003, 'Unexpected compression'); return; }
        handler({ data: bytes.subarray(1) });
      });
      socket.accept();
      queueMicrotask(() => opened?.());
    },
  };
};
