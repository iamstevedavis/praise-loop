"use client";
import { useEffect, useState } from "react";
import { apiFetch } from "../apiFetch";

type Slot = { weekday: number; time: string };
type Approved = { id: number; version: number; quote_text: string; author_name?: string | null };

// Monday-first display; weekday numbers stay 0 = Sunday to match the stored settings.
const days: [number, string][] = [[1, "Mon"], [2, "Tue"], [3, "Wed"], [4, "Thu"], [5, "Fri"], [6, "Sat"], [0, "Sun"]];

export default function PostingSlots({ businessId, approved, onAssigned }: { businessId: number | string; approved: Approved[]; onAssigned: () => void }) {
  const [zone, setZone] = useState(""), [settings, setSettings] = useState<Slot[]>([]), [slots, setSlots] = useState<string[]>([]);
  const [selected, setSelected] = useState<Record<number, boolean>>({}), [message, setMessage] = useState(""), [busy, setBusy] = useState(false);

  async function load(isCurrent: () => boolean = () => true) {
    const response = await apiFetch(`/api/posting-slots?businessId=${businessId}`);
    const data = await response.json();
    if (!isCurrent()) return;
    if (!response.ok) { setMessage(data.error); return; }
    setZone(data.timezone); setSettings(data.settings); setSlots(data.slots);
  }
  useEffect(() => { let current = true; void load(() => current); return () => { current = false; }; }, [businessId]);

  async function save() {
    setBusy(true);
    try {
      const response = await apiFetch("/api/posting-slots", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ businessId, settings }) });
      const data = await response.json();
      setMessage(response.ok ? "Posting times saved. Posts already sent keep their original times." : data.error);
      if (response.ok) await load();
    } finally { setBusy(false); }
  }

  async function assign() {
    const chosen = approved.filter(d => selected[d.id]);
    if (chosen.length > Math.min(5, slots.length)) { setMessage(`Pick up to ${Math.min(5, slots.length)} posts — that’s how many open times are coming up`); return; }
    setBusy(true);
    try {
      const items = chosen.map((d, i) => ({ draftPostId: d.id, version: d.version, instant: slots[i] }));
      const response = await apiFetch("/api/posting-slots/assign", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ businessId, confirm: true, items }) });
      const data = await response.json();
      setMessage(data.results ? data.results.map((r: { draftPostId: number; status: number; error?: string }) => `Post #${r.draftPostId}: ${r.status === 200 ? "scheduled" : r.error}`).join("; ") : data.error);
      setSelected({});
      await load();
      onAssigned();
    } finally { setBusy(false); }
  }

  const format = (instant: string) => new Date(instant).toLocaleString(undefined, { timeZone: zone || "UTC", weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

  return (
    <>
      <p role="status" className="pl-toast">{message}</p>

      <section aria-labelledby="slots-h" className="pl-panel" style={{ display: "flex", flexDirection: "column", gap: 18 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <h2 id="slots-h" className="pl-h2">When to post</h2>
          <span className="pl-small pl-muted">{settings.length} {settings.length === 1 ? "time" : "times"} a week · {zone}</span>
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
          {days.map(([weekday, day]) => {
            const slot = settings.find(s => s.weekday === weekday);
            return (
              <div key={day} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <label className="pl-chip">
                  <input type="checkbox" checked={!!slot} onChange={e => setSettings(e.target.checked ? [...settings, { weekday, time: "10:00" }] : settings.filter(s => s.weekday !== weekday))} />{day}
                </label>
                {slot ? <input className="pl-input" aria-label={`${day} local time`} type="time" value={slot.time} onChange={e => setSettings(settings.map(s => s.weekday === weekday ? { ...s, time: e.target.value } : s))} /> : null}
              </div>
            );
          })}
        </div>
        <div><button type="button" className="pl-btn pl-btn-primary" disabled={busy} onClick={() => void save()}>Save posting schedule</button></div>
      </section>

      <section aria-labelledby="upcoming-h" className="pl-panel" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <h2 id="upcoming-h" className="pl-h2">Next open times</h2>
        {slots.length ? (
          <ol style={{ margin: 0, padding: 0, listStyle: "none", display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 10 }}>
            {slots.map(instant => (
              <li key={instant} style={{ padding: "10px 12px", borderRadius: 10, border: "1px dashed #A9B2AA", display: "flex", flexDirection: "column", gap: 2 }}>
                <strong style={{ fontSize: 15 }}>{format(instant)}</strong>
                <span className="pl-small pl-muted">{zone} · {instant.slice(0, 16).replace("T", " ")} UTC</span>
              </li>
            ))}
          </ol>
        ) : <p className="pl-muted" style={{ margin: 0 }}>Pick at least one day above to see upcoming times.</p>}
      </section>

      <section aria-labelledby="lineup-h" className="pl-panel" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <h2 id="lineup-h" className="pl-h2">Line up approved posts</h2>
          <p className="pl-muted" style={{ margin: 0 }}>Selected posts take the next open times, in order. Nothing is sent until you confirm.</p>
        </div>
        {approved.length ? (
          <>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {approved.map(d => (
                <label key={d.id} className="pl-chip" style={{ borderRadius: 12, justifyContent: "flex-start", padding: "10px 14px" }}>
                  <input type="checkbox" checked={!!selected[d.id]} onChange={e => setSelected({ ...selected, [d.id]: e.target.checked })} />
                  <span>Approved #{d.id}: {d.quote_text}</span>
                </label>
              ))}
            </div>
            <div><button type="button" className="pl-btn pl-btn-primary" onClick={() => void assign()} disabled={busy || !approved.some(d => selected[d.id])}>Confirm selected posting slots</button></div>
          </>
        ) : <p className="pl-muted" style={{ margin: 0 }}>No approved posts waiting. Approve some on This week first.</p>}
      </section>
    </>
  );
}
