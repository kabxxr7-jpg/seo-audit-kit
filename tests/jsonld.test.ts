import { describe, expect, it } from "vitest";
import { analyzeJsonLd, findClashes, parseJsonLdBlocks, type Entity } from "../src/jsonld.js";

const block = (data: unknown, line = 1) => ({ raw: JSON.stringify(data), line });
const analyze = (...data: unknown[]) => analyzeJsonLd(data.map((d) => block(d)));
const ctx = { "@context": "https://schema.org" };
const required = (a: ReturnType<typeof analyze>, type: string): string[] => a.problems.find((p) => p.type === type)?.missingRequired ?? ["<type not checked>"];
const recommended = (a: ReturnType<typeof analyze>, type: string): string[] => a.problems.find((p) => p.type === type)?.missingRecommended ?? ["<type not checked>"];

describe("parse errors", () => {
  it("reports the line and column of a syntax error inside the block", () => {
    const raw = `{\n  "@context": "https://schema.org",\n  "@type": "Person",\n  "name": "A",\n}`;
    const [b] = parseJsonLdBlocks([{ raw, line: 10 }]);
    expect(b?.ok).toBe(false);
    expect(b?.error?.line).toBe(14); // the closing brace is on the 5th line of the block, which starts at line 10
    expect(b?.error?.column).toBe(1);
    expect(b?.error?.message).toMatch(/JSON/i);
  });
  it("reports an empty block", () => {
    const [b] = parseJsonLdBlocks([{ raw: "  \n ", line: 3 }]);
    expect(b?.ok).toBe(false);
    expect(b?.error?.message).toMatch(/empty/);
    expect(b?.error?.line).toBe(3);
  });
  it("keeps good blocks when one block is bad", () => {
    const a = analyzeJsonLd([{ raw: "{oops", line: 1 }, block({ ...ctx, "@type": "Person", name: "Ok" })]);
    expect(a.parseErrors).toHaveLength(1);
    expect(a.parseErrors[0]?.block).toBe(0);
    expect(a.types).toEqual(["Person"]);
  });
});

describe("structure", () => {
  it("flags a missing schema.org @context and a missing @type", () => {
    const a = analyze({ "@type": "Person", name: "A" }, { "@context": "https://schema.org", name: "no type" });
    expect(a.missingContext).toEqual([0]);
    expect(a.missingType).toEqual([1]);
  });
  it("reads @graph members and array @type values", () => {
    const a = analyze({ ...ctx, "@graph": [{ "@type": ["Organization", "LocalBusiness"], name: "O" }, { "@type": "WebSite", name: "W" }] });
    expect(a.types).toEqual(["Organization", "LocalBusiness", "WebSite"]);
    expect(a.missingContext).toEqual([]);
  });
  it("accepts a top-level array of objects", () => {
    expect(analyze([{ ...ctx, "@type": "Person", name: "A" }, { ...ctx, "@type": "Person", name: "B" }]).entities).toHaveLength(2);
  });
});

describe("required properties per type", () => {
  it("Person needs a name", () => {
    expect(required(analyze({ ...ctx, "@type": "Person" }), "Person")).toEqual(["name"]);
    expect(required(analyze({ ...ctx, "@type": "Person", name: "A" }), "Person")).toEqual([]);
    expect(recommended(analyze({ ...ctx, "@type": "Person", name: "A" }), "Person")).toEqual(["url", "sameAs", "image", "jobTitle"]);
  });
  it("Organization needs a name", () => {
    expect(required(analyze({ ...ctx, "@type": "Organization", url: "https://x.test" }), "Organization")).toEqual(["name"]);
    expect(required(analyze({ ...ctx, "@type": "Organization", name: "X" }), "Organization")).toEqual([]);
  });
  it("Article (and subtypes) need headline, author and datePublished; an author needs a name", () => {
    for (const t of ["Article", "NewsArticle", "BlogPosting"]) {
      expect(required(analyze({ ...ctx, "@type": t }), t)).toEqual(["headline", "author", "datePublished"]);
    }
    const a = analyze({ ...ctx, "@type": "Article", headline: "H", datePublished: "2026-01-01", author: { "@type": "Person" } });
    expect(required(a, "Article")).toEqual(["author has no name"]);
    const ok = analyze({ ...ctx, "@type": "Article", headline: "H", datePublished: "2026-01-01", author: [{ "@type": "Person", name: "N" }] });
    expect(required(ok, "Article")).toEqual([]);
  });
  it("Product needs a name and one of offers, review or aggregateRating; offers need price and currency", () => {
    expect(required(analyze({ ...ctx, "@type": "Product" }), "Product")).toEqual(["name", "offers|review|aggregateRating"]);
    expect(required(analyze({ ...ctx, "@type": "Product", name: "P", review: { "@type": "Review" } }), "Product")).toEqual([]);
    const noPrice = analyze({ ...ctx, "@type": "Product", name: "P", offers: { "@type": "Offer", priceCurrency: "USD" } });
    expect(required(noPrice, "Product")).toEqual(["offers.price"]);
    const noCurrency = analyze({ ...ctx, "@type": "Product", name: "P", offers: { "@type": "Offer", price: "5" } });
    expect(required(noCurrency, "Product")).toEqual(["offers.priceCurrency"]);
    const good = analyze({ ...ctx, "@type": "Product", name: "P", offers: [{ "@type": "Offer", price: 5, priceCurrency: "USD" }] });
    expect(required(good, "Product")).toEqual([]);
  });
  it("BreadcrumbList needs at least two items, each with position, name and (except the last) an item URL", () => {
    expect(required(analyze({ ...ctx, "@type": "BreadcrumbList" }), "BreadcrumbList")).toEqual(["itemListElement"]);
    const one = analyze({ ...ctx, "@type": "BreadcrumbList", itemListElement: [{ "@type": "ListItem", position: 1, name: "Home", item: "https://x.test/" }] });
    expect(required(one, "BreadcrumbList")).toEqual(["itemListElement has fewer than 2 items"]);
    const bad = analyze({ ...ctx, "@type": "BreadcrumbList", itemListElement: [{ "@type": "ListItem", name: "Home" }, { "@type": "ListItem", position: 2, item: "https://x.test/a" }] });
    expect(required(bad, "BreadcrumbList")).toEqual(["item 1 has no position", "item 1 has no item URL", "item 2 has no name"]);
    const good = analyze({ ...ctx, "@type": "BreadcrumbList", itemListElement: [{ "@type": "ListItem", position: 1, name: "Home", item: "https://x.test/" }, { "@type": "ListItem", position: 2, name: "Here" }] });
    expect(required(good, "BreadcrumbList")).toEqual([]);
  });
  it("FAQPage needs questions with a name and an accepted answer text", () => {
    expect(required(analyze({ ...ctx, "@type": "FAQPage" }), "FAQPage")).toEqual(["mainEntity"]);
    const bad = analyze({ ...ctx, "@type": "FAQPage", mainEntity: [{ "@type": "Question", name: "Q?" }, { "@type": "Question", acceptedAnswer: { "@type": "Answer", text: "A" } }] });
    expect(required(bad, "FAQPage")).toEqual(["question 1 has no acceptedAnswer.text", "question 2 has no name"]);
    const good = analyze({ ...ctx, "@type": "FAQPage", mainEntity: { "@type": "Question", name: "Q?", acceptedAnswer: { "@type": "Answer", text: "A" } } });
    expect(required(good, "FAQPage")).toEqual([]);
  });
  it("PodcastEpisode needs a name; media and series are recommended", () => {
    expect(required(analyze({ ...ctx, "@type": "PodcastEpisode" }), "PodcastEpisode")).toEqual(["name"]);
    const a = analyze({ ...ctx, "@type": "PodcastEpisode", name: "E1", associatedMedia: { "@type": "MediaObject" } });
    expect(recommended(a, "PodcastEpisode")).toEqual(["url", "datePublished", "description", "duration", "partOfSeries"]);
  });
  it("Book needs a name and an author", () => {
    expect(required(analyze({ ...ctx, "@type": "Book" }), "Book")).toEqual(["name", "author"]);
    expect(required(analyze({ ...ctx, "@type": "Book", name: "B", author: "Someone" }), "Book")).toEqual([]);
  });
  it("treats blank strings and empty arrays as missing; unknown types are not checked", () => {
    expect(required(analyze({ ...ctx, "@type": "Person", name: "  " }), "Person")).toEqual(["name"]);
    expect(analyze({ ...ctx, "@type": "Thing", name: "x" }).problems).toEqual([]);
  });
});

describe("duplicate and conflicting entities", () => {
  const e = (node: Record<string, unknown>): Entity => ({ blockIndex: 0, types: [String(node["@type"])], id: typeof node["@id"] === "string" ? (node["@id"] as string) : null, node });
  it("identical copies are duplicates", () => {
    const c = findClashes([e({ "@type": "Organization", name: "X", url: "u" }), e({ "@type": "Organization", name: "X", url: "u" })]);
    expect(c).toHaveLength(1);
    expect(c[0]?.kind).toBe("duplicate");
  });
  it("same @id with different values conflicts, and names the property", () => {
    const c = findClashes([e({ "@type": "Organization", "@id": "#o", name: "X" }), e({ "@type": "Organization", "@id": "#o", name: "Y" })]);
    expect(c[0]?.kind).toBe("conflict");
    expect(c[0]?.detail).toContain("name");
  });
  it("same type and name with a different url conflicts", () => {
    const c = findClashes([e({ "@type": "Person", name: "A", url: "1" }), e({ "@type": "Person", name: "A", url: "2" })]);
    expect(c[0]?.kind).toBe("conflict");
  });
  it("different entities are fine", () => {
    expect(findClashes([e({ "@type": "Person", name: "A" }), e({ "@type": "Person", name: "B" })])).toEqual([]);
  });
  it("analysis surfaces clashes across blocks of one page", () => {
    const a = analyze({ ...ctx, "@type": "Organization", "@id": "#o", name: "X" }, { ...ctx, "@type": "Organization", "@id": "#o", name: "Y" });
    expect(a.clashes.map((c) => c.kind)).toEqual(["conflict"]);
  });
});
