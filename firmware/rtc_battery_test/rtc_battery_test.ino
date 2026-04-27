#include <ESP8266WiFi.h>
#include <WiFiUdp.h>
#include <NTPClient.h>
#include <Servo.h>
#include <Wire.h>
#include <RTClib.h>

// --- WiFi Settings ---
const char* WIFI_SSID = "Rana Family";
const char* WIFI_PASS = "jc766371p";

// --- NTP Settings ---
#define IST_OFFSET 19800 // UTC+5:30
WiFiUDP ntpUDP;
NTPClient ntp(ntpUDP, "pool.ntp.org", IST_OFFSET, 60000);

// --- Servo Settings ---
#define PIN_SERVO D4   // NodeMCU D4 (GPIO2)
#define SERVO_STOP 90  // 90 stops a 360 continuous rotation servo
#define SERVO_SPIN 180 // 180 spins forward (0 spins backward)
// --- RTC ---
RTC_DS1307 rtc;

Servo myServo;

void setup() {
  Serial.begin(115200);
  delay(1000);
  Serial.println("\n\n=== 360 Servo Low Power Test ===");

  // 0. Initialize I2C and RTC
  Wire.begin();
  if (!rtc.begin()) {
    Serial.println("❌ DS1307 (HW-111) NOT FOUND! Check connections (SDA=D2, SCL=D1).");
    while (1) yield();
  }
  Serial.println("✅ DS1307 (HW-111) RTC found.");

  // 1. Initial Servo Stop (ensure it doesn't spin on boot)
  myServo.attach(PIN_SERVO);
  myServo.write(SERVO_STOP);
  delay(300);
  myServo.detach(); // Detach to save power and stop PWM jitter

  // 2. Connect to WiFi
  Serial.printf("📶 Connecting to WiFi: %s ", WIFI_SSID);
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  
  int attempts = 0;
  while (WiFi.status() != WL_CONNECTED && attempts < 20) {
    delay(500);
    Serial.print(".");
    attempts++;
  }

  // 3. Sync time if connected
  if (WiFi.status() == WL_CONNECTED) {
    Serial.println("\n✅ WiFi connected!");
    Serial.println("🌐 Syncing time from NTP server...");
    
    ntp.begin();
    if (ntp.forceUpdate()) {
      DateTime t(ntp.getEpochTime());
      rtc.adjust(t);
      Serial.println("✅ Time successfully synced from NTP to RTC!");
    } else {
      Serial.println("⚠️ NTP sync failed.");
    }
    ntp.end();
  }

  // 4. Disconnect WiFi to save power (Modem Sleep equivalent)
  Serial.println("💤 Turning off WiFi to save power...");
  WiFi.disconnect(true);
  WiFi.mode(WIFI_OFF);
  
  Serial.println("\n▶️ Starting Servo Loop...\n");
}

void loop() {
  DateTime now = rtc.now();
  Serial.printf("\n⏱️ Current RTC Time: %04d-%02d-%02d %02d:%02d:%02d\n", 
                now.year(), now.month(), now.day(), 
                now.hour(), now.minute(), now.second());

  Serial.println("⚙️ Waking up: Rotating 360 servo...");
  
  // Attach and rotate servo
  myServo.attach(PIN_SERVO);
  myServo.write(SERVO_SPIN);
  
  // Let it rotate for 2 seconds
  delay(2000); 

  // Stop servo
  Serial.println("🛑 Stopping servo...");
  myServo.write(SERVO_STOP);
  delay(300); // Give it time to register the stop signal
  
  // Detach servo completely to cut off PWM signal
  // This ensures 0 power consumption from the control signal and no drifting/jittering
  myServo.detach(); 
  
  // Sleep duration (You mentioned 5s and 10s, setting to 10 seconds here)
  Serial.println("💤 Sleeping for 2 seconds...");
  delay(2000);
}
