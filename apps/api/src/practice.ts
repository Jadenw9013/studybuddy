export const practiceBank: Record<
  string,
  {
    id: string;
    prompt: string;
    values: number[];
    solution: string;
    reason: RegExp;
    units?: RegExp;
  }[]
> = {
  histogram: [
    {
      id: "density-4-20-5",
      prompt:
        "A new bin contains 4 of 20 scores and is 5 score units wide. What are its relative frequency and density? Explain how bar area represents probability.",
      values: [0.2, 0.04],
      solution:
        "Relative frequency = 4/20 = 0.20. Density = 4/(20 × 5) = 0.04 per score unit. Area = density × width = probability.",
      reason: /area.*(?:probab|frequency)|(?:probab|frequency).*area/i,
      units: /per|score unit/i,
    },
    {
      id: "density-6-30-4",
      prompt:
        "A different histogram has 6 of 30 observations in a bin of width 4 score units. Find its relative frequency and density. Explain the role of bar area.",
      values: [0.2, 0.05],
      solution:
        "Relative frequency = 6/30 = 0.20. Density = 0.20/4 = 0.05 per score unit. Its area is 0.20.",
      reason: /area.*(?:probab|frequency)|(?:probab|frequency).*area/i,
      units: /per|score unit/i,
    },
  ],
  probability: [
    {
      id: "conditional-3-12",
      prompt:
        "Of 12 evening students, 3 commute by train. What is P(train | evening)? State the conditioning group.",
      values: [0.25],
      solution:
        "3/12 = 0.25. The conditioning group is the 12 evening students.",
      reason: /evening/i,
    },
    {
      id: "conditional-8-20",
      prompt:
        "Among 20 weekend students, 8 commute by bus. What is P(bus | weekend)? Name the conditioning group.",
      values: [0.4],
      solution:
        "8/20 = 0.40. The conditioning group is the 20 weekend students.",
      reason: /weekend/i,
    },
  ],
  regression: [
    {
      id: "slope-2-3",
      prompt:
        "A fitted line predicts y = 5 + 2x. How much does predicted y change when x increases by 3 units? Explain the slope.",
      values: [6],
      solution:
        "Predicted y increases by 6 y units. The slope is 2 y units per x unit.",
      reason: /slope|per|increase/i,
    },
    {
      id: "slope-minus3-2",
      prompt:
        "A fitted line predicts y = 10 − 3x. How much does predicted y change when x increases by 2 units? Explain your sign.",
      values: [-6],
      solution:
        "Predicted y changes by −6 y units, a decrease of 6. The slope is −3 y units per x unit.",
      reason: /decrease|negative|minus|−/i,
    },
  ],
};
export function getPracticeItem(practice: any) {
  return (
    practiceBank[practice.skill]?.find((x) => x.id === practice.variantId) ??
    practiceBank[practice.skill]?.[0]
  );
}
export function gradePractice(practice: any, answer: string) {
  const item = getPracticeItem(practice),
    text = answer.toLowerCase();
  const numbers = (text.match(/[-−]?\d+\/\d+|[-−]?\d*\.\d+|[-−]?\d+%?/g) ?? [])
    .map((s) => s.replace("−", "-"))
    .map((x) =>
      x.endsWith("%")
        ? parseFloat(x) / 100
        : x.includes("/")
          ? Number(x.split("/")[0]) / Number(x.split("/")[1])
          : Number(x),
    );
  const evidence=answer.split(/[;.!?\n]+/).find(clause=>item.reason.test(clause)&&!/\b(not|never|isn't|doesn't|cannot|can't)\b/i.test(clause));
  return {
    numeric: item.values.every((n) =>
      numbers.some((v) => Math.abs(v - n) < 1e-7),
    ),
    reasoning: Boolean(evidence),
    evidencePhrase:evidence?.trim()??null,
    units: item.units
      ? item.units.test(text)
        ? "supported"
        : "unclear"
      : "not_required",
  };
}
