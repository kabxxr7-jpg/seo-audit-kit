import { Fetcher, TOOL_NAME, defaultUserAgent, followChain, type ChainOutcome, type Hop } from "./http.js";
import { parseHtml, type ParsedPage } from "./html.js";
import { isAllowed, parseRobots, rulesFor, type ParsedRobots } from "./robots.js";
import { loadSitemaps, type SitemapLoad } from "./sitemap.js";
import { hasNonHtmlExtension, normalizeUrl, pathAndQuery, sameOrigin } from "./urls.js";

/** No option can raise the page cap above this. */
export const HARD_MAX_PAGES = 500;

export interface CrawlOptions {
  startUrl: string;
  /** Pages fetched at most (default 50, never more than HARD_MAX_PAGES). */
  maxPages?: number;
  /** Link depth from the start URL (default 5). */
  maxDepth?: number;
  /** Redirect hops followed before giving up on a URL (default 5). */
  maxRedirects?: number;
  /** Minimum gap between requests in ms (default 500). A robots.txt Crawl-delay can only make it longer. */
  delayMs?: number;
  userAgent?: string;
  timeoutMs?: number;
  maxBytes?: number;
  fetchImpl?: typeof fetch;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

export type PageSource = "start" | "link" | "sitemap" | "canonical" | "hreflang" | "redirect";

export interface PageRecord {
  /** The URL as requested. */
  url: string;
  source: PageSource;
  depth: number;
  /** Status of the first response (what a link-follower sees); 0 when no response arrived. */
  status: number;
  finalUrl: string;
  finalStatus: number;
  redirectChain: Hop[];
  outcome: ChainOutcome;
  /** Total response time of the request chain, in ms. */
  timeMs: number;
  contentType: string | null;
  isHtml: boolean;
  bytes: number;
  xRobotsTag: string | null;
  /** Parsed page; only set when this URL itself served an HTML 2xx response (no redirect). */
  page: ParsedPage | null;
  error?: string;
  blockedBy?: string;
  /** Distinct pages that link here with an <a href>. Filled when the crawl ends. */
  inlinks: string[];
}

export interface RobotsInfo {
  url: string;
  status: number;
  found: boolean;
  text: string | null;
  parsed: ParsedRobots | null;
  error?: string;
}

export interface CrawlResult {
  startUrl: string;
  origin: string;
  userAgent: string;
  /** Set when nothing was crawled on purpose. */
  refused: { reason: "start-blocked-by-robots" | "robots-unavailable" | "invalid-start-url"; detail: string } | null;
  robots: RobotsInfo | null;
  sitemap: SitemapLoad;
  pages: PageRecord[];
  byUrl: Map<string, PageRecord>;
  robotsBlocked: { url: string; rule: string; from: string[] }[];
  skipped: { url: string; reason: string }[];
  capReached: boolean;
  maxPages: number;
  maxDepth: number;
  /** Same-origin URLs seen in links but not fetched because of the page or depth cap. */
  notCrawled: string[];
  requests: number;
  effectiveDelayMs: number;
}

const emptySitemap = (): SitemapLoad => ({ files: [], urls: [], offOrigin: [], invalid: [], source: new Map(), truncated: false, notes: [] });

function isHtmlType(ct: string | null): boolean {
  return ct === null || /text\/html|application\/xhtml\+xml/i.test(ct);
}

export async function crawl(opts: CrawlOptions): Promise<CrawlResult> {
  const userAgent = opts.userAgent ?? defaultUserAgent();
  const maxPages = Math.max(1, Math.min(opts.maxPages ?? 50, HARD_MAX_PAGES));
  const maxDepth = Math.max(0, opts.maxDepth ?? 5);
  const maxRedirects = Math.max(0, opts.maxRedirects ?? 5);
  const delayMs = Math.max(0, opts.delayMs ?? 500);

  const start = normalizeUrl(opts.startUrl);
  const result: CrawlResult = {
    startUrl: opts.startUrl,
    origin: "",
    userAgent,
    refused: null,
    robots: null,
    sitemap: emptySitemap(),
    pages: [],
    byUrl: new Map(),
    robotsBlocked: [],
    skipped: [],
    capReached: false,
    maxPages,
    maxDepth,
    notCrawled: [],
    requests: 0,
    effectiveDelayMs: delayMs,
  };
  if (!start) {
    result.refused = { reason: "invalid-start-url", detail: `"${opts.startUrl}" is not an http(s) URL` };
    return result;
  }
  const origin = new URL(start).origin;
  result.startUrl = start;
  result.origin = origin;

  const fetcher = new Fetcher({
    userAgent,
    delayMs,
    ...(opts.timeoutMs !== undefined ? { timeoutMs: opts.timeoutMs } : {}),
    ...(opts.maxBytes !== undefined ? { maxBytes: opts.maxBytes } : {}),
    ...(opts.fetchImpl ? { fetchImpl: opts.fetchImpl } : {}),
    ...(opts.now ? { now: opts.now } : {}),
    ...(opts.sleep ? { sleep: opts.sleep } : {}),
  });

  // --- robots.txt -----------------------------------------------------------------------------
  const robotsUrl = `${origin}/robots.txt`;
  const rChain = await followChain(fetcher, robotsUrl, { maxRedirects, refuse: () => null, sameOrigin: (u) => sameOrigin(u, origin) });
  const rFinal = rChain.final;
  const robots: RobotsInfo = { url: robotsUrl, status: rFinal?.status ?? 0, found: false, text: null, parsed: null };
  result.robots = robots;
  if (rChain.outcome === "ok" && rFinal && rFinal.status >= 200 && rFinal.status < 300 && rFinal.body !== null) {
    robots.found = true;
    robots.text = rFinal.body;
    robots.parsed = parseRobots(rFinal.body);
  } else if (rChain.outcome === "ok" && rFinal && rFinal.status >= 400 && rFinal.status < 500) {
    // No robots.txt: nothing is disallowed.
  } else {
    robots.error = rChain.error ?? (rFinal ? `HTTP ${rFinal.status}` : rChain.outcome);
    result.requests = fetcher.requestCount;
    result.refused = {
      reason: "robots-unavailable",
      detail: `Could not read ${robotsUrl} (${robots.error}). Not crawled, because the rules are unknown.`,
    };
    return result;
  }

  const myRules = robots.parsed ? rulesFor(robots.parsed, TOOL_NAME) : null;
  const blockedRule = (url: string): string | null => {
    const v = isAllowed(robots.parsed, TOOL_NAME, pathAndQuery(url));
    return v.allowed ? null : (v.rule ?? "Disallow");
  };
  if (myRules?.crawlDelay !== undefined) {
    fetcher.throttle.minDelayMs = Math.max(delayMs, Math.round(myRules.crawlDelay * 1000));
  }
  result.effectiveDelayMs = fetcher.throttle.minDelayMs;

  const startRule = blockedRule(start);
  if (startRule !== null) {
    result.requests = fetcher.requestCount;
    result.refused = { reason: "start-blocked-by-robots", detail: `robots.txt disallows ${start} for ${TOOL_NAME} (${startRule}). Nothing was crawled.` };
    return result;
  }

  // --- sitemaps -------------------------------------------------------------------------------
  const seeds = [...(robots.parsed?.sitemaps ?? []).map((s) => normalizeUrl(s, origin)).filter((s): s is string => s !== null)];
  const defaultSitemap = `${origin}/sitemap.xml`;
  if (seeds.length === 0) seeds.push(defaultSitemap); // only guess /sitemap.xml when robots.txt names none
  result.sitemap = await loadSitemaps(fetcher, seeds, origin);

  // --- breadth-first crawl --------------------------------------------------------------------
  interface QueueItem {
    url: string;
    depth: number;
    source: PageSource;
  }
  const queue: QueueItem[] = [];
  const known = new Set<string>();
  const edges = new Map<string, Set<string>>(); // target -> pages that link to it
  const blockedFrom = new Map<string, { rule: string; from: Set<string> }>();
  const skippedSeen = new Set<string>();
  const depthLimited = new Set<string>();

  const noteBlocked = (url: string, rule: string, from: string): void => {
    const e = blockedFrom.get(url);
    if (e) e.from.add(from);
    else blockedFrom.set(url, { rule, from: new Set([from]) });
  };

  const enqueue = (url: string, depth: number, source: PageSource, from: string): void => {
    if (known.has(url)) return;
    if (hasNonHtmlExtension(url)) {
      if (!skippedSeen.has(url)) {
        skippedSeen.add(url);
        result.skipped.push({ url, reason: "file extension is not an HTML page" });
      }
      return;
    }
    const rule = blockedRule(url);
    if (rule !== null) {
      noteBlocked(url, rule, from);
      return;
    }
    known.add(url);
    queue.push({ url, depth, source });
  };

  enqueue(start, 0, "start", "(start)");
  let sitemapQueued = false;

  for (;;) {
    while (queue.length > 0) {
      if (result.pages.length >= maxPages) {
        result.capReached = true;
        break;
      }
      const item = queue.shift() as QueueItem;
      const chain = await followChain(fetcher, item.url, {
        maxRedirects,
        refuse: blockedRule,
        sameOrigin: (u) => sameOrigin(u, origin),
      });
      const final = chain.final;
      const record: PageRecord = {
        url: item.url,
        source: item.source,
        depth: item.depth,
        status: chain.firstStatus,
        finalUrl: chain.finalUrl,
        finalStatus: final?.status ?? 0,
        redirectChain: chain.hops,
        outcome: chain.outcome,
        timeMs: chain.totalTimeMs,
        contentType: final?.contentType ?? null,
        isHtml: false,
        bytes: final?.bytes ?? 0,
        xRobotsTag: final?.headers["x-robots-tag"] ?? null,
        page: null,
        inlinks: [],
      };
      if (chain.error) record.error = chain.error;
      if (chain.blocked) {
        record.blockedBy = chain.blocked.rule;
        noteBlocked(chain.blocked.url, chain.blocked.rule, item.url);
      }
      result.pages.push(record);
      result.byUrl.set(record.url, record);

      if (chain.outcome === "ok" && chain.hops.length > 0) {
        // The redirect target becomes a page of its own (served from cache if already fetched).
        if (sameOrigin(chain.finalUrl, origin)) enqueue(chain.finalUrl, item.depth, "redirect", item.url);
        continue;
      }
      if (chain.outcome !== "ok" || !final || final.status < 200 || final.status >= 300) continue;

      record.isHtml = isHtmlType(final.contentType) && final.body !== null;
      if (!record.isHtml || final.body === null) continue;
      const page = parseHtml(final.body);
      record.page = page;

      const nofollowPage = page.robotsDirectives.includes("nofollow") || page.robotsDirectives.includes("none");
      for (const link of page.links) {
        if (link.href.trim().startsWith("#")) continue;
        const target = normalizeUrl(link.href, record.url);
        if (!target || !sameOrigin(target, origin)) continue;
        if (target !== record.url) {
          const set = edges.get(target) ?? new Set<string>();
          set.add(record.url);
          edges.set(target, set);
        }
        if (nofollowPage || link.rel.includes("nofollow")) continue;
        if (item.depth + 1 > maxDepth) {
          if (!known.has(target)) depthLimited.add(target);
          continue;
        }
        enqueue(target, item.depth + 1, "link", record.url);
      }
      // Canonical and hreflang targets are fetched so they can be verified; they ignore the depth cap.
      for (const c of page.canonicals) {
        const t = normalizeUrl(c, record.url);
        if (t && sameOrigin(t, origin)) enqueue(t, item.depth + 1, "canonical", record.url);
      }
      for (const h of page.hreflang) {
        const t = normalizeUrl(h.href, record.url);
        if (t && sameOrigin(t, origin)) enqueue(t, item.depth + 1, "hreflang", record.url);
      }
    }
    if (result.capReached || sitemapQueued) break;
    sitemapQueued = true;
    for (const u of result.sitemap.urls) {
      if (sameOrigin(u, origin)) enqueue(u, 1, "sitemap", "(sitemap)");
    }
    if (queue.length === 0) break;
  }

  const remaining = queue.map((q) => q.url);
  for (const u of remaining) result.notCrawled.push(u);
  for (const u of depthLimited) if (!result.byUrl.has(u) && !known.has(u)) result.notCrawled.push(u);

  for (const rec of result.pages) rec.inlinks = [...(edges.get(rec.url) ?? [])];
  // A link to a URL that redirects counts as a link to the page it redirects to.
  for (const rec of result.pages) {
    if (rec.outcome !== "ok" || rec.redirectChain.length === 0) continue;
    const target = result.byUrl.get(rec.finalUrl);
    if (!target) continue;
    for (const from of rec.inlinks) if (from !== target.url && !target.inlinks.includes(from)) target.inlinks.push(from);
  }
  result.robotsBlocked = [...blockedFrom].map(([url, v]) => ({ url, rule: v.rule, from: [...v.from] }));
  result.requests = fetcher.requestCount;
  return result;
}
