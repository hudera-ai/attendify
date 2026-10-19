import { h, ic, chip, table, toast } from "../ui.js";
import { t, pick, fmtDateTime, fmtNum } from "../i18n.js";
import { render } from "../main.js";

const SAMPLE = () => { const d = new Date(); d.setDate(d.getDate() - 1); const ds = d.toISOString().slice(0, 10); return `device_id,datetime,type\n101,${ds} 07:52:10,in\n101,${ds} 17:41:03,out\n102,${ds} 08:21:44,in\n102,${ds} 17:02:19,out\n115,${ds} 05:58:30,in\n115,${ds} 16:05:12,out\n999,${ds} 08:00:00,in`; };

export async function importPunches(app) {
  const canEdit = ["hr", "admin"].includes(app.user.role);
  const recent = await app.api.punches.list({ limit: 15 });
  const ta = h("textarea", { placeholder: t("Paste the device export (CSV/TSV) or drop a file"), style: { minHeight: "180px", fontFamily: "var(--f-mono)", fontSize: "13px" }, disabled: !canEdit });
  const preview = h("div", {});
  const result = (r, final) => h("div", { class: "col" },
    h("div", { class: "row" }, chip(`${t("Parsed rows")} ${r.parsed}`, "grey", false), chip(`${final ? t("Imported") : t("Will insert")} ${r.inserted}`, "green", false), r.duplicates ? chip(`${t("Duplicates")} ${r.duplicates}`, "amber", false) : null, r.unknown.length ? chip(`${t("Unknown device IDs")}: ${r.unknown.join(", ")}`, "red", false) : null, r.errors.length ? chip(`${t("Errors")} ${r.errors.length}`, "red", false) : null, r.from ? chip(`${r.from} → ${r.to} · ${r.employees} ${t("Employees").toLowerCase()}`, "blue", false) : null),
    r.errors.length ? h("div", { class: "xs muted mono" }, ...r.errors.slice(0, 5).map(e => h("div", {}, `#${e.line}: ${e.text}`))) : null);
  let timer; ta.addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(async () => { if (!ta.value.trim()) return preview.replaceChildren(); try { preview.replaceChildren(result(await app.api.punches.import(ta.value, true), false)); } catch (e) { preview.replaceChildren(h("span", { class: "small", style: { color: "var(--red)" } }, e.message)); } }, 300); });
  const drop = h("div", { class: "card", ondragover: e => { e.preventDefault(); drop.style.borderColor = "var(--primary)"; }, ondragleave: () => drop.style.borderColor = "", ondrop: async e => { e.preventDefault(); drop.style.borderColor = ""; const f = e.dataTransfer.files[0]; if (f) { ta.value = await f.text(); ta.dispatchEvent(new Event("input")); } } },
    h("div", { class: "hd" }, h("h2", {}, t("Import punches")), h("span", { class: "sp" }), h("button", { class: "btn sm ghost", onclick: () => { ta.value = SAMPLE(); ta.dispatchEvent(new Event("input")); } }, t("Try a sample")), h("label", { class: "btn sm" }, ic("inbox"), "File", h("input", { type: "file", accept: ".csv,.txt,.tsv,.dat", style: { display: "none" }, onchange: async e => { const f = e.target.files[0]; if (f) { ta.value = await f.text(); ta.dispatchEvent(new Event("input")); } } }))),
    h("div", { class: "bd col" }, ta, h("div", { class: "small muted" }, h("b", {}, t("Accepted layouts")), ": ", h("code", { class: "mono xs" }, "device_id,datetime[,type]"), " · ", h("code", { class: "mono xs" }, "emp_no,date,time[,type]"), " · ", h("code", { class: "mono xs" }, "ID\\tTime\\tStatus"), " — ", "type: in/out/0/1/C-In/C-Out/دخول/خروج (optional; the engine pairs punches by time when missing)"), preview),
    h("div", { class: "ft" }, h("span", { class: "sp" }), h("button", { class: "btn primary", disabled: !canEdit, onclick: async () => { if (!ta.value.trim()) return; try { const r = await app.api.punches.import(ta.value, false); preview.replaceChildren(result(r, true)); toast(`${t("Imported")} ${r.inserted}`); ta.value = ""; setTimeout(render, 1200); } catch (e) { toast(t(e.message), true); } } }, ic("check"), t("Import"))));
  return h("div", {},
    h("div", { class: "topbar" }, h("h1", {}, t("Import punches"))),
    h("div", { class: "grid", style: { gridTemplateColumns: "minmax(0,3fr) minmax(0,2fr)" } }, drop,
      h("div", { class: "card" }, h("div", { class: "hd" }, h("h2", {}, t("Recent punches"))), table([{ l: t("Time"), v: p => h("span", { class: "mono small" }, fmtDateTime(p.punched_at)) }, { l: t("Employee"), v: p => h("div", {}, h("div", { class: "small" }, pick(p, "name")), h("div", { class: "xs muted mono" }, p.emp_no)) }, { l: t("Type"), v: p => p.type ? chip(t(p.type === "in" ? "In" : "Out"), p.type === "in" ? "green" : "grey", false) : "" }, { l: t("source"), v: p => h("span", { class: "xs muted" }, t(p.source)) }], recent, { onRow: p => location.hash = `#/employee/${p.employee_id}?month=${p.punched_at.slice(0, 7)}` }))));
}
