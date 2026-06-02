// Calibration CLI mode — entered when USB-VBUS is detected at boot.
// See docs/todo-plan.md §3 (firmware) and the original plan §4.5.
//
// CLI (115200 baud, line-based):
//   tare              -> store current raw reading as zero offset
//   cal <known_kg>    -> compute and store new scale factor using the weight on the platform
//   show              -> dump stored cal/tare/packetId + live raw reading
//   save              -> persist current values to /cal.txt (auto-runs after tare/cal)
//   reboot            -> exit cal mode (NVIC system reset)
//
// The CLI BLOCKS — main.cpp never returns from enterCalibrationMode().

#include <Arduino.h>
#include "hx711_helper.h"
#include "persist.h"

static const uint8_t PIN_HX711_DT  = D2;
static const uint8_t PIN_HX711_SCK = D3;

static OAPersist::State g_state = { -26913.0f, 0, 0, 0 };

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
    Serial.begin(115200);
    uint32_t t0 = millis();
    while (!Serial && (millis() - t0) < 5000) { delay(10); }  // wait up to 5s for host

    Serial.println();
    Serial.println(F("=== OpenApiary calibration mode ==="));
    Serial.println(F("commands: tare | cal <kg> | show | save | reboot"));

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
        else if (line == "reboot") {
            Serial.println(F("rebooting..."));
            delay(100);
            NVIC_SystemReset();
        }
        else {
            Serial.println(F("err: unknown command"));
        }
    }
}
