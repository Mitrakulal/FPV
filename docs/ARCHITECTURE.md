# Architecture

This document describes how FPV Rig is put together: the process model, wire protocol,
flight model, render pipeline, and the decisions behind them. It is intentionally more
detailed than the README; the code remains the source of truth.

## Constraints

1. **Offline and local.** No cloud service, account or network dependency at runtime.
2. **No gamepad emulation.** The phone sends absolute stick positions; radio semantics are
   applied in software.
3. **Deterministic physics.** The flight model runs at a fixed 1 kHz and is independent of
   rendering.
4. **Windows-first tooling.** The launcher and USB helper are BAT/PowerShell. The web app
   and server are portable.
5. **Zero cost.** Only free and open-source tools and assets are used.

## Processes

```text
Android Chrome                 Node server                    Laptop Chrome
┌───────────────┐   USB/adb   ┌──────────────────┐   ws://    ┌────────────────────┐
│ /tx/ page     │ ──────────► │ static + /health │ ◄───────── │ /sim/ three.js app │
│ 250 Hz frames │             │ WebSocket relay  │            │ 1 kHz physics      │
└───────────────┘             └──────────────────┘            └────────────────────┘
```

- `apps/tx` is bundled into `apps/server/public/tx/tx.js`.
- `apps/sim` is bundled into `apps/server/public/sim/sim.js`.
- `apps/server/src/server.ts` is bundled into `dist/server.js`.
- The server serves `apps/server/public` and a single WebSocket endpoint at `/ws`.
- Clients identify themselves with `?role=tx` or `?role=sim` (the default is `sim`).

`adb reverse tcp:8080 tcp:8080` maps the phone's loopback port to the laptop. The phone page
is therefore same-origin with its WebSocket, and the traffic stays inside the USB link. The
server binds to `127.0.0.1` by default.

## Link layer

### Frame

The phone streams a 22-byte little-endian binary frame. The shared codec lives in
`packages/protocol/protocol.ts`; the server decodes, re-encodes and forwards it, and the
sim decodes it again.

```text
0   u8   magic 0xF1
1   u8   type 1 (TX frame)
2   u16  sequence
4   u32  sender timestamp, µs (wraps)
8   i16  throttle  -1000 … +1000
10  i16  yaw       -1000 … +1000
12  i16  pitch     -1000 … +1000
14  i16  roll      -1000 … +1000
16  u8   flags     bit0 armed, bit1 ANGLE, bit2 HOLD, bit3 failsafe
17  u8   stick mode 1 or 2
18  u16  aux switches, reserved
20  u16  checksum of bytes 0…19
```

The checksum is a 16-bit sum; it is not a cryptographic integrity check. Its job is to
catch truncated or stale buffers, not to secure the link.

### TX page

- Two analog sticks implemented with pointer events; the knob is a fixed fraction of the
  stick radius so the usable travel is large.
- Mode 2 maps left = throttle/yaw and right = pitch/roll; Mode 1 swaps those pairs.
- HOLD mode keeps the throttle where the thumb leaves it. SPRING mode returns to the
  configured hover point and is intended for training.
- Expo and deadband are applied before the axes are quantized to `i16`. Defaults: expo 35%,
  deadband 2%.
- Smoothing is a short time constant; it removes finger tremor without adding visible lag.
- Arming requires throttle below 10%. Hiding the page, losing the socket or restarting the
  run disarms.
- A wake lock and fullscreen request keep the page alive while flying. The page also sends
  a JSON `ping` and reports the round-trip time.
- Settings are stored in `localStorage` under `fpv.tx.settings.v2`.

### Relay and watchdog

The relay keeps the latest valid frame and immediately sends it to any sim that connects.
Malformed frames are counted and dropped. Status JSON (`tx`, `txAgeMs`, `txHz`, `sims`,
`txs`) is broadcast every 250 ms and is also available at `/health`.

The sim treats a frame as fresh for 250 ms. If the link goes stale, input is disarmed and
the HUD shows `LINK LOST`; the physics keeps running so the quad falls rather than freezing.

The phone's **R · RESTART** button sends `{"type":"reset"}`. The server forwards it to all
sims; each sim resets to the start line. The phone disarms first, so a restart cannot resume
with the throttle still up.

## Flight model

`apps/sim/src/physics.ts` is a pure TypeScript module. It imports no renderer code and is
unit-tested directly.

### State

- Position and velocity in world space.
- Orientation as a normalized quaternion; body rates in rad/s.
- Four motor states and four thrust values.
- Battery voltage, integral terms, previous rates, crash flag and run time.

The body axes follow the physics convention `+X = nose up`, `+Y = nose left`,
`+Z = roll left`. The renderer maps these to the quad model; the input layer converts the
radio convention (pitch stick forward = nose down) before the physics sees it.

### Integration

The render loop accumulates wall-clock time and calls `step(1/1000, input)` at a fixed
1 kHz. A slow render frame changes how many steps are taken, not the step size. The state is
read once per rendered frame for the camera and HUD, so the visual update rate is decoupled
from the model rate.

Linear motion:

```text
F_thrust = up * (T0 + T1 + T2 + T3)
F_drag   = -(dragLin + dragQuad * |v|) * v
a        = (F_thrust + F_drag) / m + gravity
```

Angular motion includes the full gyroscopic term:

```text
I * ω̇ = τ - ω × (I * ω) - angDrag * ω
```

and the quaternion is advanced with `q̇ = 0.5 * q * (0, ω)` followed by normalization.

### Motors and mixer

- Commanded motor values are clamped to `0…1`, mixed from throttle and the three PID
  outputs, and passed through a first-order lag with `τ = 30 ms`.
- Thrust per motor is `Tmax * motor²`, i.e. proportional to RPM squared.
- Differential thrust produces pitch and roll torque through the 115 mm arm; motor reaction
  torque produces yaw through the `yawCoef` term.
- The mixer authority is 0.55, leaving headroom for attitude control at high throttle.
- Battery voltage droops with load (`25.2 V - 3.0 V * load`), and thrust scales with the
  square of the voltage ratio.
- Descending faster than 2.5 m/s injects a speed-scaled prop-wash disturbance into the motor
  outputs. It is deterministic noise, not a random walk, so the model stays repeatable.

Hover throttle is solved iteratively from weight, maximum thrust and the sag model; it lands
near 36% on a full pack.

### Rate loop

ANGLE and ACRO share the same inner rate PID:

```text
err      = target rate - measured body rate
integral = clamp(integral + err * dt, -2, 2)
derivative = -(measured rate - previous measured rate) / dt
u        = clamp(kp * err + ki * integral + kd * derivative, -1, 1)
```

Defaults: `kp = 0.075`, `ki = 0.55`, `kd = 0.0016`; yaw gains are scaled by 1.6 and 1.4.
The derivative is taken from the measurement rather than the error, avoiding a kick when
the setpoint moves.

ACRO maps stick position directly to a body-rate setpoint: 600 °/s pitch, 400 °/s yaw and
600 °/s roll. ANGLE maps it to a lean angle and lets the controller generate the rate.

### ANGLE mode

Euler angles are not used for the attitude loop because world-referenced pitch and roll
misbehave when the aircraft is yawing while pitched. Instead:

1. Compute the heading from the projection of the forward vector onto the horizontal plane.
2. Project the up vector onto the heading frame to obtain heading-relative pitch and roll.
3. Smooth the *target* lean, not the measured lean, with a 50 ms filter.
4. Run a proportional attitude loop with `kp = 4`, limited to 180 °/s.
5. Cap yaw at 150 °/s so the attitude correction cannot be outrun.

The step response settles in roughly 0.25 s with about 0.2° of overshoot.

### Ground and obstacles

Obstacles are axis-aligned boxes inflated by the quad radius (0.09 m). On overlap, the quad
is pushed out along the shallowest face. The normal component of velocity is used to decide
the outcome:

- normal speed **> 5 m/s** → crash, motors cut, dead-fall;
- otherwise → soft bounce (normal velocity reversed at 0.25, tangential velocity damped to
  85%), and the run continues.

Ground contact at `y <= 0.02 m` zeroes vertical, horizontal and angular velocity. The run
ends only if:

- downward speed **> 15 m/s**, or
- horizontal speed **> 15 m/s**, or
- tilt from vertical **> 1.45 rad** (≈ 83°).

This is deliberately forgiving. A 10 m drop touches down at about 12.3 m/s and survives; a
20 m drop reaches about 15.8 m/s and ends the run. There is no automatic respawn. A crashed
quad has no motors and falls under gravity until it settles; `R` rebuilds the run from the
start line.

## Rendering

- three.js r186, WebGL2, ACES-style tonemapping.
- HDR environment loaded from the bundled Poly Haven sky; PBR textures for asphalt,
  concrete, corrugated metal, grass, gravel and rust.
- Directional sun with a 2048² shadow map; contact shadows are enabled for the quad and
  props.
- Render targets use 4× MSAA where supported. A two-pass bloom is composited in the final
  shader together with vignette, motion smear and an optional analog look.
- Pixel ratio is chosen from viewport size and capped at 1.5; a runtime quality controller
  lowers the internal scale and shadow resolution if frame time stays high.
- FPV camera sits at the body centre with a configurable tilt (24° default, 0–60°) and a
  speed-dependent FOV widening. The chase camera is spring-damped. An overview camera is
  available for debugging and screenshots.
- The scene is a 100 m × 400 m asphalt strip with a warehouse, containers, tyre stacks,
  pallets, barrels, poles, trees, a windsock and five gates. Colliders are simple boxes
  derived from the props, not triangle meshes.

## Latency

| Stage | Budget / measured |
|---|---|
| Touch scan + digitizer | 8–16 ms (hardware) |
| Browser event → WebSocket send | 1–3 ms (coalesced at the timer rate) |
| USB / `adb reverse` | 0.5–1.5 ms |
| Relay → sim | < 0.5 ms (loopback) |
| Physics step | 0–1 ms |
| Render + present | device-dependent |

The HUD reports the measured input age, packet rate and round-trip time, plus frame time and
physics tick rate. See the README for the numbers observed on the development machine.

## Testing strategy

- **Unit tests** (`tests/physics.test.ts`, `tests/protocol.test.ts`) run the model directly:
  hover equilibrium, thrust curve, rate limiting, ANGLE response, drag, crash thresholds,
  dead-fall, frame round-trip and checksum rejection.
- **Smoke test** (`tools/smoke.ts`) starts from a running server, fetches the pages, opens a
  simulated TX and verifies 250 Hz forwarding and the phone reset path.
- **Touch test** (`tools/tx-test.mjs`) drives the phone page with synthetic pointer events
  and checks throttle hold, arm guard and layout.
- **Render check** (`tools/screenshot.mjs`, `tools/look.mjs`) loads the sim in headless
  Chrome, catches console/page errors and captures frames.
- **Type check** (`tsc --noEmit`) keeps the protocol and both clients honest.

## Design decisions and trade-offs

**Why not a gamepad?** A virtual pad springs its axes to centre. A sim then interprets a
released throttle as 50%, which makes hover a constant correction. Sending absolute axis
positions and applying radio semantics fixes the problem at the source.

**Why a browser page instead of an app?** No APK, no signing, no Play Store, instant updates,
and the same code runs on any Android phone with Chrome. The cost is the browser timer floor
(140–250 Hz rather than a hard 250 Hz) and the need to keep the page in the foreground.

**Why custom physics?** A general-purpose engine would need a lot of tuning to feel like a
quad, and the interesting behavior (thrust curve, motor lag, rate loop, sag, prop wash) is
small enough to own. The module is isolated so it can be ported or replaced.

**Why fixed 1 kHz?** Rate control and contact stability depend on a consistent step. Fixed
steps also make the regression tests deterministic and the feel independent of frame rate.

**Why forgiving collisions?** A sim that ends the run on every clipped prop teaches the
wrong lesson. The contact model separates a bump from a slam, so the pilot can recover from
small mistakes while hard impacts still matter.

## Known gaps

- Air mode / idle-up is not implemented. At zero throttle the motors stop producing thrust
  and attitude control fades; a real quad in air mode keeps authority.
- The rate/PID/camera/trim tuning panel is not in the sim yet; the current parameters are
  compile-time defaults.
- There is no lap timer, split, ghost or session statistics.
- The course and props are static; there is no object interaction beyond the box colliders.
- The Windows scripts are the supported launcher path. Linux/macOS users can run the Node
  server and use `adb reverse` manually.
