/*
 * ============================================================
 *  Smart Medicine Dispenser Firmware v3.0
 *  Board:   NodeMCU ESP8266 (ESP-12E/F)
 *  Mode:    Always-ON (no deep sleep)
 * ============================================================
 */

#include <Wire.h>
#include <RTClib.h>
#include <Servo.h>
#include <ESP8266WiFi.h>
#include <ESP8266HTTPClient.h>
#include <WiFiClient.h>
#include <WiFiUdp.h>
#include <NTPClient.h>
#include <ArduinoJson.h>
#include <EEPROM.h>

// ── NTP ────────────────────────────────────────────────────────
#define IST_OFFSET 19800    // UTC+5:30
WiFiUDP   ntpUDP;
NTPClient ntp(ntpUDP, "pool.ntp.org", IST_OFFSET, 60000);

// ── CONFIG ─────────────────────────────────────────────────────
const char* WIFI_SSID    = "Rana Family";
const char* WIFI_PASS    = "jc766371p";
const char* SERVER_HOST  = "http://192.168.31.98:3000";
const char* BED_ID       = "BED-01";

// ── TIMING ─────────────────────────────────────────────────────
const uint32_t WIFI_TIMEOUT_MS   = 15000;  // 15s WiFi timeout
const uint32_t SYNC_INTERVAL_MIN = 1;      // re-sync every 1 min (fast nurse input)
const int32_t  PRE_WAKE_SEC      = 60;     // dispense when within 1 min
const int32_t  GRACE_PERIOD_SEC  = 300;    // max 5 min late allowed after reboot
const uint32_t MONITOR_SEC       = 180;    // watch for pickup for 3 min

// ── PINS ───────────────────────────────────────────────────────
#define PIN_SERVO   13  // D7
#define PIN_IR      12  // D6
#define PIN_IR_PWR  15  // D8 — powers IR only when reading
#define PIN_BUZZER  14  // D5

// ── SERVO ──────────────────────────────────────────────────────
#define SERVO_STOP        90
#define SERVO_DIR_FORWARD 45
#define SERVO_DIR_REVERSE 135
#define SERVO_ROTATE_MS   800

// ── IR ─────────────────────────────────────────────────────────
#define IR_TRAY_OCCUPIED LOW
#define IR_TRAY_EMPTY    HIGH

// ── EEPROM ─────────────────────────────────────────────────────
#define EEPROM_SIZE      1024
#define MAX_SCHEDULES    10
#define SLOT_SIZE        40
#define EEPROM_MAGIC     0xCAFE // Bumped: forces wipe of old EEPROM format (now saves dbId)
#define EEPROM_SLOT_START 2
// New EEPROM section for dispensed log starting at byte 400
#define EEPROM_LOG_START 400

// ── SCHEDULE ───────────────────────────────────────────────────
struct Schedule {
  bool    valid;
  uint8_t hour;
  uint8_t minute;
  uint8_t compartment;
  char    medicine[32];
  int     dbId;
};

Schedule localSchedules[MAX_SCHEDULES];
Schedule oldSchedules[MAX_SCHEDULES]; // global: avoids stack overflow in fetch function
int      scheduleCount = 0;

// ── DISPENSED LOG (PERSISTENT) ─────────────────────────────────
// Prevents re-dispensing same slot on the same day after reboot.
struct DispensedLog {
  uint8_t day;
  int     dbIds[MAX_SCHEDULES];
};
DispensedLog dispensedLog;

// ── OFFLINE LOG QUEUE ──────────────────────────────────────────
struct LogEntry { char medicine[32]; uint8_t compartment; char status[12]; int scheduleId; };
#define MAX_QUEUE 5
LogEntry logQueue[MAX_QUEUE];
int      queueCount = 0;

// ── MONITOR QUEUE ──────────────────────────────────────────────
struct MonitorItem {
  bool active;
  uint32_t startMs;
  int schedIdx;
};
MonitorItem monQueue[MAX_SCHEDULES];

// ── OBJECTS ────────────────────────────────────────────────────
RTC_DS3231 rtc;
Servo      servo;

// ═══════════════════════════════════════════════════════════════
// UTILITIES
// ═══════════════════════════════════════════════════════════════

void beep(int times, int onMs = 100, int offMs = 100) {
  for (int i = 0; i < times; i++) {
    digitalWrite(PIN_BUZZER, HIGH); delay(onMs);
    digitalWrite(PIN_BUZZER, LOW);
    if (i < times - 1) delay(offMs);
  }
}

// Detects a patient hand-grab:
// The IR must be blocked for MIN_GRAB_MS to MAX_GRAB_MS, then clear.
// This matches a quick grab (0.2s – 1.5s).
#define MIN_GRAB_MS   200   // hand must block for at least 200ms
#define MAX_GRAB_MS   2000  // hand must clear within 2s (not resting on it)

bool detectGrab() {
  // Step 1: Check if hand is currently blocking the IR
  if (digitalRead(PIN_IR) != IR_TRAY_OCCUPIED) return false;

  // Step 2: Time how long the hand stays blocking
  uint32_t grabStart = millis();
  while (digitalRead(PIN_IR) == IR_TRAY_OCCUPIED) {
    uint32_t elapsed = millis() - grabStart;
    if (elapsed > MAX_GRAB_MS) {
      Serial.println("⚠️  IR blocked too long (not a grab).");
      return false; // hand is resting, not grabbing
    }
    delay(10);
    yield();
  }

  // Step 3: Hand cleared. Was the block long enough to be intentional?
  uint32_t grabDuration = millis() - grabStart;
  Serial.printf("👋  IR block duration: %dms\n", grabDuration);
  return (grabDuration >= MIN_GRAB_MS);
}

DateTime getRTC() {
  Wire.begin(); delay(5);  // re-init I2C to prevent bus corruption after WiFi
  return rtc.now();
}

// ═══════════════════════════════════════════════════════════════
// EEPROM LOGGING
// ═══════════════════════════════════════════════════════════════

void saveDispensedLog() {
  EEPROM.begin(EEPROM_SIZE);
  EEPROM.put(EEPROM_LOG_START, dispensedLog);
  EEPROM.commit();
  EEPROM.end();
  Serial.println("💾  Dispensed log saved to EEPROM.");
}

void loadDispensedLog() {
  EEPROM.begin(EEPROM_SIZE);
  EEPROM.get(EEPROM_LOG_START, dispensedLog);
  EEPROM.end();
  // Validate data
  if (dispensedLog.day > 31) {
    dispensedLog.day = 255;
    for(int i=0; i<MAX_SCHEDULES; i++) dispensedLog.dbIds[i] = -1;
  }
}

bool isDispensedToday(int dbId, int schedIdx, uint8_t currentDay) {
  if (dispensedLog.day != currentDay) return false;
  // If dbId is 0 (e.g. string failed to parse), fallback to index-based unique ID
  int idToLog = (dbId > 0) ? dbId : (-10 - schedIdx);
  for (int i = 0; i < MAX_SCHEDULES; i++) {
    if (dispensedLog.dbIds[i] == idToLog) return true;
  }
  return false;
}

void markDispensedToday(int dbId, int schedIdx, uint8_t currentDay) {
  if (dispensedLog.day != currentDay) {
    dispensedLog.day = currentDay;
    for(int i=0; i<MAX_SCHEDULES; i++) dispensedLog.dbIds[i] = -1;
  }
  
  int idToLog = (dbId > 0) ? dbId : (-10 - schedIdx);
  bool saved = false;
  
  for (int i = 0; i < MAX_SCHEDULES; i++) {
    if (dispensedLog.dbIds[i] == idToLog) {
      saved = true; // Already marked!
      break;
    }
    if (dispensedLog.dbIds[i] == -1) {
      dispensedLog.dbIds[i] = idToLog;
      saved = true;
      break;
    }
  }
  
  if (!saved) {
    // Array full? Shift everything left and force insert at the end.
    for (int i = 1; i < MAX_SCHEDULES; i++) dispensedLog.dbIds[i-1] = dispensedLog.dbIds[i];
    dispensedLog.dbIds[MAX_SCHEDULES-1] = idToLog;
  }

  saveDispensedLog();
  Serial.printf("📝  Marked dose (ID: %d) as dispensed for Day %d.\n", idToLog, currentDay);
}

// ═══════════════════════════════════════════════════════════════
// WIFI
// ═══════════════════════════════════════════════════════════════

bool connectWiFi() {
  if (WiFi.status() == WL_CONNECTED) return true;
  Serial.printf("📶  Connecting to %s ", WIFI_SSID);
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  uint32_t t = millis();
  while (WiFi.status() != WL_CONNECTED) {
    if (millis() - t > WIFI_TIMEOUT_MS) { Serial.println("\n❌  WiFi timeout."); return false; }
    delay(300); Serial.print('.');
  }
  Serial.printf("\n✅  WiFi connected. IP: %s\n", WiFi.localIP().toString().c_str());
  return true;
}

void syncRTCFromNTP() {
  Serial.println("\n🌐  NTP sync...");
  ntp.begin();
  for (int i = 0; i < 5; i++) {
    Serial.printf("   attempt %d/5...\n", i + 1);
    if (ntp.forceUpdate()) {
      DateTime t(ntp.getEpochTime());
      rtc.adjust(t);
      Serial.printf("   ✅  Time set: %04d-%02d-%02d %02d:%02d:%02d IST\n",
                    t.year(), t.month(), t.day(), t.hour(), t.minute(), t.second());
      ntp.end();
      return;
    }
    delay(1500);
  }
  Serial.println("   ⚠️  NTP failed.");
  ntp.end();
}

void initRTC() {
  // BUG 1 FIX: Always attempt NTP sync at boot if WiFi is available.
  if (connectWiFi()) {
    syncRTCFromNTP();
  }
  DateTime now = getRTC();
  if (now.year() < 2024) {
    Serial.println("❌  FATAL: RTC year < 2024. Time is invalid. Halting.");
    while (true) {
      beep(1, 500, 1000);
      yield(); // keep WDT happy
    }
  }
}

// ═══════════════════════════════════════════════════════════════
// HTTP
// ═══════════════════════════════════════════════════════════════

bool httpPost(const String& ep, const String& body) {
  if (WiFi.status() != WL_CONNECTED) return false;
  WiFiClient c; HTTPClient h;
  h.begin(c, String(SERVER_HOST) + ep);
  h.addHeader("Content-Type", "application/json");
  h.setTimeout(8000);
  int code = h.POST(body);
  h.end();
  return code == 200 || code == 201;
}

String httpGet(const String& ep) {
  if (WiFi.status() != WL_CONNECTED) return "";
  WiFiClient c; HTTPClient h;
  h.begin(c, String(SERVER_HOST) + ep);
  h.setTimeout(10000);
  int code = h.GET();
  if (code != 200) { h.end(); return ""; }
  String body = h.getString(); h.end();
  return body;
}

// ═══════════════════════════════════════════════════════════════
// STATUS / QUEUE
// ═══════════════════════════════════════════════════════════════

bool sendStatus(const char* med, int comp, const char* status, int id = -1) {
  StaticJsonDocument<256> doc;
  doc["deviceId"]    = BED_ID;
  doc["medicine"]    = med;
  doc["compartment"] = comp;
  doc["status"]      = status;
  if (id >= 0) doc["scheduleId"] = id;
  String body; serializeJson(doc, body);
  bool ok = httpPost("/api/status/update", body);
  if (!ok && queueCount < MAX_QUEUE) {
    strncpy(logQueue[queueCount].medicine, med, 31);
    logQueue[queueCount].compartment = comp;
    strncpy(logQueue[queueCount].status, status, 11);
    logQueue[queueCount].scheduleId = id;
    queueCount++;
    Serial.println("📦  Queued for retry.");
  }
  return ok;
}

void flushQueue() {
  if (queueCount == 0) return;
  Serial.printf("📤  Flushing %d queued log(s)...\n", queueCount);
  int rem = 0;
  for (int i = 0; i < queueCount; i++) {
    bool ok = sendStatus(logQueue[i].medicine, logQueue[i].compartment, logQueue[i].status, logQueue[i].scheduleId);
    if (!ok && rem < MAX_QUEUE) logQueue[rem++] = logQueue[i];
  }
  queueCount = rem;
}

// ═══════════════════════════════════════════════════════════════
// EEPROM SCHEDULES
// ═══════════════════════════════════════════════════════════════

void saveSchedulesToEEPROM() {
  EEPROM.begin(EEPROM_SIZE);
  EEPROM.write(0, (EEPROM_MAGIC >> 8) & 0xFF);
  EEPROM.write(1,  EEPROM_MAGIC       & 0xFF);
  for (int i = 0; i < MAX_SCHEDULES; i++) {
    int b = EEPROM_SLOT_START + i * SLOT_SIZE;
    EEPROM.write(b+0, localSchedules[i].valid ? 1 : 0);
    EEPROM.write(b+1, localSchedules[i].hour);
    EEPROM.write(b+2, localSchedules[i].minute);
    EEPROM.write(b+3, localSchedules[i].compartment);
    uint8_t ml = strlen(localSchedules[i].medicine);
    EEPROM.write(b+4, ml);
    for (int j = 0; j < 31; j++)
      EEPROM.write(b+5+j, j < ml ? localSchedules[i].medicine[j] : 0);
    // Save dbId as 4 bytes (int) at b+36
    int id = localSchedules[i].dbId;
    EEPROM.write(b+36, (id >> 24) & 0xFF);
    EEPROM.write(b+37, (id >> 16) & 0xFF);
    EEPROM.write(b+38, (id >>  8) & 0xFF);
    EEPROM.write(b+39,  id        & 0xFF);
  }
  EEPROM.commit(); EEPROM.end();
  Serial.println("💾  Schedules saved to EEPROM.");
}

bool loadSchedulesFromEEPROM() {
  EEPROM.begin(EEPROM_SIZE);
  uint8_t m0 = EEPROM.read(0), m1 = EEPROM.read(1);
  if ((m0 << 8 | m1) != EEPROM_MAGIC) { EEPROM.end(); return false; }
  scheduleCount = 0;
  for (int i = 0; i < MAX_SCHEDULES; i++) {
    int b = EEPROM_SLOT_START + i * SLOT_SIZE;
    localSchedules[i].valid       = EEPROM.read(b+0) == 1;
    localSchedules[i].hour        = EEPROM.read(b+1);
    localSchedules[i].minute      = EEPROM.read(b+2);
    localSchedules[i].compartment = EEPROM.read(b+3);
    uint8_t ml = EEPROM.read(b+4);
    for (int j = 0; j < 31 && j < ml; j++)
      localSchedules[i].medicine[j] = (char)EEPROM.read(b+5+j);
    localSchedules[i].medicine[min((int)ml, 30)] = '\0';
    // Restore dbId from 4 bytes at b+36
    localSchedules[i].dbId = ((int)EEPROM.read(b+36) << 24) |
                             ((int)EEPROM.read(b+37) << 16) |
                             ((int)EEPROM.read(b+38) <<  8) |
                              (int)EEPROM.read(b+39);
    if (localSchedules[i].valid) scheduleCount++;
  }
  EEPROM.end();
  Serial.printf("💾  Loaded %d schedule(s) from EEPROM.\n", scheduleCount);
  return scheduleCount > 0;
}

// ═══════════════════════════════════════════════════════════════
// FETCH FROM SERVER
// ═══════════════════════════════════════════════════════════════

bool fetchScheduleFromServer() {
  String resp = httpGet(String("/api/schedules/device/") + BED_ID);
  if (resp.isEmpty()) return false;

  StaticJsonDocument<2048> doc;
  if (deserializeJson(doc, resp) || !doc["success"].as<bool>()) return false;

  JsonArray arr = doc["schedules"].as<JsonArray>();
  
  // Backup old schedules into global buffer to detect changes
  int oldScheduleCount = scheduleCount;
  for (int i = 0; i < MAX_SCHEDULES; i++) oldSchedules[i] = localSchedules[i];

  scheduleCount = 0;
  for (int i = 0; i < MAX_SCHEDULES; i++) localSchedules[i].valid = false;

  if (arr.size() == 0) {
    // Server intentionally sent empty schedule (all meds done/deleted)
    saveSchedulesToEEPROM();
    Serial.println("🗑️  Server sent empty schedule. EEPROM cleared.");
    return true; // Return true so it doesn't fall back to loading from EEPROM!
  }

  for (JsonObject s : arr) {
    if (scheduleCount >= MAX_SCHEDULES) break;
    const char* ts = s["dose_time"]; if (!ts) continue;
    int h = 0, m = 0; sscanf(ts, "%d:%d", &h, &m);
    localSchedules[scheduleCount].valid       = true;
    localSchedules[scheduleCount].hour        = h;
    localSchedules[scheduleCount].minute      = m;
    localSchedules[scheduleCount].compartment = s["compartment"].as<int>();
    localSchedules[scheduleCount].dbId        = s["id"].as<int>();
    strncpy(localSchedules[scheduleCount].medicine,
            s["medicine_name"].as<const char*>(), 31);
    localSchedules[scheduleCount].medicine[31] = '\0';
    Serial.printf("📋  [%d] %s at %02d:%02d (Raw DB: %s) Comp%d\n",
                  scheduleCount, localSchedules[scheduleCount].medicine, h, m, ts,
                  localSchedules[scheduleCount].compartment);
    scheduleCount++;
  }

  if (scheduleCount > 0) {
    bool changed = (scheduleCount != oldScheduleCount);
    if (!changed) {
      for (int i = 0; i < scheduleCount; i++) {
        if (localSchedules[i].dbId != oldSchedules[i].dbId ||
            localSchedules[i].hour != oldSchedules[i].hour ||
            localSchedules[i].minute != oldSchedules[i].minute ||
            localSchedules[i].compartment != oldSchedules[i].compartment ||
            strcmp(localSchedules[i].medicine, oldSchedules[i].medicine) != 0) {
          changed = true;
          break;
        }
      }
    }
    
    if (changed) {
      saveSchedulesToEEPROM();
    } else {
      Serial.println("💾  Database already in EEPROM (no changes).");
    }
  }
  return scheduleCount > 0;
}

// ═══════════════════════════════════════════════════════════════
// SERVO / DISPENSE
// ═══════════════════════════════════════════════════════════════

static int lastDispensedCompartment = 0;
static int lastRotationAngle = SERVO_DIR_FORWARD;

void runServo(int compartment) {
  servo.attach(PIN_SERVO);
  servo.write(SERVO_STOP); delay(300);
  
  if (lastDispensedCompartment != 0) {
    if (lastDispensedCompartment == compartment) {
      // Same compartment consecutively -> Reverse direction
      lastRotationAngle = (lastRotationAngle == SERVO_DIR_FORWARD) ? SERVO_DIR_REVERSE : SERVO_DIR_FORWARD;
      Serial.printf("⚙️  Servo: Rotating OPPOSITE (Same Comp: %d)\n", compartment);
    } else {
      // Different compartment -> Keep same direction
      Serial.printf("⚙️  Servo: Rotating SAME DIRECTION (Target: %d, Last: %d)\n", compartment, lastDispensedCompartment);
    }
  } else {
    // First time -> Forward direction
    Serial.printf("⚙️  Servo: Rotating FORWARD (First dispense, Target: %d)\n", compartment);
  }
  
  servo.write(lastRotationAngle); delay(SERVO_ROTATE_MS);
  servo.write(SERVO_STOP); delay(200);
  servo.write(SERVO_STOP); delay(300);
  servo.detach();
  
  lastDispensedCompartment = compartment;
}

// ═══════════════════════════════════════════════════════════════
// FIND NEXT SCHEDULE
// ═══════════════════════════════════════════════════════════════

// Returns index of the next due schedule not yet dispensed today.
// Returns -1 if all done for today.
int findNextSchedule(DateTime& now) {
  if (dispensedLog.day != now.day()) {
    dispensedLog.day = now.day();
    for(int i=0; i<MAX_SCHEDULES; i++) dispensedLog.dbIds[i] = -1;
    saveDispensedLog();
    Serial.println("📅  New day — dispensed flags reset.");
  }

  int     nearest = -1;
  int32_t minDist = INT32_MAX;
  int32_t nowSec  = now.hour() * 3600 + now.minute() * 60 + now.second();

  for (int i = 0; i < MAX_SCHEDULES; i++) {
    if (!localSchedules[i].valid) continue;
    if (isDispensedToday(localSchedules[i].dbId, i, now.day())) continue;
    int32_t doseSec = localSchedules[i].hour * 3600 + localSchedules[i].minute * 60;
    int32_t diff    = doseSec - nowSec;
    if (diff < -GRACE_PERIOD_SEC) diff += 86400; // wrap to tomorrow
    
    if (diff < minDist) { minDist = diff; nearest = i; }
  }
  return nearest;
}

// ═══════════════════════════════════════════════════════════════
// SETUP
// ═══════════════════════════════════════════════════════════════

void setup() {
  // Stop servo immediately on boot
  servo.attach(PIN_SERVO);
  servo.write(SERVO_STOP);
  delay(100);
  servo.detach();

  Serial.begin(115200);
  delay(300);
  Serial.println("\n\n============================================");
  Serial.println("   Smart Medicine Dispenser v3.0");
  Serial.printf ("   Bed: %s\n", BED_ID);
  Serial.println("============================================\n");

  pinMode(PIN_IR,     INPUT);
  pinMode(PIN_BUZZER, OUTPUT); digitalWrite(PIN_BUZZER, LOW);
  pinMode(PIN_IR_PWR, OUTPUT); digitalWrite(PIN_IR_PWR, LOW); // Controlled by loop

  Wire.begin();
  if (!rtc.begin()) {
    Serial.println("❌  DS3231 NOT FOUND! Check D2=SDA D1=SCL");
    beep(10, 50, 50);
  } else {
    Serial.println("✅  DS3231 found.");
    if (rtc.lostPower()) {
      rtc.adjust(DateTime(F(__DATE__), F(__TIME__)));
      Serial.println("⚠️  RTC lost power — set to compile time.");
    }
    rtc.disable32K();
    rtc.clearAlarm(1);
    rtc.clearAlarm(2);
  }

  for(int i=0; i<MAX_SCHEDULES; i++) monQueue[i].active = false;
  loadDispensedLog();
  initRTC(); // BUG 1 FIX

  beep(1, 200, 0);
}

// ═══════════════════════════════════════════════════════════════
// LOOP — runs forever, non-blocking
// ═══════════════════════════════════════════════════════════════

void loop() {
  static uint32_t lastSyncMs = 0;
  static uint32_t lastTickMs = 0;
  static bool     firstRun   = true;

  // Are we monitoring anything?
  bool monitoring = false;
  for(int i=0; i<MAX_SCHEDULES; i++) {
    if(monQueue[i].active) {
      monitoring = true;
      break;
    }
  }

  // If monitoring, poll IR for a hand-grab event.
  if (monitoring) {
    bool grabbed = detectGrab();
    uint32_t mnow = millis();

    if (grabbed) {
      // Valid grab detected → TAKEN
      Serial.println("✅  Medicine TAKEN!");
      beep(2, 200, 100);
      for (int i = 0; i < MAX_SCHEDULES; i++) {
        if (monQueue[i].active) {
          if (connectWiFi()) sendStatus(localSchedules[monQueue[i].schedIdx].medicine,
                                        localSchedules[monQueue[i].schedIdx].compartment,
                                        "TAKEN", localSchedules[monQueue[i].schedIdx].dbId);
          monQueue[i].active = false;
        }
      }
    } else {
      // No grab yet — check for timeout on each monitored item
      for (int i = 0; i < MAX_SCHEDULES; i++) {
        if (monQueue[i].active) {
          uint32_t elapsed = mnow - monQueue[i].startMs;
          if (elapsed > MONITOR_SEC * 1000UL) {
            Serial.println("🚨  TIMEOUT — NOT_TAKEN!");
            beep(6, 300, 100);
            if (connectWiFi()) sendStatus(localSchedules[monQueue[i].schedIdx].medicine,
                                          localSchedules[monQueue[i].schedIdx].compartment,
                                          "NOT_TAKEN", localSchedules[monQueue[i].schedIdx].dbId);
            monQueue[i].active = false;
            digitalWrite(PIN_IR_PWR, LOW);
          }
        }
      }
    }
    yield();
    // Intentionally NOT returning here, so that the rest of the loop can sync WiFi
    // and dispense upcoming medicines even if the patient hasn't picked up the first one!
  }

  // BUG 2 FIX: Non-blocking 1s tick
  uint32_t nowMs = millis();
  if (nowMs - lastTickMs < 1000) {
    yield();
    return;
  }
  lastTickMs = nowMs;

  // ── 1. Periodic sync ────────────────────────────────────────
  bool doSync = firstRun || (nowMs - lastSyncMs >= (uint32_t)SYNC_INTERVAL_MIN * 60 * 1000UL);

  if (doSync) {
    firstRun   = false;
    lastSyncMs = nowMs;
    Serial.printf("\n🔄  Syncing... (%d min)\n", SYNC_INTERVAL_MIN);
    if (connectWiFi()) {
      syncRTCFromNTP();
      flushQueue();
      if (!fetchScheduleFromServer()) {
        Serial.println("⚠️  No server schedules — using EEPROM.");
        loadSchedulesFromEEPROM();
      }
    } else {
      Serial.println("⚠️  WiFi unavailable — using EEPROM.");
      loadSchedulesFromEEPROM();
    }
  }

  if (scheduleCount == 0) return;

  DateTime now = getRTC();
  if (now.year() < 2024) {
    Serial.println("⚠️  RTC read error (Year < 2024). Skipping loop.");
    return;
  }

  int32_t nowSec = now.hour() * 3600 + now.minute() * 60 + now.second();

// ── IR POWER LOGIC ───────────────────────────────────────────────
  // Only keep IR on if there's an ACTIVE monitor (medicine waiting to be picked up)
  bool shouldIrBeOn = false;
  uint32_t mnow = millis();
  
  for (int i = 0; i < MAX_SCHEDULES; i++) {
    if (monQueue[i].active) {
      uint32_t elapsed = mnow - monQueue[i].startMs;
      // Only keep IR on if monitor hasn't timed out yet
      if (elapsed < MONITOR_SEC * 1000UL) {
        shouldIrBeOn = true;
        break;
      }
    }
  }
  
  // Also turn on IR if upcoming dose within PRE_WAKE_SEC
  if (!shouldIrBeOn) {
    for (int i = 0; i < MAX_SCHEDULES; i++) {
      if (!localSchedules[i].valid) continue;
      if (isDispensedToday(localSchedules[i].dbId, i, now.day())) continue;
      int32_t doseSec = localSchedules[i].hour * 3600 + localSchedules[i].minute * 60;
      int32_t diff    = doseSec - nowSec;
      if (diff < -GRACE_PERIOD_SEC) diff += 86400; // wrap to tomorrow
      
      // If a schedule is due within the next PRE_WAKE_SEC (60s)
      if (diff >= -GRACE_PERIOD_SEC && diff <= (int32_t)PRE_WAKE_SEC) {
        shouldIrBeOn = true;
        break;
      }
    }
  }
  digitalWrite(PIN_IR_PWR, shouldIrBeOn ? HIGH : LOW);

  // ── 2. Check ALL remaining schedules for any due NOW ─────────

  for (int i = 0; i < MAX_SCHEDULES; i++) {
    if (!localSchedules[i].valid)  continue;
    if (isDispensedToday(localSchedules[i].dbId, i, now.day())) continue;

    int32_t doseSec = localSchedules[i].hour * 3600 + localSchedules[i].minute * 60;
    int32_t diff    = doseSec - nowSec;
    
    // Check if within the -GRACE_PERIOD to PRE_WAKE window.
    if (diff < -GRACE_PERIOD_SEC) diff += 86400; // wrap to tomorrow

    // Dispense window: exact time ±10s OR up to GRACE_PERIOD_SEC past due.
    // NOTE: PRE_WAKE_SEC is only used for IR power, NOT for dispensing.
    if (diff >= -GRACE_PERIOD_SEC && diff <= 10) {
      // ← Due now! Mark dispensed FIRST to prevent repeats
      markDispensedToday(localSchedules[i].dbId, i, now.day());

      Serial.printf("⏰  Dispensing [%d]: %s (Comp %d)\n",
                    i, localSchedules[i].medicine, localSchedules[i].compartment);
      beep(3, 150, 100);
      delay(500);
      runServo(localSchedules[i].compartment);
      delay(1000);

      // Report DISPENSED
      if (connectWiFi())
        sendStatus(localSchedules[i].medicine, localSchedules[i].compartment,
                   "DISPENSED", localSchedules[i].dbId);

      // Start non-blocking pickup monitor for THIS dose
      for(int q=0; q<MAX_SCHEDULES; q++) {
        if(!monQueue[q].active) {
          monQueue[q].active = true;
          monQueue[q].startMs = millis();
          monQueue[q].schedIdx = i;
          break;
        }
      }

      Serial.println("👁  Monitoring pickup (non-blocking)...");
    }
  }

  // ── 3. Print next upcoming dose periodically (every 15s) ─────
  static uint8_t printCounter = 0;
  if (++printCounter >= 15) {
    printCounter = 0;
    int nextIdx = findNextSchedule(now);
    if (nextIdx >= 0) {
      int32_t doseSec = localSchedules[nextIdx].hour * 3600 + localSchedules[nextIdx].minute * 60;
      int32_t diff    = doseSec - nowSec;
      if (diff < -GRACE_PERIOD_SEC) diff += 86400;
      Serial.printf("⏰  Next: %s at %02d:%02d — in %ds\n",
                    localSchedules[nextIdx].medicine,
                    localSchedules[nextIdx].hour,
                    localSchedules[nextIdx].minute, diff);
    } else {
      Serial.println("✅  All doses done for today.");
    }
  }
}
