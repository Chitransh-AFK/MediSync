/* ============================================================
   servo_test.ino — Standalone Servo Pendulum Test
   Board : NodeMCU ESP8266
   Purpose: Test runServo() in isolation without the full
            medicine dispenser firmware running.

   Serial Commands (115200 baud):
     1  → Run Compartment 1 (CW swing → pause → CCW return)
     2  → Run Compartment 2 (CCW swing → pause → CW return)
     l  → Loop both compartments 5 times (drift test)
     s  → Stop servo immediately
   ============================================================ */

#include <Servo.h>

// ── PIN ────────────────────────────────────────────────────────
#define PIN_SERVO  13   // D7 on NodeMCU

// ── SERVO CONFIG (match your medicine_dispenser.ino values) ────
#define SERVO_STOP        90    // Neutral / dead-band center
#define SPEED_CW          75    // Clockwise speed
#define SPEED_CCW         105   // Counter-clockwise speed
#define SWING_TIME_160_MS 1700  // ms to rotate ~160°  ← adjust this!

Servo servo;
bool stopRequested = false;

// ── HELPERS ────────────────────────────────────────────────────
void servoStop() {
  servo.write(SERVO_STOP);
  delay(500);
  servo.detach();
  Serial.println("🛑 Servo stopped & detached.");
}

// ── MAIN SWING FUNCTION (exact copy from medicine_dispenser) ───
void runServo(int compartment) {
  stopRequested = false;

  Serial.printf("\n▶️  runServo(compartment=%d)\n", compartment);

  servo.attach(PIN_SERVO);
  servo.write(SERVO_STOP);
  delay(500); // Increased settle time before any movement

  if (compartment == 1) {
    // SLOT 1: Clockwise 160° then back
    Serial.println("⚙️  Slot 1: CW 160 -> Return");

    // Move Forward
    servo.write(SPEED_CW);
    delay(2000);

    // FIX: Stop briefly before reversing — prevents overshoot/drift from motor momentum
    servo.write(SERVO_STOP);
    delay(1000);


    // Move Backward (Return to start)
    servo.write(SPEED_CCW);
    delay(2000);
  }
  else if (compartment == 2) {
    // SLOT 2: Anti-clockwise 160° then back
    Serial.println("⚙️  Slot 2: CCW 160 -> Return");

    // Move Backward
    servo.write(SPEED_CCW);
    delay(2000);

    // FIX: Stop briefly before reversing — prevents overshoot/drift from motor momentum
    servo.write(SERVO_STOP);
    delay(1000);

    // Move Forward (Return to start)
    servo.write(SPEED_CW);
    delay(1990);
  }

  // Stop and Detach — hold longer so motor fully registers stop before PWM cuts off
  servo.write(SERVO_STOP);
  delay(1000); // Increased from 300ms to 500ms
  servo.detach();

  Serial.println("✅ Swing complete. Servo detached.");
}

// ── LOOP TEST (drift check — run N times and watch position) ───
void runDriftTest(int cycles) {
  Serial.printf("\n🔁 Starting drift test: %d cycles of Comp1 then Comp2...\n", cycles);
  for (int i = 1; i <= cycles; i++) {
    Serial.printf("\n── Cycle %d/%d ──\n", i, cycles);

    runServo(1);
    delay(1500); // Rest between swings

    runServo(2);
    delay(1500);

    // Check for 's' stop command between cycles
    if (Serial.available()) {
      char c = Serial.read();
      if (c == 's' || c == 'S') {
        Serial.println("⛔ Drift test interrupted by user.");
        servoStop();
        return;
      }
    }
  }
  Serial.println("\n✅ Drift test complete. Did the motor return to start? ☝️");
  Serial.println("   If position shifted: decrease SWING_TIME_160_MS or increase mid-stop delay.");
}

// ═══════════════════════════════════════════════════════════════
void setup() {
  Serial.begin(115200);
  delay(500);

  Serial.println("\n\n╔══════════════════════════════════════╗");
  Serial.println("║   MediSync — Servo Pendulum Tester  ║");
  Serial.println("╚══════════════════════════════════════╝");
  Serial.println("Commands: 1=Slot1  2=Slot2  l=LoopTest(5x)  s=Stop");
  Serial.println();
  Serial.printf("Config:\n");
  Serial.printf("  SERVO_STOP        = %d\n", SERVO_STOP);
  Serial.printf("  SPEED_CW          = %d\n", SPEED_CW);
  Serial.printf("  SPEED_CCW         = %d\n", SPEED_CCW);
  Serial.printf("  SWING_TIME_160_MS = %d ms\n\n", SWING_TIME_160_MS);

  // Boot check — ensure servo is stopped at startup
  servo.attach(PIN_SERVO);
  servo.write(SERVO_STOP);
  delay(500);
  servo.detach();
  Serial.println("✅ Servo initialized and stopped. Ready.");
}

void loop() {
  if (!Serial.available()) return;

  char cmd = Serial.read();
  // Flush any extra newline chars
  while (Serial.available()) Serial.read();

  switch (cmd) {
    case '1':
      Serial.println("\n→ Command: Compartment 1");
      runServo(1);
      break;

    case '2':
      Serial.println("\n→ Command: Compartment 2");
      runServo(2);
      break;

    case 'l':
    case 'L':
      runDriftTest(5);
      break;

    case 's':
    case 'S':
      servoStop();
      break;

    default:
      Serial.println("❓ Unknown command. Use: 1 | 2 | l | s");
      break;
  }

  Serial.println("\nReady. Send command (1 / 2 / l / s):");
}
