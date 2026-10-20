# FPV Rig — Sim on laptop, phone as a real transmitter

Status: Phase 0–2 built and running locally. See `README.md` for the quick start.
Owner: you. Built in `C:\Users\kulal\fpv`.

---

## 1. Goal

A local FPV simulator that runs on the laptop, driven by an Android phone acting as a
**transmitter**, not a gamepad. Cable-connected. No accounts, no internet, no hosting.

Non-negotiables:

1. **Throttle is a position, not a spring.** Stick stays where you leave it. Hover at ~35-40%.
2. **Arm switch** gates the motors. Disarmed = no thrust, ever.
3. **Physics must feel like a real 5" quad in acro.** Judged by someone who has flown real FPV.
4. **Smooth.** 144 fps target, no hitching, frame-time graph visible.
5. **$0.** Free tools only.

Non-goals (for now): real drone control, multiplayer, photoreal graphics, mobile-only play.

---

## 2. Why the old approach felt wrong

A virtual Xbox pad in Windows has spring-centred axes:

```
stick released -> axis = 0.0 -> sim reads 50% throttle -> quad climbs
```

To hover you must hold the stick slightly *below* centre, forever. Real TX: stick stays,
axis holds, quad holds altitude.

Fix: our pipeline carries **absolute stick positions** and the sim applies TX semantics
(throttle hold, arm, expo, rates). If a third-party sim is used, the bridge implements
"sticky throttle" so the axis value persists after release.

---

## 3. Architecture

```
┌──────────────────────────┐        USB cable (ADB reverse)        ┌───────────────────────────┐
│  Android phone           │  ws://127.0.0.1:8080/tx   ~1 ms       │  Laptop — Node server      │
│  Chrome, TX page         │ ────────────────────────────────────► │  - static files            │
│  - 2 gimbals (Mode 2)    │                                       │  - WebSocket hub           │
│  - throttle HOLD         │ ◄──── state / telemetry ────────────  │  - packet validation       │
│  - arm switch            │                                       │  - 250 Hz -> sim input     │
│  - rates / expo / trim   │                                       │                            │
│  - fullscreen + wake lock│                                       │  ┌──────────────────────┐  │
└──────────────────────────┘                                       │  │ Sim (three.js/WebGL) │  │
                                                                   │  │ 1 kHz physics        │  │
                                                                   │  │ 144 fps render       │  │
                                                                   │  └──────────────────────┘  │
                                                                   └───────────────────────────┘
```

Two input consumers:

- **Path A (preferred):** sim reads TX packets directly. No driver, no Xbox emulation,
  250 Hz, full TX semantics. This is the real product.
- **Path B (compatibility):** optional bridge that exposes a ViGEmBus virtual pad so
  Liftoff / Uncrashed / FPV Freerider can be driven with proper sticky throttle.
  Only needed if we want third-party sims.

No hosting: the Node server binds to `127.0.0.1` and is reachable only through the USB
ADB tunnel. Nothing is exposed to the network.

---

## 4. Latency budget (target end-to-end)

| Stage                         | Budget      | Notes                                   |
|-------------------------------|-------------|-----------------------------------------|
| Touch scan + glass            | 8-16 ms     | physical limit, unavoidable             |
| Browser event -> WS send      | 1-3 ms      | coalesce at 250 Hz                      |
| USB (ADB reverse)             | 0.5-1.5 ms  | jitter ~0                               |
| Server -> sim                 | < 0.5 ms    | in-process                              |
| Physics tick (1 kHz)          | 0-1 ms      | fixed step, interpolated for render     |
| Render + present              | 2-7 ms      | 144 Hz panel, no vsync stalls           |
| **Total**                     | **12-28 ms**| vs real TX->aircraft ~15-25 ms           |

Measured and displayed in-sim (input age + frame time), so claims are checkable.

---

## 5. Stack

**Chosen: TypeScript everywhere + WebGL.**

| Piece        | Choice                                  | Why |
|--------------|-----------------------------------------|-----|
| Sim render   | three.js (WebGL2)                       | fastest iteration, easy 144 fps on low-poly, no install |
| Physics      | custom rigid-body quad model, 1 kHz     | full control over feel; Rapier only for collisions if needed |
| Server       | Node 24 (already installed)             | zero install, single process, static + WS |
| Phone app    | PWA page served over the cable          | no APK, no Play Store, instant updates, no signing |
| Optional pad | ViGEmBus + Node bridge                  | only for third-party sims |
| Launcher     | `run.bat` + `adb reverse`               | double-click to fly |

Why not Rust/bevy: great perf, but native exe builds + slower UI iteration + no headless
visual checking here. If we later want a native build, the physics core is isolated enough
to port. WebGL at this polygon count will sit at refresh rate on any laptop from the last
8 years.

---

## 6. Flight model (the "feels real" part)

Rigid body with:

- Mass, diagonal inertia, 2207-class motor/prop assumptions (5", 6S, ~650 g AUW).
- Thrust per motor = k * rpm^2, rpm approaches command with first-order lag (~20-40 ms).
- Torque = differential thrust * arm length; yaw torque from motor reaction + prop drag.
- Drag: linear + quadratic body drag, separate prop disc drag.
- **Prop wash**: thrust/torque disturbance when descending through own wake.
- **Battery sag**: voltage droops with current; thrust scales with voltage.
- **Ground effect** near surfaces, reduced control authority in your own downwash.
- Collisions: simple convex shapes for gates/structures; crash = disarm + reset prompt.

Flight controller (Betaflight-style):

- Rate mode (acro) with per-axis PID + feedforward, D-term filtering, I-term anti-windup.
- Betaflight "Actual" rates + expo, so numbers match what you fly for real.
- Angle mode available for warm-up, clearly labelled.
- Arm switch, throttle hold, beeper/arming tone, failsafe on link loss (motors cut).

Camera / feel:

- Tilt 25-45° configurable, FOV ~115-120° horizontal, slight fisheye.
- Optional analog look: vignette, scanlines, chromatic fringing, sensor noise, static on
  link loss. Toggle to clean HD.
- Motor audio via WebAudio: rpm-pitched whine + wind, volume by throttle.
- OSD: throttle %, voltage, current, timer, altitude, speed, RSSI, lap time, horizon.

---

## 7. Phases and acceptance criteria

**Phase 0 — skeleton (0.5 day)**
Repo layout, Node server, phone page shell, ADB tunnel script, latency HUD.
Done when: phone shows a page over the cable at `127.0.0.1:8080` and round-trip ping is
displayed, < 5 ms.

**Phase 1 — transmitter (1 day)**
Two gimbals, Mode 2 (Mode 1 switchable), **throttle hold**, arm switch, rates/expo/trim,
calibration, packet protocol at 250 Hz, reconnect handling, fullscreen + wake lock.
Done when: stick positions and arm state stream to the laptop at 250 Hz, throttle stays
put after release, and link loss disarms.

**Phase 2 — flyable sim (2-3 days)**
Renderer, arena, quad rigid body, rate PID, camera, crash/reset, FPV HUD.
Done when: you can take off, hover hands-off at a fixed throttle, do a figure-8 and a
power loop without the physics doing anything "video-gamey".

**Phase 3 — feel pass (1-2 days)**
Prop wash, motor lag, sag, drag, rates tuning, camera tilt/FOV, audio, analog look.
Done when: you (a real FPV pilot) say it flies like your quad, and can hit a gate line
you'd hit in real life.

**Phase 4 — loop (1 day)**
Gates, lap timer with splits, ghost replay, restart, session stats.
Done when: a full lap is timed and repeatable, ghost matches your line.

**Phase 5 — polish/perf (1 day)**
Frame-time budget, input-age readout, settings persistence, one-click launcher, docs.
Done when: 144 fps average, 1% low within 20% of average, cold start to flying < 15 s.

**Phase 6 — optional compatibility (0.5 day)**
ViGEmBus bridge with sticky throttle, so Liftoff/Uncrashed can be flown from the phone.
Done when: third-party sim sees a pad whose throttle holds.

---

## 8. Repo layout

```
fpv/
  docs/PLAN.md
  apps/
    server/        Node: static host + WS hub + input fusion
    sim/           three.js sim (physics, render, HUD)
    tx/            phone transmitter page (PWA)
  packages/
    protocol/      shared packet encode/decode + unit tests
  tools/
    adb-tunnel.ps1 USB reverse forward, device check
    bridge-vigem/  optional virtual pad
  run.bat          one-click: tunnel + server + open sim
```

---

## 9. Protocol (v1)

Binary over WebSocket, 250 Hz:

```
u8   magic 0xF1
u8   type  (1 = tx frame, 2 = config, 3 = ping)
u16  seq
u32  t_us
i16  throttle, yaw, pitch, roll      (-1000..1000, -1000 = stick low/left)
u8   flags (bit0 armed, bit1 mode, bit2 hold)
i16  aux1, aux2
```

Server keeps last frame, interpolates, exposes to sim at 1 kHz. Link watchdog: 100 ms
without frames = motors cut + "LINK LOST" on HUD.

---

## 10. Risks

| Risk | Mitigation |
|---|---|
| Touch latency feels mushy | cable, 250 Hz, interpolation, no vsync stalls, frame-time HUD |
| ADB setup friction | scripted `adb reverse`, fallback to USB tethering, one-time guide |
| Physics tuning takes longer than expected | parameterised model + your real-world feedback loop per phase |
| Browser tab throttling | PWA + wake lock + `--disable-background-timer-throttling` launcher flags |
| Scope creep on graphics | low-poly art direction first, "analog" look hides simple geometry |

---

## 11. Decisions needed from you

1. Approve TypeScript/three.js (recommended) or insist on Rust/bevy.
2. Analog CRT look (default) or clean HD.
3. First map: indoor warehouse/bando (default) or outdoor race field.
4. Build Phase 6 (third-party sim bridge) or skip it.
5. Laptop GPU + monitor refresh rate (for the 144 fps target).
6. Confirm USB debugging can be enabled on the phone.
