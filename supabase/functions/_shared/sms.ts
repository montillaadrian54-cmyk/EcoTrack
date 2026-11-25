
// Shared helpers for Supabase Edge Functions:
// CORS, Philippine phone formats, and UniSMS API.

export const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });

const UNISMS_URL = "https://unismsapi.com/api";

// Accepts 09xxxxxxxxx, +639xxxxxxxxx, 639xxxxxxxxx,
// or 9xxxxxxxxx and returns 09xxxxxxxxx.
export function normalizePhone(p: string | null): string | null {
  if (!p) return null;

  let d = p.replace(/\D/g, "");

  if (d.length === 12 && d.startsWith("63")) {
    d = "0" + d.slice(2);
  } else if (d.length === 10 && d.startsWith("9")) {
    d = "0" + d;
  }

  return /^09\d{9}$/.test(d) ? d : null;
}

export type SmsResult = {
  status: "sent" | "queued" | "failed";
  providerId?: string;
  error?: string;
  raw?: string;
};

function getAuthHeaders(apiKey: string) {
  return {
    Authorization: `Basic ${btoa(`${apiKey}:`)}`,
    "Content-Type": "application/json",
    Accept: "application/json",
  };
}

/**
 * Sends one SMS using UniSMS.
 *
 * A successful API response means accepted by the provider.
 * It does not necessarily mean delivered to the recipient.
 */
export async function sendSms(
  number09: string,
  message: string,
): Promise<SmsResult> {
  const apiKey = Deno.env.get("UNISMS_API_KEY");
  const senderId = Deno.env.get("UNISMS_SENDER_ID");

  if (Deno.env.get("SMS_ENABLED") !== "true") {
    return {
      status: "queued",
      error: "SMS disabled (simulation mode).",
    };
  }

  if (!apiKey || !senderId) {
    return {
      status: "failed",
      error: "Missing UNISMS_API_KEY or UNISMS_SENDER_ID.",
    };
  }

  // UniSMS accepts Philippine numbers in international format.
  const digits = number09.replace(/\D/g, "");
  const recipient = digits.startsWith("0")
    ? "+63" + digits.slice(1)
    : digits.startsWith("63")
      ? "+" + digits
      : "+" + digits;

  if (!/^\+639\d{9}$/.test(recipient)) {
    return {
      status: "failed",
      error: "Invalid Philippine mobile number.",
    };
  }

  try {
    const res = await fetch(`${UNISMS_URL}/sms`, {
      method: "POST",
      headers: getAuthHeaders(apiKey),
      body: JSON.stringify({
        recipient,
        content: message,
        sender_id: senderId,
      }),
    });

    const raw = await res.text();

    let data: any;
    try {
      data = JSON.parse(raw);
    } catch {
      return {
        status: "failed",
        error: `UniSMS returned non-JSON response (HTTP ${res.status}).`,
        raw: raw.slice(0, 500),
      };
    }

    if (!res.ok) {
      const details =
        data?.message?.fail_reason ??
        data?.message?.error ??
        data?.error ??
        data?.message;

      return {
        status: "failed",
        error: String(details || `UniSMS HTTP ${res.status}`).slice(0, 300),
        raw: raw.slice(0, 500),
      };
    }

    // UniSMS returns the message details under data.message.
    const item = data?.message ?? data?.data?.message ?? data?.data;

    if (!item) {
      return {
        status: "failed",
        error: "UniSMS returned an unexpected response.",
        raw: raw.slice(0, 500),
      };
    }

    const providerStatus = String(item.status ?? "").toLowerCase();
    const providerId = item.reference_id ?? item.id;

    let status: SmsResult["status"];

    if (providerStatus === "sent") {
      status = "sent";
    } else if (providerStatus === "pending" || providerStatus === "retrying") {
      status = "queued";
    } else if (providerStatus === "failed") {
      status = "failed";
    } else {
      return {
        status: "failed",
        error: `Unknown UniSMS message status: ${providerStatus || "empty"}`,
        providerId: providerId ? String(providerId) : undefined,
        raw: raw.slice(0, 500),
      };
    }

    return {
      status,
      providerId: providerId ? String(providerId) : undefined,
      error:
        status === "failed"
          ? String(item.fail_reason || "UniSMS message failed").slice(0, 300)
          : undefined,
      raw: raw.slice(0, 500),
    };
    
  } catch (e) {
    return {
      status: "failed",
      error: "Network error: " + (e as Error).message,
    };
  }
}

/**
 * Retrieves one message's delivery information from UniSMS.
 */
export async function fetchDeliveryStatus(
  messageId: string,
): Promise<{ status: string | null; raw: string }> {
  const apiKey = Deno.env.get("UNISMS_API_KEY");

  if (!apiKey) {
    return {
      status: null,
      raw: "Missing UNISMS_API_KEY.",
    };
  }

  try {
    const res = await fetch(
      `${UNISMS_URL}/sms/${encodeURIComponent(messageId)}`,
      {
        headers: getAuthHeaders(apiKey),
      },
    );

    const raw = await res.text();

    let data: any;
    try {
      data = JSON.parse(raw);
    } catch {
      return { status: null, raw: raw.slice(0, 500) };
    }

    if (!res.ok) {
      return { status: null, raw: raw.slice(0, 500) };
    }

    const item = data?.message ?? data?.data?.message ?? data?.data;

    return {
      status: item?.status ? String(item.status).toLowerCase() : null,
      raw: raw.slice(0, 500),
    };
    
  } catch (e) {
    return {
      status: null,
      raw: "Network error: " + (e as Error).message,
    };
  }
}
