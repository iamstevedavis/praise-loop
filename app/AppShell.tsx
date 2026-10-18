"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { signIn, signOut } from "next-auth/react";
import { createContext, useCallback, useContext, useEffect, useState } from "react";
import Icon, { type IconName } from "./ui/Icon";

export type Business = {
  id: number | string; name: string; timezone: string; logo_url: string | null; brand_tone: string; weekly_target: number;
  brand_colors: { primary: string; secondary: string; template: string; quoteSize: string };
};
type BusinessState = {
  status: "loading" | "signed-out" | "error" | "ready";
  businesses: Business[];
  business: Business | null;
  select: (id: number | string) => void;
  reload: () => Promise<void>;
};

const BusinessContext = createContext<BusinessState | null>(null);
const storageKey = "praise-business";

export function useBusiness() {
  const value = useContext(BusinessContext);
  if (!value) throw new Error("useBusiness must be used inside AppShell");
  return value;
}

const nav: { href: string; label: string; icon: IconName; match: string[] }[] = [
  { href: "/approval", label: "This week", icon: "week", match: ["/approval"] },
  { href: "/schedule", label: "Schedule", icon: "calendar", match: ["/schedule"] },
  { href: "/reviews", label: "Reviews", icon: "reviews", match: ["/reviews", "/quotes"] },
  { href: "/brand", label: "Brand", icon: "palette", match: ["/brand"] }
];

function readStored() { try { return localStorage.getItem(storageKey); } catch { return null; } }
function writeStored(id: number | string) { try { localStorage.setItem(storageKey, String(id)); } catch { /* per-viewer convenience only */ } }

// On phones the sidebar is hidden, so the switcher also carries the account actions.
function BusinessSwitcher({ id, withActions = false }: { id: string; withActions?: boolean }) {
  const { businesses, business, select } = useBusiness();
  const router = useRouter();
  if (!businesses.length) return null;
  function change(value: string) {
    if (value === "__add") router.push("/onboarding?new=1");
    else if (value === "__signout") void signOut({ callbackUrl: "/" });
    else select(value);
  }
  return (
    <div className="pl-switcher">
      <label htmlFor={id}>Business</label>
      <select id={id} className="pl-select" value={business?.id ?? ""} onChange={e => change(e.target.value)}>
        {businesses.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
        {withActions ? <optgroup label="Account"><option value="__add">+ Add a business</option><option value="__signout">Sign out</option></optgroup> : null}
      </select>
    </div>
  );
}

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [status, setStatus] = useState<BusinessState["status"]>("loading");
  const [businesses, setBusinesses] = useState<Business[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const response = await fetch("/api/businesses");
      if (response.status === 401) { setStatus("signed-out"); return; }
      if (!response.ok) { setStatus("error"); return; }
      const list: Business[] = (await response.json()).businesses ?? [];
      setBusinesses(list);
      setSelectedId(current => {
        const requested = new URL(window.location.href).searchParams.get("businessId") ?? (current ? String(current) : readStored());
        const match = list.find(b => String(b.id) === requested) ?? list[0];
        return match ? String(match.id) : null;
      });
      setStatus("ready");
    } catch { setStatus("error"); }
  }, []);

  useEffect(() => { void reload(); }, [reload]);

  // Ids arrive as strings for bigint columns, so compare them as strings throughout.
  const select = useCallback((id: number | string) => {
    setSelectedId(String(id));
    writeStored(id);
    const url = new URL(window.location.href);
    url.searchParams.set("businessId", String(id));
    window.history.replaceState(null, "", url);
  }, []);

  const business = businesses.find(b => String(b.id) === selectedId) ?? null;
  useEffect(() => { if (business) writeStored(business.id); }, [business]);

  // The landing page and onboarding wizard are full-screen flows without app navigation.
  const bare = pathname === "/" || pathname.startsWith("/onboarding");
  const value = { status, businesses, business, select, reload };
  if (bare) return <BusinessContext.Provider value={value}>{children}</BusinessContext.Provider>;

  const current = (item: typeof nav[number]) => item.match.some(path => pathname.startsWith(path)) ? "page" : undefined;
  const brand = <Link href="/approval" className="pl-brand"><span className="pl-brand-mark"><Icon name="loop" strokeWidth={2.2} /></span>PraiseLoop</Link>;

  return (
    <BusinessContext.Provider value={value}>
      <div className="pl-shell">
        <aside className="pl-sidebar">
          {brand}
          {status === "ready" ? <BusinessSwitcher id="business-switcher" /> : null}
          {status === "ready" ? <Link href="/onboarding?new=1" className="pl-small" style={{ padding: "0 4px", fontWeight: 600, marginTop: -16 }}>+ Add a business</Link> : null}
          <nav aria-label="Main" className="pl-nav">
            {nav.map(item => <Link key={item.label} href={item.href} aria-current={current(item)}><Icon name={item.icon} />{item.label}</Link>)}
          </nav>
          <div className="pl-account">
            {status === "signed-out"
              ? <button type="button" className="pl-btn pl-btn-dark" onClick={() => signIn("google")}>Sign in with Google</button>
              : <button type="button" className="pl-link-button" onClick={() => signOut({ callbackUrl: "/" })}>Sign out</button>}
          </div>
        </aside>
        <header className="pl-topbar">
          {brand}
          {status === "signed-out"
            ? <button type="button" className="pl-btn pl-btn-dark" onClick={() => signIn("google")}>Sign in</button>
            : status === "ready" ? <BusinessSwitcher id="business-switcher-phone" withActions /> : null}
        </header>
        <main className="pl-main">
          <div className="pl-container">
            {status === "signed-out" ? (
              <div className="pl-empty">
                <h2>Sign in to see your posts</h2>
                <p className="pl-muted">Your businesses, reviews and drafts are private to your account.</p>
                <button type="button" className="pl-btn pl-btn-primary pl-btn-lg" onClick={() => signIn("google")}>Sign in with Google</button>
              </div>
            ) : status === "error" ? (
              <div className="pl-empty">
                <h2>We couldn’t load your account</h2>
                <p className="pl-muted">Check your connection and try again.</p>
                <button type="button" className="pl-btn" onClick={() => void reload()}>Try again</button>
              </div>
            ) : children}
          </div>
        </main>
        <nav aria-label="Main" className="pl-tabbar">
          {nav.map(item => <Link key={item.label} href={item.href} aria-current={current(item)}><Icon name={item.icon} size={22} />{item.label}</Link>)}
        </nav>
      </div>
    </BusinessContext.Provider>
  );
}
