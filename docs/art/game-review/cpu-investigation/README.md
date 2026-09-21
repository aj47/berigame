# Bounded moving-crowd CPU investigation

A 12-second Chrome CPU profile used a 390×844 viewport, DPR 3 (renderer cap 1.5), 4× CPU throttling, and 32 online players with varied hairstyles/palettes. It ran on the existing Apple M1 Pro host/GPU. Profiling adds overhead: this is diagnostic attribution, not an FPS benchmark or physical-phone validation.

The database contained **229 player rows: 32 online, 197 offline**. The script created 30 fixtures because 2 players were already online. Every fixture was verified offline afterward; the browser and script-created SDK connections closed. No source edits occurred during capture; no page/fixture errors occurred.

## Actionable finding

Repeated identity-to-hex conversion during linear lookups is the largest avoidable sampled cost:

| Function group | Sampled self time | Share of all recorded samples |
| --- | ---: | ---: |
| uint8ArrayToHexString |1,292 ms|10.16%|
| u256ToUint8Array |1,235 ms|9.71%|
| hex-string byte mapper |953 ms|7.51%|
| useMyPlayer find callback, excluding child conversion functions |775 ms|6.11%|

These shares include recorded idle/program samples in the denominator. One `PlayerAvatar → useMyPlayer` inclusive stack accounted for 1,856 ms of the 12,691 ms capture. The repeated `PlayerAvatar` appearance lookup is another caller of the same conversion path. The sampled `jsxDEV` self-cost was 1.06%; the primary identified work is application/SDK lookup logic, not solely React development instrumentation.

Minimal candidate: compare the SDK's public `__identity__` bigint values directly instead of converting every candidate to a 64-character hex string in `useMyPlayer` and the avatar appearance lookup. **Do not substitute `Identity.isEqual` or `equals`: the installed SDK implements these by calling `toHexString()` on both operands.** A WeakMap cache of the exact SDK encoding is suitable for presentation keys, with invalidation if the public bigint changes. Filter offline rows before generating React keys in `RenderOnlineUsers`. Computing the local player once in a shared parent/context could reduce repeated searches further, but is a larger follow-up. Keep gameplay and subscription visibility unchanged.

Relevant source at capture:

- `frontend/src/spacetime/hooks.ts:34–37`: every consumer scans players and converts each candidate identity.
- `frontend/src/Components/3D/PlayerAvatar.tsx:40–42`: every rendered avatar repeats local-player and appearance searches.
- `frontend/src/Components/3D/RenderOnlineUsers.tsx`: offline rows are checked after identity conversion.

The profile does **not** establish the speedup of the proposed fix. A same-workload post-fix measurement and a production-build comparison are still needed before making a performance claim.

## Artifacts

- `moving-32-4x.cpuprofile`: raw Chrome profile, loadable in DevTools Performance.
- `summary.json`: sample aggregates, counts, cleanup, and source hashes.
- `frontend/scripts/cpu-profile.ts`: repeatable optional diagnostic; credentials are never written to these artifacts.

Captured frontend source SHA256: `76711f7735451f43983068456ec878ef293b8cb58784fbb7f2b99344aabc0331`.

## Post-fix qualification

Root replaced scanned identity conversions with public-bigint comparisons, cached exact SDK hex presentation keys with a WeakMap, and filtered offline users before generating keys. Independent review found no identity-format/zero-value/cache-invalidation issue. `Identity.isEqual` was explicitly avoided after inspecting its installed implementation.

The new, separate `appearance-optimized-render-validation.json` preserves the earlier baseline report. With 32 online players, desktop and 390px movement delivered 60 FPS. The 4× throttled development sample improved from 40.5 to 55.5 FPS; p95 changed 50→16.8 ms, maximum 233.3→100 ms. These bounded runs are evidence of improvement, not a controlled hardware benchmark; the intervening nameplate changes are also present.

All 24 authoritative appearance changes, 24 editor preview/cancel cycles, movement-marker checks, and crowd material/palette/texture cleanup checks passed. Source stayed frozen and browser/fixture errors were empty.

A separate production bundle at an isolated preview port delivered 60 FPS unthrottled and 55.9 FPS with 4× CPU throttle, 32 online players, and 291 total stored player rows. Debug globals were absent. Its p95 was 16.8 ms and maximum 100 ms: residual update hitches remain, including in production. `production-render-validation.json` records the bundle/source hashes and RAF samples. The preview process was stopped afterward; the primary development client/server remained running. All harness connections were closed.

These are still viewport/CPU-throttle results on the Apple M1 Pro GPU, not physical-phone acceptance. No production-source changes were made by the validation agent.


## Follow-through

The bounded fix is implemented. The post-fix varied-crowd run is recorded in `../appearance-optimized-render-validation.json`; a separate production-bundle run is in `../production-render-validation.json`. At 4× CPU throttle the development movement sample improved from 40.5 to 55.5 FPS; production measured 55.9 FPS. The production normal-speed sample measured 60 FPS. Residual throttled frames reached 100ms. All resource checks and cleanup passed; these remain desktop measurements, not physical-phone qualification.
