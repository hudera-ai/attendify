# Attendify REST API

Base URL `http://localhost:8789`. `/api/*` routes (except login/health) need `Authorization: Bearer <token>`. Errors: `{error, message}` with HTTP 400/401/403/404.

## Auth & setup
`POST /api/auth/login {email,password}` → `{token,user}` · `POST /api/auth/logout` · `GET /api/auth/me` · `GET /api/users` · `GET /api/company` · `PATCH /api/company` (admin: rules such as `grace_minutes`, `rounding_minutes`, `min_overtime_minutes`, `overtime_rate`, `weekend_rate`, `weekend_days`, `monthly_hours`, `late_deduction`) · `GET /api/health`
`GET /api/departments` · `GET /api/shifts` · `POST /api/shifts {id?, code, name_en, name_ar, start_time, end_time, break_minutes, grace_minutes?, active}` · `GET /api/holidays` · `POST /api/holidays {date, name_en, name_ar}` · `DELETE /api/holidays/:date`

## Employees
`GET /api/employees?search=&department_id=&shift_id=&status=` · `POST /api/employees {id?, emp_no, device_id, name_en, name_ar, department_id, shift_id, job_title, nationality, phone, hire_date, basic_salary, status}` · `GET /api/employees/:id` · `GET /api/employees/:id/month?month=YYYY-MM` → `{employee, days[], summary, punches[], leaves[]}`

## Punches
`GET /api/punches?employee_id=&from=&to=&limit=` · `POST /api/punches {employee_id, punched_at "YYYY-MM-DD HH:MM", type? in|out, note}` · `DELETE /api/punches/:id`
`POST /api/punches/import` body `{text, dry}` (JSON) or raw `text/csv` with `?dry=1` → `{parsed, inserted, duplicates, unknown[], errors[], employees, from, to}`. Affected days are rebuilt.

## Leaves
`GET /api/leaves?status=&employee_id=&month=` · `POST /api/leaves {employee_id, type, from_date, to_date, note}` · `POST /api/leaves/:id/decide {status: approved|rejected}` (HR)

## Attendance
`GET /api/attendance/daily?date=&department_id=` → `{date, rows[], counts}` · `GET /api/attendance/monthly?month=&department_id=` → `{rows[], totals, locked, settings}` · `POST /api/attendance/rebuild {from, to, employee_id?}` · `POST /api/attendance/lock {month, locked}` (HR)

Day record: `status ∈ present|late|early_leave|absent|leave|weekend|holiday|incomplete`, `first_in`, `last_out`, `worked_minutes`, `late_minutes`, `early_minutes`, `overtime_minutes`, `weekend_ot_minutes`, `leave_type`, `note`.

## Dashboard & audit
`GET /api/dashboard` · `GET /api/audit?limit=` (HR)

## Device push (no session; `x-device-token` when `DEVICE_TOKEN` is set)
`POST /device/punch` with JSON `{device_id, punched_at, type?}`, an array of those, or raw CSV text. Same parser and rebuild as the import.
