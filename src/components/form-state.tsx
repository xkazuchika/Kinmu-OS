"use client";

import { useRouter } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { ConfirmDialog } from "@/components/ui";

type UnsavedContextValue = {
  setDirty: (id: string, dirty: boolean) => void;
};

const UnsavedContext = createContext<UnsavedContextValue | null>(null);

export function UnsavedChangesProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const dirtyIdsRef = useRef(new Set<string>());
  const [dirtyCount, setDirtyCount] = useState(0);
  const [pendingHref, setPendingHref] = useState<string>();

  const setDirty = useCallback((id: string, dirty: boolean) => {
    if (dirty) dirtyIdsRef.current.add(id);
    else dirtyIdsRef.current.delete(id);
    setDirtyCount(dirtyIdsRef.current.size);
  }, []);

  useEffect(() => {
    function preventUnload(event: BeforeUnloadEvent) {
      if (dirtyIdsRef.current.size === 0) return;
      event.preventDefault();
      event.returnValue = "";
    }
    window.addEventListener("beforeunload", preventUnload);
    return () => window.removeEventListener("beforeunload", preventUnload);
  }, []);

  useEffect(() => {
    function guardBrowserHistory() {
      if (dirtyIdsRef.current.size === 0) return;
      const discard = window.confirm(
        "未保存の変更があります。変更を破棄して前の画面へ移動しますか？",
      );
      if (discard) {
        dirtyIdsRef.current.clear();
        setDirtyCount(0);
      } else {
        window.history.forward();
      }
    }
    window.addEventListener("popstate", guardBrowserHistory);
    return () => window.removeEventListener("popstate", guardBrowserHistory);
  }, []);

  useEffect(() => {
    function guardInternalNavigation(event: MouseEvent) {
      if (dirtyIdsRef.current.size === 0 || event.defaultPrevented || event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const target = event.target;
      if (!(target instanceof Element)) return;
      const anchor = target.closest<HTMLAnchorElement>("a[href]");
      if (!anchor || anchor.target === "_blank" || anchor.hasAttribute("download")) return;
      const url = new URL(anchor.href, window.location.href);
      if (url.origin !== window.location.origin) return;
      const current = `${window.location.pathname}${window.location.search}${window.location.hash}`;
      const next = `${url.pathname}${url.search}${url.hash}`;
      if (current === next) return;
      event.preventDefault();
      setPendingHref(next);
    }
    document.addEventListener("click", guardInternalNavigation, true);
    return () => document.removeEventListener("click", guardInternalNavigation, true);
  }, []);

  const value = useMemo(() => ({ setDirty }), [setDirty]);

  function discardAndNavigate() {
    const href = pendingHref;
    dirtyIdsRef.current.clear();
    setDirtyCount(0);
    setPendingHref(undefined);
    if (href) router.push(href);
  }

  return (
    <UnsavedContext value={value}>
      {children}
      <ConfirmDialog
        confirmLabel="変更を破棄して移動"
        onCancel={() => setPendingHref(undefined)}
        onConfirm={discardAndNavigate}
        open={Boolean(pendingHref) && dirtyCount > 0}
        title="未保存の変更があります"
      >
        <p>この画面で変更した内容はまだ保存されていません。</p>
        <p>編集を続ける場合はキャンセルしてください。</p>
      </ConfirmDialog>
    </UnsavedContext>
  );
}

export function useUnsavedChanges(dirty: boolean) {
  const context = useContext(UnsavedContext);
  const id = useId();

  useEffect(() => {
    context?.setDirty(id, dirty);
    return () => context?.setDirty(id, false);
  }, [context, dirty, id]);
}

export type FormPhase = "conflicted" | "failed" | "pristine" | "submitting" | "succeeded";

export function useFormLifecycle(snapshot: string) {
  const [savedSnapshot, setSavedSnapshot] = useState(snapshot);
  const [phase, setPhase] = useState<FormPhase>("pristine");
  const dirty = snapshot !== savedSnapshot;
  useUnsavedChanges(dirty && phase !== "succeeded");

  function markSubmitting() {
    setPhase("submitting");
  }

  function markSucceeded(nextSnapshot = snapshot) {
    setSavedSnapshot(nextSnapshot);
    setPhase("succeeded");
  }

  return {
    dirty,
    markConflicted: () => setPhase("conflicted"),
    markFailed: () => setPhase("failed"),
    markSubmitting,
    markSucceeded,
    phase,
    reset: (nextSnapshot = snapshot) => {
      setSavedSnapshot(nextSnapshot);
      setPhase("pristine");
    },
  } as const;
}
