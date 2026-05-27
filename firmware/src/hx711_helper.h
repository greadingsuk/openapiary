// HX711 helper — reuses the v4 readWeight() algorithm:
//   * 10 samples, return median
//   * track max-min spread as a stability diagnostic
//   * friction guard: re-read once if delta > 5 kg vs last reading
// Power gating: SCK HIGH >=60us puts the HX711 into ~1 uA sleep.

#pragma once
#include <Arduino.h>
#include <HX711.h>

namespace {
    HX711  g_hx;
    uint16_t g_lastSpread_g = 0;
    float    g_lastWeight = NAN;
}

inline void hx711_begin(uint8_t dt, uint8_t sck, float calFactor, int32_t tareOffset) {
    g_hx.begin(dt, sck);
    g_hx.set_scale(calFactor);
    g_hx.set_offset(tareOffset);
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
