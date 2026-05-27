// BTHome v2 payload builder (unencrypted)
// Spec: https://bthome.io/format/
// Service UUID 0xFCD2. See docs/migration-plan.md §4.4.

#pragma once
#include <Arduino.h>
#include <math.h>

static const uint16_t BTHOME_SERVICE_UUID_16 = 0xFCD2;

// Object IDs (BTHome v2)
static const uint8_t BTHOME_OBJ_PACKET_ID = 0x00;  // uint8
static const uint8_t BTHOME_OBJ_TEMP_C    = 0x02;  // int16 LE, factor 0.01
static const uint8_t BTHOME_OBJ_WEIGHT_KG = 0x06;  // uint16 LE, factor 0.01
static const uint8_t BTHOME_OBJ_VOLTAGE_V = 0x0C;  // uint16 LE, factor 0.001

// Device info byte: v2 (bits 5-7 = 010), unencrypted (bit 0 = 0), no trigger (bit 2 = 0)
//   0b 010 0 0 0 0 0 = 0x40
static const uint8_t BTHOME_DEVICE_INFO_V2_UNENC = 0x40;

// Build a BTHome v2 service-data payload.
// Returns the number of bytes written, or 0 on error.
inline size_t bthome_build_payload(uint8_t* out, size_t outCap,
                                   uint8_t packetId,
                                   float weightKg,
                                   float batteryV,
                                   float tempC = NAN) {
    if (!out || outCap < 12) return 0;
    size_t i = 0;

    // [0] device info
    out[i++] = BTHOME_DEVICE_INFO_V2_UNENC;

    // packet id (uint8)
    out[i++] = BTHOME_OBJ_PACKET_ID;
    out[i++] = packetId;

    // weight (uint16 LE, factor 0.01 kg)
    uint16_t w = (uint16_t)constrain(lroundf(weightKg * 100.0f), 0L, 65535L);
    out[i++] = BTHOME_OBJ_WEIGHT_KG;
    out[i++] = (uint8_t)(w & 0xFF);
    out[i++] = (uint8_t)(w >> 8);

    // voltage (uint16 LE, factor 0.001 V)
    uint16_t mv = (uint16_t)constrain(lroundf(batteryV * 1000.0f), 0L, 65535L);
    out[i++] = BTHOME_OBJ_VOLTAGE_V;
    out[i++] = (uint8_t)(mv & 0xFF);
    out[i++] = (uint8_t)(mv >> 8);

    // optional temperature
    if (!isnan(tempC) && (i + 3 <= outCap)) {
        int16_t t = (int16_t)constrain(lroundf(tempC * 100.0f), -32768L, 32767L);
        out[i++] = BTHOME_OBJ_TEMP_C;
        out[i++] = (uint8_t)((uint16_t)t & 0xFF);
        out[i++] = (uint8_t)((uint16_t)t >> 8);
    }

    return i;
}

// Fill `out` with "OA-XXXX" where XXXX = last 4 hex chars of the BLE MAC.
inline void bthome_local_name(char* out, size_t outCap) {
    extern uint32_t NRF_FICR_DEVICEADDR_low_helper();  // see main.cpp for impl, or use Bluefruit
    // Pragmatic fallback: read from NRF_FICR
    uint32_t lo = NRF_FICR->DEVICEADDR[0];
    snprintf(out, outCap, "OA-%04X", (unsigned)(lo & 0xFFFF));
}
