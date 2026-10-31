import type { Fetcher } from "./http.js";
import { normalizeUrl, sameOrigin } from "./urls.js";

export interface SitemapFile {
  url: string;
  kind: "urlset" | "index" | "invalid";
  status: number;
  urls: string[];
  children: string[];
  error?: string;
}

function decode(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .trim();
}

function locs(xml: string, container: "url" | "sitemap"): string[] {
  const out: string[] = [];
  const re = new RegExp(`<${container}(?:\\s[^>]*)?>([\\s\\S]*?)</${container}>`, "gi");
  for (const m of xml.matchAll(re)) {
    const loc = /<loc(?:\s[^>]*)?>([\s\S]*?)<\/loc>/i.exec(m[1] ?? "");
    if (loc?.[1] !== undefined) out.push(decode(loc[1]));
  }
  return out;
}

export function parseSitemapXml(url: string, status: number, xml: string): SitemapFile {
  if (/<sitemapindex[\s>]/i.test(xml)) {
    return { url, kind: "index", status, urls: [], children: locs(xml, "sitemap") };
  }
  if (/<urlset[\s>]/i.test(xml)) {
    return { url, kind: "urlset", status, urls: locs(xml, "url"), children: [] };
  }
  return { url, kind: "invalid", status, urls: [], children: [], error: "response is not a <urlset> or <sitemapindex> XML document" };
}

export interface SitemapLoad {
  files: SitemapFile[];
  /** Every distinct sitemap URL (normalised), in file order. */
  urls: string[];
  /** URLs in sitemaps that are not on the audited origin. */
  offOrigin: string[];
  /** URL entries that could not be parsed as http(s) URLs. */
  invalid: string[];
  /** The sitemap URL each listed URL came from. */
  source: Map<string, string>;
  truncated: boolean;
  notes: string[];
}

export interface SitemapLoadOptions {
  maxSitemaps?: number;
  maxUrls?: number;
}

/** Fetches sitemap files (and the children of sitemap indexes) from the audited origin only. */
export async function loadSitemaps(fetcher: Fetcher, seeds: string[], origin: string, opts: SitemapLoadOptions = {}): Promise<SitemapLoad> {
  const maxSitemaps = opts.maxSitemaps ?? 10;
  const maxUrls = opts.maxUrls ?? 5000;
  const out: SitemapLoad = { files: [], urls: [], offOrigin: [], invalid: [], source: new Map(), truncated: false, notes: [] };
  const queue = [...seeds];
  const seen = new Set<string>();
  const urlSeen = new Set<string>();

  while (queue.length > 0) {
    const url = queue.shift() as string;
    if (seen.has(url)) continue;
    seen.add(url);
    if (!sameOrigin(url, origin)) {
      out.notes.push(`Sitemap ${url} is on another origin and was not fetched.`);
      continue;
    }
    if (/\.gz($|\?)/i.test(url)) {
      out.notes.push(`Sitemap ${url} is gzip-compressed; this kit does not read .gz sitemaps.`);
      continue;
    }
    if (out.files.length >= maxSitemaps) {
      out.truncated = true;
      out.notes.push(`Stopped after ${maxSitemaps} sitemap files; ${url} and any others were not read.`);
      break;
    }
    const res = await fetcher.fetchHop(url);
    if (res.error || res.status !== 200 || res.body === null) {
      out.files.push({ url, kind: "invalid", status: res.status, urls: [], children: [], error: res.error ?? `HTTP ${res.status}` });
      continue;
    }
    const file = parseSitemapXml(url, res.status, res.body);
    out.files.push(file);
    for (const child of file.children) {
      const n = normalizeUrl(child);
      if (n) queue.push(n);
    }
    for (const raw of file.urls) {
      const n = normalizeUrl(raw);
      if (!n) {
        out.invalid.push(raw);
        continue;
      }
      if (urlSeen.has(n)) continue;
      if (urlSeen.size >= maxUrls) {
        out.truncated = true;
        continue;
      }
      urlSeen.add(n);
      out.urls.push(n);
      out.source.set(n, url);
      if (!sameOrigin(n, origin)) out.offOrigin.push(n);
    }
  }
  if (out.truncated && !out.notes.some((n) => n.includes("URLs"))) out.notes.push(`Only the first ${maxUrls} sitemap URLs were kept.`);
  return out;
}
