import { botAccessReport, chooseKeyPaths, type BotAccessRow } from "./bots.js";
import { CATALOG, SEVERITY_ORDER, type CheckId, type Severity } from "./catalog.js";
import { DEFAULT_THRESHOLDS, isNoindex, runChecks, type Finding, type Thresholds } from "./checks.js";
import { crawl, type CrawlOptions, type CrawlResult } from "./crawler.js";
import { TOOL_NAME, TOOL_VERSION } from "./http.js";
import { parseHtml } from "./html.js";
import { analyzeJsonLd, type PageStructuredData } from "./jsonld.js";
import type { RenderFn } from "./render.js";

export interface AuditOptions extends CrawlOptions {
  thresholds?: Partial<Thresholds>;
  /** Extra paths to include in the crawler/AI-bot access matrix. */
  keyPaths?: string[];
  /** Optional headless-browser renderer; when set, a few of the thinnest pages are compared raw vs rendered. */
  render?: { fn: RenderFn; limit?: number };
  /** Clock used for the report timestamp (the crawl's own `now` is a number clock). */
  clock?: () => Date;
}

export interface IssueExample {
  url: string;
  detail?: string;
}

export interface Issue {
  id: CheckId;
  severity: Severity;
  title: string;
  why: string;
  fix: string;
  /** Distinct URLs affected. */
  count: number;
  /** All examples (capped at MAX_AFFECTED); renderers show only the first few. */
  examples: IssueExample[];
}

export const MAX_AFFECTED = 200;

export interface PageSummary {
  url: string;
  finalUrl: string;
  status: number;
  finalStatus: number;
  redirectChain: { url: string; status: number; location: string }[];
  timeMs: number;
  contentType: string | null;
  depth: number;
  source: string;
  words: number | null;
  title: string | null;
  indexable: boolean | null;
  inlinks: number;
}

export interface AuditResult {
  tool: { name: string; version: string };
  generatedAt: string;
  target: string;
  origin: string;
  settings: {
    maxPages: number;
    maxDepth: number;
    delayMs: number;
    userAgent: string;
    thresholds: Thresholds;
    renderEnabled: boolean;
  };
  crawl: {
    refused: CrawlResult["refused"];
    pagesFetched: number;
    requests: number;
    capReached: boolean;
    statusCounts: Record<string, number>;
    redirectedUrls: number;
    robotsFound: boolean | null;
    robotsBlocked: number;
    notCrawled: number;
    skippedFiles: number;
    sitemapFiles: number;
    sitemapUrls: number;
    sitemapUrlsCrawled: number;
    sitemapUrlsNotCrawled: string[];
    crawledNotInSitemap: string[];
  };
  counts: { high: number; medium: number; low: number; issueTypes: number; occurrences: number };
  issues: Issue[];
  pages: PageSummary[];
  bots: { paths: string[]; rows: BotAccessRow[] };
  structuredData: {
    pagesWithJsonLd: number;
    blocks: number;
    typeCounts: Record<string, number>;
    perPage: { url: string; types: string[]; blocks: number; parseErrors: number }[];
  };
  rawHtml: { lowestWordCounts: { url: string; words: number }[]; rendered: { url: string; rawWords: number; renderedWords: number }[]; renderErrors: string[] };
  notChecked: string[];
}

function bucket(status: number): string {
  if (status === 0) return "no response";
  return `${Math.floor(status / 100)}xx`;
}

export function groupFindings(findings: Finding[]): Issue[] {
  const byId = new Map<CheckId, Finding[]>();
  for (const f of findings) {
    const list = byId.get(f.id);
    if (list) list.push(f);
    else byId.set(f.id, [f]);
  }
  const issues: Issue[] = [];
  for (const [id, list] of byId) {
    const def = CATALOG[id];
    const urls = new Set(list.map((f) => f.url));
    issues.push({
      id,
      severity: def.severity,
      title: def.title,
      why: def.why,
      fix: def.fix,
      count: urls.size,
      examples: list.slice(0, MAX_AFFECTED).map((f) => (f.detail === undefined ? { url: f.url } : { url: f.url, detail: f.detail })),
    });
  }
  issues.sort((a, b) => SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity) || b.count - a.count || a.id.localeCompare(b.id));
  return issues;
}

export async function runAudit(opts: AuditOptions): Promise<AuditResult> {
  const thresholds: Thresholds = { ...DEFAULT_THRESHOLDS, ...(opts.thresholds ?? {}) };
  const c = await crawl(opts);
  const content = c.pages.filter((p) => p.page !== null);

  // Structured data
  const structured = new Map<string, PageStructuredData>();
  for (const rec of content) {
    if (rec.page && rec.page.jsonLd.length > 0) structured.set(rec.url, analyzeJsonLd(rec.page.jsonLd));
  }

  // Crawler / AI-bot matrix
  const sitemapPaths = c.sitemap.files.filter((f) => f.kind !== "invalid").map((f) => new URL(f.url).pathname);
  const keyPaths = chooseKeyPaths({
    sitemapPaths,
    extra: opts.keyPaths ?? [],
    linkedPages: content.map((r) => ({ path: new URL(r.url).pathname, inlinks: r.inlinks.length })),
  });
  const bots = botAccessReport(c.robots?.parsed ?? null, keyPaths);

  // Optional rendering: the thinnest pages first.
  const rendered = new Map<string, number>();
  const renderErrors: string[] = [];
  if (opts.render) {
    const limit = Math.max(0, Math.min(opts.render.limit ?? 5, 20));
    const candidates = [...content].sort((a, b) => (a.page?.wordCount ?? 0) - (b.page?.wordCount ?? 0)).slice(0, limit);
    for (const rec of candidates) {
      try {
        const html = await opts.render.fn(rec.url);
        rendered.set(rec.url, parseHtml(html).wordCount);
      } catch (e) {
        renderErrors.push(`${rec.url}: ${e instanceof Error ? e.message.split("\n")[0] : String(e)}`);
      }
    }
  }

  const findings = runChecks({ crawl: c, bots, structured, thresholds, ...(opts.render ? { rendered } : {}) });
  const issues = groupFindings(findings);
  const counts = {
    high: issues.filter((i) => i.severity === "high").length,
    medium: issues.filter((i) => i.severity === "medium").length,
    low: issues.filter((i) => i.severity === "low").length,
    issueTypes: issues.length,
    occurrences: findings.length,
  };

  const statusCounts: Record<string, number> = {};
  for (const p of c.pages) statusCounts[bucket(p.status)] = (statusCounts[bucket(p.status)] ?? 0) + 1;

  const sitemapSet = new Set(c.sitemap.urls);
  const sameOriginSitemap = c.sitemap.urls.filter((u) => u.startsWith(c.origin + "/") || u === c.origin);
  const sitemapUrlsNotCrawled = sameOriginSitemap.filter((u) => !c.byUrl.has(u));
  const crawledNotInSitemap =
    c.sitemap.urls.length > 0 ? content.filter((p) => !isNoindex(p) && !sitemapSet.has(p.url)).map((p) => p.url) : [];

  const typeCounts: Record<string, number> = {};
  let blocks = 0;
  const perPage: AuditResult["structuredData"]["perPage"] = [];
  for (const [url, sd] of structured) {
    blocks += sd.blocks.length;
    for (const t of sd.entities.flatMap((e) => e.types)) typeCounts[t] = (typeCounts[t] ?? 0) + 1;
    perPage.push({ url, types: sd.types, blocks: sd.blocks.length, parseErrors: sd.parseErrors.length });
  }

  const pages: PageSummary[] = c.pages.map((p) => ({
    url: p.url,
    finalUrl: p.finalUrl,
    status: p.status,
    finalStatus: p.finalStatus,
    redirectChain: p.redirectChain,
    timeMs: p.timeMs,
    contentType: p.contentType,
    depth: p.depth,
    source: p.source,
    words: p.page ? p.page.wordCount : null,
    title: p.page ? p.page.title : null,
    indexable: p.page ? !isNoindex(p) : null,
    inlinks: p.inlinks.length,
  }));

  const notChecked = buildNotChecked(c, opts, rendered.size, renderErrors);

  return {
    tool: { name: TOOL_NAME, version: TOOL_VERSION },
    generatedAt: (opts.clock ?? (() => new Date()))().toISOString(),
    target: c.startUrl,
    origin: c.origin,
    settings: {
      maxPages: c.maxPages,
      maxDepth: c.maxDepth,
      delayMs: c.effectiveDelayMs,
      userAgent: c.userAgent,
      thresholds,
      renderEnabled: opts.render !== undefined,
    },
    crawl: {
      refused: c.refused,
      pagesFetched: c.pages.length,
      requests: c.requests,
      capReached: c.capReached,
      statusCounts,
      redirectedUrls: c.pages.filter((p) => p.redirectChain.length > 0).length,
      robotsFound: c.robots ? c.robots.found : null,
      robotsBlocked: c.robotsBlocked.length,
      notCrawled: c.notCrawled.length,
      skippedFiles: c.skipped.length,
      sitemapFiles: c.sitemap.files.filter((f) => f.kind !== "invalid").length,
      sitemapUrls: c.sitemap.urls.length,
      sitemapUrlsCrawled: sameOriginSitemap.length - sitemapUrlsNotCrawled.length,
      sitemapUrlsNotCrawled: sitemapUrlsNotCrawled.slice(0, MAX_AFFECTED),
      crawledNotInSitemap: crawledNotInSitemap.slice(0, MAX_AFFECTED),
    },
    counts,
    issues,
    pages,
    bots: { paths: keyPaths, rows: bots },
    structuredData: { pagesWithJsonLd: structured.size, blocks, typeCounts, perPage },
    rawHtml: {
      lowestWordCounts: [...content].sort((a, b) => (a.page?.wordCount ?? 0) - (b.page?.wordCount ?? 0)).slice(0, 10).map((r) => ({ url: r.url, words: r.page?.wordCount ?? 0 })),
      rendered: [...rendered].map(([url, renderedWords]) => ({ url, rawWords: c.byUrl.get(url)?.page?.wordCount ?? 0, renderedWords })),
      renderErrors,
    },
    notChecked,
  };
}

function buildNotChecked(c: CrawlResult, opts: AuditOptions, renderedCount: number, renderErrors: string[]): string[] {
  const out: string[] = [];
  out.push("No search-engine tool was used or compared: Google Search Console, Google's Rich Results Test, Schema Markup Validator, Lighthouse and PageSpeed Insights were NOT run. Whether pages are indexed, how they rank, and whether structured data earns rich results is not known.");
  if (c.refused) out.push(`The crawl did not run: ${c.refused.detail}`);
  if (c.capReached) out.push(`The page cap of ${c.maxPages} was reached, so the audit covers ${c.pages.length} pages; ${c.notCrawled.length} further same-origin URL(s) seen in links or the sitemap were not fetched. Raise --max-pages (hard limit 500) to cover more.`);
  else if (c.notCrawled.length > 0) out.push(`${c.notCrawled.length} same-origin URL(s) were beyond the depth limit of ${c.maxDepth} and were not fetched.`);
  if (c.robotsBlocked.length > 0) out.push(`${c.robotsBlocked.length} URL(s) were not fetched because robots.txt disallows them for this crawler (listed under internal-link and sitemap checks where relevant).`);
  if (c.skipped.length > 0) out.push(`${c.skipped.length} linked file(s) with non-HTML extensions (images, PDFs, scripts, ...) were not fetched.`);
  if (opts.render) {
    out.push(`JavaScript rendering was run on ${renderedCount} page(s) only (the ones with the least text). Other pages were judged from the raw HTML response.`);
    if (renderErrors.length > 0) out.push(`Rendering failed for ${renderErrors.length} page(s): ${renderErrors.join("; ")}`);
  } else {
    out.push("JavaScript was not run (no --render). Pages were judged from the raw HTML response; client-side rendering is inferred from near-empty bodies only.");
  }
  for (const note of c.sitemap.notes) out.push(note);
  out.push("Structured data: only JSON-LD is read (not Microdata or RDFa), only the types Person, Organization, Article/NewsArticle/BlogPosting, Product, BreadcrumbList, FAQPage, PodcastEpisode and Book are checked, and the required/recommended lists are best-effort from schema.org and Google documentation.");
  out.push("Only same-origin pages are crawled. External links, images and other files are not requested, so broken external links and image file problems (size, format, missing files) are not reported.");
  out.push("Page speed, Core Web Vitals, mobile rendering, accessibility beyond alt text and the lang attribute, security headers and HSTS are not measured. Server response time is the only timing recorded.");
  out.push("Content quality, keyword targeting, search intent, backlinks and rankings are not assessed. 'Thin' means few words, not low quality.");
  out.push("Not read: gzip-compressed sitemaps, image/video/news sitemaps, <base href>, rel=prev/next pagination, AMP, rel=nofollow links (not followed, so pages reachable only through them are not crawled), and X-Robots-Tag values other than noindex/none.");
  out.push("robots.txt is parsed with the common rules (groups, Allow/Disallow, longest match, * and $, Crawl-delay) but not every RFC 9309 edge case; a bot is matched by its exact product token or the * group.");
  out.push("Mixed-content, canonical-over-HTTPS and HTTP-vs-HTTPS checks only apply to pages served over HTTPS.");
  return out;
}
