// Calibration CLI mode — entered when USB-VBUS is detected at boot.
// See docs/todo-plan.md §3 (firmware) and the original plan §4.5.
//
// CLI (115200 baud, line-based):
//   tare              -> store current raw reading as zero offset
//   cal <known_kg>    -> compute and store new scale factor using the weight on the platform
//   show              -> dump stored cal/tare/packetId + live raw reading
//   save              -> persist current values to /cal.txt (auto-runs after tare/cal)
//   ble [seconds]     -> one BTHome v2 advert burst (default 10s) using current cal/tare
//   reboot            -> exit cal mode (NVIC system reset)
//   exit              -> return to caller (used by diag firmware; production never calls this)
//
// In production main.cpp the function is called and never returns (loop runs forever).
// In diag firmware (diag_main.cpp) the `exit` command lets the user pop back to the menu.

#include <Arduino.h>
#include <bluefruit.h>
#include "hx711_helper.h"
#include "persist.h"
#include "bthome.h"

static const uint8_t PIN_HX711_DT  = D2;
static const uint8_t PIN_HX711_SCK = D3;
static const uint8_t PIN_VBAT_EN   = 14;

// Battery divider correction (see main.cpp). Nominal term over-reads ~1.30x.
static const float BAT_DIVIDER_CAL = 0.7698f;

static OAPersist::State g_state = { -26913.0f, 0, 0, 0, "", 0, 1.0f, 360, 1320 };

// Battery voltage with the fixed divider correction but WITHOUT the per-device
// trim (used by `batcal` to compute a fresh trim from a multimeter reading).
static float readBatteryVoltageRawCal() {
    pinMode(PIN_VBAT_EN, OUTPUT);
    digitalWrite(PIN_VBAT_EN, LOW);
    delay(5);
    analogReference(AR_INTERNAL_3_0);
    analogReadResolution(12);
    (void)analogRead(PIN_VBAT);  // discard first sample (SAADC settle)
    uint32_t acc = 0;
    for (int i = 0; i < 8; i++) {
        acc += analogRead(PIN_VBAT);
        delay(1);
    }
    digitalWrite(PIN_VBAT_EN, HIGH);
    pinMode(PIN_VBAT_EN, INPUT);
    float adc = acc / 8.0f;
    return adc * (3.0f / 4095.0f) * (2020.0f / 510.0f) * BAT_DIVIDER_CAL;
}

// Corrected battery voltage (divider correction + per-device trim).
static float readBatteryVoltageCal() {
    return readBatteryVoltageRawCal() * g_state.batCalFactor;
}

// With SoftDevice enabled, the TEMP peripheral is owned by the radio — direct
// register access (NRF_TEMP->TASKS_START) hangs forever waiting for EVENTS_DATARDY
// because the SoftDevice already consumed it. Must use sd_temp_get().
static float readDieTempCcal() {
    int32_t raw = 0;
    uint32_t err = sd_temp_get(&raw);
    if (err != NRF_SUCCESS) return NAN;
    return raw * 0.25f;
}

static void runBleBurst(uint32_t seconds, long preReadRaw) {
    Serial.println(F("[ble] start")); Serial.flush();
    float weightKg = (preReadRaw - g_state.tareOffset) / g_state.calFactor;
    Serial.print(F("[ble] kg=")); Serial.println(weightKg, 3); Serial.flush();
    float batteryV = readBatteryVoltageCal();
    Serial.print(F("[ble] v=")); Serial.println(batteryV, 3); Serial.flush();
    float dieTempC = readDieTempCcal();
    if (isnan(dieTempC)) dieTempC = 0.0f;
    Serial.print(F("[ble] t=")); Serial.println(dieTempC, 1); Serial.flush();

    g_state.packetId++;
    uint8_t svcData[2 + 24];
    svcData[0] = (uint8_t)(BTHOME_SERVICE_UUID_16 & 0xFF);
    svcData[1] = (uint8_t)(BTHOME_SERVICE_UUID_16 >> 8);
    size_t payloadLen = bthome_build_payload(
        svcData + 2, sizeof(svcData) - 2,
        (uint8_t)(g_state.packetId & 0xFF),
        weightKg, batteryV, dieTempC,
        -1,  // skip battery % in cal mode (USB present, value misleading)
        1,   // charging = USB present
        (int)(g_state.bootCount & 0xFFFF)
    );

    char name[12];
    bthome_local_name(name, sizeof(name));
    Bluefruit.setName(name);
    Serial.print(F("[ble] name=")); Serial.println(name); Serial.flush();

    Bluefruit.Advertising.clearData();
    Bluefruit.Advertising.addFlags(BLE_GAP_ADV_FLAGS_LE_ONLY_GENERAL_DISC_MODE);
    Bluefruit.Advertising.addData(BLE_GAP_AD_TYPE_SERVICE_DATA,
                                  svcData, (uint8_t)(2 + payloadLen));
    Bluefruit.ScanResponse.addName();
    Serial.println(F("[ble] starting advert...")); Serial.flush();
    Bluefruit.Advertising.start(0);
    Serial.println(F("[ble] advert started")); Serial.flush();

    Serial.print(F("advertising as ")); Serial.print(name);
    Serial.print(F(" kg=")); Serial.print(weightKg, 3);
    Serial.print(F(" v=")); Serial.print(batteryV, 3);
    Serial.print(F(" t=")); Serial.print(dieTempC, 1);
    Serial.print(F("C pid=")); Serial.print(g_state.packetId);
    Serial.print(F(" for ")); Serial.print(seconds); Serial.println(F("s..."));

    delay(seconds * 1000UL);
    Bluefruit.Advertising.stop();
    Serial.println(F("advert stopped"));
    OAPersist::save(g_state);  // persist packetId so live captures don't repeat ids after exit
}

static String readLine() {
    String s;
    while (true) {
        while (!Serial.available()) { delay(5); }
        char c = (char)Serial.read();
        if (c == '\r') continue;
        if (c == '\n') return s;
        s += c;
        if (s.length() > 64) return s;
    }
}

void enterCalibrationMode() {
    // Init SoftDevice + Bluefruit BEFORE USB-CDC. Starting SoftDevice with an
    // active CDC link causes the host to drop USB and the firmware to hang
    // (Adafruit + TinyUSB + SoftDevice coexistence quirk). Doing it first means
    // CDC enumerates with the radio already up — and the `ble` command then
    // only needs to toggle advertising, never re-init.
    Bluefruit.begin();
    Bluefruit.setTxPower(0);

    Serial.begin(115200);
    uint32_t t0 = millis();
    while (!Serial && (millis() - t0) < 15000) { delay(10); }  // wait up to 15s for host CDC re-attach
    delay(500);  // give host miniterm a beat to settle after DTR assert

    Serial.println();
    Serial.println(F("=== OpenApiary calibration mode ==="));
    Serial.println(F("commands: tare | cal <kg> | batcal <V> | show | save | ble [s] | reboot | exit"));

    OAPersist::begin();
    if (OAPersist::load(g_state)) {
        Serial.print(F("loaded cal=")); Serial.print(g_state.calFactor, 4);
        Serial.print(F(" tare="));      Serial.print(g_state.tareOffset);
        Serial.print(F(" pid="));       Serial.println(g_state.packetId);
    } else {
        Serial.println(F("no /cal.txt yet — using defaults"));
    }

    hx711_begin(PIN_HX711_DT, PIN_HX711_SCK, g_state.calFactor, g_state.tareOffset);

    while (true) {
        Serial.print(F("oa> "));
        String line = readLine();
        line.trim();
        Serial.println(line);
        if (line.length() == 0) continue;

        if (line == "tare") {
            long raw = hx711_read_raw_average(20);
            g_state.tareOffset = raw;
            hx711_set_offset(raw);
            OAPersist::save(g_state);
            Serial.print(F("tare set to raw=")); Serial.println(raw);
        }
        else if (line.startsWith("cal ")) {
            float knownKg = line.substring(4).toFloat();
            if (knownKg <= 0.0f) { Serial.println(F("err: cal needs a positive kg value")); continue; }
            long raw = hx711_read_raw_average(20);
            long net = raw - g_state.tareOffset;
            if (net == 0) { Serial.println(F("err: net reading is zero — did you tare?")); continue; }
            float factor = (float)net / knownKg;
            g_state.calFactor = factor;
            hx711_set_scale(factor);
            OAPersist::save(g_state);
            Serial.print(F("cal set: raw=")); Serial.print(raw);
            Serial.print(F(" net="));         Serial.print(net);
            Serial.print(F(" factor="));      Serial.println(factor, 4);
        }
        else if (line.startsWith("batcal ")) {
            float measured = line.substring(7).toFloat();
            if (measured <= 0.5f) { Serial.println(F("err: batcal needs your multimeter reading in volts, e.g. batcal 3.98")); continue; }
            float rawV = readBatteryVoltageRawCal();
            if (rawV <= 0.1f) { Serial.println(F("err: battery read failed")); continue; }
            g_state.batCalFactor = measured / rawV;
            OAPersist::save(g_state);
            Serial.print(F("batcal set: raw=")); Serial.print(rawV, 3);
            Serial.print(F(" measured=")); Serial.print(measured, 3);
            Serial.print(F(" factor=")); Serial.print(g_state.batCalFactor, 4);
            Serial.print(F(" -> now reads ")); Serial.println(readBatteryVoltageCal(), 3);
        }
        else if (line == "show") {
            long raw = hx711_read_raw_average(10);
            Serial.print(F("cal=")); Serial.print(g_state.calFactor, 4);
            Serial.print(F(" tare=")); Serial.print(g_state.tareOffset);
            Serial.print(F(" pid="));  Serial.println(g_state.packetId);
            Serial.print(F("raw=")); Serial.print(raw);
            Serial.print(F(" net=")); Serial.print(raw - g_state.tareOffset);
            Serial.print(F(" kg="));  Serial.println((raw - g_state.tareOffset) / g_state.calFactor, 3);
        }
        else if (line == "save") {
            OAPersist::save(g_state);
            Serial.println(F("saved"));
        }
        else if (line == "ble" || line.startsWith("ble ")) {
            uint32_t secs = 10;
            if (line.length() > 4) {
                long v = line.substring(4).toInt();
                if (v > 0 && v <= 300) secs = (uint32_t)v;
            }
            Serial.println(F("[ble] reading hx711...")); Serial.flush();
            long raw = hx711_read_raw_average(10);
            Serial.print(F("[ble] raw=")); Serial.println(raw); Serial.flush();
            runBleBurst(secs, raw);
        }
        else if (line == "reboot") {
            Serial.println(F("rebooting..."));
            delay(100);
            NVIC_SystemReset();
        }
        else if (line == "exit") {
            Serial.println(F("exiting cal mode"));
            return;
        }
        else {
            Serial.println(F("err: unknown command"));
        }
    }
}
