# Roadmap

FPV Rig is a working local simulator, not a finished product. This page tracks what is done,
what is being tuned, and what comes next.

## Status

| Phase | Scope | Status |
|---|---|---|
| 0 | Skeleton, static server, USB tunnel, latency HUD | Complete |
| 1 | Phone transmitter, throttle hold, arm, failsafe, persisted settings | Complete |
| 2 | Flight model, airfield, cameras, crash and restart | Complete |
| 3 | Feel tuning with a real pilot; air mode; in-sim tuning panel | In progress |
| 4 | Indoor start-to-finish training course, portal progress, ramps | Complete |
| 5 | Visual and performance polish, OSD refinements | In progress |
| 6 | Optional virtual-gamepad bridge for third-party sims | Exploratory |

## Next up

1. **Air mode / idle-up.** Keep a small idle throttle and full attitude authority at zero
   stick. This is the largest remaining behavior gap versus a real 5-inch quad.
2. **In-sim tuning panel.** Rates, PID gains, camera tilt, expo and trim, persisted per
   pilot. The physics parameters are already centralized in `DEFAULT_PARAMS`.
3. **Route and map polish.** Alternate indoor routes, more park street detail and stronger
   start-menu previews for both worlds.
4. **Visual polish.** Near-field asphalt detail, runway and gate scale, distant grass,
   warehouse materials, tyre walls and pallet stacks.
5. **Camera and audio polish.** More tilt range, a cleaner analog mode, RPM/wind audio
   balance and a mute state that survives reloads.

## Current limitations

- Air mode is not implemented.
- No lap timer, ghost or session statistics; the indoor course is a linear, untimed run with
  portal progress.
- No in-sim rates/PID/camera panel.
- The launcher and ADB helper are Windows-specific.
- No multiplayer, cloud hosting or native mobile app.
- The maps and props are static; colliders are boxes and analytic ramp/platform surfaces,
  not triangle meshes.

## Explicit non-goals

- Controlling a real aircraft or flight controller.
- Replacing a full commercial simulator.
- Accounts, telemetry, cloud saves or an online leaderboard.
- Lap timing, splits, ghosts or medals; the indoor map is a training line, not a time trial.
- A mobile-only experience; the laptop renders the world.
- A native phone app or Play Store distribution.

## How to contribute feedback

The useful feedback is qualitative and specific: which maneuver felt wrong, from what
attitude and throttle, and whether the problem was the start of the movement, the rate, or
the stop. Reproducible observations are worth more than a single "feels floaty" rating.
