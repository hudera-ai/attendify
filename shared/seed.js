// Sample dataset for a fictional trading company. Deterministic (seeded PRNG). Company,
// people and figures are invented for demonstration purposes.
import { isoDate, isoTime, addDays, pad, shiftWindow } from "./engine.js";

export const DEMO_PASSWORD = "demo1234";
export const DEMO_HASH = "pbkdf2$100000$736974656c6f672d64656d6f2d73616c74$c1518516014ed00eeb9fbc27d1c19b37b424ccc30559442d91dd95fbc6a52a89";
function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32); }

export const COMPANY = { name_ar: "شركة النخيل الذهبي للتجارة", name_en: "Golden Palms Trading Co.", city: "Jeddah", email: "hr@goldenpalms.example", weekend_days: "5,6", grace_minutes: 15, rounding_minutes: 15, min_overtime_minutes: 30, overtime_rate: 1.5, weekend_rate: 2.0, late_deduction: 1, monthly_hours: 240 };
export const USERS = [
  { name: "Huda Al-Zahrani", email: "huda@goldenpalms.example", role: "admin" },
  { name: "Mohammed Fares (HR)", email: "hr@goldenpalms.example", role: "hr" },
  { name: "Salem Al-Ghamdi (Warehouse Mgr)", email: "salem@goldenpalms.example", role: "manager", dept: "WH" },
  { name: "Finance viewer", email: "viewer@goldenpalms.example", role: "viewer" },
];
export const DEPARTMENTS = [["ADM", "الإدارة", "Administration"], ["SAL", "المبيعات والمعرض", "Sales & Showroom"], ["WH", "المستودع", "Warehouse"], ["LOG", "التوصيل والنقل", "Logistics"], ["FIN", "المالية", "Finance"], ["IT", "تقنية المعلومات", "IT"], ["SEC", "الأمن", "Security"]];
export const SHIFTS = [
  ["OFFICE", "دوام إداري", "Office", "08:00", "17:00", 60, null],
  ["SHOW", "المعرض", "Showroom", "10:00", "19:00", 60, null],
  ["WH-A", "مستودع – صباحي", "Warehouse A (morning)", "06:00", "14:00", 30, 10],
  ["WH-B", "مستودع – مسائي", "Warehouse B (evening)", "14:00", "22:00", 30, 10],
  ["SEC-N", "أمن – ليلي", "Security night", "22:00", "06:00", 30, 10],
];
export const HOLIDAYS = [["2026-02-22", "يوم التأسيس", "Founding Day"], ["2026-09-23", "اليوم الوطني", "National Day"], ["2027-02-22", "يوم التأسيس", "Founding Day"]];

const FIRST = ["Ahmed", "Mohammed", "Khalid", "Faisal", "Saad", "Omar", "Yousef", "Abdullah", "Fahad", "Turki", "Nasser", "Majed", "Hassan", "Ali", "Bilal", "Rami", "Tarek", "Karim", "Imran", "Rashid", "Noura", "Sara", "Reem", "Lama", "Hind", "Dana", "Maha", "Amal"];
const FIRST_AR = { Ahmed: "أحمد", Mohammed: "محمد", Khalid: "خالد", Faisal: "فيصل", Saad: "سعد", Omar: "عمر", Yousef: "يوسف", Abdullah: "عبدالله", Fahad: "فهد", Turki: "تركي", Nasser: "ناصر", Majed: "ماجد", Hassan: "حسن", Ali: "علي", Bilal: "بلال", Rami: "رامي", Tarek: "طارق", Karim: "كريم", Imran: "عمران", Rashid: "راشد", Noura: "نورة", Sara: "سارة", Reem: "ريم", Lama: "لمى", Hind: "هند", Dana: "دانة", Maha: "مها", Amal: "أمل" };
const LAST = [["Al-Harbi", "الحربي"], ["Al-Otaibi", "العتيبي"], ["Al-Qahtani", "القحطاني"], ["Al-Shehri", "الشهري"], ["Hassan", "حسن"], ["Mahmoud", "محمود"], ["Khan", "خان"], ["Ahmed", "أحمد"], ["Siddiqui", "صديقي"], ["Al-Amri", "العمري"], ["Youssef", "يوسف"], ["Saleh", "صالح"], ["Abdo", "عبده"], ["Rahman", "رحمن"], ["Al-Balushi", "البلوشي"]];
const NAT = ["Saudi", "Saudi", "Saudi", "Egyptian", "Indian", "Pakistani", "Filipino", "Yemeni", "Sudanese", "Bangladeshi"];
const ROSTER = [ // dept, shift, job, count, salary range
  ["ADM", "OFFICE", "Admin officer", 4, [5000, 8000]], ["FIN", "OFFICE", "Accountant", 3, [6000, 9500]], ["IT", "OFFICE", "IT support", 2, [6500, 9000]],
  ["SAL", "SHOW", "Sales executive", 7, [4500, 7000]], ["WH", "WH-A", "Warehouse worker", 8, [2500, 3800]], ["WH", "WH-B", "Warehouse worker", 6, [2500, 3800]],
  ["LOG", "WH-A", "Driver", 5, [3000, 4200]], ["SEC", "SEC-N", "Security guard", 3, [2800, 3500]], ["WH", "OFFICE", "Warehouse supervisor", 2, [5500, 7000]],
];

export function buildSeed({ today = new Date(), days = 95 } = {}) {
  const rand = rng(20261019); const pick = a => a[Math.floor(rand() * a.length)]; const between = (a, b) => a + Math.floor(rand() * (b - a + 1));
  const employees = []; let n = 0;
  for (const [dept, shift, job, count, [s1, s2]] of ROSTER) for (let k = 0; k < count; k++) {
    n++; const f = pick(FIRST), l = pick(LAST);
    const profile = rand(); // 0–0.6 punctual, 0.6–0.85 sometimes late, 0.85–1 chronic late
    employees.push({ emp_no: `GP-${String(n).padStart(3, "0")}`, device_id: String(100 + n), name_en: `${f} ${l[0]}`, name_ar: `${FIRST_AR[f]} ${l[1]}`, dept, shift, job_title: job, nationality: pick(NAT), phone: `+9665XXXXX${String(100 + n).slice(-3)}`,
      hire_date: isoDate(addDays(today, -between(120, 2400))), basic_salary: Math.round(between(s1, s2) / 100) * 100, p_late: profile < 0.6 ? 0.04 : profile < 0.85 ? 0.18 : 0.4, p_absent: profile < 0.85 ? 0.015 : 0.05, p_ot: dept === "WH" || dept === "LOG" ? 0.3 : 0.12, p_weekend: dept === "WH" || dept === "SEC" ? 0.15 : 0.02 });
  }
  const shiftByCode = Object.fromEntries(SHIFTS.map(s => ({ [s[0]]: { code: s[0], start_time: s[3], end_time: s[4], break_minutes: s[5] } })).map(o => Object.entries(o)[0]));
  const holidays = new Set(HOLIDAYS.map(h => h[0]));
  const start = addDays(today, -days);
  const leaves = [], punches = [];
  for (const e of employees) {
    // 0–2 leave blocks
    const nl = rand() < 0.5 ? between(1, 2) : 0; e.leaveDays = new Set();
    for (let k = 0; k < nl; k++) { const from = addDays(start, between(5, days - 3)); const len = between(1, 5); const type = pick(["annual", "annual", "sick", "business", "unpaid"]); const st = isoDate(from) > isoDate(today) ? "pending" : "approved"; leaves.push({ emp: e.emp_no, type, from_date: isoDate(from), to_date: isoDate(addDays(from, len - 1)), status: st, note: type === "sick" ? "Medical report attached" : type === "business" ? "Supplier visit – Riyadh" : null }); if (st === "approved") for (let i = 0; i < len; i++) e.leaveDays.add(isoDate(addDays(from, i))); }
    const sh = shiftByCode[e.shift];
    for (let i = 0; i <= days; i++) {
      const d = addDays(start, i); const ds = isoDate(d); if (d > today) break;
      const wk = COMPANY.weekend_days.split(",").map(Number).includes(d.getDay()); const hol = holidays.has(ds);
      if (e.leaveDays.has(ds) && !wk) continue;
      if (wk || hol) { if (rand() < e.p_weekend) { const w = shiftWindow(sh, ds); const tin = new Date(w.start.getTime() + between(-10, 20) * 60000), tout = new Date(w.start.getTime() + between(240, 420) * 60000); punches.push([e.emp_no, isoTime(tin), "in"], [e.emp_no, isoTime(tout), "out"]); } continue; }
      if (rand() < e.p_absent) continue;
      const w = shiftWindow(sh, ds);
      const lateMin = rand() < e.p_late ? between(16, 75) : between(-25, 12);
      const tin = new Date(w.start.getTime() + lateMin * 60000);
      const extra = rand() < e.p_ot ? between(30, 200) : between(-8, 14);
      let tout = new Date(w.end.getTime() + extra * 60000);
      if (rand() < 0.03) tout = new Date(w.end.getTime() - between(40, 120) * 60000);   // early leave
      if (tin > today) continue;
      punches.push([e.emp_no, isoTime(tin), "in"]);
      if (tout <= today && rand() > 0.015) punches.push([e.emp_no, isoTime(tout), "out"]); // 1.5% missing out punch
    }
  }
  return { company: COMPANY, users: USERS, departments: DEPARTMENTS, shifts: SHIFTS, holidays: HOLIDAYS, employees, leaves, punches };
}

export function applySeed(dbx, opts = {}) {
  const data = buildSeed(opts);
  dbx.tx(() => {
    for (const t of ["audit_log", "attendance_days", "holidays", "leaves", "punches", "employees", "shifts", "departments", "users", "company"]) dbx.run(`DELETE FROM ${t}`);
    dbx.run("DELETE FROM sqlite_sequence");
    const c = data.company;
    dbx.run("INSERT INTO company (id,name_ar,name_en,city,email,weekend_days,grace_minutes,rounding_minutes,min_overtime_minutes,overtime_rate,weekend_rate,late_deduction,monthly_hours) VALUES (1,?,?,?,?,?,?,?,?,?,?,?,?)", [c.name_ar, c.name_en, c.city, c.email, c.weekend_days, c.grace_minutes, c.rounding_minutes, c.min_overtime_minutes, c.overtime_rate, c.weekend_rate, c.late_deduction, c.monthly_hours]);
    const did = {}; for (const [code, ar, en] of data.departments) did[code] = dbx.run("INSERT INTO departments (code,name_ar,name_en) VALUES (?,?,?)", [code, ar, en]).lastId;
    for (const u of data.users) dbx.run("INSERT INTO users (name,email,role,department_id,password_hash) VALUES (?,?,?,?,?)", [u.name, u.email, u.role, u.dept ? did[u.dept] : null, DEMO_HASH]);
    const sid = {}; for (const [code, ar, en, st, en_, br, gr] of data.shifts) sid[code] = dbx.run("INSERT INTO shifts (code,name_ar,name_en,start_time,end_time,break_minutes,grace_minutes) VALUES (?,?,?,?,?,?,?)", [code, ar, en, st, en_, br, gr]).lastId;
    for (const [date, ar, en] of data.holidays) dbx.run("INSERT INTO holidays (date,name_ar,name_en) VALUES (?,?,?)", [date, ar, en]);
    const eid = {}; for (const e of data.employees) eid[e.emp_no] = dbx.run("INSERT INTO employees (emp_no,device_id,name_ar,name_en,department_id,shift_id,job_title,nationality,phone,hire_date,basic_salary) VALUES (?,?,?,?,?,?,?,?,?,?,?)", [e.emp_no, e.device_id, e.name_ar, e.name_en, did[e.dept], sid[e.shift], e.job_title, e.nationality, e.phone, e.hire_date, e.basic_salary]).lastId;
    for (const l of data.leaves) dbx.run("INSERT INTO leaves (employee_id,type,from_date,to_date,status,note,decided_at) VALUES (?,?,?,?,?,?,?)", [eid[l.emp], l.type, l.from_date, l.to_date, l.status, l.note, l.status === "approved" ? l.from_date + " 09:00:00" : null]);
    for (const [emp, at, type] of data.punches) dbx.run("INSERT OR IGNORE INTO punches (employee_id,punched_at,type,source) VALUES (?,?,?,'device')", [eid[emp], at, type]);
    dbx.run("INSERT INTO audit_log (action,entity,detail) VALUES ('seed','database','Sample data loaded')");
  });
  return data;
}
