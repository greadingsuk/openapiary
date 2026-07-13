// HX711 helper — reuses the v4 readWeight() algorithm:
//   * 10 samples, return median
//   * track max-min spread as a stability diagnostic
//   * friction guard: re-read once if delta > 5 kg vs last reading
// Power gating: SCK HIGH >=60us puts the HX711 into ~1 uA sleep.

#pragma once
#include <Arduino.h>
#include <limits.h>
#include <HX711.h>

namespace {
    HX711  g_hx;
    uint16_t g_lastSpread_g = 0;
    float    g_lastWeight = NAN;
    uint8_t  g_dt_pin = 0;
    uint8_t  g_sck_pin = 0;
}

inline void hx711_begin(uint8_t dt, uint8_t sck, float calFactor, int32_t tareOffset) {
    g_dt_pin = dt;
    g_sck_pin = sck;
    g_hx.begin(dt, sck);
    g_hx.set_scale(calFactor);
    g_hx.set_offset(tareOffset);
}

// Custom raw read with timeout — bogde's HX711::read() calls wait_ready()
// with no timeout, which hangs when SoftDevice ISRs stretch SCK pulses past
// 60us (chip enters power-down, DOUT stays HIGH forever). Returns LONG_MIN
// on timeout.
inline long hx711_raw_read_timeout(uint32_t timeout_ms) {
    digitalWrite(g_sck_pin, LOW);
    uint32_t start = millis();
    while (digitalRead(g_dt_pin) == HIGH) {
        if (millis() - start > timeout_ms) return LONG_MIN;
        delay(1);
    }
    uint32_t value = 0;
    for (uint8_t i = 0; i < 24; i++) {
        noInterrupts();
        digitalWrite(g_sck_pin, HIGH);
        delayMicroseconds(1);
        value = (value << 1) | (digitalRead(g_dt_pin) == HIGH ? 1UL : 0UL);
        digitalWrite(g_sck_pin, LOW);
        interrupts();
        delayMicroseconds(1);
    }
    noInterrupts();
    digitalWrite(g_sck_pin, HIGH);
    delayMicroseconds(1);
    digitalWrite(g_sck_pin, LOW);
    interrupts();
    if (value & 0x800000UL) value |= 0xFF000000UL;
    return (long)(int32_t)value;
}

inline void hx711_sleep() {
    g_hx.power_down();   // drives SCK high, HX711 enters sleep (~1 uA)
}

inline float hx711_read_median(uint8_t samples) {
    g_hx.power_up();
    delay(400);  // first stable read after wake (see §4.3)

    if (samples == 0 || samples > 32) samples = 10;
    float buf[32];
    for (uint8_t i = 0; i < samples; i++) {
        buf[i] = g_hx.get_units(1);
    }
    // sort (insertion sort — small N)
    for (uint8_t i = 1; i < samples; i++) {
        float v = buf[i]; int8_t j = i - 1;
        while (j >= 0 && buf[j] > v) { buf[j+1] = buf[j]; j--; }
        buf[j+1] = v;
    }
    float median = buf[samples / 2];
    float spread = buf[samples - 1] - buf[0];
    g_lastSpread_g = (uint16_t)constrain(lroundf(spread * 1000.0f), 0L, 65535L);

    // Friction guard (see v4 main_v2.cpp L115)
    if (!isnan(g_lastWeight) && fabsf(median - g_lastWeight) > 5.0f) {
        delay(200);
        for (uint8_t i = 0; i < samples; i++) buf[i] = g_hx.get_units(1);
        for (uint8_t i = 1; i < samples; i++) {
            float v = buf[i]; int8_t j = i - 1;
            while (j >= 0 && buf[j] > v) { buf[j+1] = buf[j]; j--; }
            buf[j+1] = v;
        }
        median = buf[samples / 2];
    }
    g_lastWeight = median;
    return median;
}

inline uint16_t hx711_last_spread_g() { return g_lastSpread_g; }

// Raw helpers for calibration mode. Both wake the HX711, take an average of
// `samples` raw counts (no scale/offset applied), then leave the chip powered
// up so the caller can chain reads.
// Cache the last successful raw read. The HX711 + SoftDevice combination
// hangs in wait_ready() on consecutive read attempts, so we serve a cached
// value if the chip won't respond a second time. Reset via hx711_invalidate_cache().
namespace { long g_lastRawAvg = LONG_MIN; }

inline void hx711_invalidate_cache() { g_lastRawAvg = LONG_MIN; }

inline long hx711_read_raw_average(uint8_t samples) {
    if (samples == 0) samples = 10;
    Serial.print(F("[hx] pins dt=")); Serial.print(g_dt_pin);
    Serial.print(F(" sck=")); Serial.println(g_sck_pin); Serial.flush();
    pinMode(g_sck_pin, OUTPUT);
    pinMode(g_dt_pin, INPUT);
    digitalWrite(g_sck_pin, LOW);  // wake
    delay(400);
    Serial.print(F("[hx] dt after wake=")); Serial.println(digitalRead(g_dt_pin)); Serial.flush();
    long sum = 0;
    uint8_t got = 0;
    for (uint8_t i = 0; i < samples; i++) {
        long v = hx711_raw_read_timeout(500);
        if (v == LONG_MIN) {
            Serial.print(F("[hx] timeout at i=")); Serial.println(i); Serial.flush();
            break;
        }
        sum += v;
        got++;
    }
    if (got == 0) {
        return (g_lastRawAvg != LONG_MIN) ? g_lastRawAvg : 0;
    }
    long avg = sum / got;
    g_lastRawAvg = avg;
    return avg;
}

// Bench-diagnostic raw read: wakes the chip, takes `samples` raw counts and
// reports the average plus min/max so the caller can see per-sample scatter
// (noise). `outGot` receives the number of successful reads (0 = chip never
// responded). Leaves the chip powered up. Does NOT touch the g_lastRawAvg cache
// so a diagnostic sweep can't be masked by a stale value.
inline long hx711_read_raw_stats(uint8_t samples, long* outMin, long* outMax, uint8_t* outGot) {
    if (samples == 0) samples = 10;
    pinMode(g_sck_pin, OUTPUT);
    pinMode(g_dt_pin, INPUT);
    digitalWrite(g_sck_pin, LOW);  // wake
    delay(400);
    long sum = 0, mn = LONG_MAX, mx = LONG_MIN;
    uint8_t got = 0;
    for (uint8_t i = 0; i < samples; i++) {
        long v = hx711_raw_read_timeout(500);
        if (v == LONG_MIN) continue;
        sum += v; got++;
        if (v < mn) mn = v;
        if (v > mx) mx = v;
    }
    if (outGot) *outGot = got;
    if (got == 0) { if (outMin) *outMin = 0; if (outMax) *outMax = 0; return 0; }
    if (outMin) *outMin = mn;
    if (outMax) *outMax = mx;
    return sum / got;
}

inline void  hx711_set_scale(float f)   { g_hx.set_scale(f); }
inline void  hx711_set_offset(int32_t o){ g_hx.set_offset(o); }
inline float hx711_get_scale()          { return g_hx.get_scale(); }
inline int32_t hx711_get_offset()       { return g_hx.get_offset(); }
