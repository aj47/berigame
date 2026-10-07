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
| Refill | 1 point per 6 s. **Online only up to the rested line; logged out up to the top** (empty to full in 12 h away) |
| Above the line (rested) | the event pays **double** items and XP |
| At or below the line | normal pay |
| Fewer points than the action costs (tired) | **one event in four** pays; the others give nothing, and a tired berry harvest never rolls for a stick |

What it touches: Grove berry trees and Coast/Boulders nodes
(`spacetimedb/src/reducers/tick.ts` `phaseHarvest`), frontier resource gathers
(`shared/sim/frontier/engine.ts` `advance`). Gardens and planter crops already
grow in real time, so the meter leaves them alone. Quest and order coins are not
scaled: order inputs are gathered (so energy-limited), and orders keep their
60-coins-a-day cap.

Effect: a person gathering about half the time in a 2 h session never reaches
the tired band, and comes back rested after a night away. A character that
gathers nonstop earns at most one 3 s action per 18 s from the refill, plus one
tired action in four: well under half its nonstop rate
(`shared/sim/__tests__/energy.test.ts`). It is never rested, because it never
logs out.

Storage: an `energy` record in `frontier_private`, shown to its owner through
the owner-filtered `frontier_view` (no new row-level-security filter; adding one
disconnects every client on publish). Session edges settle it
(`lib/energy.ts settleEnergyFor`: disconnect = online stretch, reconnect = time
away).

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
