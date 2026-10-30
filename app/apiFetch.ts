"use client";
import { signOut } from "next-auth/react";
import { createApiFetch } from "../lib/sessionExpiry";

// Every page calls our own API through this instead of fetch, so an expired or
// revoked session ends in the sign-in page whichever screen the owner was on.
// The decision logic lives in lib/sessionExpiry.ts.
export const apiFetch = createApiFetch({
  fetchImpl: (input, init) => fetch(input, init),
  signOut: () => signOut({ redirect: false }),
  location: () => ({ pathname: window.location.pathname, search: window.location.search }),
  // A full load so the shell forgets the old session instead of reusing its state.
  navigate: to => window.location.assign(to)
});
