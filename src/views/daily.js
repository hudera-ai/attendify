import { h, ic, chip, table, modal, toast, field, inp, sel } from "../ui.js";
import { t, pick, fmtNum, fmtDate, fmtTime, hm } from "../i18n.js";
import { render } from "../main.js";
import { attChip } from "./dashboard.js";

const todayStr = () => new Date().toISOString().slice(0, 10);

export function punchForm(app, employee_id, date, onDone) {
  const f = { punched_at: inp({ type: "datetime-local", value: `${date}T08:00` }), type: sel([["", "auto"], ["in", t("In")], ["out", t("Out")]], ""), note: inp({ placeholder: t("Note") }) };
  modal(t("Add punch"), h("div", { class: "form" }, field(t("Time"), f.punched_at), field(t("Type"), f.type), field(t("Note"), f.note, { class: "wide" })), [{ label: t("Cancel") }, { label: t("Save"), cls: "primary", onClick: async () => { try { await app.api.punches.add({ employee_id, punched_at: f.punched_at.value.replace("T", " "), type: f.type.value || null, note: f.note.value }); toast(t("Saved")); (onDone || render)(); } catch (e) { toast(t(e.message), true); return false; } } }]);
}

export async function daily(app, route) {
  const date = route.params.date || todayStr();
  const dept = route.params.department_id || "";
  const [d, depts] = await Promise.all([app.api.attendance.daily({ date, department_id: dept }), app.api.departments()]);
  const go = (p = {}) => { const q = { date, department_id: dept, ...p }; location.hash = `#/daily?${new URLSearchParams(Object.fromEntries(Object.entries(q).filter(([, v]) => v)))}`; };
  const canEdit = ["hr", "admin"].includes(app.user.role);
  const counts = Object.entries(d.counts).sort((a, b) => b[1] - a[1]);
  return h("div", {},
    h("div", { class: "topbar" }, h("h1", {}, t("Daily sheet")), h("div", { class: "actions row" },
      h("button", { class: "btn sm", onclick: () => go({ date: new Date(new Date(date).getTime() - 864e5).toISOString().slice(0, 10) }) }, "‹"), inp({ type: "date", value: date, style: { width: "auto" }, onchange: e => go({ date: e.target.value }) }), h("button", { class: "btn sm", onclick: () => go({ date: new Date(new Date(date).getTime() + 864e5).toISOString().slice(0, 10) }) }, "›"),
      sel([["", t("All departments")], ...depts.map(x => [x.id, pick(x, "name")])], dept, { style: { width: "auto" }, onchange: e => go({ department_id: e.target.value }) }),
      canEdit ? h("button", { class: "btn sm", onclick: async () => { await app.api.attendance.rebuild({ from: date, to: date }); toast(t("Saved")); render(); } }, ic("refresh"), t("Rebuild")) : null,
      h("button", { class: "btn sm", onclick: () => window.print() }, ic("print"), t("Print / PDF")))),
    h("div", { class: "row", style: { marginBottom: "14px" } }, ...counts.map(([s, n]) => chip(`${t(s)} ${n}`, { present: "green", late: "amber", absent: "red", leave: "sky", incomplete: "violet", early_leave: "amber" }[s] || "grey"))),
    h("div", { class: "card" }, table([
      { l: t("Employee"), v: r => h("div", {}, h("div", {}, pick(r, "name")), h("div", { class: "xs muted" }, h("span", { class: "mono" }, r.emp_no), " · ", pick(r, "dept"))) },
      { l: t("Shift"), v: r => h("span", { class: "small mono" }, r.shift_code ? `${r.start_time}–${r.end_time}` : "—") },
      { l: t("Status"), v: r => h("span", {}, attChip(r.status), r.note && r.status === "incomplete" ? h("span", { class: "xs muted" }, ` ${t(r.note)}`) : r.leave_type ? h("span", { class: "xs muted" }, ` ${t(r.leave_type)}`) : null) },
      { l: t("In"), v: r => h("span", { class: "mono small" }, fmtTime(r.first_in)) }, { l: t("Out"), v: r => h("span", { class: "mono small" }, fmtTime(r.last_out)) },
      { l: t("Worked"), v: r => h("span", { class: "num small" }, hm(r.worked_minutes)), r: true },
      { l: t("Late"), v: r => r.late_minutes ? h("span", { class: "pill late" }, `${r.late_minutes} ${t("min")}`) : "", r: true },
      { l: t("OT"), v: r => (r.overtime_minutes || r.weekend_ot_minutes) ? h("span", { class: "pill ot" }, hm(r.overtime_minutes + r.weekend_ot_minutes)) : "", r: true },
      ...(canEdit ? [{ l: "", v: r => h("button", { class: "btn ghost sm no-print", title: t("Add punch"), onclick: e => { e.stopPropagation(); punchForm(app, r.employee_id, date); } }, ic("plus")) }] : []),
    ], d.rows, { onRow: r => location.hash = `#/employee/${r.employee_id}?month=${date.slice(0, 7)}` })));
}
