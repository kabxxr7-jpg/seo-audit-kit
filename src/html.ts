import { parse, type DefaultTreeAdapterMap } from "parse5";

type Node = DefaultTreeAdapterMap["node"];
type Element = DefaultTreeAdapterMap["element"];

export interface Heading {
  level: number;
  text: string;
}
export interface ImageRef {
  src: string | null;
  /** null when the alt attribute is absent; "" when present and empty (decorative). */
  alt: string | null;
}
export interface LinkRef {
  href: string;
  text: string;
  rel: string[];
}
export interface HreflangRef {
  lang: string;
  href: string;
}
export type ResourceKind = "script" | "stylesheet" | "iframe" | "image" | "media";
export interface ResourceRef {
  kind: ResourceKind;
  url: string;
}
export interface JsonLdScript {
  raw: string;
  /** 1-based line in the HTML document where the script content starts. */
  line: number;
}

export interface ParsedPage {
  lang: string | null;
  title: string | null;
  titleCount: number;
  metaDescriptions: string[];
  /** Lower-cased, comma-split directives from meta name=robots / googlebot / bingbot. */
  robotsDirectives: string[];
  canonicals: string[];
  viewport: string | null;
  headings: Heading[];
  images: ImageRef[];
  links: LinkRef[];
  hreflang: HreflangRef[];
  openGraph: Record<string, string>;
  twitter: Record<string, string>;
  jsonLd: JsonLdScript[];
  resources: ResourceRef[];
  /** Text of the main content: <main> if present, otherwise body without nav/header/footer/aside. */
  mainText: string;
  wordCount: number;
  signals: {
    scriptCount: number;
    emptyAppRoot: boolean;
    noscriptNeedsJs: boolean;
  };
}

const SKIP_TEXT = new Set(["script", "style", "noscript", "template", "head"]);
const CHROME = new Set(["nav", "header", "footer", "aside"]);
const APP_ROOT_IDS = new Set(["root", "app", "__next", "__nuxt", "svelte"]);

function isElement(n: Node): n is Element {
  return "tagName" in n;
}

function attr(el: Element, name: string): string | null {
  const a = el.attrs.find((x) => x.name === name);
  return a ? a.value : null;
}

function children(n: Node): Node[] {
  return "childNodes" in n ? n.childNodes : [];
}

function textOf(n: Node, skip: Set<string>): string {
  if (n.nodeName === "#text" && "value" in n) return n.value;
  if (isElement(n) && skip.has(n.tagName)) return "";
  return children(n)
    .map((c) => textOf(c, skip))
    .join(n.nodeName === "#document" || (isElement(n) && isBlock(n.tagName)) ? " " : "");
}

const BLOCK = new Set(["p", "div", "li", "br", "h1", "h2", "h3", "h4", "h5", "h6", "section", "article", "main", "ul", "ol", "tr", "td", "th", "blockquote", "figure", "figcaption", "body", "dd", "dt"]);
function isBlock(tag: string): boolean {
  return BLOCK.has(tag);
}

function collapse(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

/** Counts words as runs of letters or digits (apostrophes and hyphens inside a word keep it as one). */
export function countWords(text: string): number {
  const m = text.match(/[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu);
  return m ? m.length : 0;
}

export function parseHtml(html: string): ParsedPage {
  const doc = parse(html, { sourceCodeLocationInfo: true });
  const page: ParsedPage = {
    lang: null,
    title: null,
    titleCount: 0,
    metaDescriptions: [],
    robotsDirectives: [],
    canonicals: [],
    viewport: null,
    headings: [],
    images: [],
    links: [],
    hreflang: [],
    openGraph: {},
    twitter: {},
    jsonLd: [],
    resources: [],
    mainText: "",
    wordCount: 0,
    signals: { scriptCount: 0, emptyAppRoot: false, noscriptNeedsJs: false },
  };

  let mainEl: Element | null = null;
  let bodyEl: Element | null = null;
  const titles: string[] = [];

  const walk = (n: Node): void => {
    if (isElement(n)) {
      const tag = n.tagName;
      switch (tag) {
        case "html":
          page.lang = attr(n, "lang");
          break;
        case "title":
          titles.push(collapse(textOf(n, new Set())));
          break;
        case "meta": {
          const name = (attr(n, "name") ?? "").toLowerCase();
          const property = (attr(n, "property") ?? "").toLowerCase();
          const content = attr(n, "content") ?? "";
          if (name === "description") page.metaDescriptions.push(content);
          else if (name === "robots" || name === "googlebot" || name === "bingbot") {
            for (const d of content.toLowerCase().split(",")) if (d.trim()) page.robotsDirectives.push(d.trim());
          } else if (name === "viewport") page.viewport = content;
          if (property.startsWith("og:")) page.openGraph[property] = content;
          if (name.startsWith("twitter:")) page.twitter[name] = content;
          else if (property.startsWith("twitter:")) page.twitter[property] = content;
          break;
        }
        case "link": {
          const rel = (attr(n, "rel") ?? "").toLowerCase().split(/\s+/).filter(Boolean);
          const href = attr(n, "href");
          if (href !== null) {
            if (rel.includes("canonical")) page.canonicals.push(href);
            if (rel.includes("alternate") && attr(n, "hreflang") !== null) {
              page.hreflang.push({ lang: (attr(n, "hreflang") ?? "").trim(), href });
            }
            if (rel.includes("stylesheet")) page.resources.push({ kind: "stylesheet", url: href });
          }
          break;
        }
        case "h1": case "h2": case "h3": case "h4": case "h5": case "h6":
          page.headings.push({ level: Number(tag[1]), text: collapse(textOf(n, new Set(["script", "style"]))) });
          break;
        case "img": {
          const src = attr(n, "src");
          page.images.push({ src, alt: attr(n, "alt") });
          if (src) page.resources.push({ kind: "image", url: src });
          break;
        }
        case "a": {
          const href = attr(n, "href");
          if (href !== null) {
            page.links.push({
              href,
              text: collapse(textOf(n, new Set(["script", "style"]))),
              rel: (attr(n, "rel") ?? "").toLowerCase().split(/\s+/).filter(Boolean),
            });
          }
          break;
        }
        case "script": {
          const src = attr(n, "src");
          const type = (attr(n, "type") ?? "").toLowerCase().trim();
          if (type === "application/ld+json") {
            const raw = children(n).map((c) => ("value" in c ? c.value : "")).join("");
            const loc = n.sourceCodeLocation?.startTag;
            page.jsonLd.push({ raw, line: loc ? loc.endLine : 1 });
          } else {
            page.signals.scriptCount++;
            if (src) page.resources.push({ kind: "script", url: src });
          }
          break;
        }
        case "iframe": {
          const src = attr(n, "src");
          if (src) page.resources.push({ kind: "iframe", url: src });
          break;
        }
        case "audio": case "video": case "source": {
          const src = attr(n, "src");
          if (src) page.resources.push({ kind: "media", url: src });
          break;
        }
        case "noscript":
          if (/javascript/i.test(collapse(textOf(n, new Set())))) page.signals.noscriptNeedsJs = true;
          break;
        case "main":
          if (!mainEl) mainEl = n;
          break;
        case "body":
          if (!bodyEl) bodyEl = n;
          break;
        default:
          break;
      }
      if (tag !== "template") {
        const id = attr(n, "id");
        if (id && APP_ROOT_IDS.has(id) && (tag === "div" || tag === "main" || tag === "section")) {
          if (collapse(textOf(n, SKIP_TEXT)) === "") page.signals.emptyAppRoot = true;
        }
      }
    }
    if (isElement(n) && n.tagName === "template") return;
    for (const c of children(n)) walk(c);
  };
  walk(doc);

  page.titleCount = titles.length;
  page.title = titles.length > 0 ? titles[0] ?? null : null;

  const skipForMain = new Set([...SKIP_TEXT, ...CHROME]);
  const root = mainEl ?? bodyEl;
  page.mainText = root ? collapse(textOf(root, mainEl ? SKIP_TEXT : skipForMain)) : "";
  page.wordCount = countWords(page.mainText);
  return page;
}
