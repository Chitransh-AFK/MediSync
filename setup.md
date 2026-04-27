# Smart Medicine Dispenser System - Setup Guide

This guide provides detailed instructions on how to set up the project and configure the hardware, including how to adjust the servo motor rotation settings.

## 1. Database Setup

1. Open MySQL Workbench or your preferred MySQL CLI.
2. Execute the provided schema file to create the database and tables:
   ```sql
   source database/schema.sql;
   ```

## 2. Backend Server Configuration

1. Navigate to the `backend` directory.
2. Create or edit the `.env` file to match your MySQL credentials:
   ```env
   DB_PASS=your_mysql_password
   PORT=3000
   ```
3. Install dependencies and start the server:
   ```bash
   cd backend
   npm install
   npm start
   ```
4. The API Server will run at `http://localhost:3000`. The frontend dashboard is statically served at the same URL.

## 3. NodeMCU (ESP8266) Firmware Setup

1. Open `firmware/medicine_dispenser/medicine_dispenser.ino` in the **Arduino IDE**.
2. Update the configuration variables at the top of the sketch (around **Line 26**):
   ```cpp
   const char* WIFI_SSID    = "Your_WiFi_SSID";
   const char* WIFI_PASS    = "Your_WiFi_Password";
   const char* SERVER_HOST  = "http://<YOUR_PC_IP_ADDRESS>:3000"; // Important: Change to your local IP
   const char* BED_ID       = "BED-01";
   ```
3. Install required libraries via the Arduino Library Manager (Tools -> Manage Libraries):
   - `ArduinoJson` by Benoit Blanchon
   - `RTClib` by Adafruit
   - `Servo` by Michael Margolis
4. Select your board: **NodeMCU 1.0 (ESP-12E Module)**.
5. Compile and Upload the code to your ESP8266.

---

## 🔌 Hardware Connections (NodeMCU)

> [!WARNING]
> **Safety First:** The firmware uses *modem sleep* instead of deep sleep. **Do NOT connect** the DS3231 INT/SQW pin to the ESP8266 RST pin, nor D0 to RST.

Make sure your hardware is wired according to the pins defined in the firmware:

| Component | NodeMCU Pin | Notes |
| :--- | :--- | :--- |
| **DS3231 SDA** | D2 | I2C Data line |
| **DS3231 SCL** | D1 | I2C Clock line |
| **Servo Signal** | D7 | Controls rotation (GPIO13) |
| **IR Sensor OUT** | D6 | Reads detection (GPIO12) |
| **IR Sensor VCC** | D8 | Powered dynamically by NodeMCU (GPIO15) |
| **Buzzer (+)** | D5 | For audio alerts (GPIO14) |
| **VCC** | 3V3 / Vin | Power for RTC and Servo |
| **GND** | GND | Common Ground |

---

## ⚙️ Configuring Motor Rotation

The servo motor controls the dispensing mechanism. If your motor is turning the wrong way, rotating too far, or not rotating long enough, you can easily adjust this in the firmware.

Open `firmware/medicine_dispenser/medicine_dispenser.ino` and locate the **SERVO** configuration section around **Line 45**.

```cpp
// ── SERVO ──────────────────────────────────────────────────────
#define SERVO_STOP        90
#define SERVO_DIR_FORWARD 45
#define SERVO_DIR_REVERSE 135
#define SERVO_ROTATE_MS   800
```

### Which Values to Change:

*   **`SERVO_DIR_FORWARD` (Line 46):** This controls the forward rotation speed and direction for a continuous rotation servo.
    *   *Default:* `45`
    *   *To change direction:* If you need the default rotation to be the other way, you can swap the values of `SERVO_DIR_FORWARD` and `SERVO_DIR_REVERSE`. For example, set this to `135` and the reverse to `45`.
    *   *To adjust speed:* Closer to `90` is slower, further from `90` (e.g., `0`) is faster.

*   **`SERVO_DIR_REVERSE` (Line 47):** This controls the reverse rotation speed and direction. This is used when the system needs to dispense from the same compartment consecutively.
    *   *Default:* `135`
    *   *To adjust speed:* Closer to `90` is slower, further from `90` (e.g., `180`) is faster.

*   **`SERVO_ROTATE_MS` (Line 48):** This defines **how long** the motor spins (in milliseconds) to drop the pill.
    *   *Default:* `800` (0.8 seconds)
    *   *If the pill doesn't drop:* Increase this value (e.g., to `1000` or `1200`) so the motor spins longer.
    *   *If multiple pills drop accidentally:* Decrease this value (e.g., to `600` or `700`) so the motor spins for a shorter duration.

*   **`SERVO_STOP` (Line 45):** This is the neutral stop signal.
    *   *Default:* `90`
    *   *Note:* If your continuous rotation servo slightly creeps or hums when it should be stopped, you might need to slightly calibrate this (e.g., `89` or `91`).

After making changes to these values, **Re-upload the sketch** to the NodeMCU for the changes to take effect.
