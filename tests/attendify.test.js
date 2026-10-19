import { test, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import initSqlJs from "sql.js";
import { wrap } from "../shared/dbx.js";
import { applySeed } from "../shared/seed.js";
import { computeDay, summarize, parsePunchText, shiftWindow } from "../shared/engine.js";
import { auth, employees, punches, leaves, attendance, dashboard, ApiError } from "../shared/service.js";

const OFFICE = { id: 1, code: "OFFICE", start_time: "08:00", end_time: "17:00", break_minutes: 60, grace_minutes: null };
const NIGHT = { id: 2, code: "SEC-N", start_time: "22:00", end_time: "06:00", break_minutes: 30, grace_minutes: 10 };
const emp = { id: 1, basic_salary: 4800 };
const settings = { grace_minutes: 15, rounding_minutes: 15, min_overtime_minutes: 30, overtime_rate: 1.5, weekend_rate: 2, late_deduction: 1, monthly_hours: 240 };
const far = new Date("2027-01-01T00:00:00");
const P = (...ts) => ts.map(t => ({ punched_at: t, type: null }));

test("on-time day with no overtime", () => {
  const r = computeDay({ employee: emp, shift: OFFICE, date: "2026-10-05", punches: P("2026-10-05 07:55:00", "2026-10-05 17:05:00"), settings, now: far });
  assert.equal(r.status, "present"); assert.equal(r.late_minutes, 0); assert.equal(r.worked_minutes, 490); assert.equal(r.overtime_minutes, 0);
});
test("late beyond grace is counted in full; within grace is not", () => {
  const late = computeDay({ employee: emp, shift: OFFICE, date: "2026-10-05", punches: P("2026-10-05 08:24:00", "2026-10-05 17:00:00"), settings, now: far });
  assert.equal(late.status, "late"); assert.equal(late.late_minutes, 24);
  const ok = computeDay({ employee: emp, shift: OFFICE, date: "2026-10-05", punches: P("2026-10-05 08:12:00", "2026-10-05 17:00:00"), settings, now: far });
  assert.equal(ok.status, "present"); assert.equal(ok.late_minutes, 0);
});
test("overtime rounds down to 15 min and ignores < 30 min", () => {
  const r = computeDay({ employee: emp, shift: OFFICE, date: "2026-10-05", punches: P("2026-10-05 08:00:00", "2026-10-05 19:10:00"), settings, now: far });
  assert.equal(r.overtime_minutes, 120);
  const s = computeDay({ employee: emp, shift: OFFICE, date: "2026-10-05", punches: P("2026-10-05 08:00:00", "2026-10-05 17:25:00"), settings, now: far });
  assert.equal(s.overtime_minutes, 0);
});
test("early leave and absence", () => {
  const e = computeDay({ employee: emp, shift: OFFICE, date: "2026-10-05", punches: P("2026-10-05 08:00:00", "2026-10-05 15:30:00"), settings, now: far });
  assert.equal(e.status, "early_leave"); assert.equal(e.early_minutes, 90);
  const a = computeDay({ employee: emp, shift: OFFICE, date: "2026-10-05", punches: [], settings, now: far });
  assert.equal(a.status, "absent");
  const f = computeDay({ employee: emp, shift: OFFICE, date: "2026-10-05", punches: [], settings, now: new Date("2026-10-05T07:00:00") });
  assert.equal(f.status, "incomplete"); assert.equal(f.note, "not started");
});
test("night shift crossing midnight pairs punches on the next calendar day", () => {
  const w = shiftWindow(NIGHT, "2026-10-05"); assert.equal(w.end.getDate(), 6);
  const r = computeDay({ employee: emp, shift: NIGHT, date: "2026-10-05", punches: P("2026-10-05 21:50:00", "2026-10-06 06:10:00"), settings, now: far });
  assert.equal(r.status, "present"); assert.equal(r.worked_minutes, 470); assert.equal(r.overtime_minutes, 0);
  const l = computeDay({ employee: emp, shift: NIGHT, date: "2026-10-05", punches: P("2026-10-05 22:25:00", "2026-10-06 06:00:00"), settings, now: far });
  assert.equal(l.late_minutes, 25); // shift grace is 10
});
test("weekend / holiday / leave statuses", () => {
  const wk = computeDay({ employee: emp, shift: OFFICE, date: "2026-10-09", punches: P("2026-10-09 08:00:00", "2026-10-09 12:40:00"), isWeekend: true, settings, now: far });
  assert.equal(wk.status, "weekend"); assert.equal(wk.weekend_ot_minutes, 270);
  const hol = computeDay({ employee: emp, shift: OFFICE, date: "2026-09-23", punches: [], holiday: { name_en: "National Day" }, settings, now: far });
  assert.equal(hol.status, "holiday");
  const lv = computeDay({ employee: emp, shift: OFFICE, date: "2026-10-05", punches: [], leave: { type: "sick" }, settings, now: far });
  assert.equal(lv.status, "leave"); assert.equal(lv.leave_type, "sick");
});
test("typed in/out punches are respected; a missing out punch is flagged", () => {
  const r = computeDay({ employee: emp, shift: OFFICE, date: "2026-10-05", punches: [{ punched_at: "2026-10-05 07:58:00", type: "in" }, { punched_at: "2026-10-05 08:00:30", type: "in" }, { punched_at: "2026-10-05 17:02:00", type: "out" }], settings, now: far });
  assert.equal(r.first_in, "2026-10-05 07:58:00"); assert.equal(r.status, "present");
  const m = computeDay({ employee: emp, shift: OFFICE, date: "2026-10-05", punches: P("2026-10-05 07:58:00"), settings, now: far });
  assert.equal(m.status, "incomplete"); assert.equal(m.note, "missing out punch");
});
test("monthly summary and pay figures", () => {
  const days = [{ status: "present", late_minutes: 0, early_minutes: 0, worked_minutes: 480, overtime_minutes: 60, weekend_ot_minutes: 0 }, { status: "late", late_minutes: 30, early_minutes: 0, worked_minutes: 450, overtime_minutes: 0, weekend_ot_minutes: 0 }, { status: "absent", late_minutes: 0, early_minutes: 0, worked_minutes: 0, overtime_minutes: 0, weekend_ot_minutes: 0 }, { status: "weekend", late_minutes: 0, early_minutes: 0, worked_minutes: 240, overtime_minutes: 0, weekend_ot_minutes: 240 }];
  const s = summarize(days, settings, emp);
  assert.equal(s.work_days, 3); assert.equal(s.present, 2); assert.equal(s.late, 1); assert.equal(s.absent, 1);
  const hourly = 4800 / 240; // 20 SAR
  assert.equal(s.overtime_pay, 30); assert.equal(s.weekend_pay, 160); assert.equal(s.late_deduction, 10); assert.equal(s.absence_deduction, 160);
});
test("device export parser handles headers, separators, Arabic types and bad lines", () => {
  const { rows, errors } = parsePunchText("device_id,datetime,type\n101,2026-10-05 07:52:10,in\n102,05/10/2026 17:02,C/Out\n103;x\n");
  assert.equal(rows.length, 2); assert.equal(rows[0].type, "in"); assert.equal(rows[1].punched_at, "2026-10-05 17:02:00"); assert.equal(rows[1].type, "out"); assert.equal(errors.length, 1);
  const tsv = parsePunchText("ID\tTime\tStatus\n7\t2026-10-05 08:00:00\tدخول");
  assert.equal(tsv.rows[0].device_id, "7"); assert.equal(tsv.rows[0].type, "in");
});

let dbx, hr, mgr, viewer;
before(async () => {
  const SQL = await initSqlJs(); dbx = wrap(new SQL.Database());
  dbx.exec(fs.readFileSync(new URL("../db/schema.sql", import.meta.url), "utf8"));
  applySeed(dbx, { today: new Date("2026-10-19T20:00:00"), days: 40 });
  hr = { user: (await auth.login(dbx, { email: "hr@goldenpalms.example", password: "demo1234" })).user };
  mgr = { user: (await auth.login(dbx, { email: "salem@goldenpalms.example", password: "demo1234" })).user };
  viewer = { user: (await auth.login(dbx, { email: "viewer@goldenpalms.example", password: "demo1234" })).user };
});
test("manager scope is limited to their department", () => {
  const all = employees.list(dbx, hr); const mine = employees.list(dbx, mgr);
  assert.ok(mine.length < all.length); assert.ok(mine.every(e => e.department_id === mgr.user.department_id));
});
test("import → rebuild → day record reflects the punches; duplicates ignored", () => {
  const e = employees.list(dbx, hr)[0];
  const r1 = punches.import(dbx, hr, { text: `device_id,datetime,type\n${e.device_id},2026-11-02 07:50:00,in\n${e.device_id},2026-11-02 18:40:00,out\n999,2026-11-02 08:00:00,in` });
  assert.equal(r1.inserted, 2); assert.deepEqual(r1.unknown, ["999"]);
  const r2 = punches.import(dbx, hr, { text: `device_id,datetime,type\n${e.device_id},2026-11-02 07:50:00,in` });
  assert.equal(r2.inserted, 0); assert.equal(r2.duplicates, 1);
  const m = employees.month(dbx, hr, e.id, "2026-11");
  const d = m.days.find(x => x.date === "2026-11-02");
  assert.equal(d.status, "present"); assert.equal(d.overtime_minutes, 90);
});
test("approving a leave rewrites the day as leave; viewer cannot decide", () => {
  const e = employees.list(dbx, hr)[1];
  const l = leaves.create(dbx, hr, { employee_id: e.id, type: "annual", from_date: "2026-11-03", to_date: "2026-11-04" });
  assert.throws(() => leaves.decide(dbx, viewer, l.id, { status: "approved" }), err => err.status === 403);
  leaves.decide(dbx, hr, l.id, { status: "approved" });
  const d = employees.month(dbx, hr, e.id, "2026-11").days.find(x => x.date === "2026-11-03");
  assert.equal(d.status, "leave"); assert.equal(d.leave_type, "annual");
});
test("locked months are not rebuilt", () => {
  const e = employees.list(dbx, hr)[2];
  attendance.monthly(dbx, hr, { month: "2026-09" });
  attendance.lock(dbx, hr, { month: "2026-09", locked: 1 });
  const before = dbx.get("SELECT computed_at, status FROM attendance_days WHERE employee_id=? AND date='2026-09-15'", [e.id]);
  punches.add(dbx, hr, { employee_id: e.id, punched_at: "2026-09-15 23:30", type: "out" });
  const after = dbx.get("SELECT computed_at, status FROM attendance_days WHERE employee_id=? AND date='2026-09-15'", [e.id]);
  assert.equal(before.computed_at, after.computed_at);
  attendance.lock(dbx, hr, { month: "2026-09", locked: 0 });
});
test("dashboard and monthly report run", () => {
  const d = dashboard.summary(dbx, hr); assert.equal(d.headcount, 40); assert.ok(Array.isArray(d.trend));
  const m = attendance.monthly(dbx, hr, { month: "2026-10" }); assert.equal(m.rows.length, 40); assert.ok(m.totals.present > 0);
});
