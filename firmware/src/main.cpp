// OpenApiary firmware — main entry
// Target: Seeed XIAO nRF52840 (Standard, NOT Sense)
// Design: see docs/todo-plan.md and the original migration plan §4.
//
// Wake cycle (every 15 min):
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

// Provided by cal_mode.cpp
extern void enterCalibrationMode();

// ---- Pinout (see §4.2) ----
static const uint8_t PIN_HX711_DT  = D2;   // P0.04
static const uint8_t PIN_HX711_SCK = D3;   // P0.05
static const uint8_t PIN_VBAT_EN   = 14;   // P0.14 - drive LOW to enable divider
// PIN_VBAT (P0.31) is provided by the Adafruit core as PIN_VBAT

// ---- Timing ----
static const uint32_t WAKE_INTERVAL_MS = 15UL * 60UL * 1000UL;  // 15 minutes
static const uint16_t ADVERT_DURATION_MS = 300;                  // 3 packets across ch 37/38/39
static const uint8_t  PERSIST_EVERY_N_CYCLES = 16;               // limit flash wear

// ---- Runtime state (loaded from /cal.txt at boot) ----
static OAPersist::State g_state = { -26913.0f, 0, 0 };

// Forward decls
float readBatteryVoltage();
static bool vbusPresent();

void setup() {
    // 1. If USB is plugged in at boot, drop into the calibration CLI and stay there.
    if (vbusPresent()) {
        enterCalibrationMode();   // never returns
    }

    // 2. SoftDevice + BLE
    Bluefruit.begin();
    Bluefruit.setTxPower(0);  // 0 dBm; bump to +4 if range poor

    // 3. Enable DCDC regulator — drops idle current from ~5 µA to ~2.5 µA.
    sd_power_dcdc_mode_set(NRF_POWER_DCDC_ENABLE);

    // 4. Load persisted cal/tare/packetId
    OAPersist::begin();
    OAPersist::load(g_state);

    hx711_begin(PIN_HX711_DT, PIN_HX711_SCK, g_state.calFactor, g_state.tareOffset);
}

void loop() {
    static uint16_t cycleCount = 0;

    // 1. Wake HX711 and read
    float weightKg = hx711_read_median(10);
    uint16_t spread_g = hx711_last_spread_g();   // diagnostic; pack later if needed
    hx711_sleep();
    (void)spread_g;

    // 2. Read battery (averaged ADC, see §4.2)
    float batteryV = readBatteryVoltage();

    // 3. Build BTHome v2 service-data payload
    // Service-data AD type (0x16) must start with the 16-bit UUID in little-endian,
    // followed by the BTHome payload bytes.
    g_state.packetId++;                       // wraps the 8-bit advert field at the cast below
    uint8_t svcData[2 + 16];
    svcData[0] = (uint8_t)(BTHOME_SERVICE_UUID_16 & 0xFF);
    svcData[1] = (uint8_t)(BTHOME_SERVICE_UUID_16 >> 8);
    size_t payloadLen = bthome_build_payload(
        svcData + 2, sizeof(svcData) - 2,
        (uint8_t)(g_state.packetId & 0xFF),
        weightKg,
        batteryV,
        /*tempC*/ NAN  // not present on v1 hardware
    );

    // 4. Advertise for 300 ms
    // Friendly name "OA-XXXX" must be set BEFORE addName().
    char name[12];
    bthome_local_name(name, sizeof(name));
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

    // 6. Sleep until next cycle (FreeRTOS idle -> __WFE; see header comment)
    delay(WAKE_INTERVAL_MS);
}

float readBatteryVoltage() {
    pinMode(PIN_VBAT_EN, OUTPUT);
    digitalWrite(PIN_VBAT_EN, LOW);  // enable divider
    delay(2);
    analogReadResolution(12);
    uint32_t acc = 0;
    for (int i = 0; i < 20; i++) acc += analogRead(PIN_VBAT);
    digitalWrite(PIN_VBAT_EN, HIGH); // disable divider to save current
    pinMode(PIN_VBAT_EN, INPUT);
    float adc = acc / 20.0f;
    // 12-bit ADC, 3.0 V ref, divider 1510k/510k -> Vbat = adc * 3.0 / 4095 * (1510+510)/510
    return adc * (3.0f / 4095.0f) * (2020.0f / 510.0f);
}

// nRF52840 USB regulator status — VBUSDETECT bit reads 1 when 5V is applied to USB.
// Safe to call before USBDevice is initialised.
static bool vbusPresent() {
    return (NRF_POWER->USBREGSTATUS & POWER_USBREGSTATUS_VBUSDETECT_Msk) != 0;
}
