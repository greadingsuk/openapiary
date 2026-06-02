// BTHome v2 parser (unencrypted). Mirrors firmware/src/bthome.h byte layout.
// Spec: https://bthome.io/format/

export const BTHOME_SERVICE_UUID_16 = 0xfcd2;
export const BTHOME_SERVICE_UUID_128 = '0000fcd2-0000-1000-8000-00805f9b34fb';

export interface BTHomeReading {
  packetId?: number;
  weightKg?: number;
  batteryV?: number;
  tempC?: number;
}

// Parse a BTHome v2 service-data payload (without the 16-bit UUID prefix).
// First byte is the device-info byte (0x40 for v2 unencrypted, no trigger).
export function parseBTHome(payload: Uint8Array): BTHomeReading | null {
  if (payload.length < 1) return null;
  const info = payload[0];
  // v2 = bits 5-7 == 010 -> top nibble 0x40 mask 0xe0
  if ((info & 0xe0) !== 0x40) return null;
  if ((info & 0x01) !== 0) return null; // encrypted not supported

  const r: BTHomeReading = {};
  let i = 1;
  const dv = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);

  while (i < payload.length) {
    const id = payload[i++];
    switch (id) {
      case 0x00: // packet id, uint8
        if (i + 1 > payload.length) return r;
        r.packetId = payload[i];
        i += 1;
        break;
      case 0x02: // temp, int16 LE, *0.01
        if (i + 2 > payload.length) return r;
        r.tempC = dv.getInt16(i, true) / 100;
        i += 2;
        break;
      case 0x06: // weight, uint16 LE, *0.01 kg
        if (i + 2 > payload.length) return r;
        r.weightKg = dv.getUint16(i, true) / 100;
        i += 2;
        break;
      case 0x0c: // voltage, uint16 LE, *0.001 V
        if (i + 2 > payload.length) return r;
        r.batteryV = dv.getUint16(i, true) / 1000;
        i += 2;
        break;
      default:
        // Unknown object id - we can't safely skip without length tables. Bail.
        return r;
    }
  }
  return r;
}
