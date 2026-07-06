// OpenApiary firmware — main entry
// Target: Seeed XIAO nRF52840 (Standard, NOT Sense)
// Design: see docs/todo-plan.md and the original migration plan §4.
//
// Wake cycle (every 30 s during app dev; will move to adaptive 1-min day / 5-min night):
//   sleep (FreeRTOS idle + WFE) -> HX711 read -> battery read -> BLE advert burst -> sleep
//
// Power model note:
//   On the Adafruit nRF52 Arduino core, delay() yields to FreeRTOS which puts
//   the idle task into __WFE — i.e. it IS the low-power sleep on this stack.
//   With SoftDevice + DCDC enabled we measure ~2-5 µA between wakes.
//
//   True System OFF (~0.4 µA) is NOT used because System OFF on the nRF52840
//   cannot be woken by the RTC; only RESET / NFC / GPIO sense / LPCOMP can.
//   Switching to System OFF would require teardown + re-init of SoftDevice on
//   every wake and would push the average current UP, not down.

#include <Arduino.h>
#include <bluefruit.h>
#include <nrf_soc.h>
#include "hx711_helper.h"
#include "bthome.h"
#include "persist.h"
#include "gatt_config.h"
#include "version.h"

// Buttonless OTA DFU — lets the phone push firmware over BLE during the pairing
// window. The Adafruit bootloader handles the actual Secure DFU after reboot.
static BLEDfu bledfu;

// Provided by cal_mode.cpp
extern void enterCalibrationMode();

// ---- Pinout (see §4.2) ----
static const uint8_t PIN_HX711_DT  = D2;   // P0.04
static const uint8_t PIN_HX711_SCK = D3;   // P0.05
static const uint8_t PIN_VBAT_EN   = 14;   // P0.14 - drive LOW to enable divider
// PIN_VBAT (P0.31) is provided by the Adafruit core as PIN_VBAT

// ---- Timing ----
// Adaptive cadence (docs/todo-plan.md §3a): 1-min during daylight, 5-min at
// night to conserve battery. Falls back to 1-min until the app seeds the time.
static const uint32_t WAKE_DAY_MS   = 60UL * 1000UL;            // 06:00-22:00 local
static const uint32_t WAKE_NIGHT_MS = 5UL * 60UL * 1000UL;      // 22:00-06:00 local
static const uint32_t PAIRING_WINDOW_MS = 60UL * 1000UL;        // connectable window after boot
static const uint16_t ADVERT_DURATION_MS = 300;                  // 3 packets across ch 37/38/39
static const uint8_t  PERSIST_EVERY_N_CYCLES = 16;               // limit flash wear

// ---- Power-on gate (hysteresis-based shutdown) ----
// If BAT voltage is below this threshold at boot, device stays dormant and allows
// solar to charge the battery. Once voltage recovers above RECOVERY_THRESHOLD,
// the device will boot on next power cycle. Supports both "switch OFF" and "battery flat" scenarios.
// Tuned to be less aggressive in the field: gate only near low-voltage knee,
// then resume once safely above it.
static const float BAT_SHUTDOWN_THRESHOLD_V = 3.0f;    // near low-voltage knee
static const float BAT_RECOVERY_THRESHOLD_V = 3.3f;    // modest hysteresis above shutdown

// ---- Runtime state (loaded from /cal.txt at boot) ----
static OAPersist::State g_state = { -26913.0f, 0, 0, 0, "", 0 };
static uint32_t g_resetReason = 0;   // captured at boot, cleared from NRF_POWER->RESETREAS

// Returns the wake interval for the current local time (day vs night).
static uint32_t nextWakeIntervalMs() {
    int h = OAConfig::localHour();
    if (h < 0) return WAKE_DAY_MS;            // time unknown → assume daytime
    return (h >= 6 && h < 22) ? WAKE_DAY_MS : WAKE_NIGHT_MS;
}

// Resolve the BLE local name: persisted friendly name if set, else OA-XXXX.
static void resolveLocalName(char* out, size_t cap) {
    if (g_state.name[0] != '\0') {
        strncpy(out, g_state.name, cap - 1);
        out[cap - 1] = '\0';
    } else {
        bthome_local_name(out, cap);
    }
}

// Forward decls
float readBatteryVoltage();
static bool vbusPresent();
static float readDieTempC();
static int   batteryPctFromVoltage(float v);
static void  runPairingWindow();

// ---- Early boot functions (before SoftDevice or BLE init) ----

// Read battery voltage early in setup() — does NOT require SoftDevice.
// Same logic as readBatteryVoltage() but can be called very early.
static float readBatteryVoltageEarly() {
    pinMode(PIN_VBAT_EN, OUTPUT);
    digitalWrite(PIN_VBAT_EN, LOW);  // enable divider
    delay(5);
    analogReference(AR_INTERNAL_3_0);
    analogReadResolution(12);
    (void)analogRead(PIN_VBAT);        // discard first sample
    uint32_t acc = 0;
    for (int i = 0; i < 8; i++) {
        acc += analogRead(PIN_VBAT);
        delay(1);
    }
    digitalWrite(PIN_VBAT_EN, HIGH);   // disable divider
    pinMode(PIN_VBAT_EN, INPUT);
    float adc = acc / 8.0f;
    return adc * (3.0f / 4095.0f) * (2020.0f / 510.0f);
}

// Device is stuck below BAT_SHUTDOWN_THRESHOLD_V — enter minimal dormancy.
// SoftDevice is NOT yet initialized, so we just loop on ADC reads.
// Solar will charge the battery in the background; a brownout reset or power cycle
// will restart the device, which will then pass the gate check and proceed normally.
static void enterBatteryDormancy() {
    // Disable everything unnecessary to minimize current drain
    digitalWrite(PIN_HX711_SCK, HIGH);  // put HX711 to sleep (SCK stays high)
    pinMode(PIN_HX711_DT, INPUT);
    pinMode(PIN_HX711_SCK, INPUT);
    
    // Loop: check battery voltage every 30 seconds
    // If it recovers to RECOVERY_THRESHOLD, the device is ready for a power cycle to boot.
    // Brownout or watchdog reset will also trigger a retry.
    while (true) {
        delay(30000);  // sleep 30 sec (FreeRTOS idle → __WFE, ~2-5 µA)
        
        float vbat = readBatteryVoltageEarly();
        if (vbat >= BAT_RECOVERY_THRESHOLD_V) {
            // Battery has recovered. Reboot via watchdog or let the next power cycle proceed.
            // For now, just exit the loop so setup() can continue (simulating a reboot).
            return;
        }
        // else: still too low, loop again
    }
}


void setup() {
    // Snapshot + clear the reset reason BEFORE anything else touches it.
    // Bits: 0=RESETPIN, 1=DOG (watchdog), 2=SREQ (soft), 3=LOCKUP, 16=OFF (wake from System OFF),
    //       17=LPCOMP, 18=DIF (debug), 19=NFC, 20=VBUS. Brown-out resets show up as 0 (POR).
    g_resetReason = NRF_POWER->RESETREAS;
    NRF_POWER->RESETREAS = 0xFFFFFFFF;

    // ---- BOOT GATE: Battery voltage check ----
    // If BAT voltage is below threshold, enter dormancy and allow solar to charge.
    // This handles both "switch OFF" (BAT isolated) and "battery flat" scenarios.
    float vbat_init = readBatteryVoltageEarly();
    if (vbat_init < BAT_SHUTDOWN_THRESHOLD_V) {
        // Battery is too low. Stay dormant and let solar charge it.
        // Periodic checks every 30 sec; once it reaches RECOVERY_THRESHOLD, 
        // a power cycle or watchdog reset will retry boot.
        enterBatteryDormancy();
        // (if enterBatteryDormancy returns, battery has recovered; continue below)
    }

    // 1. VBUS reads high for BOTH a real USB host (bench calibration) AND for
    //    solar/charger power in the field. Only a USB *host* enumerates the
    //    device, so wait briefly for a USB mount:
    //      * mounted   -> a computer is attached  -> calibration CLI (never returns)
    //      * not mounted -> solar/charger power    -> fall through to normal operation
    //    Without this gate a daylight reboot (e.g. to start an OTA update) would
    //    get stuck in cal mode forever, because enterCalibrationMode() blocks in
    //    its serial-CLI loop and never opens the pairing window.
    if (vbusPresent()) {
        uint32_t t0 = millis();
        while (!TinyUSBDevice.mounted() && (millis() - t0) < 2500) delay(50);
        if (TinyUSBDevice.mounted()) {
            enterCalibrationMode();   // never returns
        }
        // else: solar / dumb-charger power — continue to normal setup below.
    }

    // 2. SoftDevice + BLE
    Bluefruit.begin();
    Bluefruit.setTxPower(0);  // 0 dBm; bump to +4 if range poor

    // 3. Enable DCDC regulator — drops idle current from ~5 µA to ~2.5 µA.
    sd_power_dcdc_mode_set(NRF_POWER_DCDC_ENABLE);

    // 4. Load persisted cal/tare/packetId/bootCount/name/tz and bump bootCount.
    OAPersist::begin();
    OAPersist::load(g_state);
    g_state.bootCount++;
    OAPersist::save(g_state);   // always save on boot so we never lose the count

    hx711_begin(PIN_HX711_DT, PIN_HX711_SCK, g_state.calFactor, g_state.tareOffset);

    // 5. Register the Config GATT service and run a short connectable pairing
    //    window so the app can set the name + seed the clock. After it closes,
    //    loop() resumes the low-power advert-only behaviour.
    bledfu.begin();              // OTA DFU available while connectable
    OAConfig::begin(&g_state);
    runPairingWindow();
}

// Advertise connectably (with the Config service) for PAIRING_WINDOW_MS so the
// phone can connect to rename / set the time. Persists any change it received.
static void runPairingWindow() {
    char name[17];
    resolveLocalName(name, sizeof(name));
    Bluefruit.setName(name);

    // Include a normal BTHome payload during the pairing window so discovery
    // works the same way as the steady-state advert path. Without this the app
    // can't see a freshly-booted scale because it filters for the BTHome UUID.
    float weightKg = hx711_read_median(5);
    hx711_sleep();
    float batteryV   = readBatteryVoltage();
    int   batteryPct = batteryPctFromVoltage(batteryV);
    float dieTempC   = readDieTempC();
    bool  charging   = vbusPresent();

    g_state.packetId++;
    uint8_t svcData[2 + 24];
    svcData[0] = (uint8_t)(BTHOME_SERVICE_UUID_16 & 0xFF);
    svcData[1] = (uint8_t)(BTHOME_SERVICE_UUID_16 >> 8);
    size_t payloadLen = bthome_build_payload(
        svcData + 2, sizeof(svcData) - 2,
        (uint8_t)(g_state.packetId & 0xFF),
        weightKg,
        batteryV,
        dieTempC,
        batteryPct,
        charging ? 1 : 0,
        (int)(g_state.bootCount & 0xFFFF),
        OA_FW_MAJOR, OA_FW_MINOR, OA_FW_PATCH
    );

    Bluefruit.Advertising.stop();
    Bluefruit.Advertising.clearData();
    Bluefruit.ScanResponse.clearData();
    Bluefruit.Advertising.addFlags(BLE_GAP_ADV_FLAGS_LE_ONLY_GENERAL_DISC_MODE);
    Bluefruit.Advertising.addData(BLE_GAP_AD_TYPE_SERVICE_DATA,
                                  svcData, (uint8_t)(2 + payloadLen));
    Bluefruit.Advertising.addService(OAConfig::service());
    Bluefruit.ScanResponse.addName();
    Bluefruit.Advertising.restartOnDisconnect(true);
    // The only window the scale is connectable (rename / set time / trigger OTA
    // DFU). loop() switches back to non-connectable for the low-power broadcast.
    Bluefruit.Advertising.setType(BLE_GAP_ADV_TYPE_CONNECTABLE_SCANNABLE_UNDIRECTED);
    Bluefruit.Advertising.setInterval(32, 244);   // 20 ms fast / 152.5 ms slow
    Bluefruit.Advertising.setFastTimeout(30);
    Bluefruit.Advertising.start(0);               // we time the window ourselves

    uint32_t end = millis() + PAIRING_WINDOW_MS;
    while ((int32_t)(end - millis()) > 0) {
        delay(100);
        if (OAConfig::takeDirty()) {
            OAPersist::save(g_state);             // flush name / tz as soon as written
            // A new name should take effect immediately on the next advert.
            resolveLocalName(name, sizeof(name));
            Bluefruit.setName(name);
        }
    }

    Bluefruit.Advertising.stop();
    if (Bluefruit.connected()) {
        Bluefruit.disconnect(Bluefruit.connHandle());
    }
    Bluefruit.Advertising.restartOnDisconnect(false);
}

void loop() {
    static uint16_t cycleCount = 0;

    // 1. Wake HX711 and read
    float weightKg = hx711_read_median(10);
    uint16_t spread_g = hx711_last_spread_g();   // diagnostic; pack later if needed
    hx711_sleep();
    (void)spread_g;

    // 2. Read battery (averaged ADC, see §4.2) + derived telemetry
    float batteryV   = readBatteryVoltage();
    int   batteryPct = batteryPctFromVoltage(batteryV);
    float dieTempC   = readDieTempC();
    bool  charging   = vbusPresent();   // true while USB / solar regulator delivers 5V

    // 3. Build BTHome v2 service-data payload
    // Service-data AD type (0x16) must start with the 16-bit UUID in little-endian,
    // followed by the BTHome payload bytes.
    g_state.packetId++;                       // wraps the 8-bit advert field at the cast below
    uint8_t svcData[2 + 24];
    svcData[0] = (uint8_t)(BTHOME_SERVICE_UUID_16 & 0xFF);
    svcData[1] = (uint8_t)(BTHOME_SERVICE_UUID_16 >> 8);
    size_t payloadLen = bthome_build_payload(
        svcData + 2, sizeof(svcData) - 2,
        (uint8_t)(g_state.packetId & 0xFF),
        weightKg,
        batteryV,
        dieTempC,
        batteryPct,
        charging ? 1 : 0,
        (int)(g_state.bootCount & 0xFFFF),
        OA_FW_MAJOR, OA_FW_MINOR, OA_FW_PATCH   // 0xF2 firmware version for the app to read passively
    );

    // 4. Advertise for 300 ms
    // Friendly name (custom or "OA-XXXX") must be set BEFORE addName().
    char name[17];
    resolveLocalName(name, sizeof(name));
    Bluefruit.setName(name);

    Bluefruit.Advertising.clearData();
    Bluefruit.ScanResponse.clearData();   // else addName() appends a fresh copy every cycle until the buffer overflows
    Bluefruit.Advertising.addFlags(BLE_GAP_ADV_FLAGS_LE_ONLY_GENERAL_DISC_MODE);
    Bluefruit.Advertising.addData(BLE_GAP_AD_TYPE_SERVICE_DATA,
                                  svcData, (uint8_t)(2 + payloadLen));
    Bluefruit.ScanResponse.addName();
    // Broadcast-only: the scale accepts connections ONLY during the post-boot
    // pairing window, never mid-cycle. Non-connectable drops the per-advert RX
    // window that listens for connection requests (less radio-on time) and
    // removes the between-window attack surface. Scannable keeps the name in the
    // scan response so the app can still identify the device.
    Bluefruit.Advertising.setType(BLE_GAP_ADV_TYPE_NONCONNECTABLE_SCANNABLE_UNDIRECTED);
    Bluefruit.Advertising.setInterval(160, 160);  // 100 ms (non-conn legacy min) -> ~3 events across the burst
    Bluefruit.Advertising.start(0);
    delay(ADVERT_DURATION_MS);
    Bluefruit.Advertising.stop();

    // 5. Persist packet counter every N cycles to limit flash wear
    if (++cycleCount >= PERSIST_EVERY_N_CYCLES) {
        OAPersist::save(g_state);
        cycleCount = 0;
    }

    // 6. Sleep until next cycle (FreeRTOS idle -> __WFE; see header comment).
    //    Interval adapts to local time of day once the app has seeded the clock.
    delay(nextWakeIntervalMs());
}

float readBatteryVoltage() {
    pinMode(PIN_VBAT_EN, OUTPUT);
    digitalWrite(PIN_VBAT_EN, LOW);  // enable divider
    delay(5);
    analogReference(AR_INTERNAL_3_0);  // explicit ref — SAADC needs it under SoftDevice
    analogReadResolution(12);
    (void)analogRead(PIN_VBAT);        // discard first sample (SAADC settle)
    uint32_t acc = 0;
    for (int i = 0; i < 8; i++) {
        acc += analogRead(PIN_VBAT);
        delay(1);
    }
    digitalWrite(PIN_VBAT_EN, HIGH); // disable divider to save current
    pinMode(PIN_VBAT_EN, INPUT);
    float adc = acc / 8.0f;
    // 12-bit ADC, 3.0 V ref, divider 1510k/510k -> Vbat = adc * 3.0 / 4095 * (1510+510)/510
    return adc * (3.0f / 4095.0f) * (2020.0f / 510.0f);
}

// nRF52840 USB regulator status — VBUSDETECT bit reads 1 when 5V is applied to USB.
// Safe to call before USBDevice is initialised. Also reads true when the solar charger
// is delivering power through the same regulator path on a TP4056-style front-end.
static bool vbusPresent() {
    return (NRF_POWER->USBREGSTATUS & POWER_USBREGSTATUS_VBUSDETECT_Msk) != 0;
}

// Read the nRF52840's on-die temperature sensor via SoftDevice.
// Direct register access (NRF_TEMP->TASKS_START / EVENTS_DATARDY) hangs forever
// when SoftDevice is running because the radio owns the TEMP peripheral.
// sd_temp_get() returns the same raw 0.25°C-step value.
static float readDieTempC() {
    int32_t raw = 0;
    if (sd_temp_get(&raw) != NRF_SUCCESS) return 0.0f;
    return raw * 0.25f;
}

// Map LiPo voltage to a rough state-of-charge percentage.
// Piecewise-linear approximation of a typical 1S LiPo discharge curve under light load.
// 4.20V = 100 %, 3.90V ≈ 60 %, 3.70V ≈ 25 %, 3.30V = 0 %.
static int batteryPctFromVoltage(float v) {
    if (v >= 4.20f) return 100;
    if (v >= 3.90f) return (int)(60 + (v - 3.90f) * (40.0f / 0.30f));
    if (v >= 3.70f) return (int)(25 + (v - 3.70f) * (35.0f / 0.20f));
    if (v >= 3.30f) return (int)( 0 + (v - 3.30f) * (25.0f / 0.40f));
    return 0;
}
