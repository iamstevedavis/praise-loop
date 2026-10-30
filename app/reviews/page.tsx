"use client";
import Link from "next/link";
import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { apiFetch } from "../apiFetch";
import { useBusiness } from "../AppShell";
import Icon from "../ui/Icon";

type Review = { id: number; rating: number; author_name: string | null; text: string; reviewed_at: string; source: string; status: string };
type ImportResult = { imported: number; duplicates: number; failedRows: number; skippedEmpty: number; rejectedInvalid: number; errors?: { row: number; error: string }[] };
type Filter = "all" | "ready" | "used" | "unfit";

const statusLabels: Record<string, [string, string]> = {
  ready: ["pl-badge-approved", "Ready"],
  used: ["pl-badge-scheduled", "In a post"],
  duplicate: ["pl-badge-archived", "Duplicate"],
  low_rating: ["pl-badge-archived", "Under 4 stars"],
  too_short: ["pl-badge-archived", "Too short"],
  unsuitable: ["pl-badge-archived", "Not suitable"]
};
const filters: [Filter, string][] = [["all", "All"], ["ready", "Ready"], ["used", "Used"], ["unfit", "Not a fit"]];
const unfit = ["duplicate", "low_rating", "too_short", "unsuitable"];

function stars(rating: number) { return "★★★★★".slice(0, rating) + "☆☆☆☆☆".slice(0, 5 - rating); }

export default function ReviewsPage() {
  const { business, status } = useBusiness();
  const businessId = business?.id;
  const [reviews, setReviews] = useState<Review[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [filter, setFilter] = useState<Filter>("all");
  const [result, setResult] = useState<ImportResult | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const currentId = useRef(businessId);
  currentId.current = businessId;

  const load = useCallback(async (id: number | string, isCurrent: () => boolean = () => true) => {
    const response = await apiFetch(`/api/reviews?businessId=${id}`);
    if (!response.ok || !isCurrent()) return;
    const data = await response.json();
    setReviews(data.reviews ?? []);
    setCounts(data.counts ?? {});
  }, []);

  useEffect(() => {
    setReviews([]); setCounts({}); setResult(null); setMessage("");
    if (!businessId) return;
    let current = true;
    void load(businessId, () => current);
    return () => { current = false; };
  }, [businessId, load]);

  async function importCsv(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!businessId) return;
    const importedFor = businessId, stillCurrent = () => currentId.current === importedFor;
    const form = e.currentTarget;
    const formData = new FormData(form);
    formData.set("businessId", String(businessId));
    setBusy(true);
    try {
      const response = await apiFetch("/api/reviews/import", { method: "POST", body: formData });
      const data = await response.json();
      // The owner may have switched business while the upload ran; don't show A's results under B.
      if (!stillCurrent()) return;
      if (!response.ok) { setResult(null); setMessage(`Import failed: ${data.error ?? "unknown error"}`); return; }
      setResult(data); setMessage("");
      form.reset();
      await load(importedFor, stillCurrent);
    } catch {
      if (stillCurrent()) setMessage("Connection problem. Importing the same file again is safe — duplicates are skipped.");
    } finally { setBusy(false); }
  }

  if (status === "loading") return <p className="pl-muted" role="status">Loading reviews…</p>;
  if (!business) return <div className="pl-empty"><h2>Set up your business first</h2><Link href="/onboarding" className="pl-btn pl-btn-primary">Get started</Link></div>;

  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const shown = reviews.filter(r => filter === "all" || (filter === "unfit" ? unfit.includes(r.status) : r.status === filter));
  const problems = result ? result.failedRows + result.rejectedInvalid + result.skippedEmpty : 0;

  return (
    <>
      <header className="pl-header">
        <div className="pl-header-text">
          <h1 className="pl-title">Reviews</h1>
          <p className="pl-lede">Everything your customers have said, and which reviews we can turn into posts.</p>
        </div>
      </header>

      <form onSubmit={importCsv} className="pl-panel" style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-end", gap: 16 }}>
        <label className="pl-field" style={{ flex: "1 1 280px" }}>
          Review CSV
          <input ref={fileInput} className="pl-input" type="file" name="file" accept=".csv,text/csv" required />
          <span className="pl-small pl-muted" style={{ fontWeight: 400 }}>Columns: rating, text, reviewed_at. Optional: author_name, source_review_id, source_url. Up to 1,000 rows / 1 MB. Re-importing a file is safe.</span>
        </label>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          <button type="submit" className="pl-btn pl-btn-primary pl-btn-lg" disabled={busy}><Icon name="upload" size={18} />Import reviews</button>
          <a href="/onboarding-example.csv" download className="pl-small" style={{ fontWeight: 600 }}>Sample CSV</a>
        </div>
      </form>

      <p role="status" className="pl-toast">{message}</p>

      {result ? (
        <section aria-labelledby="import-h" className="pl-panel" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <h2 id="import-h" className="pl-h2" style={{ fontSize: 18 }}>Import finished</h2>
          <p style={{ margin: 0 }}>
            {result.imported} imported · {result.duplicates} duplicates skipped
            {problems ? <> · <span style={{ color: "#A3361F", fontWeight: 600 }}>{problems} rows couldn’t be used</span></> : null}
          </p>
          {result.errors?.length ? (
            <details>
              <summary style={{ cursor: "pointer", fontWeight: 600, color: "var(--pl-green)" }}>See rows with problems</summary>
              <ul style={{ margin: "8px 0 0", paddingLeft: 20 }}>{result.errors.map(e => <li key={`${e.row}-${e.error}`}>Row {e.row}: {e.error}</li>)}</ul>
            </details>
          ) : null}
        </section>
      ) : null}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 12 }}>
        <div className="pl-panel" style={{ padding: "16px 18px", background: "var(--pl-green-soft)", borderColor: "transparent" }}>
          <div style={{ fontFamily: "var(--pl-display)", fontSize: 32, fontWeight: 700, color: "var(--pl-green)" }}>{counts.ready ?? 0}</div>
          <div style={{ fontSize: 14, fontWeight: 600, color: "#0A3D31" }}>Ready to become posts</div>
        </div>
        <div className="pl-panel" style={{ padding: "16px 18px" }}><div style={{ fontFamily: "var(--pl-display)", fontSize: 32, fontWeight: 700 }}>{counts.used ?? 0}</div><div className="pl-muted" style={{ fontSize: 14 }}>Already used</div></div>
        <div className="pl-panel" style={{ padding: "16px 18px" }}><div style={{ fontFamily: "var(--pl-display)", fontSize: 32, fontWeight: 700 }}>{unfit.reduce((n, s) => n + (counts[s] ?? 0), 0)}</div><div className="pl-muted" style={{ fontSize: 14 }}>Not a fit for a post</div></div>
        <div className="pl-panel" style={{ padding: "16px 18px" }}><div style={{ fontFamily: "var(--pl-display)", fontSize: 32, fontWeight: 700 }}>{total}</div><div className="pl-muted" style={{ fontSize: 14 }}>Total imported</div></div>
      </div>

      {reviews.length ? (
        <>
          <div role="group" aria-label="Filter reviews" style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {filters.map(([value, label]) => (
              <button key={value} type="button" aria-pressed={filter === value} className={`pl-btn ${filter === value ? "pl-btn-dark" : ""}`} style={{ borderRadius: 22 }} onClick={() => setFilter(value)}>{label}</button>
            ))}
          </div>
          <div style={{ overflowX: "auto", borderRadius: 18, border: "1px solid var(--pl-line)", background: "var(--pl-surface)" }}>
            <table style={{ width: "100%", minWidth: 720, borderCollapse: "collapse", fontSize: 15 }}>
              <caption className="pl-small pl-muted" style={{ textAlign: "left", padding: "12px 18px 0" }}>Latest {Math.min(100, total)} of {total} reviews</caption>
              <thead>
                <tr style={{ textAlign: "left", fontSize: 13 }} className="pl-muted">
                  {["Rating", "Review", "From", "Date", "Status"].map(h => <th key={h} scope="col" style={{ padding: "12px 18px", borderBottom: "1px solid var(--pl-line)" }}>{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {shown.map(r => {
                  const [badge, label] = statusLabels[r.status] ?? ["pl-badge-archived", r.status];
                  return (
                    <tr key={r.id}>
                      <td style={{ padding: "14px 18px", borderBottom: "1px solid var(--pl-line-soft)", whiteSpace: "nowrap", color: "#B5650D", fontWeight: 700 }} aria-label={`${r.rating} stars`}>{stars(r.rating)}</td>
                      <td style={{ padding: "14px 18px", borderBottom: "1px solid var(--pl-line-soft)", lineHeight: 1.45, color: unfit.includes(r.status) ? "var(--pl-muted)" : undefined }}>{r.text}</td>
                      <td style={{ padding: "14px 18px", borderBottom: "1px solid var(--pl-line-soft)", whiteSpace: "nowrap" }}>{r.author_name || "Anonymous"}</td>
                      <td style={{ padding: "14px 18px", borderBottom: "1px solid var(--pl-line-soft)", whiteSpace: "nowrap" }} className="pl-muted">{new Date(r.reviewed_at).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}</td>
                      <td style={{ padding: "14px 18px", borderBottom: "1px solid var(--pl-line-soft)" }}><span className={`pl-badge ${badge}`}>{label}</span></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <div className="pl-empty">
          <h2>Start with your reviews</h2>
          <p className="pl-muted">Upload a CSV of reviews above and we’ll make posts from the best ones.</p>
          <button type="button" className="pl-btn pl-btn-primary" onClick={() => fileInput.current?.click()}><Icon name="upload" size={16} />Choose a CSV file</button>
        </div>
      )}
    </>
  );
}
