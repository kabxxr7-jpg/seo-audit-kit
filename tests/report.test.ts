import { describe, expect, it } from "vitest";
import { groupFindings, runAudit, type AuditResult } from "../src/audit.js";
import { CATALOG } from "../src/catalog.js";
import { renderJson, renderMarkdown } from "../src/report.js";
import { brokenSite } from "../fixtures/broken-site.js";
import { goodSite } from "../fixtures/good-site.js";
import { startFixture } from "../fixtures/server.js";
import { html, simplePage, withServer } from "./helpers.js";

const fixedClock = () => new Date("2026-11-01T10:00:00.000Z");

async function auditSite(site: typeof goodSite, o: { maxPages?: number } = {}): Promise<AuditResult> {
  const f = await startFixture(site);
  try {
    return await runAudit({ startUrl: f.origin + "/", delayMs: 0, maxPages: o.maxPages ?? 100, clock: fixedClock });
  } finally {
    await f.close();
  }
}

describe("groupFindings", () => {
  it("groups by id, counts distinct URLs, and orders by severity then count", () => {
    const issues = groupFindings([
      { id: "title-too-long", url: "http://a/1" },
      { id: "title-missing", url: "http://a/1" },
      { id: "title-missing", url: "http://a/2", detail: "x" },
      { id: "title-missing", url: "http://a/2", detail: "y" },
      { id: "lang-missing", url: "http://a/1" },
      { id: "lang-missing", url: "http://a/2" },
      { id: "lang-missing", url: "http://a/3" },
    ]);
    expect(issues.map((i) => i.id)).toEqual(["title-missing", "lang-missing", "title-too-long"]);
    expect(issues[0]?.count).toBe(2);
    expect(issues[0]?.examples).toHaveLength(3);
    expect(issues[0]?.severity).toBe("high");
    expect(issues[0]?.fix).toBe(CATALOG["title-missing"].fix);
  });
});

describe("catalog", () => {
  it("every check has plain-English title, reason and fix text", () => {
    for (const [id, def] of Object.entries(CATALOG)) {
      expect(def.title.length, id).toBeGreaterThan(8);
      expect(def.why.length, id).toBeGreaterThan(15);
      expect(def.fix.length, id).toBeGreaterThan(15);
      expect(["high", "medium", "low"]).toContain(def.severity);
    }
  });
});

describe("markdown report for the broken fixture", () => {
  it("has the expected sections, in order, and no score", async () => {
    const md = renderMarkdown(await auditSite(brokenSite));
    const order = ["# SEO audit:", "## Summary", "## Crawl overview", "## Issues", "### High priority", "### Medium priority", "### Low priority", "## Crawler and AI-bot access (robots.txt)", "## Content visible without JavaScript", "## Structured data (JSON-LD)", "## What was not checked"];
    let at = -1;
    for (const h of order) {
      const i = md.indexOf(h);
      expect(i, h).toBeGreaterThan(at);
      at = i;
    }
    expect(md).not.toMatch(/\bscore\b\s*[:=]?\s*\d/i);
    expect(md).toContain("There is no score");
  });

  it("lists each issue with why, how to fix, a count and examples", async () => {
    const r = await auditSite(brokenSite);
    const md = renderMarkdown(r);
    expect(md).toContain("#### Pages without a title (`title-missing`): 1 URL");
    expect(md).toContain("**How to fix:** " + CATALOG["title-missing"].fix);
    expect(md).toContain("**Why it matters:** " + CATALOG["title-missing"].why);
    expect(md).toContain(`- ${r.target.replace(/\/$/, "")}/contact - no title element`);
    expect(md).toContain(`**${r.counts.high} high**, **${r.counts.medium} medium**, **${r.counts.low} low**`);
  });

  it("puts high-priority issues before medium and low", async () => {
    const md = renderMarkdown(await auditSite(brokenSite));
    expect(md.indexOf("(`title-missing`)")).toBeLessThan(md.indexOf("(`orphan-page`)"));
    expect(md.indexOf("(`orphan-page`)")).toBeLessThan(md.indexOf("(`url-uppercase`)"));
  });

  it("shows at most five examples per issue and says how many more there are", async () => {
    const routes: Record<string, ReturnType<typeof html>> = { "/": html(simplePage({ body: Array.from({ length: 9 }, (_, i) => `<a href="/p${i}">p</a>`).join("") })) };
    for (let i = 0; i < 9; i++) routes[`/p${i}`] = html(simplePage({ title: null, body: `<h1>H</h1><p>${"word ".repeat(200)}${i}</p>` }));
    await withServer(routes, async (f) => {
      const r = await runAudit({ startUrl: f.origin + "/", delayMs: 0 });
      const md = renderMarkdown(r);
      const start = md.indexOf("#### Pages without a title");
      const section = md.slice(start, md.indexOf("\n#### ", start));
      expect(section).toContain("9 URLs");
      expect(section.split("\n").filter((l) => l.startsWith("- http")).length).toBe(5);
      expect(section).toContain("and 4 more occurrence(s)");
    });
  });

  it("renders the bot table with blocked cells and rules", async () => {
    const md = renderMarkdown(await auditSite(brokenSite));
    expect(md).toMatch(/\| Path \| Googlebot \| Bingbot \| GPTBot \| ClaudeBot \| PerplexityBot \| CCBot \| Google-Extended \| Applebot-Extended \|/);
    expect(md).toContain("**blocked** (Disallow: /)");
    expect(md).toContain("**blocked** (Disallow: /services)");
    expect(md).toMatch(/\| \/ \| allowed \| allowed \| \*\*blocked\*\*/);
    expect(md).toContain("GPTBot = its own group");
  });

  it("states what was not checked, including the search-engine tools", async () => {
    const md = renderMarkdown(await auditSite(brokenSite));
    const section = md.slice(md.indexOf("## What was not checked"));
    expect(section).toMatch(/Google Search Console/);
    expect(section).toMatch(/Rich Results Test/);
    expect(section).toMatch(/Lighthouse/);
    expect(section).toMatch(/JavaScript was not run/);
    expect(section).toMatch(/Microdata or RDFa/);
    expect(md).toContain("were **not** validated with Google's Rich Results Test");
  });

  it("flags a partial audit when the page cap is hit", async () => {
    const r = await auditSite(brokenSite, { maxPages: 5 });
    expect(r.crawl.capReached).toBe(true);
    const md = renderMarkdown(r);
    expect(md).toContain("limit reached, the audit is partial");
    expect(md).toMatch(/page cap of 5 was reached/);
  });

  it("escapes pipe characters so table rows stay intact", async () => {
    const r = await auditSite(goodSite);
    r.bots.paths[1] = "/a|b";
    r.bots.rows.forEach((row) => row.results.splice(1, 0, { path: "/a|b", allowed: true }));
    const line = renderMarkdown(r).split("\n").find((l) => l.startsWith("| /a"));
    expect(line).toBeDefined();
    expect(line).toContain("/a\\|b");
    expect(line?.replace(/\\\|/g, "").split("|").length).toBe(r.bots.rows.length + 3);
  });
});

describe("markdown safety and wording", () => {
  it("escapes angle brackets that came from page content", async () => {
    const r = await auditSite(brokenSite);
    const issue = r.issues.find((i) => i.id === "title-missing");
    if (issue?.examples[0]) issue.examples[0].detail = 'title was "<script>alert(1)</script>"';
    const md = renderMarkdown(r);
    expect(md).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(md).not.toContain("<script>alert(1)");
  });
  it("describes a zero delay plainly instead of 'at least 0 ms'", async () => {
    const md = renderMarkdown(await auditSite(goodSite));
    expect(md).toContain("no pause between requests (--delay-ms 0)");
    expect(md).not.toContain("at least 0 ms");
  });
});

describe("report for the good fixture", () => {
  it("says no issues were found but points at the limits", async () => {
    const md = renderMarkdown(await auditSite(goodSite));
    expect(md).toContain("No issues were found by the checks that were run");
    expect(md).toContain("**0 high**, **0 medium**, **0 low**");
    expect(md).toContain("## What was not checked");
  });
});

describe("JSON report", () => {
  it("is valid JSON with the same counts as the markdown, a timestamp, and no score field", async () => {
    const r = await auditSite(brokenSite);
    const parsed = JSON.parse(renderJson(r)) as AuditResult;
    expect(parsed.generatedAt).toBe("2026-11-01T10:00:00.000Z");
    expect(parsed.counts).toEqual(r.counts);
    expect(parsed.issues.length).toBe(r.issues.length);
    expect(parsed.issues[0]).toMatchObject({ id: expect.any(String), severity: "high", fix: expect.any(String), count: expect.any(Number) });
    expect(Object.keys(parsed)).not.toContain("score");
    expect(parsed.notChecked.length).toBeGreaterThan(5);
    expect(parsed.bots.rows).toHaveLength(8);
    expect(parsed.settings.userAgent).toMatch(/^seo-audit-kit\//);
  });

  it("counts match the issue list", async () => {
    const r = await auditSite(brokenSite);
    expect(r.counts.high + r.counts.medium + r.counts.low).toBe(r.counts.issueTypes);
    expect(r.counts.issueTypes).toBe(r.issues.length);
    expect(r.counts.high).toBe(r.issues.filter((i) => i.severity === "high").length);
  });
});

describe("a refused crawl", () => {
  it("still produces a report that says so, plus the bot table", async () => {
    await withServer({ "/robots.txt": { type: "text/plain", body: "User-agent: *\nDisallow: /\n" }, "/": html(simplePage()) }, async (f) => {
      const r = await runAudit({ startUrl: f.origin + "/", delayMs: 0, clock: fixedClock });
      expect(r.crawl.refused?.reason).toBe("start-blocked-by-robots");
      expect(r.issues.map((i) => i.id)).toContain("robots-blocks-audit");
      const md = renderMarkdown(r);
      expect(md).toContain("The crawl did not run.");
      expect(md).toContain("Pages fetched: **0**");
      expect(r.bots.rows.find((b) => b.bot === "Googlebot")?.results[0]?.allowed).toBe(false);
    });
  });
});
