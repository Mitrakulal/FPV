# FPV Rig

A local FPV simulator. The laptop renders and runs the physics; the Android phone is the
transmitter, over a USB cable. No accounts, no internet, no app install, no gamepad
emulation, no spring-loaded throttle.

```
 phone browser (TX page)          laptop
┌──────────────────────┐      ┌──────────────────────────────┐
│ two gimbals, arm     │ USB  │ node relay ──► sim (WebGL2)  │
│ switch, 250 Hz       │─────►│ 1 kHz rigid body, rate PID   │
│ absolute stick data  │ adb  │ HUD: RTT, Hz, fps, frame ms  │
└──────────────────────┘      └──────────────────────────────┘
```

The phone loads `http://127.0.0.1:8080/tx/` from its **own** localhost. `adb reverse`
maps that port back to the laptop, so the traffic never touches WiFi or the router.

## Quick start

1. Double-click **`run.bat`** — installs deps on first run, builds, starts the server and
   opens <http://127.0.0.1:8080/sim/>.
2. Plug the phone in, enable **Developer options → USB debugging**, accept the prompt.
3. Double-click **`connect-phone.bat`** — sets up the cable tunnel (uses the bundled
   `tools/platform-tools/adb.exe`).
4. On the phone, open Chrome at **`http://127.0.0.1:8080/tx/`**, tap `FULL`.
5. Throttle stick stays where you leave it. Pull it to the bottom, tap **DISARMED → ARMED**,
   then raise throttle to ~35% and fly.
6. The phone boots in **ANGLE** (self-levelling): push the right stick up and the quad leans
   forward and flies away. Tap the top-right **ANGLE/ACRO** button for rate-mode freestyle.

No phone handy? The sim is playable on the keyboard:
`W/S` throttle · `A/D` yaw · arrows pitch/roll · `Space` arm · `R` restart · `C` chase view ·
`[` `]` camera tilt · `V` analog look · `M` mute. The phone has the same thing as the
**R · RESTART** button in the middle of the transmitter screen.

No auto-respawn: a hard crash leaves the quad where it fell (and cuts the motors) until you
press `R`, which puts you back on the start line. Light knocks are not crashes — a 10 m drop,
a fast low pass along the runway, or clipping a container at walking pace just bumps you and
you keep flying. Only a real slam (roughly 20 m free fall or faster) or ending up upside down
ends the attempt.

## The throttle problem, solved at the source

Windows virtual gamepads always spring their axes back to centre. A sim then reads the
released stick as 50% throttle, so you end up holding the stick *below* centre forever to
hover — exactly the thing that feels wrong.

This rig never emulates a gamepad. The phone sends four absolute axis values; the sim
applies transmitter semantics itself:

- **throttle is a latch** — the stick's vertical position *is* the throttle, and it holds
  when you lift your thumb (optional "spring to 35%" training mode in `SET`);
- **arm switch** gates the motors, and refuses to arm above 10% throttle;
- **expo** is applied on the phone, like a radio;
- **link loss cuts the motors** (250 ms watchdog) and disarms the page when it is hidden.

## What is simulated

Flight model in `apps/sim/src/physics.ts`, pure maths, no renderer:

- 650 g 5" quad, 4 motors at 115 mm, thrust ∝ throttle² (so hover lands near 35%),
- first-order motor lag, differential thrust mixing fed into the real torque equation,
- full rigid-body rotation with gyroscopic coupling, quaternion integration,
- quadratic + linear drag, angular damping, battery sag under load, prop-wash
  disturbance when descending through your own wake,
- Betaflight-style rate loop (P/I/D on body rates) with per-axis rate limits,
- forgiving ground + obstacle contact (soft bumps bounce, only hard hits crash), angle mode
  (self-levelling, default on the phone) and acro rate mode from the same `ACRO` toggle,
- fixed 1 kHz physics tick with an accumulator, independent of frame rate.

Rendering is three.js: a floodlit arena, a five-gate course, crates and poles, a quad model,
an FPV camera at the body centre with rotor vibration and adjustable tilt, plus a chase cam.

## Measured on this machine

| thing | value |
|---|---|
| relay throughput from a simulated TX | 250 frames/s |
| phone ↔ server round trip (loopback) | ~1 ms |
| physics tick rate | ~1000–1100 Hz |
| phone page send rate | 140–250 Hz (browser timer floor) |
| sim frame rate | GPU bound; software SwiftShader was 10–40 fps, a real GPU is far higher |

The HUD shows fps, frame ms, tick rate, packets/s, RTT and link age live, so you can see
the pipeline rather than trust it.

## Layout

```
apps/server/   node relay: static files, ws hub, watchdog, /health
apps/sim/      physics core + three.js client
apps/tx/       phone transmitter UI
packages/protocol/  binary frame format shared by all three
tools/         adb tunnel, smoke tests, headless screenshots
tests/         physics + protocol unit tests
docs/PLAN.md   the full plan and phase list
```

## Tests

```bat
npm test          :: physics + protocol (15 assertions)
node tools/smoke.ts      :: server up, pages served, 250 Hz frames arrive (server must run)
node tools/tx-test.mjs   :: touch drag, throttle hold, arm guard (server must run)
node tools/screenshot.mjs :: headless render check + screenshots in scratch\
```

## Troubleshooting

- **`adb` with no `reverse`** — bundled adb is 37.x; make sure `connect-phone.bat` is what
  you ran, not an old system adb.
- **Phone shows the page but no link** — check `adb devices` says `device`, then re-run
  `connect-phone.bat` (the tunnel dies when the cable is replugged).
- **Chrome sleeps / dims** — the TX page requests a screen wake lock and fullscreen; tap
  the page once after loading so the browser grants them.
- **Port already in use** — another server is running; close that window or set
  `FPV_PORT` for both the server and the tunnel.

## Phase status

- Phase 0 — skeleton, server, cable tunnel, latency HUD: **done**
- Phase 1 — transmitter (gimbals, throttle hold, arm, expo, wake lock, failsafe): **done**
- Phase 2 — flight model, arena, FPV camera, crash/reset: **done, first pass**
- Phase 3 — feel tuning with your thumbs (rates, PIDs, drag, camera tilt): next
- Phase 4 — gates with timing, laps, ghost
- Phase 5 — polish, settings persistence, OSD
- Phase 6 — optional ViGEm bridge for Liftoff/Uncrashed/FPV Freerider (sticky throttle)
