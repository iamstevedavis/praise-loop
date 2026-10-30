"use client";
import { useId, useState } from "react";
import { useProfile } from "./AppShell";
import { PROFILE_NAME_MAX } from "../lib/profileDisplay";

// Inline name editor used by the profile menu and the profile page (#150). It
// saves through the shared profile state, so both update without a reload.
export default function ProfileNameForm({ initial, onSaved, onCancel }: { initial: string; onSaved: () => void; onCancel: () => void }) {
  const { saveName } = useProfile();
  const [value, setValue] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const id = useId();

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    const failure = await saveName(value);
    setSaving(false);
    if (failure) setError(failure);
    else onSaved();
  }

  return (
    <form className="pl-profile-form" onSubmit={submit}>
      <label className="pl-field" htmlFor={id}>Your name
        <input
          id={id}
          className="pl-input"
          value={value}
          onChange={event => setValue(event.target.value)}
          maxLength={PROFILE_NAME_MAX}
          autoComplete="name"
          autoFocus
        />
      </label>
      {error ? <p className="pl-small pl-error" role="alert" style={{ margin: 0 }}>{error}</p> : null}
      <div className="pl-profile-form-actions">
        <button type="submit" className="pl-btn pl-btn-primary" disabled={saving}>{saving ? "Saving…" : "Save"}</button>
        <button type="button" className="pl-btn" onClick={onCancel} disabled={saving}>Cancel</button>
      </div>
    </form>
  );
}
