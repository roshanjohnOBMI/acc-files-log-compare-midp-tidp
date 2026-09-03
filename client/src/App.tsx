import { useEffect, useState } from "react";
import { BrowserRouter, Link, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { getMe, logout, type Profile } from "./api/auth";
import { HubProjectSelect } from "./components/HubProjectSelect";
import { ThemeToggle } from "./components/ThemeToggle";
import { useTheme } from "./hooks/useTheme";
import { LoginPage } from "./pages/LoginPage";
import { WorkspacePage } from "./pages/WorkspacePage";
import { SetupMappingPage } from "./pages/SetupMappingPage";
import { SetupsPage } from "./pages/SetupsPage";
import { WorkspaceProvider, useWorkspace } from "./context/WorkspaceContext";

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
  const { theme, setTheme } = useTheme();

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
    return <LoginPage theme={theme} onChangeTheme={setTheme} />;
  }

  return (
    <WorkspaceProvider>
      <div className="app-shell">
        <header className="app-topbar">
          <TopbarHubProject />
          <div className="app-topbar-user">
            <ThemeToggle theme={theme} onChange={setTheme} />
            <span>{profile.name}</span>
            <button
              type="button"
              className="btn-secondary"
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

        <div className="app-subnav">
          <div className="app-subnav-brand">
            <img className="app-subnav-mark" src="/obmi-mark.png" alt="OBMI" />
            <span>ACC Files Log vs TIDP/MIDP Checker</span>
          </div>
          <nav className="app-subnav-tabs">
            <Link to="/" aria-current={location.pathname === "/" ? "page" : undefined}>
              Workspace
            </Link>
            <Link to="/setup" aria-current={location.pathname === "/setup" ? "page" : undefined}>
              Setup &amp; mapping
            </Link>
            <Link to="/setups" aria-current={location.pathname === "/setups" ? "page" : undefined}>
              Saved setups
            </Link>
          </nav>
          <CompareAction pathname={location.pathname} />
        </div>

        <main>
          <Routes>
            <Route path="/" element={<WorkspacePage />} />
            <Route path="/setup" element={<SetupMappingPage />} />
            <Route path="/setups" element={<SetupsPage />} />
            <Route path="/login" element={<Navigate to="/" replace />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </main>
      </div>
    </WorkspaceProvider>
  );
}

/** Hub/Project pickers live in the persistent top bar (rather than as a Workspace step) since
 * they're the one piece of context every page - Workspace, Setup & mapping, Saved setups - needs
 * to agree on. */
function TopbarHubProject() {
  const { hub, project, setHub, setProject } = useWorkspace();
  return (
    <div className="app-topbar-selects">
      <HubProjectSelect
        hubId={hub?.id ?? null}
        projectId={project?.id ?? null}
        onChangeHub={setHub}
        onChangeProject={setProject}
      />
    </div>
  );
}

/** The primary "Compare N row(s)" action, pinned in the sub-nav on any page where it's actionable
 * (Workspace and Setup & mapping share the same in-flight comparison state). */
function CompareAction({ pathname }: { pathname: string }) {
  const { combinedSheet, filteredRows, canSearch, searching, handleSearch } = useWorkspace();
  if (pathname === "/setups" || !combinedSheet) return null;
  return (
    <button type="button" className="btn-primary app-subnav-compare" onClick={handleSearch} disabled={!canSearch || searching}>
      {searching ? "Comparing…" : `Compare ${filteredRows.length} row(s)`}
    </button>
  );
}
