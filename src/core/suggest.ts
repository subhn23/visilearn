function lev(a: string, b: string): number {
  const dp = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = dp[j];
      dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return dp[b.length];
}

/** " (did you mean 'x'?)" or "" — keeps validator errors short and fixable by an AI author. */
export function didYouMean(word: string, candidates: Iterable<string>): string {
  let best = '';
  let bestD = Infinity;
  for (const c of candidates) {
    const d = lev(word.toLowerCase(), c.toLowerCase());
    if (d < bestD) { bestD = d; best = c; }
  }
  return best && bestD <= Math.max(1, Math.floor(word.length / 3)) ? ` (did you mean '${best}'?)` : '';
}
