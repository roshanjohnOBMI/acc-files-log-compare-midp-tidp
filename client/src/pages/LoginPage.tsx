import { useSearchParams } from "react-router-dom";
import { loginUrl } from "../api/auth";

export function LoginPage() {
  const [searchParams] = useSearchParams();
  const error = searchParams.get("error");

  return (
    <div className="login-page">
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
