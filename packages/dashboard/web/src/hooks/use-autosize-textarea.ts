import { useLayoutEffect, useRef } from "react";

/**
 * Grow a textarea with its content up to the CSS max-height.
 * Returns a ref to attach; re-measures whenever `value` changes.
 */
export function useAutosizeTextarea(value: string) {
  const ref = useRef<HTMLTextAreaElement | null>(null);

  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    // Reset first so shrinking works; scrollHeight only ever grows otherwise.
    node.style.height = "auto";
    node.style.height = `${node.scrollHeight}px`;
  }, [value]);

  return ref;
}
