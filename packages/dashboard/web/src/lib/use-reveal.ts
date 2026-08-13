import { useEffect } from "react";
import type { CSSProperties } from "react";

/**
 * Scroll reveal: sets `data-reveal="in"` when an element enters the viewport.
 * CSS transitions from the default hidden state into `[data-reveal="in"]`.
 * Re-scans whenever `deps` change so conditionally rendered content is picked up.
 */
export function useReveal(deps: unknown[] = []) {
  useEffect(() => {
    const targets = Array.from(document.querySelectorAll<HTMLElement>("[data-reveal]")).filter(
      (el) => el.getAttribute("data-reveal") !== "in",
    );
    if (targets.length === 0) return;

    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      for (const node of targets) node.setAttribute("data-reveal", "in");
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          (entry.target as HTMLElement).setAttribute("data-reveal", "in");
          observer.unobserve(entry.target);
        }
      },
      { rootMargin: "0px 0px -8% 0px", threshold: 0.08 },
    );

    for (const node of targets) observer.observe(node);
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}

export function revealDelay(index: number, stepMs = 40, maxMs = 240): CSSProperties {
  return { "--reveal-delay": `${Math.min(index * stepMs, maxMs)}ms` } as CSSProperties;
}
