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
};

inline bool begin() {
    return InternalFS.begin();
}

// Loads state into `out` if /cal.txt exists. Returns true on successful parse.
// Untouched fields keep their pre-call values, so caller seeds defaults first.
inline bool load(State& out) {
    File f(InternalFS);
    if (!f.open(PATH, FILE_O_READ)) return false;
    char buf[160] = {0};
    int n = f.read(buf, sizeof(buf) - 1);
    f.close();
    if (n <= 0) return false;

    char* line = strtok(buf, "\r\n");
    while (line) {
        if      (!strncmp(line, "cal=",  4)) out.calFactor  = atof(line + 4);
        else if (!strncmp(line, "tare=", 5)) out.tareOffset = atol(line + 5);
        else if (!strncmp(line, "pid=",  4)) out.packetId   = (uint32_t)atol(line + 4);
        else if (!strncmp(line, "boot=", 5)) out.bootCount  = (uint32_t)atol(line + 5);
        line = strtok(nullptr, "\r\n");
    }
    return true;
}

inline bool save(const State& in) {
    InternalFS.remove(PATH);                  // LittleFS opens for append by default
    File f(InternalFS);
    if (!f.open(PATH, FILE_O_WRITE)) return false;
    char buf[160];
    int n = snprintf(buf, sizeof(buf),
                     "cal=%.4f\ntare=%ld\npid=%lu\nboot=%lu\n",
                     in.calFactor,
                     (long)in.tareOffset,
                     (unsigned long)in.packetId,
                     (unsigned long)in.bootCount);
    if (n <= 0) { f.close(); return false; }
    f.write((const uint8_t*)buf, n);
    f.close();
    return true;
}

} // namespace OAPersist
