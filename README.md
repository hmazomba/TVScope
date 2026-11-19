# TVScope

Experimental toolkit for JVC LT-40NQ5165 (reported Android 14 AOSP). Current focus: browser-first diagnostics and future smart-TV web launcher. **No privileged Android control or launcher replacement implemented.**

## Phase 0 — Browser reconnaissance (current priority)

Run a local Node.js bridge on Windows PC. Open a printed **PC LAN URL** from JVC Chrome. **No TV IP, Android APK, Developer Options, ADB or root required.**

Setup: [phase0/README.md](phase0/README.md)

Quick start from repository root in PowerShell:

    cd phase0
    npm install
    npm test
    npm start

Server prints JVC browser address (e.g. http://192.168.1.10:8080/tv) and local PC dashboard (http://localhost:8080/admin).

Tests include browser/user-agent, screen and viewport hints, storage, remote keys, HTTP/WebSocket round trip, video codec hints, optional local MP4 playback, fullscreen, and EME eligibility. Reports sent only on user request. Tests must run on actual JVC before Phase 0 is accepted.

Cloud test workflow: [Phase 0 Browser Diagnostics](.github/workflows/phase0.yml).

## Android phone diagnostic companion (previous experiment)

The phone APK is a separate, earlier experiment. Features: USB interface listing, basic TCP port probing, LAN candidate discovery, guided USB flash-drive installation check and report sharing. It **does not enable ADB**, install APKs remotely, root TV, or access blocked Developer Options. JVC USB port may be host-only.

Cloud APK workflow: [Build TVScope Installer](.github/workflows/android.yml). Download TVScope-Installer-debug from successful run. Requires an Android phone; not required for browser Phase 0.

## Platform boundaries

- Browser session can observe its own capabilities and interact with PC local bridge.
- Browser cannot fetch TV Ethernet/Wi-Fi MAC, read OS package inventory, enable ADB, silently install packages or change firmware.
- Netflix/DStv/Twitch compatibility is unverified until tested on JVC with official supported services.
- Phase 0 does not create a permanent Android HOME launcher or production-ready remote administration system.

## Roadmap

1. Phase 0: prove JVC browser features, remote keys, network path, media behaviour and export evidence.
2. Phase 1: authenticated local Bridge, session management and secure admin controls.
3. Phase 2: low-memory remote-first web launcher.
4. Phase 3: real-world streaming compatibility.
5. Phase 4: optional authorised native Android adapter if a supported install path exists.

No root, firmware flashing, exploit, security bypass or DRM circumvention.
