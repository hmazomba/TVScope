# TVScope

Android phone diagnostics for JVC LT-40NQ5165 (Android 14 AOSP).

## Status
Phase 1 JVC fallback diagnostics implemented. USB interface enumeration; network TCP probes; guided USB-flash-drive APK installation; report sharing. **No ADB authentication, pairing, remote APK installation, TV launcher, or physical-device validation yet.** A reachable TCP port does not prove ADB.

## Cloud build — no local SDK
Open [GitHub Actions](https://github.com/hmazomba/TVScope/actions/workflows/android.yml). Select latest successful run, download `TVScope-Installer-debug` artifact, unzip and install `app-debug.apk` on phone.

## Phone installation
Transfer `app-debug.apk` to Android phone, open in Files, and permit installation from that source. Or, on PC with platform-tools only, run `adb install -r app-debug.apk`.

## Fallback diagnostics
- **USB:** connect phone using USB OTG; inspect detected interfaces. ADB candidate interface: class 255, subclass 66, protocol 1. TV USB ports may be host-only. Do not connect two USB hosts using an unsafe cable.
- **Network:** enter TV IP on same LAN; probe custom TCP port plus 5555, 37099, 37100. Open ports do not prove ADB or authorization. Wireless-debugging ports are not fixed.
- **USB APK guide:** copy trusted TV-compatible APK to FAT32 flash drive, insert into TV, open TV file manager, select APK, follow Android installer permissions if available. Some TV media browsers cannot install APKs. Never assume TV permits unknown-source installation.
- **Report:** share diagnostic results through Android share sheet.

## Security limitations
No root, exploit, firmware flashing, silent install, or bypass of disabled Developer Options. Phone settings cannot enable TV debugging.

## Next
Implement authenticated USB/TCP ADB transport when TV supports and authorizes it; validate on real devices.
