type Child = Node | string | null | undefined | false;

/** Tiny hyperscript helper: h('div.card', {onclick}, 'text', child) */
export function h<K extends keyof HTMLElementTagNameMap>(
  sel: K | `${K}.${string}`,
  attrs: Record<string, unknown> | null = null,
  ...children: (Child | Child[])[]
): HTMLElementTagNameMap[K] {
  const [tag, ...classes] = sel.split('.');
  const n = document.createElement(tag as K);
  if (classes.length) n.className = classes.join(' ');
  for (const [k, v] of Object.entries(attrs ?? {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2), v as EventListener);
    else if (k === 'class') n.className += ` ${v}`;
    else if (k in n && typeof v !== 'string') (n as any)[k] = v;
    else n.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of children.flat()) if (c != null && c !== false) n.append(c);
  return n;
}
