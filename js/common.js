import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";

export const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
export const TZ = "Asia/Manila";

export const STATUS = {
  pending_verification: "Pending verification",
  verified: "Verified",
  assigned: "Assigned",
  in_progress: "In progress",
  resolved: "Resolved",
  rejected: "Rejected",
};
export const STATUS_COLOR = {
  pending_verification: "#f59e0b",
  verified: "#3b82f6",
  assigned: "#8b5cf6",
  in_progress: "#0ea5e9",
  resolved: "#16a34a",
  rejected: "#9ca3af",
};

export const $ = (s, el = document) => el.querySelector(s);
export const $$ = (s, el = document) => [...el.querySelectorAll(s)];
export const esc = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
export const fmtDateTime = (d) =>
  d
    ? new Date(d).toLocaleString("en-PH", {
        timeZone: TZ,
        month: "short",
        day: "numeric",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit",
      })
    : "—";
export const fmtDate = (d) =>
  d
    ? new Date(
        d + (String(d).length === 10 ? "T00:00:00" : ""),
      ).toLocaleDateString("en-PH", {
        timeZone: TZ,
        weekday: "short",
        month: "short",
        day: "numeric",
        year: "numeric",
      })
    : "—";
export const fmtTime = (t) => {
  if (!t) return "—";
  const [h, m] = t.split(":");
  const n = +h;
  return `${n % 12 || 12}:${m} ${n >= 12 ? "PM" : "AM"}`;
};
export const todayManila = () =>
  new Date().toLocaleDateString("en-CA", { timeZone: TZ });
export const badge = (s) =>
  `<span class="badge" style="background:${STATUS_COLOR[s] || "#999"}">${esc(STATUS[s] || s)}</span>`;

export function toast(msg, type = "ok") {
  let box = $("#toasts");
  if (!box) {
    box = document.createElement("div");
    box.id = "toasts";
    document.body.appendChild(box);
  }
  const t = document.createElement("div");
  t.className = "toast " + type;
  t.textContent = msg;
  box.appendChild(t);
  setTimeout(() => t.remove(), 4500);
}

/** Redirects to login unless a signed-in, active user has one of the allowed roles. Returns { user, profile }. */
export async function requireRole(roles) {
  const {
    data: { session },
  } = await sb.auth.getSession();
  if (!session) {
    location.href = "index.html";
    throw new Error("not signed in");
  }
  const { data: profile, error } = await sb
    .from("profiles")
    .select("*, collection_zones(zone_name)")
    .eq("id", session.user.id)
    .single();
  if (
    error ||
    !profile ||
    !profile.is_active ||
    !roles.includes(profile.role)
  ) {
    await sb.auth.signOut();
    location.href = "index.html?denied=1";
    throw new Error("access denied");
  }
  return { user: session.user, profile };
}

export async function signOut() {
  const { error } = await sb.auth.signOut({ scope: "local" });

  if (error) {
    console.error("Supabase sign-out error:", error);
  }

  // Clear this browser's persisted Supabase session as a fallback.
  localStorage.removeItem("sb-ccbteodopnjfvlqygybs-auth-token");

  location.replace("./index.html?logout=1");
}

/** Fire-and-forget SMS request. A failure never blocks the user's action (NFR-08). */
export async function notify(event_type, ids) {
  try {
    const { data, error } = await sb.functions.invoke("send-sms", {
      body: { event_type, ...ids },
    });
    if (error) console.warn("SMS request failed:", error.message);
    return data;
  } catch (e) {
    console.warn("SMS request failed:", e);
    return null;
  }
}

export async function photoUrl(path) {
  if (!path) return null;
  const { data } = await sb.storage
    .from("report-photos")
    .createSignedUrl(path, 3600);
  return data?.signedUrl ?? null;
}

export async function uploadPhoto(uid, file) {
  if (!file) return null;
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type))
    throw new Error("Photo must be a JPG, PNG or WebP image.");
  if (file.size > 5 * 1024 * 1024)
    throw new Error("Photo must be 5 MB or smaller.");
  const ext = file.type.split("/")[1].replace("jpeg", "jpg");
  const path = `${uid}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const { error } = await sb.storage
    .from("report-photos")
    .upload(path, file, { contentType: file.type });
  if (error) throw error;
  return path;
}

function navIcon(id, label) {
  const key = `${id} ${label}`.toLowerCase();

  const icons = [
    [
      /dashboard|home/,
      '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/>',
    ],
    [
      /resident|people|users/,
      '<path d="M16 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="10" cy="7" r="4"/><path d="M20 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',
    ],
    [
      /schedule|calendar/,
      '<rect x="3" y="4" width="18" height="17" rx="2"/><path d="M16 2v4M8 2v4M3 10h18M8 14h2M14 14h2"/>',
    ],
    [
      /collector|truck/,
      '<path d="M3 6h11v12H3zM14 10h4l3 4v4h-7z"/><circle cx="7.5" cy="18.5" r="1.5"/><circle cx="17.5" cy="18.5" r="1.5"/>',
    ],
    [
      /zone|location|map/,
      '<path d="M20 10c0 5-8 11-8 11S4 15 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="2.5"/>',
    ],
    [
      /missed|alert/,
      '<circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16h.01"/>',
    ],
    [
      /report|complaint/,
      '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M8 13h8M8 17h8"/>',
    ],
    [
      /setting/,
      '<circle cx="12" cy="12" r="3"/><path d="m19.4 15 .1.1 1.4 1.1-1.4 2.4-1.7-.7a8 8 0 0 1-1.7 1l-.3 1.8h-2.8l-.3-1.8a8 8 0 0 1-1.7-1l-1.7.7-1.4-2.4 1.4-1.1a8 8 0 0 1 0-2l-1.4-1.1 1.4-2.4 1.7.7a8 8 0 0 1 1.7-1l.3-1.8h2.8l.3 1.8a8 8 0 0 1 1.7 1l1.7-.7 1.4 2.4-1.4 1.1a8 8 0 0 1 0 2Z"/>',
    ],
  ];

  const match = icons.find(([pattern]) => pattern.test(key));
  const svg =
    match?.[1] || '<circle cx="12" cy="12" r="9"/><path d="M12 8v8M8 12h8"/>';

  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
    stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"
    aria-hidden="true">${svg}</svg>`;
}

/** Page shell used by the three dashboards: left sidebar navigation + content area. */
export function shell({ title, profile, tabs }) {
  document.body.innerHTML = `
  <div class="layout">
    <aside class="sidebar" id="sidebar">
      <div class="side-head">
  <div class="brand">
    <img src="./assets/ecotrack-logo.png" alt="EcoTrack Logo" class="sidebar-logo">
    <small>${esc(title)}</small>
  </div>
        <button class="menu-btn" id="menu" aria-label="Toggle menu" aria-expanded="false">☰</button></div>
      <nav id="nav">
  ${tabs
    .map(
      ([id, label]) => `
    <a href="#${id}" data-tab="${id}">
      <span class="nav-icon">${navIcon(id, label)}</span>
      <span class="nav-text">${esc(label)}</span>
    </a>
  `,
    )
    .join("")}
</nav>
      <div class="side-foot"><div class="who">${esc(profile.full_name)}<small>${esc(profile.role)}</small></div>
        <a href="#" id="logout" class="logout">Log out</a></div>
    </aside>
    <main class="container">${tabs.map(([id]) => `<section class="view" id="view-${id}" hidden></section>`).join("")}</main>
  </div>
  <div class="modal" id="modal" hidden><div class="modal-box"><button class="x" id="modal-x" aria-label="Close">×</button><div id="modal-body"></div></div></div>`;
  $("#logout").onclick = async (e) => {
    e.preventDefault();

    const btn = $("#logout");
    btn.style.pointerEvents = "none";
    btn.textContent = "Logging out...";

    await signOut();
  };
  $("#menu").onclick = () => {
    const o = $("#sidebar").classList.toggle("open");
    $("#menu").setAttribute("aria-expanded", o);
  };
  $("#nav").onclick = () => $("#sidebar").classList.remove("open");
  $("#modal-x").onclick = closeModal;
  $("#modal").onclick = (e) => {
    if (e.target.id === "modal") closeModal();
  };
}
export const openModal = (html) => {
  $("#modal-body").innerHTML = html;
  $("#modal").hidden = false;
};
export const closeModal = () => {
  $("#modal").hidden = true;
  $("#modal-body").innerHTML = "";
};

/** Simple hash router: calls loaders[tab]() when a tab opens. */
export function router(loaders, first) {
  const go = async () => {
    const id = (location.hash || "#" + first).slice(1);
    const tab = loaders[id] ? id : first;
    $$(".view").forEach((v) => (v.hidden = v.id !== "view-" + tab));
    $$("#nav a[data-tab]").forEach((a) =>
      a.classList.toggle("on", a.dataset.tab === tab),
    );
    try {
      await loaders[tab]();
    } catch (e) {
      console.error(e);
      toast(e.message || "Something went wrong", "err");
    }
  };
  window.addEventListener("hashchange", go);
  go();
  return go;
}

/** Human-friendly duration from hours (number) -> "35 min", "7.5 h", "2.3 days". */
export const fmtHours = (h) =>
  h == null || isNaN(h)
    ? "—"
    : h < 1
      ? Math.round(h * 60) + " min"
      : h < 48
        ? h.toFixed(1) + " h"
        : (h / 24).toFixed(1) + " days";
export const hoursBetween = (a, b) => (new Date(b) - new Date(a)) / 36e5;
export const dayOf = (ts) =>
  new Date(ts).toLocaleDateString("en-CA", { timeZone: TZ });
