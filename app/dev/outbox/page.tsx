import { notFound } from "next/navigation";
import { emailOutbox, resolveEmailTransportName } from "../../../lib/email";

// Development-only view of the fake email outbox (#155). Production and any
// process using a real transport answer exactly like an unknown route.
export const dynamic = "force-dynamic";

function fakeTransportSelected() {
  try {
    return resolveEmailTransportName() === "fake";
  } catch {
    return false;
  }
}

export default function EmailOutboxPage() {
  if (!fakeTransportSelected()) notFound();
  const messages = [...emailOutbox()].reverse();
  return (
    <main style={{ maxWidth: 760, margin: "0 auto", padding: "40px 20px", display: "flex", flexDirection: "column", gap: 16 }}>
      <h1 style={{ margin: 0, fontSize: 28 }}>Email outbox</h1>
      <p className="pl-muted">
        Messages the development fake transport recorded. Nothing leaves this machine. The outbox empties when the
        server restarts.
      </p>
      {messages.length === 0 ? <p className="pl-muted">No messages yet.</p> : null}
      {messages.map((message, index) => (
        <article key={`${message.sentAt}-${index}`} className="pl-card" style={{ padding: 18, gap: 8 }}>
          <div className="pl-card-meta">
            <strong>{message.subject}</strong>
            <span className="pl-small pl-muted">{new Date(message.sentAt).toLocaleString()}</span>
          </div>
          <span className="pl-small pl-muted">To: {message.to}</span>
          <pre style={{ margin: 0, whiteSpace: "pre-wrap", fontFamily: "inherit", lineHeight: 1.5 }}>{message.text}</pre>
        </article>
      ))}
    </main>
  );
}
