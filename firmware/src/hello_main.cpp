// Minimal liveness probe. Prints "tick N" every 500ms over USB-CDC, forever.
// No Serial wait, no BLE, no LittleFS, no SoftDevice. Just confirms USB-CDC
// works and the chip is alive. Selected via env `xiaoble_hello`.

#include <Arduino.h>
#include <Adafruit_TinyUSB.h>

void setup() {
    Serial.begin(115200);
    pinMode(LED_RED, OUTPUT);
}

void loop() {
    static uint32_t n = 0;
    digitalWrite(LED_RED, (n & 1) ? HIGH : LOW);  // active-LOW: toggles
    Serial.print("tick ");
    Serial.println(n++);
    delay(500);
}
