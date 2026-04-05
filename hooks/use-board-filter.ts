"use client";

import { useCallback, useSyncExternalStore } from "react";

export type BoardFilterConfig = {
  today: boolean;
  highPriority: boolean;
  active: boolean;
};

const STORAGE_KEY = "board-filter";
const CHANGE_EVENT = "board-filter-change";

const defaultConfig: BoardFilterConfig = {
  today: false,
  highPriority: false,
  active: false,
};

let cachedRaw: string | null = null;
let cachedConfig: BoardFilterConfig = defaultConfig;

function getSnapshot(): BoardFilterConfig {
  if (typeof window === "undefined") return defaultConfig;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === cachedRaw) return cachedConfig;
    cachedRaw = raw;
    cachedConfig = raw ? { ...defaultConfig, ...JSON.parse(raw) } : defaultConfig;
    return cachedConfig;
  } catch {
    return defaultConfig;
  }
}

function getServerSnapshot(): BoardFilterConfig {
  return defaultConfig;
}

function subscribe(cb: () => void) {
  window.addEventListener(CHANGE_EVENT, cb);
  window.addEventListener("storage", cb);
  return () => {
    window.removeEventListener(CHANGE_EVENT, cb);
    window.removeEventListener("storage", cb);
  };
}

export function useBoardFilter() {
  const config = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const updateConfig = useCallback(
    (updates: Partial<BoardFilterConfig>) => {
      const next = { ...getSnapshot(), ...updates };
      const raw = JSON.stringify(next);
      localStorage.setItem(STORAGE_KEY, raw);
      cachedRaw = raw;
      cachedConfig = next;
      window.dispatchEvent(new Event(CHANGE_EVENT));
    },
    []
  );

  const hasFilters = config.today || config.highPriority;

  const filterTask = useCallback(
    (task: { plannedDate: string | null; priority: string }) => {
      if (!config.active || !hasFilters) return true;

      const today = new Date().toISOString().split("T")[0];
      const matchesToday = config.today && task.plannedDate === today;
      const matchesPriority =
        config.highPriority &&
        (task.priority === "urgent" || task.priority === "high");

      return matchesToday || matchesPriority;
    },
    [config.active, config.today, config.highPriority, hasFilters]
  );

  return { config, updateConfig, filterTask, hasFilters };
}
