/**
 * Grounding check for AI text: every number the AI writes must already
 * exist in the computed facts we sent it.
 */

/** Numbers as canonical strings: commas removed, trailing zeros dropped ("95.0" → "95"). */
export function numbersIn(text: string): string[] {
  return (text.match(/\d[\d,]*(?:\.\d+)?/g) ?? []).map((n) => String(Number(n.replace(/,/g, ""))));
}

export function ungroundedNumbers(text: string, facts: unknown): string[] {
  const allowed = new Set(numbersIn(JSON.stringify(facts)));
  // Small list markers like "1." or "2)" at the start of a line are formatting, not data.
  const cleaned = text.replace(/^\s*\d{1,2}[.)]\s/gm, "");
  return [...new Set(numbersIn(cleaned).filter((n) => !allowed.has(n)))];
}
