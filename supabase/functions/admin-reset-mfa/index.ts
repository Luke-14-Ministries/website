// Admin-only: remove all two-factor factors from a user who is locked out
// (lost phone, wiped authenticator app). The powerful service-role key lives
// only here, inside Supabase -- never in the website app -- which is why this
// is an Edge Function and not a Next.js server action.
//
// Flow: the caller's own JWT identifies them; we confirm they are an active
// admin (reading their own staff row under RLS); then a separate service-role
// client resolves the target by email and deletes their factors. A non-admin
// caller gets 403 and nothing happens.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(obj: unknown, status: number) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
    const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const authHeader = req.headers.get("Authorization") ?? "";

    // Who is calling, from their own token.
    const caller = createClient(url, anon, {
      global: { headers: { Authorization: authHeader } },
    });
    const {
      data: { user },
      error: userError,
    } = await caller.auth.getUser();
    if (userError || !user) return json({ error: "Not signed in." }, 401);

    // The caller must be an active admin. staff_select RLS lets a user read
    // their own staff row, which is all this needs.
    const { data: staffRow } = await caller
      .from("staff")
      .select("role, active")
      .eq("profile_id", user.id)
      .maybeSingle();
    if (!staffRow || !staffRow.active || staffRow.role !== "admin") {
      return json({ error: "Admin access required." }, 403);
    }

    const body = await req.json().catch(() => ({}));
    const email = String(body?.email ?? "").trim().toLowerCase();
    if (!email) return json({ error: "Please provide the user's email." }, 400);

    // Service-role client: resolve the email to a user and clear their factors.
    const admin = createClient(url, service, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    let target: { id: string; email?: string } | null = null;
    for (let page = 1; page <= 20 && !target; page++) {
      const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
      if (error) return json({ error: error.message }, 500);
      target =
        data.users.find((u) => (u.email ?? "").toLowerCase() === email) ?? null;
      if (data.users.length < 200) break; // last page
    }
    if (!target) return json({ error: `No account found for ${email}.` }, 404);

    const { data: factors, error: listError } = await admin.auth.admin.mfa.listFactors({
      userId: target.id,
    });
    if (listError) return json({ error: listError.message }, 500);

    let removed = 0;
    for (const f of factors?.factors ?? []) {
      const { error: delError } = await admin.auth.admin.mfa.deleteFactor({
        id: f.id,
        userId: target.id,
      });
      if (!delError) removed += 1;
    }

    return json({ ok: true, email, removed }, 200);
  } catch (e) {
    return json({ error: String((e as Error)?.message ?? e) }, 500);
  }
});
