/**
 * robots.txt reader. Covers User-agent groups (several groups for one agent are merged),
 * Allow, Disallow, longest match wins (Allow wins a tie), `*` and `$`, Crawl-delay and Sitemap lines.
 * Not a full RFC 9309 implementation: no percent-encoding normalisation, and an agent is matched
 * by its exact product token (case-insensitive), with a fall back to the `*` group.
 */

export interface Rule {
  type: "allow" | "disallow";
  pattern: string;
}

export interface RobotsGroup {
  agents: string[];
  rules: Rule[];
  crawlDelay?: number;
}

export interface ParsedRobots {
  groups: RobotsGroup[];
  sitemaps: string[];
}

export function parseRobots(text: string): ParsedRobots {
  const groups: RobotsGroup[] = [];
  const sitemaps: string[] = [];
  let current: RobotsGroup | null = null;
  let lastWasAgent = false;

  for (const raw of text.replace(/^﻿/, "").split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, "").trim();
    if (!line) continue;
    const idx = line.indexOf(":");
    if (idx < 0) continue;
    const field = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();

    if (field === "sitemap") {
      if (value) sitemaps.push(value);
      continue; // does not end or start a group
    }
    if (field === "user-agent") {
      if (!current || !lastWasAgent) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (!current) continue;
    if (field === "allow" || field === "disallow") {
      if (value === "") continue; // an empty Disallow means "allow everything"
      current.rules.push({ type: field, pattern: value });
    } else if (field === "crawl-delay") {
      const n = Number.parseFloat(value);
      if (Number.isFinite(n) && n >= 0) current.crawlDelay = n;
    }
  }
  return { groups, sitemaps };
}

export interface EffectiveRules {
  /** Which group applied: the agent's own, the `*` group, or none at all. */
  matched: "specific" | "wildcard" | "none";
  rules: Rule[];
  crawlDelay?: number;
}

export function rulesFor(robots: ParsedRobots, agentToken: string): EffectiveRules {
  const token = agentToken.toLowerCase();
  const specific = robots.groups.filter((g) => g.agents.includes(token));
  const chosen = specific.length > 0 ? specific : robots.groups.filter((g) => g.agents.includes("*"));
  const matched = specific.length > 0 ? "specific" : chosen.length > 0 ? "wildcard" : "none";
  const delays = chosen.map((g) => g.crawlDelay).filter((d): d is number => d !== undefined);
  const out: EffectiveRules = { matched, rules: chosen.flatMap((g) => g.rules) };
  if (delays.length > 0) out.crawlDelay = Math.max(...delays);
  return out;
}

function escapeRegex(s: string): string {
  return s.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
}

function matches(pattern: string, target: string): boolean {
  const anchored = pattern.endsWith("$");
  const body = anchored ? pattern.slice(0, -1) : pattern;
  const re = new RegExp("^" + body.split("*").map(escapeRegex).join(".*") + (anchored ? "$" : ""));
  return re.test(target);
}

export interface Verdict {
  allowed: boolean;
  /** The rule that decided it, for example `Disallow: /private/`. Absent when no rule matched. */
  rule?: string;
}

export function evaluate(rules: Rule[], pathAndQuery: string): Verdict {
  if (pathAndQuery === "/robots.txt") return { allowed: true };
  let best: { len: number; rule: Rule } | null = null;
  for (const rule of rules) {
    if (!matches(rule.pattern, pathAndQuery)) continue;
    const len = rule.pattern.length;
    if (!best || len > best.len || (len === best.len && rule.type === "allow")) best = { len, rule };
  }
  if (!best) return { allowed: true };
  const label = `${best.rule.type === "allow" ? "Allow" : "Disallow"}: ${best.rule.pattern}`;
  return { allowed: best.rule.type === "allow", rule: label };
}

export function isAllowed(robots: ParsedRobots | null, agentToken: string, pathAndQuery: string): Verdict {
  if (!robots) return { allowed: true };
  return evaluate(rulesFor(robots, agentToken).rules, pathAndQuery);
}
