import { useEffect, useState } from "react";
import { X, Loader2, UserPlus, GraduationCap, Users, CheckCircle2, Printer, KeyRound, Search } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { Profile } from "@/lib/types";
import { initials } from "@/lib/utils";

interface Props {
  onClose: () => void;
  onCreated: () => void;
}

type Tab = "student" | "coach" | "credentials";

interface Credential {
  name: string;
  email: string;
  role: string;
  password: string;
}

export default function AdminPanel({ onClose, onCreated }: Props) {
  const [tab, setTab] = useState<Tab>("student");
  const [coaches, setCoaches] = useState<Profile[]>([]);
  const [loadingCoaches, setLoadingCoaches] = useState(true);

  // credentials tab
  const [students, setStudents] = useState<Profile[]>([]);
  const [loadingStudents, setLoadingStudents] = useState(false);
  const [studentSearch, setStudentSearch] = useState("");
  const [resetting, setResetting] = useState<string | null>(null);
  const [credential, setCredential] = useState<Credential | null>(null);

  // student form
  const [sName, setSName] = useState("");
  const [sEmail, setSEmail] = useState("");
  const [sPassword, setSPassword] = useState("");
  const [sCoach, setSCoach] = useState("");

  // coach form
  const [cName, setCName] = useState("");
  const [cEmail, setCEmail] = useState("");
  const [cPassword, setCPassword] = useState("");

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    async function loadCoaches() {
      const { data } = await supabase
        .from("profiles")
        .select("id, email, name, role, created_at")
        .eq("role", "coach")
        .order("name");
      setCoaches((data as Profile[]) || []);
      setLoadingCoaches(false);
    }
    loadCoaches();
  }, []);

  async function loadStudents() {
    setLoadingStudents(true);
    const { data } = await supabase
      .from("profiles")
      .select("id, email, name, role, created_at")
      .eq("role", "student")
      .order("name");
    setStudents((data as Profile[]) || []);
    setLoadingStudents(false);
  }

  async function resetPassword(userId: string) {
    setResetting(userId);
    setError(null);
    setSuccess(null);
    try {
      const fnUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/reset-user-password`;
      const { data: sess } = await supabase.auth.getSession();
      const res = await fetch(fnUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${sess.session?.access_token ?? ""}`,
        },
        body: JSON.stringify({ userId }),
      });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || "Could not reset password.");
      setCredential({ name: data.name, email: data.email, role: data.role, password: data.password });
      setSuccess(`Password reset for "${data.name}". Print the card below.`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setResetting(null);
    }
  }

  function printCredential() {
    if (!credential) return;
    const html = `
<!DOCTYPE html>
<html><head><title>Student Credentials</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; display: flex; align-items: center; justify-content: center; min-height: 100vh; background: #f1f5f9; padding: 20px; }
  .card { width: 350px; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 24px rgba(0,0,0,0.12); background: white; }
  .card-header { background: #059669; color: white; padding: 24px; text-align: center; }
  .card-header h1 { font-size: 22px; font-weight: 700; }
  .card-header p { font-size: 13px; opacity: 0.85; margin-top: 4px; }
  .card-body { padding: 24px; }
  .field { margin-bottom: 16px; }
  .field-label { font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; color: #64748b; margin-bottom: 4px; }
  .field-value { font-size: 15px; color: #1e293b; font-family: 'SF Mono', 'Courier New', monospace; word-break: break-all; }
  .card-footer { padding: 16px 24px; background: #f8fafc; border-top: 1px solid #e2e8f0; text-align: center; }
  .card-footer p { font-size: 11px; color: #94a3b8; }
  @media print { body { background: white; padding: 0; } .card { box-shadow: none; } }
</style>
</head><body>
  <div class="card">
    <div class="card-header">
      <h1>EduChess</h1>
      <p>Student Login Credentials</p>
    </div>
    <div class="card-body">
      <div class="field">
        <div class="field-label">Name</div>
        <div class="field-value">${credential.name}</div>
      </div>
      <div class="field">
        <div class="field-label">Email</div>
        <div class="field-value">${credential.email}</div>
      </div>
      <div class="field">
        <div class="field-label">Temporary Password</div>
        <div class="field-value">${credential.password}</div>
      </div>
    </div>
    <div class="card-footer">
      <p>Please sign in and change your password after first login.</p>
    </div>
  </div>
  <script>window.onload = () => window.print();</script>
</body></html>`;
    const w = window.open("", "_blank");
    if (w) {
      w.document.write(html);
      w.document.close();
    }
  }

  function reset() {
    setSName("");
    setSEmail("");
    setSPassword("");
    setSCoach("");
    setCName("");
    setCEmail("");
    setCPassword("");
  }

  async function callCreateUser(body: Record<string, unknown>) {
    const fnUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/create-user`;
    const { data: sess } = await supabase.auth.getSession();
    const res = await fetch(fnUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${sess.session?.access_token ?? ""}`,
      },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok || data.error) throw new Error(data.error || "Could not create account.");
    return data;
  }

  async function createStudent(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      await callCreateUser({
        name: sName.trim(),
        email: sEmail.trim(),
        password: sPassword,
        role: "student",
        coachId: sCoach,
      });
      setSuccess(`Student "${sName}" created and assigned to a coach.`);
      reset();
      onCreated();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function createCoach(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      await callCreateUser({
        name: cName.trim(),
        email: cEmail.trim(),
        password: cPassword,
        role: "coach",
      });
      setSuccess(`Coach "${cName}" created.`);
      reset();
      onCreated();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-sm">
      <div className="flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
          <div>
            <h2 className="text-lg font-semibold text-slate-800">Manage Accounts</h2>
            <p className="text-sm text-slate-500">Create student and coach accounts</p>
          </div>
          <button
            onClick={onClose}
            className="flex h-9 w-9 items-center justify-center rounded-full text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-slate-200 px-6">
          <TabBtn active={tab === "student"} onClick={() => setTab("student")} icon={<GraduationCap className="h-4 w-4" />}>
            New Student
          </TabBtn>
          <TabBtn active={tab === "coach"} onClick={() => setTab("coach")} icon={<Users className="h-4 w-4" />}>
            New Coach
          </TabBtn>
          <TabBtn active={tab === "credentials"} onClick={() => { setTab("credentials"); loadStudents(); }} icon={<KeyRound className="h-4 w-4" />}>
            Print Credentials
          </TabBtn>
        </div>

        {/* Body */}
        <div className="overflow-y-auto px-6 py-5">
          {success && (
            <div className="mb-4 flex items-center gap-2 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
              <CheckCircle2 className="h-4 w-4 shrink-0" /> {success}
            </div>
          )}
          {error && (
            <div className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</div>
          )}

          {tab === "credentials" ? (
            <div className="space-y-4">
              {credential && (
                <div className="space-y-3">
                  <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
                    <div className="mb-3 flex items-center gap-2">
                      <KeyRound className="h-4 w-4 text-emerald-600" />
                      <span className="text-sm font-semibold text-emerald-700">New credentials generated</span>
                    </div>
                    <div className="space-y-2">
                      <div>
                        <span className="text-xs font-medium uppercase tracking-wide text-slate-500">Name</span>
                        <p className="font-mono text-sm text-slate-800">{credential.name}</p>
                      </div>
                      <div>
                        <span className="text-xs font-medium uppercase tracking-wide text-slate-500">Email</span>
                        <p className="font-mono text-sm text-slate-800">{credential.email}</p>
                      </div>
                      <div>
                        <span className="text-xs font-medium uppercase tracking-wide text-slate-500">Temporary Password</span>
                        <p className="font-mono text-sm text-slate-800">{credential.password}</p>
                      </div>
                    </div>
                  </div>
                  <button onClick={printCredential} className="flex w-full items-center justify-center gap-2 rounded-lg bg-slate-800 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-slate-900">
                    <Printer className="h-4 w-4" /> Print credential card
                  </button>
                </div>
              )}

              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input
                  value={studentSearch}
                  onChange={(e) => setStudentSearch(e.target.value)}
                  placeholder="Search students by name or email…"
                  className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-9 pr-3 text-sm outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
                />
              </div>

              {loadingStudents ? (
                <div className="flex items-center justify-center py-6">
                  <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
                </div>
              ) : students.length === 0 ? (
                <p className="py-6 text-center text-sm text-slate-400">No students found.</p>
              ) : (
                <div className="space-y-2">
                  {students
                    .filter((s) => {
                      const q = studentSearch.toLowerCase();
                      return !q || s.name.toLowerCase().includes(q) || s.email.toLowerCase().includes(q);
                    })
                    .map((s) => (
                      <div key={s.id} className="flex items-center gap-3 rounded-xl border border-slate-200 p-3 transition hover:border-slate-300">
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-sm font-semibold text-emerald-700">
                          {initials(s.name)}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium text-slate-800">{s.name}</p>
                          <p className="truncate text-xs text-slate-400">{s.email}</p>
                        </div>
                        <button
                          onClick={() => resetPassword(s.id)}
                          disabled={resetting === s.id}
                          className="flex items-center gap-1.5 rounded-lg bg-slate-100 px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:bg-slate-200 disabled:opacity-50"
                        >
                          {resetting === s.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <KeyRound className="h-3.5 w-3.5" />}
                          Reset & Print
                        </button>
                      </div>
                    ))}
                </div>
              )}
            </div>
          ) : tab === "student" ? (
            <form onSubmit={createStudent} className="space-y-4">
              <Field label="Student name">
                <input value={sName} onChange={(e) => setSName(e.target.value)} required className="input" placeholder="Full name" />
              </Field>
              <Field label="Email">
                <input type="email" value={sEmail} onChange={(e) => setSEmail(e.target.value)} required className="input" placeholder="student@example.com" />
              </Field>
              <Field label="Password">
                <input type="password" value={sPassword} onChange={(e) => setSPassword(e.target.value)} required minLength={6} className="input" placeholder="At least 6 characters" />
              </Field>
              <Field label="Assign to coach">
                {loadingCoaches ? (
                  <div className="flex items-center gap-2 text-sm text-slate-400">
                    <Loader2 className="h-4 w-4 animate-spin" /> Loading coaches…
                  </div>
                ) : coaches.length === 0 ? (
                  <p className="text-sm text-amber-600">No coaches available. Create a coach first.</p>
                ) : (
                  <select value={sCoach} onChange={(e) => setSCoach(e.target.value)} required className="input">
                    <option value="">Select a coach…</option>
                    {coaches.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name} — {c.email}
                      </option>
                    ))}
                  </select>
                )}
              </Field>
              <button type="submit" disabled={busy || coaches.length === 0} className="btn-primary">
                {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <UserPlus className="h-5 w-5" />}
                Create student
              </button>
            </form>
          ) : tab === "coach" ? (
            <form onSubmit={createCoach} className="space-y-4">
              <Field label="Coach name">
                <input value={cName} onChange={(e) => setCName(e.target.value)} required className="input" placeholder="Full name" />
              </Field>
              <Field label="Email">
                <input type="email" value={cEmail} onChange={(e) => setCEmail(e.target.value)} required className="input" placeholder="coach@example.com" />
              </Field>
              <Field label="Password">
                <input type="password" value={cPassword} onChange={(e) => setCPassword(e.target.value)} required minLength={6} className="input" placeholder="At least 6 characters" />
              </Field>
              <button type="submit" disabled={busy} className="btn-primary">
                {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <UserPlus className="h-5 w-5" />}
                Create coach
              </button>
            </form>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function TabBtn({ active, onClick, icon, children }: { active: boolean; onClick: () => void; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-medium transition ${
        active ? "border-emerald-600 text-emerald-700" : "border-transparent text-slate-500 hover:text-slate-700"
      }`}
    >
      {icon}
      {children}
    </button>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-slate-600">{label}</span>
      {children}
    </label>
  );
}
