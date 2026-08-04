import { Loader2 } from "lucide-react";
import { AuthProvider, useAuth } from "@/lib/auth";
import Login from "@/components/Login";
import StudentDashboard from "@/components/StudentDashboard";
import CoachDashboard from "@/components/CoachDashboard";

function Router() {
  const { profile, loading } = useAuth();

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-100">
        <Loader2 className="h-8 w-8 animate-spin text-slate-400" />
      </div>
    );
  }

  if (!profile) return <Login />;
  return profile.role === "coach" ? <CoachDashboard /> : <StudentDashboard />;
}

export default function App() {
  return (
    <AuthProvider>
      <Router />
    </AuthProvider>
  );
}
