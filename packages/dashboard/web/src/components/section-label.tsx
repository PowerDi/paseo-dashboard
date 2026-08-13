import type { CSSProperties } from "react";

export function SectionLabel({ children, style }: { children: string; style?: CSSProperties }) {
  return (
    <div className="dashboard-section-label" data-reveal="" style={style}>
      {children}
    </div>
  );
}
