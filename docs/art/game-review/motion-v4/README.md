# Movement v4 live QA

Read-only production-source audit of the running local game in Chrome 153.0.8010.48 at 390×844 with touch emulation. Only newly created QA identities were commanded; the user's live tailnet character was not accessed. No source or model files were edited. All test browser and SDK connections were closed.

No reproduction of backwards travel or periodic idle Guard flashes in this run.

Initial pass: 1,844 animation-frame samples across east/Strike, south/Grab, west/Guard, north/Guard, diagonal/Strike, followed by an explicit Stop while in Guard. During sustained central travel, all 1,078 samples used the expected Run, RunGrab, or RunGuard clip. There were zero incorrect clips among frames with measurable position movement and zero frames facing backwards relative to travel. Arrival settled to Idle, GrabReady, and Guard as appropriate; manual Stop settled to Guard. No page errors.

The initial recording and stride filmstrips preceded the final native cadence calibration from 2.1 to 1.92 units/s. Their continuity/direction evidence remains applicable; they are not the final cadence reference.

After that calibration, a fresh identity completed one continuous diagonal route while changing Strike → Grab → Guard. The final recording contains 407 RAF samples, including 102 moving Run frames, 108 RunGrab, and 128 RunGuard. No idle clip occurred during position movement; no backwards-facing frames; arrival settled to Guard; no page errors.

Files:
- `motion-v4-final-phone.mp4`: final cadence recording and stance changes.
- `final-cadence-report.json`: compact final results.
- `final-cadence-motion.json`: on-demand clip/cue/position/yaw samples and raw video path.
- `report.json` / `raw-motion.json`: five-direction sustained-travel results and raw samples.
- `run-stride.png`, `grab-stride.png`, `guard-stride.png`: chronological filmstrips from the earlier long recording, inspected for visible gait and stance consistency.
- `final-cadence-*.png`: actual final phone frames.

Position/yaw dot products establish facing relative to rendered travel; they do not measure planted-foot slip. The sequence was visually inspected through chronological gait filmstrips and phone screenshots. Desktop Chrome touch emulation is not a physical-phone performance claim. Paired-combat reactions and the final tailnet build were outside this audit.
