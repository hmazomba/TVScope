# TVScope

Experimental toolkit for JVC LT-40NQ5165 (reported Android 14 AOSP). Current focus: browser-first diagnostics and future smart-TV web launcher. **No privileged Android control or launcher replacement implemented.**

## Phase 0 — Browser reconnaissance (completed initial hardware pass)

Run a local Node.js bridge on Windows PC. Open a printed **PC LAN URL** from JVC Chrome. **No TV IP, Android APK, Developer Options, ADB or root required.**

Setup: [phase0/README.md](phase0/README.md)

Quick start from repository root in PowerShell:

    cd phase0
    npm install
    npm test
    npm start

Server prints JVC browser address (e.g. http://192.168.1.10:8080/tv) and local PC dashboard (http://localhost:8080/admin).

Tests include browser/user-agent, screen and viewport hints, storage, remote keys, HTTP/WebSocket round trip, video codec hints, optional local MP4 playback, fullscreen, and EME eligibility. Reports sent only on user request. Physical JVC report confirmed HTTP, WebSocket, fullscreen and storage; remote keys and real media playback remain unresolved.

Cloud test workflow: [Phase 0 Browser Diagnostics](.github/workflows/phase0.yml).

## Phase 1 — Authenticated HTTPS Bridge (implemented; JVC TLS unverified)

Secure browser-first device session management, PC-local administration, six-digit on-TV pairing, scoped WSS communication, remote test message, diagnostics, and revocation. See [bridge/README.md](bridge/README.md).

**Certificate requirement:** JVC must trust HTTPS certificate; PC trust alone insufficient. Do not bypass certificate warnings. Phase 1 may remain blocked until supported trust path established. CI covers TLS and pairing on test hosts, not physical TV.

## Android phone diagnostic companion (previous experiment)

The phone APK is a separate, earlier experiment. Features: USB interface listing, basic TCP port probing, LAN candidate discovery, guided USB flash-drive installation check and report sharing. It **does not enable ADB**, install APKs remotely, root TV, or access blocked Developer Options. JVC USB port may be host-only.

Cloud APK workflow: [Build TVScope Installer](.github/workflows/android.yml). Download TVScope-Installer-debug from successful run. Requires an Android phone; not required for browser Phase 0.

## Platform boundaries

- Browser session can observe its own capabilities and interact with PC local bridge.
- Browser cannot fetch TV Ethernet/Wi-Fi MAC, read OS package inventory, enable ADB, silently install packages or change firmware.
- Netflix/DStv/Twitch compatibility is unverified until tested on JVC with official supported services.
- Phase 0 does not create a permanent Android HOME launcher or production-ready remote administration system.

## Roadmap

1. Phase 0: prove JVC browser features and network path; remote/media gates remain.
2. Phase 1: HTTPS local Bridge, session management, secure admin controls; require JVC TLS validation.
3. Phase 2: low-memory remote-first web launcher.
4. Phase 3: real-world streaming compatibility.
5. Phase 4: optional authorised native Android adapter if a supported install path exists.

No root, firmware flashing, exploit, security bypass or DRM circumvention.
