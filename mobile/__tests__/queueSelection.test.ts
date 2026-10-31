import { selectBusinessId } from "../src/queue/selection";

const businesses = [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }];

describe("queue business selection", () => {
  it("applies a notification link once", () => {
    expect(selectBusinessId({ linked: 3, appliedLink: null, current: 1, businesses }))
      .toEqual({ businessId: 3, appliedLink: 3 });
  });

  it("keeps the owner's choice when a refresh still carries the applied link", () => {
    expect(selectBusinessId({ linked: 3, appliedLink: 3, current: 2, businesses }))
      .toEqual({ businessId: 2, appliedLink: 3 });
  });

  it("applies a different link again", () => {
    expect(selectBusinessId({ linked: 4, appliedLink: 3, current: 2, businesses }))
      .toEqual({ businessId: 4, appliedLink: 4 });
  });

  it("ignores a link to a business the owner does not have", () => {
    expect(selectBusinessId({ linked: 99, appliedLink: 3, current: 2, businesses }))
      .toEqual({ businessId: 2, appliedLink: 3 });
    expect(selectBusinessId({ linked: 99, appliedLink: null, current: null, businesses }))
      .toEqual({ businessId: 1, appliedLink: null });
  });
});
