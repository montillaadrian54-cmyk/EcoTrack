import {
  sb,
  $,
  $$,
  esc,
  fmtDate,
  fmtTime,
  fmtDateTime,
  todayManila,
  badge,
  toast,
  requireRole,
  shell,
  router,
  openModal,
  closeModal,
  notify,
  photoUrl,
  fmtHours,
  hoursBetween,
  dayOf,
  STATUS,
  STATUS_COLOR,
  TZ,
} from "./common.js";

const { user, profile } = await requireRole(["official"]);
shell({
  title: "Barangay Official",
  profile,
  tabs: [
    ["dashboard", "Dashboard"],
    ["reports", "Missed pickups"],
    ["compliance", "Compliance reports"],
    ["map", "Purok map"],
    ["live", "Live tracking"],
    ["schedules", "Schedules"],
    ["zones", "Puroks"],
    ["users", "Users"],
    ["sms", "SMS & settings"],
  ],
});

// ---------- helpers ----------
const charts = {};
const draw = (id, cfg) => {
  charts[id]?.destroy();
  charts[id] = new Chart($("#" + id), cfg);
};
const q = async (p) => {
  const { data, error } = await p;
  if (error) throw error;
  return data || [];
};
const zonesList = async () => {
  const zones = await q(sb.from("collection_zones").select("*"));

  return zones.sort((a, b) =>
    a.zone_name.localeCompare(b.zone_name, undefined, { numeric: true }),
  );
};
const collectorsList = () =>
  q(
    sb
      .from("profiles")
      .select("id, full_name")
      .eq("role", "collector")
      .eq("is_active", true)
      .order("full_name"),
  );
const allReports = () =>
  q(
    sb
      .from("missed_pickup_reports")
      .select(
        "*, collection_zones(zone_name), profiles(full_name, phone_number)",
      )
      .order("created_at", { ascending: false })
      .limit(1000),
  );
const appSettings = async () =>
  Object.fromEntries(
    (await q(sb.from("app_settings").select("*"))).map((r) => [r.key, r.value]),
  );
const outcomes = (f, t) =>
  q(
    sb
      .from("schedule_outcomes")
      .select("*, collection_zones(zone_name)")
      .gte("collection_date", f)
      .lte("collection_date", t)
      .order("collection_date")
      .limit(1000),
  );
const avg = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
const by = (arr, f) =>
  arr.reduce((m, x) => {
    const k = f(x);
    (m[k] = m[k] || []).push(x);
    return m;
  }, {});
const ymd = (n) =>
  new Date(Date.now() - n * 864e5).toLocaleDateString("en-CA", {
    timeZone: TZ,
  });
function range(sel) {
  const to = todayManila();
  return {
    7: [ymd(6), to],
    30: [ymd(29), to],
    month: [to.slice(0, 8) + "01", to],
    all: ["2000-01-01", to],
  }[sel];
}
/** Counts only collections that are already due (past dates / recorded). Completion rate = completed ÷ due. */
function tally(rows) {
  const c = { completed: 0, delayed: 0, missed: 0, unrecorded: 0 };
  rows.forEach((r) => {
    if (r.outcome in c) c[r.outcome]++;
  });
  c.due = c.completed + c.delayed + c.missed + c.unrecorded;
  c.rate = c.due ? Math.round((c.completed / c.due) * 100) : null;
  return c;
}
const weekStart = (d) => {
  const x = new Date(d + "T00:00:00");
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
  return x.toLocaleDateString("en-CA");
};
const resolvedHrs = (r, from) =>
  r.resolved_at ? hoursBetween(r[from], r.resolved_at) : null;
const periodSelect = (id, cur) =>
  `<select id="${id}">${[
    ["7", "Last 7 days"],
    ["30", "Last 30 days"],
    ["month", "This month"],
    ["all", "All time"],
  ]
    .map(
      ([v, l]) =>
        `<option value="${v}" ${cur === v ? "selected" : ""}>${l}</option>`,
    )
    .join("")}</select>`;
const download = (name, text) => {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type: "text/csv" }));
  a.download = name;
  a.click();
};

// ================= DASHBOARD =================
let dashPeriod = "30";
async function loadDashboard() {
  const [f, t] = range(dashPeriod),
    [f30, t30] = range("30");
  const [out, out30, reports, assigns, app, zones] = await Promise.all([
    outcomes(f, t),
    outcomes(f30, t30),
    allReports(),
    q(sb.from("collection_assignments").select("status")),
    appSettings(),
    zonesList(),
  ]);
  const escH = +app.escalation_hours || 24,
    thr = +app.recurring_threshold || 3;
  const tl = tally(out);
  const inP = reports.filter(
    (r) => dayOf(r.created_at) >= f && dayOf(r.created_at) <= t,
  );
  const openV = reports.filter((r) =>
    ["verified", "assigned", "in_progress"].includes(r.status),
  );
  const overdue = openV.filter(
    (r) => r.verified_at && hoursBetween(r.verified_at, new Date()) > escH,
  );
  const resolved = inP.filter((r) => r.status === "resolved" && r.resolved_at);
  const kpi = (l, v, cls = "") =>
    `<div class="card stat"><div class="kpi ${cls}">${v}</div><div class="muted">${l}</div></div>`;

  $("#view-dashboard").innerHTML =
    `<h1>Dashboard</h1><div class="filters">${periodSelect("dp", dashPeriod)}<span class="muted">Collections counted: those already due (past dates). Completion rate = completed ÷ due.</span></div>
  <div class="g4">${kpi("Scheduled & due", tl.due)}${kpi("Completed", tl.completed, "bar-ok")}${kpi("Delayed", tl.delayed)}${kpi("Missed", tl.missed, tl.missed ? "bar-bad" : "")}${kpi("No outcome recorded", tl.unrecorded)}
    ${kpi("Collection completion rate", tl.rate == null ? "—" : tl.rate + "%", tl.rate != null && tl.rate < 80 ? "bar-bad" : "bar-ok")}</div>
  <div class="g4">${kpi("Pending verification", reports.filter((r) => r.status === "pending_verification").length)}${kpi("Verified & unresolved", openV.length)}
    ${kpi(`Overdue (> ${escH} h)`, overdue.length, overdue.length ? "bar-bad" : "")}${kpi("Resolved (period)", resolved.length)}
    ${kpi("Avg. resolution (from verification)", fmtHours(avg(resolved.filter((r) => r.verified_at).map((r) => resolvedHrs(r, "verified_at")))))}
    ${kpi("Avg. resolution (from report)", fmtHours(avg(resolved.map((r) => resolvedHrs(r, "created_at")))))}</div>
  <div class="g2"><div class="card"><h2>Scheduled vs completed by purok</h2><canvas id="c1"></canvas></div><div class="card"><h2>Weekly completion rate (%)</h2><canvas id="c2"></canvas></div>
  <div class="card"><h2>Missed-pickup reports by status</h2><canvas id="c3"></canvas></div><div class="card"><h2>Avg. resolution time by purok (hours, from report)</h2><canvas id="c4"></canvas></div></div>
  <div class="card"><h2>Recurring missed-collection puroks (last 30 days, flagged at ${thr}+ missed/delayed)</h2><div id="recur"></div></div>`;

  const chartZones = [...zones].sort((a, b) => {
    const numA = parseInt(a.zone_name.match(/\d+/)?.[0] || "0", 10);
    const numB = parseInt(b.zone_name.match(/\d+/)?.[0] || "0", 10);

    return numA - numB || a.zone_name.localeCompare(b.zone_name);
  });

  const names = chartZones.map((z) => z.zone_name);

  const zs = by(
    out.filter((r) =>
      ["completed", "delayed", "missed", "unrecorded"].includes(r.outcome),
    ),
    (r) => r.zone_id,
  );

  const pick = (k) =>
    chartZones.map(
      (z) => (zs[z.id] || []).filter((r) => r.outcome === k).length,
    );
  draw("c1", {
    type: "bar",
    data: {
      labels: names,
      datasets: [
        ["completed", "#16a34a"],
        ["delayed", "#f59e0b"],
        ["missed", "#dc2626"],
        ["unrecorded", "#9ca3af"],
      ].map(([k, c]) => ({ label: k, data: pick(k), backgroundColor: c })),
    },
    options: {
      scales: {
        x: { stacked: true },
        y: { stacked: true, beginAtZero: true, ticks: { precision: 0 } },
      },
    },
  });
  const wk = by(
      out.filter((r) =>
        ["completed", "delayed", "missed", "unrecorded"].includes(r.outcome),
      ),
      (r) => weekStart(r.collection_date),
    ),
    wks = Object.keys(wk).sort();
  draw("c2", {
    type: "line",
    data: {
      labels: wks,
      datasets: [
        {
          label: "Completion rate %",
          data: wks.map((k) => tally(wk[k]).rate),
          borderColor: "#0f766e",
          tension: 0.3,
        },
      ],
    },
    options: { scales: { y: { min: 0, max: 100 } } },
  });
  const st = by(inP, (r) => r.status);
  draw("c3", {
    type: "doughnut",
    data: {
      labels: Object.keys(st).map((k) => STATUS[k]),
      datasets: [
        {
          data: Object.values(st).map((a) => a.length),
          backgroundColor: Object.keys(st).map((k) => STATUS_COLOR[k]),
        },
      ],
    },
  });
  const rz = by(resolved, (r) => r.collection_zones?.zone_name || "Unassigned");

  const rn = Object.keys(rz).sort();
  draw("c4", {
    type: "bar",
    data: {
      labels: rn,
      datasets: [
        {
          label: "Hours",
          data: rn.map(
            (n) =>
              +avg(rz[n].map((r) => resolvedHrs(r, "created_at"))).toFixed(1),
          ),
          backgroundColor: "#0ea5e9",
        },
      ],
    },
    options: {
      plugins: { legend: { display: false } },
      scales: { y: { beginAtZero: true } },
    },
  });

  const z30 = Object.entries(
    by(
      out30.filter((r) => ["delayed", "missed"].includes(r.outcome)),
      (r) => r.collection_zones?.zone_name || "Unassigned",
    ),
  )
    .map(([z, a]) => ({
      z,
      n: a.length,
      missed: a.filter((r) => r.outcome === "missed").length,
      reasons: [...new Set(a.map((r) => r.reason).filter(Boolean))]
        .slice(0, 3)
        .join("; "),
    }))
    .filter((x) => x.n >= thr)
    .sort((a, b) => b.n - a.n);
  $("#recur").innerHTML = z30.length
    ? `<table><tr><th>Purok</th><th>Missed + delayed</th><th>Missed</th><th>Reasons given</th></tr>${z30.map((x) => `<tr><td><b>${esc(x.z)}</b> <span class="pill missed">investigate</span></td><td>${x.n}</td><td>${x.missed}</td><td>${esc(x.reasons || "—")}</td></tr>`).join("")}</table>`
    : '<span class="muted">No purok has reached the threshold in the last 30 days.</span>';
}

// ================= MISSED PICKUP REPORTS =================
let repFilter = { status: "", zone: "" };
async function loadReports() {
  const [reports, zones, app] = await Promise.all([
    allReports(),
    zonesList(),
    appSettings(),
  ]);
  const escH = +app.escalation_hours || 24;
  const rows = reports.filter(
    (r) =>
      (!repFilter.status || r.status === repFilter.status) &&
      (!repFilter.zone || r.zone_id === repFilter.zone),
  );
  const timeCell = (r) =>
    r.resolved_at
      ? "Resolved in " + fmtHours(hoursBetween(r.created_at, r.resolved_at))
      : ["rejected"].includes(r.status)
        ? "—"
        : fmtHours(hoursBetween(r.created_at, new Date())) +
          (r.verified_at && hoursBetween(r.verified_at, new Date()) > escH
            ? ' <span class="pill overdue">overdue</span>'
            : "");
  $("#view-reports").innerHTML =
    `<h1>Missed-pickup reports</h1><div class="card"><div class="filters">
    <select id="fs"><option value="">All statuses</option>${Object.entries(
      STATUS,
    )
      .map(
        ([k, v]) =>
          `<option value="${k}" ${repFilter.status === k ? "selected" : ""}>${v}</option>`,
      )
      .join("")}</select>
    <select id="fz"><option value="">All puroks</option>${zones.map((z) => `<option value="${z.id}" ${repFilter.zone === z.id ? "selected" : ""}>${esc(z.zone_name)}</option>`).join("")}</select></div>
    <div class="sc"><table><tr><th>No.</th><th>Title</th><th>Purok</th><th>Resident</th><th>Submitted</th><th>Status</th><th>Time open / to resolve</th><th></th></tr>
    ${rows.map((r) => `<tr><td>${esc(r.report_no)}</td><td>${esc(r.title)}</td><td>${esc(r.collection_zones?.zone_name)}</td><td>${esc(r.profiles?.full_name)}</td><td>${fmtDateTime(r.created_at)}</td><td>${badge(r.status)}</td><td>${timeCell(r)}</td><td><button class="btn s" data-r="${r.id}">Open</button></td></tr>`).join("") || '<tr><td colspan="8" class="muted">No reports match.</td></tr>'}</table></div></div>`;
  $("#fs").onchange = (e) => {
    repFilter.status = e.target.value;
    loadReports();
  };
  $("#fz").onchange = (e) => {
    repFilter.zone = e.target.value;
    loadReports();
  };
  $$("#view-reports [data-r]").forEach(
    (b) =>
      (b.onclick = () =>
        reportDialog(reports.find((r) => r.id === b.dataset.r))),
  );
}

async function reportDialog(r) {
  const [hist, url, collectors] = await Promise.all([
    q(
      sb
        .from("report_updates")
        .select("*, profiles(full_name)")
        .eq("report_id", r.id)
        .order("created_at"),
    ),
    photoUrl(r.photo_path),
    collectorsList(),
  ]);
  const can =
    {
      pending_verification: ["verified", "rejected"],
      verified: ["assigned", "rejected"],
      assigned: ["assigned", "in_progress", "resolved"],
      in_progress: ["resolved"],
    }[r.status] || [];
  const act = {
    verified: "Verify",
    rejected: "Reject",
    assigned:
      r.status === "assigned" ? "Reassign collector" : "Assign collector",
    in_progress: "Mark in progress",
    resolved: "Mark resolved",
  };
  openModal(`<h2>${esc(r.report_no)} — ${esc(r.title)}</h2><p>${badge(r.status)} · ${esc(r.collection_zones?.zone_name)} · by ${esc(r.profiles?.full_name)} (${esc(r.profiles?.phone_number || "no phone")})</p>
   <p>${esc(r.description)}</p>${r.rejection_reason ? `<p class="flash err">Rejected: ${esc(r.rejection_reason)}</p>` : ""}
   <p class="muted">Submitted ${fmtDateTime(r.created_at)}${r.verified_at ? ` · Verified ${fmtDateTime(r.verified_at)}` : ""}${r.resolved_at ? ` · Resolved ${fmtDateTime(r.resolved_at)} (${fmtHours(hoursBetween(r.verified_at || r.created_at, r.resolved_at))} after ${r.verified_at ? "verification" : "submission"})` : ""}</p>
   ${url ? `<img class="evidence" src="${url}" alt="Evidence photo">` : ""}
   ${r.latitude ? `<p><a target="_blank" rel="noopener" href="https://www.openstreetmap.org/?mlat=${r.latitude}&mlon=${r.longitude}#map=18/${r.latitude}/${r.longitude}">View location</a></p>` : '<p class="muted">No map pin provided.</p>'}
   ${
     can.length
       ? `<form id="af" class="stack card"><h3>Take action</h3>
     ${can.includes("assigned") ? `<label>Collector<select name="collector"><option value="">Select collector…</option>${collectors.map((c) => `<option value="${c.id}">${esc(c.full_name)}</option>`).join("")}</select></label>` : ""}
     <label>Notes / reason (required for rejection)<input name="notes" maxlength="300"></label>
     <div class="actions">${can.map((s) => `<button class="btn s ${s === "rejected" ? "danger" : ""}" data-s="${s}" type="button">${act[s]}</button>`).join("")}</div></form>`
       : ""
   }
   <h3>History</h3><ul class="timeline">${hist.map((h) => `<li><b>${esc(STATUS[h.new_status])}</b> · ${fmtDateTime(h.created_at)} · ${esc(h.profiles?.full_name)}${h.notes ? `<div class="muted">${esc(h.notes)}</div>` : ""}</li>`).join("")}</ul>`);
  $$("#af [data-s]").forEach(
    (b) =>
      (b.onclick = async () => {
        const f = $("#af"),
          status = b.dataset.s,
          notes = f.notes.value.trim(),
          collector = f.collector?.value || null;
        if (status === "rejected" && !notes)
          return toast("Please enter a reason for rejection.", "err");
        if (status === "assigned" && !collector)
          return toast("Select a collector first.", "err");
        const { error } = await sb.rpc("update_report_status", {
          p_report: r.id,
          p_status: status,
          p_notes: notes || null,
          p_collector: collector,
        });
        if (error) return toast(error.message, "err");
        toast(`Report ${r.report_no}: ${STATUS[status]}`);
        closeModal();
        if (status === "verified")
          notify("report_verified", { report_id: r.id });
        if (status === "assigned")
          notify("collector_assigned", { report_id: r.id });
        if (status === "resolved")
          notify("report_resolved", { report_id: r.id });
        go();
      }),
  );
}

// ================= COMPLIANCE REPORTS (weekly / monthly) =================
let cmp = { group: "week", from: ymd(55), to: todayManila() };
async function loadCompliance() {
  const [out, reports] = await Promise.all([
    outcomes(cmp.from, cmp.to),
    allReports(),
  ]);
  const key = (d) => (cmp.group === "week" ? weekStart(d) : d.slice(0, 7));
  const lbl = (k) =>
    cmp.group === "week"
      ? `Week of ${fmtDate(k)}`
      : new Date(k + "-01T00:00:00").toLocaleDateString("en-PH", {
          month: "long",
          year: "numeric",
        });
  const bo = by(out, (r) => key(r.collection_date));
  const br = by(
    reports.filter(
      (r) => dayOf(r.created_at) >= cmp.from && dayOf(r.created_at) <= cmp.to,
    ),
    (r) => key(dayOf(r.created_at)),
  );
  const keys = [...new Set([...Object.keys(bo), ...Object.keys(br)])]
    .sort()
    .reverse();
  const rows = keys.map((k) => {
    const t = tally(bo[k] || []),
      rp = br[k] || [],
      rs = rp.filter((r) => r.resolved_at);
    return {
      k,
      ...t,
      rec: rp.length,
      res: rs.length,
      avgH: avg(rs.map((r) => resolvedHrs(r, "created_at"))),
    };
  });
  const all = tally(out);
  $("#view-compliance").innerHTML =
    `<h1>Compliance reports</h1><div class="card"><div class="filters">
    <select id="cg"><option value="week" ${cmp.group === "week" ? "selected" : ""}>Weekly</option><option value="month" ${cmp.group === "month" ? "selected" : ""}>Monthly</option></select>
    From <input type="date" id="cf1" value="${cmp.from}" style="width:auto"> to <input type="date" id="cf2" value="${cmp.to}" style="width:auto">
    <button class="btn s" id="cgo">Apply</button><button class="btn s" id="ccsv">Download CSV</button><button class="btn s" onclick="window.print()">Print</button></div>
    <p><b>Overall:</b> ${all.due} collections due · ${all.completed} completed · ${all.delayed} delayed · ${all.missed} missed · ${all.unrecorded} unrecorded · completion rate <b>${all.rate == null ? "—" : all.rate + "%"}</b></p>
    <div class="sc"><table><tr><th>${cmp.group === "week" ? "Week" : "Month"}</th><th>Due</th><th>Completed</th><th>Delayed</th><th>Missed</th><th>Unrecorded</th><th>Completion rate</th><th>Reports received</th><th>Resolved</th><th>Avg. resolution</th></tr>
    ${rows.map((r) => `<tr><td>${lbl(r.k)}</td><td>${r.due}</td><td>${r.completed}</td><td>${r.delayed}</td><td>${r.missed}</td><td>${r.unrecorded}</td><td><b>${r.rate == null ? "—" : r.rate + "%"}</b></td><td>${r.rec}</td><td>${r.res}</td><td>${fmtHours(r.avgH)}</td></tr>`).join("") || '<tr><td colspan="10" class="muted">No data in this range.</td></tr>'}</table></div></div>`;
  $("#cgo").onclick = () => {
    cmp = { group: $("#cg").value, from: $("#cf1").value, to: $("#cf2").value };
    loadCompliance();
  };
  $("#ccsv").onclick = () =>
    download(
      `ecotrack_${cmp.group}ly_${cmp.from}_to_${cmp.to}.csv`,
      [
        "period,due,completed,delayed,missed,unrecorded,completion_rate_pct,reports_received,reports_resolved,avg_resolution_hours",
      ]
        .concat(
          rows.map((r) =>
            [
              r.k,
              r.due,
              r.completed,
              r.delayed,
              r.missed,
              r.unrecorded,
              r.rate ?? "",
              r.rec,
              r.res,
              r.avgH == null ? "" : r.avgH.toFixed(1),
            ].join(","),
          ),
        )
        .join("\n"),
    );
}

// ================= ZONE MAP =================
async function loadMap() {
  const [reports, zones, out, app] = await Promise.all([
    allReports(),
    zonesList(),
    outcomes(...range("30")),
    appSettings(),
  ]);

  const thr = +app.recurring_threshold || 3;

  $("#view-map").innerHTML =
    `<h1>Purok monitoring map</h1><div class="card"><div class="filters">
    <span class="legend"><i style="background:#16a34a"></i>Purok OK</span>
    <span class="legend"><i style="background:#f59e0b"></i>Some missed/delayed (30 d)</span>
    <span class="legend"><i style="background:#dc2626"></i>Recurring (${thr}+)</span>
    ${Object.entries(STATUS)
      .map(
        ([k, v]) =>
          `<span class="legend"><i style="background:${STATUS_COLOR[k]};border-radius:2px"></i>${v}</span>`,
      )
      .join("")}</div>

    <div id="bigmap" class="map" style="height:540px"></div>
    <div class="muted">Puroks without a center point are not drawn. Set them in the Puroks tab.</div>
  </div>`;

  // Default map location: Barangay Baan, Butuan City
  const map = L.map("bigmap").setView([8.949, 125.5786], 14);
  const pts = [];

  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: "&copy; OpenStreetMap contributors",
  }).addTo(map);

  zones
    .filter((z) => z.center_lat != null)
    .forEach((z) => {
      const t = tally(out.filter((o) => o.zone_id === z.id));
      const bad = t.missed + t.delayed;

      const c = bad >= thr ? "#dc2626" : bad > 0 ? "#f59e0b" : "#16a34a";

      L.circle([+z.center_lat, +z.center_lng], {
        radius: z.radius_m,
        color: c,
        fillColor: c,
        fillOpacity: 0.15,
        weight: 2,
      })
        .addTo(map)
        .bindPopup(
          `<b>${esc(z.zone_name)}</b><br>
      Last 30 days: ${t.completed} completed, ${t.delayed} delayed, ${t.missed} missed<br>
      Completion rate: ${t.rate == null ? "—" : t.rate + "%"}`,
        );

      pts.push([+z.center_lat, +z.center_lng]);
    });

  reports
    .filter((r) => r.latitude)
    .forEach((r) => {
      pts.push([+r.latitude, +r.longitude]);

      L.circleMarker([+r.latitude, +r.longitude], {
        radius: 8,
        color: "#fff",
        weight: 2,
        fillColor: STATUS_COLOR[r.status],
        fillOpacity: 0.95,
      })
        .addTo(map)
        .bindPopup(
          `<b>${esc(r.report_no)}</b><br>
      ${esc(r.title)}<br>
      ${esc(STATUS[r.status])} · ${esc(r.collection_zones?.zone_name)}`,
        );
    });

  // Automatically show all saved zones and report pins, if available.
  // Otherwise, the map stays centered on Barangay Baan.
  if (pts.length) {
    map.fitBounds(pts, {
      padding: [30, 30],
      maxZoom: 16,
    });
  }

  setTimeout(() => map.invalidateSize(), 100);
}

// ================= SCHEDULES =================
let schedView = "upcoming";
async function loadSchedules() {
  const [zones, collectors, scheds] = await Promise.all([
    zonesList(),
    collectorsList(),
    q(
      sb
        .from("collection_schedules")
        .select(
          "*, collection_zones(zone_name), collection_assignments(profiles(full_name)), collection_records(status, reason, completed_at)",
        )
        .order("collection_date", { ascending: schedView === "upcoming" })
        .limit(150),
    ),
  ]);
  const today = todayManila();

  const list = scheds
    .filter(
      (s) =>
        schedView === "all" ||
        (schedView === "upcoming"
          ? s.collection_date >= today
          : s.collection_date < today),
    )
    .sort((a, b) => {
      const nameA = a.collection_zones?.zone_name || "";
      const nameB = b.collection_zones?.zone_name || "";

      return nameA.localeCompare(nameB, undefined, { numeric: true });
    });
  const rec = (s) =>
    Array.isArray(s.collection_records)
      ? s.collection_records[0]
      : s.collection_records;
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  $("#view-schedules").innerHTML = `<h1>Collection schedules</h1>
  <form class="card" id="sf"><h2>Create schedule</h2><div class="fg">
   <label>Purok<select name="zone" required>${zones.map((z) => `<option value="${z.id}">${esc(z.zone_name)}</option>`).join("")}</select></label>
   <label>Type<select name="mode" id="mode"><option value="rec">Recurring (weekly)</option><option value="one">One-time</option></select></label>
   <label>Start date<input type="date" name="start" value="${today}" min="${today}" required></label>
   <label id="wkL">Number of weeks<input type="number" name="weeks" value="8" min="1" max="26"></label>
   <label>Time<input type="time" name="time" value="07:00" required></label>
   <label>Waste type<select name="waste"><option>General waste</option><option>Biodegradable</option><option>Recyclables</option><option>Hazardous</option></select></label>
   <label>Assigned collector<select name="collector"><option value="">None yet</option>${collectors.map((c) => `<option value="${c.id}">${esc(c.full_name)}</option>`).join("")}</select></label></div>
   <div id="wdBox"><b style="font-size:13px">Collection days</b><div class="wd">${days.map((d, i) => `<label><input type="checkbox" name="wd" value="${i}" ${[1, 4].includes(i) ? "checked" : ""}> ${d}</label>`).join("")}</div></div>
   <label class="check"><input type="checkbox" name="sms"> Send SMS to the purok's residents about the first collection date</label>
   <button class="btn">Create schedule</button></form>
  <div class="card"><div class="filters"><select id="sv">${[
    ["upcoming", "Upcoming"],
    ["past", "Past"],
    ["all", "All"],
  ]
    .map(
      ([v, l]) =>
        `<option value="${v}" ${schedView === v ? "selected" : ""}>${l}</option>`,
    )
    .join("")}</select></div>
  <div class="sc"><table><tr><th>Purok</th><th>Date</th><th>Time</th><th>Waste</th><th>Collector</th><th>Outcome</th><th></th></tr>
  ${
    list
      .map((s) => {
        const r = rec(s);
        return `<tr><td>${esc(s.collection_zones?.zone_name)}</td><td>${fmtDate(s.collection_date)}</td><td>${fmtTime(s.collection_time)}</td><td>${esc(s.waste_type)}</td>
   <td>${s.collection_assignments.map((a) => esc(a.profiles?.full_name)).join(", ") || '<span class="muted">none</span>'}</td>
   <td><span class="pill ${s.status}">${s.status.replace("_", " ")}</span>${s.started_at ? `<div class="muted">started ${fmtDateTime(s.started_at)}</div>` : ""}${r?.reason ? `<div class="muted">${esc(r.reason)}</div>` : ""}${r?.completed_at ? `<div class="muted">at ${fmtDateTime(r.completed_at)}</div>` : ""}</td>
   <td>${s.status === "scheduled" ? `<button class="btn s danger" data-c="${s.id}">Cancel</button>` : ""}</td></tr>`;
      })
      .join("") || '<tr><td colspan="7" class="muted">No schedules.</td></tr>'
  }</table></div></div>`;
  const sync = () => {
    const one = $("#mode").value === "one";
    $("#wkL").hidden = one;
    $("#wdBox").hidden = one;
  };
  $("#mode").onchange = sync;
  sync();
  $("#sv").onchange = (e) => {
    schedView = e.target.value;
    loadSchedules();
  };
  $("#sf").onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(e.target),
      one = f.get("mode") === "one";
    const wd = one
      ? [new Date(f.get("start") + "T00:00:00").getDay()]
      : f.getAll("wd").map(Number);
    if (!wd.length) return toast("Choose at least one collection day.", "err");
    const { data, error } = await sb.rpc("create_recurring_schedule", {
      p_zone: f.get("zone"),
      p_weekdays: wd,
      p_time: f.get("time"),
      p_waste: f.get("waste"),
      p_collector: f.get("collector") || null,
      p_start: f.get("start"),
      p_weeks: one ? 1 : +f.get("weeks"),
    });
    if (error) return toast(error.message, "err");
    toast(
      data.length
        ? `${data.length} schedule(s) created.`
        : "Nothing new was created (these schedules already exist).",
    );
    if (f.get("sms") && data.length)
      notify("new_schedule", { schedule_id: data[0] });
    loadSchedules();
  };
  $$("#view-schedules [data-c]").forEach(
    (b) =>
      (b.onclick = async () => {
        if (!confirm("Cancel this schedule?")) return;
        const { error } = await sb
          .from("collection_schedules")
          .update({ status: "cancelled" })
          .eq("id", b.dataset.c);
        if (error) return toast(error.message, "err");
        loadSchedules();
      }),
  );
}

// ================= ZONES =================
async function loadZones() {
  const [zones, residents] = await Promise.all([
    zonesList(),
    q(
      sb
        .from("profiles")
        .select("zone_id, phone_number")
        .eq("role", "resident")
        .eq("is_active", true),
    ),
  ]);

  const cov = (id) => {
    const r = residents.filter((x) => x.zone_id === id);

    return [
      r.length,
      r.filter((x) => /^09\d{9}$/.test(x.phone_number || "")).length,
    ];
  };

  $("#view-zones").innerHTML = `<h1>Collection puroks</h1>
  <form class="card" id="zf">
    <h2 id="zt">Add purok</h2>
    <input type="hidden" name="zid">

    <div class="fg">
      <label>Purok name<input name="zname" required maxlength="60"></label>
      <label>Description<input name="zdesc" maxlength="120"></label>
      <label>Center latitude<input name="zlat" inputmode="decimal"></label>
      <label>Center longitude<input name="zlng" inputmode="decimal"></label>
      <label>Radius on map (meters)<input type="number" name="zradius" value="300" min="50" max="5000"></label>
    </div>

    <div class="muted">Click the map to set the purok center.</div>
    <div id="zmap" class="map" style="height:280px"></div>

    <div class="actions" style="margin-top:10px">
      <button class="btn">Save purok</button>
      <button type="button" class="btn s" id="zreset" style="background:#6b7280">Clear form</button>
    </div>
  </form>

  <div class="card">
    <div class="sc">
      <table>
        <tr>
          <th>Purok</th>
          <th>Description</th>
          <th>Center</th>
          <th>Radius</th>
          <th>Residents</th>
          <th>Reachable by SMS</th>
          <th></th>
        </tr>

        ${zones
          .map(
            (z) => `<tr>
          <td>${esc(z.zone_name)}</td>
          <td>${esc(z.description || "")}</td>
          <td>${
            z.center_lat != null
              ? (+z.center_lat).toFixed(5) + ", " + (+z.center_lng).toFixed(5)
              : '<span class="muted">not set</span>'
          }</td>
          <td>${z.radius_m} m</td>

          ${(() => {
            const [n, ok] = cov(z.id);

            return `<td>${n}</td>
              <td>${ok}${
                n - ok
                  ? ` <span class="pill missed">${n - ok} no valid number</span>`
                  : ""
              }</td>`;
          })()}

          <td><button class="btn s" data-e="${z.id}">Edit</button></td>
        </tr>`,
          )
          .join("")}
      </table>
    </div>
  </div>`;

  const f = $("#zf");

  // Default map location: Barangay Baan, Butuan City
  const map = L.map("zmap").setView([8.949, 125.5786], 14);

  let pin = null;

  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: "&copy; OpenStreetMap contributors",
  }).addTo(map);

  const withC = zones.filter((z) => z.center_lat != null);

  withC.forEach((z) => {
    L.circle([+z.center_lat, +z.center_lng], {
      radius: z.radius_m,
      color: "#0f766e",
      weight: 1,
      fillOpacity: 0.1,
    })
      .addTo(map)
      .bindTooltip(z.zone_name);
  });

  // Automatically show saved purok centers when available.
  // Otherwise, the default remains Barangay Baan.
  if (withC.length) {
    map.fitBounds(
      withC.map((z) => [+z.center_lat, +z.center_lng]),
      {
        maxZoom: 16,
        padding: [20, 20],
      },
    );
  }

  const setPin = (la, ln) => {
    f.zlat.value = (+la).toFixed(6);
    f.zlng.value = (+ln).toFixed(6);

    if (pin) {
      pin.setLatLng([la, ln]);
    } else {
      pin = L.marker([la, ln]).addTo(map);
    }
  };

  map.on("click", (e) => {
    setPin(e.latlng.lat, e.latlng.lng);
  });

  setTimeout(() => map.invalidateSize(), 100);

  $$("#view-zones [data-e]").forEach((b) => {
    b.onclick = () => {
      const z = zones.find((x) => x.id === b.dataset.e);

      f.zid.value = z.id;
      f.zname.value = z.zone_name;
      f.zdesc.value = z.description || "";
      f.zradius.value = z.radius_m;

      $("#zt").textContent = "Edit purok";

      if (z.center_lat != null) {
        setPin(+z.center_lat, +z.center_lng);
        map.setView([+z.center_lat, +z.center_lng], 16);
      } else {
        f.zlat.value = "";
        f.zlng.value = "";
      }

      scrollTo({
        top: 0,
        behavior: "smooth",
      });
    };
  });

  $("#zreset").onclick = () => loadZones();

  f.onsubmit = async (e) => {
    e.preventDefault();

    const row = {
      zone_name: f.zname.value.trim(),
      description: f.zdesc.value.trim() || null,
      center_lat: f.zlat.value === "" ? null : +f.zlat.value,
      center_lng: f.zlng.value === "" ? null : +f.zlng.value,
      radius_m: +f.zradius.value,
    };

    if ((row.center_lat == null) !== (row.center_lng == null)) {
      return toast(
        "Set both latitude and longitude, or leave both empty.",
        "err",
      );
    }

    const { error } = f.zid.value
      ? await sb.from("collection_zones").update(row).eq("id", f.zid.value)
      : await sb.from("collection_zones").insert(row);

    if (error) return toast(error.message, "err");

    toast("Purok saved.");
    loadZones();
  };
}

// ================= USERS =================
async function loadUsers() {
  const users = await q(
    sb
      .from("profiles")
      .select("*, collection_zones(zone_name)")
      .order("created_at", { ascending: false }),
  );
  $("#view-users").innerHTML =
    `<h1>Accounts</h1><div class="note">New residents register themselves. To create a collector or official, have them register, then change their role here. Officials need a phone number to receive overdue-report SMS alerts.</div>
  <div class="card"><div class="sc"><table><tr><th>Name</th><th>Phone</th><th>Purok</th><th>Role</th><th>Active</th></tr>
  ${users
    .map(
      (
        u,
      ) => `<tr><td>${esc(u.full_name)}</td><td>${u.phone_number ? esc(u.phone_number) : '<span class="pill missed">no phone</span>'} <button class="btn s" data-p="${u.id}">Edit</button></td><td>${esc(u.collection_zones?.zone_name || "—")}</td>
   <td><select data-role="${u.id}" ${u.id === user.id ? "disabled" : ""}>${["resident", "collector", "official"].map((r) => `<option ${u.role === r ? "selected" : ""}>${r}</option>`).join("")}</select></td>
   <td><input type="checkbox" data-act="${u.id}" ${u.is_active ? "checked" : ""} ${u.id === user.id ? "disabled" : ""}></td></tr>`,
    )
    .join("")}</table></div></div>`;
  $$("#view-users [data-role]").forEach(
    (s) =>
      (s.onchange = async () => {
        const { error } = await sb
          .from("profiles")
          .update({ role: s.value })
          .eq("id", s.dataset.role);
        toast(error ? error.message : "Role updated.", error ? "err" : "ok");
      }),
  );
  $$("#view-users [data-act]").forEach(
    (c) =>
      (c.onchange = async () => {
        const { error } = await sb
          .from("profiles")
          .update({ is_active: c.checked })
          .eq("id", c.dataset.act);
        toast(
          error
            ? error.message
            : c.checked
              ? "Account activated."
              : "Account deactivated.",
          error ? "err" : "ok",
        );
      }),
  );
  $$("#view-users [data-p]").forEach(
    (b) =>
      (b.onclick = async () => {
        const v = prompt("Mobile number (09xxxxxxxxx):");
        if (v == null) return;
        const d = v.replace(/\D/g, ""),
          p =
            d.length === 12 && d.startsWith("63")
              ? "0" + d.slice(2)
              : d.length === 10 && d[0] === "9"
                ? "0" + d
                : d;
        if (!/^09\d{9}$/.test(p)) return toast("Invalid mobile number.", "err");
        const { error } = await sb
          .from("profiles")
          .update({ phone_number: p })
          .eq("id", b.dataset.p);
        toast(error ? error.message : "Phone saved.", error ? "err" : "ok");
        loadUsers();
      }),
  );
}

// ================= SMS & SETTINGS =================
async function loadSms() {
  const [settings, log, app] = await Promise.all([
    q(sb.from("notification_settings").select("*").order("event_type")),
    q(
      sb
        .from("sms_notifications")
        .select("*, profiles(full_name)")
        .order("created_at", { ascending: false })
        .limit(200),
    ),
    appSettings(),
  ]);
  $("#view-sms").innerHTML =
    `<h1>SMS notifications &amp; settings</h1><div class="g2">
  <div class="card"><h2>Notification types</h2>${settings.map((s) => `<label class="check"><input type="checkbox" data-ev="${s.event_type}" ${s.enabled ? "checked" : ""}> ${esc(s.label)}</label>`).join("")}</div>
  <form class="card stack" id="ap"><h2>Targets</h2>
   <label>Escalate verified reports unresolved after (hours)<input type="number" name="esc" min="1" max="720" value="${esc(app.escalation_hours || 24)}"></label>
   <label>Flag a purok after this many missed/delayed collections in 30 days<input type="number" name="thr" min="1" max="30" value="${esc(app.recurring_threshold || 3)}"></label>
   <button class="btn">Save targets</button><button type="button" class="btn" id="runEsc" style="background:#b45309">Run overdue check now</button>
   <span class="muted">Alerts go to every active official who has a phone number. Each report alerts once. Schedule it hourly with supabase/cron.sql.</span></form></div>
  <div class="card"><div class="filters"><h2 style="margin:0">History</h2><button class="btn s" id="refSt">Refresh delivery status</button></div><div class="sc"><table><tr><th>Time</th><th>Recipient</th><th>Event</th><th>Status</th><th>Delivery (UniSMS)</th><th>Message</th></tr>
  ${
    log
      .map(
        (
          l,
        ) => `<tr><td>${fmtDateTime(l.created_at)}</td><td>${esc(l.profiles?.full_name)}<div class="muted">${esc(l.phone_number)}</div></td><td>${esc(l.event_type)}</td>
   <td><span class="pill sms-${l.status}" title="${esc(l.error_message || "")}">${l.status}</span>${l.error_message ? `<div class="muted">${esc(l.error_message)}</div>` : ""}</td>
   <td>${l.delivery_status ? esc(l.delivery_status) : "—"}${l.delivery_checked_at ? `<div class="muted">checked ${fmtDateTime(l.delivery_checked_at)}</div>` : ""}</td><td>${esc(l.message)}</td></tr>`,
      )
      .join("") ||
    '<tr><td colspan="6" class="muted">No SMS recorded yet.</td></tr>'
  }</table></div></div>`;
  $$("#view-sms [data-ev]").forEach(
    (c) =>
      (c.onchange = async () => {
        const { error } = await sb
          .from("notification_settings")
          .update({ enabled: c.checked })
          .eq("event_type", c.dataset.ev);
        toast(error ? error.message : "Setting saved.", error ? "err" : "ok");
      }),
  );
  $("#ap").onsubmit = async (e) => {
    e.preventDefault();
    const f = e.target;
    const { error } = await sb.from("app_settings").upsert([
      { key: "escalation_hours", value: String(Math.max(1, +f.esc.value)) },
      { key: "recurring_threshold", value: String(Math.max(1, +f.thr.value)) },
    ]);
    toast(error ? error.message : "Targets saved.", error ? "err" : "ok");
  };
  $("#refSt").onclick = async () => {
    const { data, error } = await sb.functions.invoke("sms-status", {
      body: {},
    });
    if (error) return toast("Status check failed: " + error.message, "err");
    toast(
      data?.skipped
        ? "Skipped: " + data.skipped
        : `Checked ${data.checked}: ${data.delivered} delivered, ${data.failed} failed, ${data.pending} still pending.`,
    );
    loadSms();
  };
  $("#runEsc").onclick = async () => {
    const { data, error } = await sb.functions.invoke("escalate-overdue", {
      body: {},
    });
    if (error) return toast("Escalation check failed: " + error.message, "err");
    toast(
      data?.skipped
        ? "Skipped: " + data.skipped
        : `Checked: ${data.reports} overdue report(s), ${data.sent + data.queued} SMS handled.`,
    );
    loadSms();
  };
}

// ================= LIVE COLLECTOR TRACKING (officials only) =================
let live = null;
function stopLive() {
  if (!live) return;
  clearInterval(live.tick);
  clearInterval(live.poll);
  clearInterval(live.sync);
  live.routes.forEach((r) => cancelAnimationFrame(r.raf));
  sb.removeChannel(live.ch);
  live.map.remove();
  live = null;
}
const ago = (t) => {
  const x = Math.max(0, Math.round((Date.now() - t) / 1000));
  return x < 60
    ? x + " s ago"
    : x < 3600
      ? Math.floor(x / 60) + " min ago"
      : Math.floor(x / 3600) + " h ago";
};
const sig = (t) => {
  const x = (Date.now() - t) / 1000;
  return x < 45
    ? ["live", "Live"]
    : x < 120
      ? ["weak", "Weak signal"]
      : ["lost", "Signal lost"];
};
const ROUTE_COLORS = ["#0f766e", "#7c3aed", "#ea580c", "#2563eb", "#db2777"];

async function loadLive() {
  stopLive();

  const zones = await zonesList();

  $("#view-live").innerHTML = `<h1>Live collector tracking</h1>
   <div class="filters">
     <span id="conn" class="pill sig-weak">Connecting…</span>
     <button class="btn s" id="fitAll">Show all</button>
     <button class="btn s" id="purge" style="background:#6b7280">Delete history older than 7 days</button>
     <span class="muted">Collectors appear while a route is in progress and they share their location. Only officials can see this.</span>
   </div>
   <div class="live">
     <div id="livemap" class="map"></div>
     <div id="livelist"></div>
   </div>`;

  // Default map location: Barangay Baan, Butuan City
  const map = L.map("livemap").setView([8.949, 125.5786], 15);

  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: "&copy; OpenStreetMap contributors",
  }).addTo(map);

  const zc = zones.filter((z) => z.center_lat != null);

  zc.forEach((z) => {
    L.circle([+z.center_lat, +z.center_lng], {
      radius: z.radius_m,
      color: "#6b7280",
      weight: 1,
      dashArray: "5 5",
      fillOpacity: 0.05,
    })
      .addTo(map)
      .bindTooltip(z.zone_name);
  });

  if (zc.length) {
    map.fitBounds(
      zc.map((z) => [+z.center_lat, +z.center_lng]),
      {
        maxZoom: 16,
        padding: [30, 30],
      },
    );
  }

  setTimeout(() => map.invalidateSize(), 100);

  const st = {
    map,
    routes: new Map(),
    follow: null,
    zc,
  };

  live = st;

  const icon = (r) =>
    L.divIcon({
      className: "trk",
      iconSize: [44, 44],
      iconAnchor: [22, 22],
      html: `<div class="truck" style="background:${r.color}">🚛</div><div class="tl">${esc(r.name)}</div>`,
    });

  function animateTo(r, to) {
    const from = r.cur || to;

    r.cur = to;
    cancelAnimationFrame(r.raf);

    const t0 = performance.now();
    const D = 1500;

    const f = (now) => {
      const k = Math.min(1, (now - t0) / D);
      const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;

      r.marker.setLatLng([
        from[0] + (to[0] - from[0]) * e,
        from[1] + (to[1] - from[1]) * e,
      ]);

      if (k < 1) {
        r.raf = requestAnimationFrame(f);
      }
    };

    r.raf = requestAnimationFrame(f);
  }

  function addPoint(r, row, animate) {
    const t = new Date(row.recorded_at).getTime();

    if (r.lastT && t <= r.lastT) return;

    r.lastT = t;

    const ll = [row.latitude, row.longitude];

    r.points.push(ll);

    if (r.points.length > 400) {
      r.points.shift();
    }

    r.trail.setLatLngs(r.points);

    r.last = {
      t,
      speed: row.speed_mps,
      acc: row.accuracy_m,
    };

    if (!r.marker) {
      r.marker = L.marker(ll, {
        icon: icon(r),
      }).addTo(st.map);

      r.cur = ll;
    } else if (animate) {
      animateTo(r, ll);
    } else {
      r.marker.setLatLng(ll);
      r.cur = ll;
    }

    if (st.follow === r.id) {
      st.map.panTo(ll, {
        animate: true,
        duration: 1,
      });
    }
  }

  async function syncRoutes(first) {
    const sch = await q(
      sb
        .from("collection_schedules")
        .select(
          "id, started_at, collection_zones(zone_name), profiles:started_by(full_name)",
        )
        .eq("status", "in_progress")
        .order("started_at"),
    );

    if (live !== st) return;

    const ids = new Set(sch.map((x) => x.id));

    st.routes.forEach((r, id) => {
      if (!ids.has(id)) {
        r.marker && st.map.removeLayer(r.marker);
        st.map.removeLayer(r.trail);
        cancelAnimationFrame(r.raf);
        st.routes.delete(id);

        if (st.follow === id) {
          st.follow = null;
        }
      }
    });

    for (const x of sch) {
      if (st.routes.has(x.id)) continue;

      const r = {
        id: x.id,
        name: x.profiles?.full_name ?? "Collector",
        zone: x.collection_zones?.zone_name ?? "",
        started: x.started_at,
        color: ROUTE_COLORS[st.routes.size % ROUTE_COLORS.length],
        points: [],
        cur: null,
        last: null,
        lastT: 0,
        raf: 0,
        marker: null,
      };

      r.trail = L.polyline([], {
        color: r.color,
        weight: 4,
        opacity: 0.7,
      }).addTo(st.map);

      st.routes.set(x.id, r);

      const pts = await q(
        sb
          .from("collector_locations")
          .select("latitude, longitude, speed_mps, accuracy_m, recorded_at")
          .eq("schedule_id", x.id)
          .order("recorded_at", { ascending: false })
          .limit(300),
      );

      pts.reverse().forEach((p) => addPoint(r, p, false));
    }

    renderList();

    if (first) fitAll();
  }

  function fitAll() {
    const pts = [...st.routes.values()].filter((r) => r.cur).map((r) => r.cur);

    if (pts.length) {
      st.map.fitBounds(pts, {
        padding: [60, 60],
        maxZoom: 17,
      });
    } else if (st.zc.length) {
      st.map.fitBounds(
        st.zc.map((z) => [+z.center_lat, +z.center_lng]),
        {
          maxZoom: 16,
          padding: [30, 30],
        },
      );
    }
  }

  function renderList() {
    const rs = [...st.routes.values()];
    const el = $("#livelist");

    if (!el) return;

    el.innerHTML = rs.length
      ? rs
          .map(
            (
              r,
            ) => `<div class="card lr" style="border-left:5px solid ${r.color}">
          <b>${esc(r.name)}</b>
          <span class="pill" id="sg-${r.id}"></span>
          <div class="muted">${esc(r.zone)} · started ${fmtDateTime(r.started)}</div>
          <div class="muted" id="ln-${r.id}"></div>
          <div class="actions" style="margin-top:6px">
            <button class="btn s" data-zoom="${r.id}">Zoom</button>
            <button class="btn s" data-follow="${r.id}">${st.follow === r.id ? "Following ✓" : "Follow"}</button>
          </div>
        </div>`,
          )
          .join("")
      : '<div class="card muted">No collection route is in progress right now. Routes appear here when a collector presses Start collection and shares their location.</div>';

    $$("#livelist [data-zoom]").forEach((b) => {
      b.onclick = () => {
        const r = st.routes.get(b.dataset.zoom);

        if (r?.cur) {
          st.map.flyTo(r.cur, 17);
        }
      };
    });

    $$("#livelist [data-follow]").forEach((b) => {
      b.onclick = () => {
        const id = b.dataset.follow;

        st.follow = st.follow === id ? null : id;

        const r = st.routes.get(id);

        if (st.follow && r?.cur) {
          st.map.flyTo(r.cur, 17);
        }

        renderList();
      };
    });

    tickList();
  }

  function tickList() {
    st.routes.forEach((r) => {
      const sg = $("#sg-" + r.id);
      const ln = $("#ln-" + r.id);

      if (!sg) return;

      if (!r.last) {
        sg.className = "pill sig-weak";
        sg.textContent = "Waiting for GPS";
        ln.textContent = "No position received yet.";
        return;
      }

      const [c, l] = sig(r.last.t);

      sg.className = "pill sig-" + c;
      sg.textContent = l;

      ln.textContent =
        `Updated ${ago(r.last.t)}` +
        (r.last.speed != null
          ? ` · ${Math.round(r.last.speed * 3.6)} km/h`
          : "") +
        (r.last.acc ? ` · ±${Math.round(r.last.acc)} m` : "");

      r.marker?.getElement()?.classList.toggle("stale", c === "lost");
    });
  }

  async function pollNew() {
    for (const r of st.routes.values()) {
      const q2 = sb
        .from("collector_locations")
        .select("latitude, longitude, speed_mps, accuracy_m, recorded_at")
        .eq("schedule_id", r.id)
        .order("recorded_at");

      const rows = await q(
        r.lastT
          ? q2.gt("recorded_at", new Date(r.lastT).toISOString()).limit(100)
          : q2.limit(100),
      );

      rows.forEach((p) => addPoint(r, p, true));
    }

    tickList();
  }

  st.ch = sb
    .channel("live-tracking")
    .on(
      "postgres_changes",
      {
        event: "INSERT",
        schema: "public",
        table: "collector_locations",
      },
      (p) => {
        const r = st.routes.get(p.new.schedule_id);

        if (r) {
          addPoint(r, p.new, true);
          tickList();
        } else {
          syncRoutes();
        }
      },
    )
    .on(
      "postgres_changes",
      {
        event: "UPDATE",
        schema: "public",
        table: "collection_schedules",
      },
      () => syncRoutes(),
    )
    .subscribe((status) => {
      const c = $("#conn");

      if (!c) return;

      const ok = status === "SUBSCRIBED";

      c.className = "pill " + (ok ? "sig-live" : "sig-weak");
      c.textContent = ok ? "● Live" : "○ Reconnecting…";
    });

  st.tick = setInterval(tickList, 1000);
  st.poll = setInterval(() => pollNew().catch(() => {}), 20000);
  st.sync = setInterval(() => syncRoutes().catch(() => {}), 60000);

  $("#fitAll").onclick = fitAll;

  $("#purge").onclick = async () => {
    if (!confirm("Delete all saved collector locations older than 7 days?"))
      return;

    const { data, error } = await sb.rpc("purge_old_locations", {
      p_days: 7,
    });

    toast(
      error ? error.message : `${data} old location point(s) deleted.`,
      error ? "err" : "ok",
    );
  };

  await syncRoutes(true);
}

const loaders = {
  dashboard: loadDashboard,
  reports: loadReports,
  compliance: loadCompliance,
  map: loadMap,
  live: loadLive,
  schedules: loadSchedules,
  zones: loadZones,
  users: loadUsers,
  sms: loadSms,
};
const go = router(
  Object.fromEntries(
    Object.entries(loaders).map(([k, f]) => [
      k,
      () => {
        if (k !== "live") stopLive();
        return f();
      },
    ]),
  ),
  "dashboard",
);
sb.channel("official-live")
  .on(
    "postgres_changes",
    { event: "*", schema: "public", table: "missed_pickup_reports" },
    (p) => {
      if (p.eventType === "INSERT")
        toast(`New report ${p.new.report_no} received.`);
      if (["#dashboard", "#reports", "#map", ""].includes(location.hash)) go();
    },
  )
  .on(
    "postgres_changes",
    { event: "UPDATE", schema: "public", table: "collection_schedules" },
    () => {
      if (["#dashboard", "#schedules", ""].includes(location.hash)) go();
    },
  )
  .subscribe();
