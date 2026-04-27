-- ============================================================
--  Smart Medicine Dispenser System — MySQL Schema
--  Run this file once to set up the database.
-- ============================================================

CREATE DATABASE IF NOT EXISTS medicine_dispenser
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE medicine_dispenser;

-- ============================================================
-- Table: beds
-- Tracks every registered bed / ESP8266 device.
-- ============================================================
CREATE TABLE IF NOT EXISTS beds (
  id         INT          NOT NULL AUTO_INCREMENT,
  bed_id     VARCHAR(20)  NOT NULL UNIQUE,
  location   VARCHAR(100) DEFAULT NULL,
  device_mac VARCHAR(17)  DEFAULT NULL,
  created_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ============================================================
-- Table: schedules
-- One row per medicine dose assignment made by the nurse.
-- ============================================================
CREATE TABLE IF NOT EXISTS schedules (
  id             INT           NOT NULL AUTO_INCREMENT,
  bed_id         VARCHAR(20)   NOT NULL,
  medicine_name  VARCHAR(100)  NOT NULL,
  compartment    TINYINT(1)    NOT NULL COMMENT '1 or 2',
  dose_time      TIME          NOT NULL COMMENT 'HH:MM:SS',
  start_date     DATE          NOT NULL,
  duration_days  TINYINT       NOT NULL DEFAULT 1,
  end_date       DATE          NOT NULL,
  status         ENUM('PENDING','DISPENSED','TAKEN','NOT_TAKEN') NOT NULL DEFAULT 'PENDING',
  created_at     DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_bed_id (bed_id),
  KEY idx_status (status),
  KEY idx_dose_date (start_date, dose_time),
  CONSTRAINT fk_schedule_bed FOREIGN KEY (bed_id) REFERENCES beds (bed_id) ON DELETE CASCADE,
  CONSTRAINT chk_compartment CHECK (compartment IN (1, 2)),
  CONSTRAINT chk_duration   CHECK (duration_days >= 1 AND duration_days <= 365)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ============================================================
-- Table: logs
-- Immutable audit trail of every status change event.
-- ============================================================
CREATE TABLE IF NOT EXISTS logs (
  id           INT          NOT NULL AUTO_INCREMENT,
  schedule_id  INT          NOT NULL,
  bed_id       VARCHAR(20)  NOT NULL,
  medicine     VARCHAR(100) NOT NULL,
  compartment  TINYINT(1)   NOT NULL,
  event_status ENUM('DISPENSED','TAKEN','NOT_TAKEN') NOT NULL,
  device_id    VARCHAR(50)  DEFAULT NULL,
  timestamp    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_log_bed    (bed_id),
  KEY idx_log_status (event_status),
  KEY idx_log_ts     (timestamp),
  CONSTRAINT fk_log_schedule FOREIGN KEY (schedule_id) REFERENCES schedules (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ============================================================
-- Seed: Demo beds for college demonstration
-- ============================================================
INSERT IGNORE INTO beds (bed_id, location) VALUES
  ('BED-01', 'Ward A - Bed 1'),
  ('BED-02', 'Ward A - Bed 2'),
  ('BED-03', 'Ward B - Bed 1'),
  ('BED-04', 'Ward B - Bed 2'),
  ('BED-05', 'ICU - Bed 1');
