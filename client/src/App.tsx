import { useEffect, useState } from "react";
import { BrowserRouter, Link, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { getMe, logout, type Profile } from "./api/auth";
import { LoginPage } from "./pages/LoginPage";
import { WorkspacePage } from "./pages/WorkspacePage";
import { SetupsPage } from "./pages/SetupsPage";

export default function App() {
  return (
    <BrowserRouter>
      <AppShell />
    </BrowserRouter>
  );
}

function AppShell() {
  const [profile, setProfile] = useState<Profile | null | undefined>(undefined);
  const location = useLocation();

  useEffect(() => {
    getMe()
      .then((res) => setProfile(res.profile))
      .catch(() => setProfile(null));
  }, []);

  if (profile === undefined) {
    return <div className="loading-screen">Loading…</div>;
  }

  if (profile === null) {
    if (location.pathname !== "/login") {
      return <Navigate to="/login" replace />;
    }
    return <LoginPage />;
  }

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="app-header-brand">
          <img className="app-header-mark" src="/obmi-mark.png" alt="" />
          <h1>ACC Files Log vs TIDP/MIDP Checker</h1>
        </div>
        <nav>
          <Link to="/">Workspace</Link>
          <Link to="/setups">Saved setups</Link>
        </nav>
        <div className="app-header-user">
          <span>{profile.name}</span>
          <button
            type="button"
            onClick={async () => {
              try {
                await logout();
              } catch {
                // Best-effort - even if the server-side session teardown fails, drop the client's
                // own copy of the profile so the user isn't stuck looking signed-in.
              } finally {
                setProfile(null);
              }
            }}
          >
            Sign out
          </button>
        </div>
      </header>
      <main>
        <Routes>
          <Route path="/" element={<WorkspacePage />} />
          <Route path="/setups" element={<SetupsPage />} />
          <Route path="/login" element={<Navigate to="/" replace />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
  );
}
