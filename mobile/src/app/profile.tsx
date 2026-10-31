import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Redirect, router } from "expo-router";
import { api } from "../api";
import { deleteAccount } from "../api/account";
import { ApiError, bestEffort } from "../api/client";
import { fetchEntitlements, type Entitlements } from "../api/entitlements";
import { linkGoogleMethod, listAuthMethods, unlinkAuthMethod, type AuthMethod } from "../api/methods";
import { fetchProfile, NAME_MAX_LENGTH, saveName, type Profile } from "../api/profile";
import { googleSignInAvailable, isGoogleSignInCancelled, signInWithGoogle } from "../auth/google";
import { useSession } from "../auth/SessionProvider";
import { appConfig } from "../config";
import {
  DELETE_ACCOUNT_SUBSCRIPTION_NOTE,
  DELETE_ACCOUNT_WARNING,
  confirmsDeletion,
  deletionErrorMessage
} from "../profile/accountDeletion";
import { canUnlinkMethod, displayName, initials, methodAdded, methodName, nameActionLabel, nameProblem } from "../profile/identity";
import { NotificationSettings } from "../notifications/NotificationSettings";
import { planLines, planUsageLines } from "../queue/planSummary";
import { Avatar, Banner, Button, Chip, Section } from "../ui/components";
import { colors } from "../ui/theme";

function message(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

// A 409 keeps the server's own words in `detail` (the client's message is generic),
// and a 400 already carries them as the message.
function methodFailure(error: unknown, fallback: string): string {
  if (error instanceof ApiError && error.detail) return error.detail;
  return message(error, fallback);
}

export default function ProfileScreen() {
  const { status, handleError, signOut } = useSession();
  const [profile, setProfile] = useState<Profile | null>(null);
  // Best effort, like the plan on the queue: a failed request must not hide the
  // rest of the screen, so it gets its own retry instead.
  const [plan, setPlan] = useState<Entitlements | null>(null);
  // The same treatment for the linked methods: their own load, error and retry.
  const [methods, setMethods] = useState<AuthMethod[] | null>(null);
  const [methodsError, setMethodsError] = useState<string | null>(null);
  const [methodsNotice, setMethodsNotice] = useState<string | null>(null);
  const [methodBusy, setMethodBusy] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [linking, setLinking] = useState(false);
  const [loading, setLoading] = useState(true);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [planError, setPlanError] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draftName, setDraftName] = useState("");
  const [saving, setSaving] = useState(false);
  // A ref, not the state: the keyboard Done key can fire twice before a re-render shows `saving`.
  const savingRef = useRef(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [signingOut, setSigningOut] = useState(false);
  const [deleteText, setDeleteText] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const deletingRef = useRef(false);

  // Pure fetches, so the effect below only sets state after its await. The
  // requests settle independently: a profile failure must not discard a plan or
  // method list that did load, and vice versa.
  const fetchAll = useCallback(async () => {
    const [loadedProfile, loadedPlan, loadedMethods] = await Promise.allSettled([
      fetchProfile(api),
      bestEffort(fetchEntitlements(api)),
      bestEffort(listAuthMethods(api))
    ]);
    return { loadedProfile, loadedPlan, loadedMethods };
  }, []);

  const applyLoaded = useCallback(({ loadedProfile, loadedPlan, loadedMethods }: Awaited<ReturnType<typeof fetchAll>>) => {
    if (loadedProfile.status === "fulfilled") {
      setProfile(loadedProfile.value);
      setProfileError(null);
    } else {
      // A 401 ends the session and returns to sign-in; anything else is retryable here.
      handleError(loadedProfile.reason);
      setProfileError("Couldn't load your profile. Check your connection and try again.");
    }
    if (loadedPlan.status === "fulfilled") {
      setPlan(loadedPlan.value);
      setPlanError(!loadedPlan.value);
    } else {
      handleError(loadedPlan.reason);
      setPlanError(true);
    }
    if (loadedMethods.status === "fulfilled") {
      setMethods(loadedMethods.value);
      setMethodsError(loadedMethods.value ? null : "Couldn't load your sign-in methods.");
    } else {
      handleError(loadedMethods.reason);
      setMethodsError("Couldn't load your sign-in methods.");
    }
    setLoading(false);
  }, [handleError]);

  useEffect(() => {
    if (status !== "signedIn") return;
    let cancelled = false;
    void (async () => {
      const loaded = await fetchAll();
      if (!cancelled) applyLoaded(loaded);
    })();
    return () => { cancelled = true; };
  }, [applyLoaded, fetchAll, status]);

  // Retries are owner actions, not effects, so the spinner is turned on here.
  const retry = useCallback(() => {
    setLoading(true);
    setPlanError(false);
    setMethodsError(null);
    void (async () => {
      applyLoaded(await fetchAll());
    })();
  }, [applyLoaded, fetchAll]);

  const startEditing = useCallback(() => {
    setDraftName(displayName(profile) ?? "");
    setFormError(null);
    setNotice(null);
    setEditing(true);
  }, [profile]);

  const save = useCallback(async () => {
    if (savingRef.current) return;
    const problem = nameProblem(draftName);
    if (problem) {
      setFormError(problem);
      return;
    }
    savingRef.current = true;
    setSaving(true);
    setFormError(null);
    try {
      setProfile(await saveName(api, draftName));
      setEditing(false);
      setNotice("Your name is saved.");
    } catch (cause) {
      handleError(cause);
      setFormError(message(cause, "Couldn't save your name. Try again."));
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }, [draftName, handleError]);

  const unlink = useCallback(async (provider: string) => {
    if (methodBusy) return;
    setMethodBusy(provider);
    setMethodsError(null);
    setMethodsNotice(null);
    try {
      // The response is the whole remaining list, so the screen never guesses.
      setMethods(await unlinkAuthMethod(api, provider));
      setMethodsNotice(`${methodName(provider)} unlinked.`);
    } catch (cause) {
      handleError(cause);
      setMethodsError(methodFailure(cause, "Couldn't unlink that method. Try again."));
    } finally {
      setMethodBusy(null);
      setConfirming(null);
    }
  }, [handleError, methodBusy]);

  const linkGoogle = useCallback(async () => {
    if (linking) return;
    setLinking(true);
    setMethodsError(null);
    setMethodsNotice(null);
    try {
      // The token is only passed to the server: never stored or logged here.
      const idToken = await signInWithGoogle();
      setMethods(await linkGoogleMethod(api, idToken));
      setMethodsNotice("Google linked.");
    } catch (cause) {
      // Closing the Google sheet is a quiet no-op, as on sign-in.
      if (isGoogleSignInCancelled(cause)) return;
      handleError(cause);
      setMethodsError(methodFailure(cause, "Couldn't link Google. Try again."));
    } finally {
      setLinking(false);
    }
  }, [handleError, linking]);

  const leave = useCallback(async () => {
    setSigningOut(true);
    try {
      await signOut();
    } finally {
      setSigningOut(false);
    }
  }, [signOut]);

  const removeAccount = useCallback(async () => {
    if (!confirmsDeletion(deleteText) || deletingRef.current) return;
    deletingRef.current = true;
    setDeleting(true);
    setDeleteError(null);
    try {
      await deleteAccount(api);
      // The server deleted this session with the account. The normal sign-out
      // still clears the keychain and ignores the now-401 revoke call.
      await signOut();
    } catch (cause) {
      const problem = deletionErrorMessage(cause);
      if (problem === null) handleError(cause);
      else setDeleteError(problem);
    } finally {
      deletingRef.current = false;
      setDeleting(false);
    }
  }, [deleteText, handleError, signOut]);

  if (status === "signedOut") return <Redirect href="/sign-in" />;

  const name = displayName(profile);
  const googleReady = googleSignInAvailable();

  return (
    <SafeAreaView style={styles.screen} edges={["top", "left", "right", "bottom"]}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back to the queue"
          onPress={() => (router.canGoBack() ? router.back() : router.replace("/queue"))}
          style={styles.back}
        >
          <Text style={styles.backText}>‹ Queue</Text>
        </Pressable>
        <Text style={styles.title}>Profile</Text>

        <View style={styles.identity}>
          <Avatar
            initials={initials(profile)}
            size="large"
            accessibilityLabel={name ? `Change the name for ${name}` : "Add your name"}
            onPress={startEditing}
          />
          <View style={styles.identityText}>
            <Text style={styles.identityName}>{name ?? "No name yet"}</Text>
            <Text style={styles.identityEmail}>{profile?.email ?? " "}</Text>
          </View>
        </View>

        {notice ? <Banner message={notice} tone="success" /> : null}

        <Section title="Account">
          {profile ? (
            <>
              <View style={styles.row}>
                <View style={styles.rowText}>
                  <Text style={styles.rowLabel}>Name</Text>
                  <Text style={styles.rowValue}>{name ?? "Not set"}</Text>
                </View>
                {!editing ? <Button label={nameActionLabel(profile)} kind="secondary" onPress={startEditing} /> : null}
              </View>

              {editing ? (
                <View style={styles.form}>
                  <TextInput
                    value={draftName}
                    onChangeText={value => { setDraftName(value); setFormError(null); }}
                    placeholder="Your name"
                    accessibilityLabel="Your name"
                    autoCapitalize="words"
                    autoCorrect={false}
                    maxLength={NAME_MAX_LENGTH + 20}
                    returnKeyType="done"
                    editable={!saving}
                    onSubmitEditing={() => { void save(); }}
                    style={styles.input}
                  />
                  <Text style={styles.hint}>
                    1 to {NAME_MAX_LENGTH} characters. Only your name changes — the email is the one your sign-in provider verified.
                  </Text>
                  {formError ? <Banner message={formError} tone="danger" /> : null}
                  <View style={styles.formActions}>
                    <Button label="Save name" onPress={() => { void save(); }} loading={saving} />
                    <Button
                      label="Cancel"
                      kind="secondary"
                      disabled={saving}
                      onPress={() => { setEditing(false); setFormError(null); }}
                    />
                  </View>
                </View>
              ) : null}

              <View style={styles.row}>
                <View style={styles.rowText}>
                  <Text style={styles.rowLabel}>Email</Text>
                  <Text style={styles.rowValue}>{profile.email ?? "Not available"}</Text>
                </View>
                <Chip label="Read-only" />
              </View>
              {profile.nameSource === "owner" ? (
                <Text style={styles.hint}>Your sign-in provider will not overwrite the name you set here.</Text>
              ) : null}
            </>
          ) : loading ? (
            <ActivityIndicator />
          ) : (
            <View style={styles.form}>
              <Banner message={profileError ?? "Couldn't load your profile."} tone="danger" />
              <Button label="Try again" onPress={retry} />
            </View>
          )}
        </Section>

        <Section title="Sign-in methods" hint="These are the ways you can get into your account. Keep at least one so you can sign in again.">
          {methodsNotice ? <Banner message={methodsNotice} tone="success" /> : null}
          {methodsError && methods ? <Banner message={methodsError} tone="danger" /> : null}
          {methods ? (
            <>
              {methods.map((method, index) => (
                <View key={`${method.provider}-${index}`} style={styles.method}>
                  <View style={styles.row}>
                    <View style={styles.rowText}>
                      <Text style={styles.methodName}>{methodName(method.provider)}</Text>
                      <Text style={styles.hint}>{method.email ?? "No email on this method"}</Text>
                      <Text style={styles.hint}>{methodAdded(method.addedAt)}</Text>
                    </View>
                    {confirming === method.provider ? null : (
                      <Button
                        label="Unlink"
                        kind="secondary"
                        disabled={!canUnlinkMethod(methods) || methodBusy !== null || linking}
                        loading={methodBusy === method.provider}
                        onPress={() => {
                          setMethodsError(null);
                          setMethodsNotice(null);
                          setConfirming(method.provider);
                        }}
                      />
                    )}
                  </View>
                  {confirming === method.provider ? (
                    <View style={styles.form}>
                      <Banner message={`Unlink ${methodName(method.provider)}? You can add it again later.`} tone="warning" />
                      <View style={styles.formActions}>
                        <Button
                          label="Yes, unlink"
                          kind="danger"
                          loading={methodBusy === method.provider}
                          onPress={() => { void unlink(method.provider); }}
                        />
                        <Button label="Cancel" kind="secondary" disabled={methodBusy !== null} onPress={() => setConfirming(null)} />
                      </View>
                    </View>
                  ) : null}
                </View>
              ))}
              {methods.length === 0 ? <Text style={styles.body}>No sign-in method is linked yet.</Text> : null}
              {googleReady && !methods.some(method => method.provider === "google") ? (
                <Button
                  label="Link Google"
                  kind="secondary"
                  loading={linking}
                  disabled={methodBusy !== null}
                  onPress={() => { void linkGoogle(); }}
                />
              ) : null}
              {methods.length === 1 ? (
                <Text style={styles.hint}>You can’t unlink your only method. Add another method first.</Text>
              ) : null}
            </>
          ) : methodsError ? (
            <View style={styles.form}>
              <Banner message={methodsError} tone="danger" />
              <Button label="Try again" kind="secondary" onPress={retry} />
            </View>
          ) : (
            <ActivityIndicator />
          )}
        </Section>

        <Section title="Your plan" hint="Plans are changed on the web app.">
          {plan ? (
            <>
              {planLines(plan, null).map(line => <Text key={line} style={styles.body}>{line}</Text>)}
              {planUsageLines(plan).map(line => <Text key={line} style={styles.body}>{line}</Text>)}
            </>
          ) : planError ? (
            <View style={styles.form}>
              <Banner message="Couldn't load your plan." tone="warning" />
              <Button label="Try again" kind="secondary" onPress={retry} />
            </View>
          ) : (
            <ActivityIndicator />
          )}
        </Section>

        <NotificationSettings />

        <Section title="This app">
          <Text style={styles.body}>Version {appConfig.version} ({appConfig.variant})</Text>
          <Text style={styles.body}>Server: {appConfig.apiBaseUrl || "not configured"}</Text>
        </Section>

        <Section title="Delete account">
          <Text style={styles.body}>{DELETE_ACCOUNT_WARNING}</Text>
          <Text style={styles.hint}>{DELETE_ACCOUNT_SUBSCRIPTION_NOTE}</Text>
          <TextInput
            value={deleteText}
            onChangeText={value => { setDeleteText(value); setDeleteError(null); }}
            placeholder="Type DELETE to confirm"
            accessibilityLabel="Type DELETE to confirm account deletion"
            autoCapitalize="characters"
            autoCorrect={false}
            maxLength={40}
            editable={!deleting}
            style={styles.input}
          />
          {deleteError ? <Banner message={deleteError} tone="danger" /> : null}
          <Button
            label="Delete account"
            kind="danger"
            disabled={!confirmsDeletion(deleteText)}
            loading={deleting}
            onPress={() => { void removeAccount(); }}
          />
          <Text style={styles.hint}>This signs you out of the app. The account cannot be restored.</Text>
        </Section>

        <View style={styles.footer}>
          <Button label="Sign out" kind="danger" onPress={() => { void leave(); }} loading={signingOut} />
          <Text style={styles.hint}>Signing out ends this session on the server and clears the stored token.</Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { padding: 20, paddingBottom: 48, gap: 12 },
  back: { alignSelf: "flex-start", paddingVertical: 4, paddingRight: 12 },
  backText: { fontSize: 16, fontWeight: "600", color: colors.accent },
  title: { fontSize: 28, lineHeight: 34, fontWeight: "700", color: colors.ink },
  identity: { flexDirection: "row", alignItems: "center", gap: 14, marginTop: 4 },
  identityText: { flex: 1, gap: 2 },
  identityName: { fontSize: 20, fontWeight: "700", color: colors.ink },
  identityEmail: { fontSize: 14, color: colors.muted },
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12, paddingVertical: 6 },
  rowText: { flex: 1, gap: 2 },
  rowLabel: { fontSize: 12, fontWeight: "700", letterSpacing: 1, textTransform: "uppercase", color: colors.faint },
  rowValue: { fontSize: 15, color: colors.ink },
  method: { gap: 8, paddingVertical: 6 },
  methodName: { fontSize: 15, fontWeight: "700", color: colors.ink },
  form: { gap: 10 },
  input: {
    minHeight: 48,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 16,
    color: colors.ink
  },
  formActions: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  hint: { fontSize: 13, lineHeight: 18, color: colors.muted },
  body: { fontSize: 14, lineHeight: 20, color: colors.ink },
  footer: { gap: 10, marginTop: 26 }
});
