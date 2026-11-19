# TVScope Phase 0 — JVC browser reconnaissance

## Objective

Verify actual JVC browser capabilities and PC↔TV communication before building launcher or privileged TV management. TV IP address, Android APK, Developer Options, USB ADB and root are **not required**.

## Windows PC setup

1. Install Node.js LTS if necessary (Node 22+). Verify with PowerShell:
   
       node --version
       npm --version

2. Clone or download repository on PC, navigate to repository root, then:

       cd phase0
       npm install
       npm test
       npm start

3. Server prints PC LAN addresses, example: http://192.168.1.10:8080/tv . This is **PC IP**, not TV IP.
4. Enter printed PC address in JVC Chrome.
5. Open PC-only diagnostics dashboard: http://localhost:8080/admin .

If JVC fails to connect: verify shared LAN, no Wi-Fi guest/client isolation, correct PC IP, and Windows Defender Firewall inbound TCP 8080 on *Private* network. Never port-forward this service.

## On-TV test sequence

1. Press **Run capability tests**. Tests browser UA, viewport, local/session storage, codec hints, HTTP latency, WebSocket echo and DRM API eligibility.
2. Press **Test fullscreen**. Observe behaviour on physical TV.
3. Focus remote-key capture box. Press Up, Down, Left, Right, OK, Back, Home and any relevant media keys. Back/Home may be swallowed by TV OS.
4. Optional: copy a short, unprotected, rights-cleared H.264/AAC MP4 to phase0/media/test.mp4 on PC. Press **Load local test video** on TV. Confirm picture, audio and seeking manually. Test file not included.
5. Press **Refresh report preview**; review JSON. Select **Send report to PC** after review.
6. On PC dashboard press **Refresh** and **Export JSON**. Keep results for architecture decision.

## Result interpretation

- HTTP/WebSocket success means local communication works, not Android OS control.
- Webpage loading is not system launcher replacement.
- Codec hints and MSE support do not prove actual video playback.
- DRM on HTTP may be blocked by insecure context. Mark **not testable**, not unsupported.
- Only remote key events actually delivered to JS can support browser navigation.
- Observed client IP is not MAC address. Browser cannot supply Ethernet/Wi-Fi MAC.
- PC stores up to 30 reports in process memory. Restart clears; export to retain.

## Security limits

Phase 0 is an **unauthenticated diagnostic proof of concept**, not production management service. Use on trusted private LAN. No remote control or privileged actions. No account credentials, cookies, passwords or system-private data collected. Admin report routes restricted to loopback requests. Report submission requires same origin and max 32 KiB. Host validation permits only PC interface addresses and loopback. No root, APK installation, firmware changes or ADB.

## Automated validation

From phase0:

    npm install
    npm test

GitHub Actions workflow: .github/workflows/phase0.yml

Tests cover server pages, CSP, Host validation, opt-in reports, size cap, WebSocket echo, MP4 range responses and clearing reports.

## Phase 0 exit criteria

- JVC browser opens PC-hosted /tv.
- HTTP and WebSocket outcomes recorded.
- Remote key events captured on real JVC.
- Media codec hints collected and real video tested when sample available.
- Report successfully appears on PC and is exported.
- DRM secure-context blockers distinguished from unsupported capabilities.

**Do not claim physical-device validation until tests run on JVC.**
