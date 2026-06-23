// OpenApiary "Config" GATT service — exposed only during a short pairing window
// after boot so the phone app can (a) set a friendly display name and (b) seed
// the wall-clock time used for day/night wake scheduling. Between windows the
// scale stays advert-only and low-power.
//
// UUIDs MUST match app/src/lib/ble.ts:
//   Service : 0a000000-0a51-4000-b000-000000000001
//   Name    : 0a000001-0a51-4000-b000-000000000001  (utf-8, ≤16 bytes, write)
//   Time    : 0a000002-0a51-4000-b000-000000000001  (8 bytes: u32 epoch LE + i16 tzOffsetMin LE, write)

#pragma once
#include <Arduino.h>
#include <bluefruit.h>
#include "persist.h"

namespace OAConfig {

// 128-bit UUIDs are little-endian byte arrays in Bluefruit.
// String form 0a0000NN-0a51-4000-b000-000000000001.
static uint8_t UUID_SERVICE[16] = {
    0x01,0x00,0x00,0x00,0x00,0x00,0x00,0xb0,0x00,0x40,0x51,0x0a,0x00,0x00,0x00,0x0a
};
static uint8_t UUID_NAME[16] = {
    0x01,0x00,0x00,0x00,0x00,0x00,0x00,0xb0,0x00,0x40,0x51,0x0a,0x01,0x00,0x00,0x0a
};
static uint8_t UUID_TIME[16] = {
    0x01,0x00,0x00,0x00,0x00,0x00,0x00,0xb0,0x00,0x40,0x51,0x0a,0x02,0x00,0x00,0x0a
};

inline BLEService&        service()  { static BLEService s(UUID_SERVICE);        return s; }
inline BLECharacteristic& nameChar() { static BLECharacteristic c(UUID_NAME);    return c; }
inline BLECharacteristic& timeChar() { static BLECharacteristic c(UUID_TIME);    return c; }

// RAM time seed: epoch at the moment we were told, plus the millis() snapshot.
static volatile bool     g_haveTime  = false;
static volatile uint32_t g_seedEpoch = 0;
static volatile uint32_t g_seedMillis = 0;
static volatile bool     g_dirty = false;   // set when a write needs persisting

static OAPersist::State* g_state = nullptr;

// Current UTC epoch derived from the seed, or 0 if we've never been told the time.
inline uint32_t currentEpoch() {
    if (!g_haveTime) return 0;
    return g_seedEpoch + (uint32_t)((millis() - g_seedMillis) / 1000UL);
}

// Local hour 0-23 using the persisted tz offset, or -1 if time unknown.
inline int localHour() {
    uint32_t e = currentEpoch();
    if (e == 0) return -1;
    int32_t tz = g_state ? g_state->tzOffsetMin : 0;
    int32_t local = (int32_t)e + tz * 60;
    return (int)(((local / 3600) % 24 + 24) % 24);
}

// Name write: copy up to 16 bytes, NUL-terminate, mark dirty for persistence.
inline void onNameWrite(uint16_t /*conn*/, BLECharacteristic* chr, uint8_t* data, uint16_t len) {
    if (!g_state) return;
    uint16_t n = len > 16 ? 16 : len;
    memset(g_state->name, 0, sizeof(g_state->name));
    memcpy(g_state->name, data, n);
    g_state->name[16] = '\0';
    g_dirty = true;
    (void)chr;
}

// Time write: 8 bytes = u32 epoch (LE) + i16 tzOffsetMin (LE).
inline void onTimeWrite(uint16_t /*conn*/, BLECharacteristic* chr, uint8_t* data, uint16_t len) {
    if (len < 6) return;
    uint32_t epoch = (uint32_t)data[0] | ((uint32_t)data[1] << 8) |
                     ((uint32_t)data[2] << 16) | ((uint32_t)data[3] << 24);
    int16_t tz = (int16_t)((uint16_t)data[4] | ((uint16_t)data[5] << 8));
    g_seedEpoch = epoch;
    g_seedMillis = millis();
    g_haveTime = true;
    if (g_state) { g_state->tzOffsetMin = tz; g_dirty = true; }
    (void)chr;
}

// Register the service + characteristics. Call after Bluefruit.begin().
inline void begin(OAPersist::State* state) {
    g_state = state;

    service().begin();   // must begin the service before its characteristics

    nameChar().setProperties(CHR_PROPS_WRITE);
    nameChar().setPermission(SECMODE_OPEN, SECMODE_OPEN);
    nameChar().setMaxLen(16);
    nameChar().setWriteCallback(onNameWrite);
    nameChar().begin();

    timeChar().setProperties(CHR_PROPS_WRITE);
    timeChar().setPermission(SECMODE_OPEN, SECMODE_OPEN);
    timeChar().setMaxLen(8);
    timeChar().setWriteCallback(onTimeWrite);
    timeChar().begin();
}

// Returns true (and clears the flag) if a write needs flushing to flash.
inline bool takeDirty() {
    if (!g_dirty) return false;
    g_dirty = false;
    return true;
}

} // namespace OAConfig
