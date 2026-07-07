// Persistence for cal factor, tare offset, and packet ID.
// Backed by Adafruit InternalFS (LittleFS on the nRF52 internal flash).
// File: /cal.txt, plain-text "key=value" lines so it's debuggable over USB.

#pragma once
#include <Arduino.h>
#include <Adafruit_LittleFS.h>
#include <InternalFileSystem.h>

namespace OAPersist {

using namespace Adafruit_LittleFS_Namespace;

static const char* PATH = "/cal.txt";

struct State {
    float    calFactor;
    int32_t  tareOffset;
    uint32_t packetId;     // wider than the 8-bit advert field so we can persist a generation count
    uint32_t bootCount;    // incremented every time the firmware starts (reset / power-on)
    char     name[17];     // optional friendly BLE name (≤16 chars); empty = use default OA-XXXX
    int16_t  tzOffsetMin;  // local timezone offset in minutes (for day/night scheduling)
    float    batCalFactor; // per-device battery voltage trim (1.0 = no correction)
};

inline bool begin() {
    return InternalFS.begin();
}

// Loads state into `out` if /cal.txt exists. Returns true on successful parse.
// Untouched fields keep their pre-call values, so caller seeds defaults first.
inline bool load(State& out) {
    File f(InternalFS);
    if (!f.open(PATH, FILE_O_READ)) return false;
    char buf[224] = {0};
    int n = f.read(buf, sizeof(buf) - 1);
    f.close();
    if (n <= 0) return false;

    char* line = strtok(buf, "\r\n");
    while (line) {
        if      (!strncmp(line, "cal=",  4)) out.calFactor  = atof(line + 4);
        else if (!strncmp(line, "tare=", 5)) out.tareOffset = atol(line + 5);
        else if (!strncmp(line, "pid=",  4)) out.packetId   = (uint32_t)atol(line + 4);
        else if (!strncmp(line, "boot=", 5)) out.bootCount  = (uint32_t)atol(line + 5);
        else if (!strncmp(line, "tz=",   3)) out.tzOffsetMin = (int16_t)atoi(line + 3);
        else if (!strncmp(line, "batcal=", 7)) out.batCalFactor = atof(line + 7);
        else if (!strncmp(line, "name=", 5)) {
            strncpy(out.name, line + 5, sizeof(out.name) - 1);
            out.name[sizeof(out.name) - 1] = '\0';
        }
        line = strtok(nullptr, "\r\n");
    }
    return true;
}

inline bool save(const State& in) {
    InternalFS.remove(PATH);                  // LittleFS opens for append by default
    File f(InternalFS);
    if (!f.open(PATH, FILE_O_WRITE)) return false;
    char buf[256];
    int n = snprintf(buf, sizeof(buf),
                     "cal=%.4f\ntare=%ld\npid=%lu\nboot=%lu\ntz=%d\nbatcal=%.4f\nname=%s\n",
                     in.calFactor,
                     (long)in.tareOffset,
                     (unsigned long)in.packetId,
                     (unsigned long)in.bootCount,
                     (int)in.tzOffsetMin,
                     in.batCalFactor,
                     in.name);
    if (n <= 0) { f.close(); return false; }
    f.write((const uint8_t*)buf, n);
    f.close();
    return true;
}

} // namespace OAPersist
