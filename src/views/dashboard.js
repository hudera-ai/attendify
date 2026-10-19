import { h, ic, chip, statusChip, table, lineChart, barChart } from "../ui.js";
import { t, pick, fmtNum, fmtDate, fmtTime, hm } from "../i18n.js";

export const STATUS_COLOR = { present: "green", late: "amber", absent: "red", leave: "sky", weekend: "grey", holiday: "grey", incomplete: "violet", early_leave: "amber" };
export const attChip = s => chip(t(s), STATUS_COLOR[s] || "grey");
const stat = (label, value, sub, color) => h("div", { class: "card stat" }, h("div", { class: "lbl" }, label), h("div", { class: "val", style: color ? { color: `var(--${color})` } : null }, value), sub ? h("div", { class: "sub" }, sub) : null);

export async function dashboard(app) {
  const d = await app.api.dashboard();
  const c = d.counts;
  const present = (c.present || 0) + (c.late || 0) + (c.early_leave || 0);
  return h("div", {},
    h("div", { class: "topbar" }, h("div", {}, h("h1", {}, t("Dashboard")), h("div", { class: "small muted" }, fmtDate(d.date))), h("div", { class: "actions row" }, h("a", { class: "btn", href: "#/import" }, ic("inbox"), t("Import punches")), h("a", { class: "btn primary", href: "#/daily" }, ic("check"), t("Daily sheet")))),
    h("div", { class: "grid g4", style: { marginBottom: "14px" } },
      stat(t("Present today"), present, `${t("Headcount")} ${d.headcount} · ${c.incomplete || 0} ${t("incomplete")}`, "mint"),
      stat(t("Late today"), c.late || 0, d.late_today.length ? `${hm(d.late_today.reduce((a, b) => a + b.late_minutes, 0))} ${t("Hours").toLowerCase()}` : "", c.late ? "amber" : null),
      stat(t("Absent today"), c.absent || 0, `${c.leave || 0} ${t("On leave").toLowerCase()}`, c.absent ? "red" : null),
      stat(t("Pending leave requests"), d.pending_leaves, d.missing_punches.length ? `${d.missing_punches.length} ${t("Missing out punches").toLowerCase()}` : "", d.pending_leaves ? "primary" : null)),
    h("div", { class: "grid g2", style: { marginBottom: "14px" } },
      h("div", { class: "card" }, h("div", { class: "hd" }, h("h2", {}, t("Attendance (last 30 days)"))), h("div", { class: "bd" }, lineChart([{ points: d.trend.map(x => ({ x: x.date, y: x.present })), area: true }, { points: d.trend.map(x => ({ x: x.date, y: x.late })) }, { points: d.trend.map(x => ({ x: x.date, y: x.absent })) }]),
        h("div", { class: "legend" }, h("span", {}, h("i", { style: { background: "var(--chart-1)" } }), t("present")), h("span", {}, h("i", { style: { background: "var(--chart-2)" } }), t("late")), h("span", {}, h("i", { style: { background: "var(--chart-3)" } }), t("absent"))))),
      h("div", { class: "card" }, h("div", { class: "hd" }, h("h2", {}, t("Overtime this month by department"))), h("div", { class: "bd" }, barChart(d.ot_by_dept.map(x => ({ l: pick(x, "name"), v: Math.round(x.ot / 60) })))))),
    h("div", { class: "grid g2", style: { marginBottom: "14px" } },
      h("div", { class: "card" }, h("div", { class: "hd" }, h("h2", {}, t("Late today")), h("span", { class: "sp" }), h("a", { class: "btn sm", href: "#/daily" }, t("View"))),
        table([{ l: t("Employee"), v: r => h("div", {}, h("div", {}, pick(r, "name")), h("div", { class: "xs muted mono" }, `${r.emp_no} · ${pick(r, "dept")}`)) }, { l: t("Shift"), v: r => h("span", { class: "small mono" }, `${r.start_time}–${r.end_time}`) }, { l: t("In"), v: r => h("span", { class: "mono small" }, fmtTime(r.first_in)) }, { l: t("Late"), v: r => h("span", { class: "pill late" }, `${r.late_minutes} ${t("min")}`), r: true }], d.late_today, { onRow: r => location.hash = `#/employee/${r.employee_id}`, empty: "✓" })),
      h("div", { class: "card" }, h("div", { class: "hd" }, h("h2", {}, t("On site now")), chip(d.on_site.length, "green", false)), h("div", { class: "bd live" }, ...d.on_site.map(r => h("a", { class: "p", href: `#/employee/${r.employee_id}`, style: { textDecoration: "none", color: "inherit" } }, h("span", { class: "avatar" }, r.name_en.split(" ").map(s => s[0]).slice(0, 2).join("")), h("span", { style: { minWidth: 0 } }, h("div", { class: "small", style: { fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" } }, pick(r, "name")), h("div", { class: "xs muted" }, `${t("In")} ${fmtTime(r.first_in)}`)))), d.on_site.length ? null : h("div", { class: "empty small" }, t("Nothing here yet"))))),
    d.missing_punches.length ? h("div", { class: "card" }, h("div", { class: "hd" }, h("h2", {}, t("Missing out punches"))), table([{ l: t("Date"), v: r => fmtDate(r.date) }, { l: t("Employee"), v: r => h("div", {}, pick(r, "name"), h("span", { class: "xs muted mono" }, ` ${r.emp_no}`)) }, { l: t("In"), v: r => h("span", { class: "mono small" }, fmtTime(r.first_in)) }], d.missing_punches, { onRow: r => location.hash = `#/daily?date=${r.date}` })) : null);
}
