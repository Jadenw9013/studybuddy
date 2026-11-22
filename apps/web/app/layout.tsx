import "./globals.css";
import "./notebook-workspace.css";
import "katex/dist/katex.min.css";
import Workspace from "../components/Workspace";
export const metadata = {
  title: "Live Tutor · Study workspace",
  description:
    "Understand your coursework with cited explanations, voice and accurate editable visuals.",
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Workspace />
        {children}
      </body>
    </html>
  );
}
