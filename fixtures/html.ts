/** Helpers for building fixture pages. Everything here is fictional filler. */

export interface Vocab {
  adjectives: string[];
  nouns: string[];
  verbs: string[];
}

export const POTTERY: Vocab = {
  adjectives: ["speckled", "glossy", "matte", "heavy", "slender", "rounded", "rustic", "smooth", "earthy", "bright", "quiet", "sturdy", "delicate", "warm", "cool", "layered"],
  nouns: ["mug", "bowl", "vase", "glaze", "kiln", "studio", "wheel", "handle", "rim", "clay", "plate", "jug", "firing", "batch", "shelf", "workshop"],
  verbs: ["hold", "pour", "stack", "wash", "gift", "display", "fill", "carry", "polish", "collect", "use", "share", "repair", "trim", "dry", "shape"],
};

export const PRINTING: Vocab = {
  adjectives: ["crisp", "bold", "folded", "coated", "uncoated", "recycled", "vivid", "compact", "textured", "glossy", "pale", "layered", "sharp", "soft", "wide", "narrow"],
  nouns: ["poster", "flyer", "card", "press", "ink", "sheet", "proof", "stock", "margin", "bleed", "banner", "booklet", "label", "sticker", "pallet", "template"],
  verbs: ["print", "trim", "fold", "mail", "design", "proof", "stack", "pack", "order", "approve", "match", "pick", "stamp", "bind", "cut", "scan"],
};

function rng(seed: string): () => number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return () => {
    h ^= h << 13;
    h ^= h >>> 17;
    h ^= h << 5;
    return ((h >>> 0) % 100000) / 100000;
  };
}

const TEMPLATES: ((a: string[], n: string[], v: string[]) => string)[] = [
  (a, n, v) => `Every ${a[0]} ${n[0]} begins as a plain idea and ends as something you can ${v[0]} every single day.`,
  (a, n, v) => `We keep the ${n[1]} ${a[1]} on purpose, because a ${a[2]} ${n[2]} is easier to ${v[1]} and much easier to ${v[2]} later.`,
  (a, n) => `Our ${n[3]} takes patience, and the ${a[3]} ${n[4]} we finish on Friday is never the same as the one we finished on Tuesday.`,
  (a, n, v) => `People often ask how to ${v[3]} a ${a[4]} ${n[5]}, and the honest answer is to start small and keep notes.`,
  (a, n, v) => `A ${a[5]} ${n[6]} looks simple, yet the ${n[7]} behind it has been tested many times before we let anyone ${v[4]} it.`,
  (a, n, v) => `You can ${v[5]} the ${n[8]} next to a ${a[6]} ${n[9]} and notice how the ${a[7]} edge changes the whole shelf.`,
  (a, n, v) => `Customers tell us they ${v[6]} their ${n[10]} more often once it feels ${a[8]} in the hand rather than merely pretty.`,
  (a, n, v) => `We write down every ${n[11]} we make so that a ${a[9]} ${n[12]} can be matched again when someone wants to ${v[7]} a second one.`,
  (a, n, v) => `The ${a[10]} ${n[13]} on the left was a test, and the ${a[11]} ${n[14]} on the right is what we actually decided to ${v[8]}.`,
  (a, n, v) => `If a ${n[15]} arrives ${a[12]} or marked, tell us and we will ${v[9]} it again or ${v[10]} it free of charge.`,
  (a, n, v) => `Small changes to the ${n[2]} make a ${a[13]} difference, so we ${v[11]} each ${n[3]} twice before it leaves us.`,
  (a, n, v) => `Some weeks we only ${v[12]} one ${a[14]} ${n[4]} because the ${n[5]} needs time, and that suits us fine.`,
  (a, n, v) => `Ask us about a ${a[15]} ${n[6]} if you want to ${v[13]} something that nobody else on your street will own.`,
  (a, n, v) => `Keep your ${n[7]} away from heat and ${v[14]} it by hand, and a ${a[0]} ${n[8]} like this will last for years.`,
  (a, n, v) => `Before we ${v[15]} the next ${n[9]}, we read every message, because the ${a[1]} ${n[10]} you describe is the one we want to make.`,
];

/** Deterministic filler text: the same seed always gives the same text, different seeds give different text. */
export function prose(seed: string, vocab: Vocab, sentences = 14): string {
  const r = rng(seed);
  const pick = (list: string[], n: number): string[] => {
    const copy = [...list];
    const out: string[] = [];
    for (let i = 0; i < n; i++) out.push(copy.splice(Math.floor(r() * copy.length), 1)[0] as string);
    return out;
  };
  const paragraphs: string[] = [];
  let current: string[] = [];
  for (let i = 0; i < sentences; i++) {
    const t = TEMPLATES[i % TEMPLATES.length] as (typeof TEMPLATES)[number];
    current.push(t(pick(vocab.adjectives, 16), pick(vocab.nouns, 16), pick(vocab.verbs, 16)));
    if (current.length === 4) {
      paragraphs.push(`<p>${current.join(" ")}</p>`);
      current = [];
    }
  }
  if (current.length > 0) paragraphs.push(`<p>${current.join(" ")}</p>`);
  return paragraphs.join("\n");
}

export interface PageOptions {
  /** null omits the element. */
  title?: string | null;
  description?: string | null;
  h1?: string | null;
  /** null omits the lang attribute. */
  lang?: string | null;
  /** A path or URL; null omits the tag. */
  canonical?: string | null;
  viewport?: boolean;
  /** Add Open Graph and Twitter card tags. */
  social?: boolean;
  robots?: string;
  /** Extra tags for <head>. */
  head?: string;
  /** Links for the <nav>: [href, text]. */
  nav?: [string, string][];
  /** Content of <main> after the h1. */
  body: string;
  jsonLd?: unknown[];
  /** Raw JSON-LD script contents (for deliberately broken blocks). */
  rawJsonLd?: string[];
}

export function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
}

export function page(o: PageOptions): string {
  const head: string[] = ['<meta charset="utf-8">'];
  if (o.viewport !== false) head.push('<meta name="viewport" content="width=device-width, initial-scale=1">');
  if (o.title !== null) head.push(`<title>${esc(o.title ?? "Untitled")}</title>`);
  if (o.description !== null && o.description !== undefined) head.push(`<meta name="description" content="${esc(o.description)}">`);
  if (o.canonical !== null && o.canonical !== undefined) head.push(`<link rel="canonical" href="${o.canonical.startsWith("/") ? "{{ORIGIN}}" + o.canonical : o.canonical}">`);
  if (o.robots) head.push(`<meta name="robots" content="${o.robots}">`);
  if (o.social) {
    const t = o.title ?? "";
    head.push(
      `<meta property="og:title" content="${esc(t)}">`,
      `<meta property="og:description" content="${esc(o.description ?? "")}">`,
      `<meta property="og:image" content="{{ORIGIN}}/img/share.svg">`,
      `<meta name="twitter:card" content="summary_large_image">`,
    );
  }
  if (o.head) head.push(o.head);
  for (const j of o.jsonLd ?? []) head.push(`<script type="application/ld+json">\n${JSON.stringify(j, null, 2)}\n</script>`);
  for (const raw of o.rawJsonLd ?? []) head.push(`<script type="application/ld+json">\n${raw}\n</script>`);

  const nav = o.nav ? `<nav>\n${o.nav.map(([h, t]) => `<a href="${h}">${esc(t)}</a>`).join("\n")}\n</nav>\n` : "";
  const lang = o.lang === null ? "" : ` lang="${o.lang ?? "en"}"`;
  const h1 = o.h1 === null ? "" : `<h1>${esc(o.h1 ?? "Heading")}</h1>\n`;
  return `<!doctype html>
<html${lang}>
<head>
${head.join("\n")}
</head>
<body>
<header><p>Fictional demo site</p></header>
${nav}<main>
${h1}${o.body}
</main>
<footer><p>Copyright notice. All names on this site are made up.</p></footer>
</body>
</html>
`;
}

export function sitemapXml(origin: string, paths: string[]): string {
  const urls = paths.map((p) => `  <url><loc>${p.startsWith("http") ? p : origin + p}</loc></url>`).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
}

export function sitemapIndexXml(origin: string, paths: string[]): string {
  const items = paths.map((p) => `  <sitemap><loc>${origin}${p}</loc></sitemap>`).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${items}\n</sitemapindex>\n`;
}
