// App shell + hash router. Views live in src/views/*.js
import { createApi } from "./api.js";
import { t, LANG, setLang } from "./i18n.js";
import { h, $, ic, toast } from "./ui.js";
import * as views from "./views/index.js";

export const app = { api: null, user: null, company: null, route: { name: "dashboard", id: null, params: {} }, counts: {} };

const NAV = [["dashboard", "Dashboard", "dash"], ["daily", "Daily sheet", "check"], ["employees", "Employees", "user"], ["leaves", "Leaves", "sun"], ["import", "Import punches", "inbox"], ["reports", "Monthly report", "rep"], ["settings", "Settings", "cog"]];

export function navigate(hash) { location.hash = hash; }
export function parseRoute() {
  const [path, qs] = location.hash.replace(/^#\/?/, "").split("?");
  const [name = "dashboard", id = null, sub = null] = path.split("/");
  return { name, id, sub, params: Object.fromEntries(new URLSearchParams(qs || "")) };
}

function themeInit() {
  const saved = localStorage.getItem("attendify.theme");
  if (saved) document.documentElement.dataset.theme = saved;
}
export function setTheme(v) { if (v === "system") { delete document.documentElement.dataset.theme; localStorage.removeItem("attendify.theme"); } else { document.documentElement.dataset.theme = v; localStorage.setItem("attendify.theme", v); } }

function shell() {
  const initials = app.user.name.split(" ").filter(Boolean).slice(0, 2).map(s => s[0]).join("").toUpperCase();
  const navLinks = (cls) => NAV.map(([n, label, icon]) => h("a", { href: `#/${n}`, class: cls + (app.route.name === n || (n === "employees" && app.route.name === "employee") ? " on" : "") }, ic(icon), h("span", {}, t(label)), app.counts[n] ? h("span", { class: "cnt" }, app.counts[n]) : null));
  return h("div", { class: "shell" },
    h("aside", { class: "side" },
      h("div", { class: "brand" }, h("span", { class: "mark" }, "A"), h("span", {}, "Attendify", h("small", {}, app.company ? (LANG === "ar" ? app.company.name_ar : app.company.name_en) : t("Attendance & overtime")))),
      h("nav", { class: "nav col", style: { gap: "2px" } }, ...navLinks("")),
      h("div", { class: "user" }, h("span", { class: "avatar" }, initials), h("div", { style: { minWidth: 0 } }, h("div", { class: "small", style: { fontWeight: 600, color: "var(--ink)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, app.user.name), h("div", { class: "xs muted" }, t(app.user.role))),
        h("span", { class: "sp" }), h("button", { class: "btn ghost sm", title: t("Sign out"), onclick: logout }, ic("out")))),
    h("main", { class: "main", id: "view" }),
    h("nav", { class: "mobile-nav" }, ...navLinks("")));
}

async function logout() { await app.api.logout(); app.user = null; render(); }

export async function refreshCounts() {
  try {
    const d = await app.api.dashboard();
    app.counts = { leaves: d.pending_leaves || 0 };
    document.querySelectorAll(".nav a .cnt, .mobile-nav a .cnt").forEach(e => e.remove());
    for (const [n, c] of Object.entries(app.counts)) if (c) document.querySelectorAll(`.nav a[href="#/${n}"], .mobile-nav a[href="#/${n}"]`).forEach(a => a.append(h("span", { class: "cnt" }, c)));
  } catch {}
}

export async function render() {
  setLang(LANG);
  document.body.replaceChildren();
  if (!app.user) { document.body.append(views.login(app)); return; }
  app.route = parseRoute();
  document.body.append(shell());
  const view = $("#view"); view.replaceChildren(h("div", { class: "empty" }, "…"));
  const fn = views[app.route.name] || views.dashboard;
  try { view.replaceChildren(await fn(app, app.route)); }
  catch (e) { console.error(e); view.replaceChildren(h("div", { class: "card" }, h("div", { class: "bd" }, h("h2", {}, t("Something went wrong")), h("p", { class: "muted small mono" }, e.message)))); }
  refreshCounts();
}

window.addEventListener("hashchange", () => { if (app.user) render(); });

(async () => {
  themeInit(); setLang(LANG);
  app.api = await createApi();
  try { app.user = await app.api.me(); } catch { app.user = null; }
  try { app.company = await app.api.company(); } catch {}
  if (app.user && !app.company) app.company = await app.api.company();
  render();
})();
