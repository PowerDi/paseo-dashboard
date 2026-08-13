import * as React from "react";

/** Minimal Slot replacement (no radix-ui dependency). */
export const Slot = React.forwardRef<
  HTMLElement,
  React.HTMLAttributes<HTMLElement> & {
    children?: React.ReactNode;
  }
>(({ children, ...props }, ref) => {
  if (React.isValidElement(children)) {
    return React.cloneElement(children as React.ReactElement<Record<string, unknown>>, {
      ...props,
      ref,
    });
  }
  return React.createElement("div", { ref, ...props }, children);
});
Slot.displayName = "Slot";
