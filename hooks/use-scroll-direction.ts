"use client";

import { useState, useEffect, useRef } from "react";

const SCROLL_THRESHOLD = 10;

export function useScrollDirection() {
  const [visible, setVisible] = useState(true);
  const lastScrollY = useRef(0);

  useEffect(() => {
    function handleScroll() {
      const currentScrollY = window.scrollY;
      const delta = currentScrollY - lastScrollY.current;

      if (currentScrollY < SCROLL_THRESHOLD) {
        setVisible(true);
      } else if (Math.abs(delta) > SCROLL_THRESHOLD) {
        setVisible(delta < 0);
      }

      lastScrollY.current = currentScrollY;
    }

    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  return visible;
}
