import { describe, expect, it } from "vitest";
import { DEFAULT_THRESHOLDS, textHash } from "../src/checks.js";
import { checkFake, fakeCrawl, fids, furls, words } from "./helpers.js";

const O = "http://site.test";
const S = "https://site.test";

/** A complete, correct page. Pass overrides to break exactly one thing. */
function good(o: { title?: string | null; desc?: string | null; body?: string; head?: string; lang?: string | null; viewport?: boolean; canonical?: string | null; path?: string; origin?: string; social?: boolean } = {}): string {
  const origin = o.origin ?? O;
  const path = o.path ?? "/";
  const title = o.title === undefined ? "A good page title for testing" : o.title;
  const desc = o.desc === undefined ? "This description is long enough to pass the length check, and short enough to avoid being cut off in results." : o.desc;
  const canonical = o.canonical === undefined ? `${origin}${path}` : o.canonical;
  const lang = o.lang === null ? "" : ` lang="${o.lang ?? "en"}"`;
  return `<!doctype html><html${lang}><head><meta charset="utf-8">
${o.viewport === false ? "" : '<meta name="viewport" content="width=device-width, initial-scale=1">'}
${title === null ? "" : `<title>${title}</title>`}
${desc === null ? "" : `<meta name="description" content="${desc}">`}
${canonical === null ? "" : `<link rel="canonical" href="${canonical}">`}
${o.social === false ? "" : '<meta property="og:title" content="t"><meta property="og:description" content="d"><meta property="og:image" content="i"><meta name="twitter:card" content="summary">'}
${o.head ?? ""}</head><body><main>${o.body ?? `<h1>Main heading</h1><h2>Sub</h2><p>${words(200)}</p><a href="/">home</a>`}</main></body></html>`;
}

describe("a correct page", () => {
  it("produces no findings", () => {
    expect(checkFake(fakeCrawl(S, { "/": good({ origin: S }) }, { robotsTxt: `User-agent: *\nDisallow:\nSitemap: ${S}/sitemap.xml\n`, sitemap: ["/"] }))).toEqual([]);
  });
});

describe("titles", () => {
  it("missing, empty, too long, too short", () => {
    const f = checkFake(
      fakeCrawl(O, {
        "/": good({ title: null }),
        "/empty": good({ title: "   ", path: "/empty" }),
        "/long": good({ title: "x".repeat(61), path: "/long" }),
        "/exact": good({ title: "y".repeat(60), path: "/exact" }),
        "/short": good({ title: "Short", path: "/short" }),
        "/min": good({ title: "z".repeat(15), path: "/min" }),
      }),
    );
    expect(furls(f, "title-missing")).toEqual([`${O}/`, `${O}/empty`]);
    expect(furls(f, "title-too-long")).toEqual([`${O}/long`]);
    expect(furls(f, "title-too-short")).toEqual([`${O}/short`]);
  });
  it("duplicates are reported on every page that shares the title, case-insensitively", () => {
    const f = checkFake(fakeCrawl(O, { "/": good({ title: "Same Title Here Ok" }), "/a": good({ title: "same title here ok", path: "/a" }), "/b": good({ title: "Different one entirely", path: "/b" }) }));
    expect(furls(f, "title-duplicate")).toEqual([`${O}/`, `${O}/a`]);
  });
  it("does not call a page a duplicate when its canonical points at the other page", () => {
    const f = checkFake(fakeCrawl(O, { "/": good({ title: "Shared Title For Pair" }), "/a": good({ title: "Shared Title For Pair", path: "/a", canonical: `${O}/` }) }));
    expect(fids(f)).not.toContain("title-duplicate");
  });
  it("ignores noindex pages when looking for duplicates", () => {
    const f = checkFake(fakeCrawl(O, { "/": good({ title: "Shared Title For Pair" }), "/a": good({ title: "Shared Title For Pair", path: "/a", head: '<meta name="robots" content="noindex">' }) }));
    expect(fids(f)).not.toContain("title-duplicate");
  });
  it("thresholds are configurable", () => {
    const f = checkFake(fakeCrawl(O, { "/": good({ title: "x".repeat(40) }) }), { ...DEFAULT_THRESHOLDS, titleMax: 30 });
    expect(fids(f)).toContain("title-too-long");
  });
});

describe("meta descriptions", () => {
  it("missing, too long, too short, duplicate", () => {
    const f = checkFake(
      fakeCrawl(O, {
        "/": good({ desc: null, title: "One title is here" }),
        "/long": good({ desc: "d".repeat(161), path: "/long", title: "Two title is here" }),
        "/edge": good({ desc: "d".repeat(160), path: "/edge", title: "Three title is here" }),
        "/short": good({ desc: "tiny", path: "/short", title: "Four title is here" }),
        "/dup1": good({ desc: "A shared description that is long enough to pass the length check on its own, for sure.", path: "/dup1", title: "Five title is here" }),
        "/dup2": good({ desc: "A shared description that is long enough to pass the length check on its own, for sure.", path: "/dup2", title: "Six title is here" }),
      }),
    );
    expect(furls(f, "meta-description-missing")).toEqual([`${O}/`]);
    expect(furls(f, "meta-description-too-long")).toEqual([`${O}/long`]);
    expect(furls(f, "meta-description-too-short")).toEqual([`${O}/short`]);
    expect(furls(f, "meta-description-duplicate")).toEqual([`${O}/dup1`, `${O}/dup2`]);
  });
});

describe("headings", () => {
  it("exactly one h1: none, empty, several", () => {
    const f = checkFake(
      fakeCrawl(O, {
        "/": good({ body: `<p>${words(200)}</p>` }),
        "/empty": good({ path: "/empty", body: `<h1> </h1><p>${words(200)}</p>` }),
        "/two": good({ path: "/two", body: `<h1>A</h1><h1>B</h1><p>${words(200)}</p>` }),
        "/one": good({ path: "/one", body: `<h1>A</h1><p>${words(200)}</p>` }),
      }),
    );
    expect(furls(f, "h1-missing")).toEqual([`${O}/`, `${O}/empty`]);
    expect(furls(f, "h1-multiple")).toEqual([`${O}/two`]);
  });
  it("flags skipped levels once per page but allows going back up", () => {
    const f = checkFake(
      fakeCrawl(O, {
        "/": good({ body: `<h1>A</h1><h2>B</h2><h4>C</h4><h2>D</h2><h5>E</h5><p>${words(200)}</p>` }),
        "/ok": good({ path: "/ok", body: `<h1>A</h1><h2>B</h2><h3>C</h3><h2>D</h2><h1>Z</h1><p>${words(200)}</p>` }),
      }),
    );
    expect(furls(f, "heading-order")).toEqual([`${O}/`]);
    expect(f.find((x) => x.id === "heading-order")?.detail).toContain("h2");
  });
});

describe("canonical", () => {
  const pageWith = (path: string, canonical: string | null, extra = "") => good({ path, canonical, title: `Title for ${path} page`, desc: `Description for ${path} page that is long enough to be accepted by the length check here.`, head: extra });

  it("missing", () => {
    expect(furls(checkFake(fakeCrawl(O, { "/": pageWith("/", null) })), "canonical-missing")).toEqual([`${O}/`]);
  });
  it("self-referencing is fine, relative canonicals resolve", () => {
    const f = checkFake(fakeCrawl(O, { "/a": pageWith("/a", "/a"), "/b": pageWith("/b", `${O}/b`) }));
    expect(fids(f).filter((i) => i.startsWith("canonical"))).toEqual([]);
  });
  it("points elsewhere", () => {
    const f = checkFake(fakeCrawl(O, { "/a": pageWith("/a", `${O}/b`), "/b": pageWith("/b", `${O}/b`) }));
    expect(furls(f, "canonical-not-self")).toEqual([`${O}/a`]);
  });
  it("points to a redirect", () => {
    const f = checkFake(fakeCrawl(O, { "/a": pageWith("/a", `${O}/old`), "/old": { html: "", redirectTo: "/b" }, "/b": pageWith("/b", `${O}/b`) }));
    expect(furls(f, "canonical-to-redirect")).toEqual([`${O}/a`]);
  });
  it("points to a 404 or 500", () => {
    const f = checkFake(fakeCrawl(O, { "/a": pageWith("/a", `${O}/gone`), "/c": pageWith("/c", `${O}/boom`), "/gone": { html: "", status: 404 }, "/boom": { html: "", status: 500 } }));
    expect(furls(f, "canonical-to-error")).toEqual([`${O}/a`, `${O}/c`]);
  });
  it("points to a noindex page", () => {
    const f = checkFake(fakeCrawl(O, { "/a": pageWith("/a", `${O}/hidden`), "/hidden": pageWith("/hidden", `${O}/hidden`, '<meta name="robots" content="noindex">') }));
    expect(furls(f, "canonical-to-noindex")).toEqual([`${O}/a`]);
  });
  it("chains: A to B, and B to C", () => {
    const f = checkFake(fakeCrawl(O, { "/a": pageWith("/a", `${O}/b`), "/b": pageWith("/b", `${O}/c`), "/c": pageWith("/c", `${O}/c`) }));
    expect(furls(f, "canonical-chain")).toEqual([`${O}/a`]);
    expect(furls(f, "canonical-not-self")).toEqual([`${O}/b`]);
  });
  it("several different canonicals, an invalid one, and another site", () => {
    const f = checkFake(
      fakeCrawl(O, {
        "/m": pageWith("/m", `${O}/m`, `<link rel="canonical" href="${O}/other">`),
        "/bad": pageWith("/bad", "http://"),
        "/ext": pageWith("/ext", "https://other.example/x"),
      }),
    );
    expect(furls(f, "canonical-multiple")).toEqual([`${O}/m`]);
    expect(furls(f, "canonical-invalid")).toEqual([`${O}/bad`]);
    expect(furls(f, "canonical-external")).toEqual([`${O}/ext`]);
  });
  it("an https page with an http canonical on the same host", () => {
    const f = checkFake(fakeCrawl(S, { "/a": pageWith("/a", `${O}/a`) }));
    expect(furls(f, "canonical-http-on-https")).toEqual([`${S}/a`]);
    expect(fids(f)).not.toContain("canonical-external");
  });
});

describe("noindex", () => {
  const noindex = '<meta name="robots" content="noindex, follow">';
  it("is high priority on the start page or a sitemap page, otherwise low", () => {
    const f = checkFake(
      fakeCrawl(
        O,
        { "/": good({ head: noindex }), "/in-map": good({ path: "/in-map", head: noindex, title: "In map page title" }), "/other": good({ path: "/other", head: noindex, title: "Other page title x" }) },
        { sitemap: ["/in-map"] },
      ),
    );
    expect(furls(f, "noindex-key-page")).toEqual([`${O}/`, `${O}/in-map`]);
    expect(furls(f, "noindex-page")).toEqual([`${O}/other`]);
  });
  it("also reads the X-Robots-Tag header and 'none'", () => {
    const f = checkFake(fakeCrawl(O, { "/": good(), "/h": { html: good({ path: "/h", title: "Header noindex page" }), xRobotsTag: "noindex, nofollow" }, "/n": good({ path: "/n", head: '<meta name="robots" content="none">', title: "None directive page" }) }));
    expect(furls(f, "noindex-page")).toEqual([`${O}/h`, `${O}/n`]);
  });
  it("does not mistake index for noindex", () => {
    const f = checkFake(fakeCrawl(O, { "/": good({ head: '<meta name="robots" content="index, follow">' }) }));
    expect(fids(f)).not.toContain("noindex-key-page");
  });
});

describe("hreflang", () => {
  const alt = (lang: string, href: string) => `<link rel="alternate" hreflang="${lang}" href="${href}">`;
  const pair = (aHead: string, bHead: string) => fakeCrawl(O, { "/en": good({ path: "/en", head: aHead, title: "English page title" }), "/de": good({ path: "/de", head: bHead, title: "Deutsche Seite Titel", lang: "de" }) });

  it("reciprocal links are fine", () => {
    const both = alt("en", `${O}/en`) + alt("de", `${O}/de`);
    expect(fids(checkFake(pair(both, both))).filter((i) => i.startsWith("hreflang"))).toEqual([]);
  });
  it("a missing return link is reported on the page that lacks the reciprocal", () => {
    const f = checkFake(pair(alt("en", `${O}/en`) + alt("de", `${O}/de`), ""));
    expect(furls(f, "hreflang-no-return")).toEqual([`${O}/en`]);
    expect(f.find((x) => x.id === "hreflang-no-return")?.detail).toContain("/de");
  });
  it("accepts relative hrefs on both sides", () => {
    const both = alt("en", "/en") + alt("de", "/de");
    expect(fids(checkFake(pair(both, both)))).not.toContain("hreflang-no-return");
  });
  it("invalid codes and a missing self reference", () => {
    const f = checkFake(pair(alt("de", `${O}/de`) + alt("english", `${O}/en`) + alt("en_GB", `${O}/en`) + alt("x-default", `${O}/en`), alt("en", `${O}/en`) + alt("de", `${O}/de`)));
    expect(f.filter((x) => x.id === "hreflang-invalid-code").map((x) => x.detail)).toEqual(['"english"', '"en_GB"']);
    expect(furls(f, "hreflang-missing-self")).toEqual([]); // x-default points at /en itself
    const noSelf = checkFake(pair(alt("de", `${O}/de`), alt("en", `${O}/en`) + alt("de", `${O}/de`)));
    expect(furls(noSelf, "hreflang-missing-self")).toEqual([`${O}/en`]);
  });
  it("accepts valid codes: language, region, script", () => {
    const f = checkFake(fakeCrawl(O, { "/en": good({ path: "/en", head: ["en", "en-GB", "zh-Hant", "zh-Hant-TW", "es-419", "x-default"].map((l) => alt(l, `${O}/en`)).join("") }) }));
    expect(fids(f)).not.toContain("hreflang-invalid-code");
  });
  it("a target that redirects or fails", () => {
    const f = checkFake(fakeCrawl(O, { "/en": good({ path: "/en", head: alt("en", `${O}/en`) + alt("fr", `${O}/fr`) + alt("it", `${O}/it`) }), "/fr": { html: "", redirectTo: "/en" }, "/it": { html: "", status: 404 } }));
    expect(f.filter((x) => x.id === "hreflang-target-error")).toHaveLength(2);
  });
});

describe("images and head tags", () => {
  it("images without an alt attribute; alt=\"\" is allowed", () => {
    const f = checkFake(
      fakeCrawl(O, {
        "/": good({ body: `<h1>H</h1><p>${words(200)}</p><img src="/a.png"><img src="/b.png" alt=""><img src="/c.png" alt="C">` }),
        "/ok": good({ path: "/ok", title: "Page with fine images", body: `<h1>H</h1><p>${words(200)}</p><img src="/b.png" alt="">` }),
      }),
    );
    expect(furls(f, "image-alt-missing")).toEqual([`${O}/`]);
    expect(f.find((x) => x.id === "image-alt-missing")?.detail).toContain("1 of 3");
  });
  it("Open Graph and Twitter card", () => {
    const f = checkFake(
      fakeCrawl(O, {
        "/": good({ social: false }),
        "/og": good({ path: "/og", title: "Only some OG tags", social: false, head: '<meta property="og:title" content="t"><meta name="twitter:card" content="summary">' }),
      }),
    );
    expect(furls(f, "og-tags-incomplete")).toEqual([`${O}/`, `${O}/og`]);
    expect(f.find((x) => x.id === "og-tags-incomplete" && x.url === `${O}/og`)?.detail).toBe("missing og:description, og:image");
    expect(furls(f, "twitter-card-missing")).toEqual([`${O}/`]);
  });
  it("viewport: missing, and present without width=device-width", () => {
    const f = checkFake(fakeCrawl(O, { "/": good({ viewport: false }), "/w": good({ path: "/w", title: "Fixed width viewport", viewport: false, head: '<meta name="viewport" content="width=1024">' }), "/ok": good({ path: "/ok", title: "Good viewport page" }) }));
    expect(furls(f, "viewport-missing")).toEqual([`${O}/`, `${O}/w`]);
    expect(f.find((x) => x.url === `${O}/w` && x.id === "viewport-missing")?.detail).toContain("no width=device-width");
  });
  it("lang attribute", () => {
    const f = checkFake(fakeCrawl(O, { "/": good({ lang: null }), "/ok": good({ path: "/ok", title: "Has a lang attribute" }) }));
    expect(furls(f, "lang-missing")).toEqual([`${O}/`]);
  });
});

describe("internal links", () => {
  it("links to 404, 500, and redirects are reported on the linking page", () => {
    const f = checkFake(
      fakeCrawl(O, {
        "/": good({ body: `<h1>H</h1><p>${words(200)}</p><a href="/gone">a</a><a href="/boom">b</a><a href="/moved">c</a><a href="/fine">d</a><a href="https://other.example/x">e</a><a href="#top">f</a>` }),
        "/gone": { html: "", status: 404 },
        "/boom": { html: "", status: 500 },
        "/moved": { html: "", redirectTo: "/fine" },
        "/fine": good({ path: "/fine", title: "A fine target page" }),
      }),
    );
    expect(f.filter((x) => x.id === "internal-link-broken").map((x) => x.detail)).toEqual([`${O}/gone (HTTP 404)`, `${O}/boom (HTTP 500)`]);
    expect(f.filter((x) => x.id === "internal-link-redirect").map((x) => x.detail)).toEqual([`${O}/moved redirects to ${O}/fine`]);
  });
  it("reports each target once per page", () => {
    const f = checkFake(fakeCrawl(O, { "/": good({ body: `<h1>H</h1><p>${words(200)}</p><a href="/gone">a</a><a href="/gone">b</a>` }), "/gone": { html: "", status: 404 } }));
    expect(f.filter((x) => x.id === "internal-link-broken")).toHaveLength(1);
  });
});

describe("content", () => {
  it("thin pages are below the word threshold; the boundary is inclusive of the minimum", () => {
    const f = checkFake(
      fakeCrawl(O, {
        "/": good({ body: `<h1>H</h1><p>${words(60)}</p>` }),
        "/edge": good({ path: "/edge", title: "Page at the threshold", body: `<p>${words(120)}</p>` }),
        "/under": good({ path: "/under", title: "Page just under it", body: `<p>${words(119)}</p>` }),
      }),
    );
    expect(furls(f, "thin-content")).toEqual([`${O}/`, `${O}/under`]);
  });
  it("noindex pages are not called thin", () => {
    const f = checkFake(fakeCrawl(O, { "/a": good({ path: "/a", head: '<meta name="robots" content="noindex">', body: "<h1>H</h1><p>hi</p>" }) }));
    expect(fids(f)).not.toContain("thin-content");
  });
  it("identical text is a duplicate even when case, punctuation and spacing differ", () => {
    const a = `<h1>Same</h1><p>${words(80)}</p>`;
    const f = checkFake(
      fakeCrawl(O, {
        "/a": good({ path: "/a", title: "First page of the pair", body: a }),
        "/b": good({ path: "/b", title: "Second page of the pair", body: a.toUpperCase().replace(/<\/P>/, ".</P>  ") }),
        "/c": good({ path: "/c", title: "Third and different one", body: `<h1>Other</h1><p>${words(80, "z")}</p>` }),
      }),
    );
    expect(furls(f, "duplicate-content")).toEqual([`${O}/a`, `${O}/b`]);
  });
  it("is not raised for pages whose canonical points to the other copy, or for very short pages", () => {
    const body = `<h1>Same</h1><p>${words(80)}</p>`;
    const f = checkFake(fakeCrawl(O, { "/a": good({ path: "/a", title: "First page of the pair", body }), "/b": good({ path: "/b", title: "Second page of the pair", body, canonical: `${O}/a` }) }));
    expect(fids(f)).not.toContain("duplicate-content");
    const tiny = checkFake(fakeCrawl(O, { "/a": good({ path: "/a", title: "First tiny page", body: "<p>hello there</p>" }), "/b": good({ path: "/b", title: "Second tiny page", body: "<p>hello there</p>" }) }));
    expect(fids(tiny)).not.toContain("duplicate-content");
  });
  it("textHash ignores case and punctuation", () => {
    expect(textHash("Hello,   World!")).toBe(textHash("hello world"));
    expect(textHash("hello world")).not.toBe(textHash("hello there"));
  });
});

describe("client-rendered and near-empty bodies", () => {
  it("an empty app container is high priority, and not also reported as thin", () => {
    const f = checkFake(fakeCrawl(O, { "/": good({ body: '<div id="root"></div><noscript>Please enable JavaScript</noscript><script src="/app.js"></script>' }) }));
    expect(furls(f, "client-rendered-body")).toEqual([`${O}/`]);
    expect(fids(f)).not.toContain("thin-content");
  });
  it("a near-empty page with scripts but no explicit signal is medium; without scripts it is just thin", () => {
    const f = checkFake(
      fakeCrawl(O, {
        "/": good({ body: '<div id="x"></div><script src="/app.js"></script>' }),
        "/plain": good({ path: "/plain", title: "Plain tiny page here", body: "<p>Just a few words.</p>" }),
      }),
    );
    expect(furls(f, "near-empty-body")).toEqual([`${O}/`]);
    expect(furls(f, "thin-content")).toEqual([`${O}/plain`]);
    expect(fids(f)).not.toContain("client-rendered-body");
  });
  it("24 words is near-empty, 25 is not", () => {
    const f = checkFake(
      fakeCrawl(O, {
        "/": good({ body: `<script src="/a.js"></script><p>${words(24)}</p>` }),
        "/n": good({ path: "/n", title: "Page with twenty five", body: `<script src="/a.js"></script><p>${words(25)}</p>` }),
      }),
    );
    expect(furls(f, "near-empty-body")).toEqual([`${O}/`]);
  });
});

describe("URL hygiene", () => {
  it("uppercase, parameters, underscores and length on crawled pages", () => {
    const long = "/" + "a".repeat(120);
    const f = checkFake(fakeCrawl(O, { "/Mixed_Case?x=1": good({ path: "/Mixed_Case?x=1", title: "Messy URL page here" }), [long]: good({ path: long, title: "Very long URL page" }), "/clean": good({ path: "/clean", title: "Clean URL page here" }) }));
    expect(furls(f, "url-uppercase")).toEqual([`${O}/Mixed_Case?x=1`]);
    expect(furls(f, "url-parameters")).toEqual([`${O}/Mixed_Case?x=1`]);
    expect(furls(f, "url-underscores")).toEqual([`${O}/Mixed_Case?x=1`]);
    expect(furls(f, "url-too-long")).toEqual([`${O}${long}`]);
  });
});

describe("https and mixed content", () => {
  it("active content over http on an https page is high priority and passive content is medium", () => {
    const body = `<h1>H</h1><p>${words(200)}</p><img src="http://cdn.test/a.png" alt="a"><script src="http://cdn.test/a.js"></script><iframe src="http://cdn.test/f"></iframe><img src="https://cdn.test/ok.png" alt="b"><img src="//cdn.test/proto.png" alt="c">`;
    const f = checkFake(fakeCrawl(S, { "/": good({ origin: S, body, head: '<link rel="stylesheet" href="http://cdn.test/a.css">' }) }));
    expect(f.filter((x) => x.id === "mixed-content-active").map((x) => x.detail).sort()).toEqual(["iframe: http://cdn.test/f", "script: http://cdn.test/a.js", "stylesheet: http://cdn.test/a.css"]);
    expect(f.filter((x) => x.id === "mixed-content-passive").map((x) => x.detail)).toEqual(["image: http://cdn.test/a.png"]);
  });
  it("is not raised on an http page", () => {
    const f = checkFake(fakeCrawl("http://site.test", { "/": good({ body: `<h1>H</h1><p>${words(200)}</p><script src="http://cdn.test/a.js"></script>` }) }));
    expect(fids(f)).not.toContain("mixed-content-active");
  });
  it("flags a site served over plain http unless it is a loopback address", () => {
    expect(furls(checkFake(fakeCrawl("http://site.example", { "/": good({ origin: "http://site.example" }) })), "site-not-https")).toEqual(["http://site.example/"]);
    expect(fids(checkFake(fakeCrawl("http://127.0.0.1:8080", { "/": good({ origin: "http://127.0.0.1:8080" }) })))).not.toContain("site-not-https");
    expect(fids(checkFake(fakeCrawl("https://site.test", { "/": good({ origin: "https://site.test" }) })))).not.toContain("site-not-https");
  });
});

describe("redirects and slow pages", () => {
  it("slow responses", () => {
    const f = checkFake(fakeCrawl(O, { "/": { html: good(), timeMs: 2001 }, "/ok": { html: good({ path: "/ok", title: "Quick page here" }), timeMs: 2000 } }));
    expect(furls(f, "slow-response")).toEqual([`${O}/`]);
  });
});

describe("sitemap checks", () => {
  it("orphans: in the sitemap, with no inlinks, never the start page", () => {
    const f = checkFake(
      fakeCrawl(
        O,
        {
          "/": good({ body: `<h1>H</h1><p>${words(200)}</p><a href="/linked">l</a>` }),
          "/linked": good({ path: "/linked", title: "Linked page title" }),
          "/orphan": good({ path: "/orphan", title: "Orphan page title" }),
        },
        { sitemap: ["/", "/linked", "/orphan"] },
      ),
    );
    expect(furls(f, "orphan-page")).toEqual([`${O}/orphan`]);
  });
  it("a page that is linked is not an orphan, and without a sitemap nothing is", () => {
    const f = checkFake(fakeCrawl(O, { "/": good(), "/orphan": good({ path: "/orphan", title: "Orphan page title" }) }, { sitemap: [] }));
    expect(fids(f)).not.toContain("orphan-page");
    expect(fids(f)).not.toContain("page-not-in-sitemap");
  });
  it("indexable pages missing from the sitemap", () => {
    const f = checkFake(fakeCrawl(O, { "/": good(), "/other": good({ path: "/other", title: "Another indexable page" }) }, { sitemap: ["/"] }));
    expect(furls(f, "page-not-in-sitemap")).toEqual([`${O}/other`]);
  });
  it("redirecting, failing, noindex and non-canonical sitemap entries", () => {
    const f = checkFake(
      fakeCrawl(
        O,
        {
          "/": good(),
          "/r": { html: "", redirectTo: "/" },
          "/e": { html: "", status: 410 },
          "/n": good({ path: "/n", title: "A noindex page here", head: '<meta name="robots" content="noindex">' }),
          "/c": good({ path: "/c", title: "A page canonical elsewhere", canonical: `${O}/` }),
        },
        { sitemap: ["/", "/r", "/e", "/n", "/c"] },
      ),
    );
    expect(furls(f, "sitemap-url-redirect")).toEqual([`${O}/r`]);
    expect(furls(f, "sitemap-url-error")).toEqual([`${O}/e`]);
    expect(furls(f, "sitemap-url-noindex")).toEqual([`${O}/n`]);
    expect(furls(f, "sitemap-url-noncanonical")).toEqual([`${O}/c`]);
  });
  it("missing robots.txt", () => {
    expect(furls(checkFake(fakeCrawl(O, { "/": good() }, { robotsTxt: null })), "robots-missing")).toEqual([`${O}/robots.txt`]);
    expect(fids(checkFake(fakeCrawl(O, { "/": good() }, { robotsTxt: "User-agent: *\nDisallow:\n" })))).not.toContain("robots-missing");
  });
});

describe("crawler and AI-bot findings", () => {
  const crawl = (txt: string) => checkFake(fakeCrawl(O, { "/": good() }, { robotsTxt: txt }));
  it("a search bot blocked from the home page is high priority", () => {
    const f = crawl("User-agent: Googlebot\nDisallow: /\n");
    expect(furls(f, "bot-search-blocked-home")).toEqual([`${O}/robots.txt`]);
    expect(f.find((x) => x.id === "bot-search-blocked-home")?.detail).toContain("Googlebot");
  });
  it("AI bots and control tokens are reported together as low priority", () => {
    const f = crawl("User-agent: GPTBot\nUser-agent: Applebot-Extended\nDisallow: /\n");
    expect(f.filter((x) => x.id === "bot-ai-blocked").map((x) => x.detail?.split(":")[0])).toEqual(["GPTBot", "Applebot-Extended"]);
  });
  it("is quiet when everything is allowed", () => {
    expect(fids(checkFake(fakeCrawl(S, { "/": good({ origin: S }) }, { robotsTxt: "User-agent: *\nDisallow: /admin/\nSitemap: https://site.test/sitemap.xml\n", sitemap: ["/"] })))).toEqual([]);
  });
});
