import React, { memo, useMemo, useState } from "react";
import { MAX_TRADE_STACKS, Pending, formatOffer, getItemDef, parseOffer, type ItemStack } from "@sim";
import { useGameActions } from "../spacetime/actions";
import { useInventoryRows, useMyIdentityHex, useMyPlayer, usePlayerByHex, usePlayersByHex, useTradeRows } from "../spacetime/hooks";
import { identityHex } from "../spacetime/identity";
import type { Trade } from "../module_bindings/types";
import "./friends.css";

const ItemChip = ({ item, onClick, label, disabled, note }: { item: ItemStack; onClick?: () => void; label: string; disabled?: boolean; note?: string }) => {
  const def = getItemDef(item.itemId);
  const content = (
    <>
      <img src={def?.icon} alt="" />
      <span className="trade-chip-name">{def?.name ?? item.itemId}</span>
      <span className="trade-chip-qty">×{item.quantity}</span>
      {note && <span className="trade-chip-note">{note}</span>}
    </>
  );
  return onClick
    ? <button className="trade-chip" onClick={onClick} disabled={disabled} aria-label={label} title={label}>{content}</button>
    : <span className="trade-chip" aria-label={label}>{content}</span>;
};

/**
 * The trade window: an incoming request card, your outgoing request, or the
 * two-sided offer sheet. Bottom sheet on phones, a panel on desktop.
 */
const TradeWindow = memo(() => {
  const trades = useTradeRows();
  const me = useMyPlayer();
  if (me?.pending === Pending.Trade && me.combatTarget) {
    return <TradeApproach targetHex={identityHex(me.combatTarget)} />;
  }
  return trades.length ? <TradeWindowBody trades={trades} /> : null;
});

const TradeApproach = ({ targetHex }: { targetHex: string }) => {
  const other = usePlayerByHex(targetHex);
  const { cancel } = useGameActions();
  return <section className="trade-window trade-request" role="status" data-testid="trade-approach">
    <span>Walking to <b>{other?.name ?? 'them'}</b> to trade…</span>
    <button className="close-button" onClick={() => void cancel()} aria-label="Cancel walking to trade">×</button>
  </section>;
};

const TradeWindowBody = ({ trades }: { trades: readonly Trade[] }) => {
  const meHex = useMyIdentityHex();
  const me = useMyPlayer();
  const players = usePlayersByHex();
  const inventory = useInventoryRows();
  const actions = useGameActions();
  const [busy, setBusy] = useState(false);
  const [coinOffer, setCoinOffer] = useState(0);

  // Prefer the open trade; else the newest request.
  const trade = useMemo(() => {
    const open = trades.find((t) => t.accepted);
    if (open) return open;
    return [...trades].sort((a, b) => b.createdTick - a.createdTick)[0] ?? null;
  }, [trades]);

  const bag = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of inventory) m.set(r.itemId, (m.get(r.itemId) ?? 0) + r.quantity);
    return m;
  }, [inventory]);

  if (!trade || !meHex) return null;
  const iAmA = identityHex(trade.a) === meHex;
  const otherId = iAmA ? trade.b : trade.a;
  const other = players.get(identityHex(otherId));
  const otherName = other?.name ?? "them";
  const run = async (fn: () => Promise<unknown>) => { setBusy(true); try { await fn(); } finally { setBusy(false); } };

  if (!trade.accepted) {
    return (
      <section className="trade-window trade-request" role="dialog" aria-label="Trade request" data-testid="trade-request">
        {iAmA ? (
          <>
            <span>Waiting for <b>{otherName}</b> to accept your trade…</span>
            <button className="close-button" disabled={busy} onClick={() => run(() => actions.cancelTrade(trade.id))} aria-label="Cancel trade request">×</button>
          </>
        ) : (
          <>
            <span><b>{otherName}</b> wants to trade</span>
            <div className="trade-request-actions">
              <button className="primary-button" disabled={busy} onClick={() => run(() => actions.respondTrade(trade.id, true))}>Accept</button>
              <button disabled={busy} onClick={() => run(() => actions.respondTrade(trade.id, false))}>Decline</button>
            </div>
          </>
        )}
      </section>
    );
  }

  const mineRaw = iAmA ? trade.aOffer : trade.bOffer;
  const theirsRaw = iAmA ? trade.bOffer : trade.aOffer;
  const mine = parseOffer(mineRaw) ?? [];
  const theirs = parseOffer(theirsRaw) ?? [];
  const myConfirmed = iAmA ? trade.aConfirmed : trade.bConfirmed;
  const theirConfirmed = iAmA ? trade.bConfirmed : trade.aConfirmed;
  const myCoins = (iAmA ? trade.aCoins : trade.bCoins) ?? 0;
  const theirCoins = (iAmA ? trade.bCoins : trade.aCoins) ?? 0;
  const offered = new Map(mine.map((it) => [it.itemId, it.quantity]));
  const weapon = me?.weapon ?? "";

  const setOffer = (items: ItemStack[]) => run(() => actions.setTradeOffer(trade.id, formatOffer(items)));
  const add = (itemId: string, n: number) => {
    const next = new Map(offered);
    next.set(itemId, Math.min(bag.get(itemId) ?? 0, (next.get(itemId) ?? 0) + n));
    setOffer([...next].map(([id, q]) => ({ itemId: id, quantity: q })));
  };
  const remove = (itemId: string) => {
    const next = new Map(offered);
    const q = (next.get(itemId) ?? 0) - 1;
    if (q > 0) next.set(itemId, q); else next.delete(itemId);
    setOffer([...next].map(([id, qty]) => ({ itemId: id, quantity: qty })));
  };
  const bagItems = [...bag].map(([itemId, quantity]) => ({ itemId, quantity: quantity - (offered.get(itemId) ?? 0) }))
    .filter((it) => it.quantity > 0);
  const nothing = mine.length === 0 && theirs.length === 0 && !(trade.aCoins || trade.bCoins);

  return (
    <section className="trade-window trade-sheet" role="dialog" aria-label={`Trading with ${otherName}`} data-testid="trade-sheet">
      <header className="panel-heading">
        <div>
          <h2>Trade <small>{otherName}</small></h2>
        </div>
        <button className="close-button" disabled={busy} onClick={() => run(() => actions.cancelTrade(trade.id))} aria-label="Cancel trade">×</button>
      </header>
      <div className="trade-content">
      <div className="trade-columns">
        <div className={`trade-side ${myConfirmed ? "confirmed" : ""}`}>
          <h3><span><span aria-hidden="true">↗</span> You give</span> {myConfirmed && <span className="trade-ok">✓ ready</span>}</h3>
          <div className="trade-offer" data-testid="my-offer">
            <span className="trade-coin-total"><span aria-hidden="true">◉</span> <b>{myCoins}</b> coins</span>
            {mine.length === 0 && <span className="fine-print">No items added</span>}
            {mine.map((it) => (
              <ItemChip key={it.itemId} item={it} label={`Take back one ${getItemDef(it.itemId)?.name ?? it.itemId}`} onClick={() => remove(it.itemId)} disabled={busy} />
            ))}
          </div>
        </div>
        <div className={`trade-side ${theirConfirmed ? "confirmed" : ""}`}>
          <h3><span><span aria-hidden="true">↙</span> You get</span> {theirConfirmed && <span className="trade-ok">✓ ready</span>}</h3>
          <div className="trade-offer" data-testid="their-offer">
            <span className="trade-coin-total"><span aria-hidden="true">◉</span> <b>{theirCoins}</b> coins</span>
            {theirs.length === 0 && <span className="fine-print">No items added</span>}
            {theirs.map((it) => <ItemChip key={it.itemId} item={it} label={`${it.quantity} ${getItemDef(it.itemId)?.name ?? it.itemId}`} />)}
          </div>
        </div>
      </div>
      <div className="trade-coin-editor">
        <label htmlFor="trade-coins">Offer coins</label>
        <input id="trade-coins" aria-label="Coins to offer" type="number" min="0" max="1000000" value={coinOffer} onChange={e=>setCoinOffer(Math.max(0,Math.floor(Number(e.target.value)||0)))}/>
        <button aria-label="Set coin offer" disabled={busy} onClick={()=>run(()=>actions.setTradeCoins(trade.id,coinOffer))}>Set</button>
      </div>
      <div className="trade-bag" aria-label="Your bag">
        <div className="trade-bag-heading"><strong>Your bag</strong><span className="fine-print">Tap to add 1 · tap offer to remove 1</span></div>
        <div className="trade-bag-items">
          {bagItems.length === 0 && <span className="fine-print">Nothing left to offer</span>}
          {bagItems.map((it) => {
            const wielded = it.itemId === weapon;
            const full = !offered.has(it.itemId) && offered.size >= MAX_TRADE_STACKS;
            return (
              <ItemChip key={it.itemId} item={it} disabled={busy || full}
                note={wielded ? "Equipped" : undefined}
                label={`Offer one ${getItemDef(it.itemId)?.name ?? it.itemId}`}
                onClick={() => add(it.itemId, 1)} />
            );
          })}
        </div>
      </div>
      </div>
      <footer className="trade-footer">
      <p className="fine-print trade-status" aria-live="polite">
        {myConfirmed && theirConfirmed && trade.swapTick ? "Swapping… stay close: a hit on either of you stops it." :
          myConfirmed && !theirConfirmed ? `Waiting for ${otherName} to confirm…` :
          theirConfirmed && !myConfirmed ? `${otherName} is ready. Review, then confirm.` :
          "Changes reset confirmations. Walking away cancels. Outside the safe ring the swap takes a moment and a hit stops it."}
      </p>
      {mine.some(item => ['stick', 'stone_club'].includes(item.itemId) && item.quantity >= (bag.get(item.itemId) ?? 0) && !theirs.some(other => other.itemId === item.itemId)) && <p className="fine-print trade-warning" role="status">Last route tool! Keep a spare to cross brambles or Boulders again.</p>}
      <div className="trade-actions">
        <button disabled={busy} onClick={() => run(() => actions.cancelTrade(trade.id))}>Cancel</button>
        <button className="primary-button" data-testid="trade-confirm" disabled={busy || myConfirmed || nothing}
          onClick={() => run(() => actions.confirmTrade(trade.id, trade.aOffer, trade.bOffer, trade.aCoins ?? 0, trade.bCoins ?? 0))}>
          {myConfirmed ? "Confirmed" : "Confirm trade"}
        </button>
      </div>
      </footer>
    </section>
  );
};

export default TradeWindow;
