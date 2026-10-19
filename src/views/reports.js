import { h, ic, chip, table, toast, sel, inp, confirm } from "../ui.js";
import { t, pick, fmtNum, fmtMoney, hm, monthLabel, LANG } from "../i18n.js";
import { render } from "../main.js";

export async function reports(app, route) {
  const month = route.params.month || new Date().toISOString().slice(0, 7);
  const dept = route.params.department_id || "";
  const [r, depts] = await Promise.all([app.api.attendance.monthly({ month, department_id: dept }), app.api.departments()]);
  const go = p => { const q = { month, department_id: dept, ...p }; location.hash = `#/reports?${new URLSearchParams(Object.fromEntries(Object.entries(q).filter(([, v]) => v)))}`; };
  const canLock = ["hr", "admin"].includes(app.user.role);
  const csv = () => {
    const cols = ["emp_no", "name_en", "dept_en", "shift_code", "work_days", "present", "absent", "leave", "late", "late_minutes", "early_minutes", "worked_minutes", "overtime_minutes", "weekend_ot_minutes", "overtime_pay", "weekend_pay", "late_deduction", "absence_deduction"];
    const lines = [cols.join(","), ...r.rows.map(x => cols.map(c => JSON.stringify(x[c] ?? "")).join(","))];
    const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob(["﻿" + lines.join("\n")], { type: "text/csv" })); a.download = `attendance-${month}${dept ? "-dept" + dept : ""}.csv`; a.click();
  };
  const T = r.totals;
  return h("div", {},
    h("div", { class: "topbar" }, h("div", {}, h("h1", {}, t("Monthly report")), h("div", { class: "small muted" }, monthLabel(month), r.locked ? [" · ", chip(t("Month locked"), "amber", false)] : null)),
      h("div", { class: "actions row no-print" }, inp({ type: "month", value: month, style: { width: "auto" }, onchange: e => go({ month: e.target.value }) }), sel([["", t("All departments")], ...depts.map(x => [x.id, pick(x, "name")])], dept, { style: { width: "auto" }, onchange: e => go({ department_id: e.target.value }) }),
        h("button", { class: "btn", onclick: csv }, t("Export CSV")), h("button", { class: "btn", onclick: () => window.print() }, ic("print"), t("Print / PDF")),
        canLock ? h("button", { class: `btn ${r.locked ? "" : "primary"}`, onclick: async () => { if (await confirm(r.locked ? t("Unlock month") : t("Lock month"), monthLabel(month))) { await app.api.attendance.lock(month, r.locked ? 0 : 1); toast(t("Saved")); render(); } } }, r.locked ? t("Unlock month") : t("Lock month")) : null)),
    h("div", { class: "grid g4", style: { marginBottom: "14px" } },
      h("div", { class: "card stat" }, h("div", { class: "lbl" }, t("Employees")), h("div", { class: "val" }, r.rows.length), h("div", { class: "sub" }, `${T.present} ${t("present")} · ${T.absent} ${t("absent")} · ${T.leave} ${t("leave")}`)),
      h("div", { class: "card stat" }, h("div", { class: "lbl" }, t("Late days")), h("div", { class: "val", style: { color: "var(--amber)" } }, T.late), h("div", { class: "sub" }, `${t("Late deduction")} ${fmtMoney(T.late_deduction)}`)),
      h("div", { class: "card stat" }, h("div", { class: "lbl" }, t("Overtime hours")), h("div", { class: "val", style: { color: "var(--violet)" } }, hm(T.overtime_minutes + T.weekend_ot_minutes)), h("div", { class: "sub" }, `${t("OT pay")} ${fmtMoney(T.overtime_pay)}`)),
      h("div", { class: "card stat" }, h("div", { class: "lbl" }, t("Net adjustment")), h("div", { class: "val", style: { fontSize: "22px" } }, fmtMoney(T.overtime_pay - T.late_deduction - T.absence_deduction)), h("div", { class: "sub" }, `${t("Additions")} ${fmtMoney(T.overtime_pay)} · ${t("Deductions")} ${fmtMoney(T.late_deduction + T.absence_deduction)}`))),
    h("div", { class: "card" }, table([
      { l: t("Employee"), v: x => h("div", {}, h("div", {}, pick(x, "name")), h("div", { class: "xs muted" }, h("span", { class: "mono" }, x.emp_no), " · ", pick(x, "dept"), " · ", x.shift_code || "")) },
      { l: t("Work days"), v: x => x.work_days, r: true, num: true }, { l: t("Present"), v: x => x.present, r: true, num: true }, { l: t("Absent"), v: x => x.absent ? h("span", { style: { color: "var(--red)", fontWeight: 600 } }, x.absent) : "0", r: true, num: true }, { l: t("leave"), v: x => x.leave, r: true, num: true },
      { l: t("Late days"), v: x => x.late ? h("span", { class: "pill late" }, `${x.late} · ${x.late_minutes}${t("min")}`) : "0", r: true },
      { l: t("Worked"), v: x => hm(x.worked_minutes), r: true, num: true }, { l: t("OT"), v: x => x.overtime_minutes ? h("span", { class: "pill ot" }, hm(x.overtime_minutes)) : "—", r: true }, { l: t("Weekend OT"), v: x => x.weekend_ot_minutes ? h("span", { class: "pill ot" }, hm(x.weekend_ot_minutes)) : "—", r: true },
      { l: t("OT pay"), v: x => h("span", { class: "num small" }, fmtNum(x.overtime_pay + x.weekend_pay, 2)), r: true }, { l: t("Deductions"), v: x => h("span", { class: "num small", style: { color: x.late_deduction + x.absence_deduction ? "var(--red)" : "inherit" } }, fmtNum(x.late_deduction + x.absence_deduction, 2)), r: true },
    ], r.rows, { onRow: x => location.hash = `#/employee/${x.id}?month=${month}` })),
    h("p", { class: "xs faint", style: { marginTop: "8px" } }, `${t("Overtime rate")} ×${r.settings.overtime_rate} · ${t("Weekend rate")} ×${r.settings.weekend_rate} · ${t("Grace minutes")} ${r.settings.grace_minutes} · ${t("Monthly hours")} ${r.settings.monthly_hours}`));
}
