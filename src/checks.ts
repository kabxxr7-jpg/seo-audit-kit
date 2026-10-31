import { createHash } from "node:crypto";
import type { BotAccessRow } from "./bots.js";
import type { CheckId } from "./catalog.js";
import type { CrawlResult, PageRecord } from "./crawler.js";
import { findClashes, type Entity, type PageStructuredData } from "./jsonld.js";
import { isLoopbackHost, normalizeUrl, sameOrigin, urlHygiene } from "./urls.js";

export interface Finding {
  id: CheckId;
  /** The page (or file) the finding is about. */
  url: string;
  detail?: string;
}

export interface Thresholds {
  titleMin: number;
  titleMax: number;
  descMin: number;
  descMax: number;
  /** Indexable pages with fewer words than this are thin. */
  minWords: number;
  /** Pages with fewer words than this in the raw HTML are treated as (probably) client-rendered. */
  nearEmptyWords: number;
  slowMs: number;
}

export const DEFAULT_THRESHOLDS: Thresholds = {
  titleMin: 15,
  titleMax: 60,
  descMin: 70,
  descMax: 160,
  minWords: 120,
  nearEmptyWords: 25,
  slowMs: 2000,
};

export interface CheckContext {
  crawl: CrawlResult;
  bots: BotAccessRow[];
  structured: Map<string, PageStructuredData>;
  thresholds: Thresholds;
  /** Word counts of the rendered DOM, only for pages a headless browser was run on. */
  rendered?: Map<string, number>;
}

export function isNoindex(rec: PageRecord): boolean {
  const meta = rec.page?.robotsDirectives ?? [];
  if (meta.includes("noindex") || meta.includes("none")) return true;
  const header = (rec.xRobotsTag ?? "").toLowerCase();
  return /(^|[\s,:])(noindex|none)($|[\s,])/.test(header);
}

/** The first canonical, resolved; null when absent or unusable. */
function canonicalOf(rec: PageRecord): string | null {
  const c = rec.page?.canonicals[0];
  return c === undefined ? null : normalizeUrl(c, rec.url);
}

function isSelfCanonicalOrNone(rec: PageRecord): boolean {
  const c = rec.page?.canonicals[0];
  if (c === undefined) return true;
  const t = normalizeUrl(c, rec.url);
  return t === null || t === rec.url;
}

export function textHash(text: string): string {
  const norm = text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  return createHash("sha1").update(norm).digest("hex");
}

function groupBy<T>(items: T[], key: (t: T) => string | null): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const it of items) {
    const k = key(it);
    if (k === null) continue;
    const list = m.get(k);
    if (list) list.push(it);
    else m.set(k, [it]);
  }
  return m;
}

export function runChecks(ctx: CheckContext): Finding[] {
  const out: Finding[] = [];
  const add = (id: CheckId, url: string, detail?: string): void => {
    out.push(detail === undefined ? { id, url } : { id, url, detail });
  };
  const { crawl, thresholds: th } = ctx;
  const content = crawl.pages.filter((p) => p.page !== null);
  const indexable = content.filter((p) => !isNoindex(p));
  const sitemapSet = new Set(crawl.sitemap.urls);
  const linkTarget = (from: PageRecord, href: string): string | null => {
    if (href.trim().startsWith("#")) return null;
    const t = normalizeUrl(href, from.url);
    return t && sameOrigin(t, crawl.origin) ? t : null;
  };

  // ---------- robots.txt and sitemap ----------
  if (crawl.refused?.reason === "start-blocked-by-robots") add("robots-blocks-audit", crawl.startUrl, crawl.refused.detail);
  if (crawl.refused?.reason === "robots-unavailable") add("robots-unavailable", crawl.robots?.url ?? crawl.origin, crawl.refused.detail);
  if (crawl.robots && !crawl.refused && !crawl.robots.found) add("robots-missing", crawl.robots.url, `HTTP ${crawl.robots.status}`);

  if (!crawl.refused) {
    const okFiles = crawl.sitemap.files.filter((f) => f.kind !== "invalid");
    const declared = new Set(crawl.robots?.parsed?.sitemaps.map((s) => normalizeUrl(s, crawl.origin)) ?? []);
    if (okFiles.length === 0) {
      const brokenDeclared = crawl.sitemap.files.filter((f) => declared.has(f.url));
      if (brokenDeclared.length === 0) add("sitemap-missing", `${crawl.origin}/sitemap.xml`, "no sitemap at /sitemap.xml and none declared in robots.txt");
      for (const f of brokenDeclared) add("sitemap-invalid", f.url, f.error ?? `HTTP ${f.status}`);
    }
    for (const f of crawl.sitemap.files) {
      if (f.kind === "invalid" && f.status === 200) add("sitemap-invalid", f.url, f.error ?? "not valid sitemap XML");
      else if (f.kind === "invalid" && declared.has(f.url)) add("sitemap-invalid", f.url, f.error ?? `HTTP ${f.status}`);
    }
    for (const u of crawl.sitemap.offOrigin) add("sitemap-url-offsite", u, `listed in ${crawl.sitemap.source.get(u) ?? "a sitemap"}`);
    for (const u of crawl.sitemap.invalid) add("sitemap-invalid", crawl.origin, `not a valid URL: ${u}`);
    for (const b of crawl.robotsBlocked) {
      if (sitemapSet.has(b.url)) add("sitemap-url-blocked", b.url, b.rule);
    }
    for (const u of crawl.sitemap.urls) {
      const rec = crawl.byUrl.get(u);
      if (!rec) continue;
      if (rec.redirectChain.length > 0 && rec.outcome === "ok") add("sitemap-url-redirect", u, `redirects to ${rec.finalUrl}`);
      else if (rec.status >= 400 || (rec.status === 0 && rec.error)) add("sitemap-url-error", u, rec.error ?? `HTTP ${rec.status}`);
      else if (rec.page) {
        if (isNoindex(rec)) add("sitemap-url-noindex", u);
        const c = canonicalOf(rec);
        if (c !== null && c !== rec.url) add("sitemap-url-noncanonical", u, `canonical is ${c}`);
      }
    }
    // Orphans and "not in sitemap" only make sense when a sitemap exists.
    if (crawl.sitemap.urls.length > 0) {
      for (const u of crawl.sitemap.urls) {
        const rec = crawl.byUrl.get(u);
        if (!rec || !rec.page || u === crawl.startUrl) continue;
        if (rec.inlinks.length === 0) add("orphan-page", u, "listed in the sitemap, no crawled page links to it");
      }
      for (const rec of indexable) {
        if (!sitemapSet.has(rec.url) && isSelfCanonicalOrNone(rec)) add("page-not-in-sitemap", rec.url);
      }
    }
  }

  // ---------- status, redirects ----------
  for (const rec of crawl.pages) {
    if (rec.source === "start" && (rec.status >= 400 || (rec.status === 0 && rec.error))) {
      add("page-error", rec.url, rec.error ?? `HTTP ${rec.status}`);
    }
    if (rec.redirectChain.length > 0 || rec.outcome === "redirect-loop" || rec.outcome === "too-many-redirects" || rec.outcome === "bad-redirect") {
      const trail = [...rec.redirectChain.map((h) => h.url), rec.finalUrl].join(" -> ");
      if (rec.outcome === "redirect-loop") add("redirect-loop", rec.url, trail);
      else if (rec.outcome === "too-many-redirects") add("redirect-chain-too-long", rec.url, `${rec.redirectChain.length} hops: ${trail}`);
      else if (rec.outcome === "bad-redirect") add("redirect-broken", rec.url, rec.error ?? "bad Location header");
      else if (rec.redirectChain.length >= 2) add("redirect-chain", rec.url, `${rec.redirectChain.length} hops: ${trail}`);
      if (rec.redirectChain.some((h) => h.status === 302 || h.status === 307)) add("redirect-temporary", rec.url, trail);
    }
  }
  for (const rec of content) {
    if (rec.timeMs > th.slowMs) add("slow-response", rec.url, `${rec.timeMs} ms`);
  }

  // ---------- https ----------
  if (crawl.startUrl && new URL(crawl.startUrl).protocol === "http:" && !isLoopbackHost(crawl.startUrl)) {
    add("site-not-https", crawl.startUrl, "the start URL uses http://");
  }
  for (const rec of content) {
    const page = rec.page;
    if (!page || new URL(rec.finalUrl).protocol !== "https:") continue;
    for (const r of page.resources) {
      const abs = normalizeUrl(r.url, rec.url);
      if (!abs || !abs.startsWith("http://")) continue;
      if (r.kind === "script" || r.kind === "stylesheet" || r.kind === "iframe") add("mixed-content-active", rec.url, `${r.kind}: ${abs}`);
      else add("mixed-content-passive", rec.url, `${r.kind}: ${abs}`);
    }
    const c = page.canonicals[0];
    if (c) {
      const t = normalizeUrl(c, rec.url);
      if (t && t.startsWith("http://") && new URL(t).hostname === new URL(rec.url).hostname) add("canonical-http-on-https", rec.url, t);
    }
  }

  // ---------- titles, descriptions, headings (indexable pages) ----------
  for (const rec of indexable) {
    const page = rec.page;
    if (!page) continue;
    const title = page.title?.trim() ?? "";
    if (title === "") add("title-missing", rec.url, page.titleCount === 0 ? "no <title> element" : "empty <title>");
    else if (title.length > th.titleMax) add("title-too-long", rec.url, `${title.length} characters: "${title}"`);
    else if (title.length < th.titleMin) add("title-too-short", rec.url, `${title.length} characters: "${title}"`);

    const descs = page.metaDescriptions.map((d) => d.trim()).filter(Boolean);
    const desc = descs[0];
    if (desc === undefined) add("meta-description-missing", rec.url);
    else if (desc.length > th.descMax) add("meta-description-too-long", rec.url, `${desc.length} characters`);
    else if (desc.length < th.descMin) add("meta-description-too-short", rec.url, `${desc.length} characters`);

    const h1s = page.headings.filter((h) => h.level === 1);
    const nonEmpty = h1s.filter((h) => h.text !== "");
    if (nonEmpty.length === 0) add("h1-missing", rec.url, h1s.length > 0 ? "the h1 is empty" : "no <h1>");
    else if (nonEmpty.length > 1) add("h1-multiple", rec.url, `${nonEmpty.length} h1 elements`);

    for (let i = 1; i < page.headings.length; i++) {
      const prev = page.headings[i - 1];
      const cur = page.headings[i];
      if (prev && cur && cur.level > prev.level + 1) {
        add("heading-order", rec.url, `h${prev.level} "${prev.text}" is followed by h${cur.level} "${cur.text}"`);
        break;
      }
    }
  }
  const dupTitles = groupBy(indexable.filter(isSelfCanonicalOrNone), (r) => {
    const t = r.page?.title?.trim().toLowerCase();
    return t ? t : null;
  });
  for (const [t, list] of dupTitles) {
    if (list.length < 2) continue;
    for (const r of list) add("title-duplicate", r.url, `same title on ${list.length} pages: "${r.page?.title ?? t}"`);
  }
  const dupDescs = groupBy(indexable.filter(isSelfCanonicalOrNone), (r) => {
    const d = r.page?.metaDescriptions.map((x) => x.trim()).find(Boolean);
    return d ? d.toLowerCase() : null;
  });
  for (const list of dupDescs.values()) {
    if (list.length < 2) continue;
    for (const r of list) add("meta-description-duplicate", r.url, `same description on ${list.length} pages`);
  }

  // ---------- canonical ----------
  for (const rec of indexable) {
    const page = rec.page;
    if (!page) continue;
    const distinct = [...new Set(page.canonicals.map((c) => normalizeUrl(c, rec.url) ?? c))];
    if (page.canonicals.length === 0) {
      add("canonical-missing", rec.url);
      continue;
    }
    if (distinct.length > 1) add("canonical-multiple", rec.url, distinct.join(" vs "));
    const target = normalizeUrl(page.canonicals[0] as string, rec.url);
    if (target === null) {
      add("canonical-invalid", rec.url, `"${page.canonicals[0]}"`);
      continue;
    }
    if (target === rec.url) continue;
    if (!sameOrigin(target, crawl.origin)) {
      if (!(target.startsWith("http://") && rec.url.startsWith("https://") && new URL(target).hostname === new URL(rec.url).hostname)) {
        add("canonical-external", rec.url, target);
      }
      continue;
    }
    const t = crawl.byUrl.get(target);
    if (!t) {
      add("canonical-not-self", rec.url, `${target} (not fetched, so not verified)`);
      continue;
    }
    if (t.redirectChain.length > 0) add("canonical-to-redirect", rec.url, `${target} redirects to ${t.finalUrl}`);
    else if (t.status >= 400 || (t.status === 0 && t.error)) add("canonical-to-error", rec.url, `${target}: ${t.error ?? `HTTP ${t.status}`}`);
    else if (t.page && isNoindex(t)) add("canonical-to-noindex", rec.url, target);
    else if (t.page && !isSelfCanonicalOrNone(t)) add("canonical-chain", rec.url, `${rec.url} -> ${target} -> ${canonicalOf(t) ?? "?"}`);
    else add("canonical-not-self", rec.url, target);
  }

  // ---------- noindex ----------
  for (const rec of content) {
    if (!isNoindex(rec)) continue;
    const key = rec.url === crawl.startUrl || sitemapSet.has(rec.url);
    add(key ? "noindex-key-page" : "noindex-page", rec.url, key ? (rec.url === crawl.startUrl ? "the start page" : "listed in the sitemap") : undefined);
  }

  // ---------- hreflang ----------
  const HREFLANG = /^(x-default|[a-z]{2,3}(-[a-z]{4})?(-([a-z]{2}|\d{3}))?)$/i;
  for (const rec of content) {
    const page = rec.page;
    if (!page || page.hreflang.length === 0) continue;
    const targets = page.hreflang.map((h) => ({ ...h, abs: normalizeUrl(h.href, rec.url) }));
    for (const h of targets) {
      if (!HREFLANG.test(h.lang)) add("hreflang-invalid-code", rec.url, `"${h.lang}"`);
    }
    if (!targets.some((h) => h.abs === rec.url)) add("hreflang-missing-self", rec.url);
    const seen = new Set<string>();
    for (const h of targets) {
      if (!h.abs || h.abs === rec.url || seen.has(h.abs) || !sameOrigin(h.abs, crawl.origin)) continue;
      seen.add(h.abs);
      const t = crawl.byUrl.get(h.abs);
      if (!t) continue;
      if (t.redirectChain.length > 0 || t.status >= 400 || (t.status === 0 && t.error)) {
        add("hreflang-target-error", rec.url, `${h.lang} -> ${h.abs} (${t.redirectChain.length > 0 ? `redirects to ${t.finalUrl}` : t.error ?? `HTTP ${t.status}`})`);
        continue;
      }
      if (!t.page) continue;
      const back = t.page.hreflang.some((b) => normalizeUrl(b.href, t.url) === rec.url);
      if (!back) add("hreflang-no-return", rec.url, `lists ${h.abs} (${h.lang}) but that page does not link back`);
    }
  }

  // ---------- images and head tags ----------
  for (const rec of content) {
    const page = rec.page;
    if (!page) continue;
    const noAlt = page.images.filter((i) => i.alt === null);
    if (noAlt.length > 0) add("image-alt-missing", rec.url, `${noAlt.length} of ${page.images.length} images, for example ${noAlt[0]?.src ?? "(no src)"}`);
    const missingOg = ["og:title", "og:description", "og:image"].filter((k) => !page.openGraph[k]);
    if (missingOg.length > 0 && !isNoindex(rec)) add("og-tags-incomplete", rec.url, `missing ${missingOg.join(", ")}`);
    if (!page.twitter["twitter:card"] && !isNoindex(rec)) add("twitter-card-missing", rec.url);
    if (page.viewport === null) add("viewport-missing", rec.url);
    else if (!/width\s*=\s*device-width/i.test(page.viewport)) add("viewport-missing", rec.url, `viewport is "${page.viewport}" (no width=device-width)`);
    if (!page.lang || page.lang.trim() === "") add("lang-missing", rec.url);
  }

  // ---------- internal links ----------
  for (const rec of content) {
    const page = rec.page;
    if (!page) continue;
    const seen = new Set<string>();
    for (const l of page.links) {
      const t = linkTarget(rec, l.href);
      if (!t || t === rec.url || seen.has(t)) continue;
      seen.add(t);
      const tr = crawl.byUrl.get(t);
      if (!tr) {
        const b = crawl.robotsBlocked.find((x) => x.url === t);
        if (b) add("internal-link-blocked", rec.url, `${t} (${b.rule})`);
        continue;
      }
      if (tr.redirectChain.length > 0 && tr.outcome === "ok") add("internal-link-redirect", rec.url, `${t} redirects to ${tr.finalUrl}`);
      else if (tr.outcome === "redirect-loop" || tr.outcome === "too-many-redirects") add("internal-link-broken", rec.url, `${t} (${tr.outcome})`);
      else if (tr.status >= 400 || (tr.status === 0 && tr.error && tr.outcome === "error")) add("internal-link-broken", rec.url, `${t} (${tr.error ?? `HTTP ${tr.status}`})`);
    }
  }

  // ---------- content quality and raw HTML ----------
  const clientRendered = new Set<string>();
  for (const rec of content) {
    const page = rec.page;
    if (!page) continue;
    const s = page.signals;
    const renderedWords = ctx.rendered?.get(rec.url);
    if (page.wordCount < th.nearEmptyWords) {
      const after = renderedWords !== undefined ? ` After JavaScript: ${renderedWords} words.` : "";
      const bits = [`${page.wordCount} words in the raw HTML`];
      if (s.emptyAppRoot) bits.push("empty app container (#root/#app)");
      if (s.noscriptNeedsJs) bits.push("<noscript> asks for JavaScript");
      if (s.scriptCount > 0) bits.push(`${s.scriptCount} script tag(s)`);
      if (s.emptyAppRoot || s.noscriptNeedsJs) {
        add("client-rendered-body", rec.url, bits.join("; ") + "." + after);
        clientRendered.add(rec.url);
      } else if (s.scriptCount > 0) {
        add("near-empty-body", rec.url, bits.join("; ") + "." + after);
        clientRendered.add(rec.url);
      }
    } else if (renderedWords !== undefined && renderedWords - page.wordCount >= 50 && page.wordCount < renderedWords * 0.5) {
      add("content-requires-javascript", rec.url, `${page.wordCount} words in the raw HTML, ${renderedWords} after JavaScript`);
      clientRendered.add(rec.url);
    }
  }
  for (const rec of indexable) {
    const page = rec.page;
    if (!page || clientRendered.has(rec.url)) continue;
    if (page.wordCount < th.minWords) add("thin-content", rec.url, `${page.wordCount} words (threshold ${th.minWords})`);
  }
  const hashed = groupBy(
    indexable.filter((r) => isSelfCanonicalOrNone(r) && (r.page?.wordCount ?? 0) >= 20),
    (r) => textHash(r.page?.mainText ?? ""),
  );
  for (const list of hashed.values()) {
    if (list.length < 2) continue;
    for (const r of list) {
      const others = list.filter((o) => o !== r).map((o) => o.url);
      add("duplicate-content", r.url, `same text as ${others.join(", ")}`);
    }
  }

  // ---------- URL hygiene ----------
  for (const rec of content) {
    for (const p of urlHygiene(rec.url)) add(p.id, rec.url, p.detail);
  }

  // ---------- structured data ----------
  const allEntities: { url: string; entity: Entity }[] = [];
  for (const rec of content) {
    const sd = ctx.structured.get(rec.url);
    if (!sd) continue;
    for (const e of sd.parseErrors) {
      const where = e.error.column !== null ? `line ${e.error.line}, column ${e.error.column}` : `line ${e.error.line}`;
      add("sd-parse-error", rec.url, `block ${e.block + 1}, ${where}: ${e.error.message}`);
    }
    for (const b of sd.missingContext) add("sd-missing-context", rec.url, `block ${b + 1}`);
    for (const b of sd.missingType) add("sd-missing-type", rec.url, `block ${b + 1}`);
    for (const p of sd.problems) {
      if (p.missingRequired.length > 0) add("sd-missing-required", rec.url, `${p.type} (block ${p.blockIndex + 1}): ${p.missingRequired.join(", ")}`);
      if (p.missingRecommended.length > 0) add("sd-missing-recommended", rec.url, `${p.type}: ${p.missingRecommended.join(", ")}`);
    }
    for (const c of sd.clashes) add(c.kind === "duplicate" ? "sd-duplicate-entity" : "sd-conflicting-entity", rec.url, c.detail);
    for (const e of sd.entities) allEntities.push({ url: rec.url, entity: e });
  }
  // Entities with the same @id on different pages that disagree.
  const byId = groupBy(allEntities.filter((e) => e.entity.id !== null), (e) => e.entity.id);
  for (const [id, list] of byId) {
    const pages = new Set(list.map((l) => l.url));
    if (pages.size < 2) continue;
    const clash = findClashes(list.map((l) => l.entity)).find((c) => c.kind === "conflict");
    if (!clash) continue;
    for (const u of pages) add("sd-conflicting-entity", u, `across pages: ${clash.detail.replace(/^\d+ entities for /, "")} (${id})`);
  }

  // ---------- crawler / AI bot access ----------
  const robotsUrl = crawl.robots?.url ?? `${crawl.origin}/robots.txt`;
  const summarize = (blocked: { path: string; rule?: string }[], total: number): string => {
    const rules = [...new Set(blocked.map((b) => b.rule ?? "blocked"))].join("; ");
    const shown = blocked.slice(0, 3).map((b) => b.path).join(", ");
    return `${blocked.length} of ${total} checked paths blocked (${rules}), for example ${shown}`;
  };
  for (const row of ctx.bots) {
    const home = row.results[0];
    const blockedPaths = row.results.filter((r) => !r.allowed);
    if (blockedPaths.length === 0) continue;
    if (row.kind === "search") {
      if (home && !home.allowed) add("bot-search-blocked-home", robotsUrl, `${row.bot}: ${home.rule ?? "blocked"} blocks the home page`);
      const others = blockedPaths.filter((r) => r !== home);
      if (others.length > 0) add("bot-search-blocked-path", robotsUrl, `${row.bot}: ${summarize(others, row.results.length - 1)}`);
    } else {
      add("bot-ai-blocked", robotsUrl, `${row.bot}: ${summarize(blockedPaths, row.results.length)}`);
    }
  }

  return out;
}
