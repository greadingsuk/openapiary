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
    int16_t  tzOffsetMin;  // local timezone offset in minutes (used for time display)
    float    batCalFactor; // per-device battery voltage trim (1.0 = no correction)
    // Configurable cadences, per season (on/off). Heartbeat = advert/wake cadence;
    // reading = full HX711 measurement logged to flash. Winter (off-season) uses
    // longer reading intervals to save power + flash. Clamped where applied.
    uint16_t summerHeartbeatSec;  // on-season heartbeat  (10..300,   default 60)
    uint16_t summerReadingSec;    // on-season reading    (60..3600,  default 900)
    uint16_t winterHeartbeatSec;  // off-season heartbeat (10..300,   default 60)
    uint16_t winterReadingSec;    // off-season reading   (1800..10800, default 3600)
    uint8_t  debugLog;            // 1 = capture diagnostic samples to the diag ring
};

// Field defaults for the configurable cadences (also the clamp anchors).
static const uint16_t DEF_SUMMER_HB_SEC = 60;
static const uint16_t DEF_SUMMER_RD_SEC = 900;
static const uint16_t DEF_WINTER_HB_SEC = 60;
static const uint16_t DEF_WINTER_RD_SEC = 3600;

// Apply the defaults for the newer fields to a State (call before load() so an
// older /cal.txt that lacks these keys still ends up with sane cadences).
inline void seedDefaults(State& s) {
    s.summerHeartbeatSec = DEF_SUMMER_HB_SEC;
    s.summerReadingSec   = DEF_SUMMER_RD_SEC;
    s.winterHeartbeatSec = DEF_WINTER_HB_SEC;
    s.winterReadingSec   = DEF_WINTER_RD_SEC;
    s.debugLog           = 0;
}

inline bool begin() {
    return InternalFS.begin();
}

// Loads state into `out` if /cal.txt exists. Returns true on successful parse.
// Untouched fields keep their pre-call values, so caller seeds defaults first.
inline bool load(State& out) {
    File f(InternalFS);
    if (!f.open(PATH, FILE_O_READ)) return false;
    char buf[320] = {0};
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
        else if (!strncmp(line, "shb=",  4)) out.summerHeartbeatSec = (uint16_t)atoi(line + 4);
        else if (!strncmp(line, "srd=",  4)) out.summerReadingSec   = (uint16_t)atoi(line + 4);
        else if (!strncmp(line, "whb=",  4)) out.winterHeartbeatSec = (uint16_t)atoi(line + 4);
        else if (!strncmp(line, "wrd=",  4)) out.winterReadingSec   = (uint16_t)atoi(line + 4);
        else if (!strncmp(line, "dbg=",  4)) out.debugLog           = (uint8_t)atoi(line + 4);
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
    char buf[320];
    int n = snprintf(buf, sizeof(buf),
                     "cal=%.4f\ntare=%ld\npid=%lu\nboot=%lu\ntz=%d\nbatcal=%.4f\n"
                     "shb=%u\nsrd=%u\nwhb=%u\nwrd=%u\ndbg=%u\nname=%s\n",
                     in.calFactor,
                     (long)in.tareOffset,
                     (unsigned long)in.packetId,
                     (unsigned long)in.bootCount,
                     (int)in.tzOffsetMin,
                     in.batCalFactor,
                     (unsigned)in.summerHeartbeatSec,
                     (unsigned)in.summerReadingSec,
                     (unsigned)in.winterHeartbeatSec,
                     (unsigned)in.winterReadingSec,
                     (unsigned)in.debugLog,
                     in.name);
    if (n <= 0) { f.close(); return false; }
    f.write((const uint8_t*)buf, n);
    f.close();
    return true;
}

} // namespace OAPersist
