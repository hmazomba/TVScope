# TVScope Phase 1 — Authenticated HTTPS Bridge

## Goal
Manage TVScope browser sessions, not Android OS. Builds on Phase 0 JVC evidence: browser-to-PC HTTP and WebSocket worked; storage and fullscreen worked. Remote keys, actual video playback, DRM unverified.

Phase 1 provides HTTPS-only TLS 1.2+, six-digit on-TV pairing with PC-local approval, expiring codes, persistent hashed device credentials, scoped WSS messaging, reconnect, PC-local admin, revoke, diagnostic report storage/export, Origin/Host/CSRF checks, rate limits, bounded report retention.

No native Android control, package installation, root or firmware operations.

## Essential prerequisite: trusted HTTPS on TV

**Never bypass certificate warnings or disable TLS verification.** Phase 0 validated HTTP, not HTTPS. TV browser must trust Bridge certificate and match its SAN hostname/IP.

Options:
1. Domain you control, publicly trusted certificate obtained via DNS validation, local DNS mapping domain to PC LAN IP. Do not publicly expose service or forward port.
2. Locally issued certificate (e.g. mkcert) only when TV has manufacturer-supported CA import and explicitly trusts it. Installing CA on Windows does NOT install it on TV.

Certificate must cover PC admin host (localhost or trusted alternate) and TV LAN hostname/IP. If JVC cannot trust certificate, Phase 1 pairing on TV remains blocked. Continue Phase 0; do not downgrade security.

## PC setup (Windows PowerShell)

Install Node.js LTS 22+ and clone repo. Open repository root:

    cd bridge
    npm install
    npm run check
    npm test

Set certificate/key (from trusted certificate provisioning; private key outside repo), password and start:

    $env:TVSCOPE_TLS_CERT="C:\TVScope\certs\bridge-cert.pem"
    $env:TVSCOPE_TLS_KEY="C:\TVScope\certs\bridge-key.pem"
    $env:TVSCOPE_ADMIN_PASSWORD="replace-with-long-unique-private-passphrase"
    $env:TVSCOPE_PORT="8443"
    npm start

Optional environment:
- TVSCOPE_BIND defaults 0.0.0.0. Restrict inbound TCP 8443 using Windows Firewall Private network scope. Never port-forward.
- TVSCOPE_HOSTS optional comma-separated approved DNS hostname list for Host validation (e.g. tvscope.yourdomain.example). Built-in allowed list includes local interface IPs and localhost.
- TVSCOPE_DATA_DIR defaults bridge/.data, stores token hashes and reports. Configure proper Windows ACL restrictions; chmod-style mode alone insufficient on Windows.
- TVSCOPE_PORT defaults 8443.

## PC admin

Open https://localhost:8443/admin with trusted certificate for localhost. Sign in with TVSCOPE_ADMIN_PASSWORD. Admin site and admin APIs only accessible from PC loopback connections. Session expires after four hours.

Select pending request, enter six-digit code visible on TV, and approve. Never approve unknown request. Send harmless test message; inspect devices, diagnostics, audit summary, revoke credentials when necessary.

## TV

In JVC Chrome open https://TRUSTED-PC-HOST:8443/tv . Use PC hostname or IP printed by Bridge **only when corresponding TLS certificate trusted on JVC**.

1. Create pairing code on TV.
2. On PC admin, select pending session and enter exact code (expires in five minutes).
3. TV polls, claims one-time credential and establishes authorised WSS.
4. Collect browser diagnostics; focus remote key box; capture keys.
5. Preview/send report explicitly. Export reports from PC.
6. Test WSS ping and PC-to-TV notice. Reload browser to validate reconnect.
7. Revoke from PC and confirm session no longer authenticates.

No TV IP entry required; TV initiates connection. No installed TV APK required.

## Validation

From bridge directory:

    npm install
    npm run check
    npm test

GitHub Actions workflow: .github/workflows/phase1.yml .

CI tests trusted TLS, Host protection, Origin/CSRF, loopback admin, admin auth, pairing code, single claim, persistent hashed token, diagnostics permissions, WSS auth/echo/notice/revoke, required TLS configuration. CI does not validate JVC certificate trust.

## Limitations and threat model

- TVScope browser management only. No Android OS permissions or launcher replacement.
- Browser stores scoped credential in localStorage/sessionStorage. Load no third-party scripts into Bridge origin; stronger production hardening can migrate to HttpOnly cookie with adequate CSRF/WS protections.
- Diagnostic data may fingerprint device. Reports stored locally up to 60 entries. Exports user-controlled.
- Pending pairing requests and PC admin sessions reset when server restarts; paired device credentials persist hashed.
- HTTP Phase 0 and HTTPS Phase 1 separate systems. Do not assume insecure HTTP is equivalent to secure management.
- No public internet exposure, no credential harvesting, no stream proxying, no DRM circumvention.
- Third-party streaming playback and hardware remote interoperability need actual JVC validation.

## Exit criteria

Automated tests pass; trusted JVC HTTPS/WSS works without bypass; TV can pair using physical code; PC notice reaches TV; TV diagnostics stored and exported; browser reload reconnects; revocation blocks old credential; remote key compatibility measured before building Phase 2 launcher.
