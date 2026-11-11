import { layoutScene } from '../core/layout.ts';
import type { Layout, Pos } from '../core/layout.ts';
import type { Effects, Entity, PackRegistry, Scene, Tone, TravelOpts } from '../core/types.ts';

const NS = 'http://www.w3.org/2000/svg';
const FALLBACK_ICON = '<rect x="10" y="10" width="28" height="28" rx="5" fill="var(--node-fill)" stroke="currentColor" stroke-width="2.2"/>';
const PLATE = 33; // half-size of the node plate
const CY = -8; // plate centre offset (labels sit below)
const TOP = 70; // room for notes/badges above the top row

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
const ease = (k: number) => (k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2);

interface NodeView { g: SVGGElement; e: Entity; sub?: SVGTextElement; badge?: SVGGElement }
interface LinkView { a: string; b: string; line: SVGLineElement; pa: SVGCircleElement; pb: SVGCircleElement }

/**
 * Renders a scene as SVG and implements Effects with animation.
 * The graph can change at runtime (addNode/removeNode); nodes glide to their new layout.
 * `epoch` cancels in-flight animations when the learner navigates.
 */
export class Stage implements Effects {
  readonly svg: SVGSVGElement;
  private registry: PackRegistry;
  private base: { entities: Entity[]; links: [string, string][] };
  private entities: Entity[] = [];
  private links: [string, string][] = [];
  private nodes = new Map<string, NodeView>();
  private linkViews: LinkView[] = [];
  private gLinks: SVGGElement;
  private gNodes: SVGGElement;
  private gDecor: SVGGElement;
  private gPackets: SVGGElement;
  private gNotes: SVGGElement;
  private down = new Set<string>();
  private dirty = false;
  /** displayed positions (animated) and layout targets */
  private cur = new Map<string, Pos>();
  private target = new Map<string, Pos>();
  private anim: { from: Map<string, Pos>; t0: number; dur: number } | null = null;
  layout!: Layout;
  epoch = 0;
  /** when true, effects apply state instantly with no drawing (used to fast-forward past steps) */
  instant = false;
  speed = 1;
  onLog: (msg: string, tone?: Tone) => void = () => {};
  onSelect: (e: Entity) => void = () => {};

  constructor(scene: Scene, registry: PackRegistry) {
    this.registry = registry;
    const visible = scene.entities.filter((e) => !e.hidden);
    const ids = new Set(visible.map((e) => e.id));
    this.base = { entities: visible, links: scene.links.filter(([a, b]) => ids.has(a) && ids.has(b)) };
    this.svg = el('svg', { class: 'stage-svg', role: 'img', 'aria-label': scene.title });
    this.gLinks = el('g', { class: 'links' }, this.svg);
    this.gDecor = el('g', { class: 'decor' }, this.svg);
    this.gNodes = el('g', { class: 'nodes' }, this.svg);
    this.gPackets = el('g', { class: 'packets' }, this.svg);
    this.gNotes = el('g', { class: 'notes' }, this.svg);
    this.rebuild();
  }

  // ---- graph -----------------------------------------------------------------------

  private rebuild() {
    this.entities = [...this.base.entities];
    this.links = [...this.base.links];
    this.nodes.clear();
    this.linkViews = [];
    this.gNodes.replaceChildren();
    this.gLinks.replaceChildren();
    this.down.clear();
    this.cur.clear();
    for (const [a, b] of this.links) this.makeLink(a, b);
    for (const e of this.entities) this.makeNode(e);
    this.relayout(true);
    this.dirty = false;
  }

  private makeLink(a: string, b: string) {
    const line = el('line', { class: 'link' }, this.gLinks);
    const pa = el('circle', { r: 3.5, class: 'port' }, this.gLinks);
    const pb = el('circle', { r: 3.5, class: 'port' }, this.gLinks);
    this.linkViews.push({ a, b, line, pa, pb });
  }

  private makeNode(e: Entity) {
    const kind = this.registry[e.pack]?.entities[e.kind];
    const g = el('g', {
      class: `node kind-${e.kind}`,
      tabindex: 0,
      role: 'button',
      'aria-label': `${e.label} (${e.kind})${e.sub ? ` ${e.sub}` : ''}`,
    }, this.gNodes);
    const body = el('g', { class: 'body' }, g);
    el('rect', { x: -PLATE - 7, y: CY - PLATE - 7, width: (PLATE + 7) * 2, height: (PLATE + 7) * 2, rx: 16, class: 'ring' }, body);
    el('rect', { x: -PLATE + 4, y: CY - PLATE + 4, width: PLATE * 2, height: PLATE * 2, rx: 12, class: 'shadow' }, body);
    el('rect', { x: -PLATE, y: CY - PLATE, width: PLATE * 2, height: PLATE * 2, rx: 12, class: `plate swatch-${kind?.swatch ?? 'sky'}` }, body);
    const icon = el('g', { transform: `translate(-24 ${CY - 24})`, class: 'icon' }, body);
    icon.innerHTML = this.registry[e.pack]?.icons?.[e.kind] ?? FALLBACK_ICON;
    const label = el('text', { y: 48, class: 'label' }, g);
    label.textContent = e.label;
    const view: NodeView = { g, e };
    if (e.sub) {
      view.sub = el('text', { y: 63, class: 'sub' }, g);
      view.sub.textContent = e.sub;
    }
    const x = el('g', { class: 'down-mark', transform: `translate(0 ${CY})` }, g);
    el('path', { d: 'M-15 -15L15 15M15 -15L-15 15' }, x);
    const select = () => this.onSelect(view.e);
    g.addEventListener('click', select);
    g.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); select(); } });
    this.nodes.set(e.id, view);
    return view;
  }

  private relayout(immediate = false) {
    this.layout = layoutScene({ entities: this.entities, links: this.links } as Scene, this.registry);
    const { width, height } = this.layout;
    this.svg.setAttribute('viewBox', `0 ${-TOP} ${width} ${height + TOP}`);
    this.svg.style.aspectRatio = `${width} / ${height + TOP}`;
    this.target = new Map(this.layout.pos);
    if (immediate || this.instant || reducedMotion() || !this.cur.size) {
      this.anim = null;
      this.cur = new Map(this.target);
      this.paint();
      return;
    }
    const from = new Map<string, Pos>();
    for (const [id, p] of this.target) {
      const parent = this.links.find(([, b]) => b === id)?.[0];
      from.set(id, this.cur.get(id) ?? (parent ? this.cur.get(parent) : undefined) ?? p);
    }
    const running = !!this.anim;
    this.anim = { from, t0: performance.now(), dur: this.dur(480) };
    if (!running) requestAnimationFrame(this.tick);
  }

  private tick = (now: number) => {
    if (!this.anim) return;
    const k = Math.min(1, Math.max(0, (now - this.anim.t0) / this.anim.dur));
    const e = ease(k);
    for (const [id, to] of this.target) {
      const f = this.anim.from.get(id) ?? to;
      this.cur.set(id, { x: f.x + (to.x - f.x) * e, y: f.y + (to.y - f.y) * e });
    }
    for (const id of [...this.cur.keys()]) if (!this.target.has(id)) this.cur.delete(id);
    this.paint();
    if (k < 1) requestAnimationFrame(this.tick);
    else this.anim = null;
  };

  private paint() {
    for (const [id, v] of this.nodes) {
      const p = this.cur.get(id);
      if (p) v.g.setAttribute('transform', `translate(${p.x} ${p.y})`);
    }
    for (const l of this.linkViews) {
      const pa = this.cur.get(l.a);
      const pb = this.cur.get(l.b);
      if (!pa || !pb) continue;
      l.line.setAttribute('x1', String(pa.x)); l.line.setAttribute('y1', String(pa.y + CY));
      l.line.setAttribute('x2', String(pb.x)); l.line.setAttribute('y2', String(pb.y + CY));
      for (const [p, q, port] of [[pa, pb, l.pa], [pb, pa, l.pb]] as const) {
        const dx = q.x - p.x, dy = q.y - p.y, len = Math.hypot(dx, dy) || 1;
        const k = Math.min(0.5, (PLATE + 7) / Math.max(Math.abs(dx / len), Math.abs(dy / len), 0.0001) / len);
        port.setAttribute('cx', String(p.x + dx * k));
        port.setAttribute('cy', String(p.y + CY + dy * k));
      }
    }
  }

  private dur(ms: number) {
    return reducedMotion() ? Math.min(ms, 120) : ms / this.speed;
  }

  /** Clear decorations and transient visuals (start of a step); restore the original graph. */
  reset() {
    this.epoch++;
    this.gPackets.replaceChildren();
    this.gNotes.replaceChildren();
    this.gDecor.replaceChildren();
    if (this.dirty) { this.rebuild(); return; }
    for (const v of this.nodes.values()) v.g.classList.remove('hl', 'flash-ok', 'flash-bad', 'flash-warn', 'flash-info', 'selected');
    for (const id of [...this.down]) this.setDown(id, false);
  }

  select(id: string | null) {
    for (const [nid, v] of this.nodes) v.g.classList.toggle('selected', nid === id);
  }

  // ---- Effects ----------------------------------------------------------------

  addNode(e: Entity, linkTo?: string) {
    if (this.nodes.has(e.id)) return;
    this.dirty = true;
    const shown = { ...e, hidden: false };
    this.entities.push(shown);
    if (linkTo && this.nodes.has(linkTo)) { this.links.push([linkTo, e.id]); this.makeLink(linkTo, e.id); }
    const v = this.makeNode(shown);
    if (!this.instant) v.g.classList.add('appear');
    this.relayout();
  }

  removeNode(id: string) {
    const gone = (x: string) => x === id || x.startsWith(id + '/');
    if (!this.entities.some((e) => gone(e.id))) return;
    this.dirty = true;
    this.entities = this.entities.filter((e) => !gone(e.id));
    this.links = this.links.filter(([a, b]) => !gone(a) && !gone(b));
    for (const [nid, v] of [...this.nodes]) if (gone(nid)) { v.g.remove(); this.nodes.delete(nid); }
    this.linkViews = this.linkViews.filter((l) => {
      const keep = !gone(l.a) && !gone(l.b);
      if (!keep) { l.line.remove(); l.pa.remove(); l.pb.remove(); }
      return keep;
    });
    this.relayout();
  }

  link(a: string, b: string) {
    if (!this.nodes.has(a) || !this.nodes.has(b) || this.links.some(([x, y]) => (x === a && y === b) || (x === b && y === a))) return;
    this.dirty = true;
    this.links.push([a, b]);
    this.makeLink(a, b);
    this.relayout();
  }

  unlink(a: string, b: string) {
    const match = (x: string, y: string) => (x === a && y === b) || (x === b && y === a);
    if (!this.links.some(([x, y]) => match(x, y))) return;
    this.dirty = true;
    this.links = this.links.filter(([x, y]) => !match(x, y));
    this.linkViews = this.linkViews.filter((l) => {
      if (!match(l.a, l.b)) return true;
      l.line.remove(); l.pa.remove(); l.pb.remove();
      return false;
    });
    this.relayout();
  }

  badge(id: string, text: string | null) {
    const v = this.nodes.get(id);
    if (!v) return;
    this.dirty = true;
    v.badge?.remove();
    v.badge = undefined;
    if (text === null) return;
    const w = text.length * 6.6 + 16;
    const b = el('g', { class: 'badge', transform: `translate(0 ${CY - PLATE - 16})` }, v.g);
    el('rect', { x: -w / 2 + 2, y: -9, width: w, height: 19, rx: 5, class: 'badge-shadow' }, b);
    el('rect', { x: -w / 2, y: -11, width: w, height: 19, rx: 5 }, b);
    el('path', { d: 'M-5 8 L0 13 L5 8', class: 'tail' }, b);
    const t = el('text', { y: 2.5 }, b);
    t.textContent = text;
    v.badge = b;
  }

  setSub(id: string, text: string) {
    const v = this.nodes.get(id);
    if (!v) return;
    this.dirty = true;
    v.e = { ...v.e, sub: text };
    if (!v.sub) v.sub = el('text', { y: 63, class: 'sub' }, v.g);
    v.sub.textContent = text;
  }

  travel(path: string[], o: TravelOpts = {}): Promise<void> {
    if (this.instant || path.length < 2) return Promise.resolve();
    const epoch = this.epoch;
    const pts = path.map((id) => this.target.get(id)!).filter(Boolean).map((p) => ({ x: p.x, y: p.y + CY }));
    if (pts.length < 2) return Promise.resolve();
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
        const k = ease(f - i);
        const x = pts[i].x + (pts[i + 1].x - pts[i].x) * k;
        const y = pts[i].y + (pts[i + 1].y - pts[i].y) * k;
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
    const v = this.nodes.get(id);
    if (!v) return Promise.resolve();
    const cls = `flash-${tone === 'ok' ? 'ok' : tone === 'bad' ? 'bad' : tone === 'info' ? 'info' : 'warn'}`;
    v.g.classList.remove(cls);
    void v.g.getBoundingClientRect(); // restart CSS animation
    v.g.classList.add(cls);
    setTimeout(() => v.g.classList.remove(cls), 900);
    return this.wait(tone === 'info' ? 260 : 380);
  }

  highlight(id: string) {
    if (this.instant) return;
    this.nodes.get(id)?.g.classList.add('hl');
  }

  note(id: string, text: string) {
    if (this.instant) return;
    const p = this.target.get(id);
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
    const v = this.nodes.get(id);
    if (!v) return;
    if (down) this.down.add(id); else this.down.delete(id);
    v.g.classList.toggle('down', down);
    for (const l of this.linkViews) l.line.classList.toggle('dead', this.down.has(l.a) || this.down.has(l.b));
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
