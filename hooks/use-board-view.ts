"use client";

import { useCallback, useSyncExternalStore } from "react";

export type BoardViewMode = "columns" | "epics";

type BoardViewState = {
  mode: BoardViewMode;
  collapsed: string[];
  /** Показывать ли в виде эпиков дорожки без видимых задач. Настройка «Доска». */
  showEmptyEpics: boolean;
};

const STORAGE_KEY = "board-view";
const CHANGE_EVENT = "board-view-change";

const defaultState: BoardViewState = {
  mode: "columns",
  collapsed: [],
  showEmptyEpics: false,
};

let cachedRaw: string | null = null;
let cachedState: BoardViewState = defaultState;

function getSnapshot(): BoardViewState {
  if (typeof window === "undefined") return defaultState;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === cachedRaw) return cachedState;
    cachedRaw = raw;
    cachedState = raw
      ? { ...defaultState, ...JSON.parse(raw) }
      : defaultState;
    return cachedState;
  } catch {
    return defaultState;
  }
}

function getServerSnapshot(): BoardViewState {
  return defaultState;
}

function subscribe(cb: () => void) {
  window.addEventListener(CHANGE_EVENT, cb);
  window.addEventListener("storage", cb);
  return () => {
    window.removeEventListener(CHANGE_EVENT, cb);
    window.removeEventListener("storage", cb);
  };
}

function write(next: BoardViewState) {
  const raw = JSON.stringify(next);
  localStorage.setItem(STORAGE_KEY, raw);
  cachedRaw = raw;
  cachedState = next;
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

export function useBoardView() {
  const state = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const setMode = useCallback((mode: BoardViewMode) => {
    write({ ...getSnapshot(), mode });
  }, []);

  const setShowEmptyEpics = useCallback((showEmptyEpics: boolean) => {
    write({ ...getSnapshot(), showEmptyEpics });
  }, []);

  const toggleCollapsed = useCallback((key: string) => {
    const cur = getSnapshot();
    const collapsed = cur.collapsed.includes(key)
      ? cur.collapsed.filter((k) => k !== key)
      : [...cur.collapsed, key];
    write({ ...cur, collapsed });
  }, []);

  const isCollapsed = useCallback(
    (key: string) => state.collapsed.includes(key),
    [state.collapsed]
  );

  return {
    mode: state.mode,
    setMode,
    showEmptyEpics: state.showEmptyEpics,
    setShowEmptyEpics,
    toggleCollapsed,
    isCollapsed,
  };
}
