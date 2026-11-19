# TVScope

Android phone diagnostics for JVC LT-40NQ5165 (Android 14 AOSP).

## Status
Phase 1 starter. Real USB interface enumeration and TCP port connectivity probe. **No ADB authentication, device pairing, APK installation, TV launcher, or physical-device validation yet.** A reachable TCP port does not prove ADB.

## Cloud build — no local SDK
Open [GitHub Actions](https://github.com/hmazomba/TVScope/actions/workflows/android.yml). Select latest successful run, download `TVScope-Installer-debug` artifact, unzip and install `app-debug.apk` on phone.

If workflow fails, inspect job logs. Builds are not considered successful until CI reports success.

## Phone installation
Transfer `app-debug.apk` to Android phone, open it in Files, and permit installation from that source. Or, on PC with platform-tools only (not Android Studio), run `adb install -r app-debug.apk`.

## Tests
- USB: connect OTG adapter and inspect device interfaces. ADB candidate interface: class 255, subclass 66, protocol 1.
- Network: enter TV IP and TCP port, test reachability. Connection alone is not ADB authentication.

## Next
Implement authenticated USB and TCP ADB transport, safe install checks, and exportable diagnostics. Never bypass JVC security or modify firmware.
