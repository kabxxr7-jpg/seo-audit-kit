import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runAudit, type AuditResult } from "../src/audit.js";
import { BROKEN_SITE_EXPECTATIONS, brokenSite } from "../fixtures/broken-site.js";
import { GOOD_SITE_PAGE_COUNT, goodSite } from "../fixtures/good-site.js";
import { startFixture, type RunningFixture } from "../fixtures/server.js";

let good: RunningFixture;
let broken: RunningFixture;
let goodResult: AuditResult;
let brokenResult: AuditResult;

beforeAll(async () => {
  good = await startFixture(goodSite);
  broken = await startFixture(brokenSite);
  goodResult = await runAudit({ startUrl: good.origin + "/", delayMs: 0, maxPages: 100 });
  brokenResult = await runAudit({ startUrl: broken.origin + "/", delayMs: 0, maxPages: 100 });
});
afterAll(async () => {
  await good.close();
  await broken.close();
});

const pathOf = (origin: string, url: string): string => (url.startsWith(origin) ? url.slice(origin.length).replace(/\?.*$/, "") : url);

describe("good fixture site", () => {
  it("has zero high-severity issues", () => {
    expect(goodResult.counts.high).toBe(0);
    expect(goodResult.issues.filter((i) => i.severity === "high")).toEqual([]);
  });
  it("has no medium issues either, and nothing else was reported", () => {
    expect(goodResult.counts.medium).toBe(0);
    expect(goodResult.issues).toEqual([]);
  });
  it("crawls every page, through the sitemap index, without hitting the page cap", () => {
    expect(goodResult.crawl.pagesFetched).toBe(GOOD_SITE_PAGE_COUNT);
    expect(goodResult.crawl.capReached).toBe(false);
    expect(goodResult.crawl.sitemapFiles).toBe(3); // index + two children
    expect(goodResult.crawl.sitemapUrls).toBe(GOOD_SITE_PAGE_COUNT);
    expect(goodResult.crawl.sitemapUrlsNotCrawled).toEqual([]);
    expect(goodResult.crawl.crawledNotInSitemap).toEqual([]);
    expect(goodResult.crawl.statusCounts).toEqual({ "2xx": GOOD_SITE_PAGE_COUNT });
  });
  it("lets every named bot fetch every key path", () => {
    expect(goodResult.bots.rows).toHaveLength(8);
    for (const row of goodResult.bots.rows) expect(row.results.every((r) => r.allowed)).toBe(true);
    expect(goodResult.bots.paths).toContain("/sitemap.xml");
  });
  it("finds all eight structured data types and no parse errors", () => {
    const types = Object.keys(goodResult.structuredData.typeCounts);
    for (const t of ["Person", "Organization", "Article", "Product", "BreadcrumbList", "FAQPage", "PodcastEpisode", "Book"]) expect(types).toContain(t);
    expect(goodResult.structuredData.perPage.every((p) => p.parseErrors === 0)).toBe(true);
  });
  it("has the main content in the raw HTML of every page", () => {
    const lowest = goodResult.rawHtml.lowestWordCounts[0];
    expect(lowest?.words).toBeGreaterThan(120);
  });
});

describe("broken fixture site", () => {
  it("is reported as having high-severity issues", () => {
    expect(brokenResult.counts.high).toBeGreaterThanOrEqual(5);
  });

  for (const [id, expectedPaths] of Object.entries(BROKEN_SITE_EXPECTATIONS)) {
    it(`finds ${id} on ${expectedPaths.join(", ")}`, () => {
      const issue = brokenResult.issues.find((i) => i.id === id);
      expect(issue, `issue ${id} was not reported`).toBeDefined();
      const found = new Set(issue?.examples.map((e) => pathOf(broken.origin, e.url)));
      for (const p of expectedPaths) expect(found, `${id} should list ${p}`).toContain(p);
    });
  }

  it("does not blame pages that are fine", () => {
    const urls = (id: string) => new Set(brokenResult.issues.find((i) => i.id === id)?.examples.map((e) => pathOf(broken.origin, e.url)));
    expect(urls("title-missing")).toEqual(new Set(["/contact"]));
    expect(urls("title-duplicate")).toEqual(new Set(["/services", "/materials"]));
    expect(urls("noindex-key-page")).toEqual(new Set(["/pricing"]));
    expect(urls("orphan-page")).toEqual(new Set(["/secret-offer"]));
    expect(urls("client-rendered-body")).toEqual(new Set(["/app"]));
    expect(urls("sd-parse-error")).toEqual(new Set(["/about"]));
  });

  it("ranks noindex on a key page, a broken canonical and client rendering as high", () => {
    const sev = (id: string) => brokenResult.issues.find((i) => i.id === id)?.severity;
    for (const id of ["noindex-key-page", "canonical-to-redirect", "canonical-to-error", "client-rendered-body", "redirect-loop", "title-missing", "internal-link-broken"]) {
      expect(sev(id), id).toBe("high");
    }
    expect(sev("orphan-page")).toBe("medium");
    expect(sev("bot-ai-blocked")).toBe("low");
  });

  it("reports the line of the JSON-LD syntax error in the HTML", async () => {
    const html = await (await fetch(broken.origin + "/about")).text();
    const lines = html.split("\n");
    const closing = lines.findIndex((l) => l.includes('"jobTitle"')) + 2; // 1-based line of the "}" after the trailing comma
    const detail = brokenResult.issues.find((i) => i.id === "sd-parse-error")?.examples[0]?.detail ?? "";
    expect(lines[closing - 1]).toBe("}");
    expect(detail).toContain(`line ${closing}`);
  });

  it("names the blocked bots and leaves the search bots alone", () => {
    const rows = Object.fromEntries(brokenResult.bots.rows.map((r) => [r.bot, r.results.map((x) => x.allowed)]));
    expect(rows["GPTBot"]?.every((a) => !a)).toBe(true);
    expect(rows["ClaudeBot"]?.every((a) => !a)).toBe(true);
    expect(rows["Googlebot"]?.[0]).toBe(true);
    expect(rows["PerplexityBot"]?.[0]).toBe(true);
    const detail = brokenResult.issues.find((i) => i.id === "bot-ai-blocked")?.examples.map((e) => e.detail).join("\n") ?? "";
    expect(detail).toContain("GPTBot");
    expect(detail).toContain("ClaudeBot");
    expect(detail).not.toContain("PerplexityBot");
    const search = brokenResult.issues.find((i) => i.id === "bot-search-blocked-path")?.examples[0]?.detail ?? "";
    expect(search).toContain("Bingbot");
    expect(brokenResult.issues.map((i) => i.id)).not.toContain("bot-search-blocked-home");
  });

  it("obeyed robots.txt: nothing under /private/ was requested", () => {
    expect(broken.requests.filter((r) => r.path.startsWith("/private/"))).toEqual([]);
  });

  it("stopped following the long redirect chain at the limit", () => {
    const paths = broken.requests.map((r) => r.path);
    expect(paths).toContain("/hop-5");
    expect(paths).not.toContain("/hop-6");
    expect(paths).not.toContain("/chain-end");
  });

  it("shows the raw HTML of the client-rendered page as empty", () => {
    const app = brokenResult.pages.find((p) => p.url.endsWith("/app"));
    expect(app?.words).toBe(0);
  });
});
