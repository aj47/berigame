import { describe, expect, it, vi } from 'vitest';
import { holdFrames } from '../watch/delayedSocket';

function fakeSocket() {
  return { onmessage: null, onclose: null, onopen: null, onerror: null, send: vi.fn(), close: vi.fn(), protocol: 'p', readyState: 1 } as any;
}
const frame = (...bytes: number[]) => ({ data: new Uint8Array(bytes).buffer });

describe('holdFrames', () => {
  it('delivers server frames late and in order, without the compression tag', () => {
    vi.useFakeTimers();
    const socket = fakeSocket(), seen: number[][] = [];
    const adapter = holdFrames(socket, 30_000);
    adapter.onmessage = ({ data }) => seen.push([...data]);
    socket.onmessage(frame(0, 1));
    vi.advanceTimersByTime(10_000);
    socket.onmessage(frame(0, 2));
    vi.advanceTimersByTime(19_999);
    expect(seen).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(seen).toEqual([[1]]);
    vi.advanceTimersByTime(10_000);
    expect(seen).toEqual([[1], [2]]);
    vi.useRealTimers();
  });

  it('sends without delay', () => {
    const socket = fakeSocket();
    const bytes = new Uint8Array([9]);
    holdFrames(socket, 30_000).send(bytes);
    expect(socket.send).toHaveBeenCalledWith(bytes);
  });

  it('reports a dropped link after the frames before it', () => {
    vi.useFakeTimers();
    const socket = fakeSocket(), order: string[] = [];
    const adapter = holdFrames(socket, 1000);
    adapter.onmessage = () => order.push('frame');
    adapter.onclose = () => order.push('close');
    socket.onmessage(frame(0, 1));
    socket.onclose({});
    vi.advanceTimersByTime(1000);
    expect(order).toEqual(['frame', 'close']);
    vi.useRealTimers();
  });

  it('drops held frames after a local close', () => {
    vi.useFakeTimers();
    const socket = fakeSocket(), seen: unknown[] = [];
    const adapter = holdFrames(socket, 1000);
    adapter.onmessage = (m) => seen.push(m);
    socket.onmessage(frame(0, 1));
    adapter.close();
    vi.advanceTimersByTime(2000);
    expect(seen).toEqual([]);
    vi.useRealTimers();
  });
});
