import type { CSSProperties } from "react";

export type WorkspaceIconName = "home" | "book" | "message" | "work" | "chart" | "arrow" | "mail" | "calendar" | "check";

const paths: Record<WorkspaceIconName, string[]> = {
  home: ["M3 10 12 3l9 7", "M5 9v11h5v-6h4v6h5V9"],
  book: ["M12 6v15", "M3 4h5a4 4 0 0 1 4 3 4 4 0 0 1 4-3h5v15h-5a4 4 0 0 0-4 2 4 4 0 0 0-4-2H3z"],
  message: ["M21 11a8 8 0 0 1-8 8H8l-5 3V11a8 8 0 0 1 8-8h2a8 8 0 0 1 8 8Z", "M8 9h8M8 13h5"],
  work: ["M8 6V3h8v3", "M3 6h18v15H3z", "M3 11h18M10 11v3h4v-3"],
  chart: ["M4 3v18h17", "M8 17v-5M13 17V8M18 17V4"],
  arrow: ["M4 12h16M14 6l6 6-6 6"],
  mail: ["M3 5h18v14H3z", "m3 5 9 8 9-8"],
  calendar: ["M4 5h16v16H4z", "M8 2v6M16 2v6M4 10h16M8 14h2M14 14h2"],
  check: ["m5 12 4 4L19 6"],
};

export function WorkspaceIcon({ name, className, style }: { name: WorkspaceIconName; className?: string; style?: CSSProperties }) {
  return <svg className={className} style={style} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name].map((path) => <path key={path} d={path} />)}</svg>;
}
