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

void setup() {
    // Snapshot + clear the reset reason BEFORE anything else touches it.
    // Bits: 0=RESETPIN, 1=DOG (watchdog), 2=SREQ (soft), 3=LOCKUP, 16=OFF (wake from System OFF),
    //       17=LPCOMP, 18=DIF (debug), 19=NFC, 20=VBUS. Brown-out resets show up as 0 (POR).
    g_resetReason = NRF_POWER->RESETREAS;
    NRF_POWER->RESETREAS = 0xFFFFFFFF;

    // 1. If USB is plugged in at boot, drop into the calibration CLI and stay there.
    if (vbusPresent()) {
        enterCalibrationMode();   // never returns
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
    OAConfig::begin(&g_state);
    runPairingWindow();
}

// Advertise connectably (with the Config service) for PAIRING_WINDOW_MS so the
// phone can connect to rename / set the time. Persists any change it received.
static void runPairingWindow() {
    char name[17];
    resolveLocalName(name, sizeof(name));
    Bluefruit.setName(name);

    Bluefruit.Advertising.stop();
    Bluefruit.Advertising.clearData();
    Bluefruit.ScanResponse.clearData();
    Bluefruit.Advertising.addFlags(BLE_GAP_ADV_FLAGS_LE_ONLY_GENERAL_DISC_MODE);
    Bluefruit.Advertising.addService(OAConfig::service());
    Bluefruit.ScanResponse.addName();
    Bluefruit.Advertising.restartOnDisconnect(true);
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
        (int)(g_state.bootCount & 0xFFFF)
    );

    // 4. Advertise for 300 ms
    // Friendly name (custom or "OA-XXXX") must be set BEFORE addName().
    char name[17];
    resolveLocalName(name, sizeof(name));
    Bluefruit.setName(name);

    Bluefruit.Advertising.clearData();
    Bluefruit.Advertising.addFlags(BLE_GAP_ADV_FLAGS_LE_ONLY_GENERAL_DISC_MODE);
    Bluefruit.Advertising.addData(BLE_GAP_AD_TYPE_SERVICE_DATA,
                                  svcData, (uint8_t)(2 + payloadLen));
    Bluefruit.ScanResponse.addName();
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
