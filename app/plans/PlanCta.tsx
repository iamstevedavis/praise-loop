"use client";
import { signIn } from "next-auth/react";

// The plans page is public, so the call to action signs in with Google rather
// than linking to an owner-only screen. Nothing here starts a checkout.
export default function PlanCta({ label }: { label: string }) {
  return (
    <button type="button" className="pl-btn pl-btn-primary pl-btn-lg" onClick={() => signIn("google", { callbackUrl: "/approval" })}>
      {label}
    </button>
  );
}
