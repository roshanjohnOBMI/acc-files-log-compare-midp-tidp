import { useSearchParams } from "react-router-dom";
import { loginUrl } from "../api/auth";
import { ThemeToggle } from "../components/ThemeToggle";
import type { ThemeChoice } from "../hooks/useTheme";

interface LoginPageProps {
  theme: ThemeChoice;
  onChangeTheme: (theme: ThemeChoice) => void;
}

export function LoginPage({ theme, onChangeTheme }: LoginPageProps) {
  const [searchParams] = useSearchParams();
  const error = searchParams.get("error");

  return (
    <div className="login-page">
      <ThemeToggle theme={theme} onChange={onChangeTheme} />
      <div className="login-card">
        <img className="login-logo" src="/obmi-logo.png" alt="OBMI" />
        <h1>ACC Files Log vs TIDP/MIDP Checker</h1>
        <p>Sign in with your Autodesk account to compare a TIDP/MIDP schedule against an ACC Files Log.</p>
        {error && <p className="error-text">Login failed: {error}</p>}
        <a className="button-link primary" href={loginUrl()}>
          Sign in with Autodesk
        </a>
      </div>
    </div>
  );
}
