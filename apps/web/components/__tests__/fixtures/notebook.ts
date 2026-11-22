export const notes = String.raw`# Comparing histograms

A count of **3** is different from a density of \(0.03\).

- Keep the same observations.
- Check the bin width.

\[
\text{density}=\frac{\text{count}}{n\times\text{width}}
\]

\begin{aligned}
P(A \mid B) &= \frac{P(A\cap B)}{P(B)} \\
\text{area} &= \text{density}\times\text{width}
\end{aligned}

` + "\nUse the literal code `density=False` before changing the setting.\n";

export const notebookFixture = {
  snapshot: true,
  cells: [
    { id: "notes1", cellId: "notes1", ordinal: 1, cellType: "markdown", source: notes },
    { id: "plot1", cellId: "plot1", ordinal: 2, cellType: "code", source: "ax.hist(scores, bins=[0, 10, 20, 30, 40], density=False)\n# Keep this exact source.", outputs: [{ data: { "text/html": "<script>untrustedOutput()</script>" } }] },
    { id: "empty1", cellId: "empty1", ordinal: 3, cellType: "raw", source: "" },
  ],
};
