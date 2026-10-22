# Changelog

## Unreleased

- FPV view now keeps the airframe in the shadow pass, so the quad casts a shadow while you
  fly it instead of disappearing from the scene completely.
- Front props sweep through the bottom corners of the FPV view as dark blur, the way a real
  camera sees them, and the lens sits above the prop plane.
- Prop blur discs no longer cast hard circular shadows, and props stop turning when the quad
  is disarmed or crashed.

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
