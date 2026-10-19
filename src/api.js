// One client interface, two transports:
//  • http  — talks to the Node server (/api/...)
//  • local — runs the same service code against SQLite in the browser (sql.js + IndexedDB)
// The app never knows which one it is using. `?mode=local` or a GitHub Pages host forces local;
// otherwise we try the server and fall back to local if it isn't there.

import * as svc from "../shared/service.js";
import { wrap } from "../shared/dbx.js";
import { applySeed } from "../shared/seed.js";

export const MODE_KEY = "attendify.mode";
const TOKEN_KEY = "attendify.token";
const SESSION_KEY = "attendify.session";

// ---- http transport --------------------------------------------------------------
function httpClient(base = "") {
  let token = localStorage.getItem(TOKEN_KEY) || "";
  async function call(method, url, body) {
    const res = await fetch(base + url, { method, headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(data.message || data.error || res.statusText), { status: res.status, code: data.error });
    return data;
  }
  const q = o => { const s = new URLSearchParams(Object.entries(o || {}).filter(([, v]) => v !== "" && v != null)).toString(); return s ? `?${s}` : ""; };
  return {
    mode: "http",
    async login(email, password) { const r = await call("POST", "/api/auth/login", { email, password }); token = r.token; localStorage.setItem(TOKEN_KEY, token); return r.user; },
    async logout() { try { await call("POST", "/api/auth/logout"); } catch {} token = ""; localStorage.removeItem(TOKEN_KEY); },
    me: () => call("GET", "/api/auth/me"), users: () => call("GET", "/api/users"), company: () => call("GET", "/api/company"), updateCompany: p => call("PATCH", "/api/company", p),
    dashboard: () => call("GET", "/api/dashboard"), audit: limit => call("GET", `/api/audit${q({ limit })}`),
    departments: () => call("GET", "/api/departments"), shifts: () => call("GET", "/api/shifts"), saveShift: s => call("POST", "/api/shifts", s),
    holidays: () => call("GET", "/api/holidays"), saveHoliday: h => call("POST", "/api/holidays", h), removeHoliday: d => call("DELETE", `/api/holidays/${d}`),
    employees: { list: o => call("GET", `/api/employees${q(o)}`), get: id => call("GET", `/api/employees/${id}`), save: e => call("POST", "/api/employees", e), month: (id, month) => call("GET", `/api/employees/${id}/month${q({ month })}`) },
    punches: { list: o => call("GET", `/api/punches${q(o)}`), add: p => call("POST", "/api/punches", p), remove: id => call("DELETE", `/api/punches/${id}`), import: (text, dry) => call("POST", "/api/punches/import", { text, dry }) },
    leaves: { list: o => call("GET", `/api/leaves${q(o)}`), create: l => call("POST", "/api/leaves", l), decide: (id, status) => call("POST", `/api/leaves/${id}/decide`, { status }) },
    attendance: { daily: o => call("GET", `/api/attendance/daily${q(o)}`), monthly: o => call("GET", `/api/attendance/monthly${q(o)}`), rebuild: o => call("POST", "/api/attendance/rebuild", o), lock: (month, locked) => call("POST", "/api/attendance/lock", { month, locked }) },
  };
}

// ---- local transport (sql.js in the browser) ------------------------------------------
const IDB = { name: "attendify", store: "db", key: "main" };
function idb() { return new Promise((ok, err) => { const r = indexedDB.open(IDB.name, 1); r.onupgradeneeded = () => r.result.createObjectStore(IDB.store); r.onsuccess = () => ok(r.result); r.onerror = () => err(r.error); }); }
async function idbGet() { try { const d = await idb(); return await new Promise((ok, err) => { const t = d.transaction(IDB.store).objectStore(IDB.store).get(IDB.key); t.onsuccess = () => ok(t.result); t.onerror = () => err(t.error); }); } catch { return null; } }
async function idbSet(bytes) { try { const d = await idb(); await new Promise((ok, err) => { const t = d.transaction(IDB.store, "readwrite").objectStore(IDB.store).put(bytes, IDB.key); t.onsuccess = ok; t.onerror = () => err(t.error); }); } catch {} }

async function localClient() {
  const SQL = await window.initSqlJs({ locateFile: f => `vendor/${f}` });
  const schema = await (await fetch("db/schema.sql")).text();
  const saved = await idbGet();
  const db = new SQL.Database(saved ? new Uint8Array(saved) : undefined);
  const dbx = wrap(db);
  dbx.exec(schema);
  if (!dbx.get("SELECT 1 FROM company")) applySeed(dbx);
  let t = null; const persist = () => { clearTimeout(t); t = setTimeout(() => idbSet(dbx.export()), 300); };
  for (const m of ["run", "exec", "tx"]) { const o = dbx[m]; dbx[m] = (...a) => { const r = o(...a); persist(); return r; }; }
  persist();

  let ctx = { user: JSON.parse(sessionStorage.getItem(SESSION_KEY) || "null") };
  const wrapErr = fn => async (...a) => { try { return await fn(...a); } catch (e) { if (e instanceof svc.ApiError) throw Object.assign(new Error(e.message), { status: e.status, code: e.code }); throw e; } };
  const W = o => Object.fromEntries(Object.entries(o).map(([k, f]) => [k, wrapErr(f)]));
  return {
    mode: "local",
    ...W({
      async login(email, password) { const r = await svc.auth.login(dbx, { email, password }); ctx = { user: r.user }; sessionStorage.setItem(SESSION_KEY, JSON.stringify(r.user)); return r.user; },
      async logout() { ctx = { user: null }; sessionStorage.removeItem(SESSION_KEY); },
      async me() { if (!ctx.user) throw new svc.ApiError(401, "unauthenticated"); return ctx.user; },
      users: () => svc.auth.users(dbx, ctx), company: () => svc.company.get(dbx), updateCompany: p => svc.company.update(dbx, ctx, p), dashboard: () => svc.dashboard.summary(dbx, ctx), audit: limit => svc.auditLog(dbx, ctx, limit),
      departments: () => svc.departments.list(dbx, ctx), shifts: () => svc.shifts.list(dbx, ctx), saveShift: s => svc.shifts.save(dbx, ctx, s), holidays: () => svc.holidays.list(dbx, ctx), saveHoliday: h => svc.holidays.save(dbx, ctx, h), removeHoliday: d => svc.holidays.remove(dbx, ctx, d),
      async reset() { applySeed(dbx); },
    }),
    employees: W({ list: o => svc.employees.list(dbx, ctx, o || {}), get: id => svc.employees.get(dbx, ctx, +id), save: e => svc.employees.save(dbx, ctx, e), month: (id, month) => svc.employees.month(dbx, ctx, +id, month) }),
    punches: W({ list: o => svc.punches.list(dbx, ctx, o || {}), add: p => svc.punches.add(dbx, ctx, p), remove: id => svc.punches.remove(dbx, ctx, +id), import: (text, dry) => svc.punches.import(dbx, ctx, { text, dry }) }),
    leaves: W({ list: o => svc.leaves.list(dbx, ctx, o || {}), create: l => svc.leaves.create(dbx, ctx, l), decide: (id, status) => svc.leaves.decide(dbx, ctx, +id, { status }) }),
    attendance: W({ daily: o => svc.attendance.daily(dbx, ctx, o || {}), monthly: o => svc.attendance.monthly(dbx, ctx, o || {}), rebuild: o => svc.attendance.rebuild(dbx, ctx, o || {}), lock: (month, locked) => svc.attendance.lock(dbx, ctx, { month, locked }) }),
  };
}

export async function createApi() {
  const params = new URLSearchParams(location.search);
  const forced = params.get("mode") || localStorage.getItem(MODE_KEY);
  const onPages = /github\.io$/.test(location.hostname) || location.protocol === "file:";
  if (forced === "local" || (onPages && forced !== "http")) return localClient();
  try {
    const r = await fetch("/api/health", { cache: "no-store" });
    if (r.ok) return httpClient();
  } catch {}
  return localClient();
}
