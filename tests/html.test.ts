import { describe, expect, it } from "vitest";
import { countWords, parseHtml } from "../src/html.js";

const doc = (head: string, body: string, lang = ' lang="en-GB"') => `<!doctype html><html${lang}><head>${head}</head><body>${body}</body></html>`;

describe("parseHtml head data", () => {
  const p = parseHtml(
    doc(
      `<title> Hello   world </title><meta name="description" content="A description">
<meta name="robots" content="NoIndex, Follow"><meta name="viewport" content="width=device-width">
<link rel="canonical" href="/x"><link rel="alternate" hreflang="de" href="/de"><link rel="stylesheet" href="/s.css">
<meta property="og:title" content="OG"><meta name="twitter:card" content="summary">`,
      "<p>x</p>",
    ),
  );
  it("reads title, description, robots, viewport, lang", () => {
    expect(p.title).toBe("Hello world");
    expect(p.titleCount).toBe(1);
    expect(p.metaDescriptions).toEqual(["A description"]);
    expect(p.robotsDirectives).toEqual(["noindex", "follow"]);
    expect(p.viewport).toBe("width=device-width");
    expect(p.lang).toBe("en-GB");
  });
  it("reads canonical, hreflang, Open Graph and Twitter tags", () => {
    expect(p.canonicals).toEqual(["/x"]);
    expect(p.hreflang).toEqual([{ lang: "de", href: "/de" }]);
    expect(p.openGraph).toEqual({ "og:title": "OG" });
    expect(p.twitter).toEqual({ "twitter:card": "summary" });
    expect(p.resources).toContainEqual({ kind: "stylesheet", url: "/s.css" });
  });
  it("returns null/empty for a bare document", () => {
    const b = parseHtml("<p>hi</p>");
    expect(b.title).toBeNull();
    expect(b.lang).toBeNull();
    expect(b.viewport).toBeNull();
    expect(b.canonicals).toEqual([]);
  });
  it("counts repeated titles", () => {
    expect(parseHtml(doc("<title>A</title><title>B</title>", "")).titleCount).toBe(2);
  });
});

describe("parseHtml body data", () => {
  it("collects headings in order with levels", () => {
    const p = parseHtml(doc("", "<h1>One</h1><h2>Two <em>x</em></h2><h4>Four</h4>"));
    expect(p.headings).toEqual([{ level: 1, text: "One" }, { level: 2, text: "Two x" }, { level: 4, text: "Four" }]);
  });
  it("distinguishes a missing alt from an empty alt", () => {
    const p = parseHtml(doc("", '<img src="a.png"><img src="b.png" alt=""><img src="c.png" alt="C">'));
    expect(p.images.map((i) => i.alt)).toEqual([null, "", "C"]);
  });
  it("collects links with rel and text, and sub-resources by kind", () => {
    const p = parseHtml(doc("", '<a href="/a" rel="nofollow ugc">A link</a><a>no href</a><script src="/s.js"></script><iframe src="/f"></iframe><video src="/v.mp4"></video>'));
    expect(p.links).toEqual([{ href: "/a", text: "A link", rel: ["nofollow", "ugc"] }]);
    expect(p.resources.map((r) => r.kind).sort()).toEqual(["iframe", "media", "script"]);
  });
  it("extracts JSON-LD with the line where the content starts", () => {
    const p = parseHtml(`<!doctype html>\n<html>\n<head>\n<script type="application/ld+json">\n{"a": 1}\n</script>\n</head><body></body></html>`);
    expect(p.jsonLd).toHaveLength(1);
    expect(p.jsonLd[0]?.raw.trim()).toBe('{"a": 1}');
    expect(p.jsonLd[0]?.line).toBe(4);
    expect(p.signals.scriptCount).toBe(0);
  });
});

describe("parseHtml main text and signals", () => {
  it("uses <main> when present and leaves out nav, header and footer", () => {
    const p = parseHtml(doc("", "<header>Site name</header><nav>Menu items here</nav><main><h1>Title</h1><p>Real content words</p></main><footer>Legal text</footer>"));
    expect(p.mainText).toBe("Title Real content words");
    expect(p.wordCount).toBe(4);
  });
  it("without <main> uses the body minus nav/header/footer/aside and scripts", () => {
    const p = parseHtml(doc("", "<nav>menu</nav><div>Alpha beta</div><aside>side</aside><script>var x = 'ignored words';</script><noscript>no script text</noscript><div>gamma</div>"));
    expect(p.mainText).toBe("Alpha beta gamma");
  });
  it("keeps block elements from gluing words together", () => {
    expect(parseHtml(doc("", "<p>one</p><p>two</p><ul><li>three</li><li>four</li></ul>")).wordCount).toBe(4);
  });
  it("detects an empty app container and a noscript that asks for JavaScript", () => {
    const p = parseHtml(doc("", '<div id="root"></div><noscript>You need to enable JavaScript.</noscript><script src="/a.js"></script>'));
    expect(p.signals).toEqual({ scriptCount: 1, emptyAppRoot: true, noscriptNeedsJs: true });
    expect(parseHtml(doc("", '<div id="root"><p>server rendered</p></div>')).signals.emptyAppRoot).toBe(false);
  });
  it("ignores content inside <template>", () => {
    expect(parseHtml(doc("", "<p>visible</p><template><h1>hidden</h1></template>")).headings).toEqual([]);
  });
});

describe("countWords", () => {
  it("counts letters and digits, keeps contractions and hyphenated words whole", () => {
    expect(countWords("It's a well-known fact, 2026!")).toBe(5);
    expect(countWords("   ")).toBe(0);
    expect(countWords("Café naive")).toBeGreaterThanOrEqual(2);
  });
});
