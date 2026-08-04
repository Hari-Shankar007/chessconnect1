import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    // Verify the caller is an authenticated coach using their bearer token.
    const authHeader = req.headers.get("Authorization") ?? "";
    const callerClient = createClient(url, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: callerData, error: callerErr } = await callerClient.auth.getUser();
    if (callerErr || !callerData.user) {
      return new Response(
        JSON.stringify({ error: "Unauthorized." }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Check app_metadata first (correct location), then fall back to
    // checking the profiles table for users whose metadata was stored
    // incorrectly by an older version of the bootstrap function.
    const admin = createClient(url, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    let callerRole = (callerData.user.app_metadata?.role as string) ?? "";
    if (!callerRole) {
      // Fallback: look up role from profiles table
      const { data: prof } = await admin
        .from("profiles")
        .select("role")
        .eq("id", callerData.user.id)
        .maybeSingle();
      callerRole = prof?.role ?? "";

      // Repair: if they are a coach in profiles, backfill app_metadata so
      // future requests pass the fast check.
      if (callerRole === "coach") {
        await admin.auth.admin.updateUserById(callerData.user.id, {
          app_metadata: { role: "coach" },
        });
      }
    }

    if (callerRole !== "coach") {
      return new Response(
        JSON.stringify({ error: "Only coaches can create new accounts." }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const body = await req.json();
    const { name, email, password, role, coachId } = body as {
      name: string;
      email: string;
      password: string;
      role: "student" | "coach";
      coachId?: string;
    };

    if (!name || !email || !password || !role) {
      return new Response(
        JSON.stringify({ error: "Name, email, password, and role are required." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    if (role === "student" && !coachId) {
      return new Response(
        JSON.stringify({ error: "A coach must be assigned to a student." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Role MUST go into app_metadata (user-immutable) so that
    // auth.jwt() ->> 'role' works in RLS policies and future edge function checks.
    const { data: authData, error: authErr } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { name },
      app_metadata: { role },
    });
    if (authErr) {
      return new Response(
        JSON.stringify({ error: authErr.message }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { error: profErr } = await admin.from("profiles").insert({
      id: authData.user.id,
      email,
      name,
      role,
    });
    if (profErr) {
      return new Response(
        JSON.stringify({ error: profErr.message }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // For students, create the chat linking them to the assigned coach.
    if (role === "student" && coachId) {
      const { error: chatErr } = await admin.from("chats").insert({
        student_id: authData.user.id,
        coach_id: coachId,
      });
      if (chatErr) {
        return new Response(
          JSON.stringify({ error: chatErr.message }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    return new Response(
      JSON.stringify({ ok: true, id: authData.user.id, role }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: (err as Error).message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
