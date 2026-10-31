/**
 * JSON-LD extraction and a best-effort property check.
 *
 * The required/recommended lists below were written from the public schema.org definitions and
 * Google's structured data documentation as the author understood them. They were NOT validated
 * with Google's Rich Results Test or Schema Markup Validator, and Google changes its requirements.
 * Treat a finding here as "worth checking", not as a verdict on rich-result eligibility.
 */

import type { JsonLdScript } from "./html.js";

export interface JsonLdParseError {
  message: string;
  /** 1-based line in the HTML document. */
  line: number;
  /** 1-based column within that line when the position is known, otherwise null. */
  column: number | null;
}

export interface JsonLdBlock {
  index: number;
  line: number;
  ok: boolean;
  data?: unknown;
  error?: JsonLdParseError;
}

export function parseJsonLdBlocks(scripts: JsonLdScript[]): JsonLdBlock[] {
  return scripts.map((s, index) => {
    if (s.raw.trim() === "") {
      return { index, line: s.line, ok: false, error: { message: "empty JSON-LD block", line: s.line, column: null } };
    }
    try {
      return { index, line: s.line, ok: true, data: JSON.parse(s.raw) as unknown };
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      const m = /position (\d+)/.exec(message);
      let line = s.line;
      let column: number | null = null;
      if (m) {
        const pos = Math.min(Number(m[1]), s.raw.length);
        const before = s.raw.slice(0, pos);
        const nl = before.split("\n");
        line = s.line + nl.length - 1;
        column = (nl[nl.length - 1] ?? "").length + 1;
      }
      return { index, line: s.line, ok: false, error: { message, line, column } };
    }
  });
}

type Obj = Record<string, unknown>;

export interface Entity {
  blockIndex: number;
  types: string[];
  id: string | null;
  node: Obj;
}

function isObj(v: unknown): v is Obj {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function typesOf(node: Obj): string[] {
  const t = node["@type"];
  if (typeof t === "string") return [t];
  if (Array.isArray(t)) return t.filter((x): x is string => typeof x === "string");
  return [];
}

/** Top-level objects and the members of @graph. Nested objects are validated by their parent's rules. */
export function collectEntities(blocks: JsonLdBlock[]): { entities: Entity[]; missingContext: number[]; missingType: number[] } {
  const entities: Entity[] = [];
  const missingContext: number[] = [];
  const missingType: number[] = [];
  for (const b of blocks) {
    if (!b.ok) continue;
    const roots = Array.isArray(b.data) ? b.data : [b.data];
    for (const root of roots) {
      if (!isObj(root)) continue;
      const ctx = root["@context"];
      const hasSchemaContext = typeof ctx === "string" ? /schema\.org/i.test(ctx) : Array.isArray(ctx) ? ctx.some((c) => typeof c === "string" && /schema\.org/i.test(c)) : isObj(ctx);
      if (!hasSchemaContext && !missingContext.includes(b.index)) missingContext.push(b.index);
      const nodes = Array.isArray(root["@graph"]) ? (root["@graph"] as unknown[]) : [root];
      for (const n of nodes) {
        if (!isObj(n)) continue;
        const types = typesOf(n);
        if (types.length === 0) {
          if (!missingType.includes(b.index)) missingType.push(b.index);
          continue;
        }
        const id = typeof n["@id"] === "string" ? (n["@id"] as string) : null;
        entities.push({ blockIndex: b.index, types, id, node: n });
      }
    }
  }
  return { entities, missingContext, missingType };
}

function present(v: unknown): boolean {
  if (v === undefined || v === null) return false;
  if (typeof v === "string") return v.trim() !== "";
  if (Array.isArray(v)) return v.some(present);
  if (isObj(v)) return Object.keys(v).length > 0;
  return true;
}

function firstObj(v: unknown): Obj | null {
  if (isObj(v)) return v;
  if (Array.isArray(v)) return (v.find(isObj) as Obj | undefined) ?? null;
  return null;
}

function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : v === undefined ? [] : [v];
}

export interface EntityProblems {
  type: string;
  missingRequired: string[];
  missingRecommended: string[];
}

interface TypeRule {
  /** Each entry is one requirement; "a|b" means at least one of a or b. */
  required: string[];
  recommended: string[];
  /** Extra structural checks that return human-readable problems (added to missingRequired). */
  extra?: (node: Obj) => string[];
}

const ARTICLE_RULE: TypeRule = {
  required: ["headline", "author", "datePublished"],
  recommended: ["image", "dateModified", "publisher"],
  extra: (n) => {
    const out: string[] = [];
    for (const a of asArray(n["author"])) {
      if (isObj(a) && !present(a["name"])) out.push("author has no name");
    }
    return out;
  },
};

const OFFER_PROBLEMS = (offers: unknown): string[] => {
  const out: string[] = [];
  for (const o of asArray(offers)) {
    if (!isObj(o)) continue;
    const agg = typesOf(o).includes("AggregateOffer");
    if (agg) {
      if (!present(o["lowPrice"]) && !present(o["price"])) out.push("offers.lowPrice");
    } else if (!present(o["price"]) && !present(o["priceSpecification"])) out.push("offers.price");
    if (!present(o["priceCurrency"]) && !present(o["priceSpecification"])) out.push("offers.priceCurrency");
  }
  return out;
};

export const TYPE_RULES: Record<string, TypeRule> = {
  Person: { required: ["name"], recommended: ["url", "sameAs", "image", "jobTitle"] },
  Organization: { required: ["name"], recommended: ["url", "logo", "sameAs", "contactPoint"] },
  Article: ARTICLE_RULE,
  NewsArticle: ARTICLE_RULE,
  BlogPosting: ARTICLE_RULE,
  Product: {
    required: ["name", "offers|review|aggregateRating"],
    recommended: ["image", "description", "sku", "brand"],
    extra: (n) => OFFER_PROBLEMS(n["offers"]),
  },
  BreadcrumbList: {
    required: ["itemListElement"],
    recommended: [],
    extra: (n) => {
      const items = asArray(n["itemListElement"]).filter(isObj);
      const out: string[] = [];
      if (items.length > 0 && items.length < 2) out.push("itemListElement has fewer than 2 items");
      items.forEach((it, i) => {
        if (!present(it["position"])) out.push(`item ${i + 1} has no position`);
        const inner = firstObj(it["item"]);
        if (!present(it["name"]) && !(inner && present(inner["name"]))) out.push(`item ${i + 1} has no name`);
        if (!present(it["item"]) && i < items.length - 1) out.push(`item ${i + 1} has no item URL`);
      });
      return out;
    },
  },
  FAQPage: {
    required: ["mainEntity"],
    recommended: [],
    extra: (n) => {
      const out: string[] = [];
      asArray(n["mainEntity"]).filter(isObj).forEach((q, i) => {
        if (!present(q["name"])) out.push(`question ${i + 1} has no name`);
        const ans = firstObj(q["acceptedAnswer"]);
        if (!ans || !present(ans["text"])) out.push(`question ${i + 1} has no acceptedAnswer.text`);
      });
      return out;
    },
  },
  PodcastEpisode: {
    // schema.org type; Google documents no rich result for it, so these are practical minimums.
    required: ["name"],
    recommended: ["url", "datePublished", "description", "duration", "associatedMedia|audio", "partOfSeries"],
  },
  Book: {
    required: ["name", "author"],
    recommended: ["isbn", "url", "sameAs", "workExample"],
  },
};

function hasAny(node: Obj, spec: string): boolean {
  return spec.split("|").some((k) => present(node[k]));
}

export function validateEntity(entity: Entity): EntityProblems[] {
  const out: EntityProblems[] = [];
  for (const type of entity.types) {
    const rule = TYPE_RULES[type];
    if (!rule) continue;
    const missingRequired = rule.required.filter((r) => !hasAny(entity.node, r));
    if (rule.extra) missingRequired.push(...rule.extra(entity.node));
    const missingRecommended = rule.recommended.filter((r) => !hasAny(entity.node, r));
    out.push({ type, missingRequired, missingRecommended });
  }
  return out;
}

function stable(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stable).join(",")}]`;
  if (isObj(v)) return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${stable(v[k])}`).join(",")}}`;
  return JSON.stringify(v) ?? "null";
}

export interface EntityClash {
  kind: "duplicate" | "conflict";
  key: string;
  detail: string;
}

/**
 * Entities that share an @id (or, without an @id, the same type and name) within one set.
 * Identical copies are "duplicate"; copies that differ in a shared property are "conflict".
 */
export function findClashes(entities: Entity[]): EntityClash[] {
  const groups = new Map<string, Entity[]>();
  for (const e of entities) {
    const name = typeof e.node["name"] === "string" ? (e.node["name"] as string) : null;
    const key = e.id ? `@id ${e.id}` : name ? `${e.types[0]} "${name}"` : null;
    if (!key) continue;
    const list = groups.get(key);
    if (list) list.push(e);
    else groups.set(key, [e]);
  }
  const out: EntityClash[] = [];
  for (const [key, list] of groups) {
    if (list.length < 2) continue;
    const first = list[0] as Entity;
    const diffs = new Set<string>();
    for (const other of list.slice(1)) {
      for (const k of Object.keys(first.node)) {
        if (k.startsWith("@") || !(k in other.node)) continue;
        if (stable(first.node[k]) !== stable(other.node[k])) diffs.add(k);
      }
    }
    if (diffs.size > 0) {
      out.push({ kind: "conflict", key, detail: `${list.length} entities for ${key} disagree on: ${[...diffs].join(", ")}` });
    } else {
      out.push({ kind: "duplicate", key, detail: `${list.length} copies of ${key}` });
    }
  }
  return out;
}

export interface PageStructuredData {
  blocks: JsonLdBlock[];
  entities: Entity[];
  types: string[];
  parseErrors: { block: number; error: JsonLdParseError }[];
  missingContext: number[];
  missingType: number[];
  problems: (EntityProblems & { blockIndex: number })[];
  clashes: EntityClash[];
}

export function analyzeJsonLd(scripts: JsonLdScript[]): PageStructuredData {
  const blocks = parseJsonLdBlocks(scripts);
  const { entities, missingContext, missingType } = collectEntities(blocks);
  const problems: (EntityProblems & { blockIndex: number })[] = [];
  for (const e of entities) for (const p of validateEntity(e)) problems.push({ ...p, blockIndex: e.blockIndex });
  return {
    blocks,
    entities,
    types: [...new Set(entities.flatMap((e) => e.types))],
    parseErrors: blocks.filter((b) => !b.ok && b.error).map((b) => ({ block: b.index, error: b.error as JsonLdParseError })),
    missingContext,
    missingType,
    problems,
    clashes: findClashes(entities),
  };
}
