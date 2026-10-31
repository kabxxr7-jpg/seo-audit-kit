import { rulesFor, evaluate, type ParsedRobots } from "./robots.js";

export type BotKind = "search" | "ai-crawler" | "ai-control-token";

export interface BotDef {
  name: string;
  kind: BotKind;
  note: string;
}

/**
 * Bots checked against robots.txt. Descriptions are deliberately generic; vendor documentation is the
 * authority on what each token controls, and it changes.
 */
export const NAMED_BOTS: BotDef[] = [
  { name: "Googlebot", kind: "search", note: "Web search crawler" },
  { name: "Bingbot", kind: "search", note: "Web search crawler" },
  { name: "GPTBot", kind: "ai-crawler", note: "AI company crawler" },
  { name: "ClaudeBot", kind: "ai-crawler", note: "AI company crawler" },
  { name: "PerplexityBot", kind: "ai-crawler", note: "AI search crawler" },
  { name: "CCBot", kind: "ai-crawler", note: "Open web-archive crawler, widely used as AI training input" },
  { name: "Google-Extended", kind: "ai-control-token", note: "robots.txt token only (no separate crawler): controls use of content by the vendor's AI products" },
  { name: "Applebot-Extended", kind: "ai-control-token", note: "robots.txt token only (no separate crawler): controls use of content by the vendor's AI products" },
];

export interface BotPathResult {
  path: string;
  allowed: boolean;
  rule?: string;
}

export interface BotAccessRow {
  bot: string;
  kind: BotKind;
  note: string;
  /** Which robots.txt group applied to this bot. */
  matchedGroup: "specific" | "wildcard" | "none";
  results: BotPathResult[];
}

/** `paths[0]` should be the home page ("/"). With no robots.txt (null) everything is allowed. */
export function botAccessReport(robots: ParsedRobots | null, paths: string[]): BotAccessRow[] {
  return NAMED_BOTS.map((bot) => {
    const eff = robots ? rulesFor(robots, bot.name) : { matched: "none" as const, rules: [] };
    const results = paths.map((path) => {
      const v = evaluate(eff.rules, path);
      const r: BotPathResult = { path, allowed: v.allowed };
      if (v.rule) r.rule = v.rule;
      return r;
    });
    return { bot: bot.name, kind: bot.kind, note: bot.note, matchedGroup: eff.matched, results };
  });
}

/** Home page first, then caller-supplied paths, sitemap files, and the ten best-linked crawled pages (at most 16 paths). */
export function chooseKeyPaths(opts: { sitemapPaths: string[]; extra: string[]; linkedPages: { path: string; inlinks: number }[]; max?: number }): string[] {
  const max = opts.max ?? 16;
  const out: string[] = ["/"];
  const add = (p: string): void => {
    if (!out.includes(p) && out.length < max) out.push(p);
  };
  for (const p of opts.extra) add(p.startsWith("/") ? p : `/${p}`);
  for (const p of opts.sitemapPaths) add(p);
  [...opts.linkedPages].sort((a, b) => b.inlinks - a.inlinks || a.path.localeCompare(b.path)).slice(0, 10).forEach((l) => add(l.path));
  return out;
}
