# Changelog

## 0.3.0 — industrial district

- FPV view now keeps the airframe in the shadow pass, so the quad casts a shadow while you
  fly it instead of disappearing from the scene completely.
- Front props sweep through the bottom corners of the FPV view as dark blur, the way a real
  camera sees them, and the lens sits above the prop plane.
- Prop blur discs no longer cast hard circular shadows, and props stop turning when the quad
  is disarmed or crashed.
- The airfield now continues past the gates into an industrial belt built by `industry.ts`:
  two fly-through factory shells with a chimney, silos and a pipe gantry; a cargo yard with
  landable container stacks, a bunded fuel farm, pump house and water tower; a downed
  airliner across the apron; a gabled hangar with a wrecked aircraft, a glazed control tower
  and a windsock; and a walled annex south of the park with a second shed, a flat workshop
  roof and a conveyor bridge.
- Those districts are merged into one geometry per material, so the whole belt costs about
  60 extra draw calls instead of the hundreds that separate meshes would have added.

## 0.2.0 — desktop package

- Added a native Windows launcher that starts the bundled server, picks a free loopback
  port, detects the phone, runs `adb reverse`, opens the transmitter page and launches
  Chrome/Edge in app mode.
- Added status, activity log, phone setup, diagnostics export, tray behaviour and automatic
  log rotation.
- Added a per-user one-click installer with Start Menu/desktop shortcuts, Apps & features
  registration and an uninstaller.
- Added a portable ZIP that bundles Node, ADB, the server and the simulator assets.
- Added automatic Android platform-tools download for clean builds, and a Windows GitHub
  Actions packaging workflow.
- Added `docs/DESKTOP.md` with deployment, troubleshooting and release checklists.
- Added the synthesised onboard audio engine from the previous milestone.

## 0.1.0

- Initial offline FPV simulator with phone-as-transmitter over USB, airfield + park and the
  indoor tesseract course.
