import { sb, $, $$, esc } from "./common.js";

const msg = (t, type = "err") => {
  $("#msg").innerHTML = t ? `<div class="flash ${type}">${esc(t)}</div>` : "";
};
const ROUTE = {
  resident: "resident.html",
  collector: "collector.html",
  official: "official.html",
};

if (new URLSearchParams(location.search).has("denied"))
  msg("Access denied for this account or role.");

$$(".tab").forEach(
  (b) =>
    (b.onclick = () => {
      $$(".tab").forEach((x) => x.classList.toggle("on", x === b));
      $("#login").hidden = b.dataset.t !== "login";
      $("#register").hidden = b.dataset.t !== "register";
      msg("");
    }),
);

// Already signed in? go straight to the right dashboard.
(async () => {
  const params = new URLSearchParams(location.search);

  // Do not automatically redirect after logout
  if (params.has("logout")) {
    history.replaceState(null, "", location.pathname);
    return;
  }

  const {
    data: { session },
  } = await sb.auth.getSession();

  if (session) {
    await goDashboard(session.user.id, true);
  }
})();

async function goDashboard(uid, silent = false) {
  const { data: p } = await sb
    .from("profiles")
    .select("role,is_active")
    .eq("id", uid)
    .single();
  if (!p) {
    if (!silent) msg("Profile not found. Contact the administrator.");
    return;
  }
  if (!p.is_active) {
    await sb.auth.signOut();
    if (!silent) msg("This account has been deactivated.");
    return;
  }
  location.href = ROUTE[p.role];
}

// zones for registration (readable without login)
// zones for registration

// Puroks for registration
async function loadZones() {
  const select = $("#zones");

  select.innerHTML = '<option value="">Loading puroks...</option>';

  const { data, error } = await sb
    .from("collection_zones")
    .select("id, zone_name")
    .order("zone_name");

  if (error) {
    console.error("Failed to load collection zones:", error);
    select.innerHTML = '<option value="">Error loading puroks</option>';
    msg("Could not load puroks: " + error.message);
    return;
  }

  console.log("Loaded puroks:", data);

  if (!data || data.length === 0) {
    select.innerHTML = '<option value="">No puroks available</option>';
    return;
  }

  select.innerHTML =
    '<option value="">Select your purok...</option>' +
    data
      .map((z) => `<option value="${z.id}">${esc(z.zone_name)}</option>`)
      .join("");
}

loadZones();

$("#login").onsubmit = async (e) => {
  e.preventDefault();
  const f = new FormData(e.target);
  const { data, error } = await sb.auth.signInWithPassword({
    email: f.get("email").trim(),
    password: f.get("password"),
  });
  if (error) return msg(error.message);
  await goDashboard(data.user.id);
};

$("#register").onsubmit = async (e) => {
  e.preventDefault();
  const f = new FormData(e.target);
  const digits = String(f.get("phone")).replace(/\D/g, "");
  let phone = digits;
  if (digits.length === 12 && digits.startsWith("63"))
    phone = "0" + digits.slice(2);
  else if (digits.length === 10 && digits[0] === "9") phone = "0" + digits;
  if (!/^09\d{9}$/.test(phone))
    return msg("Enter a valid Philippine mobile number, e.g. 09171234567.");
  if (!f.get("zone")) return msg("Please choose your purok.");
  const { data, error } = await sb.auth.signUp({
    email: f.get("email").trim(),
    password: f.get("password"),
    options: {
      data: {
        full_name: f.get("full_name").trim(),
        phone_number: phone,
        zone_id: f.get("zone"),
      },
    },
  });
  if (error) return msg(error.message);
  if (data.session) return goDashboard(data.user.id);
  msg("Account created. Check your email to confirm it, then log in.", "ok");
};

$("#forgot").onclick = async (e) => {
  e.preventDefault();
  const email = $("#login [name=email]").value.trim();
  if (!email)
    return msg("Type your email above first, then click “Forgot password?”.");
  const { error } = await sb.auth.resetPasswordForEmail(email, {
    redirectTo: location.origin + location.pathname,
  });
  msg(
    error
      ? error.message
      : "Password reset email sent (if the account exists).",
    error ? "err" : "ok",
  );
};
