// Calibration CLI mode — entered when USB-VBUS is detected at boot.
// See docs/todo-plan.md §3 (firmware) and the original plan §4.5.
//
// CLI (115200 baud, line-based):
//   tare              -> store current raw reading as zero offset
//   cal <known_kg>    -> compute and store new scale factor using the weight on the platform
//   raw [n]           -> average of n raw samples (default 10) with min/max/spread — noise check
//   dump [n] [prod]   -> print every individual raw count (default 20) as CSV, for offline
//                        estimator comparison. `prod` uses bogde's unprotected read — the path
//                        hx711_read_median() takes — instead of the timeout-guarded one.
//                        Preamble reports ms_per_sample, which reveals the RATE-pin strapping.
//   awake [s]         -> hold the HX711 powered (default 60s) so excitation voltage can be
//                        measured at E+/E- — between reads the chip sleeps and AVDD collapses
//   mon [int_s] [dur_s] -> stream raw/net/kg/temp/spread/batt as CSV (default 5s x 300s) — drift trace
//   monprod [int_s] [dur_s] -> same cadence but streams the PRODUCTION estimator
//                        (hx711_read_median), so bench and field measure the same code.
//                        Prints a readable table and closes off a SEGMENT summary
//                        (n / mean / p-p / step vs previous) each time the load changes,
//                        so corner-load and calibration steps can be read off directly.
//   radio on|off      -> leave aggressive 20ms advertising running across other commands, so
//                        mon/monprod/dump can be captured under identical radio load
//   monble [int_s] [dur_s] -> like mon but with the BLE radio ACTIVELY advertising/connected,
//                          + conn/got columns — tests SoftDevice interference with the HX711 read
//   logdump           -> export stored production weight history as CSV over serial
//   soak on|off       -> enable or disable 1 g internal soak logging
//   soakdump          -> export the 1 g soak history as CSV over serial
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
#include "reading_log.h"

static const uint8_t PIN_HX711_DT  = D2;
static const uint8_t PIN_HX711_SCK = D3;
static const uint8_t PIN_VBAT_EN   = 14;

// Battery divider correction (see main.cpp). Nominal term over-reads ~1.30x.
static const float BAT_DIVIDER_CAL = 0.7698f;

static OAPersist::State g_state = { -26913.0f, 0, 0, 0, "", 0, 1.0f, 60, 900, 60, 3600, 0 };

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

// Aggressive connectable advertising left running across subsequent commands, so
// `mon`, `monprod` and `dump` can each be captured under identical radio load.
// Worst case for the HX711 bit-bang: 20 ms advert interval, plus whatever a
// connected phone adds. `monble` stops advertising when it finishes, so re-arm
// this afterwards if you need it.
static void setLoadAdvertising(bool on) {
    if (!on) {
        Bluefruit.Advertising.stop();
        return;
    }
    uint8_t svcData[2 + 24];
    svcData[0] = (uint8_t)(BTHOME_SERVICE_UUID_16 & 0xFF);
    svcData[1] = (uint8_t)(BTHOME_SERVICE_UUID_16 >> 8);
    size_t payloadLen = bthome_build_payload(
        svcData + 2, sizeof(svcData) - 2,
        (uint8_t)(g_state.packetId & 0xFF), 0.0f, 4.0f, 20.0f, -1, 1,
        (int)(g_state.bootCount & 0xFFFF));
    char bname[12];
    bthome_local_name(bname, sizeof(bname));
    Bluefruit.setName(bname);
    Bluefruit.Advertising.clearData();
    Bluefruit.ScanResponse.clearData();
    Bluefruit.Advertising.addFlags(BLE_GAP_ADV_FLAGS_LE_ONLY_GENERAL_DISC_MODE);
    Bluefruit.Advertising.addData(BLE_GAP_AD_TYPE_SERVICE_DATA, svcData, (uint8_t)(2 + payloadLen));
    Bluefruit.ScanResponse.addName();
    Bluefruit.Advertising.restartOnDisconnect(true);
    Bluefruit.Advertising.setType(BLE_GAP_ADV_TYPE_CONNECTABLE_SCANNABLE_UNDIRECTED);
    Bluefruit.Advertising.setInterval(32, 32);
    Bluefruit.Advertising.start(0);
}

// Shared parser for the "[int_s] [dur_s]" tail of the streaming commands.
static void parseMonArgs(const String& line, uint8_t skipChars,
                         uint32_t* interval, uint32_t* duration,
                         uint32_t maxInterval, uint32_t maxDuration) {
    String rest = line.length() > skipChars ? line.substring(skipChars) : String("");
    rest.trim();
    if (rest.length()) {
        int sp = rest.indexOf(' ');
        if (sp < 0) { long a = rest.toInt(); if (a > 0) *interval = (uint32_t)a; }
        else {
            long a = rest.substring(0, sp).toInt();
            long b = rest.substring(sp + 1).toInt();
            if (a > 0) *interval = (uint32_t)a;
            if (b > 0) *duration = (uint32_t)b;
        }
    }
    if (*interval < 1) *interval = 1;
    if (*interval > maxInterval) *interval = maxInterval;
    if (*duration < 1) *duration = 1;
    if (*duration > maxDuration) *duration = maxDuration;
}

static void printPadded(const String& s, int width) {
    for (int i = (int)s.length(); i < width; i++) Serial.print(' ');
    Serial.print(s);
}

// Live segmentation for `monprod`. A "segment" is a run of settled samples at one
// load state; closing it prints mean/spread and the step against the previous
// segment, which is the number the corner-load and calibration tests actually want.
struct MonSegment {
    uint16_t n;
    float sum, min, max;
    bool havePrev;
    float prevMean;
};

static void segReset(MonSegment* s) {
    s->n = 0; s->sum = 0.0f; s->min = 0.0f; s->max = 0.0f;
}

static void segAdd(MonSegment* s, float kg) {
    if (s->n == 0) { s->min = kg; s->max = kg; }
    else { if (kg < s->min) s->min = kg; if (kg > s->max) s->max = kg; }
    s->sum += kg;
    s->n++;
}

// Discards runs too short to be a real phase, so a two-sample wobble mid-handling
// doesn't emit a bogus step.
static void segClose(MonSegment* s) {
    if (s->n < 3) { segReset(s); return; }
    float mean = s->sum / s->n;
    Serial.println(F("  ------------------------------------------------------------"));
    Serial.print(F("  SEGMENT   n="));
    Serial.print(s->n);
    Serial.print(F("   mean="));
    printPadded(String(mean, 3), 7);
    Serial.print(F(" kg   p-p="));
    printPadded(String((int)((s->max - s->min) * 1000.0f + 0.5f)), 4);
    Serial.print(F(" g"));
    if (s->havePrev) {
        float d = mean - s->prevMean;
        Serial.print(F("   step="));
        Serial.print(d >= 0 ? '+' : '-');
        Serial.print(fabsf(d), 3);
        Serial.print(F(" kg"));
    } else {
        Serial.print(F("   (baseline)"));
    }
    Serial.println();
    Serial.println(F("  ------------------------------------------------------------"));
    s->prevMean = mean;
    s->havePrev = true;
    segReset(s);
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
    Serial.println(F("commands: tare | cal <kg> | raw [n] | dump [n] [prod] | awake [s] | mon [int_s] [dur_s] | monprod [int_s] [dur_s] | monble [int_s] [dur_s] | radio on|off | cfg | logs | logdump | soak on|off | soakdump | diagtest [n] | batcal <V> | show | save | ble [s] | reboot | exit"));

    OAPersist::begin();
    OAPersist::seedDefaults(g_state);
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
        else if (line == "raw" || line.startsWith("raw ")) {
            uint8_t n = 10;
            if (line.length() > 4) { long v = line.substring(4).toInt(); if (v > 0 && v <= 100) n = (uint8_t)v; }
            long mn = 0, mx = 0; uint8_t got = 0;
            long avg = hx711_read_raw_stats(n, &mn, &mx, &got);
            hx711_sleep();
            long net = avg - g_state.tareOffset;
            long spread = (got > 0) ? (mx - mn) : 0;
            float spreadG = spread / fabsf(g_state.calFactor) * 1000.0f;
            Serial.print(F("raw avg=")); Serial.print(avg);
            Serial.print(F(" min=")); Serial.print(mn);
            Serial.print(F(" max=")); Serial.print(mx);
            Serial.print(F(" spread=")); Serial.print(spread);
            Serial.print(F(" (")); Serial.print(spreadG, 1); Serial.print(F("g)"));
            Serial.print(F(" net=")); Serial.print(net);
            Serial.print(F(" kg=")); Serial.print((float)net / g_state.calFactor, 3);
            Serial.print(F(" got=")); Serial.print(got); Serial.print('/'); Serial.println(n);
        }
        else if (line == "mon" || line.startsWith("mon ")) {
            uint32_t interval = 5, duration = 300;
            String rest = line.substring(3); rest.trim();
            if (rest.length()) {
                int sp = rest.indexOf(' ');
                if (sp < 0) { long a = rest.toInt(); if (a > 0) interval = (uint32_t)a; }
                else {
                    long a = rest.substring(0, sp).toInt();
                    long b = rest.substring(sp + 1).toInt();
                    if (a > 0) interval = (uint32_t)a;
                    if (b > 0) duration = (uint32_t)b;
                }
            }
            if (interval < 1) interval = 1;
            if (interval > 60) interval = 60;
            if (duration < 1) duration = 1;
            if (duration > 7200) duration = 7200;
            Serial.print(F("mon: every ")); Serial.print(interval);
            Serial.print(F("s for ")); Serial.print(duration);
            Serial.println(F("s (send any line to stop)"));
            Serial.println(F("t_s,raw,net,kg,tempC,spread_g,battV"));
            uint32_t start = millis();
            uint32_t next = start;
            while ((millis() - start) < duration * 1000UL) {
                if (Serial.available()) { while (Serial.available()) Serial.read(); Serial.println(F("mon stopped")); break; }
                long mn = 0, mx = 0; uint8_t got = 0;
                long avg = hx711_read_raw_stats(20, &mn, &mx, &got);
                hx711_sleep();
                long net = avg - g_state.tareOffset;
                float kg = (float)net / g_state.calFactor;
                float spreadG = (got > 0) ? ((mx - mn) / fabsf(g_state.calFactor) * 1000.0f) : 0.0f;
                float t = readDieTempCcal(); if (isnan(t)) t = 0.0f;
                float v = readBatteryVoltageCal();
                uint32_t ts = (millis() - start) / 1000UL;
                Serial.print(ts); Serial.print(',');
                Serial.print(avg); Serial.print(',');
                Serial.print(net); Serial.print(',');
                Serial.print(kg, 3); Serial.print(',');
                Serial.print(t, 1); Serial.print(',');
                Serial.print(spreadG, 1); Serial.print(',');
                Serial.println(v, 3);
                next += interval * 1000UL;
                while ((int32_t)(next - millis()) > 0) {
                    if (Serial.available()) break;
                    delay(20);
                }
            }
            Serial.println(F("mon done"));
        }        else if (line == "monble" || line.startsWith("monble ")) {
            uint32_t interval = 1, duration = 120;
            String rest = line.length() > 6 ? line.substring(6) : String("");
            rest.trim();
            if (rest.length()) {
                int sp = rest.indexOf(' ');
                if (sp < 0) { long a = rest.toInt(); if (a > 0) interval = (uint32_t)a; }
                else {
                    long a = rest.substring(0, sp).toInt();
                    long b = rest.substring(sp + 1).toInt();
                    if (a > 0) interval = (uint32_t)a;
                    if (b > 0) duration = (uint32_t)b;
                }
            }
            if (interval < 1) interval = 1;
            if (interval > 60) interval = 60;
            if (duration < 1) duration = 1;
            if (duration > 3600) duration = 3600;

            // Aggressive connectable advertising = heavy radio duty cycle, the
            // worst case for the HX711 bit-bang under SoftDevice. Connect a phone
            // (nRF Connect / the app) mid-run to add connection load.
            uint8_t svcData[2 + 24];
            svcData[0] = (uint8_t)(BTHOME_SERVICE_UUID_16 & 0xFF);
            svcData[1] = (uint8_t)(BTHOME_SERVICE_UUID_16 >> 8);
            size_t payloadLen = bthome_build_payload(
                svcData + 2, sizeof(svcData) - 2,
                (uint8_t)(g_state.packetId & 0xFF), 0.0f, 4.0f, 20.0f, -1, 1,
                (int)(g_state.bootCount & 0xFFFF));
            char bname[12];
            bthome_local_name(bname, sizeof(bname));
            Bluefruit.setName(bname);
            Bluefruit.Advertising.clearData();
            Bluefruit.ScanResponse.clearData();
            Bluefruit.Advertising.addFlags(BLE_GAP_ADV_FLAGS_LE_ONLY_GENERAL_DISC_MODE);
            Bluefruit.Advertising.addData(BLE_GAP_AD_TYPE_SERVICE_DATA, svcData, (uint8_t)(2 + payloadLen));
            Bluefruit.ScanResponse.addName();
            Bluefruit.Advertising.restartOnDisconnect(true);
            Bluefruit.Advertising.setType(BLE_GAP_ADV_TYPE_CONNECTABLE_SCANNABLE_UNDIRECTED);
            Bluefruit.Advertising.setInterval(32, 32);   // 20 ms — aggressive radio load
            Bluefruit.Advertising.start(0);

            Serial.print(F("monble: advertising as ")); Serial.print(bname);
            Serial.println(F(" (connect a phone to add load; send any line to stop)"));
            Serial.println(F("t_s,raw,net,kg,conn,got,spread_g"));
            uint32_t start = millis();
            uint32_t next = start;
            while ((millis() - start) < duration * 1000UL) {
                if (Serial.available()) { while (Serial.available()) Serial.read(); Serial.println(F("monble stopped")); break; }
                long mn = 0, mx = 0; uint8_t got = 0;
                long avg = hx711_read_raw_stats(20, &mn, &mx, &got);
                hx711_sleep();
                long net = avg - g_state.tareOffset;
                float kg = (float)net / g_state.calFactor;
                float spreadG = (got > 0) ? ((mx - mn) / fabsf(g_state.calFactor) * 1000.0f) : 0.0f;
                uint32_t ts = (millis() - start) / 1000UL;
                Serial.print(ts); Serial.print(',');
                Serial.print(avg); Serial.print(',');
                Serial.print(net); Serial.print(',');
                Serial.print(kg, 3); Serial.print(',');
                Serial.print(Bluefruit.connected() ? 1 : 0); Serial.print(',');
                Serial.print(got); Serial.print(',');
                Serial.println(spreadG, 1);
                next += interval * 1000UL;
                while ((int32_t)(next - millis()) > 0) {
                    if (Serial.available()) break;
                    delay(20);
                }
            }
            Bluefruit.Advertising.stop();
            Serial.println(F("monble done"));
        }
        else if (line == "radio on" || line == "radio off") {
            bool on = line.endsWith("on");
            setLoadAdvertising(on);
            Serial.print(F("radio ")); Serial.println(on
                ? F("ON — advertising at 20ms; connect a phone to add link load")
                : F("OFF"));
        }
        else if (line == "dump" || line.startsWith("dump ")) {
            // Per-sample raw counts for offline estimator comparison. Second arg
            // `prod` uses bogde's unprotected read — the path production takes —
            // so a capture pair reveals SoftDevice corruption directly.
            uint8_t n = 20;
            bool useLib = false;
            String rest = line.length() > 4 ? line.substring(4) : String("");
            rest.trim();
            if (rest.length()) {
                int sp = rest.indexOf(' ');
                String numPart = (sp < 0) ? rest : rest.substring(0, sp);
                if (sp >= 0 && rest.substring(sp + 1).indexOf("prod") >= 0) useLib = true;
                if (numPart.indexOf("prod") >= 0) useLib = true;
                long v = numPart.toInt();
                if (v > 0 && v <= 64) n = (uint8_t)v;
            }
            long samples[64];
            uint32_t elapsed = 0;
            uint8_t got = hx711_read_raw_samples(samples, n, useLib, &elapsed);
            hx711_sleep();
            Serial.print(F("# path=")); Serial.print(useLib ? F("prod") : F("safe"));
            Serial.print(F(" requested=")); Serial.print(n);
            Serial.print(F(" got=")); Serial.print(got);
            Serial.print(F(" tare=")); Serial.print(g_state.tareOffset);
            Serial.print(F(" cal=")); Serial.print(g_state.calFactor, 4);
            Serial.print(F(" conn=")); Serial.print(Bluefruit.connected() ? 1 : 0);
            Serial.print(F(" elapsed_ms=")); Serial.print(elapsed);
            if (got > 1) {
                float perSample = (float)elapsed / got;
                Serial.print(F(" ms_per_sample=")); Serial.print(perSample, 1);
                Serial.print(F(" sps=")); Serial.print(perSample > 0 ? 1000.0f / perSample : 0.0f, 1);
            }
            Serial.println();
            Serial.println(F("i,raw"));
            for (uint8_t i = 0; i < got; i++) {
                Serial.print(i); Serial.print(',');
                Serial.println(samples[i]);
            }
            Serial.println(F("dump done"));
        }
        else if (line == "monprod" || line.startsWith("monprod ")) {
            // Streams the PRODUCTION estimator — hx711_read_median() — rather than
            // the hardened raw path used by `mon`. Pair the two captures to show
            // whether the shipped read path is the source of the instability.
            uint32_t interval = 5, duration = 300;
            parseMonArgs(line, 7, &interval, &duration, 300, 7200);
            Serial.print(F("monprod: production estimator, every ")); Serial.print(interval);
            Serial.print(F("s for ")); Serial.print(duration);
            Serial.println(F("s (send any line to stop)"));
            Serial.println();
            Serial.println(F("  time     weight    spread  state    temp"));
            Serial.println(F("  -------------------------------------------"));
            MonSegment seg = { 0, 0.0f, 0.0f, 0.0f, false, 0.0f };
            const uint16_t STEADY_SPREAD_G = 100;   // above this the operator is still handling it
            const float    JUMP_KG         = 0.30f; // catches quiet load changes with no spread spike
            uint32_t start = millis();
            uint32_t next = start;
            while ((millis() - start) < duration * 1000UL) {
                if (Serial.available()) { while (Serial.available()) Serial.read(); segClose(&seg); Serial.println(F("monprod stopped")); break; }
                float kg = hx711_read_median(10);
                uint16_t spreadG = hx711_last_spread_g();
                hx711_sleep();
                float t = readDieTempCcal(); if (isnan(t)) t = 0.0f;
                uint32_t ts = (millis() - start) / 1000UL;

                bool steady = (spreadG <= STEADY_SPREAD_G);
                if (steady && seg.n > 0 && fabsf(kg - (seg.sum / seg.n)) > JUMP_KG) {
                    segClose(&seg);  // load changed without a spread spike
                }
                if (!steady) segClose(&seg);

                Serial.print(F("  "));
                String mmss = String(ts / 60);
                if (mmss.length() < 2) mmss = "0" + mmss;
                mmss += ":";
                uint32_t sec = ts % 60;
                if (sec < 10) mmss += "0";
                mmss += String(sec);
                Serial.print(mmss);
                printPadded(String(kg, 3), 10);
                Serial.print(F(" kg"));
                printPadded(String(spreadG), 6);
                Serial.print(F(" g  "));
                Serial.print(steady ? F("steady") : F("MOVING"));
                printPadded(String(t, 1), 7);
                Serial.println();

                if (steady) segAdd(&seg, kg);
                next += interval * 1000UL;
                while ((int32_t)(next - millis()) > 0) {
                    if (Serial.available()) break;
                    delay(20);
                }
            }
            segClose(&seg);
            Serial.println(F("monprod done"));
        }
        else if (line == "awake" || line.startsWith("awake ")) {
            uint32_t secs = 60;
            if (line.length() > 6) { long v = line.substring(6).toInt(); if (v > 0 && v <= 600) secs = (uint32_t)v; }
            hx711_hold_awake();
            Serial.print(F("HX711 held awake for ")); Serial.print(secs);
            Serial.println(F("s — measure DC volts at E+/E- now (expect ~3.0-3.3 V)."));
            Serial.println(F("also probe A+/A- : a balanced bridge sits within a few mV of zero."));
            uint32_t start = millis();
            while ((millis() - start) < secs * 1000UL) {
                if (Serial.available()) { while (Serial.available()) Serial.read(); break; }
                delay(50);
            }
            hx711_sleep();
            Serial.println(F("awake done — HX711 back to sleep"));
        }
        else if (line == "save") {
            OAPersist::save(g_state);
            Serial.println(F("saved"));
        }
        else if (line == "cfg") {
            Serial.print(F("summer hb=")); Serial.print(g_state.summerHeartbeatSec);
            Serial.print(F("s rd=")); Serial.print(g_state.summerReadingSec);
            Serial.print(F("s | winter hb=")); Serial.print(g_state.winterHeartbeatSec);
            Serial.print(F("s rd=")); Serial.print(g_state.winterReadingSec);
            Serial.print(F("s | debugLog=")); Serial.println(g_state.debugLog);
        }
        else if (line == "logs") {
            // Initialise the flash rings exactly as a normal boot would, then
            // report each one. If this prints without hanging and the seqs load,
            // the InternalFS budget accommodates the diag ring alongside the rest.
            OALog::begin();
            Serial.print(F("weight  seq=")); Serial.print(OALog::weightLog().nextSeq);
            Serial.print(F(" oldest=")); Serial.print(OALog::weightLog().oldestSeq());
            Serial.print(F(" cap=")); Serial.println(OALog::weightLog().capacity);
            Serial.print(F("battery seq=")); Serial.print(OALog::batteryLog().nextSeq);
            Serial.print(F(" oldest=")); Serial.print(OALog::batteryLog().oldestSeq());
            Serial.print(F(" cap=")); Serial.println(OALog::batteryLog().capacity);
            Serial.print(F("diag    seq=")); Serial.print(OALog::diagLog().nextSeq);
            Serial.print(F(" oldest=")); Serial.print(OALog::diagLog().oldestSeq());
            Serial.print(F(" cap=")); Serial.println(OALog::diagLog().capacity);
        }
        else if (line == "logdump") {
            OALog::begin();
            OALog::RingLog& log = OALog::weightLog();
            Serial.println(F("seq,epoch,kg,tempC"));
            for (uint32_t seq = log.oldestSeq(); seq < log.nextSeq; seq++) {
                uint8_t record[3];
                if (!log.readSeq(seq, record)) continue;
                int16_t centiKg = (int16_t)((uint16_t)record[0] | ((uint16_t)record[1] << 8));
                int8_t halfC = (int8_t)record[2];
                Serial.print(seq); Serial.print(',');
                Serial.print(log.epochOf(seq)); Serial.print(',');
                Serial.print(centiKg / 100.0f, 2); Serial.print(',');
                Serial.println(halfC / 2.0f, 1);
            }
            Serial.println(F("logdump done"));
        }
        else if (line == "soak on" || line == "soak off") {
            g_state.debugLog = line.endsWith("on") ? 1 : 0;
            OAPersist::save(g_state);
            Serial.print(F("soak logging "));
            Serial.println(g_state.debugLog ? F("ON (1 g records at production cadence)") : F("OFF"));
        }
        else if (line == "soakdump") {
            OALog::begin();
            OALog::RingLog& log = OALog::diagLog();
            Serial.println(F("seq,epoch,grams,kg,tempC,spread_g,battV"));
            for (uint32_t seq = log.oldestSeq(); seq < log.nextSeq; seq++) {
                uint8_t record[6];
                if (!log.readSeq(seq, record)) continue;
                int16_t grams = (int16_t)((uint16_t)record[0] | ((uint16_t)record[1] << 8));
                int8_t halfC = (int8_t)record[2];
                uint16_t spreadG = (uint16_t)record[3] | ((uint16_t)record[4] << 8);
                float battV = 2.5f + record[5] / 50.0f;
                Serial.print(seq); Serial.print(',');
                Serial.print(log.epochOf(seq)); Serial.print(',');
                Serial.print(grams); Serial.print(',');
                Serial.print(grams / 1000.0f, 3); Serial.print(',');
                Serial.print(halfC / 2.0f, 1); Serial.print(',');
                Serial.print(spreadG); Serial.print(',');
                Serial.println(battV, 2);
            }
            Serial.println(F("soakdump done"));
        }
        else if (line == "diagtest" || line.startsWith("diagtest ")) {
            OALog::begin();
            int nrec = 5;
            if (line.length() > 9) { long v = line.substring(9).toInt(); if (v > 0 && v <= 100) nrec = (int)v; }
            uint32_t before = OALog::diagLog().nextSeq;
            for (int i = 0; i < nrec; i++) OALog::logDiag(1.0f + i * 0.01f, 20.0f, 15, 4.0f, 0, 900);
            Serial.print(F("diagtest: wrote ")); Serial.print(nrec);
            Serial.print(F(" -> diag seq ")); Serial.print(before);
            Serial.print(F(" to ")); Serial.println(OALog::diagLog().nextSeq);
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
