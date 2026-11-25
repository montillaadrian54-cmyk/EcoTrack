// Supabase Edge Function: escalate-overdue
// Finds VERIFIED reports that are still unresolved after the target time (Settings > escalation_hours)
// and sends ONE SMS per official per report. Run it hourly (see supabase/cron.sql) or from Official > SMS > "Run check now".
// Deploy:  supabase functions deploy escalate-overdue      Secrets: CRON_SECRET (for the scheduler)
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { cors, json, normalizePhone, sendSms } from "../_shared/sms.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    // Who is calling? Either the scheduler (secret header) or a signed-in, active official.
    const secret = Deno.env.get("CRON_SECRET");
    const isCron = !!secret && req.headers.get("x-cron-secret") === secret;
    if (!isCron) {
      const userClient = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, {
        global: {
          headers: { Authorization: req.headers.get("Authorization") ?? "" },
        },
      });
      const {
        data: { user },
      } = await userClient.auth.getUser();
      if (!user) return json({ error: "Not authenticated" }, 401);
      const { data: p } = await admin
        .from("profiles")
        .select("role, is_active")
        .eq("id", user.id)
        .single();
      if (!p?.is_active || p.role !== "official")
        return json({ error: "Forbidden" }, 403);
    }

    const { data: setting } = await admin
      .from("notification_settings")
      .select("enabled")
      .eq("event_type", "escalation_overdue")
      .single();
    if (!setting?.enabled)
      return json({ skipped: "escalation alerts are switched off" });

    const { data: hrs } = await admin
      .from("app_settings")
      .select("value")
      .eq("key", "escalation_hours")
      .maybeSingle();
    const hours = Math.max(1, Number(hrs?.value ?? 24));
    const cutoff = new Date(Date.now() - hours * 3600_000).toISOString();

    const { data: overdue } = await admin
      .from("missed_pickup_reports")
      .select("id, report_no, verified_at, collection_zones(zone_name)")
      .in("status", ["verified", "assigned", "in_progress"])
      .is("escalated_at", null)
      .lt("verified_at", cutoff);
    const { data: officials } = await admin
      .from("profiles")
      .select("id, phone_number")
      .eq("role", "official")
      .eq("is_active", true);

    const totals = {
      reports: overdue?.length ?? 0,
      sent: 0,
      queued: 0,
      failed: 0,
      duplicate: 0,
      no_phone: 0,
    };
    for (const r of overdue ?? []) {
      const waited = Math.round(
        (Date.now() - new Date(r.verified_at).getTime()) / 3600_000,
      );
      const message = `EcoTrack ALERT: Report ${r.report_no} (${(r as any).collection_zones?.zone_name}) is still unresolved ${waited} hours after verification (target: ${hours} h). Please follow up.`;
      for (const o of officials ?? []) {
        const phone = normalizePhone(o.phone_number);
        if (!phone) {
          totals.no_phone++;
          continue;
        }
        const { data: row, error } = await admin
          .from("sms_notifications")
          .insert({
            recipient_id: o.id,
            phone_number: phone,
            event_type: "escalation_overdue",
            ref_id: r.id,
            message,
            status: "queued",
            provider: "unisms",
          })
          .select("id")
          .single();
        if (error) {
          totals.duplicate++;
          continue;
        }
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
        (totals as any)[out.status]++;
      }
      await admin
        .from("missed_pickup_reports")
        .update({ escalated_at: new Date().toISOString() })
        .eq("id", r.id);
    }
    return json({ ok: true, hours, ...totals });
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
