/** Local delivery health only; the authoritative world never pauses for this UI. */
export const WORLD_STALL_MS = 6000;
export const WORLD_RESUME_GRACE_MS = 2000;
export class WorldLiveness {
  private connected = false;
  private online = true;
  private visible = true;
  private connectedAt = 0;
  private resumeUntil = 0;
  private lastTick: number | null = null;
  private advancedAt: number | null = null;
  stalled = false;

  setConnected(connected: boolean, now: number) {
    if (this.connected === connected) return;
    this.connected = connected;
    this.lastTick = null;
    this.advancedAt = null;
    this.connectedAt = now;
    // A reopened transport alone does not prove the world is fresh.
  }
  setOnline(online: boolean) {
    this.online = online;
    if (!online) this.stalled = true;
  }
  setVisible(visible: boolean, now: number) {
    this.visible = visible;
    if (visible) this.resumeUntil = now + WORLD_RESUME_GRACE_MS;
  }
  observeTick(tick: number, now: number) {
    if (this.lastTick !== null && tick <= this.lastTick) return;
    this.lastTick = tick;
    this.advancedAt = now;
    if (this.online && this.connected) this.stalled = false;
  }
  check(now: number): boolean {
    if (this.connected && this.visible && now >= this.resumeUntil &&
        now - (this.advancedAt ?? this.connectedAt) >= WORLD_STALL_MS) this.stalled = true;
    return this.stalled;
  }
}
