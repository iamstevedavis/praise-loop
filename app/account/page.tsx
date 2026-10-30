"use client";
import { useState } from "react";
import { useBusiness, useProfile } from "../AppShell";
import ProfileNameForm from "../ProfileNameForm";
import { ADD_NAME_HINT, ADD_NAME_PROMPT, displayName } from "../../lib/profileDisplay";
import { expiryNote, formatLocalDate, planName, quotaMetMessage } from "../../lib/planDisplay";
import { usePlan } from "../ui/usePlan";

const sources = { default: "Default plan", manual: "Set by PraiseLoop support", store: "App store subscription" } as const;
const yesNo = (value: boolean) => value ? "Included" : "Not included";

// The full profile and plan page (#150), reached from the profile menu. The name is
// the only editable part; email is the verified Google identity and plans are
// changed by operators or a verified store webhook, never here.
export default function AccountPage() {
  const { status } = useBusiness();
  const { profile, loaded } = useProfile();
  const { plan, failed } = usePlan();
  const [editing, setEditing] = useState(false);

  if (status === "loading" || (!plan && !failed)) return <p className="pl-muted" role="status">Loading your plan…</p>;
  if (!plan) return <div className="pl-empty"><h2>We couldn’t load your plan</h2><p className="pl-muted">Check your connection and reload the page.</p></div>;

  const name = displayName(profile?.name ?? null);
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
          <span className="pl-eyebrow">Profile</span>
          <h1 className="pl-title">{loaded ? name ?? ADD_NAME_PROMPT : "Your profile"}</h1>
          <p className="pl-lede">{loaded ? name ? profile?.email : ADD_NAME_HINT : ""}</p>
        </div>
      </header>

      <section aria-labelledby="details-h" className="pl-panel" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <h2 id="details-h" className="pl-h2">Your details</h2>
        {!loaded ? (
          <p className="pl-muted" role="status">Loading your profile…</p>
        ) : editing ? (
          <ProfileNameForm initial={profile?.name ?? ""} onSaved={() => setEditing(false)} onCancel={() => setEditing(false)} />
        ) : (
          <>
            <dl style={{ margin: 0, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: "12px 24px" }}>
              <div>
                <dt className="pl-small pl-muted">Name</dt>
                <dd style={{ margin: 0, fontWeight: 600 }}>{name ?? ADD_NAME_PROMPT}</dd>
              </div>
              <div>
                <dt className="pl-small pl-muted">Email</dt>
                <dd style={{ margin: 0, fontWeight: 600 }}>{profile?.email ?? "…"}</dd>
                <dd className="pl-small pl-muted" style={{ margin: 0 }}>From your Google sign-in. Read-only.</dd>
              </div>
            </dl>
            <div>
              <button type="button" className="pl-btn" onClick={() => setEditing(true)}>{name ? "Edit name" : ADD_NAME_PROMPT}</button>
            </div>
          </>
        )}
      </section>

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
