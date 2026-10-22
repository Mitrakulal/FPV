# Changelog

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
