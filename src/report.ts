import type { AuditResult } from "./audit.js";
import { SEVERITY_ORDER, type Severity } from "./catalog.js";

const EXAMPLES_SHOWN = 5;

/** Keeps text from page content (titles, snippets) from being read as markdown HTML. */
function safe(s: string): string {
  return s.replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function cell(s: string): string {
  return s.replace(/\|/g, "\\|").replace(/\n/g, " ");
}

const SEVERITY_LABEL: Record<Severity, string> = {
  high: "High priority",
  medium: "Medium priority",
  low: "Low priority",
};

export function renderJson(result: AuditResult): string {
  return JSON.stringify(result, null, 2) + "\n";
}

export function renderMarkdown(r: AuditResult): string {
  const L: string[] = [];
  L.push(`# SEO audit: ${r.target}`);
  L.push("");
  L.push(`Generated ${r.generatedAt} by ${r.tool.name} ${r.tool.version}. Read-only crawl, same origin only, robots.txt obeyed, identified as \`${r.settings.userAgent}\`. There is no score: issues are listed by priority.`);
  L.push("");

  if (r.crawl.refused) {
    L.push(`> **The crawl did not run.** ${r.crawl.refused.detail}`);
    L.push("");
  }

  // Summary
  L.push("## Summary");
  L.push("");
  L.push(`- Pages fetched: **${r.crawl.pagesFetched}** (limit ${r.settings.maxPages}${r.crawl.capReached ? ", **limit reached, the audit is partial**" : ""}), ${r.crawl.requests} HTTP requests, ${r.settings.delayMs > 0 ? `at least ${r.settings.delayMs} ms between requests` : "no pause between requests (--delay-ms 0)"}.`);
  L.push(`- Issues found: **${r.counts.high} high**, **${r.counts.medium} medium**, **${r.counts.low} low** (${r.counts.issueTypes} kinds, ${r.counts.occurrences} occurrences).`);
  L.push("");
  if (r.issues.length > 0) {
    L.push("| Priority | Issue | URLs affected |");
    L.push("|---|---|---|");
    for (const i of r.issues) L.push(`| ${i.severity} | ${cell(i.title)} (\`${i.id}\`) | ${i.count} |`);
    L.push("");
  } else if (!r.crawl.refused) {
    L.push("No issues were found by the checks that were run. See \"What was not checked\" below before reading that as a clean bill of health.");
    L.push("");
  }

  // Crawl overview
  L.push("## Crawl overview");
  L.push("");
  const statuses = Object.entries(r.crawl.statusCounts).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}: ${v}`).join(", ");
  L.push(`- First-response status codes: ${statuses || "none"}. URLs that redirected: ${r.crawl.redirectedUrls}.`);
  L.push(`- robots.txt: ${r.crawl.robotsFound === null ? "not read" : r.crawl.robotsFound ? "found" : "not found"}; ${r.crawl.robotsBlocked} URL(s) skipped because it disallows them for this crawler.`);
  L.push(`- Sitemap: ${r.crawl.sitemapFiles} file(s), ${r.crawl.sitemapUrls} URL(s); ${r.crawl.sitemapUrlsCrawled} of the same-origin ones were crawled${r.crawl.sitemapUrlsNotCrawled.length > 0 ? `, ${r.crawl.sitemapUrlsNotCrawled.length} were not` : ""}.`);
  if (r.crawl.sitemapUrlsNotCrawled.length > 0) {
    L.push(`  - In sitemap, not crawled (page limit): ${r.crawl.sitemapUrlsNotCrawled.slice(0, EXAMPLES_SHOWN).map((u) => `\`${u}\``).join(", ")}${r.crawl.sitemapUrlsNotCrawled.length > EXAMPLES_SHOWN ? ", ..." : ""}`);
  }
  if (r.crawl.crawledNotInSitemap.length > 0) {
    L.push(`  - Crawled and indexable, not in sitemap: ${r.crawl.crawledNotInSitemap.slice(0, EXAMPLES_SHOWN).map((u) => `\`${u}\``).join(", ")}${r.crawl.crawledNotInSitemap.length > EXAMPLES_SHOWN ? ", ..." : ""}`);
  }
  L.push("");
  if (r.pages.length > 0) {
    L.push("| URL | Status | Redirects | Time (ms) | Type | Words |");
    L.push("|---|---|---|---|---|---|");
    for (const p of r.pages.slice(0, 15)) {
      L.push(`| ${cell(p.url)} | ${p.status === p.finalStatus || p.redirectChain.length === 0 ? p.status : `${p.status} -> ${p.finalStatus}`} | ${p.redirectChain.length} | ${p.timeMs} | ${cell(p.contentType?.split(";")[0] ?? "-")} | ${p.words ?? "-"} |`);
    }
    if (r.pages.length > 15) L.push(`| ... ${r.pages.length - 15} more pages in the JSON report | | | | | |`);
    L.push("");
  }

  // Issues
  L.push("## Issues");
  L.push("");
  if (r.issues.length === 0) L.push("None.\n");
  for (const sev of SEVERITY_ORDER) {
    const list = r.issues.filter((i) => i.severity === sev);
    if (list.length === 0) continue;
    L.push(`### ${SEVERITY_LABEL[sev]}`);
    L.push("");
    for (const i of list) {
      L.push(`#### ${i.title} (\`${i.id}\`): ${i.count} URL${i.count === 1 ? "" : "s"}`);
      L.push("");
      L.push(`**Why it matters:** ${i.why}`);
      L.push("");
      L.push(`**How to fix:** ${i.fix}`);
      L.push("");
      L.push("Examples:");
      const shown = i.examples.slice(0, EXAMPLES_SHOWN);
      for (const e of shown) L.push(`- ${e.url}${e.detail ? ` - ${safe(e.detail)}` : ""}`);
      const rest = i.examples.length - shown.length;
      if (rest > 0 || i.count > i.examples.length) L.push(`- ... and ${Math.max(rest, 0)} more occurrence(s) listed in the JSON report`);
      L.push("");
    }
  }

  // Bots
  L.push("## Crawler and AI-bot access (robots.txt)");
  L.push("");
  L.push("Whether each named bot may fetch the home page and key paths, according to robots.txt only. This says what robots.txt asks for; it does not prove that a bot obeys it or that a page is indexed or used.");
  L.push("");
  const rows = r.bots.rows;
  L.push(`| Path | ${rows.map((x) => x.bot).join(" | ")} |`);
  L.push(`|---|${rows.map(() => "---").join("|")}|`);
  r.bots.paths.forEach((path, i) => {
    const cells = rows.map((row) => {
      const x = row.results[i];
      return !x || x.allowed ? "allowed" : `**blocked** (${cell(x.rule ?? "")})`;
    });
    L.push(`| ${cell(path)} | ${cells.join(" | ")} |`);
  });
  L.push("");
  L.push(`Robots.txt group that applied: ${rows.map((x) => `${x.bot} = ${x.matchedGroup === "specific" ? "its own group" : x.matchedGroup === "wildcard" ? "the * group" : "no group (nothing disallowed)"}`).join("; ")}.`);
  L.push("");
  L.push("`Google-Extended` and `Applebot-Extended` are robots.txt tokens, not crawlers: they control whether the vendor may use content that was already fetched by its normal crawler.");
  L.push("");

  // Raw HTML
  L.push("## Content visible without JavaScript");
  L.push("");
  L.push("Words of main content found in the raw HTML response (before any JavaScript), lowest first. A near-empty page is flagged as probably client-rendered.");
  L.push("");
  L.push("| URL | Words (raw HTML) |");
  L.push("|---|---|");
  for (const p of r.rawHtml.lowestWordCounts) L.push(`| ${cell(p.url)} | ${p.words} |`);
  L.push("");
  if (r.settings.renderEnabled) {
    L.push("Rendered in a headless browser for comparison:");
    L.push("");
    L.push("| URL | Raw words | Rendered words |");
    L.push("|---|---|---|");
    for (const x of r.rawHtml.rendered) L.push(`| ${cell(x.url)} | ${x.rawWords} | ${x.renderedWords} |`);
    L.push("");
  }

  // Structured data
  L.push("## Structured data (JSON-LD)");
  L.push("");
  const types = Object.entries(r.structuredData.typeCounts);
  if (types.length === 0) L.push(`No valid JSON-LD entities were found${r.structuredData.blocks > 0 ? ` (${r.structuredData.blocks} block(s) present)` : ""}.`);
  else L.push(`${r.structuredData.pagesWithJsonLd} page(s) with JSON-LD, ${r.structuredData.blocks} block(s). Entity types found: ${types.map(([t, n]) => `${t} x${n}`).join(", ")}.`);
  L.push("");
  L.push("Property checks are best-effort and were **not** validated with Google's Rich Results Test.");
  L.push("");

  // Not checked
  L.push("## What was not checked");
  L.push("");
  for (const n of r.notChecked) L.push(`- ${n}`);
  L.push("");
  return L.join("\n");
}
