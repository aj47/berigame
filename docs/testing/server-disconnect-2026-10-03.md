# Server-side disconnect investigation — October 3, 2026

Investigated the live `berigame-beta` database after a report from the deployed `index-0af3d22d.js` client. No game code, production data, or deployment was changed during this investigation.

The strongest finding is **no evidence of server combat/CPU overload**. Historical Maincloud metrics show normal tick throughput, very short reducer waits, and no module exit around the interruption. A separate CLI probe reproduced shorter update-delivery jitter outside the renderer. The origin of the original 11-second interruption remains unresolved: Maincloud delivery and the network/client connection path are still candidates.

## Incident evidence

The client received no world updates from 8:31:59.995 to 8:32:11.292 PM PDT (11.297 seconds). Input handling continued. Eight outstanding giant attacks were aborted together at 8:32:10.096, consistent with the existing six-second stall threshold and four-second reconnect grace. The report does not record socket-close reasons, so the precise reconnect trigger is inferred.

The world tick advanced from 1587626 to 1587644 across the gap. HP was 20 before the gap, 5 on recovery, and then 0. Module logs contain no crash or tick-reducer error in that interval; the matching error is `set_target: you are dead` at 8:32:12.183 PM. Absence from module logs does not exclude a Maincloud host or delivery incident.

## Historical Maincloud metrics

Read and exported the signed-in [database metrics dashboard](https://spacetimedb.com/@aj47/berigame-beta/metrics). The CSV exports contain one-minute points spanning approximately 7:57–8:57 PM PDT, including the incident. Metric definitions were verified from the dashboard's own descriptions: compute is CPU seconds **per second**, elapsed time is transaction wall-clock seconds **per second**, and outgoing traffic is per second. These are not per-call latency charts.

| Evidence | Observed value | Interpretation |
| --- | --- | --- |
| Tick throughput | 1.6667 calls/second at every exported point | 100 ticks/minute; normal aggregate throughput |
| Total database compute | Maximum 0.019590 CPU seconds/second | Under 1.96% of one CPU core in the exported hour |
| Tick CPU near incident | Approximately 6.25 ms/call | Derived from tick CPU rate divided by tick call rate; an average, not a maximum |
| Reducer queue delay, 8:32–8:34 PM points | Mean 3.67–3.81 microseconds; displayed p99 99 microseconds | No measured queue congestion |
| Current reducer queue length | 0 at every exported point | No sampled backlog; does not prove no transient backlog |
| Disconnect causes near incident | Client-closed counts appear at 8:33, 8:34, and 8:35 PM points | Consistent with client reconnect/closure; cannot identify a particular socket |
| Other exported disconnect causes | Idle timeout, module exit, WebSocket I/O and protocol errors all 0 across the hour | No recorded crash/server error among these causes |
| Rejections by `client_connected` | 0 across the hour | No evidence of admission rejection |
| Peak outgoing traffic | About 2.35 KB/second, 6.95 messages/second | No large traffic volume in this sample |

Transaction elapsed time closely tracks compute; the exported data does not show a large transaction wait outside CPU execution. Scheduled Function Delay showed **NO DATA AVAILABLE**. The Network section exposes throughput/subscription counts, but not per-connection RTT or outgoing queue residence time.

These are aggregated, database-wide measurements. Scrape/rate windows and minute labels cannot be mapped directly to the exact 11-second interval or a particular player. Queue histogram percentiles are interpolated (for example, a queue-position p99 of 0.99 is not a literal fractional queued request). Normal aggregates cannot exclude a short host, transport, or individual connection stall.

## Production measurements

Read-only owner SQL and control subscriptions were used. Owner connections bypass character creation in `lifecycle.ts`; these probes created no players or combat traffic.

At sampling time there were 86 stored players, 2 online players, 39 public Frontier objects, and 63 private Frontier objects. This is current load, not a reconstruction of incident-time load.

45 SQL samples observed 81 ticks over 48.600 seconds of server timestamps. Normalized server intervals ranged from 599.046 to 600.997 ms per tick. World-row SQL execution duration was typically 169 microseconds, with a maximum of 11.180 ms. CLI round trips ranged from 627 to 2,646 ms; those include CLI startup, database resolution, and transport and are not reducer timings or pure network RTT.

Three simultaneous subscriptions each received 90 consecutive world updates:

| Read mode | Server interval p95 / maximum | Local delivery interval p95 / maximum |
| --- | --- | --- |
| Default | 600.880 / 601.167 ms | 684.389 / 1,501.680 ms |
| Confirmed | 600.880 / 601.167 ms | 807.023 / 1,082.812 ms |
| Unconfirmed | 600.880 / 601.167 ms | 807.178 / 1,082.624 ms |

The default stream had a 1.502-second delivery gap followed by catch-up delivery, despite a 599.924 ms server timestamp interval. This reproduces delayed delivery outside the game renderer and browser SDK, but not the original 11-second interruption. Confirmed versus unconfirmed arrivals for matching ticks differed by less than 4 ms throughout this sample, providing no evidence that durability confirmation caused it.

`world.tick_started_at` is the reducer invocation timestamp, not its finish time. Stable invocation timestamps do not, by themselves, exclude execution, commit, subscription, transport, or local observer delays. The separate streams and SQL checks narrow the investigation but do not isolate Wi-Fi/ISP from Maincloud WebSocket delivery.

## Code and local runtime review

The actual scheduled reducer was exercised through a counted in-memory table adapter at an illustrative current-scale population (86 stored / 2 online / 39 public objects): 100 ticks, median 0.676 ms, p95 0.889 ms, maximum 1.548 ms. This is a local Node/mock measurement, not Maincloud execution timing or an exact production-state replay.

There are five full player-table scans per expansion tick, plus avoidable grant/policy lookups for offline players. This deserves optimization at larger populations, but does not reproduce the reported pause at current scale. Extreme synthetic building/movement loads can exceed the 600 ms tick budget; those results should not be attributed to this incident.

The client report separately proves a recovery issue: burst-delivered movement updates grow the remaining animation queue to 2.159 seconds. That is downstream of the original delivery interruption and remains unfixed by this read-only investigation.

## Remaining evidence needed

To isolate the remaining delivery interruption, obtain per-connection subscription/outgoing queue and WebSocket RTT/close timing around **2026-10-04 03:31:59–03:32:22 UTC**, or capture a recurrence with a simultaneous observer on an independent network. Public module logs and the available dashboard aggregates do not expose that detail. The unauthenticated metrics endpoint returned 403; the authenticated dashboard was subsequently verified and used above.

Future bug reports should retain each world row's server timestamp alongside local arrival time, plus reconnect reason and socket close metadata. Those fields are currently missing; no instrumentation was deployed in this investigation.

Evidence is stored locally in the ignored `.spacetime-data/disconnect-20261003/` directory: `server-all.jsonl`, `server-probe.json`, `delivery-probe.json`, dashboard CSVs in `dashboard/`, and `dashboard-analysis.json`. Local counted benchmarks are in `.spacetime-data/giant-lag-20261003/scaling-results.json`.

Reference: [SpacetimeDB reducer context](https://spacetimedb.com/docs/functions/reducers/reducer-context/) defines the invocation timestamp. Server metric definitions are in the official [database metrics](https://github.com/clockworklabs/SpacetimeDB/blob/v2.10.1/crates/datastore/src/db_metrics/mod.rs) and [worker metrics](https://github.com/clockworklabs/SpacetimeDB/blob/v2.10.1/crates/core/src/worker_metrics/mod.rs) sources; the deployed Maincloud server version was not independently verified.
