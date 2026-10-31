/** URL helpers shared by the crawler and the checks. */

/** Resolve `raw` against `base`; returns null for non-http(s) or unparseable values. Fragment is dropped. */
export function normalizeUrl(raw: string, base?: string): string | null {
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  let u: URL;
  try {
    u = base !== undefined ? new URL(trimmed, base) : new URL(trimmed);
  } catch {
    return null;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;
  u.hash = "";
  if (u.search === "") u.search = ""; // drop a dangling "?"
  return u.href;
}

export function sameOrigin(a: string, b: string): boolean {
  try {
    return new URL(a).origin === new URL(b).origin;
  } catch {
    return false;
  }
}

export function pathAndQuery(url: string): string {
  const u = new URL(url);
  return u.pathname + u.search;
}

const NON_HTML_EXTENSIONS = new Set([
  "jpg", "jpeg", "png", "gif", "webp", "avif", "svg", "ico", "bmp",
  "pdf", "zip", "gz", "tgz", "rar", "7z", "mp3", "mp4", "mov", "avi", "webm", "wav", "ogg",
  "css", "js", "mjs", "json", "xml", "txt", "csv", "woff", "woff2", "ttf", "otf", "eot", "docx", "xlsx", "pptx",
]);

/** True when the path ends in an extension that is clearly not an HTML page. */
export function hasNonHtmlExtension(url: string): boolean {
  const path = new URL(url).pathname;
  const last = path.slice(path.lastIndexOf("/") + 1);
  const dot = last.lastIndexOf(".");
  if (dot < 0) return false;
  return NON_HTML_EXTENSIONS.has(last.slice(dot + 1).toLowerCase());
}

export interface UrlHygieneProblem {
  id: "url-uppercase" | "url-parameters" | "url-underscores" | "url-too-long";
  detail: string;
}

export const MAX_RECOMMENDED_URL_LENGTH = 115;

/** Cosmetic and duplicate-risk problems visible in the URL itself. */
export function urlHygiene(url: string): UrlHygieneProblem[] {
  const u = new URL(url);
  const out: UrlHygieneProblem[] = [];
  if (/[A-Z]/.test(u.pathname)) out.push({ id: "url-uppercase", detail: `path ${u.pathname} contains uppercase letters` });
  if (u.search !== "") out.push({ id: "url-parameters", detail: `query string ${u.search}` });
  if (u.pathname.includes("_")) out.push({ id: "url-underscores", detail: `path ${u.pathname} contains underscores` });
  const length = u.pathname.length + u.search.length;
  if (length > MAX_RECOMMENDED_URL_LENGTH) {
    out.push({ id: "url-too-long", detail: `${length} characters (over ${MAX_RECOMMENDED_URL_LENGTH})` });
  }
  return out;
}

export function isLoopbackHost(url: string): boolean {
  const h = new URL(url).hostname;
  return h === "localhost" || h === "127.0.0.1" || h === "[::1]" || h.endsWith(".localhost");
}
