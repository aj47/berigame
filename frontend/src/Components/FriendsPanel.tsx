import React, { memo, useEffect, useMemo, useRef, useState } from "react";
import { INVITE_PARAM, MAX_FRIENDS, PlayerState, areaOf, chebyshev, inviteUrl, normalizeInviteCode } from "@sim";
import { REGIONS, type RegionId } from "../../../shared/sim/frontier/catalog";
import { useGameActions } from "../spacetime/actions";
import { useFriendRows, useInviteCodeRows, useMenteeCounts, useMyIdentityHex, useMyPlayer, usePlayersByHex } from "../spacetime/hooks";
import { identityHex } from "../spacetime/identity";
import { useChatPrefsStore } from "../spacetime/stores/chatPrefsStore";
import { useToastStore } from "../spacetime/stores/toastStore";
import { useLoadingStore } from "../store";
import SocialTabs from "./SocialTabs";
import "./friends.css";

const AREA_NAMES = { grove: "the Grove", hedge: "the brambles", coast: "the Coast", boulders: "the Boulders" } as const;
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
      <div className="invite-heading">
        <span className="social-card-icon" aria-hidden="true">✉</span>
        <div><strong>Bring a friend</strong><p className="fine-print">Join as friends, side by side.</p></div>
      </div>
      {live ? (
        <>
          <div className="invite-link-row">
            <input readOnly value={link} aria-label="Invite link" onFocus={(e) => e.currentTarget.select()} data-testid="invite-link" />
            <button className="primary-button" onClick={share}>{(navigator as any).share ? "Share" : "Copy"}</button>
          </div>
          <span className="fine-print invite-meta">
            <span>Code <b>{row.code}</b> · {minutesLeft(row.expiresAtMicros)} min left</span>
            <button className="link-button" onClick={() => createInvite()}>New link</button>
          </span>
        </>
      ) : (
        <button className="primary-button invite-make" onClick={() => createInvite()} data-testid="make-invite">
          Create invite
        </button>
      )}
    </div>
  );
};

type PanelProps = { open: boolean; onClose: () => void; onOpenChat?: () => void; initialAdding?: boolean; initialSearch?: string; initialPlayerHex?: string };

/** Mounted only while open, so a closed panel does not follow every player update. */
const FriendsPanel = memo((props: PanelProps) => (props.open ? <FriendsPanelBody {...props} /> : null));

const FriendsPanelBody = ({ onClose, onOpenChat, initialAdding = false, initialSearch = "", initialPlayerHex }: PanelProps) => {
  const rows = useFriendRows();
  const players = usePlayersByHex();
  const me = useMyPlayer();
  const muted = useChatPrefsStore((s) => s.muted);
  const toggleMute = useChatPrefsStore((s) => s.toggleMute);
  const { follow, addFriend, removeFriend } = useGameActions();
  const show = useToastStore((s) => s.show);
  const mentees = useMenteeCounts();
  const meHex = useMyIdentityHex();
  const myMentees = meHex ? mentees.get(meHex) ?? 0 : 0;
  const [adding, setAdding] = useState(initialAdding);
  const [query, setQuery] = useState(initialSearch);
  const [selectedHex, setSelectedHex] = useState(initialPlayerHex);
  const [busy, setBusy] = useState<ReadonlySet<string>>(new Set());
  const [added, setAdded] = useState<ReadonlySet<string>>(new Set());
  const [errors, setErrors] = useState<Record<string, { kind: 'add' | 'remove' | 'follow'; message: string }>>({});
  const pending = useRef(new Set<string>());
  const search = useRef<HTMLInputElement>(null);
  const friendIds = useMemo(() => new Set(rows.map(row => identityHex(row.friend))), [rows]);
  useEffect(() => { if (adding) search.current?.focus(); }, [adding]);
  useEffect(() => {
    setAdded(current => {
      const remaining = [...current].filter(hex => !friendIds.has(hex));
      return remaining.length === current.size ? current : new Set(remaining);
    });
  }, [friendIds]);
  const friends = useMemo(() => {
    const list = rows.map((r) => {
      const hex = identityHex(r.friend);
      const p = players.get(hex);
      return { row: r, hex, p, online: !!p?.online };
    });
    // Online first, then by name.
    return list.sort((a, b) => Number(b.online) - Number(a.online) || (a.p?.name ?? "").localeCompare(b.p?.name ?? ""));
  }, [rows, players]);
  const candidates = useMemo(() => [...players.entries()]
    .filter(([hex]) => hex !== meHex && !friendIds.has(hex) && !added.has(hex))
    .sort(([, a], [, b]) => Number(b.online) - Number(a.online) || a.name.localeCompare(b.name)), [players, meHex, friendIds, added]);
  const matches = candidates.filter(([hex, player]) => selectedHex ? hex === selectedHex : (player.online || query.trim()) && player.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  const full = rows.length >= MAX_FRIENDS;
  const changeFriend = async (hex: string, name: string, kind: 'add' | 'remove', action: () => Promise<boolean>) => {
    if (pending.current.has(hex)) return;
    pending.current.add(hex);
    setBusy(new Set(pending.current));
    setErrors(current => { const next = { ...current }; delete next[hex]; return next; });
    try {
      if (!await action()) throw new Error('Friend action rejected');
      setAdded(current => {
        const next = new Set(current);
        if (kind === 'add') next.add(hex); else next.delete(hex);
        return next;
      });
      show(kind === 'add' ? `${name} added to friends` : `${name} removed from friends`);
    } catch {
      setErrors(current => ({ ...current, [hex]: { kind, message: `Couldn’t ${kind} ${name}. Try again.` } }));
    } finally {
      pending.current.delete(hex);
      setBusy(new Set(pending.current));
    }
  };
  const goTo = async (f: (typeof friends)[number]) => {
    if (pending.current.has(f.hex)) return;
    if (!f.p || !f.online) { show(`${f.p?.name ?? "They"} is offline`); return; }
    if (f.p.state === PlayerState.Dead) { show(`${f.p.name} is down; try again in a moment`); return; }
    if ((f.p.region || 'bramblewild') !== (me?.region || 'bramblewild')) return;
    pending.current.add(f.hex);
    setBusy(new Set(pending.current));
    setErrors(current => { const next = { ...current }; delete next[f.hex]; return next; });
    try {
      if (!await follow(f.row.friend)) throw new Error('Follow rejected');
      onClose();
    } catch {
      setErrors(current => ({ ...current, [f.hex]: { kind: 'follow', message: `Couldn’t reach ${f.p!.name}. Try again.` } }));
    } finally {
      pending.current.delete(f.hex);
      setBusy(new Set(pending.current));
    }
  };
  return (
    <section className="game-panel friends-panel" aria-label="Friends">
      <header className="panel-heading">
        <h2>Chat</h2>
        <button className="close-button" onClick={onClose} aria-label="Close friends">×</button>
      </header>
      <SocialTabs active="friends" onMessages={onOpenChat} onFriends={() => setAdding(false)} friendCount={rows.length} />
      <div className="friends-section-heading">
        <div><h3>{adding ? 'Find players' : 'Your friends'}</h3>{!adding && <span className="friends-count">{friends.filter(friend => friend.online).length} online</span>}</div>
        <button className={adding ? "" : "primary-button"} onClick={() => { setAdding(!adding); setQuery(''); setSelectedHex(undefined); }} aria-expanded={adding} aria-controls="friend-search">
          {adding ? 'Done' : 'Add friend'}
        </button>
      </div>
      <div className="friends-body">
      {adding ? <div id="friend-search" className="friend-search">
        <label className="sr-only" htmlFor="friend-player-search">Find a player</label>
        <input ref={search} id="friend-player-search" type="search" value={query} onChange={event => { setQuery(event.target.value); setSelectedHex(undefined); }} placeholder="Find a player…" autoComplete="off" />
        {full && <p className="friends-alert" role="status">Your list is full ({MAX_FRIENDS}). Remove a friend to make room.</p>}
        <ul className="friend-list" aria-label="Players to add">
          {matches.map(([hex, player]) => <li className="friend-candidate" key={hex}>
            <span className="friend-info"><strong>{player.name}</strong><span className="fine-print">{player.online ? 'Online' : 'Offline'}</span></span>
            <button className="primary-button" disabled={full || busy.has(hex)} aria-label={errors[hex]?.kind === 'add' ? `Retry adding ${player.name}` : `Add ${player.name} as a friend`}
              onClick={() => void changeFriend(hex, player.name, 'add', () => addFriend(player.identity))}>
              {busy.has(hex) ? 'Adding…' : errors[hex]?.kind === 'add' ? 'Retry' : 'Add friend'}
            </button>
            {errors[hex]?.kind === 'add' && <p className="friends-alert" role="alert">{errors[hex].message}</p>}
          </li>)}
          {!matches.length && <li className="empty-state social-empty-state"><strong>{query.trim() ? 'No players found' : 'No new players online'}</strong><span>{query.trim() ? 'Try another name.' : 'Search a name or invite a friend below.'}</span></li>}
        </ul>
      </div> : <ul className="friend-list" aria-label="Friends list">
        {friends.length === 0 && (
          <li className="empty-state social-empty-state"><strong>Your crew starts here</strong><span>Choose Add friend to find someone online.</span></li>
        )}
        {friends.map((f) => {
          const region = f.p?.region || 'bramblewild';
          const area = f.p ? region === 'bramblewild' ? AREA_NAMES[areaOf(f.p)] : REGIONS[region as RegionId]?.name ?? region : "";
          const dist = f.p && me && (me.region || 'bramblewild') === region ? chebyshev(me, f.p) : null;
          const sameRegion = (me?.region || 'bramblewild') === region;
          const name = f.p?.name ?? `Player-${f.hex.slice(4, 8)}`;
          return (
            <li key={f.row.id.toString()} className={`friend-row ${f.online ? "online" : "offline"}`} data-testid="friend-row">
              <span className="presence-dot" aria-hidden="true" />
              <span className="friend-info">
                <strong>
                  {name}
                  {(mentees.get(f.hex) ?? 0) > 0 && (
                    <span className="mentor-badge" title="Newer players they have mentored">Mentor · {mentees.get(f.hex)}</span>
                  )}
                </strong>
                <span className="fine-print">
                  {f.online ? `Online · ${area}${dist !== null ? ` · ${dist} tile${dist === 1 ? "" : "s"}` : ""}` : "Offline"}
                  {muted.has(f.hex) ? " · muted" : ""}
                </span>
              </span>
              <div className="friend-controls">
              <button className="primary-button friend-go" disabled={!f.online || !sameRegion || busy.has(f.hex)} onClick={() => void goTo(f)} aria-label={errors[f.hex]?.kind === 'follow' ? `Retry going to ${name}` : `Go to ${name}`} title={sameRegion ? "Walk toward your friend" : `Travel to ${area} to meet them`}>
                {errors[f.hex]?.kind === 'follow' ? 'Retry' : 'Go to'}
              </button>
              <button onClick={() => toggleMute(f.hex)} aria-label={`${muted.has(f.hex) ? 'Unmute' : 'Mute'} ${name}`}>{muted.has(f.hex) ? 'Unmute' : 'Mute'}</button>
              <button className="friend-remove" disabled={busy.has(f.hex)} onClick={() => void changeFriend(f.hex, name, 'remove', () => removeFriend(f.row.friend))} aria-label={errors[f.hex]?.kind === 'remove' ? `Retry removing ${name}` : `Remove ${name}`}>
                {busy.has(f.hex) ? 'Wait…' : errors[f.hex]?.kind === 'remove' ? 'Retry' : 'Remove'}
              </button>
              </div>
              {errors[f.hex] && errors[f.hex].kind !== 'add' && <p className="friends-alert" role="alert">{errors[f.hex].message}</p>}
            </li>
          );
        })}
      </ul>}
      <details className="social-details friends-invite">
        <summary>Invite a friend</summary>
        <InviteCard />
      </details>
      {muted.size > 0 && (
        <details className="muted-list">
          <summary>Muted players ({muted.size})</summary>
          <p className="fine-print">Muted in this browser.</p>
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
      <details className="social-details">
        <summary><span aria-hidden="true">✦</span> Mentor's Pin {myMentees > 0 && <span className="friends-count">{myMentees} helped</span>}</summary>
        <p className="mentor-summary fine-print" data-testid="mentee-count">
          {myMentees > 0
            ? `Helped ${myMentees} newer player${myMentees === 1 ? "" : "s"}.`
            : "Help a newer friend reach the Coast or craft their first club to earn this pin."}
        </p>
      </details>
      </div>
    </section>
  );
};

export default FriendsPanel;
