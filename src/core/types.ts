// Core data model. DOM-free: shared by the web player, the MCP server and tests.

export interface Token {
  v: string;
  /** true when the whole token was written as "a quoted string" */
  q: boolean;
}

export interface Stmt {
  line: number;
  indent: number;
  head: string;
  args: Token[];
  children: Stmt[];
}

export type Severity = 'error' | 'warning';

export interface Diag {
  line: number;
  severity: Severity;
  msg: string;
}

export interface Entity {
  id: string;
  kind: string;
  pack: string;
  label: string;
  /** secondary label, e.g. an IP address */
  sub?: string;
  props: Record<string, string>;
  line: number;
}

export interface Ask {
  line: number;
  question: string;
  options: string[];
  answer: number; // index into options
}

export interface Goal {
  line: number;
  label: string;
  check(rt: Runtime): boolean;
}

export interface Action {
  line: number;
  /** short human description, used in logs and simulate() output */
  text: string;
  run(rt: Runtime): Promise<void> | void;
}

export interface Step {
  line: number;
  text: string;
  say: string[];
  hints: string[];
  actions: Action[];
  asks: Ask[];
  goals: Goal[];
}

export interface Scene {
  id: string;
  title: string;
  about: string;
  packs: string[];
  entities: Entity[];
  links: [string, string][];
  steps: Step[];
  /** per-pack compile-time data (e.g. firewall rules), keyed by pack name */
  data: Record<string, unknown>;
}

export type Tone = 'ok' | 'bad' | 'warn' | 'info' | 'reply';

export interface TravelOpts {
  tone?: Tone;
  label?: string;
  dashed?: boolean;
}

/** Visual side-effects. The web Stage animates them; headless runs record them. */
export interface Effects {
  travel(path: string[], o?: TravelOpts): Promise<void>;
  flash(id: string, tone: Tone): Promise<void>;
  highlight(id: string): void;
  note(id: string, text: string): void;
  setDown(id: string, down: boolean): void;
  log(msg: string, tone?: Tone): void;
  wait(ms: number): Promise<void>;
  /** persistent tag on a node (e.g. "you are here"); null removes it */
  badge(id: string, text: string | null): void;
  /** change a node's secondary label (e.g. new permissions) */
  setSub(id: string, text: string): void;
  /** graph changes at runtime (e.g. a file was created); the stage re-lays out */
  addNode(e: Entity, linkTo?: string): void;
  /** removes the node and everything whose id starts with `${id}/` */
  removeNode(id: string): void;
}

export interface Runtime {
  scene: Scene;
  /** per-pack mutable simulation state */
  state: Record<string, any>;
  fx: Effects;
  headless: boolean;
  /** resolves when the learner answers correctly (or skips); immediate when headless */
  ask(a: Ask): Promise<void>;
}

export interface CompileCtx {
  scene: Scene;
  error(line: number, msg: string): void;
  warn(line: number, msg: string): void;
  /** look up an entity, reporting a helpful error (with suggestion) when missing */
  entity(id: string, line: number): Entity | undefined;
  hasEntity(id: string): boolean;
  /** packs may generate entities (e.g. a filesystem tree); returns false on duplicate id */
  addEntity(e: Entity): boolean;
  addLink(a: string, b: string): void;
}

export interface EntityKind {
  about: string;
  /** layout tier: lower tiers are placed further left */
  tier: number;
  /** name of the optional first positional value, shown as sub-label (e.g. "ip") */
  sub?: string;
  /** allowed key=value props besides the common ones (label, info, col) */
  props?: Record<string, string>;
  /** UI colour family for this kind: mustard | mint | lilac | peach | sky | rose */
  swatch?: string;
}

export interface VerbDef {
  usage: string;
  /** "A send B:80" style: the verb takes a subject entity before it */
  subject?: boolean;
  compile(subject: Entity | undefined, args: Token[], s: Stmt, c: CompileCtx): Action | null;
}

export interface DirectiveDef {
  usage: string;
  compile(s: Stmt, c: CompileCtx): void;
}

export interface PackDef {
  name: string;
  about: string;
  entities: Record<string, EntityKind>;
  directives?: Record<string, DirectiveDef>;
  verbs?: Record<string, VerbDef>;
  goalUsage?: string;
  parseGoal?(text: string, line: number, c: CompileCtx): Goal | null;
  /** SVG markup per entity kind, drawn in a 48x48 box centered on the node */
  icons?: Record<string, string>;
  initState?(scene: Scene): unknown;
  /** clear state that steps create (e.g. failed nodes) while keeping learner edits */
  resetTransient?(state: any): void;
  /** draw state that exists before any step runs (called after reset) */
  present?(state: any, fx: Effects): void;
  /** extra lines for the inspector when a node is clicked */
  describe?(state: any, id: string): string[] | null;
  exportUser?(state: any): unknown;
  importUser?(state: any, data: unknown): void;
  /** compact cheat-sheet for AI authors; keep it short, it is sent as tokens */
  vocab: string;
}

export type PackRegistry = Record<string, PackDef>;
