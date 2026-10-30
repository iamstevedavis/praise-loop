"use client";
import { useEffect, useState } from "react";
import type { EntitlementsWithUsage } from "../../lib/planDisplay";

// Reads the server's plan and this week's usage; the app never recomputes limits.
// Returns null while loading or if the request fails, so callers fall back to
// their plain wording rather than blocking the page.
export function usePlan() {
  const [plan, setPlan] = useState<EntitlementsWithUsage | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let current = true;
    fetch("/api/entitlements")
      .then(async response => {
        if (!response.ok) throw new Error("plan unavailable");
        const data: EntitlementsWithUsage = await response.json();
        if (current) setPlan(data);
      })
      .catch(() => { if (current) setFailed(true); });
    return () => { current = false; };
  }, []);
  return { plan, failed };
}
