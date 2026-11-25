// Supabase Edge Function: sms-status
// Asks UniSMS what happened to messages we sent, and stores the delivery status in sms_notifications.
// Called from Official > SMS & settings > "Refresh delivery status" (or on a schedule with x-cron-secret).
// Deploy:  supabase functions deploy sms-status
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { cors, json, fetchDeliveryStatus } from "../_shared/sms.ts";

const DELIVERED = ["delivered", "deliver", "success"];
const FAILED = ["fail", "undeliver", "reject", "expire", "error", "invalid"];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
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
    if (Deno.env.get("SMS_ENABLED") !== "true")
      return json({
        skipped: "SMS is in simulation mode (nothing was sent to UniSMS)",
      });

    // messages that were accepted by UniSMS but whose final status we do not know yet
    const { data: rows } = await admin
      .from("sms_notifications")
      .select("id, provider_message_id, delivery_status")
      .eq("status", "sent")
      .eq("provider", "unisms")
      .not("provider_message_id", "is", null)
      .or("delivery_status.is.null,delivery_status.not.in.(delivered,failed)")
      .order("created_at", { ascending: false })
      .limit(50);

    const totals = {
      checked: 0,
      delivered: 0,
      failed: 0,
      pending: 0,
      unknown: 0,
    };
    for (const r of rows ?? []) {
      totals.checked++;
      try {
        const { status, raw } = await fetchDeliveryStatus(
          r.provider_message_id!,
        );
        if (!status) {
          totals.unknown++;
          await admin
            .from("sms_notifications")
            .update({
              delivery_checked_at: new Date().toISOString(),
              provider_response: raw,
            })
            .eq("id", r.id);
          continue;
        }
        const isFail = FAILED.some((w) => status.includes(w)),
          isOk = !isFail && DELIVERED.some((w) => status.includes(w));
        await admin
          .from("sms_notifications")
          .update({
            delivery_status: isOk ? "delivered" : isFail ? "failed" : status,
            status: isOk ? "delivered" : isFail ? "failed" : "sent",
            error_message: isFail ? `UniSMS reported: ${status}` : null,
            delivery_checked_at: new Date().toISOString(),
            provider_response: raw,
          })
          .eq("id", r.id);
        if (isOk) totals.delivered++;
        else if (isFail) totals.failed++;
        else totals.pending++;
      } catch {
        totals.unknown++;
      }
    }
    return json({ ok: true, ...totals });
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
