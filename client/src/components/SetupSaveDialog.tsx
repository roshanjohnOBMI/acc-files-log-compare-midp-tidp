import { useState } from "react";
import { createSetup, updateSetup, type SetupInput } from "../api/setups";
import type { Setup } from "../types/domain";

interface SetupSaveDialogProps {
  disabled: boolean;
  getInput: () => Omit<SetupInput, "name">;
  /** The setup currently loaded into the workspace, if any - lets the user overwrite it instead
   * of always creating a new one. */
  activeSetup: { id: string; name: string } | null;
  onSaved: (setup: Setup) => void;
  onUpdated: (setup: Setup) => void;
}

export function SetupSaveDialog({ disabled, getInput, activeSetup, onSaved, onUpdated }: SetupSaveDialogProps) {
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    if (!name.trim()) {
      setError("Give this setup a name first.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const setup = await createSetup({ ...getInput(), name: name.trim() });
      onSaved(setup);
      setName("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save setup");
    } finally {
      setSaving(false);
    }
  }

  async function handleUpdate() {
    if (!activeSetup) return;
    setUpdating(true);
    setError(null);
    try {
      const setup = await updateSetup(activeSetup.id, { ...getInput(), name: activeSetup.name });
      onUpdated(setup);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update setup");
    } finally {
      setUpdating(false);
    }
  }

  return (
    <div className="setup-save-dialog-group">
      {activeSetup && (
        <div className="setup-save-dialog">
          <button type="button" onClick={handleUpdate} disabled={disabled || updating}>
            {updating ? "Updating…" : `Update "${activeSetup.name}" with current settings`}
          </button>
        </div>
      )}
      <div className="setup-save-dialog">
        <input
          type="text"
          placeholder="Name this setup (e.g. 'Structural TIDP - monthly')"
          value={name}
          onChange={(e) => setName(e.target.value)}
          disabled={disabled || saving}
        />
        <button type="button" onClick={handleSave} disabled={disabled || saving}>
          {saving ? "Saving…" : "Save as new setup"}
        </button>
      </div>
      {error && <p className="error-text">{error}</p>}
    </div>
  );
}
