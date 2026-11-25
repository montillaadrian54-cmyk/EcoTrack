import {
  sb,
  $,
  esc,
  fmtDate,
  fmtTime,
  fmtDateTime,
  todayManila,
  badge,
  toast,
  fmtHours,
  hoursBetween,
  requireRole,
  shell,
  router,
  openModal,
  notify,
  photoUrl,
  uploadPhoto,
  STATUS,
} from "./common.js";

const { user, profile } = await requireRole(["resident"]);
shell({
  title: "Resident",
  profile,
  tabs: [
    ["schedule", "Collection schedule"],
    ["report", "Report missed pickup"],
    ["myreports", "My reports"],
    ["profile", "My profile"],
  ],
});

// ---------- schedule ----------
async function loadSchedule() {
  const el = $("#view-schedule");
  const from = new Date(Date.now() - 7 * 864e5).toLocaleDateString("en-CA", {
    timeZone: "Asia/Manila",
  });
  const { data, error } = await sb
    .from("collection_schedules")
    .select("*, collection_zones(zone_name)")
    .eq("zone_id", profile.zone_id)
    .gte("collection_date", from)
    .order("collection_date")
    .order("collection_time");
  if (error) throw error;
  const today = todayManila();
  el.innerHTML = `<h1>Collection schedule — ${esc(profile.collection_zones?.zone_name ?? "No purok assigned")}</h1>
  <div class="card"><div class="sc"><table><tr><th>Date</th><th>Time</th><th>Waste type</th><th>Status</th><th></th></tr>
  ${
    (data || [])
      .map(
        (
          s,
        ) => `<tr><td>${fmtDate(s.collection_date)}</td><td>${fmtTime(s.collection_time)}</td><td>${esc(s.waste_type)}</td>
    <td><span class="pill ${s.status}">${{ scheduled: "Scheduled", in_progress: "Collecting now", completed: "Collected", delayed: "Delayed", missed: "Missed", cancelled: "Cancelled" }[s.status]}</span></td>
    <td>${s.collection_date <= today && s.status !== "cancelled" ? `<a href="#report" class="btn s" data-sched="${s.id}">Not collected? Report</a>` : ""}</td></tr>`,
      )
      .join("") ||
    '<tr><td colspan="5" class="muted">No schedules posted for your purok yet.</td></tr>'
  }</table></div></div>`;
  el.querySelectorAll("[data-sched]").forEach((a) =>
    a.addEventListener("click", () => {
      window.__sched = a.dataset.sched;
    }),
  );
}

// ---------- report form ----------
let map, pin;
async function loadReportForm() {
  const el = $("#view-report");
  const { data: zones } = await sb
    .from("collection_zones")
    .select("id, zone_name")
    .order("zone_name");
  el.innerHTML = `<h1>Report a missed pickup</h1><form class="card stack" id="rf">
    <label>Title<input name="title" required minlength="3" maxlength="120" placeholder="Uncollected garbage near the community road"></label>
    <label>Purok<select name="zone">${(zones || []).map((z) => `<option value="${z.id}" ${z.id === profile.zone_id ? "selected" : ""}>${esc(z.zone_name)}</option>`).join("")}</select></label>
    <label>Description<textarea name="description" required minlength="5" maxlength="1000" rows="4" placeholder="Garbage was not collected during the scheduled pickup."></textarea></label>
    <label>Photo evidence (optional, JPG/PNG/WebP up to 5 MB)<input type="file" name="photo" accept="image/jpeg,image/png,image/webp"></label>
    <div><b>Location pin</b> <span class="muted">— click the map where the garbage is (optional)</span>
      <div id="pickmap" class="map" style="height:300px"></div><div class="muted" id="coords">No pin selected</div></div>
    <button class="btn" type="submit" id="submitBtn">Submit report</button></form>`;
  map = L.map("pickmap").setView([8.949, 125.5786], 15);
  pin = null;

  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: "&copy; OpenStreetMap contributors",
  }).addTo(map);

  map.on("click", (e) => {
    if (pin) pin.setLatLng(e.latlng);
    else pin = L.marker(e.latlng).addTo(map);
    $("#coords").textContent =
      `Pin: ${e.latlng.lat.toFixed(6)}, ${e.latlng.lng.toFixed(6)}`;
  });
  setTimeout(() => map.invalidateSize(), 100);

  $("#rf").onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(e.target),
      btn = $("#submitBtn");
    btn.disabled = true;
    btn.textContent = "Submitting…";
    let photo_path = null;
    try {
      photo_path = await uploadPhoto(
        user.id,
        f.get("photo")?.size ? f.get("photo") : null,
      );
      const ll = pin?.getLatLng();
      const { data, error } = await sb
        .from("missed_pickup_reports")
        .insert({
          resident_id: user.id,
          zone_id: f.get("zone"),
          title: f.get("title").trim(),
          description: f.get("description").trim(),
          photo_path,
          latitude: ll ? +ll.lat.toFixed(7) : null,
          longitude: ll ? +ll.lng.toFixed(7) : null,
          schedule_id: window.__sched || null,
        })
        .select("id, report_no")
        .single();
      if (error) throw error;
      window.__sched = null;
      notify("report_submitted", { report_id: data.id });
      toast(`Report ${data.report_no} submitted.`);
      location.hash = "#myreports";
    } catch (err) {
      if (photo_path)
        await sb.storage.from("report-photos").remove([photo_path]);
      toast(err.message || "Could not submit report", "err");
    } finally {
      btn.disabled = false;
      btn.textContent = "Submit report";
    }
  };
}

// ---------- my reports ----------
async function loadMyReports() {
  const el = $("#view-myreports");
  const { data, error } = await sb
    .from("missed_pickup_reports")
    .select("*, collection_zones(zone_name)")
    .order("created_at", { ascending: false });
  if (error) throw error;
  el.innerHTML = `<h1>My reports</h1><div class="card"><div class="sc"><table><tr><th>No.</th><th>Title</th><th>Purok</th><th>Submitted</th><th>Status</th><th>Time open</th><th></th></tr>
   ${
     (data || [])
       .map(
         (
           r,
         ) => `<tr><td>${esc(r.report_no)}</td><td>${esc(r.title)}</td><td>${esc(r.collection_zones?.zone_name)}</td><td>${fmtDateTime(r.created_at)}</td><td>${badge(r.status)}</td><td>${openTime(r)}</td>
   <td><button class="btn s" data-id="${r.id}">Details</button></td></tr>`,
       )
       .join("") ||
     '<tr><td colspan="7" class="muted">You have not submitted any reports.</td></tr>'
   }</table></div></div>`;
  el.querySelectorAll("[data-id]").forEach(
    (b) =>
      (b.onclick = () => showReport(data.find((r) => r.id === b.dataset.id))),
  );
}

const openTime = (r) =>
  r.status === "resolved" && r.resolved_at
    ? "Resolved in " + fmtHours(hoursBetween(r.created_at, r.resolved_at))
    : r.status === "rejected"
      ? "—"
      : fmtHours(hoursBetween(r.created_at, new Date()));

async function showReport(r) {
  const [{ data: hist }, url] = await Promise.all([
    sb
      .from("report_updates")
      .select("*")
      .eq("report_id", r.id)
      .order("created_at"),
    photoUrl(r.photo_path),
  ]);
  openModal(`<h2>${esc(r.report_no)} — ${esc(r.title)}</h2><p>${badge(r.status)}</p><p>${esc(r.description)}</p>
    ${r.rejection_reason ? `<p class="flash err">Rejected: ${esc(r.rejection_reason)}</p>` : ""}
    ${url ? `<img class="evidence" src="${url}" alt="Evidence photo">` : ""}
    ${r.latitude ? `<p><a target="_blank" rel="noopener" href="https://www.openstreetmap.org/?mlat=${r.latitude}&mlon=${r.longitude}#map=18/${r.latitude}/${r.longitude}">View pinned location on OpenStreetMap</a></p>` : ""}
    <h3>History</h3><ul class="timeline">${(hist || []).map((h) => `<li><b>${esc(STATUS[h.new_status])}</b> · ${fmtDateTime(h.created_at)}${h.notes ? `<div class="muted">${esc(h.notes)}</div>` : ""}</li>`).join("")}</ul>`);
}

// ---------- profile (the phone number is where EcoTrack sends your SMS) ----------
async function loadProfile() {
  const { data: zones } = await sb
    .from("collection_zones")
    .select("id, zone_name")
    .order("zone_name");
  const { data: me } = await sb
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .single();
  $("#view-profile").innerHTML =
    `<h1>My profile</h1><form class="card stack" id="pf">
    <div class="note">SMS notices (collection started, report updates) are sent to this mobile number for your purok.</div>
    <label>Full name<input name="name" required maxlength="80" value="${esc(me.full_name)}"></label>
    <label>Mobile number<input name="phone" required placeholder="09171234567" value="${esc(me.phone_number || "")}"></label>
    <label>Purok<select name="zone">${(zones || []).map((z) => `<option value="${z.id}" ${z.id === me.zone_id ? "selected" : ""}>${esc(z.zone_name)}</option>`).join("")}</select></label>
    <button class="btn" type="submit">Save profile</button></form>`;
  $("#pf").onsubmit = async (e) => {
    e.preventDefault();
    const f = e.target;
    const d = f.phone.value.replace(/\D/g, "");
    const phone =
      d.length === 12 && d.startsWith("63")
        ? "0" + d.slice(2)
        : d.length === 10 && d[0] === "9"
          ? "0" + d
          : d;
    if (!/^09\d{9}$/.test(phone))
      return toast("Enter a valid mobile number like 09171234567.", "err");
    const { error } = await sb
      .from("profiles")
      .update({
        full_name: f.name.value.trim(),
        phone_number: phone,
        zone_id: f.zone.value,
      })
      .eq("id", user.id);
    toast(error ? error.message : "Profile saved.", error ? "err" : "ok");
  };
}

const go = router(
  {
    schedule: loadSchedule,
    report: loadReportForm,
    myreports: loadMyReports,
    profile: loadProfile,
  },
  "schedule",
);

// live status updates
sb.channel("my-reports")
  .on(
    "postgres_changes",
    {
      event: "UPDATE",
      schema: "public",
      table: "missed_pickup_reports",
      filter: `resident_id=eq.${user.id}`,
    },
    (p) => {
      toast(`Report ${p.new.report_no} is now: ${STATUS[p.new.status]}`);
      if (location.hash === "#myreports") go();
    },
  )
  .subscribe();
