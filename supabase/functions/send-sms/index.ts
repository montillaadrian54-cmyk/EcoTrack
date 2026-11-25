// Supabase Edge Function: send-sms
// Deploy: supabase functions deploy send-sms
// Secrets: UNISMS_API_KEY, SMS_ENABLED
// Optional: UNISMS_SENDERNAME
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { cors, json, normalizePhone, sendSms } from "../_shared/sms.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const authHeader = req.headers.get("Authorization") ?? "";
    // 1. Who is calling?
    const userClient = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const {
      data: { user },
    } = await userClient.auth.getUser();
    if (!user) return json({ error: "Not authenticated" }, 401);

    const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: caller } = await admin
      .from("profiles")
      .select("id, role, is_active")
      .eq("id", user.id)
      .single();
    if (!caller?.is_active) return json({ error: "Account inactive" }, 403);

    const { event_type, report_id, schedule_id } = await req.json();

    // 2. Is this event type switched on by the officials?
    const { data: setting } = await admin
      .from("notification_settings")
      .select("enabled")
      .eq("event_type", event_type)
      .maybeSingle();
    if (!setting) return json({ error: "Unknown event type" }, 400);
    if (!setting.enabled)
      return json({ skipped: "notification type disabled" });

    // 3. Work out recipients + message, and check the caller is allowed to trigger this event
    let refId = "";
    let recipients: { id: string; phone_number: string | null }[] = [];
    let message = "";

    if (event_type === "new_schedule") {
      if (caller.role !== "official") return json({ error: "Forbidden" }, 403);
      const { data: s } = await admin
        .from("collection_schedules")
        .select("*, collection_zones(zone_name)")
        .eq("id", schedule_id)
        .single();
      if (!s) return json({ error: "Schedule not found" }, 404);
      refId = s.id;
      const { data: res } = await admin
        .from("profiles")
        .select("id, phone_number")
        .eq("zone_id", s.zone_id)
        .eq("role", "resident")
        .eq("is_active", true);
      recipients = res ?? [];
      const date = new Date(s.collection_date + "T00:00:00").toLocaleDateString(
        "en-PH",
        { month: "long", day: "numeric" },
      );
      const [hh, mm] = String(s.collection_time).split(":");
      const h = Number(hh),
        time = `${h % 12 || 12}:${mm} ${h >= 12 ? "PM" : "AM"}`;
      message = `EcoTrack: Your garbage collection for ${s.collection_zones.zone_name} is scheduled on ${date} at ${time}.`;
    } else if (event_type === "collection_started") {
      // The collector pressed "Start collection": text every active resident of that purok/zone.
      const { data: s } = await admin
        .from("collection_schedules")
        .select("*, collection_zones(zone_name)")
        .eq("id", schedule_id)
        .single();
      if (!s) return json({ error: "Schedule not found" }, 404);
      if (s.status !== "in_progress")
        return json({ error: "This collection has not been started" }, 409);
      if (
        caller.role !== "official" &&
        !(caller.role === "collector" && s.started_by === caller.id)
      )
        return json({ error: "Forbidden" }, 403);
      refId = s.id;
      const { data: res } = await admin
        .from("profiles")
        .select("id, phone_number")
        .eq("zone_id", s.zone_id)
        .eq("role", "resident")
        .eq("is_active", true);
      recipients = res ?? [];
      message = `EcoTrack: Garbage collection in ${s.collection_zones.zone_name} has started. Please bring your garbage out for pickup.`;
    } else {
      const { data: r } = await admin
        .from("missed_pickup_reports")
        .select(
          "id, report_no, zone_id, resident_id, collection_zones(zone_name)",
        )
        .eq("id", report_id)
        .single();
      if (!r) return json({ error: "Report not found" }, 404);
      refId = r.id;
      const isOwner = r.resident_id === caller.id;
      let isAssignedCollector = false;
      if (caller.role === "collector") {
        const { data: a } = await admin
          .from("collection_assignments")
          .select("id")
          .eq("report_id", r.id)
          .eq("collector_id", caller.id)
          .maybeSingle();
        isAssignedCollector = !!a;
      }
      const residentRecipient = async () => {
        const { data } = await admin
          .from("profiles")
          .select("id, phone_number")
          .eq("id", r.resident_id)
          .single();
        return data ? [data] : [];
      };
      if (event_type === "report_submitted") {
        if (!isOwner) return json({ error: "Forbidden" }, 403);
        recipients = await residentRecipient();
        message = `EcoTrack: Your missed pickup report ${r.report_no} has been received and is pending verification.`;
      } else if (event_type === "report_verified") {
        if (caller.role !== "official")
          return json({ error: "Forbidden" }, 403);
        recipients = await residentRecipient();
        message = `EcoTrack: Your report ${r.report_no} has been verified and assigned for action.`;
      } else if (event_type === "report_resolved") {
        if (caller.role !== "official" && !isAssignedCollector)
          return json({ error: "Forbidden" }, 403);
        recipients = await residentRecipient();
        message = `EcoTrack: Your report ${r.report_no} has been marked resolved. Thank you for reporting.`;
      } else if (event_type === "collector_assigned") {
        if (caller.role !== "official")
          return json({ error: "Forbidden" }, 403);
        const { data: a } = await admin
          .from("collection_assignments")
          .select("collector_id")
          .eq("report_id", r.id)
          .neq("status", "completed")
          .maybeSingle();
        if (a) {
          const { data: c } = await admin
            .from("profiles")
            .select("id, phone_number")
            .eq("id", a.collector_id)
            .single();
          if (c) recipients = [c];
        }
        message = `EcoTrack: You have been assigned to address missed pickup report ${r.report_no} in ${r.collection_zones.zone_name}.`;
      } else {
        return json({ error: "Unknown event type" }, 400);
      }
    }

    // 4. Send once per (event, reference, recipient), 10 at a time. Failures are logged and never break the app.
    const results: Record<string, number> = {
      sent: 0,
      queued: 0,
      failed: 0,
      duplicate: 0,
      no_phone: 0,
    };
    const sendOne = async (rcpt: {
      id: string;
      phone_number: string | null;
    }) => {
      const phone = normalizePhone(rcpt.phone_number);
      if (!phone) {
        results.no_phone++;
        return;
      }
      const { data: row, error } = await admin
        .from("sms_notifications")
        .insert({
          recipient_id: rcpt.id,
          phone_number: phone,
          event_type,
          ref_id: refId,
          message,
          status: "queued",
          provider: "unisms",
        })
        .select("id")
        .single();
      if (error) {
        results.duplicate++;
        return;
      } // unique violation = this resident already got this message
      const out = await sendSms(phone, message);
      await admin
        .from("sms_notifications")
        .update({
          status: out.status,
          provider_message_id: out.providerId ?? null,
          error_message: out.error ?? null,
          provider_response: out.raw ?? null,
        })
        .eq("id", row.id);
      results[out.status]++;
    };
    for (let i = 0; i < recipients.length; i += 10)
      await Promise.all(recipients.slice(i, i + 10).map(sendOne));
    return json({ ok: true, recipients: recipients.length, results });
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
