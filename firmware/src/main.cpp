// OpenApiary firmware — main entry
// Target: Seeed XIAO nRF52840 (Standard, NOT Sense)
// Design: see docs/migration-plan.md §4
//
// Wake cycle (every 15 min):
//   System OFF -> RTC wake -> HX711 read -> battery read -> BLE advert burst -> System OFF
//
// This is a SCAFFOLD. TODO markers show where each piece needs implementing.

#include <Arduino.h>
#include <bluefruit.h>
#include "hx711_helper.h"
#include "bthome.h"

// ---- Pinout (see §4.2) ----
static const uint8_t PIN_HX711_DT  = D2;   // P0.04
static const uint8_t PIN_HX711_SCK = D3;   // P0.05
static const uint8_t PIN_VBAT_EN   = 14;   // P0.14 - drive LOW to enable divider
// PIN_VBAT (P0.31) is provided by the Adafruit core as PIN_VBAT

// ---- Timing ----
static const uint32_t WAKE_INTERVAL_MS = 15UL * 60UL * 1000UL;  // 15 minutes
static const uint16_t ADVERT_DURATION_MS = 300;                  // 3 packets across ch 37/38/39

// ---- Persisted via Adafruit InternalFS (LittleFS) ----
// TODO: load from /cal.txt on boot
static float    g_calFactor = -26913.0f;  // initial default from v4 BOM
static int32_t  g_tareOffset = 0;
static uint8_t  g_packetId = 0;           // monotonic counter, persisted across reboots

void setup() {
    // TODO: detect VBUS or Hall sensor -> enter calibration CLI mode (see cal_mode.cpp)

    Bluefruit.begin();
    Bluefruit.setTxPower(0);  // 0 dBm; bump to +4 if range poor

    // TODO: load cal/tare/packetId from InternalFS

    hx711_begin(PIN_HX711_DT, PIN_HX711_SCK, g_calFactor, g_tareOffset);
}

void loop() {
    // 1. Wake HX711 and read
    float weightKg = hx711_read_median(10);
    uint16_t spread_g = hx711_last_spread_g();   // diagnostic; pack later if needed
    hx711_sleep();

    // 2. Read battery (averaged ADC, see §4.2)
    float batteryV = readBatteryVoltage();

    // 3. Build BTHome v2 service-data payload
    uint8_t payload[16];
    size_t  payloadLen = bthome_build_payload(
        payload, sizeof(payload),
        ++g_packetId,
        weightKg,
        batteryV,
        /*tempC*/ NAN  // not present on v1 hardware
    );
    (void)spread_g;  // TODO: include in custom slot once decided

    // 4. Advertise for 300 ms
    Bluefruit.Advertising.clearData();
    Bluefruit.Advertising.addFlags(BLE_GAP_ADV_FLAGS_LE_GENERAL_DISC_MODE);
    Bluefruit.Advertising.addService(BTHOME_SERVICE_UUID_16);
    Bluefruit.Advertising.addData(BLE_GAP_AD_TYPE_SERVICE_DATA, payload, payloadLen);
    // Scan response: friendly name "OA-XXXX"
    char name[12];
    bthome_local_name(name, sizeof(name));
    Bluefruit.ScanResponse.addName();
    Bluefruit.setName(name);
    Bluefruit.Advertising.start(0);
    delay(ADVERT_DURATION_MS);
    Bluefruit.Advertising.stop();

    // 5. Persist packet counter and go to System OFF
    // TODO: persist g_packetId to InternalFS every N cycles
    // TODO: configure RTC compare match for WAKE_INTERVAL_MS, then call sd_power_system_off()
    delay(WAKE_INTERVAL_MS);  // PLACEHOLDER — replace with true System OFF
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
