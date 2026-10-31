import { describe, expect, it } from "vitest";
import { Fetcher } from "../src/http.js";
import { loadSitemaps, parseSitemapXml } from "../src/sitemap.js";
import { html, withServer } from "./helpers.js";

const urlset = (...locs: string[]) => `<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${locs.map((l) => `<url><loc>${l}</loc><lastmod>2026-01-01</lastmod></url>`).join("")}</urlset>`;
const index = (...locs: string[]) => `<sitemapindex>${locs.map((l) => `<sitemap><loc>${l}</loc></sitemap>`).join("")}</sitemapindex>`;
const xml = (body: string) => html(body, { type: "application/xml" });
const fetcher = () => new Fetcher({ userAgent: "t", delayMs: 0 });

describe("parseSitemapXml", () => {
  it("reads a urlset, decoding entities and CDATA", () => {
    const f = parseSitemapXml("u", 200, urlset("http://a.test/x?a=1&amp;b=2", "<![CDATA[http://a.test/y]]>"));
    expect(f.kind).toBe("urlset");
    expect(f.urls).toEqual(["http://a.test/x?a=1&b=2", "http://a.test/y"]);
  });
  it("reads a sitemap index", () => {
    const f = parseSitemapXml("u", 200, index("http://a.test/s1.xml", "http://a.test/s2.xml"));
    expect(f.kind).toBe("index");
    expect(f.children).toEqual(["http://a.test/s1.xml", "http://a.test/s2.xml"]);
  });
  it("flags anything else as invalid", () => {
    const f = parseSitemapXml("u", 200, "<html><body>Not found</body></html>");
    expect(f.kind).toBe("invalid");
    expect(f.error).toMatch(/urlset/);
  });
});

describe("loadSitemaps", () => {
  it("follows a sitemap index into its children and de-duplicates URLs", async () => {
    await withServer(
      {
        "/sitemap.xml": ({ origin }) => ({ type: "application/xml", body: index(`${origin}/a.xml`, `${origin}/b.xml`) }),
        "/a.xml": xml(urlset("{{ORIGIN}}/p1", "{{ORIGIN}}/p2")),
        "/b.xml": xml(urlset("{{ORIGIN}}/p2", "{{ORIGIN}}/p3")),
      },
      async (f) => {
        const load = await loadSitemaps(fetcher(), [`${f.origin}/sitemap.xml`], f.origin);
        expect(load.files.map((x) => x.kind)).toEqual(["index", "urlset", "urlset"]);
        expect(load.urls).toEqual([`${f.origin}/p1`, `${f.origin}/p2`, `${f.origin}/p3`]);
        expect(load.offOrigin).toEqual([]);
        expect(load.source.get(`${f.origin}/p3`)).toBe(`${f.origin}/b.xml`);
      },
    );
  });

  it("records a missing sitemap without throwing", async () => {
    await withServer({}, async (f) => {
      const load = await loadSitemaps(fetcher(), [`${f.origin}/sitemap.xml`], f.origin);
      expect(load.files).toHaveLength(1);
      expect(load.files[0]?.kind).toBe("invalid");
      expect(load.files[0]?.status).toBe(404);
      expect(load.urls).toEqual([]);
    });
  });

  it("lists off-origin URLs and invalid URLs separately", async () => {
    await withServer({ "/sitemap.xml": xml(urlset("https://elsewhere.example/p", "not a url")) }, async (f) => {
      const load = await loadSitemaps(fetcher(), [`${f.origin}/sitemap.xml`], f.origin);
      expect(load.offOrigin).toEqual(["https://elsewhere.example/p"]);
      expect(load.invalid).toEqual(["not a url"]);
    });
  });

  it("does not fetch sitemaps on another origin or .gz sitemaps, and says so", async () => {
    await withServer({}, async (f) => {
      const load = await loadSitemaps(fetcher(), ["https://elsewhere.example/s.xml", `${f.origin}/s.xml.gz`], f.origin);
      expect(load.files).toEqual([]);
      expect(load.notes.join(" ")).toMatch(/another origin/);
      expect(load.notes.join(" ")).toMatch(/gzip/);
      expect(f.requests).toHaveLength(0);
    });
  });

  it("stops at the sitemap-file and URL caps", async () => {
    await withServer({ "/s.xml": xml(urlset("http://a.test/1", "http://a.test/2", "http://a.test/3")) }, async (f) => {
      const load = await loadSitemaps(fetcher(), [`${f.origin}/s.xml`], f.origin, { maxUrls: 2 });
      expect(load.urls).toHaveLength(2);
      expect(load.truncated).toBe(true);
      const many = await loadSitemaps(fetcher(), [`${f.origin}/s.xml`, `${f.origin}/s2.xml`, `${f.origin}/s3.xml`], f.origin, { maxSitemaps: 2 });
      expect(many.files).toHaveLength(2);
      expect(many.truncated).toBe(true);
    });
  });
});
