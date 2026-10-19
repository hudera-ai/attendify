-- Attendify · attendance & overtime
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS company (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  name_ar TEXT NOT NULL, name_en TEXT NOT NULL, city TEXT, email TEXT,
  weekend_days TEXT NOT NULL DEFAULT '5,6',          -- JS getDay(): 5=Fri, 6=Sat
  grace_minutes INTEGER NOT NULL DEFAULT 15,
  rounding_minutes INTEGER NOT NULL DEFAULT 15,      -- overtime rounded down to this
  min_overtime_minutes INTEGER NOT NULL DEFAULT 30,  -- below this, overtime is ignored
  overtime_rate REAL NOT NULL DEFAULT 1.5,
  weekend_rate REAL NOT NULL DEFAULT 2.0,
  late_deduction INTEGER NOT NULL DEFAULT 1,         -- 1 = deduct late minutes from pay
  monthly_hours INTEGER NOT NULL DEFAULT 240         -- divisor for hourly rate from basic salary
);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL, email TEXT NOT NULL UNIQUE,
  role TEXT NOT NULL CHECK (role IN ('admin','hr','manager','viewer')),
  department_id INTEGER, password_hash TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS departments (
  id INTEGER PRIMARY KEY AUTOINCREMENT, code TEXT NOT NULL UNIQUE, name_ar TEXT NOT NULL, name_en TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS shifts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE, name_ar TEXT NOT NULL, name_en TEXT NOT NULL,
  start_time TEXT NOT NULL, end_time TEXT NOT NULL,   -- HH:MM; end < start means the shift crosses midnight
  break_minutes INTEGER NOT NULL DEFAULT 60,
  grace_minutes INTEGER,                              -- NULL = company default
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS employees (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  emp_no TEXT NOT NULL UNIQUE, device_id TEXT UNIQUE,
  name_ar TEXT NOT NULL, name_en TEXT NOT NULL,
  department_id INTEGER REFERENCES departments(id), shift_id INTEGER REFERENCES shifts(id),
  job_title TEXT, nationality TEXT, phone TEXT, hire_date TEXT,
  basic_salary REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','terminated')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS punches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  punched_at TEXT NOT NULL,                           -- YYYY-MM-DD HH:MM:SS local
  type TEXT CHECK (type IN ('in','out')),             -- NULL = let the engine pair it
  source TEXT NOT NULL DEFAULT 'device' CHECK (source IN ('device','import','manual','app')),
  note TEXT, created_by INTEGER,
  UNIQUE (employee_id, punched_at)
);

CREATE TABLE IF NOT EXISTS leaves (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('annual','sick','unpaid','business','other')),
  from_date TEXT NOT NULL, to_date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  note TEXT, decided_by INTEGER, decided_at TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS holidays (
  date TEXT PRIMARY KEY, name_ar TEXT NOT NULL, name_en TEXT NOT NULL
);

-- Materialised day records produced by the engine (shared/engine.js)
CREATE TABLE IF NOT EXISTS attendance_days (
  employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  shift_id INTEGER,
  status TEXT NOT NULL CHECK (status IN ('present','late','absent','leave','weekend','holiday','incomplete','early_leave')),
  first_in TEXT, last_out TEXT,
  worked_minutes INTEGER NOT NULL DEFAULT 0,
  late_minutes INTEGER NOT NULL DEFAULT 0,
  early_minutes INTEGER NOT NULL DEFAULT 0,
  overtime_minutes INTEGER NOT NULL DEFAULT 0,        -- weekday overtime
  weekend_ot_minutes INTEGER NOT NULL DEFAULT 0,      -- weekend / holiday work
  leave_type TEXT, note TEXT,
  locked INTEGER NOT NULL DEFAULT 0,
  computed_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (employee_id, date)
);

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL DEFAULT (datetime('now')),
  user_id INTEGER, action TEXT NOT NULL, entity TEXT NOT NULL, entity_id INTEGER, detail TEXT
);

CREATE INDEX IF NOT EXISTS idx_punch_emp ON punches(employee_id, punched_at);
CREATE INDEX IF NOT EXISTS idx_att_date ON attendance_days(date);
CREATE INDEX IF NOT EXISTS idx_leave_emp ON leaves(employee_id, from_date);
