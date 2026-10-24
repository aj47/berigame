/**
 * A WebSocket factory for the SpacetimeDB SDK that counts what crosses the
 * wire. It mirrors the SDK's own openWebSocket + decompress adapter (same URL,
 * same token exchange, same one-byte compression tag), so the bytes counted
 * here are the bytes a browser client receives.
 */
import { brotliDecompressSync, gunzipSync } from 'node:zlib';

export interface SocketCounters {
  /** Bytes as received on the socket (compressed). */
  wireIn: number;
  /** Bytes after decompression (what the SDK decodes). */
  rawIn: number;
  msgsIn: number;
  wireOut: number;
  msgsOut: number;
}

export const newCounters = (): SocketCounters => ({ wireIn: 0, rawIn: 0, msgsIn: 0, wireOut: 0, msgsOut: 0 });

interface WSArgs {
  url: URL;
  wsProtocol: string[];
  nameOrAddress: string;
  authToken?: string;
  compression: 'gzip' | 'brotli' | 'none';
  lightMode: boolean;
  confirmedReads?: boolean;
}

/**
 * `sink`: deliver only the connection's first message (the SDK's handshake)
 * and count every later one without decompressing or decoding it. For the
 * load test's view connections (worker.ts --view sink): the server does all of
 * a client's work for them (evaluation, fan-out, compression), but the load
 * generator does not decode what a browser would render.
 */
export function countingWSFn(counters: SocketCounters, sink = false) {
  return async (args: WSArgs): Promise<any> => {
    let temporary: string | undefined;
    if (args.authToken) {
      const tokenUrl = new URL('v1/identity/websocket-token', args.url);
      tokenUrl.protocol = args.url.protocol === 'wss:' ? 'https:' : 'http:';
      const res = await fetch(tokenUrl, { method: 'POST', headers: { Authorization: `Bearer ${args.authToken}` } });
      if (!res.ok) throw new Error(`Failed to verify token: ${res.statusText}`);
      temporary = ((await res.json()) as { token: string }).token;
    }
    const dbUrl = new URL(`v1/database/${args.nameOrAddress}/subscribe`, args.url);
    if (temporary) dbUrl.searchParams.set('token', temporary);
    dbUrl.searchParams.set('compression', { gzip: 'Gzip', brotli: 'Brotli', none: 'None' }[args.compression] ?? 'None');
    if (args.lightMode) dbUrl.searchParams.set('light', 'true');
    if (args.confirmedReads !== undefined) dbUrl.searchParams.set('confirmed', String(args.confirmedReads));
    const ws = new WebSocket(dbUrl.toString(), args.wsProtocol);
    ws.binaryType = 'arraybuffer';
    return {
      get protocol() { return ws.protocol; },
      get readyState() { return ws.readyState; },
      set onclose(h: any) { ws.onclose = h; },
      set onopen(h: any) { ws.onopen = h; },
      set onerror(h: any) { ws.onerror = h; },
      set onmessage(h: (m: { data: Uint8Array }) => void) {
        let delivered = 0;
        ws.onmessage = (ev: MessageEvent) => {
          const buf = new Uint8Array(ev.data as ArrayBuffer);
          counters.wireIn += buf.byteLength;
          counters.msgsIn += 1;
          if (sink && delivered > 0) { counters.rawIn += buf[0] === 0 ? buf.byteLength - 1 : 0; return; }
          delivered++;
          let data: Uint8Array;
          try {
            const body = buf.subarray(1);
            switch (buf[0]) {
              case 0: data = body; break;
              case 1: data = brotliDecompressSync(body); break;
              case 2: data = gunzipSync(body); break;
              default: throw new Error(`unknown compression tag ${buf[0]}`);
            }
          } catch (e) {
            console.error('[loadtest] decompress failed', e);
            ws.close();
            return;
          }
          counters.rawIn += data.byteLength;
          h({ data });
        };
      },
      send(msg: Uint8Array) { counters.wireOut += msg.byteLength; counters.msgsOut += 1; ws.send(msg); },
      close() { ws.close(); },
    };
  };
}
