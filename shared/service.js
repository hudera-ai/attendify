// Domain service for Attendify — used by the REST server and by the browser demo.
import { verifyPassword, randomToken } from "./auth.js";
import { computeDay, summarize, parsePunchText, isoDate, addDays, parse } from "./engine.js";

export class ApiError extends Error { constructor(status, code, message) { super(message || code); this.status = status; this.code = code; } }
const now = () => new Date().toISOString().slice(0, 19).replace("T", " ");
const today = () => isoDate(new Date());
const num = v => (v === "" || v == null ? 0 : Number(v));
const ROLE = { viewer: 0, manager: 1, hr: 2, admin: 3 };
function require(ctx, min) { if (!ctx?.user) throw new ApiError(401, "unauthenticated"); if (ROLE[ctx.user.role] < ROLE[min]) throw new ApiError(403, "forbidden", `Requires role ${min}`); }
function audit(dbx, ctx, action, entity, id, detail) { dbx.run("INSERT INTO audit_log (user_id,action,entity,entity_id,detail) VALUES (?,?,?,?,?)", [ctx?.user?.id ?? null, action, entity, id ?? null, detail ? JSON.stringify(detail).slice(0, 500) : null]); }
// managers only see their department
function deptScope(ctx) { return ctx.user.role === "manager" && ctx.user.department_id ? ctx.user.department_id : null; }

export const auth = {
  async login(dbx, { email, password }) {
    const u = dbx.get("SELECT * FROM users WHERE lower(email)=lower(?) AND active=1", [String(email || "").trim()]);
    if (!u || !(await verifyPassword(String(password || ""), u.password_hash))) throw new ApiError(401, "bad_credentials", "Wrong email or password");
    const { password_hash, ...user } = u; return { token: randomToken(), user };
  },
  users(dbx, ctx) { require(ctx, "viewer"); return dbx.all("SELECT u.id,u.name,u.email,u.role,u.department_id,d.name_en AS department FROM users u LEFT JOIN departments d ON d.id=u.department_id ORDER BY role, name"); },
};
export const company = {
  get(dbx) { return dbx.get("SELECT * FROM company WHERE id=1"); },
  update(dbx, ctx, p) { require(ctx, "admin"); const f = ["name_ar", "name_en", "city", "email", "weekend_days", "grace_minutes", "rounding_minutes", "min_overtime_minutes", "overtime_rate", "weekend_rate", "late_deduction", "monthly_hours"].filter(k => k in p); if (f.length) dbx.run(`UPDATE company SET ${f.map(k => `${k}=?`).join(",")} WHERE id=1`, f.map(k => p[k])); audit(dbx, ctx, "update", "company", 1, f); return company.get(dbx); },
};
export const departments = { list(dbx, ctx) { require(ctx, "viewer"); return dbx.all("SELECT d.*, (SELECT COUNT(*) FROM employees e WHERE e.department_id=d.id AND e.status='active') AS headcount FROM departments d ORDER BY code"); } };
export const shifts = {
  list(dbx, ctx) { require(ctx, "viewer"); return dbx.all("SELECT s.*, (SELECT COUNT(*) FROM employees e WHERE e.shift_id=s.id AND e.status='active') AS headcount FROM shifts s ORDER BY start_time"); },
  save(dbx, ctx, s) { require(ctx, "hr"); if (!s.code || !/^\d{2}:\d{2}$/.test(s.start_time || "") || !/^\d{2}:\d{2}$/.test(s.end_time || "")) throw new ApiError(400, "validation", "code, start_time and end_time (HH:MM) are required");
    if (s.id) dbx.run("UPDATE shifts SET code=?,name_ar=?,name_en=?,start_time=?,end_time=?,break_minutes=?,grace_minutes=?,active=? WHERE id=?", [s.code, s.name_ar || s.name_en, s.name_en || s.name_ar, s.start_time, s.end_time, num(s.break_minutes), s.grace_minutes === "" || s.grace_minutes == null ? null : num(s.grace_minutes), s.active ?? 1, s.id]);
    else s.id = dbx.run("INSERT INTO shifts (code,name_ar,name_en,start_time,end_time,break_minutes,grace_minutes) VALUES (?,?,?,?,?,?,?)", [s.code, s.name_ar || s.name_en, s.name_en || s.name_ar, s.start_time, s.end_time, num(s.break_minutes), s.grace_minutes === "" || s.grace_minutes == null ? null : num(s.grace_minutes)]).lastId;
    audit(dbx, ctx, "save", "shift", s.id); return dbx.get("SELECT * FROM shifts WHERE id=?", [s.id]); },
};
export const holidays = {
  list(dbx, ctx) { require(ctx, "viewer"); return dbx.all("SELECT * FROM holidays ORDER BY date"); },
  save(dbx, ctx, h) { require(ctx, "hr"); if (!/^\d{4}-\d{2}-\d{2}$/.test(h.date || "")) throw new ApiError(400, "validation", "date required"); dbx.run("INSERT OR REPLACE INTO holidays (date,name_ar,name_en) VALUES (?,?,?)", [h.date, h.name_ar || h.name_en, h.name_en || h.name_ar]); attendance.rebuild(dbx, ctx, { from: h.date, to: h.date }); audit(dbx, ctx, "save", "holiday", null, h.date); return holidays.list(dbx, ctx); },
  remove(dbx, ctx, date) { require(ctx, "hr"); dbx.run("DELETE FROM holidays WHERE date=?", [date]); attendance.rebuild(dbx, ctx, { from: date, to: date }); return holidays.list(dbx, ctx); },
};

const EMP_SELECT = "SELECT e.*, d.code AS dept_code, d.name_en AS dept_en, d.name_ar AS dept_ar, s.code AS shift_code, s.name_en AS shift_en, s.name_ar AS shift_ar, s.start_time, s.end_time FROM employees e LEFT JOIN departments d ON d.id=e.department_id LEFT JOIN shifts s ON s.id=e.shift_id";
export const employees = {
  list(dbx, ctx, q = {}) {
    require(ctx, "viewer");
    const where = [], params = []; const scope = deptScope(ctx);
    if (scope) { where.push("e.department_id=?"); params.push(scope); }
    if (q.department_id) { where.push("e.department_id=?"); params.push(q.department_id); }
    if (q.shift_id) { where.push("e.shift_id=?"); params.push(q.shift_id); }
    if (q.status) { where.push("e.status=?"); params.push(q.status); } else where.push("e.status='active'");
    if (q.search) { where.push("(e.emp_no LIKE ? OR e.name_en LIKE ? OR e.name_ar LIKE ? OR e.device_id=?)"); params.push(`%${q.search}%`, `%${q.search}%`, `%${q.search}%`, q.search); }
    return dbx.all(`${EMP_SELECT} WHERE ${where.join(" AND ")} ORDER BY e.emp_no`, params);
  },
  get(dbx, ctx, id) { require(ctx, "viewer"); const e = dbx.get(`${EMP_SELECT} WHERE e.id=?`, [id]); if (!e) throw new ApiError(404, "employee_not_found"); const scope = deptScope(ctx); if (scope && e.department_id !== scope) throw new ApiError(403, "forbidden"); return e; },
  save(dbx, ctx, e) {
    require(ctx, "hr"); if (!e.emp_no || !(e.name_en || e.name_ar)) throw new ApiError(400, "validation", "emp_no and name are required");
    const vals = [e.emp_no, e.device_id || null, e.name_ar || e.name_en, e.name_en || e.name_ar, e.department_id || null, e.shift_id || null, e.job_title || null, e.nationality || null, e.phone || null, e.hire_date || null, num(e.basic_salary), e.status || "active"];
    if (e.id) dbx.run("UPDATE employees SET emp_no=?,device_id=?,name_ar=?,name_en=?,department_id=?,shift_id=?,job_title=?,nationality=?,phone=?,hire_date=?,basic_salary=?,status=? WHERE id=?", [...vals, e.id]);
    else e.id = dbx.run("INSERT INTO employees (emp_no,device_id,name_ar,name_en,department_id,shift_id,job_title,nationality,phone,hire_date,basic_salary,status) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)", vals).lastId;
    audit(dbx, ctx, "save", "employee", e.id); return employees.get(dbx, ctx, e.id);
  },
  month(dbx, ctx, id, month) { // YYYY-MM calendar + summary
    const e = employees.get(dbx, ctx, id); const m = month || today().slice(0, 7);
    attendance.ensure(dbx, ctx, { from: `${m}-01`, to: endOfMonth(m), employee_id: id });
    const days = dbx.all("SELECT * FROM attendance_days WHERE employee_id=? AND date BETWEEN ? AND ? ORDER BY date", [id, `${m}-01`, endOfMonth(m)]);
    const c = company.get(dbx);
    return { employee: e, month: m, days, summary: summarize(days, c, e), punches: dbx.all("SELECT * FROM punches WHERE employee_id=? AND punched_at BETWEEN ? AND ? ORDER BY punched_at", [id, `${m}-01 00:00:00`, `${endOfMonth(m)} 23:59:59`]), leaves: dbx.all("SELECT * FROM leaves WHERE employee_id=? AND to_date>=? AND from_date<=? ORDER BY from_date", [id, `${m}-01`, endOfMonth(m)]) };
  },
};
export function endOfMonth(m) { const [y, mo] = m.split("-").map(Number); return isoDate(new Date(y, mo, 0)); }

export const punches = {
  list(dbx, ctx, { employee_id, from, to, limit = 500 } = {}) { require(ctx, "viewer"); const w = ["1=1"], p = []; if (employee_id) { w.push("p.employee_id=?"); p.push(employee_id); } if (from) { w.push("p.punched_at>=?"); p.push(from + " 00:00:00"); } if (to) { w.push("p.punched_at<=?"); p.push(to + " 23:59:59"); } const scope = deptScope(ctx); if (scope) { w.push("e.department_id=?"); p.push(scope); } return dbx.all(`SELECT p.*, e.emp_no, e.name_en, e.name_ar FROM punches p JOIN employees e ON e.id=p.employee_id WHERE ${w.join(" AND ")} ORDER BY p.punched_at DESC LIMIT ?`, [...p, Math.min(num(limit) || 500, 5000)]); },
  add(dbx, ctx, { employee_id, punched_at, type = null, note }) {
    require(ctx, "hr"); if (!employee_id || !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(punched_at || "")) throw new ApiError(400, "validation", "employee_id and punched_at (YYYY-MM-DD HH:MM) are required");
    const at = punched_at.length === 16 ? punched_at + ":00" : punched_at;
    const r = dbx.run("INSERT OR IGNORE INTO punches (employee_id,punched_at,type,source,note,created_by) VALUES (?,?,?,'manual',?,?)", [employee_id, at, type, note || null, ctx.user.id]);
    attendance.rebuild(dbx, ctx, { from: isoDate(addDays(parse(at), -1)), to: at.slice(0, 10), employee_id });
    audit(dbx, ctx, "add", "punch", r.lastId, { employee_id, at }); return { id: r.lastId };
  },
  remove(dbx, ctx, id) { require(ctx, "hr"); const p = dbx.get("SELECT * FROM punches WHERE id=?", [id]); if (!p) throw new ApiError(404, "punch_not_found"); dbx.run("DELETE FROM punches WHERE id=?", [id]); attendance.rebuild(dbx, ctx, { from: isoDate(addDays(parse(p.punched_at), -1)), to: p.punched_at.slice(0, 10), employee_id: p.employee_id }); audit(dbx, ctx, "delete", "punch", id); return { ok: true }; },
  // Import a device export (text). Returns counts; unknown device ids are reported, not inserted.
  import(dbx, ctx, { text, dry = false }) {
    require(ctx, "hr");
    const { rows, errors } = parsePunchText(text);
    const byDevice = Object.fromEntries(dbx.all("SELECT id, device_id, emp_no FROM employees").flatMap(e => [[e.device_id, e.id], [e.emp_no, e.id]]).filter(([k]) => k));
    let inserted = 0, duplicates = 0; const unknown = new Set(); let minD = null, maxD = null; const emps = new Set();
    const apply = () => { for (const r of rows) { const eid = byDevice[r.device_id]; if (!eid) { unknown.add(r.device_id); continue; } if (!dry) { const res = dbx.run("INSERT OR IGNORE INTO punches (employee_id,punched_at,type,source,created_by) VALUES (?,?,?,'import',?)", [eid, r.punched_at, r.type, ctx.user.id]); if (res.changes) inserted++; else duplicates++; } else inserted++; emps.add(eid); const d = r.punched_at.slice(0, 10); if (!minD || d < minD) minD = d; if (!maxD || d > maxD) maxD = d; } };
    if (dry) apply(); else dbx.tx(apply);
    if (!dry && minD) { attendance.rebuild(dbx, ctx, { from: isoDate(addDays(parse(minD), -1)), to: maxD }); audit(dbx, ctx, "import", "punches", null, { inserted, duplicates, unknown: [...unknown] }); }
    return { parsed: rows.length, inserted, duplicates, unknown: [...unknown], errors: errors.slice(0, 20), employees: emps.size, from: minD, to: maxD, dry };
  },
};

export const leaves = {
  list(dbx, ctx, { status, employee_id, month } = {}) { require(ctx, "viewer"); const w = ["1=1"], p = []; if (status) { w.push("l.status=?"); p.push(status); } if (employee_id) { w.push("l.employee_id=?"); p.push(employee_id); } if (month) { w.push("l.to_date>=? AND l.from_date<=?"); p.push(`${month}-01`, endOfMonth(month)); } const scope = deptScope(ctx); if (scope) { w.push("e.department_id=?"); p.push(scope); } return dbx.all(`SELECT l.*, e.emp_no, e.name_en, e.name_ar, d.name_en AS dept_en, d.name_ar AS dept_ar, u.name AS decided_by_name FROM leaves l JOIN employees e ON e.id=l.employee_id LEFT JOIN departments d ON d.id=e.department_id LEFT JOIN users u ON u.id=l.decided_by WHERE ${w.join(" AND ")} ORDER BY l.status='pending' DESC, l.from_date DESC LIMIT 500`, p); },
  create(dbx, ctx, l) { require(ctx, "manager"); if (!l.employee_id || !l.from_date || !l.to_date || l.to_date < l.from_date) throw new ApiError(400, "validation", "employee, from and to dates are required"); const r = dbx.run("INSERT INTO leaves (employee_id,type,from_date,to_date,note) VALUES (?,?,?,?,?)", [l.employee_id, l.type || "annual", l.from_date, l.to_date, l.note || null]); audit(dbx, ctx, "create", "leave", r.lastId); return dbx.get("SELECT * FROM leaves WHERE id=?", [r.lastId]); },
  decide(dbx, ctx, id, { status }) { require(ctx, "hr"); const l = dbx.get("SELECT * FROM leaves WHERE id=?", [id]); if (!l) throw new ApiError(404, "leave_not_found"); if (!["approved", "rejected"].includes(status)) throw new ApiError(400, "validation"); dbx.run("UPDATE leaves SET status=?, decided_by=?, decided_at=? WHERE id=?", [status, ctx.user.id, now(), id]); attendance.rebuild(dbx, ctx, { from: l.from_date, to: l.to_date, employee_id: l.employee_id }); audit(dbx, ctx, status, "leave", id); return dbx.get("SELECT * FROM leaves WHERE id=?", [id]); },
};

// ---- attendance engine glue ---------------------------------------------------------------
export const attendance = {
  rebuild(dbx, ctx, { from, to, employee_id } = {}) {
    const c = company.get(dbx); const weekend = c.weekend_days.split(",").map(Number);
    const f = from || isoDate(addDays(new Date(), -40)), t = to || today();
    const emps = employee_id ? [dbx.get("SELECT * FROM employees WHERE id=?", [employee_id])].filter(Boolean) : dbx.all("SELECT * FROM employees");
    const sh = Object.fromEntries(dbx.all("SELECT * FROM shifts").map(s => [s.id, s]));
    const hol = Object.fromEntries(dbx.all("SELECT * FROM holidays WHERE date BETWEEN ? AND ?", [f, t]).map(h => [h.date, h]));
    let n = 0;
    dbx.tx(() => {
      for (const e of emps) {
        const ps = dbx.all("SELECT * FROM punches WHERE employee_id=? AND punched_at BETWEEN ? AND ?", [e.id, `${isoDate(addDays(parse(f), -1))} 00:00:00`, `${isoDate(addDays(parse(t), 2))} 23:59:59`]);
        const lv = dbx.all("SELECT * FROM leaves WHERE employee_id=? AND status='approved' AND to_date>=? AND from_date<=?", [e.id, f, t]);
        const locked = new Set(dbx.all("SELECT date FROM attendance_days WHERE employee_id=? AND locked=1 AND date BETWEEN ? AND ?", [e.id, f, t]).map(r => r.date));
        for (let d = parse(f); d <= parse(t); d = addDays(d, 1)) {
          const ds = isoDate(d); if (locked.has(ds)) continue; if (e.hire_date && ds < e.hire_date) continue;
          const rec = computeDay({ employee: e, shift: sh[e.shift_id], date: ds, punches: ps, leave: lv.find(l => l.from_date <= ds && l.to_date >= ds) || null, holiday: hol[ds] || null, isWeekend: weekend.includes(d.getDay()), settings: c });
          dbx.run("INSERT OR REPLACE INTO attendance_days (employee_id,date,shift_id,status,first_in,last_out,worked_minutes,late_minutes,early_minutes,overtime_minutes,weekend_ot_minutes,leave_type,note,locked,computed_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,0,?)", [rec.employee_id, rec.date, rec.shift_id, rec.status, rec.first_in, rec.last_out, rec.worked_minutes, rec.late_minutes, rec.early_minutes, rec.overtime_minutes, rec.weekend_ot_minutes, rec.leave_type, rec.note, now()]);
          n++;
        }
      }
    });
    return { days: n, from: f, to: t };
  },
  // Make sure day records exist for a range (lazy build, used by the browser demo on first open).
  ensure(dbx, ctx, { from, to, employee_id }) {
    const have = dbx.get(`SELECT COUNT(*) AS n FROM attendance_days WHERE date BETWEEN ? AND ? ${employee_id ? "AND employee_id=?" : ""}`, employee_id ? [from, to, employee_id] : [from, to]).n;
    const emps = employee_id ? 1 : dbx.get("SELECT COUNT(*) AS n FROM employees").n;
    const daysN = Math.round((parse(to) - parse(from)) / 864e5) + 1;
    if (have < emps * daysN * 0.9) attendance.rebuild(dbx, ctx, { from, to, employee_id });
  },
  daily(dbx, ctx, { date, department_id } = {}) {
    require(ctx, "viewer"); const d = date || today();
    attendance.ensure(dbx, ctx, { from: d, to: d });
    const w = ["a.date=?"], p = [d]; const scope = deptScope(ctx); if (scope) { w.push("e.department_id=?"); p.push(scope); } if (department_id) { w.push("e.department_id=?"); p.push(department_id); }
    const rows = dbx.all(`SELECT a.*, e.emp_no, e.name_en, e.name_ar, e.job_title, d.name_en AS dept_en, d.name_ar AS dept_ar, s.code AS shift_code, s.start_time, s.end_time FROM attendance_days a JOIN employees e ON e.id=a.employee_id LEFT JOIN departments d ON d.id=e.department_id LEFT JOIN shifts s ON s.id=a.shift_id WHERE ${w.join(" AND ")} AND e.status='active' ORDER BY d.code, e.emp_no`, p);
    const counts = {}; for (const r of rows) counts[r.status] = (counts[r.status] || 0) + 1;
    return { date: d, rows, counts };
  },
  lock(dbx, ctx, { month, locked = 1 }) { require(ctx, "hr"); dbx.run("UPDATE attendance_days SET locked=? WHERE date BETWEEN ? AND ?", [locked ? 1 : 0, `${month}-01`, endOfMonth(month)]); audit(dbx, ctx, locked ? "lock" : "unlock", "month", null, month); return { ok: true }; },
  monthly(dbx, ctx, { month, department_id } = {}) {
    require(ctx, "viewer"); const m = month || today().slice(0, 7); const from = `${m}-01`, to = endOfMonth(m);
    attendance.ensure(dbx, ctx, { from, to });
    const c = company.get(dbx);
    const emps = employees.list(dbx, ctx, { department_id });
    const rows = emps.map(e => { const days = dbx.all("SELECT * FROM attendance_days WHERE employee_id=? AND date BETWEEN ? AND ?", [e.id, from, to]); return { ...e, ...summarize(days, c, e) }; });
    const totals = rows.reduce((a, r) => ({ present: a.present + r.present, late: a.late + r.late, absent: a.absent + r.absent, leave: a.leave + r.leave, overtime_minutes: a.overtime_minutes + r.overtime_minutes, weekend_ot_minutes: a.weekend_ot_minutes + r.weekend_ot_minutes, overtime_pay: a.overtime_pay + r.overtime_pay + r.weekend_pay, late_deduction: a.late_deduction + r.late_deduction, absence_deduction: a.absence_deduction + r.absence_deduction }), { present: 0, late: 0, absent: 0, leave: 0, overtime_minutes: 0, weekend_ot_minutes: 0, overtime_pay: 0, late_deduction: 0, absence_deduction: 0 });
    const locked = !!dbx.get("SELECT 1 FROM attendance_days WHERE locked=1 AND date BETWEEN ? AND ? LIMIT 1", [from, to]);
    return { month: m, rows, totals, locked, settings: c };
  },
};

export const dashboard = {
  summary(dbx, ctx) {
    require(ctx, "viewer");
    const d = today(); const c = company.get(dbx);
    attendance.ensure(dbx, ctx, { from: isoDate(addDays(new Date(), -30)), to: d });
    const scope = deptScope(ctx); const sw = scope ? "AND e.department_id=" + scope : "";
    const todayRows = dbx.all(`SELECT a.*, e.emp_no, e.name_en, e.name_ar, d.name_en AS dept_en, d.name_ar AS dept_ar, s.start_time, s.end_time FROM attendance_days a JOIN employees e ON e.id=a.employee_id LEFT JOIN departments d ON d.id=e.department_id LEFT JOIN shifts s ON s.id=a.shift_id WHERE a.date=? AND e.status='active' ${sw}`, [d]);
    const counts = {}; for (const r of todayRows) counts[r.status] = (counts[r.status] || 0) + 1;
    const onSite = todayRows.filter(r => r.first_in && !r.last_out);
    const lateToday = todayRows.filter(r => r.late_minutes > 0).sort((a, b) => b.late_minutes - a.late_minutes);
    const trend = dbx.all(`SELECT a.date, SUM(a.status IN ('present','late','early_leave')) AS present, SUM(a.status='late') AS late, SUM(a.status='absent') AS absent, SUM(a.overtime_minutes) AS ot FROM attendance_days a JOIN employees e ON e.id=a.employee_id WHERE a.date BETWEEN ? AND ? AND a.status NOT IN ('weekend','holiday') ${sw} GROUP BY a.date ORDER BY a.date`, [isoDate(addDays(new Date(), -30)), d]);
    const m = d.slice(0, 7);
    const otByDept = dbx.all(`SELECT dp.name_en, dp.name_ar, SUM(a.overtime_minutes+a.weekend_ot_minutes) AS ot, SUM(a.late_minutes) AS late FROM attendance_days a JOIN employees e ON e.id=a.employee_id JOIN departments dp ON dp.id=e.department_id WHERE a.date BETWEEN ? AND ? ${sw} GROUP BY dp.id ORDER BY ot DESC`, [`${m}-01`, d]);
    const pendingLeaves = leaves.list(dbx, ctx, { status: "pending" }).length;
    const missing = dbx.all(`SELECT a.date, e.emp_no, e.name_en, e.name_ar, a.first_in FROM attendance_days a JOIN employees e ON e.id=a.employee_id WHERE a.status='incomplete' AND a.note='missing out punch' AND a.date >= ? ${sw} ORDER BY a.date DESC LIMIT 10`, [isoDate(addDays(new Date(), -14))]);
    const headcount = dbx.get(`SELECT COUNT(*) AS n FROM employees e WHERE status='active' ${sw}`).n;
    return { date: d, headcount, counts, on_site: onSite, late_today: lateToday.slice(0, 10), trend, ot_by_dept: otByDept, pending_leaves: pendingLeaves, missing_punches: missing, settings: c };
  },
};
export function auditLog(dbx, ctx, limit = 100) { require(ctx, "hr"); return dbx.all("SELECT a.*, u.name AS user_name FROM audit_log a LEFT JOIN users u ON u.id=a.user_id ORDER BY a.id DESC LIMIT ?", [limit]); }
