import { describe, expect, it } from "vitest";
import { NAMED_BOTS, botAccessReport, chooseKeyPaths } from "../src/bots.js";
import { parseRobots } from "../src/robots.js";

const row = (rows: ReturnType<typeof botAccessReport>, bot: string) => rows.find((r) => r.bot === bot)!;

describe("botAccessReport", () => {
  it("covers exactly the eight named bots", () => {
    expect(NAMED_BOTS.map((b) => b.name)).toEqual(["Googlebot", "Bingbot", "GPTBot", "ClaudeBot", "PerplexityBot", "CCBot", "Google-Extended", "Applebot-Extended"]);
  });

  it("allows everything when there is no robots.txt", () => {
    const rows = botAccessReport(null, ["/", "/a"]);
    expect(rows.every((r) => r.results.every((x) => x.allowed))).toBe(true);
    expect(rows.every((r) => r.matchedGroup === "none")).toBe(true);
  });

  it("blocks only the bots named in their own groups; the rest follow *", () => {
    const robots = parseRobots("User-agent: *\nDisallow: /private/\n\nUser-agent: GPTBot\nUser-agent: CCBot\nDisallow: /\n\nUser-agent: Google-Extended\nDisallow: /\n");
    const rows = botAccessReport(robots, ["/", "/blog/", "/private/x"]);
    expect(row(rows, "GPTBot").results.map((r) => r.allowed)).toEqual([false, false, false]);
    expect(row(rows, "CCBot").results.map((r) => r.allowed)).toEqual([false, false, false]);
    expect(row(rows, "Google-Extended").results[0]).toEqual({ path: "/", allowed: false, rule: "Disallow: /" });
    expect(row(rows, "Googlebot").results.map((r) => r.allowed)).toEqual([true, true, false]);
    expect(row(rows, "Googlebot").matchedGroup).toBe("wildcard");
    expect(row(rows, "GPTBot").matchedGroup).toBe("specific");
    expect(row(rows, "ClaudeBot").results.map((r) => r.allowed)).toEqual([true, true, false]);
    expect(row(rows, "Applebot-Extended").results[2]?.rule).toBe("Disallow: /private/");
  });

  it("lets a bot's own Allow rule override a wildcard block", () => {
    const robots = parseRobots("User-agent: *\nDisallow: /\n\nUser-agent: Googlebot\nAllow: /\n");
    const rows = botAccessReport(robots, ["/", "/x"]);
    expect(row(rows, "Googlebot").results.every((r) => r.allowed)).toBe(true);
    expect(row(rows, "Bingbot").results.every((r) => !r.allowed)).toBe(true);
  });
});

describe("chooseKeyPaths", () => {
  it("puts / first, then extras, sitemap files, then best-linked pages, without duplicates", () => {
    const paths = chooseKeyPaths({
      sitemapPaths: ["/sitemap.xml"],
      extra: ["shop", "/"],
      linkedPages: [{ path: "/a", inlinks: 1 }, { path: "/b", inlinks: 9 }, { path: "/c", inlinks: 9 }],
    });
    expect(paths).toEqual(["/", "/shop", "/sitemap.xml", "/b", "/c", "/a"]);
  });
  it("is capped", () => {
    const linkedPages = Array.from({ length: 40 }, (_, i) => ({ path: `/p${i}`, inlinks: 1 }));
    expect(chooseKeyPaths({ sitemapPaths: [], extra: [], linkedPages }).length).toBeLessThanOrEqual(16);
  });
});
