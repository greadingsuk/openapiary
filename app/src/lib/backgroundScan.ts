// Background-aware BLE scanning. On Android, BLE callbacks stop firing when the
// app process is suspended (screen off, app backgrounded). The Android-mandated
// fix is a foreground service with a persistent notification - this keeps the
// JS heap alive and BleClient.requestLEScan callbacks keep arriving.
//
// On iOS this module is a no-op: iOS uses CoreBluetooth State Preservation +
// Restoration (different model entirely - implemented separately as region
// monitoring once the Apple Developer account is in place).

import { Capacitor } from "@capacitor/core";
import { ForegroundService } from "@capawesome-team/capacitor-android-foreground-service";

const NOTIFICATION_ID = 1981;
let started = false;

export async function startBackgroundScan(): Promise<void> {
    if (Capacitor.getPlatform() !== "android") return;
    if (started) return;
    try {
        // Android 13+ needs runtime POST_NOTIFICATIONS permission for the persistent notification.
        const perm = await ForegroundService.checkPermissions();
        if (perm.display !== "granted") {
            const req = await ForegroundService.requestPermissions();
            if (req.display !== "granted") {
                console.warn("[bg-scan] notification permission denied; foreground service will fail silently");
            }
        }
        await ForegroundService.startForegroundService({
            id: NOTIFICATION_ID,
            title: "OpenApiary listening for hives",
            body: "Scanning for nearby weight & battery readings.",
            smallIcon: "ic_launcher",
            silent: true,
        });
        started = true;
    } catch (e) {
        console.error("[bg-scan] failed to start foreground service", e);
    }
}

export async function stopBackgroundScan(): Promise<void> {
    if (Capacitor.getPlatform() !== "android") return;
    if (!started) return;
    try {
        await ForegroundService.stopForegroundService();
    } catch (e) {
        console.error("[bg-scan] failed to stop foreground service", e);
    } finally {
        started = false;
    }
}

export function isBackgroundScanActive(): boolean {
    return started;
}
