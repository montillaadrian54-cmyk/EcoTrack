import {
  startTracking,
  startSimulation,
  stopTracking,
  onTrackingChange,
  trackingState,
  trackingScheduleId,
  savedTrackingId,
} from "./tracking.js";
import {
  sb,
  $,
  esc,
  fmtDate,
  fmtTime,
  fmtDateTime,
  todayManila,
  toast,
  requireRole,
  shell,
  router,
  openModal,
  closeModal,
  notify,
  uploadPhoto,
} from "./common.js";

const { user, profile } = await requireRole(["collector"]);
shell({
  title: "Collector",
  profile,
  tabs: [
    ["tasks", "My tasks"],
    ["done", "History"],
  ],
});

async function fetchTasks() {
  const { data, error } = await sb
    .from("collection_assignments")
    .select(
      `*, collection_schedules(id, zone_id, status, started_at, started_by, collection_date, collection_time, waste_type, collection_zones(zone_name)),
             missed_pickup_reports(id, report_no, title, description, latitude, longitude, collection_zones(zone_name))`,
    )
    .eq("collector_id", user.id)
    .order("assigned_at", { ascending: false });
  if (error) throw error;
  return data || [];
}
const today = todayManila();
let activeRoute = null;
const DEMO = new URLSearchParams(location.search).has("demo");

// ---- live-location banner (shown while a route is in progress) ----
function renderTrackBar() {
  const el = $("#trackBar");
  if (!el) return;
  if (!activeRoute) {
    el.innerHTML = "";
    return;
  }
  const st = trackingState();
  el.innerHTML = st.on
    ? `<div class="card track on"><b>📍 Sharing your live location with the barangay office</b>${st.demo ? ' <span class="pill missed">DEMO route</span>' : ""}
       <div class="muted">${st.last ? `Last sent ${st.last.toLocaleTimeString("en-PH", { hour: "numeric", minute: "2-digit", second: "2-digit" })}${st.accuracy ? ` · accuracy ±${Math.round(st.accuracy)} m` : ""}` : "Waiting for GPS…"} · Keep this page open.</div>
       ${st.error ? `<div class="flash err">${esc(st.error)}</div>` : ""}<button class="btn s" id="stopShare" style="background:#6b7280">Stop sharing</button></div>`
    : `<div class="card track"><b>Location sharing is OFF</b> for this route.${st.error ? `<div class="flash err">${esc(st.error)}</div>` : ""}
       <div class="actions" style="margin-top:6px"><button class="btn s" id="startShare">Share live location</button>${DEMO ? '<button class="btn s" id="simShare" style="background:#7c3aed">Demo: simulate movement</button>' : ""}</div></div>`;
  $("#stopShare") &&
    ($("#stopShare").onclick = () => {
      stopTracking();
      renderTrackBar();
    });
  $("#startShare") &&
    ($("#startShare").onclick = () => {
      startTracking(activeRoute.id);
      renderTrackBar();
    });
  $("#simShare") &&
    ($("#simShare").onclick = async () => {
      const { data: z } = await sb
        .from("collection_zones")
        .select("center_lat, center_lng")
        .eq("id", activeRoute.zone_id)
        .single();
      if (z?.center_lat == null)
        return toast("Set this zone’s center first (Official > Zones).", "err");
      startSimulation(activeRoute.id, +z.center_lat, +z.center_lng);
      renderTrackBar();
    });
}
onTrackingChange(renderTrackBar);
const OUT = {
  scheduled: "Scheduled",
  in_progress: "Collection in progress",
  completed: "Collected",
  delayed: "Delayed",
  missed: "Missed",
  cancelled: "Cancelled",
};

const label = (t) =>
  t.collection_schedules
    ? `<b>Scheduled collection</b> — ${esc(t.collection_schedules.collection_zones?.zone_name)}<div class="muted">${fmtDate(t.collection_schedules.collection_date)} at ${fmtTime(t.collection_schedules.collection_time)} · ${esc(t.collection_schedules.waste_type)}</div>
     <span class="pill ${t.collection_schedules.status}">${OUT[t.collection_schedules.status]}</span>`
    : `<b>Missed pickup ${esc(t.missed_pickup_reports?.report_no)}</b> — ${esc(t.missed_pickup_reports?.collection_zones?.zone_name)}<div>${esc(t.missed_pickup_reports?.title)}</div><div class="muted">${esc(t.missed_pickup_reports?.description)}</div>
     <span class="pill ${t.status}">${t.status.replace("_", " ")}</span>`;

const isOpen = (t) =>
  t.collection_schedules
    ? ["scheduled", "in_progress", "delayed"].includes(
        t.collection_schedules.status,
      )
    : t.status !== "completed";

async function loadTasks() {
  const tasks = (await fetchTasks())
    .filter(isOpen)
    .sort((a, b) =>
      (a.collection_schedules?.collection_date ?? "0").localeCompare(
        b.collection_schedules?.collection_date ?? "0",
      ),
    );
  $("#view-tasks").innerHTML =
    `<h1>My assigned tasks</h1><div id="trackBar"></div>` +
    (tasks.length
      ? tasks
          .map((t) => {
            const s = t.collection_schedules,
              r = t.missed_pickup_reports;
            const due = s && s.collection_date <= today;
            return `<div class="card task"><div>${label(t)}
      ${r?.latitude ? `<div><a target="_blank" rel="noopener" href="https://www.openstreetmap.org/?mlat=${r.latitude}&mlon=${r.longitude}#map=18/${r.latitude}/${r.longitude}">Open location in map</a></div>` : ""}</div>
      <div class="actions">${
        s
          ? (s.collection_date === today &&
            ["scheduled", "delayed"].includes(s.status)
              ? `<button class="btn s go" data-start-route="${s.id}">▶ Start collection</button>`
              : "") +
            (due
              ? `<button class="btn s" data-rec="${s.id}">${s.status === "scheduled" ? "Record outcome" : "Finish / update outcome"}</button>`
              : '<span class="muted">Not due yet</span>') +
            (s.started_at
              ? `<div class="muted">Started ${fmtDateTime(s.started_at)}</div>`
              : "")
          : `${t.status === "assigned" ? `<button class="btn s" data-start="${t.id}">Start follow-up</button>` : ""}<button class="btn s" data-done="${t.id}">Mark resolved</button>`
      }</div></div>`;
          })
          .join("")
      : '<div class="card muted">No pending tasks.</div>');

  activeRoute =
    tasks.find(
      (t) =>
        t.collection_schedules?.status === "in_progress" &&
        t.collection_schedules.started_by === user.id,
    )?.collection_schedules ?? null;
  if (
    activeRoute &&
    !trackingState().on &&
    savedTrackingId() === activeRoute.id
  )
    startTracking(activeRoute.id); // resume after a page reload
  if (!activeRoute && trackingState().on) stopTracking();
  renderTrackBar();
  $("#view-tasks")
    .querySelectorAll("[data-start]")
    .forEach(
      (b) =>
        (b.onclick = async () => {
          const { error } = await sb.rpc("update_assignment", {
            p_assignment: b.dataset.start,
            p_status: "in_progress",
          });
          if (error) return toast(error.message, "err");
          toast("Follow-up started.");
          go();
        }),
    );
  $("#view-tasks")
    .querySelectorAll("[data-done]")
    .forEach(
      (b) =>
        (b.onclick = () =>
          reportDone(tasks.find((t) => t.id === b.dataset.done))),
    );
  $("#view-tasks")
    .querySelectorAll("[data-start-route]")
    .forEach(
      (b) =>
        (b.onclick = () =>
          startDialog(
            tasks.find(
              (t) => t.collection_schedules?.id === b.dataset.startRoute,
            ),
          )),
    );
  $("#view-tasks")
    .querySelectorAll("[data-rec]")
    .forEach(
      (b) =>
        (b.onclick = () =>
          recordDialog(
            tasks.find((t) => t.collection_schedules?.id === b.dataset.rec),
          )),
    );
}

// ---- START COLLECTION: marks the route as started, then SMS-notifies the residents of that purok/zone
async function startDialog(t) {
  const s = t.collection_schedules,
    zone = s.collection_zones?.zone_name;
  const { data: cov } = await sb.rpc("zone_sms_coverage", {
    p_zone: s.zone_id,
  });
  const c = cov?.[0] ?? { total: 0, reachable: 0, missing: 0 };
  openModal(`<h2>Start collection — ${esc(zone)}</h2>
    <p>This marks your route as <b>started</b> and sends an SMS to the residents of <b>${esc(zone)}</b>:</p>
    <div class="note">${c.reachable} of ${c.total} registered resident(s) have a valid mobile number and will be notified${c.missing ? `. ${c.missing} resident(s) have no valid number and will not get the SMS` : ""}.</div>
    <p class="muted">“EcoTrack: Garbage collection in ${esc(zone)} has started. Please bring your garbage out for pickup.”</p>
    <label class="check"><input type="checkbox" id="shareLoc" checked> Share my live location with the barangay office while this route is in progress (only officials can see it; sharing stops when you finish).</label>
    <div class="actions"><button class="btn" id="goStart">Start and notify residents</button><button class="btn s" id="goCancel" style="background:#6b7280">Cancel</button></div>`);
  $("#goCancel").onclick = closeModal;
  $("#goStart").onclick = async (e) => {
    const share = $("#shareLoc").checked;
    e.target.disabled = true;
    e.target.textContent = "Starting…";
    const { error } = await sb.rpc("start_collection", { p_schedule: s.id });
    if (error) {
      toast(error.message, "err");
      return closeModal();
    }
    if (share) startTracking(s.id);
    const out = await notify("collection_started", { schedule_id: s.id }); // route is started even if SMS fails
    closeModal();
    go();
    if (!out || out.error)
      return toast(
        "Collection started, but the SMS request failed: " +
          (out?.error || "no response"),
        "err",
      );
    if (out.skipped)
      return toast("Collection started. SMS not sent: " + out.skipped);
    const r = out.results;
    toast(
      `Collection started. ${r.sent + r.queued} resident(s) notified${r.failed ? `, ${r.failed} failed` : ""}${r.no_phone ? `, ${r.no_phone} without a valid number` : ""}.`,
      r.failed ? "err" : "ok",
    );
  };
}

const nowLocal = () =>
  new Date(Date.now() - new Date().getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);

// ---- record the ACTUAL outcome of a scheduled collection: completed / delayed / missed
function recordDialog(t) {
  openModal(`<h2>Record collection outcome</h2><div>${label(t)}</div>
   <form id="rf" class="stack">
    <label>Outcome<select name="status" id="st"><option value="completed">Completed</option><option value="delayed">Delayed</option><option value="missed">Missed</option></select></label>
    <label id="whyL" hidden>Reason (required)<input name="reason" maxlength="200" placeholder="e.g. truck breakdown, road flooded"></label>
    <label id="whenL">Actual completion time<input type="datetime-local" name="when" value="${nowLocal()}" max="${nowLocal()}"></label>
    <label>Notes<textarea name="notes" rows="3" maxlength="500"></textarea></label>
    <label>Photo evidence (optional)<input type="file" name="photo" accept="image/jpeg,image/png,image/webp"></label>
    <button class="btn" type="submit">Save outcome</button></form>`);
  const sync = () => {
    const v = $("#st").value;
    $("#whyL").hidden = v === "completed";
    $("#whenL").hidden = v !== "completed";
  };
  $("#st").onchange = sync;
  sync();
  $("#rf").onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(e.target),
      status = f.get("status");
    let path = null;
    if (status !== "completed" && !f.get("reason").trim())
      return toast("Please enter a reason.", "err");
    try {
      path = await uploadPhoto(
        user.id,
        f.get("photo")?.size ? f.get("photo") : null,
      );
      const { error } = await sb.rpc("record_collection", {
        p_schedule: t.collection_schedules.id,
        p_status: status,
        p_reason: f.get("reason")?.trim() || null,
        p_notes: f.get("notes").trim() || null,
        p_photo: path,
        p_completed_at:
          status === "completed" && f.get("when")
            ? new Date(f.get("when")).toISOString()
            : null,
      });
      if (error) throw error;
      if (trackingScheduleId() === t.collection_schedules.id) stopTracking();
      toast("Outcome recorded.");
      closeModal();
      go();
    } catch (err) {
      if (path) await sb.storage.from("report-photos").remove([path]);
      toast(err.message || "Could not save", "err");
    }
  };
}

// ---- follow-up task for a resident's missed-pickup report
function reportDone(t) {
  openModal(`<h2>Resolve follow-up</h2><div>${label(t)}</div>
   <form id="cf" class="stack"><label>Note<textarea name="notes" rows="3" maxlength="500" placeholder="What was done?"></textarea></label>
   <label>Photo (optional)<input type="file" name="photo" accept="image/jpeg,image/png,image/webp"></label><button class="btn" type="submit">Mark resolved</button></form>`);
  $("#cf").onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    let path = null;
    try {
      path = await uploadPhoto(
        user.id,
        f.get("photo")?.size ? f.get("photo") : null,
      );
      const { error } = await sb.rpc("update_assignment", {
        p_assignment: t.id,
        p_status: "completed",
        p_notes: f.get("notes").trim() || null,
        p_photo: path,
      });
      if (error) throw error;
      notify("report_resolved", { report_id: t.missed_pickup_reports.id });
      toast("Report resolved.");
      closeModal();
      go();
    } catch (err) {
      if (path) await sb.storage.from("report-photos").remove([path]);
      toast(err.message || "Could not save", "err");
    }
  };
}

async function loadDone() {
  const tasks = (await fetchTasks()).filter((t) => !isOpen(t));
  $("#view-done").innerHTML =
    `<h1>History</h1><div class="card">${tasks.map((t) => `<div class="row">${label(t)}</div>`).join("") || '<span class="muted">Nothing recorded yet.</span>'}</div>`;
}

const go = router({ tasks: loadTasks, done: loadDone }, "tasks");
sb.channel("my-tasks")
  .on(
    "postgres_changes",
    {
      event: "INSERT",
      schema: "public",
      table: "collection_assignments",
      filter: `collector_id=eq.${user.id}`,
    },
    () => {
      toast("You have a new assignment.");
      if (location.hash !== "#done") go();
    },
  )
  .subscribe();
