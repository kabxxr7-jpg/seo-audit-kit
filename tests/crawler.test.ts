import { describe, expect, it } from "vitest";
import { HARD_MAX_PAGES, crawl } from "../src/crawler.js";
import { startFixture } from "../fixtures/server.js";
import { html, simplePage, withServer } from "./helpers.js";

const links = (...hrefs: string[]) => simplePage({ body: `<h1>H</h1>${hrefs.map((h) => `<a href="${h}">link</a>`).join("")}` });
const robotsTxt = (body: string) => ({ type: "text/plain", body });
const paths = (requests: { path: string }[]) => requests.map((r) => r.path);
const pagePaths = (requests: { path: string }[]) => paths(requests).filter((p) => p !== "/robots.txt" && p !== "/sitemap.xml");
const run = (origin: string, o: Partial<Parameters<typeof crawl>[0]> = {}) => crawl({ startUrl: origin + "/", delayMs: 0, ...o });

describe("what the crawler records", () => {
  it("keeps status, redirect chain, response time, content type and depth for each URL", async () => {
    await withServer(
      {
        "/": html(links("/old", "/missing", "/slow")),
        "/old": { status: 301, headers: { location: "/new" } },
        "/new": html(simplePage({ title: "New page here" })),
        "/slow": html(simplePage(), { delayMs: 120 }),
        "/data": { type: "application/json", body: "{}" },
      },
      async (f) => {
        const r = await run(f.origin);
        const old = r.byUrl.get(`${f.origin}/old`)!;
        expect(old.status).toBe(301);
        expect(old.finalStatus).toBe(200);
        expect(old.finalUrl).toBe(`${f.origin}/new`);
        expect(old.redirectChain).toEqual([{ url: `${f.origin}/old`, status: 301, location: `${f.origin}/new` }]);
        expect(old.page).toBeNull(); // content belongs to /new
        const target = r.byUrl.get(`${f.origin}/new`)!;
        expect(target.source).toBe("redirect");
        expect(target.page?.title).toBe("New page here");
        expect(target.contentType).toContain("text/html");
        expect(target.inlinks).toEqual([f.origin + "/"]); // a link to /old counts as a link to /new
        expect(r.byUrl.get(`${f.origin}/missing`)?.status).toBe(404);
        expect(r.byUrl.get(`${f.origin}/slow`)?.timeMs).toBeGreaterThanOrEqual(100);
        expect(r.byUrl.get(f.origin + "/")?.depth).toBe(0);
        expect(r.byUrl.get(`${f.origin}/slow`)?.depth).toBe(1);
      },
    );
  });

  it("fetches a redirect target once even when it is also linked", async () => {
    await withServer({ "/": html(links("/old", "/new")), "/old": { status: 301, headers: { location: "/new" } }, "/new": html(simplePage()) }, async (f) => {
      await run(f.origin);
      expect(paths(f.requests).filter((p) => p === "/new")).toHaveLength(1);
    });
  });

  it("does not parse non-HTML responses", async () => {
    await withServer({ "/": html(links("/data")), "/data": { type: "application/json", body: '{"a":1}' } }, async (f) => {
      const r = await run(f.origin);
      const d = r.byUrl.get(`${f.origin}/data`)!;
      expect(d.isHtml).toBe(false);
      expect(d.page).toBeNull();
      expect(d.contentType).toContain("json");
    });
  });

  it("ignores fragments, mailto links and self links, and never requests a URL twice", async () => {
    await withServer({ "/": html(links("#top", "/#x", "mailto:a@b.test", "tel:123", "/a", "/a#frag", "/a?")) , "/a": html(links("/a", "/")) }, async (f) => {
      const r = await run(f.origin);
      expect(r.pages.map((p) => p.url.replace(f.origin, ""))).toEqual(["/", "/a"]);
      const a = r.byUrl.get(`${f.origin}/a`)!;
      expect(a.inlinks).toEqual([f.origin + "/"]); // not itself
      expect(paths(f.requests).filter((p) => p === "/a")).toHaveLength(1);
    });
  });

  it("skips linked files that are clearly not pages and lists them", async () => {
    await withServer({ "/": html(links("/doc.pdf", "/pic.PNG", "/ok")), "/ok": html(simplePage()) }, async (f) => {
      const r = await run(f.origin);
      expect(pagePaths(f.requests)).toEqual(["/", "/ok"]);
      expect(r.skipped.map((s) => s.url.replace(f.origin, ""))).toEqual(["/doc.pdf", "/pic.PNG"]);
    });
  });

  it("does not follow rel=nofollow links or links on a nofollow page", async () => {
    await withServer(
      {
        "/": html(`<html><body><a href="/a">a</a><a href="/b" rel="nofollow">b</a><a href="/nf-page">nf</a></body></html>`),
        "/a": html(simplePage()),
        "/b": html(simplePage()),
        "/nf-page": html(`<html><head><meta name="robots" content="nofollow"></head><body><a href="/c">c</a></body></html>`),
        "/c": html(simplePage()),
      },
      async (f) => {
        await run(f.origin);
        expect(pagePaths(f.requests).sort()).toEqual(["/", "/a", "/nf-page"]);
      },
    );
  });
});

describe("same origin only", () => {
  it("never requests another origin (including the same host on another port)", async () => {
    const other = await startFixture({ name: "other", routes: { "/": html(simplePage()), "/x": html(simplePage()) } });
    try {
      await withServer({ "/": html(links(other.origin + "/", other.origin + "/x", "https://elsewhere.example/p", "/mine")), "/mine": html(simplePage()) }, async (f) => {
        const r = await run(f.origin);
        expect(other.requests).toHaveLength(0);
        expect(r.pages.map((p) => p.url.replace(f.origin, ""))).toEqual(["/", "/mine"]);
      });
    } finally {
      await other.close();
    }
  });

  it("does not follow a redirect to another origin", async () => {
    const other = await startFixture({ name: "other", routes: { "/landing": html(simplePage()) } });
    try {
      await withServer({ "/": html(links("/out")), "/out": { status: 302, headers: { location: other.origin + "/landing" } } }, async (f) => {
        const r = await run(f.origin);
        expect(r.byUrl.get(`${f.origin}/out`)?.outcome).toBe("external-redirect");
        expect(other.requests).toHaveLength(0);
      });
    } finally {
      await other.close();
    }
  });
});

describe("robots.txt", () => {
  it("never requests a disallowed URL and lists it with the rule and who linked to it", async () => {
    await withServer(
      { "/robots.txt": robotsTxt("User-agent: *\nDisallow: /secret/\n"), "/": html(links("/secret/x", "/ok")), "/ok": html(simplePage()), "/secret/x": html(simplePage()) },
      async (f) => {
        const r = await run(f.origin);
        expect(paths(f.requests).some((p) => p.startsWith("/secret"))).toBe(false);
        expect(r.robotsBlocked).toEqual([{ url: `${f.origin}/secret/x`, rule: "Disallow: /secret/", from: [f.origin + "/"] }]);
      },
    );
  });

  it("applies the group that names this crawler instead of *", async () => {
    await withServer(
      { "/robots.txt": robotsTxt("User-agent: *\nDisallow: /\n\nUser-agent: seo-audit-kit\nDisallow: /nope\n"), "/": html(links("/nope", "/fine")), "/fine": html(simplePage()), "/nope": html(simplePage()) },
      async (f) => {
        const r = await run(f.origin);
        expect(r.refused).toBeNull();
        expect(pagePaths(f.requests).sort()).toEqual(["/", "/fine"]);
      },
    );
  });

  it("refuses to crawl when the start URL is disallowed, requesting nothing but robots.txt", async () => {
    await withServer({ "/robots.txt": robotsTxt("User-agent: *\nDisallow: /\n"), "/": html(simplePage()) }, async (f) => {
      const r = await run(f.origin);
      expect(r.refused?.reason).toBe("start-blocked-by-robots");
      expect(r.refused?.detail).toContain("Disallow: /");
      expect(r.pages).toEqual([]);
      expect(paths(f.requests)).toEqual(["/robots.txt"]);
    });
  });

  it("refuses to crawl when robots.txt gives a server error (rules unknown)", async () => {
    await withServer({ "/robots.txt": { status: 503, body: "down" }, "/": html(simplePage()) }, async (f) => {
      const r = await run(f.origin);
      expect(r.refused?.reason).toBe("robots-unavailable");
      expect(paths(f.requests)).toEqual(["/robots.txt"]);
    });
  });

  it("crawls normally when there is no robots.txt (404)", async () => {
    await withServer({ "/": html(simplePage()) }, async (f) => {
      const r = await run(f.origin);
      expect(r.refused).toBeNull();
      expect(r.robots?.found).toBe(false);
      expect(r.pages).toHaveLength(1);
    });
  });

  it("honours Crawl-delay for this crawler", async () => {
    await withServer({ "/robots.txt": robotsTxt("User-agent: *\nCrawl-delay: 0.2\n"), "/": html(links("/a", "/b")), "/a": html(simplePage()), "/b": html(simplePage()) }, async (f) => {
      const r = await run(f.origin, { delayMs: 0 });
      expect(r.effectiveDelayMs).toBe(200);
      const times = f.requests.map((x) => x.at);
      expect(times.length).toBeGreaterThanOrEqual(5); // robots, sitemap, /, /a, /b
      for (let i = 2; i < times.length; i++) expect((times[i] as number) - (times[i - 1] as number)).toBeGreaterThanOrEqual(180);
    });
  });

  it("ignores a Crawl-delay meant for another bot, and never goes below the configured delay", async () => {
    await withServer({ "/robots.txt": robotsTxt("User-agent: Googlebot\nCrawl-delay: 9\n\nUser-agent: *\nCrawl-delay: 0.01\n"), "/": html(simplePage()) }, async (f) => {
      expect((await run(f.origin, { delayMs: 0 })).effectiveDelayMs).toBe(10);
      expect((await run(f.origin, { delayMs: 50 })).effectiveDelayMs).toBe(50);
    });
  });
});

describe("limits", () => {
  const chain = (n: number): Record<string, ReturnType<typeof html>> => {
    const routes: Record<string, ReturnType<typeof html>> = {};
    for (let i = 0; i < n; i++) routes[i === 0 ? "/" : `/p${i}`] = html(links(`/p${i + 1}`));
    routes[`/p${n}`] = html(simplePage());
    return routes;
  };

  it("stops at the page cap and reports what it left", async () => {
    await withServer(chain(10), async (f) => {
      const r = await run(f.origin, { maxPages: 3 });
      expect(r.pages).toHaveLength(3);
      expect(r.capReached).toBe(true);
      expect(pagePaths(f.requests)).toHaveLength(3);
      expect(r.notCrawled.map((u) => u.replace(f.origin, ""))).toEqual(["/p3"]);
    });
  });

  it("does not report a cap when everything fit", async () => {
    await withServer(chain(2), async (f) => {
      const r = await run(f.origin, { maxPages: 3 });
      expect(r.pages).toHaveLength(3);
      expect(r.capReached).toBe(false);
    });
  });

  it("cannot be raised above the hard limit", async () => {
    await withServer({ "/": html(simplePage()) }, async (f) => {
      expect((await run(f.origin, { maxPages: 100_000 })).maxPages).toBe(HARD_MAX_PAGES);
      expect(HARD_MAX_PAGES).toBe(500);
      expect((await run(f.origin, { maxPages: 0 })).maxPages).toBe(1);
    });
  });

  it("stops at the depth cap", async () => {
    await withServer(chain(5), async (f) => {
      const r = await run(f.origin, { maxDepth: 2 });
      expect(r.pages.map((p) => p.depth)).toEqual([0, 1, 2]);
      expect(pagePaths(f.requests)).toEqual(["/", "/p1", "/p2"]);
      expect(r.notCrawled.map((u) => u.replace(f.origin, ""))).toEqual(["/p3"]);
      expect(r.capReached).toBe(false);
      expect((await run(f.origin, { maxDepth: 0 })).pages).toHaveLength(1);
    });
  });

  it("follows redirects up to the chain limit and no further", async () => {
    const routes: Record<string, { status: number; headers: Record<string, string> } | ReturnType<typeof html>> = { "/": html(links("/r0")) };
    for (let i = 0; i < 6; i++) routes[`/r${i}`] = { status: 301, headers: { location: `/r${i + 1}` } };
    routes["/r6"] = html(simplePage());
    await withServer(routes, async (f) => {
      const r = await run(f.origin, { maxRedirects: 3 });
      const rec = r.byUrl.get(`${f.origin}/r0`)!;
      expect(rec.outcome).toBe("too-many-redirects");
      expect(rec.redirectChain).toHaveLength(4);
      expect(paths(f.requests)).not.toContain("/r4");
      const ok = await run(f.origin, { maxRedirects: 10 });
      expect(ok.byUrl.get(`${f.origin}/r0`)?.outcome).toBe("ok");
      expect(ok.byUrl.get(`${f.origin}/r6`)?.source).toBe("redirect");
    });
  });
});

describe("sitemaps", () => {
  const urlset = (...locs: string[]) => `<urlset>${locs.map((l) => `<url><loc>${l}</loc></url>`).join("")}</urlset>`;

  it("finds a sitemap declared in robots.txt, including an index, and crawls listed pages that are not linked", async () => {
    await withServer(
      {
        "/robots.txt": robotsTxt("User-agent: *\nDisallow:\nSitemap: {{ORIGIN}}/maps/index.xml\n"),
        "/maps/index.xml": { type: "application/xml", body: `<sitemapindex><sitemap><loc>{{ORIGIN}}/maps/one.xml</loc></sitemap></sitemapindex>` },
        "/maps/one.xml": { type: "application/xml", body: urlset("{{ORIGIN}}/", "{{ORIGIN}}/linked", "{{ORIGIN}}/hidden") },
        "/": html(links("/linked")),
        "/linked": html(simplePage()),
        "/hidden": html(simplePage()),
      },
      async (f) => {
        const r = await run(f.origin);
        expect(r.sitemap.files.map((x) => x.kind)).toEqual(["index", "urlset"]);
        expect(r.sitemap.urls).toEqual([`${f.origin}/`, `${f.origin}/linked`, `${f.origin}/hidden`]);
        const hidden = r.byUrl.get(`${f.origin}/hidden`)!;
        expect(hidden.source).toBe("sitemap");
        expect(hidden.inlinks).toEqual([]);
        expect(r.byUrl.get(`${f.origin}/linked`)?.inlinks).toEqual([f.origin + "/"]);
        expect(paths(f.requests)).not.toContain("/sitemap.xml"); // robots.txt named another sitemap; the default is only a fallback
      },
    );
  });

  it("falls back to /sitemap.xml when robots.txt names none", async () => {
    await withServer({ "/sitemap.xml": { type: "application/xml", body: urlset("{{ORIGIN}}/") }, "/": html(simplePage()) }, async (f) => {
      const r = await run(f.origin);
      expect(r.sitemap.urls).toEqual([f.origin + "/"]);
    });
  });

  it("with the page cap reached, sitemap URLs are left uncrawled and reported", async () => {
    await withServer({ "/sitemap.xml": { type: "application/xml", body: urlset("{{ORIGIN}}/", "{{ORIGIN}}/a", "{{ORIGIN}}/b") }, "/": html(simplePage()), "/a": html(simplePage()), "/b": html(simplePage()) }, async (f) => {
      const r = await run(f.origin, { maxPages: 2 });
      expect(r.pages).toHaveLength(2);
      expect(r.capReached).toBe(true);
      expect(r.notCrawled.map((u) => u.replace(f.origin, ""))).toEqual(["/b"]);
    });
  });
});

describe("canonical and hreflang targets", () => {
  it("are fetched so they can be verified, even beyond the depth cap", async () => {
    await withServer(
      {
        "/": html(simplePage({ head: '<link rel="canonical" href="{{ORIGIN}}/elsewhere"><link rel="alternate" hreflang="fr" href="/fr">' })),
        "/elsewhere": html(simplePage()),
        "/fr": html(simplePage()),
      },
      async (f) => {
        const r = await run(f.origin, { maxDepth: 0 });
        expect(r.byUrl.get(`${f.origin}/elsewhere`)?.source).toBe("canonical");
        expect(r.byUrl.get(`${f.origin}/fr`)?.source).toBe("hreflang");
      },
    );
  });
});

describe("politeness and input handling", () => {
  it("identifies itself on every request", async () => {
    await withServer({ "/": html(links("/a")), "/a": html(simplePage()) }, async (f) => {
      await run(f.origin);
      expect(f.requests.length).toBeGreaterThan(2);
      expect(new Set(f.requests.map((r) => r.userAgent)).size).toBe(1);
      expect(f.requests[0]?.userAgent).toMatch(/^seo-audit-kit\//);
      await run(f.origin, { userAgent: "custom-agent/2" });
      expect(f.requests.at(-1)?.userAgent).toBe("custom-agent/2");
    });
  });

  it("sends only GET requests", async () => {
    await withServer({ "/": html(links("/a")), "/a": html(simplePage()) }, async (f) => {
      await run(f.origin);
      expect(new Set(f.requests.map((r) => r.method))).toEqual(new Set(["GET"]));
    });
  });

  it("refuses a start value that is not an http(s) URL without any request", async () => {
    const r = await crawl({ startUrl: "ftp://example.test/", delayMs: 0 });
    expect(r.refused?.reason).toBe("invalid-start-url");
    expect(r.requests).toBe(0);
  });

  it("refuses cleanly (no exception) when the site cannot be reached at all", async () => {
    const r = await crawl({ startUrl: "http://127.0.0.1:1/", delayMs: 0 });
    expect(r.refused?.reason).toBe("robots-unavailable");
  });
});
