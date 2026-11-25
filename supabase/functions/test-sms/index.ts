
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { cors, json, normalizePhone, sendSms } from "../_shared/sms.ts";

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: cors });
  }

  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  try {
    // 1. Require an authenticated user
    const url = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const authHeader = req.headers.get("Authorization") ?? "";

    if (!authHeader) {
      return json({ error: "Missing authorization header" }, 401);
    }

    const userClient = createClient(url, anonKey, {
      global: {
        headers: { Authorization: authHeader },
      },
    });

    const {
      data: { user },
      error: authError,
    } = await userClient.auth.getUser();

    if (authError || !user) {
      return json({ error: "Not authenticated" }, 401);
    }

    // 2. Verify account and get ONLY the caller's phone number
    const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const { data: profile, error: profileError } = await admin
      .from("profiles")
      .select("id, phone_number, is_active")
      .eq("id", user.id)
      .single();

    // Debug profile retrieval
    console.log("PROFILE ID CHECK:", {
      authenticatedUserId: user.id,
      retrievedProfileId: profile?.id,
      phoneIsNull: profile?.phone_number === null,
      profileError: profileError?.message ?? null,
    });

    if (profileError || !profile || !profile.is_active) {
      return json({ error: "Active profile not found" }, 403);
    }

    // 3. Check uniSMS configuration
    if (Deno.env.get("SMS_ENABLED") !== "true") {
      return json(
        {
          error: "SMS_ENABLED is not exactly true",
        },
        400,
      );
    }

    if (!Deno.env.get("UNISMS_API_KEY")) {
      return json({ error: "UniSMS API key is missing" }, 500);
    }

    if (!Deno.env.get("UNISMS_SENDER_ID")) {
      return json({ error: "UniSMS sender ID is missing" }, 500);
    }

    // 4. Normalize the phone number from the caller's own profile
    const rawPhone = profile.phone_number;
    const normalizedPhone = normalizePhone(rawPhone);

    console.log("SMS DEBUG:", {
      profileFound: !!profile,
      phoneIsNull: rawPhone === null,
      phoneType: typeof rawPhone,
      phoneLength: rawPhone?.length,
      normalizedSuccessfully: !!normalizedPhone,
    });

    const phone = normalizedPhone;

    if (!phone) {
      return json(
        {
          error: "Your profile has no valid Philippine mobile number.",
        },
        400,
      );
    }

    // 5. Send one fixed test message to the caller only
    const message =
      "EcoTrack Test: Your UniSMS integration is working. This is a test message.";

    const result = await sendSms(phone, message);

    if (result.status === "failed") {
      return json(
        {
          ok: false,
          status: result.status,
          error: result.error,
        },
        502,
      );
    }

    // 6. Return success response
    return json({
      ok: true,
      message: "Test SMS request processed for your registered phone.",
      status: result.status,
      phone: phone.slice(0, 4) + "****" + phone.slice(-3),
      provider_message_id: result.providerId ?? null,
    });
  } catch (error) {
    console.error("SEND TEST SMS ERROR:", error);

    return json(
      {
        error: (error as Error).message || "Unexpected server error",
      },
      500,
    );
  }
});
