export type BusinessSelection = {
  businessId: number | null;
  appliedLink: number | null;
};

// A notification link selects its business once. Later list reloads (focus,
// pull-to-refresh) keep the owner's own chip choice; a different link applies
// again, and a link to a business the owner does not have is ignored.
export function selectBusinessId(input: {
  linked: number | null;
  appliedLink: number | null;
  current: number | null;
  businesses: readonly { id: number }[];
}): BusinessSelection {
  const linked = input.linked !== null && input.businesses.some(item => item.id === input.linked)
    ? input.linked
    : null;
  if (linked !== null && linked !== input.appliedLink) {
    return { businessId: linked, appliedLink: linked };
  }
  return {
    businessId: input.current ?? input.businesses[0]?.id ?? null,
    appliedLink: input.appliedLink
  };
}
