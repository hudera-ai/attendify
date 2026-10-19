// Attendify API + static web app. Run with `npm start` (http://localhost:8789).
import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { openDb } from "./db.js";
import { ApiError, auth, company, departments, shifts, holidays, employees, punches, leaves, attendance, dashboard, auditLog } from "../../shared/service.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 8789;
const dbx = await openDb();
const sessions = new Map();
const app = express();
app.use(express.json({ limit: "20mb" })); app.use(express.text({ type: ["text/csv", "text/plain"], limit: "20mb" })); app.set("etag", false);
app.use("/api", (req, res, next) => { req.ctx = { user: sessions.get((req.headers.authorization || "").replace(/^Bearer\s+/i, "")) || null }; next(); });
const h = fn => async (req, res) => { try { res.json(await fn(req, res)); } catch (e) { if (e instanceof ApiError) return res.status(e.status).json({ error: e.code, message: e.message }); console.error(e); res.status(500).json({ error: "server_error", message: e.message }); } };
const id = s => parseInt(s, 10);

app.post("/api/auth/login", h(async req => { const r = await auth.login(dbx, req.body || {}); sessions.set(r.token, r.user); return r; }));
app.post("/api/auth/logout", h(req => { sessions.delete((req.headers.authorization || "").replace(/^Bearer\s+/i, "")); return { ok: true }; }));
app.get("/api/auth/me", h(req => { if (!req.ctx.user) throw new ApiError(401, "unauthenticated"); return req.ctx.user; }));
app.get("/api/users", h(req => auth.users(dbx, req.ctx)));
app.get("/api/company", h(() => company.get(dbx)));
app.patch("/api/company", h(req => company.update(dbx, req.ctx, req.body)));
app.get("/api/health", h(() => ({ ok: true, time: new Date().toISOString() })));
app.get("/api/departments", h(req => departments.list(dbx, req.ctx)));
app.get("/api/shifts", h(req => shifts.list(dbx, req.ctx)));
app.post("/api/shifts", h(req => shifts.save(dbx, req.ctx, req.body)));
app.get("/api/holidays", h(req => holidays.list(dbx, req.ctx)));
app.post("/api/holidays", h(req => holidays.save(dbx, req.ctx, req.body)));
app.delete("/api/holidays/:date", h(req => holidays.remove(dbx, req.ctx, req.params.date)));
app.get("/api/employees", h(req => employees.list(dbx, req.ctx, req.query)));
app.post("/api/employees", h(req => employees.save(dbx, req.ctx, req.body)));
app.get("/api/employees/:id", h(req => employees.get(dbx, req.ctx, id(req.params.id))));
app.get("/api/employees/:id/month", h(req => employees.month(dbx, req.ctx, id(req.params.id), req.query.month)));
app.get("/api/punches", h(req => punches.list(dbx, req.ctx, req.query)));
app.post("/api/punches", h(req => punches.add(dbx, req.ctx, req.body)));
app.delete("/api/punches/:id", h(req => punches.remove(dbx, req.ctx, id(req.params.id))));
app.post("/api/punches/import", h(req => punches.import(dbx, req.ctx, typeof req.body === "string" ? { text: req.body, dry: req.query.dry === "1" } : req.body)));
app.get("/api/leaves", h(req => leaves.list(dbx, req.ctx, req.query)));
app.post("/api/leaves", h(req => leaves.create(dbx, req.ctx, req.body)));
app.post("/api/leaves/:id/decide", h(req => leaves.decide(dbx, req.ctx, id(req.params.id), req.body)));
app.get("/api/attendance/daily", h(req => attendance.daily(dbx, req.ctx, req.query)));
app.get("/api/attendance/monthly", h(req => attendance.monthly(dbx, req.ctx, req.query)));
app.post("/api/attendance/rebuild", h(req => { if (!req.ctx.user || req.ctx.user.role === "viewer") throw new ApiError(403, "forbidden"); return attendance.rebuild(dbx, req.ctx, req.body || {}); }));
app.post("/api/attendance/lock", h(req => attendance.lock(dbx, req.ctx, req.body)));
app.get("/api/dashboard", h(req => dashboard.summary(dbx, req.ctx)));
app.get("/api/audit", h(req => auditLog(dbx, req.ctx, id(req.query.limit || 100))));

// Device push endpoint: fingerprint/face devices (or a bridge script) POST punches here.
app.post("/device/punch", h(req => {
  if (process.env.DEVICE_TOKEN && req.headers["x-device-token"] !== process.env.DEVICE_TOKEN) throw new ApiError(403, "forbidden");
  const sys = { user: dbx.get("SELECT id,name,role FROM users WHERE role='admin' LIMIT 1") };
  const body = typeof req.body === "string" ? req.body : Array.isArray(req.body) ? req.body.map(r => `${r.device_id},${r.punched_at},${r.type || ""}`).join("\n") : `${req.body.device_id},${req.body.punched_at},${req.body.type || ""}`;
  return punches.import(dbx, sys, { text: body });
}));

const webRoot = path.join(here, "..", "..");
app.use("/shared", express.static(path.join(webRoot, "shared")));
app.use(express.static(webRoot, { index: "index.html", extensions: ["html"] }));
app.get("/{*path}", (req, res) => res.sendFile(path.join(webRoot, "index.html")));
app.listen(PORT, () => console.log(`Attendify running on http://localhost:${PORT}`));
