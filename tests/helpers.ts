import { runAudit, type AuditOptions, type AuditResult } from "../src/audit.js";
import { botAccessReport } from "../src/bots.js";
import { DEFAULT_THRESHOLDS, runChecks, type Finding } from "../src/checks.js";
import type { CrawlResult, PageRecord } from "../src/crawler.js";
import { parseHtml } from "../src/html.js";
import { analyzeJsonLd, type PageStructuredData } from "../src/jsonld.js";
import { parseRobots } from "../src/robots.js";
import { normalizeUrl } from "../src/urls.js";
import { startFixture, type FixtureResponse, type FixtureRoute, type RunningFixture } from "../fixtures/server.js";

/** Starts a fixture server for `routes`, runs `fn`, and always closes the server. */
export async function withServer<T>(routes: Record<string, FixtureRoute>, fn: (f: RunningFixture) => Promise<T>): Promise<T> {
  const f = await startFixture({ name: "inline", routes });
  try {
    return await fn(f);
  } finally {
    await f.close();
  }
}

export const html = (body: string, extra: Partial<FixtureResponse> = {}): FixtureRoute => ({ body, ...extra });

/** A page with every on-page basic in place; override pieces to break one thing at a time. */
export function simplePage(o: { title?: string | null; head?: string; body?: string; lang?: string | null } = {}): string {
  const title = o.title === undefined ? "A perfectly fine page title" : o.title;
  const lang = o.lang === null ? "" : ` lang="${o.lang ?? "en"}"`;
  return `<!doctype html><html${lang}><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">${title === null ? "" : `<title>${title}</title>`}${o.head ?? ""}</head><body><main>${o.body ?? "<h1>Heading</h1><p>text</p>"}</main></body></html>`;
}

export async function audit(routes: Record<string, FixtureRoute>, opts: Partial<AuditOptions> = {}): Promise<{ result: AuditResult; origin: string; requests: RunningFixture["requests"] }> {
  return withServer(routes, async (f) => {
    const result = await runAudit({ startUrl: f.origin + "/", delayMs: 0, ...opts });
    return { result, origin: f.origin, requests: f.requests };
  });
}

export const issueIds = (r: AuditResult): string[] => r.issues.map((i) => i.id);
export const issueUrls = (r: AuditResult, id: string): string[] => r.issues.find((i) => i.id === id)?.examples.map((e) => e.url) ?? [];
export const issueDetails = (r: AuditResult, id: string): string[] => r.issues.find((i) => i.id === id)?.examples.map((e) => e.detail ?? "") ?? [];

export interface FakePage {
  html: string;
  status?: number;
  redirectTo?: string;
  xRobotsTag?: string;
  timeMs?: number;
}

/** Builds a CrawlResult by hand (no network) so checks can be tested for any scheme, status or timing. */
export function fakeCrawl(origin: string, pages: Record<string, FakePage | string>, extra: { sitemap?: string[]; robotsTxt?: string | null; start?: string } = {}): CrawlResult {
  const startUrl = origin + (extra.start ?? "/");
  const byUrl = new Map<string, PageRecord>();
  const records: PageRecord[] = [];
  for (const [path, spec] of Object.entries(pages)) {
    const p: FakePage = typeof spec === "string" ? { html: spec } : spec;
    const url = origin + path;
    const redirect = p.redirectTo !== undefined;
    const status = redirect ? 301 : (p.status ?? 200);
    const rec: PageRecord = {
      url,
      source: url === startUrl ? "start" : "link",
      depth: 0,
      status,
      finalUrl: redirect ? origin + (p.redirectTo as string) : url,
      finalStatus: redirect ? 200 : status,
      redirectChain: redirect ? [{ url, status: 301, location: origin + (p.redirectTo as string) }] : [],
      outcome: "ok",
      timeMs: p.timeMs ?? 10,
      contentType: "text/html; charset=utf-8",
      isHtml: !redirect && status < 300,
      bytes: p.html.length,
      xRobotsTag: p.xRobotsTag ?? null,
      page: !redirect && status >= 200 && status < 300 ? parseHtml(p.html) : null,
      inlinks: [],
    };
    records.push(rec);
    byUrl.set(url, rec);
  }
  for (const rec of records) {
    for (const l of rec.page?.links ?? []) {
      const t = normalizeUrl(l.href, rec.url);
      const target = t ? byUrl.get(t) : undefined;
      if (target && target !== rec && !target.inlinks.includes(rec.url)) target.inlinks.push(rec.url);
    }
  }
  const robotsText = extra.robotsTxt === undefined ? null : extra.robotsTxt;
  return {
    startUrl,
    origin,
    userAgent: "test",
    refused: null,
    robots: { url: origin + "/robots.txt", status: robotsText === null ? 404 : 200, found: robotsText !== null, text: robotsText, parsed: robotsText === null ? null : parseRobots(robotsText) },
    sitemap: { files: extra.sitemap === undefined ? [] : [{ url: origin + "/sitemap.xml", kind: "urlset" as const, status: 200, urls: extra.sitemap.map((p) => origin + p), children: [] }], urls: (extra.sitemap ?? []).map((p) => origin + p), offOrigin: [], invalid: [], source: new Map(), truncated: false, notes: [] },
    pages: records,
    byUrl,
    robotsBlocked: [],
    skipped: [],
    capReached: false,
    maxPages: 50,
    maxDepth: 5,
    notCrawled: [],
    requests: records.length,
    effectiveDelayMs: 0,
  };
}

export function checkFake(crawl: CrawlResult, thresholds = DEFAULT_THRESHOLDS): Finding[] {
  const structured = new Map<string, PageStructuredData>();
  for (const rec of crawl.pages) if (rec.page && rec.page.jsonLd.length > 0) structured.set(rec.url, analyzeJsonLd(rec.page.jsonLd));
  const bots = botAccessReport(crawl.robots?.parsed ?? null, ["/"]);
  return runChecks({ crawl, bots, structured, thresholds });
}

export const fids = (f: Finding[]): string[] => [...new Set(f.map((x) => x.id))];
export const furls = (f: Finding[], id: string): string[] => f.filter((x) => x.id === id).map((x) => x.url);

/** About `n` words of text. */
export const words = (n: number, seed = "w"): string => Array.from({ length: n }, (_, i) => `${seed}${i}`).join(" ");
