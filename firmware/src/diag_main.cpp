// OpenApiary DIAG firmware — Seeed XIAO nRF52840 (Standard).
//
// Verbose USB-CDC serial menu + continuous BLE advertising. Used for bench
// debug; NOT for normal operation. Replaces production main.cpp via the
// xiaoble_diag PlatformIO env (see platformio.ini build_src_filter).
//
// Behaviour at a glance:
//   - Banner + top menu printed at boot.
//   - Status block auto-printed every 2 s.
//   - BLE advertises continuously at 1 Hz, name "OA-XXXX", BTHome service
//     data 0xFCD2 + custom GATT service 0xFFE0 (live notify channel).
//   - Single-char menu navigation with submenus.
//   - Last 8 boots logged to /diag.log on LittleFS.
//
// Production code (main.cpp) is unchanged.

#include <Arduino.h>
#include <bluefruit.h>
#include <nrf_soc.h>
#include <Adafruit_LittleFS.h>
#include <InternalFileSystem.h>
#include "hx711_helper.h"
#include "bthome.h"
#include "persist.h"

// Reuse the cal-mode CLI from production. Now returns on `exit`.
extern void enterCalibrationMode();

// ---- Pinout (matches main.cpp) ----
static const uint8_t PIN_HX711_DT  = D2;
static const uint8_t PIN_HX711_SCK = D3;
static const uint8_t PIN_VBAT_EN   = 14;

// ---- Globals ----
static OAPersist::State g_state = { -26913.0f, 0, 0, 0, "", 0, 1.0f, 60, 900, 60, 3600, 0 };
static uint32_t  g_resetReason = 0;
static char      g_devName[12] = "OA-????";
static bool      g_advertising = true;
static uint16_t  g_advInterval = 1600;   // units of 0.625 ms (1600 = 1 s)
static int8_t    g_txPower     = 0;
static bool      g_dcdcOn      = true;
static uint32_t  g_advCount    = 0;
static bool      g_findMeOn    = false;
static bool      g_streamOn    = false;

// Custom GATT service for live data stream (Radio menu `L`).
// 0xFFE0 / 0xFFE1 are unallocated 16-bit UUIDs commonly used for vendor demos.
static BLEService        g_streamSvc(0xFFE0);
static BLECharacteristic g_streamChar(0xFFE1);

// ---- Forward decls ----
static float  readBatteryVoltage();
static bool   vbusPresent();
static float  readDieTempC();
static int    batteryPctFromVoltage(float v);
static void   decodeResetReason(uint32_t r, char* out, size_t cap);
static void   diagLogAppend(uint32_t resetreas, float vbat, bool vbus);
static void   diagLogPrint();
static void   bleSetup();
static void   bleRebuildAdvert();
static void   printBanner();
static void   printTopMenu();
static void   printStatus();
static void   handleTopMenu(char k);
static void   handlePowerMenu();
static void   handleHX711Menu();
static void   handleRadioMenu();
static void   handleDiagMenu();
static void   handleFlashMenu();
static void   liveModePower();
static void   liveModeHX711();
static void   cornerTest();
static char   waitChar();
static bool   anyKey();

void setup() {
    // Capture + clear reset reason BEFORE anything else.
    g_resetReason = NRF_POWER->RESETREAS;
    NRF_POWER->RESETREAS = 0xFFFFFFFF;

    // USB-CDC always-on in diag (production gates this on VBUS).
    Serial.begin(115200);
    uint32_t t0 = millis();
    while (!Serial && (millis() - t0) < 5000) { delay(10); }

    // Filesystem + persisted cal/tare.
    OAPersist::begin();
    OAPersist::load(g_state);   // safe to ignore failure — defaults already seeded
    g_state.bootCount++;
    OAPersist::save(g_state);

    hx711_begin(PIN_HX711_DT, PIN_HX711_SCK, g_state.calFactor, g_state.tareOffset);

    // BLE up before we read MAC for device name.
    bleSetup();

    // DCDC regulator on by default (matches production).
    sd_power_dcdc_mode_set(NRF_POWER_DCDC_ENABLE);

    // Brown-out warning at 2.7 V (chip BOR runs at ~1.7 V regardless).
    // SoftDevice-aware call; safe after Bluefruit.begin().
    sd_power_pof_threshold_set(NRF_POWER_THRESHOLD_V27);
    sd_power_pof_enable(1);

    // Append boot record to /diag.log (last 8).
    diagLogAppend(g_resetReason, readBatteryVoltage(), vbusPresent());

    printBanner();
    printTopMenu();
}

void loop() {
    static uint32_t lastStatus = 0;
    static uint32_t lastBlink  = 0;
    static uint32_t lastStream = 0;
    static bool     ledOn = false;

    // Auto status every 2 s.
    if (millis() - lastStatus >= 2000) {
        lastStatus = millis();
        printStatus();
    }

    // Find-me LED blink (250 ms toggle).
    if (g_findMeOn && (millis() - lastBlink >= 250)) {
        lastBlink = millis();
        ledOn = !ledOn;
        // XIAO BLE LEDs are active-LOW. LED_BUILTIN == LED_RED on this variant.
        digitalWrite(LED_BUILTIN, ledOn ? LOW : HIGH);
    } else if (!g_findMeOn && ledOn) {
        ledOn = false;
        digitalWrite(LED_BUILTIN, HIGH);
    }

    // Live GATT notify stream at ~1 Hz.
    if (g_streamOn && Bluefruit.connected() && (millis() - lastStream >= 1000)) {
        lastStream = millis();
        long raw = hx711_read_raw_average(1);
        float kg = (raw - g_state.tareOffset) / g_state.calFactor;
        uint16_t mv = (uint16_t)constrain(lroundf(readBatteryVoltage() * 1000.0f), 0L, 65535L);
        uint8_t buf[16] = {0};
        memcpy(buf + 0, &raw, 4);
        int16_t kg100 = (int16_t)constrain(lroundf(kg * 100.0f), -32768L, 32767L);
        memcpy(buf + 4, &kg100, 2);
        memcpy(buf + 6, &mv, 2);
        buf[8] = vbusPresent() ? 1 : 0;
        uint16_t bc = (uint16_t)(g_state.bootCount & 0xFFFF);
        memcpy(buf + 9, &bc, 2);
        g_streamChar.notify(buf, sizeof(buf));
    }

    // Top-level menu input — single char, no Enter.
    if (Serial.available()) {
        char k = (char)Serial.read();
        if (k == '\r' || k == '\n') return;
        Serial.print(F("> "));
        Serial.println(k);
        handleTopMenu(k);
    }
}

// ---------------------------------------------------------------------------
// Helpers (battery, temp, vbus) — same algorithms as production main.cpp.
// ---------------------------------------------------------------------------

static float readBatteryVoltage() {
    pinMode(PIN_VBAT_EN, OUTPUT);
    digitalWrite(PIN_VBAT_EN, LOW);
    delay(2);
    analogReadResolution(12);
    uint32_t acc = 0;
    for (int i = 0; i < 20; i++) acc += analogRead(PIN_VBAT);
    digitalWrite(PIN_VBAT_EN, HIGH);
    pinMode(PIN_VBAT_EN, INPUT);
    float adc = acc / 20.0f;
    return adc * (3.0f / 4095.0f) * (2020.0f / 510.0f);
}

static bool vbusPresent() {
    return (NRF_POWER->USBREGSTATUS & POWER_USBREGSTATUS_VBUSDETECT_Msk) != 0;
}

static float readDieTempC() {
    NRF_TEMP->TASKS_START = 1;
    for (int i = 0; i < 1000 && !NRF_TEMP->EVENTS_DATARDY; i++) {}
    NRF_TEMP->EVENTS_DATARDY = 0;
    int32_t raw = (int32_t)NRF_TEMP->TEMP;
    NRF_TEMP->TASKS_STOP = 1;
    return raw * 0.25f;
}

static int batteryPctFromVoltage(float v) {
    if (v >= 4.20f) return 100;
    if (v >= 3.90f) return (int)(60 + (v - 3.90f) * (40.0f / 0.30f));
    if (v >= 3.70f) return (int)(25 + (v - 3.70f) * (35.0f / 0.20f));
    if (v >= 3.30f) return (int)( 0 + (v - 3.30f) * (25.0f / 0.40f));
    return 0;
}

static void decodeResetReason(uint32_t r, char* out, size_t cap) {
    if (r == 0) { snprintf(out, cap, "POR (clean boot)"); return; }
    char* p = out; size_t n = cap;
    int w = snprintf(p, n, "0x%08lX:", (unsigned long)r);
    if (w > 0 && (size_t)w < n) { p += w; n -= w; }
    auto add = [&](const char* tag) {
        int x = snprintf(p, n, " %s", tag);
        if (x > 0 && (size_t)x < n) { p += x; n -= x; }
    };
    if (r & (1u<<0))  add("RESETPIN");
    if (r & (1u<<1))  add("DOG");
    if (r & (1u<<2))  add("SREQ");
    if (r & (1u<<3))  add("LOCKUP");
    if (r & (1u<<16)) add("OFF");
    if (r & (1u<<17)) add("LPCOMP");
    if (r & (1u<<18)) add("DEBUG");
    if (r & (1u<<19)) add("NFC");
    if (r & (1u<<20)) add("VBUS");
}

// ---------------------------------------------------------------------------
// /diag.log — append boot record, cap at last 8 lines.
// ---------------------------------------------------------------------------

static const char* DIAG_LOG_PATH = "/diag.log";

static void diagLogAppend(uint32_t resetreas, float vbat, bool vbus) {
    using namespace Adafruit_LittleFS_Namespace;

    // Read existing lines (small file, fits in stack).
    char buf[600] = {0};
    {
        File f(InternalFS);
        if (f.open(DIAG_LOG_PATH, FILE_O_READ)) {
            f.read(buf, sizeof(buf) - 1);
            f.close();
        }
    }

    // Build new entry.
    char entry[160];
    char rr[64];
    decodeResetReason(resetreas, rr, sizeof(rr));
    snprintf(entry, sizeof(entry),
             "boot=%lu rr=%s vbat=%.3f vbus=%d\n",
             (unsigned long)g_state.bootCount, rr, vbat, vbus ? 1 : 0);

    // Concatenate + trim to last 8 lines.
    char combined[760];
    snprintf(combined, sizeof(combined), "%s%s", buf, entry);

    int lineCount = 0;
    for (char* p = combined; *p; p++) if (*p == '\n') lineCount++;

    char* keep = combined;
    while (lineCount > 8) {
        char* nl = strchr(keep, '\n');
        if (!nl) break;
        keep = nl + 1;
        lineCount--;
    }

    // Rewrite.
    InternalFS.remove(DIAG_LOG_PATH);
    File f(InternalFS);
    if (f.open(DIAG_LOG_PATH, FILE_O_WRITE)) {
        f.write((const uint8_t*)keep, strlen(keep));
        f.close();
    }
}

static void diagLogPrint() {
    using namespace Adafruit_LittleFS_Namespace;
    File f(InternalFS);
    if (!f.open(DIAG_LOG_PATH, FILE_O_READ)) {
        Serial.println(F("(no /diag.log yet)"));
        return;
    }
    char buf[640] = {0};
    f.read(buf, sizeof(buf) - 1);
    f.close();
    Serial.print(buf);
}

// ---------------------------------------------------------------------------
// BLE — connectable advert with BTHome service data + custom GATT service.
// ---------------------------------------------------------------------------

static void bleSetup() {
    Bluefruit.begin();
    Bluefruit.setTxPower(g_txPower);
    bthome_local_name(g_devName, sizeof(g_devName));
    Bluefruit.setName(g_devName);

    // Custom service for live notify stream.
    g_streamSvc.begin();
    g_streamChar.setProperties(CHR_PROPS_NOTIFY);
    g_streamChar.setPermission(SECMODE_OPEN, SECMODE_NO_ACCESS);
    g_streamChar.setFixedLen(16);
    g_streamChar.begin();

    bleRebuildAdvert();
}

static void bleRebuildAdvert() {
    Bluefruit.Advertising.stop();
    Bluefruit.Advertising.clearData();
    Bluefruit.ScanResponse.clearData();

    Bluefruit.Advertising.addFlags(BLE_GAP_ADV_FLAGS_LE_ONLY_GENERAL_DISC_MODE);

    // BTHome v2 service-data so any BLE scanner sees the same payload as
    // production firmware.
    uint8_t svcData[2 + 24];
    svcData[0] = (uint8_t)(BTHOME_SERVICE_UUID_16 & 0xFF);
    svcData[1] = (uint8_t)(BTHOME_SERVICE_UUID_16 >> 8);
    g_state.packetId++;
    size_t plen = bthome_build_payload(
        svcData + 2, sizeof(svcData) - 2,
        (uint8_t)(g_state.packetId & 0xFF),
        0.0f,                    // weight stub — diag isn't doing periodic HX711 reads
        readBatteryVoltage(),
        readDieTempC(),
        batteryPctFromVoltage(readBatteryVoltage()),
        vbusPresent() ? 1 : 0,
        (int)(g_state.bootCount & 0xFFFF));
    Bluefruit.Advertising.addData(BLE_GAP_AD_TYPE_SERVICE_DATA,
                                  svcData, (uint8_t)(2 + plen));

    Bluefruit.ScanResponse.addName();

    if (g_advertising) {
        Bluefruit.Advertising.setInterval(g_advInterval, g_advInterval);
        Bluefruit.Advertising.start(0);
    }
    g_advCount++;
}

// ---------------------------------------------------------------------------
// Output formatting — banner, menu, status block.
// ---------------------------------------------------------------------------

static void printBanner() {
    char rr[80];
    decodeResetReason(g_resetReason, rr, sizeof(rr));
    uint32_t mac0 = NRF_FICR->DEVICEADDR[0];
    uint32_t mac1 = NRF_FICR->DEVICEADDR[1] & 0xFFFF;

    Serial.println();
    Serial.println(F("================================================================="));
    Serial.println(F(" OpenApiary DIAG firmware"));
    Serial.print  (F(" Name: "));   Serial.print(g_devName);
    Serial.print  (F("   MAC: "));
    char macStr[20];
    snprintf(macStr, sizeof(macStr), "%04X:%08lX", (unsigned)mac1, (unsigned long)mac0);
    Serial.println(macStr);
    Serial.print  (F(" Boot count: ")); Serial.println(g_state.bootCount);
    Serial.print  (F(" Reset reason: ")); Serial.println(rr);
    Serial.println(F("================================================================="));
    Serial.println();
}

static void printTopMenu() {
    Serial.println();
    Serial.println(F("[ TOP MENU ]"));
    Serial.println(F("  s  Status snapshot"));
    Serial.println(F("  p  Power & battery"));
    Serial.println(F("  l  Load-cell (HX711)"));
    Serial.println(F("  r  Radio (BLE)"));
    Serial.println(F("  d  Diagnostics"));
    Serial.println(F("  f  Flash & filesystem"));
    Serial.println(F("  c  Calibration CLI (tare/cal/show/save/reboot/exit)"));
    Serial.println(F("  F  Toggle find-me LED blink"));
    Serial.println(F("  R  Reboot"));
    Serial.println(F("  ?  Re-show this menu"));
    Serial.print  (F("oa> "));
}

static void printStatus() {
    float vbat = readBatteryVoltage();
    int   pct  = batteryPctFromVoltage(vbat);
    float t    = readDieTempC();
    bool  vbus = vbusPresent();
    long  raw  = hx711_read_raw_average(1);
    float kg   = (raw - g_state.tareOffset) / g_state.calFactor;

    Serial.println();
    Serial.print(F("[status t=")); Serial.print(millis() / 1000.0f, 1); Serial.println(F("s]"));
    Serial.print(F("  vbat=")); Serial.print(vbat, 3);
    Serial.print(F("V ("));      Serial.print(pct);     Serial.print(F("%)"));
    Serial.print(F("  vbus=")); Serial.print(vbus ? "1" : "0");
    Serial.print(F("  die="));  Serial.print(t, 1);     Serial.println(F("C"));
    Serial.print(F("  hx711_raw=")); Serial.print(raw);
    Serial.print(F("  kg=")); Serial.println(kg, 3);
    Serial.print(F("  ble adv=")); Serial.print(g_advertising ? "ON" : "OFF");
    Serial.print(F(" interval=")); Serial.print(g_advInterval * 0.625f, 0); Serial.print(F("ms"));
    Serial.print(F(" txp=")); Serial.print(g_txPower); Serial.print(F("dBm"));
    Serial.print(F(" connected=")); Serial.print(Bluefruit.connected() ? "1" : "0");
    Serial.print(F(" stream=")); Serial.println(g_streamOn ? "ON" : "OFF");
    Serial.print(F("  heap_used=")); Serial.print(dbgHeapUsed());
    Serial.print(F("  stack_used=")); Serial.println(dbgStackUsed());
    Serial.print(F("oa> "));
}

// ---------------------------------------------------------------------------
// Top menu dispatch.
// ---------------------------------------------------------------------------

static void handleTopMenu(char k) {
    switch (k) {
        case 's': printStatus(); break;
        case 'p': handlePowerMenu(); break;
        case 'l': handleHX711Menu(); break;
        case 'r': handleRadioMenu(); break;
        case 'd': handleDiagMenu(); break;
        case 'f': handleFlashMenu(); break;
        case 'c':
            Serial.println(F("entering cal CLI — type `exit` to return"));
            enterCalibrationMode();
            // Reload state in case cal CLI changed it.
            OAPersist::load(g_state);
            hx711_begin(PIN_HX711_DT, PIN_HX711_SCK, g_state.calFactor, g_state.tareOffset);
            break;
        case 'F':
            g_findMeOn = !g_findMeOn;
            pinMode(LED_BUILTIN, OUTPUT);
            Serial.print(F("find-me LED: "));
            Serial.println(g_findMeOn ? "ON" : "OFF");
            break;
        case 'R':
            Serial.println(F("rebooting..."));
            delay(100);
            NVIC_SystemReset();
            break;
        case '?':
        default:
            printTopMenu();
            break;
    }
}

// ---------------------------------------------------------------------------
// Submenu: Power & battery.
// ---------------------------------------------------------------------------

static void handlePowerMenu() {
    Serial.println();
    Serial.println(F("[ POWER & BATTERY ]"));
    Serial.println(F("  v  Battery voltage + %"));
    Serial.println(F("  u  VBUS state + raw register"));
    Serial.println(F("  d  Die temperature"));
    Serial.println(F("  o  Toggle DCDC regulator"));
    Serial.println(F("  L  Live mode (1 Hz, any key to exit)"));
    Serial.println(F("  q  Back to top"));
    while (true) {
        Serial.print(F("power> "));
        char k = waitChar();
        Serial.println(k);
        switch (k) {
            case 'v': {
                float v = readBatteryVoltage();
                Serial.print(F("vbat=")); Serial.print(v, 3); Serial.print(F("V  "));
                Serial.print(batteryPctFromVoltage(v)); Serial.println(F("%"));
                break;
            }
            case 'u': {
                uint32_t r = NRF_POWER->USBREGSTATUS;
                Serial.print(F("USBREGSTATUS=0x")); Serial.print(r, HEX);
                Serial.print(F("  vbus=")); Serial.print(vbusPresent() ? "1" : "0");
                Serial.print(F("  outputrdy=")); Serial.println((r & 2) ? "1" : "0");
                break;
            }
            case 'd':
                Serial.print(F("die_temp=")); Serial.print(readDieTempC(), 2);
                Serial.println(F("C"));
                break;
            case 'o':
                g_dcdcOn = !g_dcdcOn;
                sd_power_dcdc_mode_set(g_dcdcOn ? NRF_POWER_DCDC_ENABLE : NRF_POWER_DCDC_DISABLE);
                Serial.print(F("DCDC=")); Serial.println(g_dcdcOn ? "ON" : "OFF");
                break;
            case 'L': liveModePower(); break;
            case 'q': Serial.println(F("(back)")); printTopMenu(); return;
            default:  Serial.println(F("?")); break;
        }
    }
}

static void liveModePower() {
    Serial.println(F("Live power telemetry @ 1 Hz — press any key to exit"));
    while (!anyKey()) {
        Serial.print(F("vbat=")); Serial.print(readBatteryVoltage(), 3);
        Serial.print(F("V die=")); Serial.print(readDieTempC(), 1);
        Serial.print(F("C vbus=")); Serial.println(vbusPresent() ? "1" : "0");
        delay(1000);
    }
    Serial.read();   // consume the keypress
    Serial.println(F("(exited live)"));
}

// ---------------------------------------------------------------------------
// Submenu: HX711.
// ---------------------------------------------------------------------------

static void handleHX711Menu() {
    Serial.println();
    Serial.println(F("[ HX711 LOAD-CELL ]"));
    Serial.println(F("  r  Single raw reading"));
    Serial.println(F("  m  Median-of-10 raw"));
    Serial.println(F("  k  Median-of-10 in kg"));
    Serial.println(F("  s  Show stored cal/tare"));
    Serial.println(F("  c  Corner test (TL/TR/BL/BR — checks load cell balance)"));
    Serial.println(F("  L  Live mode (1 Hz, any key to exit)"));
    Serial.println(F("  q  Back to top"));
    while (true) {
        Serial.print(F("hx711> "));
        char k = waitChar();
        Serial.println(k);
        switch (k) {
            case 'r': {
                long raw = hx711_read_raw_average(1);
                Serial.print(F("raw=")); Serial.println(raw);
                break;
            }
            case 'm': {
                long raw = hx711_read_raw_average(10);
                Serial.print(F("median(10)=")); Serial.println(raw);
                break;
            }
            case 'k': {
                long raw = hx711_read_raw_average(10);
                Serial.print(F("raw=")); Serial.print(raw);
                Serial.print(F(" net=")); Serial.print(raw - g_state.tareOffset);
                Serial.print(F(" kg="));  Serial.println(
                    (raw - g_state.tareOffset) / g_state.calFactor, 3);
                break;
            }
            case 's':
                Serial.print(F("cal=")); Serial.print(g_state.calFactor, 4);
                Serial.print(F(" tare=")); Serial.print(g_state.tareOffset);
                Serial.print(F(" pid=")); Serial.print(g_state.packetId);
                Serial.print(F(" boot=")); Serial.println(g_state.bootCount);
                break;
            case 'c': cornerTest(); break;
            case 'L': liveModeHX711(); break;
            case 'q': Serial.println(F("(back)")); printTopMenu(); return;
            default:  Serial.println(F("?")); break;
        }
    }
}

static void liveModeHX711() {
    Serial.println(F("Live HX711 @ 1 Hz — press any key to exit"));
    while (!anyKey()) {
        long raw = hx711_read_raw_average(5);
        float kg = (raw - g_state.tareOffset) / g_state.calFactor;
        Serial.print(F("raw=")); Serial.print(raw);
        Serial.print(F(" kg=")); Serial.println(kg, 3);
        delay(1000);
    }
    Serial.read();
    Serial.println(F("(exited live)"));
}

static void cornerTest() {
    Serial.println(F("CORNER TEST — press each corner one at a time when prompted."));
    Serial.println(F("Used to detect a bad cell or a wiring fault on the combinator."));
    Serial.println(F("Take baseline (no load on platform). Press any key when ready..."));
    while (!anyKey()) { delay(50); }
    Serial.read();
    long base = hx711_read_raw_average(20);
    Serial.print(F("baseline=")); Serial.println(base);

    const char* names[4] = { "TL (top-left)", "TR (top-right)",
                             "BL (bottom-left)", "BR (bottom-right)" };
    long deltas[4] = {0, 0, 0, 0};

    for (int i = 0; i < 4; i++) {
        Serial.print(F("Press "));   Serial.print(names[i]);
        Serial.println(F(" with a known weight (e.g. press firmly with thumb)..."));
        Serial.println(F("...press any key when corner is loaded."));
        while (!anyKey()) { delay(50); }
        Serial.read();
        long r = hx711_read_raw_average(20);
        deltas[i] = r - base;
        Serial.print(F("  "));   Serial.print(names[i]);
        Serial.print(F(" delta=")); Serial.println(deltas[i]);
        Serial.println(F("  release the corner, press any key for next..."));
        while (!anyKey()) { delay(50); }
        Serial.read();
    }

    // Compute average magnitude and flag any cell < 50% of mean.
    long absSum = 0;
    for (int i = 0; i < 4; i++) absSum += deltas[i] >= 0 ? deltas[i] : -deltas[i];
    long meanAbs = absSum / 4;

    Serial.println(F("--- corner balance ---"));
    for (int i = 0; i < 4; i++) {
        long a = deltas[i] >= 0 ? deltas[i] : -deltas[i];
        long pct = meanAbs > 0 ? (a * 100) / meanAbs : 0;
        Serial.print(F("  "));   Serial.print(names[i]);
        Serial.print(F(" delta=")); Serial.print(deltas[i]);
        Serial.print(F("  ")); Serial.print(pct); Serial.print(F("% of mean"));
        if (pct < 50) Serial.print(F("  <-- LOW (suspect bad cell or wire)"));
        Serial.println();
    }
    Serial.println(F("Healthy build: all four within ~70-130% of the mean."));
}

// ---------------------------------------------------------------------------
// Submenu: Radio (BLE).
// ---------------------------------------------------------------------------

static void handleRadioMenu() {
    Serial.println();
    Serial.println(F("[ RADIO / BLE ]"));
    Serial.println(F("  i  Advert info"));
    Serial.println(F("  t  Toggle advertising"));
    Serial.println(F("  f  Set advert interval (1=100ms 2=1s 3=5s)"));
    Serial.println(F("  p  TX power (1=-8 2=0 3=+4 4=+8)"));
    Serial.println(F("  L  Live GATT notify stream toggle (svc 0xFFE0 char 0xFFE1)"));
    Serial.println(F("  q  Back to top"));
    while (true) {
        Serial.print(F("radio> "));
        char k = waitChar();
        Serial.println(k);
        switch (k) {
            case 'i':
                Serial.print(F("name=")); Serial.println(g_devName);
                Serial.print(F("adv=")); Serial.print(g_advertising ? "ON" : "OFF");
                Serial.print(F(" interval=")); Serial.print(g_advInterval * 0.625f, 0);
                Serial.print(F("ms txp=")); Serial.print(g_txPower); Serial.println(F("dBm"));
                Serial.print(F("connected=")); Serial.print(Bluefruit.connected() ? "1" : "0");
                Serial.print(F(" stream=")); Serial.println(g_streamOn ? "ON" : "OFF");
                Serial.print(F("adv_count=")); Serial.println(g_advCount);
                break;
            case 't':
                g_advertising = !g_advertising;
                if (g_advertising) bleRebuildAdvert();
                else               Bluefruit.Advertising.stop();
                Serial.print(F("adv=")); Serial.println(g_advertising ? "ON" : "OFF");
                break;
            case 'f': {
                Serial.print(F("interval (1=100ms 2=1s 3=5s)? "));
                char c = waitChar(); Serial.println(c);
                if (c == '1') g_advInterval = 160;     // 100 ms
                else if (c == '2') g_advInterval = 1600;
                else if (c == '3') g_advInterval = 8000;
                else { Serial.println(F("?")); break; }
                bleRebuildAdvert();
                Serial.print(F("interval set to ")); Serial.print(g_advInterval * 0.625f, 0);
                Serial.println(F("ms"));
                break;
            }
            case 'p': {
                Serial.print(F("txp (1=-8 2=0 3=+4 4=+8)? "));
                char c = waitChar(); Serial.println(c);
                if      (c == '1') g_txPower = -8;
                else if (c == '2') g_txPower = 0;
                else if (c == '3') g_txPower = 4;
                else if (c == '4') g_txPower = 8;
                else { Serial.println(F("?")); break; }
                Bluefruit.setTxPower(g_txPower);
                Serial.print(F("txp=")); Serial.print(g_txPower); Serial.println(F("dBm"));
                break;
            }
            case 'L':
                g_streamOn = !g_streamOn;
                Serial.print(F("stream=")); Serial.println(g_streamOn ? "ON" : "OFF");
                if (g_streamOn) {
                    Serial.println(F("Connect from nRF Connect, subscribe to char 0xFFE1."));
                    Serial.println(F("Frame: int32 raw | int16 kg*100 | uint16 mV | u8 vbus | u16 boot"));
                }
                break;
            case 'q': Serial.println(F("(back)")); printTopMenu(); return;
            default:  Serial.println(F("?")); break;
        }
    }
}

// ---------------------------------------------------------------------------
// Submenu: Diagnostics.
// ---------------------------------------------------------------------------

static void handleDiagMenu() {
    Serial.println();
    Serial.println(F("[ DIAGNOSTICS ]"));
    Serial.println(F("  r  Reset history (/diag.log)"));
    Serial.println(F("  h  Free heap + stack used"));
    Serial.println(F("  i  Chip ID + MAC"));
    Serial.println(F("  R  Decode current RESETREAS bits captured at boot"));
    Serial.println(F("  q  Back to top"));
    while (true) {
        Serial.print(F("diag> "));
        char k = waitChar();
        Serial.println(k);
        switch (k) {
            case 'r': diagLogPrint(); break;
            case 'h':
                Serial.print(F("heap_used=")); Serial.print(dbgHeapUsed());
                Serial.print(F(" stack_used=")); Serial.println(dbgStackUsed());
                break;
            case 'i': {
                uint32_t mac0 = NRF_FICR->DEVICEADDR[0];
                uint32_t mac1 = NRF_FICR->DEVICEADDR[1] & 0xFFFF;
                uint32_t id0  = NRF_FICR->DEVICEID[0];
                uint32_t id1  = NRF_FICR->DEVICEID[1];
                char tmp[40];
                snprintf(tmp, sizeof(tmp), "MAC=%04X:%08lX",
                         (unsigned)mac1, (unsigned long)mac0);
                Serial.println(tmp);
                snprintf(tmp, sizeof(tmp), "DEVICEID=%08lX%08lX",
                         (unsigned long)id1, (unsigned long)id0);
                Serial.println(tmp);
                break;
            }
            case 'R': {
                char rr[80];
                decodeResetReason(g_resetReason, rr, sizeof(rr));
                Serial.print(F("RESETREAS @ boot = ")); Serial.println(rr);
                break;
            }
            case 'q': Serial.println(F("(back)")); printTopMenu(); return;
            default:  Serial.println(F("?")); break;
        }
    }
}

// ---------------------------------------------------------------------------
// Submenu: Flash & filesystem.
// ---------------------------------------------------------------------------

static void handleFlashMenu() {
    using namespace Adafruit_LittleFS_Namespace;
    Serial.println();
    Serial.println(F("[ FLASH & FILESYSTEM ]"));
    Serial.println(F("  c  cat /cal.txt"));
    Serial.println(F("  d  cat /diag.log"));
    Serial.println(F("  e  Erase /cal.txt (next boot uses defaults)"));
    Serial.println(F("  E  Erase /diag.log"));
    Serial.println(F("  q  Back to top"));
    while (true) {
        Serial.print(F("fs> "));
        char k = waitChar();
        Serial.println(k);
        switch (k) {
            case 'c': {
                File f(InternalFS);
                if (!f.open("/cal.txt", FILE_O_READ)) {
                    Serial.println(F("(no /cal.txt)"));
                    break;
                }
                char b[200] = {0};
                f.read(b, sizeof(b) - 1);
                f.close();
                Serial.print(b);
                break;
            }
            case 'd': diagLogPrint(); break;
            case 'e':
                InternalFS.remove("/cal.txt");
                Serial.println(F("/cal.txt removed"));
                break;
            case 'E':
                InternalFS.remove("/diag.log");
                Serial.println(F("/diag.log removed"));
                break;
            case 'q': Serial.println(F("(back)")); printTopMenu(); return;
            default:  Serial.println(F("?")); break;
        }
    }
}

// ---------------------------------------------------------------------------
// Tiny serial helpers.
// ---------------------------------------------------------------------------

static char waitChar() {
    while (!Serial.available()) { delay(5); }
    char c = (char)Serial.read();
    if (c == '\r' || c == '\n') return waitChar();
    return c;
}

static bool anyKey() {
    return Serial.available() > 0;
}
