import { describe, expect, it } from "vitest";
import { evaluate, isAllowed, parseRobots, rulesFor } from "../src/robots.js";

describe("parseRobots", () => {
  it("reads groups, Sitemap lines, Crawl-delay and ignores comments and a BOM", () => {
    const r = parseRobots("﻿# comment\nUser-agent: *\nDisallow: /a # trailing\nCrawl-delay: 2.5\n\nSitemap: https://x.test/s.xml\nUser-agent: Foo\nAllow: /b\n");
    expect(r.sitemaps).toEqual(["https://x.test/s.xml"]);
    expect(r.groups).toHaveLength(2);
    expect(r.groups[0]?.crawlDelay).toBe(2.5);
    expect(r.groups[0]?.rules).toEqual([{ type: "disallow", pattern: "/a" }]);
  });

  it("treats consecutive User-agent lines as one group", () => {
    const r = parseRobots("User-agent: A\nUser-agent: B\nDisallow: /x\n");
    expect(r.groups).toHaveLength(1);
    expect(r.groups[0]?.agents).toEqual(["a", "b"]);
  });

  it("an empty Disallow allows everything", () => {
    expect(isAllowed(parseRobots("User-agent: *\nDisallow:\n"), "x", "/anything").allowed).toBe(true);
  });

  it("ignores rules that appear before any User-agent line", () => {
    expect(isAllowed(parseRobots("Disallow: /\n"), "x", "/").allowed).toBe(true);
  });

  it("ignores negative or non-numeric Crawl-delay", () => {
    expect(parseRobots("User-agent: *\nCrawl-delay: -4\n").groups[0]?.crawlDelay).toBeUndefined();
    expect(parseRobots("User-agent: *\nCrawl-delay: soon\n").groups[0]?.crawlDelay).toBeUndefined();
  });
});

describe("rulesFor", () => {
  const txt = "User-agent: *\nDisallow: /private/\n\nUser-agent: GPTBot\nDisallow: /\n\nUser-agent: gptbot\nCrawl-delay: 4\n";
  const robots = parseRobots(txt);

  it("uses the bot's own group (case-insensitive) instead of *, merging repeated groups", () => {
    const eff = rulesFor(robots, "GPTBot");
    expect(eff.matched).toBe("specific");
    expect(eff.rules).toEqual([{ type: "disallow", pattern: "/" }]);
    expect(eff.crawlDelay).toBe(4);
  });
  it("falls back to the * group", () => {
    const eff = rulesFor(robots, "Googlebot");
    expect(eff.matched).toBe("wildcard");
    expect(evaluate(eff.rules, "/private/x").allowed).toBe(false);
    expect(evaluate(eff.rules, "/public").allowed).toBe(true);
  });
  it("reports no group when nothing applies", () => {
    expect(rulesFor(parseRobots("User-agent: Other\nDisallow: /\n"), "Googlebot").matched).toBe("none");
  });
});

describe("evaluate", () => {
  const rules = (txt: string) => rulesFor(parseRobots(txt), "bot").rules;

  it("longest matching rule wins", () => {
    const r = rules("User-agent: *\nDisallow: /a/\nAllow: /a/public/\n");
    expect(evaluate(r, "/a/secret")).toEqual({ allowed: false, rule: "Disallow: /a/" });
    expect(evaluate(r, "/a/public/page")).toEqual({ allowed: true, rule: "Allow: /a/public/" });
  });
  it("Allow wins a tie", () => {
    expect(evaluate(rules("User-agent: *\nDisallow: /x\nAllow: /x\n"), "/x").allowed).toBe(true);
  });
  it("supports * wildcards and the $ end anchor", () => {
    const r = rules("User-agent: *\nDisallow: /*.pdf$\nDisallow: /tmp*/cache\n");
    expect(evaluate(r, "/docs/a.pdf").allowed).toBe(false);
    expect(evaluate(r, "/docs/a.pdf?x=1").allowed).toBe(true);
    expect(evaluate(r, "/tmp123/cache").allowed).toBe(false);
  });
  it("matches against the query string too", () => {
    expect(evaluate(rules("User-agent: *\nDisallow: /*?sessionid=\n"), "/p?sessionid=9").allowed).toBe(false);
  });
  it("never blocks /robots.txt itself", () => {
    expect(evaluate(rules("User-agent: *\nDisallow: /\n"), "/robots.txt").allowed).toBe(true);
  });
  it("is case-sensitive on the path", () => {
    expect(evaluate(rules("User-agent: *\nDisallow: /Private\n"), "/private").allowed).toBe(true);
  });
});

describe("isAllowed", () => {
  it("allows everything when there is no robots.txt", () => {
    expect(isAllowed(null, "x", "/anything")).toEqual({ allowed: true });
  });
});
