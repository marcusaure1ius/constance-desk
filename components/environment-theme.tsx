"use client";

import { useEffect } from "react";

interface EnvironmentThemeProps {
  color: string | null;
}

export function EnvironmentTheme({ color }: EnvironmentThemeProps) {
  useEffect(() => {
    if (!color) return;

    const root = document.documentElement;
    root.style.setProperty("--primary", color);
    root.style.setProperty("--ring", color);

    return () => {
      root.style.removeProperty("--primary");
      root.style.removeProperty("--ring");
    };
  }, [color]);

  return null;
}
