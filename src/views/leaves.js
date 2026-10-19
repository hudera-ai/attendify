import { h, ic, chip, table, modal, toast, field, inp, sel } from "../ui.js";
import { t, pick, fmtDate, fmtDateTime } from "../i18n.js";
import { render } from "../main.js";

export async function leaves(app, route) {
  const status = route.params.status || "";
  const list = await app.api.leaves.list({ status });
  const canDecide = ["hr", "admin"].includes(app.user.role);
  const act = async (fn, msg) => { try { await fn(); toast(msg); render(); } catch (e) { toast(t(e.message), true); } };
  const form = async () => {
    const emps = await app.api.employees.list();
    const f = { employee_id: sel(emps.map(e => [e.id, `${e.emp_no} · ${pick(e, "name")}`]), emps[0]?.id), type: sel(["annual", "sick", "unpaid", "business", "other"].map(x => [x, t(x)]), "annual"), from_date: inp({ type: "date" }), to_date: inp({ type: "date" }), note: inp({ placeholder: t("Note") }) };
    modal(t("New leave"), h("div", { class: "form" }, field(t("Employee"), f.employee_id, { class: "wide" }), field(t("Type"), f.type), field(t("From"), f.from_date), field(t("To"), f.to_date), field(t("Note"), f.note, { class: "wide" })), [{ label: t("Cancel") }, { label: t("Save"), cls: "primary", onClick: () => act(() => app.api.leaves.create({ employee_id: +f.employee_id.value, type: f.type.value, from_date: f.from_date.value, to_date: f.to_date.value, note: f.note.value }), t("Saved")) }]);
  };
  const seg = h("div", { class: "seg" }, ...[["", t("All")], ["pending", t("pending")], ["approved", t("approved")], ["rejected", t("rejected")]].map(([v, l]) => h("button", { class: status === v ? "on" : "", onclick: () => location.hash = `#/leaves${v ? `?status=${v}` : ""}` }, l)));
  return h("div", {},
    h("div", { class: "topbar" }, h("h1", {}, t("Leaves")), h("div", { class: "actions row" }, seg, h("button", { class: "btn primary", onclick: form }, ic("plus"), t("New leave")))),
    h("div", { class: "card" }, table([
      { l: t("Employee"), v: l => h("div", {}, h("div", {}, pick(l, "name")), h("div", { class: "xs muted" }, h("span", { class: "mono" }, l.emp_no), " · ", pick(l, "dept"))) },
      { l: t("Type"), v: l => chip(t(l.type), "sky", false) }, { l: t("From"), v: l => fmtDate(l.from_date) }, { l: t("To"), v: l => fmtDate(l.to_date) },
      { l: t("days"), v: l => Math.round((new Date(l.to_date) - new Date(l.from_date)) / 864e5) + 1, r: true, num: true },
      { l: t("Note"), v: l => h("span", { class: "small" }, l.note || "") },
      { l: t("Status"), v: l => h("div", {}, chip(t(l.status), { approved: "green", pending: "amber", rejected: "red" }[l.status]), l.decided_by_name ? h("div", { class: "xs muted" }, `${l.decided_by_name} · ${fmtDateTime(l.decided_at)}`) : null) },
      ...(canDecide ? [{ l: "", v: l => l.status === "pending" ? h("div", { class: "row", style: { gap: "4px" } }, h("button", { class: "btn sm primary", onclick: e => { e.stopPropagation(); act(() => app.api.leaves.decide(l.id, "approved"), t("Saved")); } }, ic("check"), t("Approve")), h("button", { class: "btn sm", onclick: e => { e.stopPropagation(); act(() => app.api.leaves.decide(l.id, "rejected"), t("Saved")); } }, t("Reject"))) : "" }] : []),
    ], list, { onRow: l => location.hash = `#/employee/${l.employee_id}?month=${l.from_date.slice(0, 7)}` })));
}
