// Calibration CLI mode — entered when USB-VBUS detected at boot OR magnet on Hall sensor.
// See docs/migration-plan.md §4.5
//
// CLI commands (115200 baud):
//   tare              -> store current raw reading as offset
//   cal <known_kg>    -> compute and store new scale factor
//   show              -> dump stored cal/tare/version
//   reboot            -> exit cal mode
//
// Persistence: Adafruit InternalFS (LittleFS), file "/cal.txt"
// TODO: implement. Stub provided so the build links.

#include <Arduino.h>

void enterCalibrationMode() {
    Serial.begin(115200);
    while (!Serial) { delay(10); }
    Serial.println(F("OpenApiary calibration mode"));
    Serial.println(F("Commands: tare | cal <kg> | show | reboot"));
    // TODO: command loop
}
