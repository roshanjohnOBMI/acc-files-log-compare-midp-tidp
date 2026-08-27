import { useEffect, useState } from "react";
import { clearLog, exportLogUrl, listLog } from "../api/log";
import type { LogEntry } from "../types/domain";

const RENDER_LIMIT = 500;

export function ErrorLogPanel() {
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    setLoading(true);
    try {
      setEntries(await listLog());
      setError(null);
    } catch (err) {
      // This runs on an unattended 4s timer, not just on click - without a catch here a failure
      // (e.g. the session expiring) becomes a silent unhandled rejection every 4 seconds forever
      // with no indication to the user of what's wrong.
      setError(err instanceof Error ? err.message : "Failed to load the activity log");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
    // Server-side actions (parsing, searching, exporting) log entries outside of any component's
    // own state, so this panel has no direct signal when a new one lands - poll instead of only
    // fetching once on mount.
    const interval = setInterval(refresh, 4000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="error-log-panel">
      <div className="error-log-toolbar">
        <h3>Activity &amp; error log</h3>
        <button type="button" onClick={refresh} disabled={loading}>
          Refresh
        </button>
        <a className="button-link" href={exportLogUrl("xlsx")}>
          Export .xlsx
        </a>
        <a className="button-link" href={exportLogUrl("csv")}>
          Export .csv
        </a>
        <button
          type="button"
          className="danger"
          onClick={async () => {
            try {
              await clearLog();
              await refresh();
            } catch (err) {
              setError(err instanceof Error ? err.message : "Failed to clear the activity log");
            }
          }}
        >
          Clear log
        </button>
      </div>
      {error && <p className="error-text">{error}</p>}
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Time</th>
              <th>Stage</th>
              <th>Severity</th>
              <th>Message</th>
            </tr>
          </thead>
          <tbody>
            {entries.slice(0, RENDER_LIMIT).map((entry, i) => (
              <tr key={i}>
                <td>{new Date(entry.timestamp).toLocaleString()}</td>
                <td>{entry.stage}</td>
                <td>
                  <span className={`severity-badge severity-${entry.severity}`}>{entry.severity}</span>
                </td>
                <td>{entry.message}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {entries.length === 0 && <p className="hint">No log entries yet.</p>}
        {entries.length > RENDER_LIMIT && (
          <p className="hint">
            Showing the {RENDER_LIMIT} most recent of {entries.length} entries - use "Export" for the full log.
          </p>
        )}
      </div>
    </div>
  );
}
