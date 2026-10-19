// Attendance engine: turns raw punches + shift + leaves + holidays into one record per
// employee per day (status, lateness, early leave, worked minutes, overtime). Pure functions,
// so the same rules run on the server and in the browser demo, and are unit-tested.

export const MIN = 60_000;
export const pad = n => String(n).padStart(2, "0");
export const isoDate = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const isoTime = d => `${isoDate(d)} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
export const parse = s => new Date(s.length === 10 ? s + "T00:00:00" : s.replace(" ", "T"));
export const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
export const hm = min => `${Math.floor(min / 60)}:${pad(min % 60)}`;
const roundDown = (m, step) => step > 1 ? Math.floor(m / step) * step : m;

function at(date, hhmm, dayOffset = 0) { const [h, m] = hhmm.split(":").map(Number); const d = addDays(parse(date), dayOffset); d.setHours(h, m, 0, 0); return d; }

// Shift window for a given date: [start, end] as Date objects (end may be next day).
export function shiftWindow(shift, date) {
  const start = at(date, shift.start_time);
  let end = at(date, shift.end_time);
  if (end <= start) end = addDays(end, 1);
  return { start, end };
}

// Pair raw punches into [in, out] within a generous window around the shift.
export function pairPunches(punches, win) {
  const lo = new Date(win.start.getTime() - 3 * 60 * MIN), hi = new Date(win.end.getTime() + 6 * 60 * MIN);
  const ps = punches.map(p => ({ ...p, t: parse(p.punched_at) })).filter(p => p.t >= lo && p.t <= hi).sort((a, b) => a.t - b.t);
  if (!ps.length) return { first_in: null, last_out: null, count: 0 };
  const ins = ps.filter(p => p.type === "in"), outs = ps.filter(p => p.type === "out");
  let first_in, last_out;
  if (ins.length || outs.length) { first_in = ins[0]?.t ?? null; last_out = outs.length ? outs[outs.length - 1].t : null; if (first_in && last_out && last_out <= first_in) last_out = null; }
  else { first_in = ps[0].t; last_out = ps.length > 1 ? ps[ps.length - 1].t : null; }   // untyped: alternate
  // de-bounce: punches within 2 minutes of each other count once
  if (first_in && last_out && (last_out - first_in) < 2 * MIN) last_out = null;
  return { first_in, last_out, count: ps.length };
}

export function workHours(shift) { const w = shiftWindow(shift, "2026-01-01"); return ((w.end - w.start) / MIN - (shift.break_minutes || 0)) / 60; }

/**
 * computeDay — the rule set.
 * @param {object} p { employee, shift, date, punches, leave, holiday, isWeekend, settings }
 */
export function computeDay({ employee, shift, date, punches = [], leave = null, holiday = null, isWeekend = false, settings = {}, now = new Date() }) {
  const grace = shift?.grace_minutes ?? settings.grace_minutes ?? 15;
  const rounding = settings.rounding_minutes ?? 15, minOt = settings.min_overtime_minutes ?? 30;
  const rec = { employee_id: employee.id, date, shift_id: shift?.id ?? null, status: "absent", first_in: null, last_out: null, worked_minutes: 0, late_minutes: 0, early_minutes: 0, overtime_minutes: 0, weekend_ot_minutes: 0, leave_type: null, note: null };
  const win = shift ? shiftWindow(shift, date) : { start: at(date, "08:00"), end: at(date, "17:00") };
  const pr = pairPunches(punches, win);
  const offDay = isWeekend || holiday;
  if (pr.first_in) rec.first_in = isoTime(pr.first_in);
  if (pr.last_out) rec.last_out = isoTime(pr.last_out);

  if (offDay) {
    rec.status = holiday ? "holiday" : "weekend";
    if (holiday) rec.note = holiday.name_en;
    if (pr.first_in && pr.last_out) { rec.worked_minutes = Math.round((pr.last_out - pr.first_in) / MIN); rec.weekend_ot_minutes = roundDown(rec.worked_minutes, rounding); }
    return rec;
  }
  if (leave) { rec.status = "leave"; rec.leave_type = leave.type; return rec; }
  if (!pr.first_in) {
    // future day or shift still running → not absent yet
    if (now < win.end) { rec.status = "incomplete"; rec.note = "not started"; }
    return rec;
  }
  const lateRaw = Math.round((pr.first_in - win.start) / MIN);
  rec.late_minutes = lateRaw > grace ? lateRaw : 0;
  if (!pr.last_out) {
    rec.status = now < new Date(win.end.getTime() + 6 * 60 * MIN) ? "incomplete" : "incomplete";
    rec.note = now < win.end ? "on shift" : "missing out punch";
    if (rec.late_minutes) rec.status = "incomplete";
    return rec;
  }
  const gross = Math.round((pr.last_out - pr.first_in) / MIN);
  rec.worked_minutes = Math.max(0, gross - (shift?.break_minutes ?? 60));
  rec.early_minutes = Math.max(0, Math.round((win.end - pr.last_out) / MIN));
  const scheduled = Math.round((win.end - win.start) / MIN) - (shift?.break_minutes ?? 60);
  const extra = Math.round((pr.last_out - win.end) / MIN);          // minutes after shift end
  const ot = extra >= minOt ? roundDown(extra, rounding) : 0;
  rec.overtime_minutes = rec.worked_minutes > scheduled ? Math.min(ot, roundDown(rec.worked_minutes - scheduled, rounding)) : 0;
  rec.status = rec.late_minutes ? "late" : rec.early_minutes > grace ? "early_leave" : "present";
  return rec;
}

// Monthly summary for one employee from day records
export function summarize(days, settings = {}, employee = {}) {
  const s = { work_days: 0, present: 0, late: 0, late_minutes: 0, early_minutes: 0, absent: 0, leave: 0, incomplete: 0, weekend: 0, holiday: 0, worked_minutes: 0, overtime_minutes: 0, weekend_ot_minutes: 0 };
  for (const d of days) {
    if (d.status === "incomplete" && d.note === "not started") continue;   // future / not yet started
    if (["present", "late", "early_leave", "absent", "leave", "incomplete"].includes(d.status)) s.work_days++;
    if (["present", "late", "early_leave"].includes(d.status)) s.present++;
    if (d.status === "late") s.late++;
    if (d.status === "absent") s.absent++; if (d.status === "leave") s.leave++; if (d.status === "incomplete") s.incomplete++;
    if (d.status === "weekend") s.weekend++; if (d.status === "holiday") s.holiday++;
    s.late_minutes += d.late_minutes; s.early_minutes += d.early_minutes; s.worked_minutes += d.worked_minutes; s.overtime_minutes += d.overtime_minutes; s.weekend_ot_minutes += d.weekend_ot_minutes;
  }
  const hourly = employee.basic_salary ? employee.basic_salary / (settings.monthly_hours || 240) : 0;
  s.overtime_pay = Math.round(hourly * (settings.overtime_rate || 1.5) * s.overtime_minutes / 60 * 100) / 100;
  s.weekend_pay = Math.round(hourly * (settings.weekend_rate || 2) * s.weekend_ot_minutes / 60 * 100) / 100;
  s.late_deduction = settings.late_deduction ? Math.round(hourly * s.late_minutes / 60 * 100) / 100 : 0;
  s.absence_deduction = Math.round(hourly * (settings.monthly_hours || 240) / 30 * s.absent * 100) / 100;
  return s;
}

// Parse a device export (CSV / TSV / pasted text). Accepts the common fingerprint-device layouts:
//   device_id,datetime[,type]   or   emp_no,date,time[,type]   with any of the headers.
export function parsePunchText(text) {
  const lines = String(text || "").split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  if (!lines.length) return { rows: [], errors: [] };
  const sep = lines[0].includes("\t") ? "\t" : lines[0].includes(";") ? ";" : ",";
  let header = null; const rows = [], errors = [];
  const norm = s => s.toLowerCase().replace(/[^a-z]/g, "");
  if (/[a-z]/i.test(lines[0]) && !/\d{4}-\d{2}-\d{2}/.test(lines[0])) header = lines.shift().split(sep).map(norm);
  const col = (names) => header ? header.findIndex(h => names.includes(h)) : -1;
  const ci = { id: col(["deviceid", "userid", "empno", "employeeid", "id", "badge", "ac"]), dt: col(["datetime", "timestamp", "time", "punchtime", "checktime"]), date: col(["date"]), tm: col(["clock", "hour", "timeofday"]), type: col(["type", "status", "inout", "direction", "state"]) };
  lines.forEach((l, i) => {
    const c = l.split(sep).map(s => s.trim().replace(/^"|"$/g, ""));
    let id, dt, type = null;
    if (header) { id = c[ci.id >= 0 ? ci.id : 0]; dt = ci.dt >= 0 ? c[ci.dt] : `${c[ci.date]} ${c[ci.tm]}`; if (ci.type >= 0) type = c[ci.type]; }
    else { id = c[0]; dt = /\d{2}:\d{2}/.test(c[1]) ? c[1] : `${c[1]} ${c[2]}`; type = /\d{2}:\d{2}/.test(c[1]) ? c[2] : c[3]; }
    const m = /(\d{4})[-/](\d{1,2})[-/](\d{1,2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?/.exec(dt || "") || (/(\d{1,2})[-/](\d{1,2})[-/](\d{4})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?/.exec(dt || "") ? (([, d, mo, y, h, mi, s]) => [null, y, mo, d, h, mi, s])(/(\d{1,2})[-/](\d{1,2})[-/](\d{4})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?/.exec(dt)) : null);
    if (!id || !m) { errors.push({ line: i + 1 + (header ? 1 : 0), text: l }); return; }
    const t = type ? (/^(in|i|0|check.?in|c\/in|entry|دخول)$/i.test(type) ? "in" : /^(out|o|1|check.?out|c\/out|exit|خروج)$/i.test(type) ? "out" : null) : null;
    rows.push({ device_id: String(id), punched_at: `${m[1]}-${pad(+m[2])}-${pad(+m[3])} ${pad(+m[4])}:${m[5]}:${m[6] || "00"}`, type: t });
  });
  return { rows, errors };
}
