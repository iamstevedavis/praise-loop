// The phone has no setup flow yet (docs/mobile-plan.md). When the owner has no
// business, the queue is replaced by a short pointer to the web onboarding page
// instead of a dead end.
export type NoBusinessView = {
  heading: string;
  body: string;
  onboardingUrl: string | null;
};

export function noBusinessView(
  businesses: readonly { id: number }[] | null,
  apiBaseUrl: string
): NoBusinessView | null {
  if (!businesses || businesses.length > 0) return null;
  const base = apiBaseUrl.replace(/\/+$/, "");
  return {
    heading: "Set up your business on the web",
    body: "Add your business, colours and logo in the web app, then come back here to review this week’s posts. The web app signs in with Google or an email code, so if you signed in with Apple, first link Google under Profile, Sign-in methods, then sign in with that Google account on the web.",
    onboardingUrl: base.length > 0 ? `${base}/onboarding` : null
  };
}
