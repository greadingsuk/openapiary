// On-device reading log — bounded flash ring buffers so the scale REMEMBERS its
// measurements between BLE connections. The phone drains the backlog on connect
// (see gatt_config.h history characteristic + main.cpp session loop), so a
// field device can go weeks between inspections without losing data — the iOS
// app can't background-scan every 60 s advert, so passive capture alone loses
// the gaps (see docs/ios-background-scanning.md).
//
// Two independent ring logs in the Adafruit InternalFS (LittleFS):
//   * WEIGHT ring  (/oa_wl.bin): 3-byte records {int16 weight_centi_kg, int8 temp_half_c}
//                                at the measurement cadence (15 min summer / 1 h winter).
//   * BATTERY ring (/oa_bl.bin): 1-byte records {uint8 (V-2.5)*50} hourly.
// Splitting battery out (logged hourly, not per reading) is what lets the weight
// ring stay 3 B/record and hold ~60 days of 15-minute data in the small
// (~20 KB usable) internal filesystem.
//
// Timestamps are NOT stored per record (that would need 4 extra bytes each and
// blow the storage budget). Instead each ring keeps a small ANCHOR table
// {seq, epoch, intervalSec}; the epoch of record `seq` is
//   anchor.epoch + (seq - anchor.seq) * anchor.intervalSec
// A fresh anchor is written on boot, on a cadence (season) change, or when the
// wall-clock is (re)seeded — so reboots and the summer/winter switch stay
// correctly timed. `seq` is a monotonic counter of every record ever appended;
// the physical slot is `seq % capacity` (oldest is overwritten when full).

#pragma once
#include <Arduino.h>
#include <Adafruit_LittleFS.h>
#include <InternalFileSystem.h>

namespace OALog {

using namespace Adafruit_LittleFS_Namespace;

static const uint16_t META_MAGIC   = 0x4C32;  // 'L2'
static const uint8_t  MAX_ANCHORS  = 8;

// Capacities chosen to fit the default ~20 KB usable InternalFS alongside
// /cal.txt: weight 5600*3 = 16.8 KB (~58 days @15 min), battery 1536*1 = 1.5 KB
// (~64 days @1 h). Metadata files are <100 B each.
static const uint16_t WLOG_CAP = 5600;
static const uint16_t BLOG_CAP = 1536;

struct Anchor {
    uint32_t seq;
    uint32_t epoch;
    uint16_t intervalSec;
};

// A fixed-record-size ring log backed by two files: <path> (the slot data) and
// <path>.m (metadata: nextSeq + anchor table). Not thread-safe; all calls come
// from the single main loop / GATT callback context.
struct RingLog {
    const char* dataPath;
    const char* metaPath;
    uint8_t     recSize;
    uint16_t    capacity;

    uint32_t nextSeq = 0;               // total records ever appended
    uint8_t  nAnchors = 0;
    Anchor   anchors[MAX_ANCHORS];

    RingLog(const char* dPath, const char* mPath, uint8_t rSize, uint16_t cap)
        : dataPath(dPath), metaPath(mPath), recSize(rSize), capacity(cap) {}

    uint32_t oldestSeq() const {
        return (nextSeq > capacity) ? (nextSeq - capacity) : 0;
    }

    // Epoch (UTC seconds) of a given record seq, or 0 if it can't be resolved
    // (no anchor at or before it — i.e. time was unknown when it was written).
    uint32_t epochOf(uint32_t seq) const {
        const Anchor* best = nullptr;
        for (uint8_t i = 0; i < nAnchors; i++) {
            if (anchors[i].seq <= seq && (!best || anchors[i].seq > best->seq)) {
                best = &anchors[i];
            }
        }
        if (!best) return 0;
        return best->epoch + (uint32_t)(seq - best->seq) * best->intervalSec;
    }

    void saveMeta() {
        InternalFS.remove(metaPath);
        File f(InternalFS);
        if (!f.open(metaPath, FILE_O_WRITE)) return;
        uint8_t buf[4 + 1 + 1 + MAX_ANCHORS * 10];
        size_t n = 0;
        buf[n++] = (uint8_t)(META_MAGIC & 0xFF);
        buf[n++] = (uint8_t)(META_MAGIC >> 8);
        buf[n++] = recSize;
        buf[n++] = 0;  // reserved
        buf[n++] = (uint8_t)(nextSeq & 0xFF);
        buf[n++] = (uint8_t)((nextSeq >> 8) & 0xFF);
        buf[n++] = (uint8_t)((nextSeq >> 16) & 0xFF);
        buf[n++] = (uint8_t)((nextSeq >> 24) & 0xFF);
        buf[n++] = nAnchors;
        for (uint8_t i = 0; i < nAnchors; i++) {
            uint32_t s = anchors[i].seq, e = anchors[i].epoch;
            uint16_t iv = anchors[i].intervalSec;
            buf[n++] = (uint8_t)(s); buf[n++] = (uint8_t)(s >> 8);
            buf[n++] = (uint8_t)(s >> 16); buf[n++] = (uint8_t)(s >> 24);
            buf[n++] = (uint8_t)(e); buf[n++] = (uint8_t)(e >> 8);
            buf[n++] = (uint8_t)(e >> 16); buf[n++] = (uint8_t)(e >> 24);
            buf[n++] = (uint8_t)(iv); buf[n++] = (uint8_t)(iv >> 8);
        }
        f.write(buf, n);
        f.close();
    }

    void loadMeta() {
        nextSeq = 0;
        nAnchors = 0;
        File f(InternalFS);
        if (!f.open(metaPath, FILE_O_READ)) return;
        uint8_t buf[4 + 1 + 1 + MAX_ANCHORS * 10];
        int got = f.read(buf, sizeof(buf));
        f.close();
        if (got < 9) return;
        uint16_t magic = (uint16_t)buf[0] | ((uint16_t)buf[1] << 8);
        if (magic != META_MAGIC) return;
        // buf[2] recSize, buf[3] reserved
        nextSeq = (uint32_t)buf[4] | ((uint32_t)buf[5] << 8) |
                  ((uint32_t)buf[6] << 16) | ((uint32_t)buf[7] << 24);
        uint8_t na = buf[8];
        if (na > MAX_ANCHORS) na = 0;  // corrupt — ignore anchor table
        size_t n = 9;
        for (uint8_t i = 0; i < na && (n + 10) <= (size_t)got; i++) {
            anchors[i].seq = (uint32_t)buf[n] | ((uint32_t)buf[n+1] << 8) |
                             ((uint32_t)buf[n+2] << 16) | ((uint32_t)buf[n+3] << 24);
            anchors[i].epoch = (uint32_t)buf[n+4] | ((uint32_t)buf[n+5] << 8) |
                               ((uint32_t)buf[n+6] << 16) | ((uint32_t)buf[n+7] << 24);
            anchors[i].intervalSec = (uint16_t)buf[n+8] | ((uint16_t)buf[n+9] << 8);
            n += 10;
            nAnchors++;
        }
    }

    // Ensure the data file exists at full size (sparse-filled with zeros).
    void ensureDataFile() {
        File f(InternalFS);
        if (f.open(dataPath, FILE_O_READ)) {
            uint32_t sz = f.size();
            f.close();
            if (sz >= (uint32_t)capacity * recSize) return;
        }
        // Create / grow: append zeros up to capacity*recSize.
        File w(InternalFS);
        if (!w.open(dataPath, FILE_O_WRITE)) return;
        uint8_t zeros[64] = {0};
        uint32_t target = (uint32_t)capacity * recSize;
        uint32_t have = w.size();
        while (have < target) {
            uint32_t chunk = target - have;
            if (chunk > sizeof(zeros)) chunk = sizeof(zeros);
            w.write(zeros, chunk);
            have += chunk;
        }
        w.close();
    }

    void begin() {
        loadMeta();
        ensureDataFile();
    }

    // Drop anchors that are no longer needed (their seq is below the oldest
    // still-stored record AND a later anchor already covers oldestSeq()).
    void pruneAnchors() {
        uint32_t old = oldestSeq();
        // Find the greatest anchor.seq <= old; that one must be kept.
        uint32_t keepSeq = 0; bool haveKeep = false;
        for (uint8_t i = 0; i < nAnchors; i++) {
            if (anchors[i].seq <= old && (!haveKeep || anchors[i].seq > keepSeq)) {
                keepSeq = anchors[i].seq; haveKeep = true;
            }
        }
        uint8_t w = 0;
        for (uint8_t i = 0; i < nAnchors; i++) {
            bool keep = anchors[i].seq > old || (haveKeep && anchors[i].seq == keepSeq);
            if (keep) anchors[w++] = anchors[i];
        }
        nAnchors = w;
    }

    void pushAnchor(uint32_t seq, uint32_t epoch, uint16_t intervalSec) {
        if (nAnchors < MAX_ANCHORS) {
            anchors[nAnchors++] = { seq, epoch, intervalSec };
        } else {
            // Full: drop the oldest, shift down, append.
            for (uint8_t i = 1; i < MAX_ANCHORS; i++) anchors[i-1] = anchors[i];
            anchors[MAX_ANCHORS - 1] = { seq, epoch, intervalSec };
        }
    }

    // Append one record. `epoch` is the current UTC epoch (0 = unknown).
    // A new anchor is written when the cadence changes, when the clock was just
    // (re)seeded, or on the very first anchored record.
    void append(const uint8_t* rec, uint32_t epoch, uint16_t intervalSec) {
        uint32_t thisSeq = nextSeq;

        if (epoch != 0) {
            bool needAnchor = (nAnchors == 0);
            if (!needAnchor) {
                const Anchor& last = anchors[nAnchors - 1];
                uint32_t predicted = last.epoch + (uint32_t)(thisSeq - last.seq) * last.intervalSec;
                // Re-anchor on cadence change or clock drift/reseed > 90 s.
                if (last.intervalSec != intervalSec) needAnchor = true;
                else if (epoch > predicted + 90 || epoch + 90 < predicted) needAnchor = true;
            }
            if (needAnchor) pushAnchor(thisSeq, epoch, intervalSec);
        }

        // Write the slot.
        File f(InternalFS);
        if (f.open(dataPath, FILE_O_WRITE)) {
            f.seek((uint32_t)(thisSeq % capacity) * recSize);
            f.write(rec, recSize);
            f.close();
        }

        nextSeq++;
        pruneAnchors();
        saveMeta();
    }

    // Read the record at a given seq into `out` (recSize bytes). Returns false
    // if the seq is outside the currently-stored window.
    bool readSeq(uint32_t seq, uint8_t* out) {
        if (seq < oldestSeq() || seq >= nextSeq) return false;
        File f(InternalFS);
        if (!f.open(dataPath, FILE_O_READ)) return false;
        f.seek((uint32_t)(seq % capacity) * recSize);
        int got = f.read(out, recSize);
        f.close();
        return got == recSize;
    }
};

// The two logs. Defined here (header-only project) as inline singletons.
inline RingLog& weightLog() {
    static RingLog r("/oa_wl.bin", "/oa_wl.m", 3, WLOG_CAP);
    return r;
}
inline RingLog& batteryLog() {
    static RingLog r("/oa_bl.bin", "/oa_bl.m", 1, BLOG_CAP);
    return r;
}

inline void begin() {
    weightLog().begin();
    batteryLog().begin();
}

// Append a full weight/temp measurement.
inline void logWeight(float weightKg, float tempC, uint32_t epoch, uint16_t intervalSec) {
    int16_t centi = (int16_t)constrain(lroundf(weightKg * 100.0f), -32768L, 32767L);
    int8_t  th    = (int8_t)constrain(lroundf(tempC * 2.0f), -128L, 127L);  // half-degrees
    uint8_t rec[3] = { (uint8_t)(centi & 0xFF), (uint8_t)((centi >> 8) & 0xFF), (uint8_t)th };
    weightLog().append(rec, epoch, intervalSec);
}

// Append a battery sample (hourly).
inline void logBattery(float volts, uint32_t epoch) {
    long b = lroundf((volts - 2.5f) * 50.0f);   // 0.02 V steps from 2.5 V
    uint8_t rec[1] = { (uint8_t)constrain(b, 0L, 255L) };
    batteryLog().append(rec, epoch, 3600);
}

// --- Time anchor across reboots -------------------------------------------
// The nRF has no battery-backed RTC, so millis() resets on every reboot. We
// persist the last-known epoch hourly; on boot the firmware restores it as a
// starting estimate so logs stay roughly timestamped and correctly SPACED
// (the interval is exact) until the app reconnects and seeds the true time,
// which writes a fresh anchor that realigns subsequent records. Absolute time
// can drift by the (unmeasured) downtime — corrected on the next app connect.
static const char* TIME_ANCHOR_PATH = "/oa_t.m";

inline void saveTimeAnchor(uint32_t epoch) {
    InternalFS.remove(TIME_ANCHOR_PATH);
    File f(InternalFS);
    if (!f.open(TIME_ANCHOR_PATH, FILE_O_WRITE)) return;
    uint8_t b[4] = { (uint8_t)epoch, (uint8_t)(epoch >> 8),
                     (uint8_t)(epoch >> 16), (uint8_t)(epoch >> 24) };
    f.write(b, 4);
    f.close();
}

inline uint32_t loadTimeAnchor() {
    File f(InternalFS);
    if (!f.open(TIME_ANCHOR_PATH, FILE_O_READ)) return 0;
    uint8_t b[4] = {0};
    int got = f.read(b, 4);
    f.close();
    if (got < 4) return 0;
    return (uint32_t)b[0] | ((uint32_t)b[1] << 8) |
           ((uint32_t)b[2] << 16) | ((uint32_t)b[3] << 24);
}

} // namespace OALog

