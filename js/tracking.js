// Live location sharing for the COLLECTOR's phone. Only runs while a route is in progress.
// Sends the position to the database function report_location() about every 8 seconds; only officials can read it.
import { sb, toast } from "./common.js";

const KEY = "ecotrack_tracking";
let watchId = null,
  wake = null,
  sid = null,
  lastSent = 0,
  lastPos = null,
  beat = null,
  sim = null,
  listener = () => {};
let state = { on: false, last: null, accuracy: null, error: null, demo: false };

export const onTrackingChange = (cb) => {
  listener = cb;
};
export const trackingState = () => ({ ...state });
export const trackingScheduleId = () => (state.on ? sid : null);
export const savedTrackingId = () => localStorage.getItem(KEY);
const emit = (patch) => {
  state = { ...state, ...patch };
  listener(state);
};

async function send(lat, lng, c = {}) {
  lastSent = Date.now();
  const { error } = await sb.rpc("report_location", {
    p_schedule: sid,
    p_lat: lat,
    p_lng: lng,
    p_accuracy: c.accuracy ?? null,
    p_heading: Number.isFinite(c.heading) ? c.heading : null,
    p_speed: Number.isFinite(c.speed) ? c.speed : null,
  });
  if (error) {
    if (/not in progress|Only the person/.test(error.message)) {
      stopTracking();
      toast("Location sharing stopped: this route is no longer active.");
    } else emit({ error: error.message });
    return;
  }
  emit({ last: new Date(), accuracy: c.accuracy ?? null, error: null });
}

function onPos(p) {
  lastPos = p;
  if (Date.now() - lastSent >= 8000)
    send(p.coords.latitude, p.coords.longitude, p.coords);
}
function onErr(e) {
  const msg =
    e.code === 1
      ? "Location permission was denied. Allow location for this site in your browser settings."
      : e.code === 2
        ? "Your position is unavailable (check that GPS is on)."
        : "Getting your position timed out.";
  emit({ error: msg });
  if (e.code === 1) stopTracking();
}

async function keepAwake() {
  try {
    if ("wakeLock" in navigator && !wake) {
      wake = await navigator.wakeLock.request("screen");
      wake.addEventListener("release", () => {
        wake = null;
      });
    }
  } catch {
    /* not supported */
  }
}
const onVisible = () => {
  if (document.visibilityState === "visible" && state.on) keepAwake();
};

export function startTracking(scheduleId) {
  if (!("geolocation" in navigator)) {
    toast("This browser cannot share location.", "err");
    return false;
  }
  stopTracking(true);
  sid = scheduleId;
  localStorage.setItem(KEY, scheduleId);
  watchId = navigator.geolocation.watchPosition(onPos, onErr, {
    enableHighAccuracy: true,
    maximumAge: 5000,
    timeout: 20000,
  });
  // heartbeat: if you are standing still the GPS may stay quiet, so officials would see "signal lost"
  beat = setInterval(() => {
    if (lastPos && Date.now() - lastSent > 14000)
      send(lastPos.coords.latitude, lastPos.coords.longitude, lastPos.coords);
  }, 5000);
  keepAwake();
  document.addEventListener("visibilitychange", onVisible);
  emit({ on: true, error: null, demo: false });
  return true;
}

/** DEMO ONLY (open collector.html?demo=1): walks a fake route around a point so officials can watch it move. */
export function startSimulation(scheduleId, lat, lng) {
  stopTracking(true);
  sid = scheduleId;
  localStorage.setItem(KEY, scheduleId);
  let a = 0,
    la = lat,
    ln = lng;
  const R = 0.0016; // about 180 m
  emit({ on: true, error: null, demo: true });
  const step = () => {
    const nla = lat + R * Math.sin(a),
      nln = lng + R * Math.cos(a * 1.3);
    const dx = (nln - ln) * 111320 * Math.cos((lat * Math.PI) / 180),
      dy = (nla - la) * 110540;
    const heading = ((Math.atan2(dx, dy) * 180) / Math.PI + 360) % 360;
    la = nla;
    ln = nln;
    a += 0.12;
    send(la, ln, { accuracy: 8, heading, speed: Math.hypot(dx, dy) / 3.2 });
  };
  step();
  sim = setInterval(step, 3200);
  return true;
}

export function stopTracking(quiet = false) {
  if (watchId !== null) navigator.geolocation.clearWatch(watchId);
  watchId = null;
  clearInterval(beat);
  clearInterval(sim);
  beat = sim = null;
  lastPos = null;
  try {
    wake?.release();
  } catch {
    /* ignore */
  }
  wake = null;
  document.removeEventListener("visibilitychange", onVisible);
  localStorage.removeItem(KEY);
  if (!quiet) emit({ on: false, demo: false });
  else state = { ...state, on: false };
}
