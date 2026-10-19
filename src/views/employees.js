import { h, ic, chip, table, modal, toast, field, inp, sel, confirm } from "../ui.js";
import { t, pick, fmtNum, fmtMoney, fmtDate, fmtTime, fmtDateTime, hm, monthLabel, LANG } from "../i18n.js";
import { render } from "../main.js";
import { attChip } from "./dashboard.js";
import { punchForm } from "./daily.js";

export async function employees(app, route) {
  const q = { search: route.params.search || "", department_id: route.params.department_id || "", shift_id: route.params.shift_id || "" };
  const [list, depts, shifts] = await Promise.all([app.api.employees.list(q), app.api.departments(), app.api.shifts()]);
  const go = p => { Object.assign(q, p); location.hash = `#/employees?${new URLSearchParams(Object.fromEntries(Object.entries(q).filter(([, v]) => v)))}`; };
  const canEdit = ["hr", "admin"].includes(app.user.role);
  return h("div", {},
    h("div", { class: "topbar" }, h("h1", {}, t("Employees")), h("div", { class: "actions row" }, inp({ value: q.search, placeholder: t("Search"), style: { width: "200px" }, onkeydown: e => { if (e.key === "Enter") go({ search: e.target.value }); } }),
      sel([["", t("All departments")], ...depts.map(x => [x.id, pick(x, "name")])], q.department_id, { style: { width: "auto" }, onchange: e => go({ department_id: e.target.value }) }),
      sel([["", t("Shift")], ...shifts.map(x => [x.id, `${x.code} ${x.start_time}–${x.end_time}`])], q.shift_id, { style: { width: "auto" }, onchange: e => go({ shift_id: e.target.value }) }),
      canEdit ? h("button", { class: "btn primary", onclick: () => employeeForm(app, {}, depts, shifts) }, ic("plus"), t("New employee")) : null)),
    h("div", { class: "card" }, table([
      { l: t("Emp. No."), v: e => h("span", { class: "mono small" }, e.emp_no) }, { l: t("Name"), v: e => h("div", {}, h("div", { style: { fontWeight: 600 } }, pick(e, "name")), h("div", { class: "xs muted" }, e.job_title || "")) },
      { l: t("Department"), v: e => pick(e, "dept") }, { l: t("Shift"), v: e => h("span", { class: "small" }, e.shift_code ? `${e.shift_code} · ${e.start_time}–${e.end_time}` : "—") },
      { l: t("Device ID"), v: e => h("span", { class: "mono small muted" }, e.device_id || "—") }, { l: t("Nationality"), v: e => h("span", { class: "small" }, e.nationality || "—") }, { l: t("Hire date"), v: e => h("span", { class: "small muted" }, fmtDate(e.hire_date)) },
    ], list, { onRow: e => location.hash = `#/employee/${e.id}` })),
    h("p", { class: "xs faint", style: { marginTop: "8px" } }, `${list.length} ${t("Employees").toLowerCase()}`));
}

function employeeForm(app, e, depts, shifts) {
  const f = { emp_no: inp({ value: e.emp_no || "" }), device_id: inp({ value: e.device_id || "" }), name_en: inp({ value: e.name_en || "" }), name_ar: inp({ value: e.name_ar || "", dir: "rtl" }), department_id: sel(depts.map(x => [x.id, pick(x, "name")]), e.department_id || depts[0]?.id), shift_id: sel(shifts.map(x => [x.id, `${x.code} ${x.start_time}–${x.end_time}`]), e.shift_id || shifts[0]?.id), job_title: inp({ value: e.job_title || "" }), nationality: inp({ value: e.nationality || "" }), phone: inp({ value: e.phone || "" }), hire_date: inp({ type: "date", value: e.hire_date || "" }), basic_salary: inp({ type: "number", value: e.basic_salary ?? "" }), status: sel([["active", t("active")], ["terminated", t("terminated")]], e.status || "active") };
  modal(e.id ? t("Edit") : t("New employee"), h("div", { class: "form" }, field(t("Emp. No."), f.emp_no), field(t("Device ID"), f.device_id), field(t("Name (EN)"), f.name_en), field(t("Name (AR)"), f.name_ar), field(t("Department"), f.department_id), field(t("Shift"), f.shift_id), field(t("Job title"), f.job_title), field(t("Nationality"), f.nationality), field(t("Phone"), f.phone), field(t("Hire date"), f.hire_date), field(t("Basic salary"), f.basic_salary), field(t("Status"), f.status)),
    [{ label: t("Cancel") }, { label: t("Save"), cls: "primary", onClick: async () => { const p = Object.fromEntries(Object.entries(f).map(([k, el]) => [k, el.value])); p.department_id = +p.department_id; p.shift_id = +p.shift_id; if (e.id) p.id = e.id; try { const r = await app.api.employees.save(p); toast(t("Saved")); location.hash = `#/employee/${r.id}`; render(); } catch (err) { toast(t(err.message), true); return false; } } }]);
}

export async function employee(app, route) {
  const month = route.params.month || new Date().toISOString().slice(0, 7);
  const m = await app.api.employees.month(route.id, month);
  const e = m.employee, s = m.summary;
  const canEdit = ["hr", "admin"].includes(app.user.role);
  const [y, mo] = month.split("-").map(Number);
  const prev = new Date(y, mo - 2, 1), next = new Date(y, mo, 1);
  const mkey = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  const first = new Date(y, mo - 1, 1); const daysIn = new Date(y, mo, 0).getDate();
  const byDate = Object.fromEntries(m.days.map(d => [d.date, d]));
  const cells = [...Array(first.getDay())].map(() => h("div", {}));
  for (let dd = 1; dd <= daysIn; dd++) { const ds = `${month}-${String(dd).padStart(2, "0")}`; const r = byDate[ds]; const fut = r && r.status === "incomplete" && r.note === "not started"; cells.push(h("div", { class: `d ${fut ? "future" : r ? r.status : ""}`, title: r ? t(r.status) : "", onclick: () => canEdit && r ? punchForm(app, e.id, ds) : null, style: canEdit ? { cursor: "pointer" } : null }, h("b", {}, dd), fut ? null : r && r.first_in ? h("div", { class: "mono" }, `${fmtTime(r.first_in)}–${fmtTime(r.last_out)}`) : r && !["weekend", "holiday"].includes(r.status) ? h("div", {}, t(r.status === "leave" ? r.leave_type : r.status)) : r ? h("div", {}, t(r.status)) : null, r && r.late_minutes ? h("span", { class: "pill late" }, `+${r.late_minutes}`) : null, r && (r.overtime_minutes || r.weekend_ot_minutes) ? h("span", { class: "pill ot" }, `OT ${hm(r.overtime_minutes + r.weekend_ot_minutes)}`) : null)); }
  const kv = (k, v) => [h("dt", {}, k), h("dd", {}, v)];
  return h("div", {},
    h("div", { class: "crumb" }, h("a", { href: "#/employees" }, t("Employees")), " / ", e.emp_no),
    h("div", { class: "topbar" }, h("div", {}, h("h1", {}, pick(e, "name")), h("div", { class: "small muted" }, `${e.emp_no} · ${e.job_title || ""} · ${pick(e, "dept")} · ${e.shift_code || ""} ${e.start_time || ""}–${e.end_time || ""}`)),
      h("div", { class: "actions row" }, h("button", { class: "btn sm", onclick: () => location.hash = `#/employee/${e.id}?month=${mkey(prev)}` }, "‹"), h("span", { style: { fontWeight: 600, minWidth: "130px", textAlign: "center" } }, monthLabel(month)), h("button", { class: "btn sm", onclick: () => location.hash = `#/employee/${e.id}?month=${mkey(next)}` }, "›"),
        canEdit ? h("button", { class: "btn", onclick: () => punchForm(app, e.id, `${month}-01`) }, ic("plus"), t("Add punch")) : null, canEdit ? h("button", { class: "btn", onclick: async () => { const [depts, shifts] = await Promise.all([app.api.departments(), app.api.shifts()]); employeeForm(app, e, depts, shifts); } }, ic("edit"), t("Edit")) : null)),
    h("div", { class: "grid g4", style: { marginBottom: "14px" } },
      h("div", { class: "card stat" }, h("div", { class: "lbl" }, t("Present")), h("div", { class: "val" }, `${s.present}/${s.work_days}`), h("div", { class: "sub" }, `${s.absent} ${t("absent")} · ${s.leave} ${t("leave")}`)),
      h("div", { class: "card stat" }, h("div", { class: "lbl" }, t("Late days")), h("div", { class: "val", style: { color: s.late ? "var(--amber)" : null } }, s.late), h("div", { class: "sub" }, `${s.late_minutes} ${t("min")} · ${fmtMoney(s.late_deduction)}`)),
      h("div", { class: "card stat" }, h("div", { class: "lbl" }, t("Overtime hours")), h("div", { class: "val", style: { color: "var(--violet)" } }, hm(s.overtime_minutes)), h("div", { class: "sub" }, `${t("Weekend/holiday hours")} ${hm(s.weekend_ot_minutes)}`)),
      h("div", { class: "card stat" }, h("div", { class: "lbl" }, t("Net adjustment")), h("div", { class: "val", style: { fontSize: "22px", color: s.overtime_pay + s.weekend_pay - s.late_deduction - s.absence_deduction >= 0 ? "var(--mint)" : "var(--red)" } }, fmtMoney(s.overtime_pay + s.weekend_pay - s.late_deduction - s.absence_deduction)), h("div", { class: "sub" }, `+${fmtMoney(s.overtime_pay + s.weekend_pay)} − ${fmtMoney(s.late_deduction + s.absence_deduction)}`))),
    h("div", { class: "grid", style: { gridTemplateColumns: "minmax(0,2fr) minmax(0,1fr)", marginBottom: "14px" } },
      h("div", { class: "card" }, h("div", { class: "hd" }, h("h2", {}, t("Calendar"))), h("div", { class: "bd" }, h("div", { class: "cal" }, ...["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map(d => h("div", { class: "hd" }, t(d))), ...cells))),
      h("div", { class: "col", style: { gap: "14px" } },
        h("div", { class: "card" }, h("div", { class: "hd" }, h("h2", {}, t("Employee"))), h("div", { class: "bd" }, h("dl", { class: "kv" }, ...kv(t("Device ID"), e.device_id || "—"), ...kv(t("Nationality"), e.nationality || "—"), ...kv(t("Phone"), e.phone || "—"), ...kv(t("Hire date"), fmtDate(e.hire_date)), ...(["hr", "admin"].includes(app.user.role) ? kv(t("Basic salary"), fmtMoney(e.basic_salary)) : []), ...kv(t("Status"), t(e.status))))),
        h("div", { class: "card" }, h("div", { class: "hd" }, h("h2", {}, t("Leaves"))), table([{ l: t("Type"), v: l => chip(t(l.type), "sky", false) }, { l: t("From"), v: l => fmtDate(l.from_date) }, { l: t("To"), v: l => fmtDate(l.to_date) }, { l: t("Status"), v: l => chip(t(l.status), { approved: "green", pending: "amber", rejected: "red" }[l.status]) }], m.leaves, { empty: "—" })))),
    h("div", { class: "card" }, h("div", { class: "hd" }, h("h2", {}, t("Punches")), chip(m.punches.length, "grey", false)), table([
      { l: t("Time"), v: p => h("span", { class: "mono small" }, fmtDateTime(p.punched_at)) }, { l: t("Type"), v: p => p.type ? chip(t(p.type === "in" ? "In" : "Out"), p.type === "in" ? "green" : "grey", false) : h("span", { class: "xs muted" }, "auto") }, { l: t("source"), v: p => h("span", { class: "small muted" }, t(p.source)) }, { l: t("Note"), v: p => h("span", { class: "small" }, p.note || "") },
      ...(canEdit ? [{ l: "", v: p => h("button", { class: "btn ghost sm", onclick: async () => { if (await confirm(t("Delete"), `${fmtDateTime(p.punched_at)} ${p.type || ""}`)) { await app.api.punches.remove(p.id); render(); } } }, ic("trash")) }] : []),
    ], m.punches.slice().reverse())));
}
