// BTHome v2 payload builder (unencrypted)
// Spec: https://bthome.io/format/
// Service UUID 0xFCD2. See docs/migration-plan.md §4.4.

#pragma once
#include <Arduino.h>
#include <math.h>

static const uint16_t BTHOME_SERVICE_UUID_16 = 0xFCD2;

// Object IDs (BTHome v2)
static const uint8_t BTHOME_OBJ_PACKET_ID  = 0x00;  // uint8
static const uint8_t BTHOME_OBJ_BATTERY_PC = 0x01;  // uint8, factor 1, %
static const uint8_t BTHOME_OBJ_TEMP_C     = 0x02;  // int16 LE, factor 0.01
static const uint8_t BTHOME_OBJ_WEIGHT_KG  = 0x06;  // uint16 LE, factor 0.01
static const uint8_t BTHOME_OBJ_VOLTAGE_V  = 0x0C;  // uint16 LE, factor 0.001
static const uint8_t BTHOME_OBJ_POWER_BIN  = 0x10;  // uint8 0/1 (we use 1 = USB/solar present = "charging")
static const uint8_t BTHOME_OBJ_COUNT_U16  = 0x3D;  // uint16 LE (we use for boot count)

// Device info byte: v2 (bits 5-7 = 010), unencrypted (bit 0 = 0), no trigger (bit 2 = 0)
//   0b 010 0 0 0 0 0 = 0x40
static const uint8_t BTHOME_DEVICE_INFO_V2_UNENC = 0x40;

// Build a BTHome v2 service-data payload.
// Returns the number of bytes written, or 0 on error.
// Order matters in BTHome - object IDs must appear in ascending order.
inline size_t bthome_build_payload(uint8_t* out, size_t outCap,
                                   uint8_t packetId,
                                   float weightKg,
                                   float batteryV,
                                   float tempC = NAN,
                                   int batteryPct = -1,        // -1 = omit
                                   int charging = -1,          // -1 = omit, 0 = no, 1 = yes
                                   int bootCount = -1) {       // -1 = omit
    if (!out || outCap < 12) return 0;
    size_t i = 0;

    // [0] device info
    out[i++] = BTHOME_DEVICE_INFO_V2_UNENC;

    // 0x00 packet id (uint8)
    out[i++] = BTHOME_OBJ_PACKET_ID;
    out[i++] = packetId;

    // 0x01 battery % (uint8) - omitted if < 0
    if (batteryPct >= 0 && (i + 2 <= outCap)) {
        out[i++] = BTHOME_OBJ_BATTERY_PC;
        out[i++] = (uint8_t)constrain(batteryPct, 0, 100);
    }

    // 0x02 temperature (int16 LE, factor 0.01)
    if (!isnan(tempC) && (i + 3 <= outCap)) {
        int16_t t = (int16_t)constrain(lroundf(tempC * 100.0f), -32768L, 32767L);
        out[i++] = BTHOME_OBJ_TEMP_C;
        out[i++] = (uint8_t)((uint16_t)t & 0xFF);
        out[i++] = (uint8_t)((uint16_t)t >> 8);
    }

    // 0x06 weight (uint16 LE, factor 0.01 kg)
    uint16_t w = (uint16_t)constrain(lroundf(weightKg * 100.0f), 0L, 65535L);
    out[i++] = BTHOME_OBJ_WEIGHT_KG;
    out[i++] = (uint8_t)(w & 0xFF);
    out[i++] = (uint8_t)(w >> 8);

    // 0x0C voltage (uint16 LE, factor 0.001 V)
    uint16_t mv = (uint16_t)constrain(lroundf(batteryV * 1000.0f), 0L, 65535L);
    out[i++] = BTHOME_OBJ_VOLTAGE_V;
    out[i++] = (uint8_t)(mv & 0xFF);
    out[i++] = (uint8_t)(mv >> 8);

    // 0x10 power binary (uint8 0/1) - "is USB/solar present"
    if (charging >= 0 && (i + 2 <= outCap)) {
        out[i++] = BTHOME_OBJ_POWER_BIN;
        out[i++] = charging ? 1 : 0;
    }

    // 0x3D count (uint16 LE) - boot count
    if (bootCount >= 0 && (i + 3 <= outCap)) {
        uint16_t bc = (uint16_t)constrain((long)bootCount, 0L, 65535L);
        out[i++] = BTHOME_OBJ_COUNT_U16;
        out[i++] = (uint8_t)(bc & 0xFF);
        out[i++] = (uint8_t)(bc >> 8);
    }

    return i;
}

// Fill `out` with "OA-XXXX" where XXXX = last 4 hex chars of the BLE MAC.
inline void bthome_local_name(char* out, size_t outCap) {
    uint32_t lo = NRF_FICR->DEVICEADDR[0];
    snprintf(out, outCap, "OA-%04X", (unsigned)(lo & 0xFFFF));
}
