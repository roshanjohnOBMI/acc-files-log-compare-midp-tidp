import { useEffect, useState } from "react";
import { useOnceFlag } from "../hooks/useOnceFlag";

/** A "?" trigger (sits in the top bar, top-right of the screen) that opens a short reference
 * panel docked to the right edge - the 3-step workflow plus a few things that aren't obvious from
 * the UI alone. Opens itself once, automatically, the very first time anyone loads the app on a
 * given browser; every time after that it only opens when clicked. */
export function HelpPanel() {
  const [everOpened, markEverOpened] = useOnceFlag("acc-tidp-help-seen");
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!everOpened) {
      setOpen(true);
      markEverOpened();
    }
    // Only ever meant to fire once, on mount - not on every render of the (stable, useCallback'd)
    // markEverOpened/everOpened pair.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <>
      <button
        type="button"
        className="help-trigger"
        aria-label={open ? "Close guide" : "Open guide"}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        ?
      </button>

      {open && (
        <>
          <div className="help-panel-backdrop" onClick={() => setOpen(false)} />
          <aside className="help-panel" role="dialog" aria-label="Guide">
            <div className="help-panel-head">
              <h3>Guide</h3>
              <button type="button" className="link-button" onClick={() => setOpen(false)}>
                Close
              </button>
            </div>

            <ol className="help-panel-steps">
              <li>
                <strong>1. TIDP/MIDP file</strong>
                <p>
                  Pick the workbook from ACC, or upload one from your computer. Its tabs, header
                  row, and column mapping live in "Setup &amp; mapping".
                </p>
              </li>
              <li>
                <strong>2. ACC Files Log</strong>
                <p>
                  Scan folder(s) live for an always-current list, or pick/upload an
                  already-exported log. Checking a folder also checks its immediate subfolders.
                </p>
              </li>
              <li>
                <strong>3. Compare</strong>
                <p>
                  Once both are loaded, "Compare" checks every deliverable against the Files Log
                  and shows Complete / Partial / Missing / Duplicate / Extra results.
                </p>
              </li>
            </ol>

            <div className="help-panel-tips">
              <h4>Tips</h4>
              <ul>
                <li>
                  Uploaded files (either side) aren't tracked against ACC's version history - pick
                  from ACC when you can.
                </li>
                <li>
                  Save a configuration as a "Setup" to reuse it next time without re-picking
                  columns or folders.
                </li>
                <li>"Deep search" match mode tries exact, then starts-with, then contains, in that order.</li>
              </ul>
            </div>
          </aside>
        </>
      )}
    </>
  );
}
