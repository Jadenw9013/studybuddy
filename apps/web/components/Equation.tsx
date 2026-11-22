import katex from "katex";
export default function Equation() {
  return (
    <div
      className="equation"
      role="math"
      aria-label="Density equals count divided by included observations times bin width"
      dangerouslySetInnerHTML={{
        __html: katex.renderToString(
          "\\text{density}=\\frac{\\text{count}}{n\\,\\times\\,\\text{bin width}}",
          { throwOnError: false, trust: false, output: "htmlAndMathml" },
        ),
      }}
    />
  );
}
