import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { createNote } from "../dash/createNote";
import { deleteNote } from "../dash/deleteNote";
import { getNote, listMyNotes, type NoteRecord } from "../dash/queries";
import type { DashEncryptionKeyMaterial } from "../dash/types";
import { updateNote } from "../dash/updateNote";
import { DeleteNoteModal } from "./DeleteNoteModal";
import { useMediaQuery } from "../hooks/useMediaQuery";
import {
  createDecryptedNotePayloadCache,
  isEncryptedNoteEnvelopeString,
  noteDisplayFallback,
  resolveCachedNoteForDisplay,
  resolveNoteForDisplay,
  resolveNotesForDisplay,
  type DisplayNoteRecord,
} from "../lib/encryptedNotes";
import { byteLength, FIELD_BYTE_LIMIT } from "../lib/fieldLimits";
import { errorMessage, normalizeLogOptions, type Logger } from "../lib/logger";
import {
  BACKGROUND_REFRESH_MS,
  FOCUS_REFRESH_MIN_MS,
  loadCachedNotes,
  notesEqualByRevision,
  saveCachedNotes,
} from "../lib/notesCache";
import { useSession } from "../session/useSession";
import { NoteEditor } from "./NoteEditor";
import { NoteList } from "./NoteList";

const NETWORK = "testnet" as const;
const STALE_EDIT_WARNING =
  "This note changed on the network. Your unsaved edits are still here — saving will overwrite the newer version.";

type SelectedNoteId = string | "new" | null;

function editableNoteTitle(note: DisplayNoteRecord | null): string {
  if (
    !note ||
    note.encryptionState === "locked" ||
    note.encryptionState === "invalid"
  ) {
    return "";
  }
  return note.title ?? "";
}

function editableNoteMessage(note: DisplayNoteRecord | null): string {
  if (
    !note ||
    note.encryptionState === "locked" ||
    note.encryptionState === "invalid"
  ) {
    return "";
  }
  return note.message ?? "";
}

function cachedOrFallbackDisplayNote({
  note,
  contractId,
  encryptionKeyMaterial,
  decryptedPayloadCache,
}: {
  note: NoteRecord;
  contractId: string | null;
  encryptionKeyMaterial: DashEncryptionKeyMaterial | null;
  decryptedPayloadCache: ReturnType<typeof createDecryptedNotePayloadCache>;
}): DisplayNoteRecord {
  if (!contractId) return noteDisplayFallback(note);
  return (
    resolveCachedNoteForDisplay(note, {
      network: NETWORK,
      contractId,
      encryptionKeyMaterial,
      decryptedPayloadCache,
    }) ?? noteDisplayFallback(note)
  );
}

// Wrap the session logger so `info` rows from src/dash/* helpers (which only
// pass a string) pick up the activity-panel `detail` for the operation. The
// helpers stay terse; presentation lives here in the caller.
function withDetail(log: Logger, detail: string): Logger {
  return (message, levelOrOptions) => {
    const opts = normalizeLogOptions(levelOrOptions);
    log(message, { ...opts, detail: opts.detail ?? detail });
  };
}

export function NotesWorkspace({
  onOpenLogin,
  onOpenSettings,
}: {
  onOpenLogin: () => void;
  onOpenSettings: () => void;
}) {
  const session = useSession();
  const { status, sdk, keyManager, contractId, identityId, log } = session;
  const isDesktop = useMediaQuery("(min-width: 768px)");

  const initialCachedRawNotes =
    identityId && contractId
      ? (loadCachedNotes(identityId, contractId, NETWORK) ?? [])
      : [];
  // Seed the editor from the first cached note on desktop so the right pane
  // paints with content on frame 1 instead of "No note selected" flashing
  // through before the hydrate effect picks one.
  const initialSelectedRaw =
    isDesktop && initialCachedRawNotes.length > 0
      ? initialCachedRawNotes[0]
      : null;
  const initialSelected = initialSelectedRaw
    ? noteDisplayFallback(initialSelectedRaw)
    : null;

  const [rawNotes, setRawNotes] = useState<NoteRecord[]>(initialCachedRawNotes);
  const [notes, setNotes] = useState<DisplayNoteRecord[]>(
    initialCachedRawNotes.map(noteDisplayFallback),
  );
  const [selectedId, setSelectedId] = useState<SelectedNoteId>(
    initialSelected?.id ?? null,
  );
  const [title, setTitle] = useState(editableNoteTitle(initialSelected));
  const [message, setMessage] = useState(editableNoteMessage(initialSelected));
  const [baselineTitle, setBaselineTitle] = useState(
    editableNoteTitle(initialSelected),
  );
  const [baselineMessage, setBaselineMessage] = useState(
    editableNoteMessage(initialSelected),
  );
  const [selectedNote, setSelectedNote] = useState<DisplayNoteRecord | null>(
    initialSelected,
  );
  const [selectedRawNote, setSelectedRawNote] = useState<NoteRecord | null>(
    initialSelectedRaw,
  );
  const [encryptionKeyMaterial, setEncryptionKeyMaterial] =
    useState<DashEncryptionKeyMaterial | null>(null);
  const encryptionKeyMaterialRef = useRef<DashEncryptionKeyMaterial | null>(
    null,
  );
  const [listLoading, setListLoading] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteRequested, setDeleteRequested] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [revalidating, setRevalidating] = useState(false);
  const [editsReady, setEditsReady] = useState(false);
  const [conflictWarning, setConflictWarning] = useState<string | null>(null);
  const lastRevalidatedAt = useRef(0);
  const inFlightWriteRef = useRef(false);
  // Monotonic token so a late listMyNotes() response from a previous
  // identity/contract/session can't clobber state for the current one.
  const reloadTokenRef = useRef(0);
  // Mirror editor state in refs so revalidation routines can compare against
  // the live values without participating in their dependency arrays (which
  // would re-fire effects on every keystroke).
  const titleRef = useRef("");
  const messageRef = useRef("");
  const baselineTitleRef = useRef("");
  const baselineMessageRef = useRef("");
  const selectedIdRef = useRef<SelectedNoteId>(null);
  const rawNotesRef = useRef<NoteRecord[]>([]);
  const displayTokenRef = useRef(0);
  const decryptedPayloadCacheRef = useRef(createDecryptedNotePayloadCache());
  const deletedNoteIdsRef = useRef(new Set<string>());
  useEffect(() => {
    rawNotesRef.current = rawNotes;
  }, [rawNotes]);
  useEffect(() => {
    titleRef.current = title;
  }, [title]);
  useEffect(() => {
    messageRef.current = message;
  }, [message]);
  useEffect(() => {
    baselineTitleRef.current = baselineTitle;
  }, [baselineTitle]);
  useEffect(() => {
    baselineMessageRef.current = baselineMessage;
  }, [baselineMessage]);
  useEffect(() => {
    selectedIdRef.current = selectedId;
  }, [selectedId]);

  useEffect(() => {
    decryptedPayloadCacheRef.current.clear();
    let cancelled = false;
    encryptionKeyMaterialRef.current = null;
    setEncryptionKeyMaterial(null);
    if (status !== "authenticated" || !keyManager?.getEncryptionKeyMaterial) {
      return () => {
        cancelled = true;
      };
    }
    void keyManager.getEncryptionKeyMaterial().then((material) => {
      if (!cancelled) {
        encryptionKeyMaterialRef.current = material;
        setEncryptionKeyMaterial(material);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [keyManager, status]);

  useEffect(() => {
    decryptedPayloadCacheRef.current.clear();
    deletedNoteIdsRef.current.clear();
  }, [identityId, contractId]);

  useEffect(() => {
    displayTokenRef.current += 1;
    if (!contractId) {
      setNotes([]);
      return;
    }
    const token = displayTokenRef.current;
    if (rawNotes.length === 0) {
      setNotes([]);
      return;
    }
    const displayKeyMaterial =
      encryptionKeyMaterial ?? encryptionKeyMaterialRef.current;
    void resolveNotesForDisplay(rawNotes, {
      network: NETWORK,
      contractId,
      encryptionKeyMaterial: displayKeyMaterial,
      decryptedPayloadCache: decryptedPayloadCacheRef.current,
    }).then((displayNotes) => {
      if (displayTokenRef.current !== token) return;
      setNotes(displayNotes);
      const sel = selectedIdRef.current;
      if (typeof sel !== "string" || sel === "new") return;
      const display = displayNotes.find((note) => note.id === sel) ?? null;
      const raw = rawNotes.find((note) => note.id === sel) ?? null;
      if (!display) return;
      setSelectedNote(display);
      setSelectedRawNote(raw);
      const nextTitle = editableNoteTitle(display);
      const nextMessage = editableNoteMessage(display);
      const wasDirty =
        titleRef.current !== baselineTitleRef.current ||
        messageRef.current !== baselineMessageRef.current;
      baselineTitleRef.current = nextTitle;
      baselineMessageRef.current = nextMessage;
      setBaselineTitle(nextTitle);
      setBaselineMessage(nextMessage);
      if (!wasDirty) {
        setTitle(nextTitle);
        setMessage(nextMessage);
      }
    });
  }, [contractId, encryptionKeyMaterial, rawNotes]);

  const isAuthed = status === "authenticated";
  const isBrowsing = status === "browsing";
  const canRead = isAuthed || isBrowsing;
  const contractReady = Boolean(contractId);
  const canMutate = Boolean(
    isAuthed && sdk && keyManager && contractId && editsReady,
  );
  const selectedEncryptedReadOnly = Boolean(
    selectedNote?.encryptionState === "locked" ||
    selectedNote?.encryptionState === "invalid",
  );
  const canEditCurrent = canMutate && !selectedEncryptedReadOnly;
  const dirty = title !== baselineTitle || message !== baselineMessage;
  const messageBytes = byteLength(message);
  const messageOversize = messageBytes > FIELD_BYTE_LIMIT;

  const hasMeaningfulContent = useMemo(
    () => Boolean(title.trim() || message.trim()),
    [title, message],
  );

  const resetDraft = useCallback(() => {
    setSelectedId("new");
    setSelectedNote(null);
    setSelectedRawNote(null);
    setTitle("");
    setMessage("");
    setBaselineTitle("");
    setBaselineMessage("");
    setError(null);
  }, []);

  const setWorkspaceNotes = useCallback(
    (nextNotes: NoteRecord[], persist = false) => {
      rawNotesRef.current = nextNotes;
      setRawNotes(nextNotes);
      displayTokenRef.current += 1;
      setNotes(
        nextNotes.map((note) =>
          cachedOrFallbackDisplayNote({
            note,
            contractId,
            encryptionKeyMaterial: encryptionKeyMaterialRef.current,
            decryptedPayloadCache: decryptedPayloadCacheRef.current,
          }),
        ),
      );
      if (persist && identityId && contractId) {
        saveCachedNotes(identityId, contractId, NETWORK, nextNotes);
      }
    },
    [contractId, identityId],
  );

  const mergeReloadedNotes = useCallback(
    (previousNotes: NoteRecord[], fetchedNotes: NoteRecord[]) => {
      const deletedIds = deletedNoteIdsRef.current;
      const previousById = new Map(
        previousNotes.map((note) => [note.id, note]),
      );
      const usedIds = new Set<string>();
      const merged: NoteRecord[] = [];

      for (const fetched of fetchedNotes) {
        if (deletedIds.has(fetched.id)) continue;
        const previous = previousById.get(fetched.id);
        merged.push(
          previous && previous.revision >= fetched.revision
            ? previous
            : fetched,
        );
        usedIds.add(fetched.id);
      }

      for (const previous of previousNotes) {
        if (usedIds.has(previous.id) || deletedIds.has(previous.id)) continue;
        merged.push(previous);
      }

      return merged.sort(
        (left, right) => (right.updatedAt ?? 0) - (left.updatedAt ?? 0),
      );
    },
    [],
  );

  const reloadNotes = useCallback(
    async (preferredId?: SelectedNoteId) => {
      const sessionTornDown =
        !contractId ||
        !identityId ||
        (status !== "authenticated" && status !== "browsing");
      if (sessionTornDown) {
        setRawNotes([]);
        setNotes([]);
        setSelectedNote(null);
        setSelectedRawNote(null);
        setSelectedId(null);
        setTitle("");
        setMessage("");
        setBaselineTitle("");
        setBaselineMessage("");
        setEditsReady(false);
        return;
      }
      if (!sdk) {
        // SDK is still connecting after a remembered-identity rehydrate. Keep
        // any cached notes on screen and wait for the effect to re-run once
        // `sdk` lands in the deps array.
        return;
      }

      const prevNotes = rawNotesRef.current;
      const hadNotes = prevNotes.length > 0;
      if (!hadNotes) setListLoading(true);
      setRevalidating(true);
      setError(null);
      reloadTokenRef.current += 1;
      const myToken = reloadTokenRef.current;
      const startedIdentityId = identityId;
      const startedContractId = contractId;
      try {
        const nextNotes = await listMyNotes({
          sdk,
          contractId,
          ownerId: identityId,
          log,
        });
        // Bail if a newer reload started, or session keys changed under us.
        if (
          reloadTokenRef.current !== myToken ||
          startedIdentityId !== identityId ||
          startedContractId !== contractId
        ) {
          return;
        }
        lastRevalidatedAt.current = Date.now();
        const mergedNotes = mergeReloadedNotes(prevNotes, nextNotes);
        const changed = !notesEqualByRevision(prevNotes, mergedNotes);
        setWorkspaceNotes(mergedNotes, changed);
        if (changed) {
          // Reconcile the currently selected note. The list query already
          // returned full bodies, so we don't need an extra getNote.
          const sel = selectedIdRef.current;
          if (typeof sel === "string" && sel !== "new") {
            const before = prevNotes.find((n) => n.id === sel) ?? null;
            const after = mergedNotes.find((n) => n.id === sel) ?? null;
            if (after && (!before || before.revision !== after.revision)) {
              const displayAfter = await resolveNoteForDisplay(after, {
                network: NETWORK,
                contractId,
                encryptionKeyMaterial: encryptionKeyMaterialRef.current,
                decryptedPayloadCache: decryptedPayloadCacheRef.current,
              });
              const nextTitle = editableNoteTitle(displayAfter);
              const nextMessage = editableNoteMessage(displayAfter);
              const wasDirty =
                titleRef.current !== baselineTitleRef.current ||
                messageRef.current !== baselineMessageRef.current;
              setSelectedNote(displayAfter);
              setSelectedRawNote(after);
              setBaselineTitle(nextTitle);
              setBaselineMessage(nextMessage);
              if (!wasDirty || inFlightWriteRef.current) {
                setTitle(nextTitle);
                setMessage(nextMessage);
                setConflictWarning(null);
              } else {
                setConflictWarning(STALE_EDIT_WARNING);
              }
            } else if (after && !inFlightWriteRef.current) {
              setSelectedRawNote(after);
            }
          }
        }
        setSelectedId((current) => {
          if (preferredId === "new") return "new";
          if (
            typeof preferredId === "string" &&
            mergedNotes.some((note) => note.id === preferredId)
          ) {
            return preferredId;
          }
          if (
            typeof current === "string" &&
            current !== "new" &&
            mergedNotes.some((note) => note.id === current)
          ) {
            return current;
          }
          if (current === "new") return current;
          return isDesktop ? (mergedNotes[0]?.id ?? null) : null;
        });
        setEditsReady(true);
      } catch (err) {
        if (reloadTokenRef.current !== myToken) return;
        setError(errorMessage(err));
        if (!hadNotes) setRawNotes([]);
      } finally {
        if (reloadTokenRef.current === myToken) {
          setListLoading(false);
          setRevalidating(false);
        }
      }
    },
    [
      contractId,
      identityId,
      log,
      mergeReloadedNotes,
      sdk,
      setWorkspaceNotes,
      status,
      isDesktop,
    ],
  );

  // Hydrate from cache synchronously when identity/contract changes, then kick
  // off background revalidation. Resets edit gate so saves can't go out against
  // possibly-stale cached state until the chain confirms it.
  useEffect(() => {
    if (
      !identityId ||
      !contractId ||
      (status !== "authenticated" && status !== "browsing")
    ) {
      setRawNotes([]);
      setNotes([]);
      setEditsReady(false);
      lastRevalidatedAt.current = 0;
      return;
    }
    const cached = loadCachedNotes(identityId, contractId, NETWORK);
    if (cached && cached.length > 0) {
      setRawNotes(cached);
      displayTokenRef.current += 1;
      setNotes(
        cached.map((note) =>
          cachedOrFallbackDisplayNote({
            note,
            contractId,
            encryptionKeyMaterial: encryptionKeyMaterialRef.current,
            decryptedPayloadCache: decryptedPayloadCacheRef.current,
          }),
        ),
      );
      // Sync the ref immediately so the revalidation that runs in this same
      // turn sees `hadNotes=true` and won't wipe the list on a network error.
      rawNotesRef.current = cached;
      // Auto-select the first cached note on desktop so the editor pane has
      // something to show before listMyNotes resolves. Mobile keeps the list
      // view as today.
      if (isDesktop && selectedIdRef.current === null) {
        setSelectedId(cached[0].id);
      }
    }
    setEditsReady(false);
    lastRevalidatedAt.current = 0;
    void reloadNotes();
    // reloadNotes intentionally omitted — it depends on `notes` and would
    // re-trigger this effect on every list change. `sdk` is in the deps so the
    // reload re-runs once a rehydrated session finishes connecting.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [identityId, contractId, status, sdk]);

  const loadTokenRef = useRef(0);

  const loadNoteDetail = useCallback(
    async (noteId: string, hydrated: boolean) => {
      if (!sdk || !contractId) return;
      const token = ++loadTokenRef.current;
      if (!hydrated) setDetailLoading(true);
      try {
        const note = await getNote({ sdk, contractId, noteId, log });
        if (loadTokenRef.current !== token) return;
        setSelectedRawNote(note);
        if (!note) {
          setSelectedNote(null);
          setTitle("");
          setMessage("");
          setBaselineTitle("");
          setBaselineMessage("");
          return;
        }
        const displayNote = await resolveNoteForDisplay(note, {
          network: NETWORK,
          contractId,
          encryptionKeyMaterial: encryptionKeyMaterialRef.current,
          decryptedPayloadCache: decryptedPayloadCacheRef.current,
        });
        if (loadTokenRef.current !== token) return;
        setSelectedNote(displayNote);
        // Fold the fresh note back into the list (and cache) so previews,
        // ordering, and a future cold reload reflect the newest revision.
        const prev = rawNotesRef.current;
        const idx = prev.findIndex((n) => n.id === note.id);
        if (idx === -1 || prev[idx].revision !== note.revision) {
          const merged =
            idx === -1
              ? [note, ...prev]
              : prev.map((n, i) => (i === idx ? note : n));
          setWorkspaceNotes(merged, true);
        }
        const nextTitle = editableNoteTitle(displayNote);
        const nextMessage = editableNoteMessage(displayNote);
        const priorBaselineTitle = baselineTitleRef.current;
        const priorBaselineMessage = baselineMessageRef.current;
        const wasDirty =
          titleRef.current !== priorBaselineTitle ||
          messageRef.current !== priorBaselineMessage;
        const chainChanged =
          nextTitle !== priorBaselineTitle ||
          nextMessage !== priorBaselineMessage;
        setBaselineTitle(nextTitle);
        setBaselineMessage(nextMessage);
        if (!wasDirty || inFlightWriteRef.current) {
          setTitle(nextTitle);
          setMessage(nextMessage);
          setConflictWarning(null);
        } else if (chainChanged) {
          setConflictWarning(STALE_EDIT_WARNING);
        }
      } catch (err) {
        if (loadTokenRef.current === token) setError(errorMessage(err));
      } finally {
        if (loadTokenRef.current === token) setDetailLoading(false);
      }
    },
    [contractId, log, sdk, setWorkspaceNotes],
  );

  useEffect(() => {
    if (selectedId === "new") {
      setSelectedNote(null);
      setSelectedRawNote(null);
      setConflictWarning(null);
      return;
    }
    if (!selectedId || !sdk || !contractId) {
      setSelectedNote(null);
      setSelectedRawNote(null);
      return;
    }
    setConflictWarning(null);
    const cached =
      rawNotesRef.current.find((note) => note.id === selectedId) ?? null;
    if (cached) {
      const display = cachedOrFallbackDisplayNote({
        note: cached,
        contractId,
        encryptionKeyMaterial: encryptionKeyMaterialRef.current,
        decryptedPayloadCache: decryptedPayloadCacheRef.current,
      });
      setSelectedRawNote(cached);
      setSelectedNote(display);
      setTitle(editableNoteTitle(display));
      setMessage(editableNoteMessage(display));
      setBaselineTitle(editableNoteTitle(display));
      setBaselineMessage(editableNoteMessage(display));
    }
    void loadNoteDetail(selectedId, Boolean(cached));
  }, [contractId, loadNoteDetail, sdk, selectedId]);

  // Background revalidation: refetch on tab focus (with throttle) and on a
  // periodic interval while the tab is visible. Dropped if a save/delete is
  // in flight to avoid clobbering post-write state with a pre-write list.
  useEffect(() => {
    if (
      !sdk ||
      !contractId ||
      !identityId ||
      (status !== "authenticated" && status !== "browsing")
    ) {
      return;
    }

    function maybeRefresh(throttleMs: number) {
      if (document.hidden) return;
      if (inFlightWriteRef.current) return;
      if (Date.now() - lastRevalidatedAt.current < throttleMs) return;
      void reloadNotes();
    }

    function onVisibility() {
      if (document.visibilityState === "visible") {
        maybeRefresh(FOCUS_REFRESH_MIN_MS);
      }
    }

    document.addEventListener("visibilitychange", onVisibility);
    const interval = window.setInterval(() => {
      maybeRefresh(BACKGROUND_REFRESH_MS - 1_000);
    }, BACKGROUND_REFRESH_MS);

    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.clearInterval(interval);
    };
  }, [sdk, contractId, identityId, status, reloadNotes]);

  function confirmDiscard(): boolean {
    if (!dirty) return true;
    return window.confirm("Discard unsaved changes?");
  }

  function handleSelect(noteId: string) {
    if (!confirmDiscard()) return;
    setSelectedId(noteId);
    setError(null);
    setConflictWarning(null);
  }

  function handleBack() {
    if (!confirmDiscard()) return;
    setSelectedId(null);
    setSelectedNote(null);
    setSelectedRawNote(null);
    setTitle("");
    setMessage("");
    setBaselineTitle("");
    setBaselineMessage("");
    setError(null);
    setConflictWarning(null);
  }

  function handleNew() {
    if (!canMutate) {
      // Browsing with a remembered identity: prompt the user to sign in so
      // they can author. Anonymous "idle" state never reaches this branch
      // because the button is hidden when the user can't even read.
      if (canRead) onOpenLogin();
      return;
    }
    if (!confirmDiscard()) return;
    resetDraft();
  }

  async function handleSave() {
    if (!sdk || !keyManager || !contractId || !isAuthed) return;
    if (selectedEncryptedReadOnly) {
      setError("This encrypted note is locked in the current session.");
      return;
    }
    if (!hasMeaningfulContent) {
      setError("Add a title or body before saving.");
      return;
    }
    if (messageOversize) {
      setError(
        `Body exceeds the ${FIELD_BYTE_LIMIT}-byte field limit (${messageBytes} B).`,
      );
      return;
    }
    let currentEncryptionKeyMaterial = encryptionKeyMaterial;
    if (keyManager.getEncryptionKeyMaterial) {
      try {
        currentEncryptionKeyMaterial =
          await keyManager.getEncryptionKeyMaterial();
        encryptionKeyMaterialRef.current = currentEncryptionKeyMaterial;
        setEncryptionKeyMaterial(currentEncryptionKeyMaterial);
      } catch (err) {
        setError(errorMessage(err));
        return;
      }
    }
    const rawSelected =
      selectedRawNote ??
      (typeof selectedId === "string" && selectedId !== "new"
        ? (rawNotesRef.current.find((note) => note.id === selectedId) ?? null)
        : null);
    if (
      rawSelected &&
      isEncryptedNoteEnvelopeString(rawSelected.message) &&
      !currentEncryptionKeyMaterial
    ) {
      setError("This encrypted note requires an encryption-capable session.");
      return;
    }
    const encryption = currentEncryptionKeyMaterial
      ? { network: NETWORK, keyMaterial: currentEncryptionKeyMaterial }
      : null;

    setSaving(true);
    setError(null);
    inFlightWriteRef.current = true;
    // Snapshot what we're about to save — used for both the post-success
    // baseline advance and the post-failure refresh.
    const submittedTitle = title;
    const submittedMessage = message;
    try {
      if (selectedId === "new" || selectedId === null) {
        const noteId = await createNote({
          sdk,
          keyManager,
          contractId,
          title,
          message,
          encryption,
          log: withDetail(log, "documents.create"),
        });
        log("Note created.", {
          level: "success",
          detail: `id ${noteId.slice(0, 8)}…`,
        });
        // Advance baselines so the post-save reload doesn't see wasDirty=true
        // and trip the conflict detector against its own write.
        baselineTitleRef.current = submittedTitle;
        baselineMessageRef.current = submittedMessage;
        setBaselineTitle(submittedTitle);
        setBaselineMessage(submittedMessage);
        selectedIdRef.current = noteId;
        setSelectedId(noteId);
        await loadNoteDetail(noteId, true);
        await reloadNotes(noteId);
      } else {
        const newRevision = await updateNote({
          sdk,
          keyManager,
          contractId,
          noteId: selectedId,
          title,
          message,
          encryption,
          log: withDetail(log, "documents.get → replace"),
        });
        log("Note saved.", {
          level: "success",
          detail: `rev ${newRevision.toString()}`,
        });
        baselineTitleRef.current = submittedTitle;
        baselineMessageRef.current = submittedMessage;
        setBaselineTitle(submittedTitle);
        setBaselineMessage(submittedMessage);
        setConflictWarning(null);
        await loadNoteDetail(selectedId, true);
        await reloadNotes(selectedId);
      }
    } catch (err) {
      setError(errorMessage(err));
      // Save failed — chain may have moved (e.g. another window incremented
      // the identity nonce by saving first). Refresh the note so the user
      // sees what's actually on chain before they retry, and surface the
      // conflict warning if the revision actually moved past what we held.
      if (
        selectedId !== "new" &&
        selectedId !== null &&
        sdk &&
        contractId &&
        selectedNote
      ) {
        try {
          const latest = await getNote({
            sdk,
            contractId,
            noteId: selectedId,
            log,
          });
          if (latest && latest.revision !== selectedNote.revision) {
            const displayLatest = await resolveNoteForDisplay(latest, {
              network: NETWORK,
              contractId,
              encryptionKeyMaterial:
                currentEncryptionKeyMaterial ??
                encryptionKeyMaterialRef.current,
              decryptedPayloadCache: decryptedPayloadCacheRef.current,
            });
            setSelectedNote(displayLatest);
            setSelectedRawNote(latest);
            const latestTitle = editableNoteTitle(displayLatest);
            const latestMessage = editableNoteMessage(displayLatest);
            setBaselineTitle(latestTitle);
            setBaselineMessage(latestMessage);
            baselineTitleRef.current = latestTitle;
            baselineMessageRef.current = latestMessage;
            // The conflict warning is the actionable info ("your retry will
            // overwrite"); the underlying nonce/network error is internal
            // detail. Clear the error so the warning isn't masked.
            setError(null);
            // Fold the chain's content into the list/cache too.
            const prev = rawNotesRef.current;
            const idx = prev.findIndex((n) => n.id === latest.id);
            if (idx === -1 || prev[idx].revision !== latest.revision) {
              const merged =
                idx === -1
                  ? [latest, ...prev]
                  : prev.map((n, i) => (i === idx ? latest : n));
              setWorkspaceNotes(merged, true);
            }
            setConflictWarning(STALE_EDIT_WARNING);
          }
        } catch {
          // Best effort — don't mask the original save error.
        }
      }
    } finally {
      inFlightWriteRef.current = false;
      setSaving(false);
    }
  }

  function requestDelete() {
    if (!sdk || !keyManager || !contractId || !isAuthed || !selectedId) return;
    if (selectedId === "new") {
      resetDraft();
      return;
    }
    setDeleteRequested(true);
  }

  async function confirmDelete() {
    if (!sdk || !keyManager || !contractId || !isAuthed || !selectedId) return;
    if (selectedId === "new") return;

    setDeleting(true);
    setError(null);
    inFlightWriteRef.current = true;
    try {
      await deleteNote({
        sdk,
        keyManager,
        contractId,
        noteId: selectedId,
        log: withDetail(log, "documents.delete"),
      });
      log("Note deleted.", {
        level: "success",
        detail: `id ${selectedId.slice(0, 8)}…`,
      });
      deletedNoteIdsRef.current.add(selectedId);
      const remainingNotes = rawNotesRef.current.filter(
        (note) => note.id !== selectedId,
      );
      setWorkspaceNotes(remainingNotes, true);
      const nextSelectedId = isDesktop ? (remainingNotes[0]?.id ?? null) : null;
      selectedIdRef.current = nextSelectedId;
      setSelectedId(nextSelectedId);
      if (!nextSelectedId) {
        setSelectedNote(null);
        setSelectedRawNote(null);
        setTitle("");
        setMessage("");
        setBaselineTitle("");
        setBaselineMessage("");
      }
      setDeleteRequested(false);
      await reloadNotes();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      inFlightWriteRef.current = false;
      setDeleting(false);
    }
  }

  return (
    <div className="space-y-5 max-md:flex max-md:min-h-0 max-md:flex-1 max-md:flex-col max-md:space-y-2">
      {!canRead ? (
        <SignInHero onOpenLogin={onOpenLogin} />
      ) : !contractReady ? (
        <EmptyState
          icon={
            <svg
              width="32"
              height="32"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.75"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <path d="M14 2v6h6" />
              <path d="M9 13h6M9 17h6" />
            </svg>
          }
          title="Register or select a contract"
          description="Open Settings to register a Dashnote note contract or paste a contract ID before creating notes."
          actionLabel="Open Settings"
          onAction={onOpenSettings}
        />
      ) : (
        <div className="gap-5 max-md:flex max-md:min-h-0 max-md:flex-1 max-md:flex-col md:grid md:h-[calc(100vh-175px)] md:min-h-[520px] md:grid-cols-[260px_minmax(0,1fr)] md:gap-0 md:overflow-hidden md:rounded-[24px] md:border md:border-line md:bg-surface md:shadow-[0_20px_60px_-36px_rgba(0,0,0,0.45)] lg:grid-cols-[340px_minmax(0,1fr)]">
          <div
            className={`min-h-0 max-md:flex-1 ${selectedId !== null ? "hidden md:flex" : "flex"} flex-col`}
          >
            <NoteList
              notes={notes}
              loading={listLoading}
              revalidating={revalidating && notes.length > 0}
              selectedId={selectedId}
              onSelect={handleSelect}
              onNew={handleNew}
              canCreate={canMutate || isBrowsing}
              newButtonLabel={canMutate ? "New note" : "Sign in to create"}
            />
          </div>
          <div
            className={`min-h-0 max-md:flex-1 ${selectedId === null ? "hidden md:flex" : "flex"} flex-col md:border-l md:border-line`}
          >
            <NoteEditor
              isDesktop={isDesktop}
              selectedId={selectedId}
              note={selectedNote}
              rawNote={selectedRawNote}
              title={title}
              message={message}
              onTitleChange={setTitle}
              onMessageChange={setMessage}
              onSave={() => void handleSave()}
              onDelete={requestDelete}
              onBack={handleBack}
              loading={detailLoading}
              saving={saving}
              deleting={deleting}
              canEdit={canEditCurrent}
              canDelete={Boolean(
                canMutate && selectedId && selectedId !== "new",
              )}
              isReadOnly={isBrowsing}
              dirty={dirty}
              messageBytes={messageBytes}
              messageOversize={messageOversize}
              contractReady={contractReady}
              contractId={contractId}
              error={error}
              conflictWarning={conflictWarning}
              onOpenLogin={onOpenLogin}
              onOpenSettings={onOpenSettings}
            />
          </div>
        </div>
      )}
      <DeleteNoteModal
        open={deleteRequested}
        noteTitle={title}
        deleting={deleting}
        onCancel={() => setDeleteRequested(false)}
        onConfirm={() => void confirmDelete()}
      />
    </div>
  );
}

function EmptyState({
  icon,
  title,
  description,
  actionLabel,
  onAction,
  secondaryHref,
  secondaryLabel,
  footnote,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  actionLabel: string;
  onAction: () => void;
  secondaryHref?: string;
  secondaryLabel?: string;
  footnote?: string;
}) {
  return (
    <div className="flex flex-1 flex-col px-6 py-10 text-center max-md:py-8">
      <div className="flex flex-1 flex-col items-center justify-center gap-4 max-md:-translate-y-16">
        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-surface-2 text-ink-3">
          {icon}
        </div>
        <div className="max-w-[320px] space-y-2">
          <div className="text-[16px] font-semibold text-ink">{title}</div>
          <div className="text-[13px] leading-6 text-ink-3">{description}</div>
        </div>
        <button
          type="button"
          onClick={onAction}
          className="rounded-full bg-accent px-5 py-2 text-[13px] font-semibold text-bg transition hover:bg-accent-dim"
        >
          {actionLabel}
        </button>
        {secondaryHref && secondaryLabel && (
          <a
            href={secondaryHref}
            target="_blank"
            rel="noreferrer"
            className="text-[12px] font-medium text-accent underline-offset-2 hover:underline"
          >
            {secondaryLabel}
          </a>
        )}
      </div>
      {footnote && (
        <div className="mt-4 truncate text-[11px] leading-5 text-ink-4">
          {footnote}
        </div>
      )}
    </div>
  );
}

function SignInHero({ onOpenLogin }: { onOpenLogin: () => void }) {
  return (
    <section className="relative overflow-hidden rounded-[24px] border border-line bg-surface px-12 py-14 max-md:flex max-md:flex-1 max-md:flex-col max-md:justify-center max-md:rounded-none max-md:border-0 max-md:px-6 max-md:py-10">
      <div className="pointer-events-none absolute -right-32 -top-32 h-96 w-96 rounded-full bg-[radial-gradient(circle,color-mix(in_oklab,var(--color-accent)_22%,transparent),transparent_60%)]" />
      <div className="relative grid grid-cols-1 gap-10 lg:grid-cols-[1.05fr_0.95fr]">
        <div className="max-md:text-center">
          <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-accent">
            Dash Platform tutorial
          </div>
          <h2 className="mt-3 text-balance text-[36px] font-bold leading-[1.05] tracking-[-0.025em] text-ink max-md:text-[28px]">
            Personal notes, stored on a public blockchain.
          </h2>
          <p className="mt-3 max-w-[440px] text-pretty text-[14.5px] leading-[1.6] text-ink-2 max-md:mx-auto">
            Dashnote stores notes against your testnet identity. Sign in with a
            Dash Platform identity to create, edit, and review your notes — or
            read the source to see how a small app registers a contract, writes
            documents, and queries them back.
          </p>
          <div className="mt-5 flex flex-wrap gap-2.5 max-md:justify-center">
            <button
              type="button"
              onClick={onOpenLogin}
              className="inline-flex items-center gap-2 rounded-full bg-accent px-5 py-2.5 text-[13px] font-semibold text-bg hover:bg-accent-dim"
            >
              Sign in
            </button>
            <a
              href="https://github.com/dashpay/platform-tutorials/tree/main/example-apps/dashnote"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-2 rounded-full border border-line-2 px-5 py-2.5 text-[13px] font-semibold text-ink-2 hover:border-accent-dim"
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 16 16"
                fill="currentColor"
                aria-hidden="true"
              >
                <path d="M8 0C3.58 0 0 3.58 0 8a8 8 0 0 0 5.47 7.59c.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
              </svg>
              View source
            </a>
          </div>
          <div className="mt-4 text-[12px] text-ink-4">
            Need a testnet identity?{" "}
            <a
              href="https://bridge.thepasta.org/"
              target="_blank"
              rel="noreferrer"
              className="font-medium text-accent underline-offset-2 hover:underline"
            >
              Create one on Dash Bridge →
            </a>
          </div>
        </div>

        {/* Sample note peek — mirrors the real NoteEditor (header pill + footer mono strip) */}
        <div className="relative max-lg:hidden" aria-hidden="true">
          <div className="overflow-hidden rounded-lg border border-line bg-bg shadow-[0_30px_70px_-36px_rgba(0,0,0,0.55)] [transform:rotate(-0.4deg)]">
            <div className="flex items-center gap-3 border-b border-line px-4 py-3">
              <span className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full bg-[color:color-mix(in_oklab,var(--color-accent)_14%,transparent)] px-2.5 py-1 font-mono text-[11px] font-semibold text-accent">
                <svg
                  width="11"
                  height="11"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                  <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
                </svg>
                Revision 4
              </span>
              <span className="text-[12px] text-ink-3">Updated last week</span>
            </div>
            <div className="px-5 py-4">
              <div className="text-[18px] font-bold tracking-[-0.015em] text-ink">
                Q4 product retro
              </div>
              <div className="mt-1.5 text-[13px] leading-[1.55] text-ink-2">
                Wins: shipped the tutorial app to staging, two contracts
                published, byte-budget editor unblocks long docs…
              </div>
            </div>
            <div className="flex items-center justify-between gap-3 border-t border-line bg-surface/40 px-5 py-3 font-mono text-[10.5px] text-ink-4">
              <span>
                <span className="text-ink-3">$createdAt</span> 5/5/2026, 1:48 PM
              </span>
              <span>
                <span className="text-ink-3">$updatedAt</span> 5/5/2026, 4:43 PM
              </span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
