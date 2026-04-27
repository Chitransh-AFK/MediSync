# 🏥 Smart Medicine Dispenser System

A full-stack IoT system designed for automated medicine dispensing, patient adherence tracking, and real-time alerts. This system seamlessly integrates an ESP8266-based hardware dispenser, a Node.js API server, a MySQL database, and a responsive web dashboard for nurses/caregivers to manage medication schedules efficiently.

---

## 🌟 Key Features

*   **Automated Dispensing**: Dispenses medicine reliably at exact scheduled times using a high-precision DS3231 RTC and a servo motor mechanism.
*   **Adherence Tracking**: An IR sensor validates if the patient actually picked up the medication after it was dispensed.
*   **Real-time Status Updates**: Medication statuses transition seamlessly through `PENDING` → `DISPENSED` → `TAKEN`. If the patient fails to take the medication within an allotted time, it triggers a `NOT_TAKEN` alert.
*   **Nurse Dashboard**: A responsive web interface for managing patient schedules, beds, and tracking real-time dispensing events.
*   **Offline Tolerance**: Uses RTC time to safely trigger dispenses even if internet connectivity momentarily drops.

---

## 🛠️ Technology Stack

*   **Hardware (Firmware):** ESP8266 (NodeMCU 1.0), C++ (Arduino Framework), Servo Motor, DS3231 RTC Module, IR Obstacle Sensor, Buzzer.
*   **Backend:** Node.js, Express.js, RESTful API.
*   **Database:** MySQL.
*   **Frontend:** HTML5, CSS3, Vanilla JavaScript.

---

## 📁 Project Structure

```text
New folder/
├── database/
│   └── schema.sql          ← Run this first in MySQL to create the db and tables
├── backend/
│   ├── .env                ← Database connection configuration
│   ├── server.js           ← Main API server entry point
│   ├── db.js               ← MySQL database connection pool
│   └── routes/
│       ├── schedule.js     ← Schedule CRUD API routes
│       └── status.js       ← Status updates & alerts API routes
├── frontend/
│   ├── index.html          ← Nurse Dashboard UI
│   ├── style.css           ← Dashboard styles
│   └── app.js              ← Dashboard interactive logic
└── firmware/
    └── medicine_dispenser/
        └── medicine_dispenser.ino  ← Firmware to flash to ESP8266
```

---

## 🚀 Quick Start Guide

### Step 1: Set up MySQL Database

1.  Open MySQL Workbench or your preferred MySQL CLI.
2.  Execute the provided schema file to create the database and tables:
    ```sql
    source database/schema.sql;
    ```

### Step 2: Configure Backend Server

1.  Navigate to the `backend` directory.
2.  Create or edit the `.env` file to match your MySQL credentials:
    ```env
    DB_PASS=your_mysql_password
    PORT=3000
    ```
3.  Install dependencies and start the server:
    ```bash
    cd backend
    npm install
    npm start
    ```
4.  The API Server will run at `http://localhost:3000`. The frontend dashboard is statically served at the same URL.

### Step 3: Flash the NodeMCU (ESP8266) Firmware

1.  Open `firmware/medicine_dispenser/medicine_dispenser.ino` in the **Arduino IDE**.
2.  Update the configuration variables at the top of the sketch:
    ```cpp
    const char* WIFI_SSID   = "Your_WiFi_SSID";
    const char* WIFI_PASS   = "Your_WiFi_Password";
    const char* SERVER_HOST = "http://<YOUR_PC_IP_ADDRESS>:3000"; // Find your local IP via 'ipconfig'
    const char* BED_ID      = "BED-01";
    ```
3.  Install required libraries via the Arduino Library Manager (Tools → Manage Libraries):
    *   `ArduinoJson` by Benoit Blanchon (v6.x)
    *   `RTClib` by Adafruit
    *   `Servo` by Michael Margolis
4.  Select your board: **NodeMCU 1.0 (ESP-12E Module)**.
5.  Compile and Upload the code to your ESP8266.

---

## 🔌 Hardware Connections (NodeMCU)

> [!WARNING]
> **Safety First:** The firmware uses *modem sleep* instead of deep sleep to save power while keeping the RTC state intact. **Do NOT connect** the DS3231 INT/SQW pin to the ESP8266 RST pin, nor D0 to RST, as it is unsafe without proper diode+resistor isolation and is not needed for this setup.

| Component | NodeMCU Pin | ESP8266 GPIO |
| :--- | :--- | :--- |
| **DS3231 SDA** | D2 | GPIO4 |
| **DS3231 SCL** | D1 | GPIO5 |
| **Servo Signal** | D4 | GPIO2 |
| **IR Sensor OUT** | D5 | GPIO14 |
| **Buzzer (+)** | D6 | GPIO12 |
| **VCC** | 3V3 (or Vin if using 5V modules) | — |
| **GND** | GND | — |

---

## 📡 API Endpoints Summary

| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `POST` | `/api/schedules` | Create a new medication schedule |
| `GET` | `/api/schedules` | List all schedules (supports filtering) |
| `GET` | `/api/schedules/beds` | Retrieve a list of all managed beds |
| `GET` | `/api/schedules/device/:bedId` | Device fetches its daily schedule |
| `DELETE` | `/api/schedules/:id` | Delete a specific schedule |
| `POST` | `/api/status/update` | Device reports dispensing status back to server |
| `GET` | `/api/status/alerts` | Dashboard polls for `NOT_TAKEN` alerts |
| `GET` | `/api/status/logs` | Fetch full activity/event history |
| `GET` | `/api/health` | Backend health check endpoint |

---

## 🔄 Medication Status Flow

1.  **`PENDING`**: Scheduled time is in the future.
2.  **`DISPENSED`**: Motor has activated to drop the pill, waiting for the patient to pick it up (IR sensor check).
3.  **`TAKEN`**: IR sensor confirms the patient's hand disrupted the beam, meaning the pill was retrieved.
4.  **`NOT_TAKEN`**: If the IR sensor is not triggered within a set timeout (e.g., 20 mins) after dispensing, an alert is raised on the Nurse Dashboard.
