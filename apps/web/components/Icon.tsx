import type { CSSProperties } from "react";
const paths: Record<string, string> = {
  plus: "M12 5v14M5 12h14",
  send: "m5 12 14-7-7 14-1-6-6-1Zm6 1 8-8",
  voice: "M5 9v6M9 5v14M13 8v8M17 3v18M21 9v6",
  paperclip: "m8 12 6-6a3 3 0 0 1 4 4l-8 8a5 5 0 0 1-7-7l9-9M6 14l8-8",
  book: "M4 4h6a3 3 0 0 1 2 1 3 3 0 0 1 2-1h6v16h-6a3 3 0 0 0-2 1 3 3 0 0 0-2-1H4V4Zm8 1v16",
  chart: "M4 3v17h17M8 15l4-5 4 2 5-7",
  close: "m6 6 12 12M6 18 18 6",
  menu: "M4 6h16M4 12h16M4 18h16",
  settings: "M4 7h16M4 17h16M8 4v6M16 14v6",
  arrow: "M5 12h14m-5-5 5 5-5 5",
  stop: "M6 6h12v12H6Z",
  screen: "M3 4h18v13H3ZM8 21h8M12 17v4",
  sparkle: "m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5L12 3Z",
  check: "m5 12 4 4L19 6",
  search: "m21 21-5-5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0Z",
  note: "M5 3h14v18H5ZM8 8h8M8 12h8M8 16h5",
  cards: "M6 7h15v14H6ZM3 17V3h14M10 11h7M10 15h5",
  quiz: "M8 6H5v15h14V6h-3M9 3h6v5H9ZM9 13l2 2 4-4",
  copy: "M8 8h13v13H8ZM16 4V2H2v14h2",
  download: "M12 3v12m-5-5 5 5 5-5M4 17v4h16v-4",
  back: "M19 12H5m6-6-6 6 6 6",
  expand: "M8 3H3v5M16 3h5v5M3 16v5h5M21 16v5h-5",
  grid: "M3 3h7v7H3ZM14 3h7v7h-7ZM3 14h7v7H3ZM14 14h7v7h-7Z",
};
export default function Icon({
  name,
  size = 20,
  style,
}: {
  name: string;
  size?: number;
  style?: CSSProperties;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={style}
    >
      <path d={paths[name] ?? paths.sparkle} />
    </svg>
  );
}
