import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import { normalizeMathDelimiters } from "./richTextMath";

export interface RichTextProps { text: string; headingLevel?: 3 | 4 }

/** Untrusted Markdown is data: no raw HTML, fetched media or executable links. */
export default function RichText({ text, headingLevel = 3 }: RichTextProps) {
  const heading = (level: number, children: React.ReactNode) => {
    const Tag = `h${Math.min(6, headingLevel + level - 1)}` as "h3" | "h4" | "h5" | "h6";
    return <Tag className={`rich-text-heading rich-text-heading-${level}`}>{children}</Tag>;
  };
  return (
    <div className="rich-text">
      <Markdown
        skipHtml
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[[rehypeKatex, {
          output: "htmlAndMathml", trust: false, strict: "ignore",
          maxExpand: 1000, maxSize: 20,
        }]]}
        urlTransform={(url, key) => key === "href" && /^https?:\/\//i.test(url) ? url : ""}
        components={{
          h1: ({ children }) => heading(1, children),
          h2: ({ children }) => heading(2, children),
          h3: ({ children }) => heading(3, children),
          h4: ({ children }) => heading(4, children),
          h5: ({ children }) => heading(5, children),
          h6: ({ children }) => heading(6, children),
          a: ({ children, href }) => <span className="rich-text-link">{children}{href ? <span className="rich-text-link-address"> ({href})</span> : null}</span>,
          img: ({ alt }) => <span className="rich-text-image-description">{alt ? `Image description: ${alt}` : "An image was referenced in this text."}</span>,
          pre: ({ children }) => <pre className="rich-text-code" tabIndex={0} aria-label="Code block">{children}</pre>,
          table: ({ children }) => <div className="rich-text-table" role="region" aria-label="Table" tabIndex={0}><table>{children}</table></div>,
        }}
      >{normalizeMathDelimiters(text)}</Markdown>
    </div>
  );
}
