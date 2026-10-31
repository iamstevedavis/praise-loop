import { noBusinessView } from "../src/queue/onboarding";

describe("no-business screen", () => {
  it("stays hidden while the list is loading or has a business", () => {
    expect(noBusinessView(null, "http://localhost:3000")).toBeNull();
    expect(noBusinessView([{ id: 1 }], "http://localhost:3000")).toBeNull();
  });

  it("points an owner with no business at web onboarding", () => {
    const view = noBusinessView([], "http://localhost:3000");
    expect(view).not.toBeNull();
    expect(view?.heading).toMatch(/web/i);
    expect(view?.body).toMatch(/web app/i);
    expect(view?.onboardingUrl).toBe("http://localhost:3000/onboarding");
  });

  it("trims a trailing slash and hides the link when the API URL is empty", () => {
    expect(noBusinessView([], "http://localhost:3000/")?.onboardingUrl).toBe("http://localhost:3000/onboarding");
    expect(noBusinessView([], "")?.onboardingUrl).toBeNull();
  });
});
