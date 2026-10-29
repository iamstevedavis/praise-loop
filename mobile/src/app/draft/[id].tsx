import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Image, Modal, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import * as Clipboard from "expo-clipboard";
import * as Sharing from "expo-sharing";
import { SafeAreaView } from "react-native-safe-area-context";
import { Redirect, router, useLocalSearchParams } from "expo-router";
import { api } from "../../api";
import { ApiError } from "../../api/client";
import { captionProblem, listDrafts, saveCaption, setDraftStatus, type Draft } from "../../api/drafts";
import { useSession } from "../../auth/SessionProvider";
import { appConfig } from "../../config";
import { discardDraftImage, downloadDraftImage, absoluteMediaUrl } from "../../posting/media";
import { confirmShared, declineShared, prepareShare, SHARED_HINT, type ShareDeps, type ShareState } from "../../posting/shareFlow";
import { Banner, Button, Chip } from "../../ui/components";
import { colors } from "../../ui/theme";

function message(error: unknown, fallback: string): string {
  if (error instanceof ApiError) {
    if (error.kind === "conflict") return "This post changed somewhere else. Reload and try again.";
    if (error.kind === "limit") return "You've reached today's limit. Try again tomorrow.";
    return error.message;
  }
  return fallback;
}

// Mutation responses are the bare draft_posts row, not the joined list shape, so
// normalizeDraft fills the review and job columns with null. Keep the values the
// screen already showed instead of replacing the author and rating with null.
function mergeDraft(previous: Draft | null, updated: Draft): Draft {
  if (!previous) return updated;
  return {
    ...previous,
    ...updated,
    rating: previous.rating,
    author_name: previous.author_name,
    reviewed_at: previous.reviewed_at,
    source: previous.source,
    job_state: previous.job_state,
    error_code: previous.error_code,
    provider_state: previous.provider_state
  };
}

export default function DraftScreen() {
  const params = useLocalSearchParams<{ id?: string; businessId?: string }>();
  const draftId = Number(params.id);
  const businessId = Number(params.businessId);
  const { status, token, handleError, expire } = useSession();

  const [draft, setDraft] = useState<Draft | null>(null);
  const [caption, setCaption] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<"caption" | "approve" | "archive" | null>(null);
  const [notice, setNotice] = useState<{ tone: "success" | "warning" | "danger"; message: string } | null>(null);
  const [share, setShare] = useState<ShareState>({ step: "idle" });

  const fetchDraft = useCallback(async () => {
    const drafts = await listDrafts(api, businessId);
    return drafts.find(item => item.id === draftId) ?? null;
  }, [businessId, draftId]);

  const applyFetched = useCallback((found: Draft | null) => {
    setDraft(found);
    setCaption(found?.caption_text ?? "");
    setLoading(false);
    setNotice(found ? null : { tone: "danger", message: "This post is no longer in the queue." });
  }, []);

  useEffect(() => {
    // A cold-start deep link mounts this screen before the keychain token is
    // restored; an early request would go out unauthenticated and its 401 would
    // sign out an owner who is actually signed in.
    if (status !== "signedIn") return;
    let cancelled = false;
    void (async () => {
      try {
        const found = await fetchDraft();
        if (!cancelled) applyFetched(found);
      } catch (error) {
        if (cancelled) return;
        handleError(error);
        setLoading(false);
        setNotice({ tone: "danger", message: message(error, "Couldn't load this post.") });
      }
    })();
    return () => { cancelled = true; };
  }, [applyFetched, fetchDraft, handleError, status]);

  const reload = useCallback(async () => {
    // A reload started during a mutation can finish later and overwrite the
    // mutation's response with the older caption, status and version.
    if (busy) return;
    setLoading(true);
    try {
      applyFetched(await fetchDraft());
    } catch (error) {
      handleError(error);
      setLoading(false);
      setNotice({ tone: "danger", message: message(error, "Couldn't load this post.") });
    }
  }, [applyFetched, busy, fetchDraft, handleError]);

  const applyUpdate = useCallback((updated: Draft, success: string) => {
    setDraft(previous => mergeDraft(previous, updated));
    setCaption(updated.caption_text);
    setNotice({ tone: "success", message: success });
  }, []);

  const save = useCallback(async () => {
    if (!draft) return;
    const problem = captionProblem(caption);
    if (problem) {
      setNotice({ tone: "warning", message: problem });
      return;
    }
    setBusy("caption");
    setNotice(null);
    try {
      const updated = await saveCaption(api, draft, caption);
      applyUpdate(updated, "Caption saved.");
    } catch (error) {
      handleError(error);
      setNotice({ tone: "danger", message: message(error, "Couldn't save the caption.") });
    } finally {
      setBusy(null);
    }
  }, [applyUpdate, caption, draft, handleError]);

  const changeStatus = useCallback(async (next: "approved" | "archived") => {
    if (!draft) return;
    setBusy(next === "approved" ? "approve" : "archive");
    setNotice(null);
    try {
      let current = draft;
      // Approval acts on the persisted caption. Save a pending edit first, or the
      // owner sees "approved" and their text is silently replaced by the old one.
      if (next === "approved" && caption.trim() !== draft.caption_text.trim()) {
        const problem = captionProblem(caption);
        if (problem) {
          setNotice({ tone: "warning", message: problem });
          return;
        }
        current = await saveCaption(api, draft, caption);
        setDraft(previous => mergeDraft(previous, current));
        setCaption(current.caption_text);
      }
      const updated = await setDraftStatus(api, current, next);
      applyUpdate(updated, next === "approved" ? "Approved. Post it whenever you're ready." : "Archived. It won't be posted.");
    } catch (error) {
      handleError(error);
      setNotice({ tone: "danger", message: message(error, "Couldn't update this post.") });
    } finally {
      setBusy(null);
    }
  }, [applyUpdate, caption, draft, handleError]);

  const shareDeps = useCallback((): ShareDeps => ({
    canShare: () => Sharing.isAvailableAsync(),
    downloadImage: item => downloadDraftImage({ token: token ?? "", draftId: item.id, imagePath: item.image_path ?? "" }),
    copyCaption: async text => { await Clipboard.setStringAsync(text); },
    openShareSheet: uri => Sharing.shareAsync(uri, { mimeType: "image/png", dialogTitle: "Share this post" }),
    markShared: item => setDraftStatus(api, item, "shared"),
    discardImage: discardDraftImage
  }), [token]);

  const post = useCallback(async () => {
    if (!draft) return;
    if (caption.trim() !== draft.caption_text.trim()) {
      setNotice({ tone: "warning", message: "Save your caption changes, then approve this post again before sharing." });
      return;
    }
    setNotice(null);
    setShare({ step: "preparing" });
    const next = await prepareShare(draft, shareDeps());
    if (next.step === "error") {
      // There is no modal for preparation failures, so surface them in the banner
      // instead of dropping back to an unexplained idle button.
      setNotice({ tone: "danger", message: next.message });
      setShare({ step: "idle" });
      return;
    }
    setShare(next);
  }, [draft, shareDeps]);

  const confirmPost = useCallback(async () => {
    if (share.step !== "confirm") return;
    setShare({ step: "saving", draft: share.draft });
    const next = await confirmShared(share, shareDeps());
    setShare(next);
    if (next.step === "done") applyUpdate(next.draft, "Marked as shared. Thanks for posting.");
    if (next.step === "error") {
      setNotice({ tone: "danger", message: next.message });
      if (next.reason === "signedOut") expire();
    }
  }, [applyUpdate, expire, share, shareDeps]);

  if (status === "signedOut") return <Redirect href="/sign-in" />;

  if (loading) {
    return (
      <SafeAreaView style={styles.screen} edges={["top", "left", "right"]}>
        <ActivityIndicator style={styles.loading} />
      </SafeAreaView>
    );
  }

  if (!draft) {
    return (
      <SafeAreaView style={styles.screen} edges={["top", "left", "right"]}>
        <View style={styles.content}>
          <Banner message={notice?.message ?? "This post is unavailable."} tone="danger" />
          <Button label="Back to the queue" kind="secondary" onPress={() => router.back()} />
        </View>
      </SafeAreaView>
    );
  }

  const readOnly = draft.status === "shared" || draft.status === "archived" || draft.status === "scheduled" || draft.status === "published";
  // A mutation always answers with the server's caption, so the editor must not
  // accept text that the pending response would overwrite.
  const locked = readOnly || busy !== null || share.step !== "idle";
  const problem = captionProblem(caption);
  const canApprove = draft.status === "draft" && !problem && !!draft.image_path;
  const preparing = share.step === "preparing";
  // Sharing copies the persisted caption. Saving an edit resets an approved post
  // to draft, so pending edits must be saved and re-approved before posting.
  const captionDirty = caption.trim() !== draft.caption_text.trim();

  return (
    <SafeAreaView style={styles.screen} edges={["top", "left", "right"]}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.header}>
          <Button label="Back" kind="secondary" onPress={() => router.back()} />
          <View style={styles.headerRight}>
            <Button label="Reload" kind="secondary" onPress={() => { void reload(); }} loading={loading} disabled={!!busy} />
            <Chip label={draft.status === "draft" ? "Needs approval" : draft.status === "shared" ? "Shared by you" : draft.status} tone={draft.status === "approved" ? "success" : draft.status === "draft" ? "warning" : "neutral"} />
          </View>
        </View>

        {notice ? <Banner message={notice.message} tone={notice.tone} /> : null}

        {draft.image_path && token ? (
          <Image
            source={{ uri: absoluteMediaUrl(appConfig.apiBaseUrl, draft.image_path), headers: { authorization: `Bearer ${token}` } }}
            style={styles.image}
            accessibilityIgnoresInvertColors
          />
        ) : null}

        <Text style={styles.quote}>“{draft.quote_text}”</Text>
        <Text style={styles.meta}>
          {draft.author_name ?? "Reviewer"}{draft.rating ? ` · ${"★".repeat(draft.rating)}${"☆".repeat(5 - draft.rating)}` : ""}
        </Text>

        <Text style={styles.label}>Caption</Text>
        <TextInput
          style={[styles.input, locked && styles.inputReadOnly]}
          value={caption}
          onChangeText={setCaption}
          editable={!locked}
          multiline
          autoCapitalize="sentences"
          accessibilityLabel="Caption"
          placeholder="Write the caption the owner will paste"
        />
        <Text style={[styles.counter, (caption.trim().length > 200) && styles.counterOver]}>{caption.trim().length}/200</Text>

        {readOnly ? (
          <Banner
            message={draft.status === "shared"
              ? "This post was marked as shared from your phone, so it is read-only. It is owner-reported, never verified as published."
              : draft.status === "archived"
                ? "Archived posts are read-only here. Bring this post back on the web app to edit it."
                : "Scheduled posts are managed on the web app, so they are read-only here."}
          />
        ) : (
          <View style={styles.actions}>
            <Button label="Save caption" onPress={() => { void save(); }} loading={busy === "caption"} disabled={readOnly || !!busy} />
            {draft.status === "draft" ? (
              <>
                <Button label="Approve" onPress={() => { void changeStatus("approved"); }} loading={busy === "approve"} disabled={!canApprove || !!busy} />
                {!canApprove ? <Text style={styles.hint}>{problem ?? "A post needs an image before it can be approved."}</Text> : null}
              </>
            ) : null}
            {draft.status === "approved" ? (
              <>
                <Button label={preparing ? "Preparing…" : "Post"} onPress={() => { void post(); }} loading={preparing} disabled={captionDirty} />
                {captionDirty ? <Text style={styles.hint}>Save your caption changes, then approve this post again before sharing it.</Text> : null}
              </>
            ) : null}
            <Button label="Archive" kind="secondary" onPress={() => { void changeStatus("archived"); }} loading={busy === "archive"} disabled={!!busy} />
          </View>
        )}
      </ScrollView>

      <Modal visible={share.step === "confirm" || share.step === "saving"} transparent animationType="fade" onRequestClose={() => setShare(declineShared())}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Did you post it?</Text>
            <Text style={styles.modalBody}>{SHARED_HINT}. We only record what you tell us; nothing is detected automatically.</Text>
            <Button label="Yes, mark as shared" onPress={() => { void confirmPost(); }} loading={share.step === "saving"} />
            <Button label="Not yet" kind="secondary" onPress={() => setShare(declineShared())} />
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { padding: 20, paddingBottom: 48, gap: 12 },
  loading: { marginTop: 40 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
  headerRight: { flexDirection: "row", alignItems: "center", gap: 8 },
  image: { width: "100%", aspectRatio: 1, borderRadius: 18, backgroundColor: colors.line },
  quote: { fontSize: 22, lineHeight: 29, fontWeight: "600", color: colors.ink },
  meta: { fontSize: 14, color: colors.muted },
  label: { fontSize: 13, fontWeight: "700", letterSpacing: 1, textTransform: "uppercase", color: colors.muted, marginTop: 6 },
  input: { minHeight: 96, borderRadius: 14, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface, padding: 14, fontSize: 16, lineHeight: 22, color: colors.ink, textAlignVertical: "top" },
  inputReadOnly: { backgroundColor: "#f1eee8", color: colors.muted },
  counter: { alignSelf: "flex-end", fontSize: 12, color: colors.faint, marginTop: -6 },
  counterOver: { color: colors.danger },
  actions: { gap: 10, marginTop: 6 },
  hint: { fontSize: 13, lineHeight: 18, color: colors.muted },
  modalBackdrop: { flex: 1, justifyContent: "center", padding: 24, backgroundColor: "rgba(18,40,58,0.45)" },
  modalCard: { gap: 12, borderRadius: 20, padding: 22, backgroundColor: colors.surface },
  modalTitle: { fontSize: 22, fontWeight: "700", color: colors.ink },
  modalBody: { fontSize: 15, lineHeight: 21, color: colors.muted }
});
