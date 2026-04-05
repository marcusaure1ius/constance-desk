"use client";

import { useState, useEffect, useCallback } from "react";

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

function readConfig(): BoardFilterConfig {
  if (typeof window === "undefined") return defaultConfig;
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored ? { ...defaultConfig, ...JSON.parse(stored) } : defaultConfig;
  } catch {
    return defaultConfig;
  }
}

export function useBoardFilter() {
  const [config, setConfig] = useState<BoardFilterConfig>(defaultConfig);

  // Sync with localStorage after hydration
  useEffect(() => {
    setConfig(readConfig());
    const handler = () => setConfig(readConfig());
    window.addEventListener(CHANGE_EVENT, handler);
    return () => window.removeEventListener(CHANGE_EVENT, handler);
  }, []);

  const updateConfig = useCallback(
    (updates: Partial<BoardFilterConfig>) => {
      setConfig((prev) => {
        const next = { ...prev, ...updates };
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
        window.dispatchEvent(new Event(CHANGE_EVENT));
        return next;
      });
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
