import { describe, expect, it } from "vitest";
import { hasNonHtmlExtension, isLoopbackHost, normalizeUrl, pathAndQuery, sameOrigin, urlHygiene } from "../src/urls.js";

describe("normalizeUrl", () => {
  it("resolves relative URLs and drops the fragment", () => {
    expect(normalizeUrl("../b?x=1#top", "http://a.test/dir/page")).toBe("http://a.test/b?x=1");
  });
  it("rejects non-http schemes and junk", () => {
    expect(normalizeUrl("mailto:a@b.test")).toBeNull();
    expect(normalizeUrl("javascript:void(0)")).toBeNull();
    expect(normalizeUrl("")).toBeNull();
    expect(normalizeUrl("http://")).toBeNull();
  });
  it("lowercases the host and drops default ports", () => {
    expect(normalizeUrl("HTTP://Example.TEST:80/Path")).toBe("http://example.test/Path");
  });
});

describe("sameOrigin / pathAndQuery", () => {
  it("compares scheme, host and port", () => {
    expect(sameOrigin("http://a.test/x", "http://a.test/y")).toBe(true);
    expect(sameOrigin("http://a.test/x", "https://a.test/x")).toBe(false);
    expect(sameOrigin("http://a.test:8080/x", "http://a.test/x")).toBe(false);
    expect(sameOrigin("http://a.test/x", "http://www.a.test/x")).toBe(false);
    expect(sameOrigin("nonsense", "http://a.test")).toBe(false);
  });
  it("returns path plus query", () => {
    expect(pathAndQuery("http://a.test/p/q?x=1&y=2")).toBe("/p/q?x=1&y=2");
  });
});

describe("hasNonHtmlExtension", () => {
  it("flags files and not pages", () => {
    expect(hasNonHtmlExtension("http://a.test/file.PDF")).toBe(true);
    expect(hasNonHtmlExtension("http://a.test/img/x.webp?v=2")).toBe(true);
    expect(hasNonHtmlExtension("http://a.test/page.html")).toBe(false);
    expect(hasNonHtmlExtension("http://a.test/about")).toBe(false);
    expect(hasNonHtmlExtension("http://a.test/v1.2/docs")).toBe(false);
  });
});

describe("urlHygiene", () => {
  it("reports uppercase, parameters, underscores and length", () => {
    const ids = urlHygiene("http://a.test/Mixed_Case?utm_source=x").map((p) => p.id);
    expect(ids).toEqual(["url-uppercase", "url-parameters", "url-underscores"]);
    expect(urlHygiene("http://a.test/" + "a".repeat(120)).map((p) => p.id)).toEqual(["url-too-long"]);
  });
  it("is quiet for a clean URL", () => {
    expect(urlHygiene("http://a.test/clean-url/page")).toEqual([]);
  });
});

describe("isLoopbackHost", () => {
  it("recognises local hosts only", () => {
    expect(isLoopbackHost("http://127.0.0.1:3000/")).toBe(true);
    expect(isLoopbackHost("http://localhost/")).toBe(true);
    expect(isLoopbackHost("http://shop.example/")).toBe(false);
  });
});
