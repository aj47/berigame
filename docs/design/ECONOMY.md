# Energy, banking and risk

Rules that limit what bots gain from playing all day without detecting who is a
bot. Every character follows the same rules. A person who plays normal sessions
barely notices them. A character that gathers nonstop, or a farm of characters
that funnels value to one main, earns much less per character, and has to carry
that value across ground where other players can see and attack it.

Design goals:

- **No transfer tax.** PvP loot stays at 100%. (RuneScape's 2007 trade limits
  hurt players more than gold farmers and were reverted.)
- **No slow movement.** A heavy load is visible, not slow.
- **No proof of personhood.** Nothing depends on knowing who is human.

The numbers live in `shared/sim/energy.ts` and `shared/sim/banking.ts`. When
this file disagrees with the code, the code wins: fix this file.

## 1. Energy (rested and tired)

One meter per character, measured in **seconds of gathering**.

| Rule | Value |
|---|---|
| A finished Grove harvest or frontier gather spends its own length | 3 s berry harvest = 3 points |
| Seasoned meter (character 3+ days old) | 7200 points (2 h of nonstop gathering) |
| New character's meter, growing linearly over 3 days | 5400 points |
| Rested line | two thirds of the meter |
| Start | every meter starts at the rested line (normal pay) |
| Refill | **Only while logged out**: 1 point per 6 s up to the top (empty to full in 12 h away). Online time refills nothing (`ENERGY_ONLINE_REFILL_SHARE` = 0; it was 1, i.e. 1 point per 6 s up to the rested line, until 2026-11) |
| Above the line (rested) | the event pays **double** items and XP |
| At or below the line | normal pay |
| Fewer points than the action costs (tired) | **one event in four** pays; the others give nothing, and a tired berry harvest never rolls for a stick |

What it touches: Grove berry trees and Coast/Boulders nodes
(`spacetimedb/src/reducers/tick.ts` `phaseHarvest`), frontier resource gathers
(`shared/sim/frontier/engine.ts` `advance`). Gardens and planter crops already
grow in real time, so the meter leaves them alone. Quest and order coins are not
scaled: order inputs are gathered (so energy-limited), and orders keep their
60-coins-a-day cap.

Effect: a person in 2 h sessions spends a few hundred points a session and a
night away fills the meter, so they play rested and never see the tired band.
A character that never logs off spends its meter once (about 9 hours for a
24/7 AI seat) and then keeps one harvest in four. It is never rested, because
it never logs out.

### Why online time refills nothing (2026-11)

With the old online refill (1 point per 6 s, 600 an hour, up to the rested
line) the meter only bit a literal nonstop gatherer. A 24/7 AI seat on the beta
finished ~176 harvests an hour (528 points) because walking, banking and
crafting keep it gathering about half the time, so the refill covered it: one
seat made 3,316 harvests without its meter falling below 56%, none of 27
meters in the snapshot was tired, and seats earned ~1.8x a human per online
hour against a target of at most 0.5x.

`shared/sim/__tests__/energyPace.ts` replays fixed schedules through the meter
(value = payouts, in normal harvests, per online hour; steady state = days
2-7). The human plays 2 h at 08:00 and 19:00, gathering 14 of every 20
minutes, at one harvest per 54 s while gathering (the pace that reproduces the
measured 1.8x) or, as the "keen human", at the seat's one per 10.2 s. The seat
is online 24/7 and alternates 78 minutes of gathering at one harvest per
10.2 s with 78 minutes of other work, which reproduces ~176 harvests an hour
and a meter that never drops below 56% on the old rules. Candidates:

| rules | human /h | keen human /h | seat /h (day 1 / steady) | seat vs human (steady / first week) | seat tired after | seat reconnecting every 3 h vs human | nonstop /h | seat logged out 12 h a night, /online h | newcomer at seat pace: lowest in first 2 h, tired after (seat pace / human pace) |
|---|---|---|---|---|---|---|---|---|---|
| old (6 s online) | 96 | 498 | 181 / 177 | 1.84x / 1.85x | never | 1.84x | 400 | 258 | 60%, 24.2 h / never |
| A: online refill 12 s | 96 | 498 | 167 / 100 | 1.04x / 1.14x | 19.0 h | 1.04x | 300 | 258 | 49%, 7.9 h / never |
| B: online refill stops 3 h after a login | 96 | 498 | 112 / 44 | 0.46x / 0.56x | 11.3 h | 1.84x | 300 | 258 | 60%, 7.2 h / 28.3 h |
| **C: refill only logged out (shipped)** | 96 | 498 | 95 / 44 | **0.46x** / 0.54x | 8.4 h | 0.46x | 300 | 258 | 39%, 4.8 h / 25.0 h |
| D: C + 2 points per second of gathering | 96 | 449 | 70 / 44 | 0.46x / 0.50x | 3.6 h | 0.46x | 300 | 156 | 11%, 2.4 h / 12.5 h |

- **A** halves the seat's take but leaves it level with a human.
- **B** matches C for a seat that never reconnects, but any reconnect (a
  gateway reset, or on purpose) restarts the clock, and it needs a new stored
  field.
- **C** is the simplest rule that reaches the target: a 2-hour session never
  used the online refill (it starts rested after a night away), so humans at
  either pace keep every unit, and a reconnect refills only the seconds
  actually spent away.
- **D** gets the seat tired sooner but costs keen humans 10% of their rested
  pay and tires a keen newcomer after 2.4 h.

Costs of C:
- A newcomer's first login (meter at its 3,600-point rested line, nothing
  refilling) lasts about 5 hours at a seat's pace or about a day at the human
  pace before tired, against about a day and never before.
- The fastest honest Long Season pace (8 h days, harvesting back to back half
  of each session, `season.test.ts`) gains about 25% less XP and reaches 99 in
  every skill in about 55 days instead of 45.
- What it does not stop: a seat that logs out 12 h a night is never tired and
  still earns 258 an online hour (2.7x a human, 73% of the old 24/7 seat's
  daily take). Logging out is the price the meter asks, the same for everyone.

Odds in contested claim draws follow the meter (`claimWeight`, `1 + 3 x
points / max`), so a run-down seat also drops to weight 1 against a rested
human's 4; the model above ignores this, so humans do a little better than
shown.

Storage: an `energy` record in `frontier_private`, shown to its owner through
the owner-filtered `frontier_view` (no new row-level-security filter; adding one
disconnects every client on publish). Session edges settle it
(`lib/energy.ts settleEnergyFor`: disconnect = online stretch, reconnect = time
away). An online stretch refills nothing and moves the refill clock to its
end, so it is never counted as time away later.

## 2. Banking: value is safe only in the vault

- **Everything in the bag drops on defeat** (unchanged).
- **The vault** is the frontier's personal `vault-<id>` container, so the Meadows
  town bank and the Grove vault are one store. Items in it never drop.
- **Grove safe ring** (radius 3 around spawn): `vaultDeposit` and `vaultWithdraw`
  are instant. The safe ring also gained a vault chest at its north-east corner
  as a landmark.
- **Coast drop boxes**, one per quadrant: (9,16), (40,13), (8,36), (41,39). Stand
  within 1 tile; `vaultDeposit` takes **4 ticks** (`Pending.Deposit`, private row
  `pending_deposit`). A hit, a step or any other action stops it. Drop boxes
  never pay out. They give a choice between the long, safe walk home and a quick,
  risky deposit in the field, and four of them mean nobody can camp every
  delivery.

## 3. The load glow

`player.load` (public): 0, 1 at an unbanked value of 30, 2 at 90
(`carriedValue`, refreshed every 5 ticks after all other player writes).
Weapons are worth their damage, food half its healing (rounded up), and the
listed rare items more; the rest are worth 1. The first copy of each weapon is your kit and route
key, so it does not count. Everyone sees a pulsing gold ring at the carrier's
feet. A farm moving goods home lights up; human PvP gets visible targets and
keeps the full loot.

## 4. Trades take a moment where an attack can land

When both sides confirm, the swap runs **at once** where no attack can land (the
Grove safe ring, the boss no-PvP zones, Meadows town). Anywhere else it runs
**3 ticks later** (`trade.swapTick`). Any damage to either side before then stops
it and clears both confirmations (the tick's `interrupt` plus an HP check for
damage from any source). A hand-off to another character in the field is
therefore a risk, while trading in town stays as easy as before.

## 5. The safe ring and leaving it

- Radius **3** (49 tiles), up from 2. It stops one short of the nearest berry
  trees' harvest tiles, so nobody can harvest from inside it.
- **Exit protection**: stepping out of the ring gives 3 ticks of grace (the
  respawn-grace mechanism), so nobody can camp its edge. Attacking ends it at
  once, and it never shortens first-spawn grace. The ring has no walls, so it
  can be left in every direction.

## 6. World supply

Unchanged and already fixed per node: a Grove tree or Coast node serves one
harvester at a time and then regrows, and a frontier patch serves one gatherer
at a time. More alts split the same supply; they do not create more.

## What this does not stop

A large, patient farm can still earn something. The aim is that each alt earns
little per day, cannot cheaply move its value out, and takes days to reach a
full meter, so farming stops paying. Detection is not needed for any of it.
