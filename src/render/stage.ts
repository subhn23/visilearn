import { layoutScene } from '../core/layout.ts';
import type { Layout } from '../core/layout.ts';
import type { Effects, Entity, PackRegistry, Scene, Tone, TravelOpts } from '../core/types.ts';

const NS = 'http://www.w3.org/2000/svg';
const FALLBACK_ICON = '<rect x="10" y="10" width="28" height="28" rx="5" fill="var(--node-fill)" stroke="currentColor" stroke-width="2.2"/>';
const PLATE = 33; // half-size of the node plate
const CY = -8; // plate centre offset (labels sit below)

function el<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number> = {}, parent?: Element) {
  const n = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v));
  parent?.appendChild(n);
  return n;
}

function wrap(text: string, max = 26): string[] {
  const lines: string[] = [];
  let cur = '';
  for (const w of text.split(/\s+/)) {
    if (cur && (cur + ' ' + w).length > max) { lines.push(cur); cur = w; } else cur = cur ? `${cur} ${w}` : w;
  }
  if (cur) lines.push(cur);
  return lines.slice(0, 4);
}

const reducedMotion = () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * Renders a compiled scene as SVG and implements Effects with animation.
 * `epoch` cancels in-flight animations when the learner navigates.
 */
export class Stage implements Effects {
  readonly svg: SVGSVGElement;
  readonly layout: Layout;
  private nodes = new Map<string, SVGGElement>();
  private linkEls: { a: string; b: string; el: SVGLineElement }[] = [];
  private gDecor: SVGGElement;
  private gPackets: SVGGElement;
  private gNotes: SVGGElement;
  private down = new Set<string>();
  epoch = 0;
  /** when true, effects apply state instantly with no drawing (used to fast-forward past steps) */
  instant = false;
  speed = 1;
  onLog: (msg: string, tone?: Tone) => void = () => {};
  onSelect: (e: Entity) => void = () => {};

  constructor(scene: Scene, registry: PackRegistry) {
    this.layout = layoutScene(scene, registry);
    const { width, height } = this.layout;
    const top = 70; // room for notes above the top row
    this.svg = el('svg', {
      viewBox: `0 ${-top} ${width} ${height + top}`,
      class: 'stage-svg',
      role: 'img',
      'aria-label': `${scene.title}: ${scene.entities.map((e) => e.label).join(', ')}`,
    });
    this.svg.style.aspectRatio = `${width} / ${height + top}`;

    const gLinks = el('g', { class: 'links' }, this.svg);
    this.gDecor = el('g', { class: 'decor' }, this.svg);
    const gNodes = el('g', { class: 'nodes' }, this.svg);
    this.gPackets = el('g', { class: 'packets' }, this.svg);
    this.gNotes = el('g', { class: 'notes' }, this.svg);

    for (const [a, b] of scene.links) {
      const pa = this.layout.pos.get(a)!;
      const pb = this.layout.pos.get(b)!;
      const line = el('line', { x1: pa.x, y1: pa.y + CY, x2: pb.x, y2: pb.y + CY, class: 'link' }, gLinks);
      this.linkEls.push({ a, b, el: line });
      // little "ports" where the cable meets each plate
      for (const [p, q] of [[pa, pb], [pb, pa]]) {
        const dx = q.x - p.x, dy = q.y - p.y, len = Math.hypot(dx, dy) || 1;
        const k = (PLATE + 7) / Math.max(Math.abs(dx / len), Math.abs(dy / len), 0.0001) / len;
        el('circle', { cx: p.x + dx * Math.min(k, 0.5), cy: p.y + CY + dy * Math.min(k, 0.5), r: 3.5, class: 'port' }, gLinks);
      }
    }

    for (const e of scene.entities) {
      const p = this.layout.pos.get(e.id)!;
      const kind = registry[e.pack].entities[e.kind];
      const g = el('g', {
        class: `node kind-${e.kind}`,
        transform: `translate(${p.x} ${p.y})`,
        tabindex: 0,
        role: 'button',
        'aria-label': `${e.label} (${e.kind})${e.sub ? ` ${e.sub}` : ''}`,
      }, gNodes);
      const body = el('g', { class: 'body' }, g);
      el('rect', { x: -PLATE - 7, y: CY - PLATE - 7, width: (PLATE + 7) * 2, height: (PLATE + 7) * 2, rx: 16, class: 'ring' }, body);
      el('rect', { x: -PLATE + 4, y: CY - PLATE + 4, width: PLATE * 2, height: PLATE * 2, rx: 12, class: 'shadow' }, body);
      el('rect', { x: -PLATE, y: CY - PLATE, width: PLATE * 2, height: PLATE * 2, rx: 12, class: `plate swatch-${kind?.swatch ?? 'sky'}` }, body);
      const icon = el('g', { transform: `translate(-24 ${CY - 24})`, class: 'icon' }, body);
      icon.innerHTML = registry[e.pack].icons?.[e.kind] ?? FALLBACK_ICON;
      const label = el('text', { y: 48, class: 'label' }, g);
      label.textContent = e.label;
      if (e.sub) {
        const sub = el('text', { y: 63, class: 'sub' }, g);
        sub.textContent = e.sub;
      }
      const x = el('g', { class: 'down-mark', transform: `translate(0 ${CY})` }, g);
      el('path', { d: 'M-15 -15L15 15M15 -15L-15 15' }, x);
      const select = () => this.onSelect(e);
      g.addEventListener('click', select);
      g.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); select(); } });
      this.nodes.set(e.id, g);
    }
  }

  private dur(ms: number) {
    return reducedMotion() ? Math.min(ms, 120) : ms / this.speed;
  }

  /** Clear decorations and transient visuals (start of a step). */
  reset() {
    this.epoch++;
    this.gPackets.replaceChildren();
    this.gNotes.replaceChildren();
    this.gDecor.replaceChildren();
    for (const g of this.nodes.values()) g.classList.remove('hl', 'flash-ok', 'flash-bad', 'flash-warn', 'selected');
    for (const id of [...this.down]) this.setDown(id, false);
  }

  select(id: string | null) {
    for (const [nid, g] of this.nodes) g.classList.toggle('selected', nid === id);
  }

  // ---- Effects ----------------------------------------------------------------

  travel(path: string[], o: TravelOpts = {}): Promise<void> {
    if (this.instant || path.length < 2) return Promise.resolve();
    const epoch = this.epoch;
    const pts = path.map((id) => this.layout.pos.get(id)!).map((p) => ({ x: p.x, y: p.y + CY }));
    const g = el('g', {
      class: `packet tone-${o.tone ?? 'info'}${o.dashed ? ' dashed' : ''}`,
      transform: `translate(${pts[0].x} ${pts[0].y})`,
    }, this.gPackets);
    const r = o.dashed ? 6.5 : 8.5;
    el('circle', { r, cx: 2.5, cy: 2.5, class: 'dot-shadow' }, g);
    el('circle', { r, class: 'dot' }, g);
    if (o.label) {
      const t = el('text', { y: -15, class: 'packet-label' }, g);
      t.textContent = o.label;
    }
    const trail = o.dashed ? null : el('polyline', { class: 'trail', points: '' }, this.gDecor);
    const segDur = this.dur(o.dashed ? 380 : 560);
    const total = segDur * (pts.length - 1);
    const t0 = performance.now();

    return new Promise((resolve) => {
      const frame = (now: number) => {
        if (epoch !== this.epoch) { g.remove(); trail?.remove(); resolve(); return; }
        const t = Math.min(1, Math.max(0, (now - t0) / total)); // rAF time can precede t0
        const f = t * (pts.length - 1);
        const i = Math.min(Math.floor(f), pts.length - 2);
        const k = f - i;
        const ease = k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2;
        const x = pts[i].x + (pts[i + 1].x - pts[i].x) * ease;
        const y = pts[i].y + (pts[i + 1].y - pts[i].y) * ease;
        g.setAttribute('transform', `translate(${x} ${y})`);
        trail?.setAttribute('points', [...pts.slice(0, i + 1), { x, y }].map((p) => `${p.x},${p.y}`).join(' '));
        if (t < 1) requestAnimationFrame(frame);
        else {
          g.classList.add('arrived');
          setTimeout(() => g.remove(), this.dur(o.tone === 'bad' ? 320 : 380));
          setTimeout(() => trail?.classList.add('fade'), this.dur(300));
          setTimeout(() => trail?.remove(), this.dur(1200));
          resolve();
        }
      };
      requestAnimationFrame(frame);
    });
  }

  flash(id: string, tone: Tone): Promise<void> {
    if (this.instant) return Promise.resolve();
    const g = this.nodes.get(id);
    if (!g) return Promise.resolve();
    const cls = `flash-${tone === 'ok' ? 'ok' : tone === 'bad' ? 'bad' : 'warn'}`;
    g.classList.remove(cls);
    void g.getBoundingClientRect(); // restart CSS animation
    g.classList.add(cls);
    setTimeout(() => g.classList.remove(cls), 900);
    return this.wait(380);
  }

  highlight(id: string) {
    if (this.instant) return;
    this.nodes.get(id)?.classList.add('hl');
  }

  note(id: string, text: string) {
    if (this.instant) return;
    const p = this.layout.pos.get(id);
    if (!p) return;
    const lines = wrap(text);
    const lh = 15;
    const w = Math.max(...lines.map((l) => l.length)) * 7 + 22;
    const h = lines.length * lh + 14;
    const g = el('g', { class: 'note', transform: `translate(${p.x} ${p.y - 58 - h})` }, this.gNotes);
    el('rect', { x: -w / 2 + 3, y: 3, width: w, height: h, rx: 8, class: 'note-shadow' }, g);
    el('rect', { x: -w / 2, y: 0, width: w, height: h, rx: 8 }, g);
    el('path', { d: `M-7 ${h - 1} L0 ${h + 8} L7 ${h - 1}`, class: 'tail' }, g);
    lines.forEach((l, i) => {
      const t = el('text', { x: 0, y: 7 + lh * (i + 0.8) }, g);
      t.textContent = l;
    });
  }

  setDown(id: string, down: boolean) {
    const g = this.nodes.get(id);
    if (!g) return;
    if (down) this.down.add(id); else this.down.delete(id);
    g.classList.toggle('down', down);
    for (const l of this.linkEls) l.el.classList.toggle('dead', this.down.has(l.a) || this.down.has(l.b));
  }

  log(msg: string, tone?: Tone) {
    if (!this.instant) this.onLog(msg, tone);
  }

  wait(ms: number): Promise<void> {
    if (this.instant) return Promise.resolve();
    const epoch = this.epoch;
    return new Promise((r) => setTimeout(() => r(), epoch === this.epoch ? this.dur(ms) : 0));
  }
}
