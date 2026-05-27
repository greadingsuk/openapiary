# Home Assistant integration

OpenApiary devices advertise as standard **BTHome v2 unencrypted** sensors, so
Home Assistant discovers them automatically — no custom integration needed.

## Requirements

- Home Assistant 2023.5+ (BTHome v2 support)
- A Bluetooth proxy or a host with a working BLE adapter within range of the hive

## Setup

1. Make sure the [Bluetooth integration](https://www.home-assistant.io/integrations/bluetooth/) is enabled.
2. Make sure the [BTHome integration](https://www.home-assistant.io/integrations/bthome/) is enabled.
3. Power on the scale. Within a couple of advert cycles (≤30 min) Home Assistant
   shows a discovery prompt: **"BTHome device discovered — OA-XXXX"**.
4. Click **Configure**. Each scale exposes:
   - `Weight` (kg, factor 0.01)
   - `Voltage` (V, factor 0.001) — the LiPo battery voltage
   - `Packet ID` — monotonic counter for dedupe
   - `Temperature` (°C) — only on hives fitted with a DS18B20 (Phase 2)

## Dashboard ideas

- A `statistic-card` showing 24 h weight delta — net forage / consumption
- A line chart over 30 days for swarm prep visibility
- An alert when `voltage` drops below 3.5 V

## Encryption

OpenApiary v1 broadcasts unencrypted to keep the open-source pitch simple and
to enable HA auto-discovery. If hive privacy becomes a concern, the BTHome v2
spec supports AES-CCM with a 16-byte device key — upgrade path is in
[`migration-plan.md` §9](migration-plan.md).
