"use client";

import { useTheme } from "next-themes";
import { useCallback } from "react";

export function useThemeTransition() {
  const { theme, setTheme, resolvedTheme } = useTheme();

  const isDark = resolvedTheme === "dark";

  const toggleTheme = useCallback(
    (triggerRef: React.RefObject<HTMLElement | null>) => {
      const next = isDark ? "light" : "dark";

      // Fallback: если View Transition API недоступен — просто переключить
      if (
        !document.startViewTransition ||
        window.matchMedia("(prefers-reduced-motion: reduce)").matches
      ) {
        setTheme(next);
        return;
      }

      // Вычислить центр анимации от trigger-элемента
      const trigger = triggerRef.current;
      let x = window.innerWidth - 24;
      let y = 24;

      if (trigger) {
        const rect = trigger.getBoundingClientRect();
        x = rect.left + rect.width / 2;
        y = rect.top + rect.height / 2;
      }

      // Максимальный радиус — расстояние до самого дальнего угла viewport
      const maxRadius = Math.hypot(
        Math.max(x, window.innerWidth - x),
        Math.max(y, window.innerHeight - y),
      );

      const transition = document.startViewTransition(() => {
        setTheme(next);
      });

      transition.ready
        .then(() => {
          document.documentElement.animate(
            {
              clipPath: [
                `circle(${maxRadius}px at ${x}px ${y}px)`,
                `circle(0px at ${x}px ${y}px)`,
              ],
            },
            {
              duration: 500,
              easing: "ease-in-out",
              pseudoElement: "::view-transition-old(root)",
            },
          );
        })
        .catch(() => {
          // Анимация не удалась — тема уже применена через setTheme
        });
    },
    [isDark, setTheme],
  );

  return { isDark, toggleTheme };
}
