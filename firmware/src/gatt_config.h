// OpenApiary "Config" GATT service — exposed only during a short pairing window
// after boot so the phone app can (a) set a friendly display name and (b) seed
// the wall-clock time used for day/night wake scheduling. Between windows the
// scale stays advert-only and low-power.
//
// UUIDs MUST match app/src/lib/ble.ts:
//   Service : 0a000000-0a51-4000-b000-000000000001
//   Name    : 0a000001-0a51-4000-b000-000000000001  (utf-8, ≤16 bytes, write)
//   Time    : 0a000002-0a51-4000-b000-000000000001  (8 bytes: u32 epoch LE + i16 tzOffsetMin LE, write)
//   Tare    : 0a000003-0a51-4000-b000-000000000001  (write any byte to tare now)
//   Sample  : 0a000004-0a51-4000-b000-000000000001  (write to refresh, then read 10-byte diagnostics payload)

#pragma once
#include <Arduino.h>
#include <bluefruit.h>
#include "persist.h"
#include "hx711_helper.h"
#include "reading_log.h"

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
static uint8_t UUID_TARE[16] = {
    0x01,0x00,0x00,0x00,0x00,0x00,0x00,0xb0,0x00,0x40,0x51,0x0a,0x03,0x00,0x00,0x0a
};
static uint8_t UUID_SAMPLE[16] = {
    0x01,0x00,0x00,0x00,0x00,0x00,0x00,0xb0,0x00,0x40,0x51,0x0a,0x04,0x00,0x00,0x0a
};
static uint8_t UUID_CALIB[16] = {
    0x01,0x00,0x00,0x00,0x00,0x00,0x00,0xb0,0x00,0x40,0x51,0x0a,0x06,0x00,0x00,0x0a
};

// History streaming (v1.0.9+): the phone drains the on-device reading log.
//   Ctrl (0a...07, write 5 bytes): [0]=stream (0=weight,1=battery), [1..4]=afterSeq u32 LE
//   Data (0a...08, notify): a run of fixed records, then a 1-byte 0x00 terminator.
//     weight record  (11B): seq u32 LE, epoch u32 LE, weight_centi i16 LE, temp_half i8
//     battery record (9B):  seq u32 LE, epoch u32 LE, batt u8
static uint8_t UUID_HCTRL[16] = {
    0x01,0x00,0x00,0x00,0x00,0x00,0x00,0xb0,0x00,0x40,0x51,0x0a,0x07,0x00,0x00,0x0a
};
static uint8_t UUID_HDATA[16] = {
    0x01,0x00,0x00,0x00,0x00,0x00,0x00,0xb0,0x00,0x40,0x51,0x0a,0x08,0x00,0x00,0x0a
};

inline BLEService&        service()  { static BLEService s(UUID_SERVICE);        return s; }
inline BLECharacteristic& nameChar() { static BLECharacteristic c(UUID_NAME);    return c; }
inline BLECharacteristic& timeChar() { static BLECharacteristic c(UUID_TIME);    return c; }
inline BLECharacteristic& tareChar() { static BLECharacteristic c(UUID_TARE);    return c; }
inline BLECharacteristic& sampleChar(){ static BLECharacteristic c(UUID_SAMPLE);  return c; }
inline BLECharacteristic& calibChar(){ static BLECharacteristic c(UUID_CALIB);   return c; }
inline BLECharacteristic& histCtrlChar(){ static BLECharacteristic c(UUID_HCTRL); return c; }
inline BLECharacteristic& histDataChar(){ static BLECharacteristic c(UUID_HDATA); return c; }

// RAM time seed: epoch at the moment we were told, plus the millis() snapshot.
static volatile bool     g_haveTime  = false;
static volatile uint32_t g_seedEpoch = 0;
static volatile uint32_t g_seedMillis = 0;
static volatile bool     g_dirty = false;   // set when a write needs persisting

static OAPersist::State* g_state = nullptr;

// History streaming request state (set by the ctrl-char write callback, served
// by pumpHistory() from the main.cpp session loop while connected).
static volatile bool     g_histPending = false;
static volatile uint8_t  g_histStream  = 0;   // 0 = weight, 1 = battery
static volatile uint32_t g_histAfterSeq = 0;

// Current UTC epoch derived from the seed, or 0 if we've never been told the time.
inline uint32_t currentEpoch() {
    if (!g_haveTime) return 0;
    return g_seedEpoch + (uint32_t)((millis() - g_seedMillis) / 1000UL);
}

// Seed the clock from a value (used on boot to restore the persisted time
// anchor, and internally by the Time-characteristic write). Marks time known.
inline void seedTime(uint32_t epoch) {
    if (epoch == 0) return;
    g_seedEpoch = epoch;
    g_seedMillis = millis();
    g_haveTime = true;
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

// Tare write: capture current raw as the zero offset, apply immediately, mark dirty.
inline void onTareWrite(uint16_t /*conn*/, BLECharacteristic* chr, uint8_t* /*data*/, uint16_t /*len*/) {
    if (!g_state) return;
    long raw = hx711_read_raw_average(20);
    g_state->tareOffset = raw;
    hx711_set_offset(raw);
    g_dirty = true;
    (void)chr;
}

// Sample write: refresh diagnostics payload for immediate read by the phone.
// Payload (10 bytes):
//   [0]    status (0=ok, 1=error)
//   [1]    reserved
//   [2..3] weight_centi_kg (int16 LE)
//   [4..5] spread_g (uint16 LE)
//   [6..9] raw_counts (int32 LE)
inline void onSampleWrite(uint16_t /*conn*/, BLECharacteristic* chr, uint8_t* /*data*/, uint16_t /*len*/) {
    uint8_t out[10] = {0};

    float kg = hx711_read_median(10);
    uint16_t spread = hx711_last_spread_g();
    long raw = hx711_read_raw_average(1);
    hx711_sleep();

    if (isnan(kg)) {
        out[0] = 1;
    } else {
        long centi = lroundf(kg * 100.0f);
        if (centi < -32768L) centi = -32768L;
        if (centi >  32767L) centi =  32767L;
        int16_t kgc = (int16_t)centi;
        int32_t r32 = (int32_t)raw;

        out[2] = (uint8_t)(kgc & 0xFF);
        out[3] = (uint8_t)((kgc >> 8) & 0xFF);
        out[4] = (uint8_t)(spread & 0xFF);
        out[5] = (uint8_t)((spread >> 8) & 0xFF);
        out[6] = (uint8_t)(r32 & 0xFF);
        out[7] = (uint8_t)((r32 >> 8) & 0xFF);
        out[8] = (uint8_t)((r32 >> 16) & 0xFF);
        out[9] = (uint8_t)((r32 >> 24) & 0xFF);
    }

    sampleChar().write(out, sizeof(out));
    (void)chr;
}

// Calibrate write: 4 bytes = IEEE-754 float (LE) = new scale factor. The app
// computes it from a known-weight delta (factor = raw_delta / known_kg), which
// works whether the scale is empty or already has a hive on it. The tare offset
// is left untouched so an in-field hive keeps its baseline.
inline void onCalibrateWrite(uint16_t /*conn*/, BLECharacteristic* chr, uint8_t* data, uint16_t len) {
    if (!g_state || len < 4) return;
    float f;
    memcpy(&f, data, 4);
    if (isfinite(f) && fabsf(f) > 1.0f) {
        g_state->calFactor = f;
        hx711_set_scale(f);
        g_dirty = true;
    }
    (void)chr;
}

// History ctrl write: 5 bytes = [0] stream (0=weight,1=battery) + [1..4] afterSeq u32 LE.
// Records the request; pumpHistory() (called from the main session loop) streams it.
inline void onHistCtrlWrite(uint16_t /*conn*/, BLECharacteristic* chr, uint8_t* data, uint16_t len) {
    if (len < 5) return;
    g_histStream = data[0] ? 1 : 0;
    g_histAfterSeq = (uint32_t)data[1] | ((uint32_t)data[2] << 8) |
                     ((uint32_t)data[3] << 16) | ((uint32_t)data[4] << 24);
    g_histPending = true;
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

    tareChar().setProperties(CHR_PROPS_WRITE);
    tareChar().setPermission(SECMODE_OPEN, SECMODE_OPEN);
    tareChar().setMaxLen(1);
    tareChar().setWriteCallback(onTareWrite);
    tareChar().begin();

    sampleChar().setProperties(CHR_PROPS_READ | CHR_PROPS_WRITE);
    sampleChar().setPermission(SECMODE_OPEN, SECMODE_OPEN);
    sampleChar().setFixedLen(10);
    uint8_t init[10] = {1, 0, 0, 0, 0, 0, 0, 0, 0, 0};
    sampleChar().write(init, sizeof(init));
    sampleChar().setWriteCallback(onSampleWrite);
    sampleChar().begin();

    calibChar().setProperties(CHR_PROPS_WRITE);
    calibChar().setPermission(SECMODE_OPEN, SECMODE_OPEN);
    calibChar().setMaxLen(4);
    calibChar().setWriteCallback(onCalibrateWrite);
    calibChar().begin();

    histCtrlChar().setProperties(CHR_PROPS_WRITE);
    histCtrlChar().setPermission(SECMODE_OPEN, SECMODE_OPEN);
    histCtrlChar().setMaxLen(5);
    histCtrlChar().setWriteCallback(onHistCtrlWrite);
    histCtrlChar().begin();

    histDataChar().setProperties(CHR_PROPS_NOTIFY);
    histDataChar().setPermission(SECMODE_OPEN, SECMODE_OPEN);
    histDataChar().setMaxLen(11);
    histDataChar().begin();
}

// Returns true (and clears the flag) if a write needs flushing to flash.
inline bool takeDirty() {
    if (!g_dirty) return false;
    g_dirty = false;
    return true;
}

// Notify one record with a few retries (the SoftDevice TX buffer holds only a
// handful of packets). Returns false if it couldn't be sent (e.g. disconnected
// or notifications not enabled) so the caller can stop.
inline bool histNotify(const uint8_t* buf, uint16_t len) {
    for (uint8_t attempt = 0; attempt < 20; attempt++) {
        if (!Bluefruit.connected()) return false;
        if (histDataChar().notify(buf, len)) return true;
        delay(10);
    }
    return false;
}

// Stream any pending history request over the data characteristic. Called from
// the main.cpp session loop while a phone is connected. Safe to call every
// iteration; does nothing unless a ctrl write set g_histPending. Streaming is
// resumable: the app tracks the highest seq it received and re-requests the
// remainder on the next connection, so a backlog larger than one session is
// fine.
inline void pumpHistory() {
    if (!g_histPending) return;
    g_histPending = false;
    if (!Bluefruit.connected()) return;

    const uint8_t stream = g_histStream;
    OALog::RingLog& log = (stream == 1) ? OALog::batteryLog() : OALog::weightLog();

    uint32_t start = g_histAfterSeq + 1;
    if (start < log.oldestSeq()) start = log.oldestSeq();

    uint8_t rec[3];
    for (uint32_t seq = start; seq < log.nextSeq; seq++) {
        if (!log.readSeq(seq, rec)) continue;
        uint32_t epoch = log.epochOf(seq);
        if (stream == 1) {
            uint8_t out[9];
            out[0] = (uint8_t)seq; out[1] = (uint8_t)(seq >> 8);
            out[2] = (uint8_t)(seq >> 16); out[3] = (uint8_t)(seq >> 24);
            out[4] = (uint8_t)epoch; out[5] = (uint8_t)(epoch >> 8);
            out[6] = (uint8_t)(epoch >> 16); out[7] = (uint8_t)(epoch >> 24);
            out[8] = rec[0];
            if (!histNotify(out, sizeof(out))) return;
        } else {
            uint8_t out[11];
            out[0] = (uint8_t)seq; out[1] = (uint8_t)(seq >> 8);
            out[2] = (uint8_t)(seq >> 16); out[3] = (uint8_t)(seq >> 24);
            out[4] = (uint8_t)epoch; out[5] = (uint8_t)(epoch >> 8);
            out[6] = (uint8_t)(epoch >> 16); out[7] = (uint8_t)(epoch >> 24);
            out[8] = rec[0]; out[9] = rec[1]; out[10] = rec[2];
            if (!histNotify(out, sizeof(out))) return;
        }
        if ((seq & 0x0F) == 0) delay(2);  // yield to the SoftDevice periodically
    }
    // Terminator: a 1-byte 0x00 notify signals "end of stream".
    uint8_t term = 0x00;
    histNotify(&term, 1);
}

} // namespace OAConfig

