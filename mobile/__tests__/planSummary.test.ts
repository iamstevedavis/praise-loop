import type { Entitlements, WeeklyUsage } from "../src/api/entitlements";
import { expiryNote, planLines, quotaMetMessage, usageFor } from "../src/queue/planSummary";

const free = { postsPerWeek: 1, templates: 1, watermark: true, reviewSync: false, aiReplies: false, businesses: 1 };
const pro = { postsPerWeek: 5, templates: 5, watermark: false, reviewSync: true, aiReplies: true, businesses: 3 };
const usage = (overrides: Partial<WeeklyUsage> = {}): WeeklyUsage => ({
  businessId: 1, name: "Cafe", timezone: "America/Toronto", resetsOn: "2026-11-02", allocated: 0, target: 1, weeklyTarget: 3, quotaMet: false, ...overrides
});
const plan = (overrides: Partial<Entitlements> = {}): Entitlements => ({ plan: "free", source: "default", expiresAt: null, limits: free, usage: [usage()], ...overrides });
const now = new Date("2026-10-29T12:00:00Z");

describe("plan summary", () => {
  it("finds the usage for the selected business only", () => {
    expect(usageFor(plan(), 1)?.name).toBe("Cafe");
    expect(usageFor(plan(), 2)).toBeNull();
    expect(usageFor(null, 1)).toBeNull();
  });

  it("stays quiet while there is room in the week", () => {
    expect(quotaMetMessage(plan(), usage())).toBeNull();
  });

  it("names the Free limit when the quota is met", () => {
    expect(quotaMetMessage(plan(), usage({ allocated: 1, quotaMet: true }))).toBe(
      "You’ve reached this week’s limit: the Free plan includes 1 post a week for each business."
    );
  });

  it("names the Pro allowance when the owner's own target is met", () => {
    const message = quotaMetMessage(plan({ plan: "pro", limits: pro }), usage({ allocated: 3, target: 3, quotaMet: true }));
    expect(message).toBe("You’ve made all 3 posts you asked for this week. The Pro plan allows up to 5 a week.");
  });

  it("explains an expired Pro plan as Free", () => {
    const expired = plan({ expiresAt: "2026-01-01T00:00:00.000Z" });
    expect(expiryNote(expired, now)).toBe("Your Pro plan expired on 2026-01-01, so you are on the Free plan.");
    expect(expiryNote(plan({ plan: "pro", limits: pro, source: "manual", expiresAt: "2027-01-01T00:00:00.000Z" }), now)).toBe("Your Pro plan runs until 2027-01-01.");
    expect(expiryNote(plan(), now)).toBeNull();
  });

  it("lists limits and this week's usage", () => {
    const lines = planLines(plan({ plan: "pro", limits: pro }), usage({ allocated: 2, target: 5 }), now);
    expect(lines[0]).toBe("Pro plan");
    expect(lines).toContain("2 of 5 posts this week, resets 2026-11-02 (America/Toronto)");
    expect(lines[2]).toContain("Watermark: no");
  });
});
