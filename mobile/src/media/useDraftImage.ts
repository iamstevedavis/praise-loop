import { useCallback, useEffect, useState } from "react";
import { useSession } from "../auth/SessionProvider";
import { draftImageLoader } from "./draftImage";

export type DraftImageState =
  | { status: "loading" }
  | { status: "ready"; uri: string }
  | { status: "error" };

type LoadResult =
  | { key: string; status: "ready"; uri: string }
  | { key: string; status: "error" };

// React Native's core Image drops the `headers` option in some Expo Go builds,
// so the owner-protected PNG is downloaded with the bearer token first and the
// local file URI is rendered instead.
export function useDraftImage(imagePath: string | null): { state: DraftImageState; retry: () => void } {
  const { token, handleError } = useSession();
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<LoadResult | null>(null);

  // Keying the result means a new image or a retry reads as loading without
  // setting state synchronously inside the effect.
  const key = `${imagePath ?? ""}\n${token ?? ""}\n${attempt}`;

  useEffect(() => {
    if (!imagePath || !token) return;
    let cancelled = false;
    void draftImageLoader
      .load(token, imagePath)
      .then(uri => {
        if (!cancelled) setResult({ key, status: "ready", uri });
      })
      .catch(error => {
        if (cancelled) return;
        setResult({ key, status: "error" });
        // A 401 clears the keychain and returns the app to sign-in instead of
        // leaving an unexplained placeholder behind.
        handleError(error);
      });
    return () => {
      cancelled = true;
    };
  }, [handleError, imagePath, key, token]);

  const retry = useCallback(() => setAttempt(current => current + 1), []);
  const state = result?.key === key ? result : { status: "loading" as const };
  return { state, retry };
}
