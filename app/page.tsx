"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { signIn } from "next-auth/react";
import { useEffect } from "react";
import { useBusiness } from "./AppShell";
import Icon from "./ui/Icon";
import styles from "./landing.module.css";

const steps = [
  ["1 · Bring your reviews", "Upload a spreadsheet of reviews from Google, Yelp or anywhere else."],
  ["2 · We make the posts", "Each week we pick the best quotes, design the image and write the caption."],
  ["3 · You approve", "Tweak a caption if you want. Approved posts go out on your schedule."]
];

export default function HomePage() {
  const router = useRouter();
  const { status, businesses } = useBusiness();
  useEffect(() => {
    if (status === "ready") router.replace(businesses.length ? "/approval" : "/onboarding");
  }, [status, businesses.length, router]);

  return (
    <div className={styles.page}>
      <header className={styles.bar}>
        <Link href="/" className="pl-brand"><span className="pl-brand-mark"><Icon name="loop" strokeWidth={2.2} /></span>PraiseLoop</Link>
      </header>
      <main className={styles.hero}>
        <section className={styles.copy}>
          <span className="pl-badge pl-badge-ready">For local businesses</span>
          <h1 className={styles.headline}>Your happy customers are your best marketing.</h1>
          <p className={styles.lede}>PraiseLoop turns your best reviews into on-brand social posts every week. You spend five minutes approving them. That’s it.</p>
          <div className={styles.cta}>
            <button type="button" className="pl-btn pl-btn-dark pl-btn-lg" onClick={() => signIn("google", { callbackUrl: "/approval" })} disabled={status === "loading" || status === "ready"}>
              Continue with Google
            </button>
            <span className="pl-muted pl-small">Nothing posts without your OK.</span>
          </div>
        </section>
        <div className={styles.sample} role="img" aria-label="Example quote card: The sourdough is unreal and they remember my order every single time. — Priya S.">
          <span className={styles.stars} aria-hidden="true">★★★★★</span>
          <p className={styles.quote}>“The sourdough is unreal and they remember my order every single time.”</p>
          <span className={styles.author}>Priya S.</span>
        </div>
      </main>
      <section aria-label="How it works" className={styles.steps}>
        {steps.map(([title, body]) => (
          <div key={title} className={styles.step}><strong>{title}</strong><span>{body}</span></div>
        ))}
      </section>
    </div>
  );
}
