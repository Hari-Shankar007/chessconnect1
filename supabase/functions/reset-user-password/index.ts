import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

function randomPassword(len = 10): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  let out = "";
  for (let i = 0; i < len; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    // Verify the caller is an authenticated coach
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

    const admin = createClient(url, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    let callerRole = (callerData.user.app_metadata?.role as string) ?? "";
    if (!callerRole) {
      const { data: prof } = await admin
        .from("profiles")
        .select("role")
        .eq("id", callerData.user.id)
        .maybeSingle();
      callerRole = prof?.role ?? "";
    }

    if (callerRole !== "coach") {
      return new Response(
        JSON.stringify({ error: "Only coaches can reset passwords." }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { userId } = await req.json();
    if (!userId) {
      return new Response(
        JSON.stringify({ error: "userId is required." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Look up the user's profile to get name + email
    const { data: profile, error: profErr } = await admin
      .from("profiles")
      .select("id, email, name, role")
      .eq("id", userId)
      .maybeSingle();

    if (profErr || !profile) {
      return new Response(
        JSON.stringify({ error: "User not found." }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Generate a new temporary password
    const newPassword = randomPassword(10);

    const { error: updateErr } = await admin.auth.admin.updateUserById(userId, {
      password: newPassword,
    });

    if (updateErr) {
      return new Response(
        JSON.stringify({ error: updateErr.message }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({
        ok: true,
        name: profile.name,
        email: profile.email,
        role: profile.role,
        password: newPassword,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: (err as Error).message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
