# iOS background scanning - implementation plan

Status: **stubbed**. The Info.plist declares `UIBackgroundModes = [bluetooth-central, location, fetch]`
and the requisite usage descriptions are in place, so the `@capacitor-community/bluetooth-le`
plugin will keep receiving advertisement callbacks for ~30 minutes after the app is
backgrounded, then iOS will suspend it.

## What's missing for production-grade always-on iOS scanning

iOS does not allow indefinite passive BLE scanning the way Android does. The
official pattern is:

1. **Beacon region monitoring (CoreLocation, not CoreBluetooth).** Register the
   hive's BTHome service UUID (or a 1-byte company-ID variant we emit as an
   iBeacon proximity UUID) as a region. iOS will wake the app for ~10 s when the
   user enters or exits the region - enough to grab one advert per hive per visit.

2. **State Preservation and Restoration** on the CBCentralManager so iOS can
   relaunch the app on a BLE event even if it was force-quit.

Both require a small native Swift plugin. Capacitor's bluetooth-le doesn't
expose `CBCentralManagerOptionRestoreIdentifierKey` or CoreLocation beacon APIs.

## Why we're not doing it yet

- Real-device testing requires the $99/yr Apple Developer account (not yet
  purchased - see `docs/todo-plan.md` §5.x).
- Without a real iPhone in the loop we can't verify the restoration flow
  actually works.
- Region monitoring needs the firmware to broadcast either an iBeacon-formatted
  packet alongside BTHome, or for us to register the BTHome service UUID
  `0000fcd2-0000-1000-8000-00805f9b34fb` as a CBUUID for `scanForPeripherals`
  in the background. The latter works but only delivers cached results, not
  real-time, when the screen is off.

## Path to ship

1. Buy Apple Developer Program seat.
2. Add `iosForegroundBeacon.swift` to `app/ios/App/App/` implementing
   `CLBeaconRegion` registration + `CBCentralManager` with restore identifier.
3. Bridge via a small Capacitor plugin (or use `@capacitor-community/background-geolocation`
   for region triggers and the existing bluetooth-le plugin for the BLE read).
4. Update `app/src/lib/backgroundScan.ts` to dispatch to the new bridge on
   `Capacitor.getPlatform() === 'ios'`.

Until then, iOS users get foreground scanning only. They open the app when they
arrive at the apiary - everything else just works.
