import React, { memo, useEffect, useMemo, useRef, useState } from "react";
import { INVITE_PARAM, PlayerState, areaOf, chebyshev, inviteUrl, normalizeInviteCode } from "@sim";
import { useGameActions } from "../spacetime/actions";
import { useFriendRows, useInviteCodeRows, useMenteeCounts, useMyIdentityHex, useMyPlayer, usePlayersByHex } from "../spacetime/hooks";
import { identityHex } from "../spacetime/identity";
import { useChatPrefsStore } from "../spacetime/stores/chatPrefsStore";
import { useToastStore } from "../spacetime/stores/toastStore";
import { useLoadingStore } from "../store";
import "./friends.css";

const AREA_NAMES = { grove: "the Grove", hedge: "the brambles", coast: "the Coast" } as const;
const PENDING_KEY = "berigame.pendingInvite";

/**
 * Take ?join=CODE off the address bar at once (so it is not bookmarked or
 * re-shared by accident) and keep it for this tab until the world is live.
 */
function takeInviteFromUrl(): string | null {
  try {
    const url = new URL(window.location.href);
    const raw = url.searchParams.get(INVITE_PARAM);
    if (raw !== null) {
      url.searchParams.delete(INVITE_PARAM);
      window.history.replaceState(window.history.state, "", url.toString());
      const code = normalizeInviteCode(raw);
      if (code) sessionStorage.setItem(PENDING_KEY, code);
    }
    return sessionStorage.getItem(PENDING_KEY);
  } catch {
    return null;
  }
}
const pendingAtLoad = typeof window === "undefined" ? null : takeInviteFromUrl();

/** Redeems a ?join= invite once your character is in the world. Renders nothing. */
export const InviteRedeemer = () => {
  const ready = useLoadingStore((s: any) => s.gameDataLoaded && s.websocketConnected && !s.worldUpdatesStalled);
  const me = useMyPlayer();
  const hasMe = !!me;
  const { redeemInvite } = useGameActions();
  const done = useRef(false);
  useEffect(() => {
    if (!ready || !hasMe || done.current || !pendingAtLoad) return;
    done.current = true;
    try { sessionStorage.removeItem(PENDING_KEY); } catch { /* ignore */ }
    void redeemInvite(pendingAtLoad);
  }, [ready, hasMe, redeemInvite]);
  return null;
};

/** Mirrors your friends into the chat-prefs store, for menus built outside React renders. */
export const FriendSync = () => {
  const rows = useFriendRows();
  const setFriends = useChatPrefsStore((s) => s.setFriends);
  useEffect(() => { setFriends(new Set(rows.map((r) => identityHex(r.friend)))); }, [rows, setFriends]);
  return null;
};

function minutesLeft(expiresAtMicros: bigint): number {
  return Math.max(0, Math.ceil((Number(expiresAtMicros / 1000n) - Date.now()) / 60000));
}

const InviteCard = () => {
  const codes = useInviteCodeRows();
  const { createInvite } = useGameActions();
  const show = useToastStore((s) => s.show);
  const [, rerender] = useState(0);
  // Minutes left: refresh once a minute while shown (not per tick).
  useEffect(() => { const t = setInterval(() => rerender((n) => n + 1), 60000); return () => clearInterval(t); }, []);
  const row = codes[0];
  const live = row && minutesLeft(row.expiresAtMicros) > 0;
  const link = live ? inviteUrl(window.location.origin + window.location.pathname, row.code) : "";
  const share = async () => {
    const nav = navigator as any;
    if (nav.share) {
      try { await nav.share({ title: "Join me on BeriGame", text: "Come find me on the island!", url: link }); return; }
      catch (e: any) { if (e?.name === "AbortError") return; }
    }
    try { await navigator.clipboard.writeText(link); show("Invite link copied"); }
    catch { show("Copy the link from the box"); }
  };
  return (
    <div className="invite-card">
      <strong>Play together</strong>
      <p className="fine-print">
        Share a link: whoever opens it becomes your friend and washes up beside you. It holds a short code, never your sign-in.
      </p>
      {live ? (
        <>
          <div className="invite-link-row">
            <input readOnly value={link} aria-label="Invite link" onFocus={(e) => e.currentTarget.select()} data-testid="invite-link" />
            <button className="primary-button" onClick={share}>{(navigator as any).share ? "Share" : "Copy"}</button>
          </div>
          <span className="fine-print">
            Code <b>{row.code}</b> · works for {minutesLeft(row.expiresAtMicros)} min ·{" "}
            <button className="link-button" onClick={() => createInvite()}>New link</button>
          </span>
        </>
      ) : (
        <button className="primary-button invite-make" onClick={() => createInvite()} data-testid="make-invite">
          Make an invite link
        </button>
      )}
    </div>
  );
};

type PanelProps = { open: boolean; onClose: () => void; onOpenChat?: () => void };

/** Mounted only while open, so a closed panel does not follow every player update. */
const FriendsPanel = memo((props: PanelProps) => (props.open ? <FriendsPanelBody {...props} /> : null));

const FriendsPanelBody = ({ onClose, onOpenChat }: PanelProps) => {
  const rows = useFriendRows();
  const players = usePlayersByHex();
  const me = useMyPlayer();
  const muted = useChatPrefsStore((s) => s.muted);
  const toggleMute = useChatPrefsStore((s) => s.toggleMute);
  const { follow, removeFriend } = useGameActions();
  const show = useToastStore((s) => s.show);
  const mentees = useMenteeCounts();
  const meHex = useMyIdentityHex();
  const myMentees = meHex ? mentees.get(meHex) ?? 0 : 0;
  const friends = useMemo(() => {
    const list = rows.map((r) => {
      const hex = identityHex(r.friend);
      const p = players.get(hex);
      return { row: r, hex, p, online: !!p?.online };
    });
    // Online first, then by name.
    return list.sort((a, b) => Number(b.online) - Number(a.online) || (a.p?.name ?? "").localeCompare(b.p?.name ?? ""));
  }, [rows, players]);
  const goTo = (f: (typeof friends)[number]) => {
    if (!f.p || !f.online) { show(`${f.p?.name ?? "They"} is offline`); return; }
    if (f.p.state === PlayerState.Dead) { show(`${f.p.name} is down; try again in a moment`); return; }
    void follow(f.row.friend);
    onClose();
  };
  return (
    <section className="game-panel friends-panel" aria-label="Friends">
      <header className="panel-heading">
        <div>
          <h2>Friends</h2>
        </div>
        {onOpenChat && <button className="panel-switch" onClick={onOpenChat}>Chat</button>}
        <button className="close-button" onClick={onClose} aria-label="Close friends">×</button>
      </header>
      <InviteCard />
      <p className="mentor-summary fine-print" data-testid="mentee-count">
        {myMentees > 0
          ? `Mentor's Pin: you have helped ${myMentees} newer player${myMentees === 1 ? "" : "s"} find their way.`
          : "Help a newer friend reach the Coast or make their first club to earn the Mentor's Pin."}
      </p>
      <ul className="friend-list" aria-label="Friends list">
        {friends.length === 0 && (
          <li className="empty-state">No friends yet. Share your link, or tap a player and choose Add friend.</li>
        )}
        {friends.map((f) => {
          const area = f.p ? AREA_NAMES[areaOf(f.p)] : "";
          const dist = f.p && me ? chebyshev(me, f.p) : null;
          return (
            <li key={f.row.id.toString()} className={`friend-row ${f.online ? "online" : "offline"}`} data-testid="friend-row">
              <span className="presence-dot" aria-hidden="true" />
              <span className="friend-info">
                <strong>
                  {f.p?.name ?? `Player-${f.hex.slice(4, 8)}`}
                  {(mentees.get(f.hex) ?? 0) > 0 && (
                    <span className="mentor-badge" title="Newer players they have mentored">Mentor · {mentees.get(f.hex)}</span>
                  )}
                </strong>
                <span className="fine-print">
                  {f.online ? `Online · ${area}${dist !== null ? ` · ${dist} tile${dist === 1 ? "" : "s"}` : ""}` : "Offline"}
                  {muted.has(f.hex) ? " · muted" : ""}
                </span>
              </span>
              <button className="primary-button friend-go" disabled={!f.online} onClick={() => goTo(f)} aria-label={`Go to ${f.p?.name ?? "friend"}`}>
                Go to
              </button>
              <button className="close-button friend-remove" onClick={() => removeFriend(f.row.friend)} aria-label={`Remove ${f.p?.name ?? "friend"}`} title="Remove friend">×</button>
            </li>
          );
        })}
      </ul>
      {muted.size > 0 && (
        <details className="muted-list">
          <summary>Muted players ({muted.size})</summary>
          <ul>
            {[...muted].map((hex) => (
              <li key={hex}>
                <span>{players.get(hex)?.name ?? `Player-${hex.slice(4, 8)}`}</span>
                <button className="link-button" onClick={() => toggleMute(hex)}>Unmute</button>
              </li>
            ))}
          </ul>
        </details>
      )}
      <p className="fine-print">Go to walks you toward them. Mutes stay in this browser only.</p>
    </section>
  );
};

export default FriendsPanel;
