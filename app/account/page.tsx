"use client";
import { useBusiness } from "../AppShell";
import { expiryNote, formatLocalDate, planName, quotaMetMessage } from "../../lib/planDisplay";
import { usePlan } from "../ui/usePlan";

const sources = { default: "Default plan", manual: "Set by PraiseLoop support", store: "App store subscription" } as const;
const yesNo = (value: boolean) => value ? "Included" : "Not included";

// Read-only: plans are changed by operators or a verified store webhook, never here.
export default function AccountPage() {
  const { status } = useBusiness();
  const { plan, failed } = usePlan();

  if (status === "loading" || (!plan && !failed)) return <p className="pl-muted" role="status">Loading your plan…</p>;
  if (!plan) return <div className="pl-empty"><h2>We couldn’t load your plan</h2><p className="pl-muted">Check your connection and reload the page.</p></div>;

  const note = expiryNote(plan);
  const { limits } = plan;
  const rows: [string, string][] = [
    ["Posts per week, per business", String(limits.postsPerWeek)],
    ["Templates", String(limits.templates)],
    ["Watermark on images", limits.watermark ? "Yes" : "No"],
    ["Automatic review sync", yesNo(limits.reviewSync)],
    ["AI review replies", yesNo(limits.aiReplies)],
    ["Businesses", String(limits.businesses)]
  ];

  return (
    <>
      <header className="pl-header">
        <div className="pl-header-text">
          <span className="pl-eyebrow">Account</span>
          <h1 className="pl-title">Your plan</h1>
          <p className="pl-lede">What your plan includes and how much of this week you have used.</p>
        </div>
      </header>

      <section aria-labelledby="plan-h" className="pl-panel" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <h2 id="plan-h" className="pl-h2">{planName(plan.plan)} plan</h2>
        <p className="pl-muted" style={{ margin: 0 }}>
          {sources[plan.source]}{plan.expiresAt && plan.plan !== "free" ? `, until ${plan.expiresAt.slice(0, 10)}` : ""}
        </p>
        {note ? <p role="status" style={{ margin: 0, fontWeight: 600 }}>{note}</p> : null}
        <dl style={{ margin: 0, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: "12px 24px" }}>
          {rows.map(([label, value]) => (
            <div key={label}><dt className="pl-small pl-muted">{label}</dt><dd style={{ margin: 0, fontWeight: 600 }}>{value}</dd></div>
          ))}
        </dl>
      </section>

      <section aria-labelledby="usage-h" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <h2 id="usage-h" className="pl-h2">This week</h2>
        {plan.usage.length ? plan.usage.map(u => (
          <div key={u.businessId} className="pl-panel" style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <strong>{u.name}</strong>
            <span>{u.allocated} of {u.target} {u.target === 1 ? "post" : "posts"} this week</span>
            <span className="pl-small pl-muted">Resets {formatLocalDate(u.resetsOn)} ({u.timezone})</span>
            {quotaMetMessage(plan, u) ? <span className="pl-small">{quotaMetMessage(plan, u)}</span> : null}
          </div>
        )) : <p className="pl-muted">Add a business to see your weekly usage.</p>}
      </section>
    </>
  );
}
