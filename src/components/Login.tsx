import { useEffect, useState } from "react";
import { Loader2, ShieldCheck, Users, GraduationCap } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/lib/supabase";

export default function Login() {
  const { signIn } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Bootstrap state
  const [needsBootstrap, setNeedsBootstrap] = useState<boolean | null>(null);
  const [showBootstrap, setShowBootstrap] = useState(false);
  const [bName, setBName] = useState("");
  const [bEmail, setBEmail] = useState("");
  const [bPassword, setBPassword] = useState("");
  const [bBusy, setBBusy] = useState(false);
  const [bError, setBError] = useState<string | null>(null);
  const [bSuccess, setBSuccess] = useState(false);

  // Check whether any coach exists yet (controls bootstrap panel visibility).
  // Uses a SECURITY DEFINER RPC so the anon role can get a boolean without
  // being blocked by RLS on the profiles table.
  useEffect(() => {
    async function check() {
      const { data } = await supabase.rpc("has_any_coaches");
      setNeedsBootstrap(!data);
    }
    check();
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error } = await signIn(email.trim(), password);
    setBusy(false);
    if (error) setError(error);
  }

  async function handleBootstrap(e: React.FormEvent) {
    e.preventDefault();
    setBBusy(true);
    setBError(null);

    const fnUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/bootstrap-admin`;
    try {
      const res = await fetch(fnUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: bName, email: bEmail, password: bPassword }),
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        setBError(data.error || "Could not create the first coach.");
        setBBusy(false);
        return;
      }
      setBSuccess(true);
      setBBusy(false);
      setNeedsBootstrap(false);
    } catch {
      setBError("Network error. Please try again.");
      setBBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-slate-900 via-slate-800 to-emerald-900 p-4">
      <div className="w-full max-w-md">
        {/* Logo / brand */}
        <div className="mb-8 text-center">
          <div className="mx-auto mb-3 flex h-16 w-16 items-center justify-center rounded-2xl bg-emerald-500 shadow-lg shadow-emerald-500/30">
            <img
              src="/Black_White_Minimalist_Square_Frame_Fashion_Custom_Tailor_Logo.png"
              alt="EduChess"
              className="h-12 w-12 object-contain"
              style={{ filter: "invert(1)" }}
            />
          </div>
          <h1 className="text-2xl font-bold text-white">EduChess Chat</h1>
          <p className="mt-1 text-sm text-slate-400">Coach–student messaging for chess academies</p>
        </div>

        <div className="rounded-2xl bg-white p-6 shadow-2xl sm:p-8">
          {bSuccess ? (
            <div className="text-center">
              <ShieldCheck className="mx-auto mb-3 h-12 w-12 text-emerald-500" />
              <h2 className="text-lg font-semibold text-slate-800">Coach account created</h2>
              <p className="mt-1 text-sm text-slate-500">
                You can now sign in with the email and password you just set.
              </p>
            </div>
          ) : showBootstrap && needsBootstrap ? (
            <form onSubmit={handleBootstrap}>
              <h2 className="text-lg font-semibold text-slate-800">Create the first coach</h2>
              <p className="mt-1 mb-4 text-sm text-slate-500">
                No coaches exist yet. Set up the first admin coach account to get started.
              </p>
              <Field label="Full name">
                <input
                  value={bName}
                  onChange={(e) => setBName(e.target.value)}
                  required
                  className="input"
                  placeholder="e.g. Grandmaster Anand"
                />
              </Field>
              <Field label="Email">
                <input
                  type="email"
                  value={bEmail}
                  onChange={(e) => setBEmail(e.target.value)}
                  required
                  className="input"
                  placeholder="coach@academy.in"
                />
              </Field>
              <Field label="Password">
                <input
                  type="password"
                  value={bPassword}
                  onChange={(e) => setBPassword(e.target.value)}
                  required
                  minLength={6}
                  className="input"
                  placeholder="At least 6 characters"
                />
              </Field>
              {bError && <ErrorNote text={bError} />}
              <button
                type="submit"
                disabled={bBusy}
                className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 py-3 font-medium text-white transition hover:bg-emerald-700 disabled:opacity-50"
              >
                {bBusy ? <Loader2 className="h-5 w-5 animate-spin" /> : <ShieldCheck className="h-5 w-5" />}
                Create first coach
              </button>
              <button
                type="button"
                onClick={() => setShowBootstrap(false)}
                className="mt-3 w-full text-center text-sm text-slate-500 hover:text-slate-700"
              >
                Back to sign in
              </button>
            </form>
          ) : (
            <form onSubmit={handleSubmit}>
              <h2 className="text-lg font-semibold text-slate-800">Sign in</h2>
              <p className="mt-1 mb-4 text-sm text-slate-500">
                Welcome back. Enter your details to continue.
              </p>
              <Field label="Email">
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  className="input"
                  placeholder="you@academy.in"
                />
              </Field>
              <Field label="Password">
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  className="input"
                  placeholder="••••••••"
                />
              </Field>
              {error && <ErrorNote text={error} />}
              <button
                type="submit"
                disabled={busy}
                className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 py-3 font-medium text-white transition hover:bg-emerald-700 disabled:opacity-50"
              >
                {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : "Sign in"}
              </button>

              {needsBootstrap && (
                <button
                  type="button"
                  onClick={() => setShowBootstrap(true)}
                  className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 py-2.5 text-sm font-medium text-emerald-700 transition hover:bg-emerald-100"
                >
                  <ShieldCheck className="h-4 w-4" /> Set up the academy (first coach)
                </button>
              )}
            </form>
          )}
        </div>

        <div className="mt-6 flex items-center justify-center gap-6 text-xs text-slate-400">
          <span className="flex items-center gap-1.5"><GraduationCap className="h-4 w-4" /> Students</span>
          <span className="flex items-center gap-1.5"><Users className="h-4 w-4" /> Coaches</span>
          <span className="flex items-center gap-1.5"><GraduationCap className="h-4 w-4" /> Chess Academy</span>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="mb-3 block">
      <span className="mb-1 block text-sm font-medium text-slate-600">{label}</span>
      {children}
    </label>
  );
}

function ErrorNote({ text }: { text: string }) {
  return <p className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{text}</p>;
}
