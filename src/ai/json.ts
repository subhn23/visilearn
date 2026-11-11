// Pull a JSON value out of a model reply. Small local models often wrap JSON in prose,
// code fences or <think> blocks, or leave trailing commas.

const stripTrailingCommas = (s: string) => s.replace(/,\s*([}\]])/g, '$1');

function tryParse(s: string): unknown {
  for (const candidate of [s, stripTrailingCommas(s)]) {
    try { return JSON.parse(candidate); } catch { /* try next */ }
  }
  return undefined;
}

/** index just past the bracket that closes the one at `start`, or -1 */
function balancedEnd(s: string, start: number): number {
  const stack: string[] = [];
  let inStr = false;
  for (let i = start; i < s.length; i++) {
    const ch = s[i];
    if (inStr) {
      if (ch === '\\') i++;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === '{' || ch === '[') stack.push(ch === '{' ? '}' : ']');
    else if (ch === '}' || ch === ']') {
      if (stack.pop() !== ch) return -1;
      if (!stack.length) return i + 1;
    }
  }
  return -1;
}

export function extractJson(text: string): unknown {
  const t = text.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
  const direct = tryParse(t);
  if (direct !== undefined) return direct;
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(t);
  if (fence) {
    const v = tryParse(fence[1].trim());
    if (v !== undefined) return v;
  }
  for (let i = 0; i < t.length; i++) {
    if (t[i] !== '{' && t[i] !== '[') continue;
    const end = balancedEnd(t, i);
    if (end < 0) continue;
    const v = tryParse(t.slice(i, end));
    if (v !== undefined) return v;
  }
  return undefined;
}
