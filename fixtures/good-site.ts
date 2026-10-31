import type { FixtureRoute, FixtureSite } from "./server.js";
import { POTTERY, page, prose, sitemapIndexXml, sitemapXml } from "./html.js";

/**
 * "Fernwood Pottery": a fictional, deliberately well-built small site.
 * Every audit check should come back clean on it (no high or medium issues).
 */

const O = "{{ORIGIN}}";
const NAV: [string, string][] = [
  ["/", "Home"],
  ["/about", "About"],
  ["/products/", "Products"],
  ["/blog/", "Blog"],
  ["/faq", "FAQ"],
  ["/podcast/episode-1", "Podcast"],
  ["/books/clay-notes", "Book"],
  ["/contact", "Contact"],
  ["/es/", "Espanol"],
];

const org = { "@type": "Organization", "@id": `${O}/#org`, name: "Fernwood Pottery", url: `${O}/`, logo: `${O}/img/logo.svg`, sameAs: ["https://social.example/fernwood"], contactPoint: { "@type": "ContactPoint", contactType: "customer support", email: "hello@fernwood.example" } };
const crumbs = (items: [string, string][]) => ({
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  itemListElement: items.map(([name, path], i) => ({ "@type": "ListItem", position: i + 1, name, item: `${O}${path}` })),
});

const html = (body: string): FixtureRoute => ({ body });

interface P {
  path: string;
  title: string;
  desc: string;
  h1: string;
  intro: string;
  extra?: string;
  jsonLd?: unknown[];
  head?: string;
  lang?: string;
}

function build(p: P): string {
  return page({
    title: p.title,
    description: p.desc,
    h1: p.h1,
    canonical: p.path,
    social: true,
    nav: NAV,
    lang: p.lang ?? "en",
    ...(p.head ? { head: p.head } : {}),
    ...(p.jsonLd ? { jsonLd: p.jsonLd } : {}),
    body: `<p>${p.intro}</p>\n${p.extra ?? ""}\n<h2>More about this page</h2>\n${prose(p.path, POTTERY, 12)}`,
  });
}

const product = (slug: string, name: string, price: string): P => ({
  path: `/products/${slug}`,
  title: `${name} - Fernwood Pottery`,
  desc: `The ${name.toLowerCase()} is thrown and glazed by hand in our small studio. See the details, sizes and care notes before you order.`,
  h1: name,
  intro: `The ${name.toLowerCase()} is made in small batches in our studio.`,
  extra: `<img src="/img/${slug}.svg" alt="${name} on a wooden table"><p><a href="/products/">Back to all products</a></p>`,
  jsonLd: [
    {
      "@context": "https://schema.org",
      "@type": "Product",
      name,
      image: [`${O}/img/${slug}.svg`],
      description: `A hand-thrown ${name.toLowerCase()}.`,
      sku: slug.toUpperCase(),
      brand: { "@type": "Brand", name: "Fernwood Pottery" },
      offers: { "@type": "Offer", price, priceCurrency: "USD", availability: "https://schema.org/InStock", url: `${O}/products/${slug}` },
    },
    crumbs([["Home", "/"], ["Products", "/products/"], [name, `/products/${slug}`]]),
  ],
});

const post = (slug: string, title: string): P => ({
  path: `/blog/${slug}`,
  title: `${title} | Fernwood Pottery Blog`,
  desc: `${title}: notes from the studio on what we tried, what failed and what we would repeat, written for people who like making things.`,
  h1: title,
  intro: `${title} is a note from the studio bench.`,
  extra: `<p><a href="/blog/">All posts</a></p>`,
  jsonLd: [
    {
      "@context": "https://schema.org",
      "@type": "Article",
      headline: title,
      author: { "@type": "Person", name: "Maren Alder", url: `${O}/about` },
      datePublished: "2026-03-02",
      dateModified: "2026-03-09",
      image: [`${O}/img/share.svg`],
      publisher: { "@type": "Organization", name: "Fernwood Pottery", logo: { "@type": "ImageObject", url: `${O}/img/logo.svg` } },
    },
    crumbs([["Home", "/"], ["Blog", "/blog/"], [title, `/blog/${slug}`]]),
  ],
});

const pages: P[] = [
  {
    path: "/",
    title: "Fernwood Pottery - Handmade Mugs, Bowls and Vases",
    desc: "Fernwood Pottery is a small fictional studio making mugs, bowls and vases by hand. Browse the range, read the blog and get in touch.",
    h1: "Handmade pottery from a small studio",
    intro: "Welcome to Fernwood Pottery, a made-up studio used to test an audit tool.",
    extra: `<p><a href="/products/">See the products</a> or read <a href="/blog/">the blog</a>.</p>`,
    jsonLd: [{ "@context": "https://schema.org", "@graph": [org, { "@type": "WebSite", "@id": `${O}/#site`, url: `${O}/`, name: "Fernwood Pottery", publisher: { "@id": `${O}/#org` } }] }],
    head: `<link rel="alternate" hreflang="en" href="${O}/">\n<link rel="alternate" hreflang="es" href="${O}/es/">\n<link rel="alternate" hreflang="x-default" href="${O}/">`,
  },
  {
    path: "/about",
    title: "About Fernwood Pottery and Maren Alder",
    desc: "Meet Maren Alder, the potter behind Fernwood Pottery, and read how a one-person studio plans, throws, glazes and fires each batch.",
    h1: "About the studio",
    intro: "Maren Alder started the studio in a shed and still does most of the work herself.",
    jsonLd: [{ "@context": "https://schema.org", "@type": "Person", name: "Maren Alder", url: `${O}/about`, jobTitle: "Potter", image: `${O}/img/maren.svg`, sameAs: ["https://social.example/maren"] }, crumbs([["Home", "/"], ["About", "/about"]])],
  },
  {
    path: "/products/",
    title: "Handmade Mugs, Bowls and Vases | Fernwood Pottery",
    desc: "All current Fernwood Pottery products in one place: hand-thrown mugs, bowls and vases, each made in small batches and glazed in the studio.",
    h1: "Products",
    intro: "Everything below is made in the studio.",
    extra: `<ul><li><a href="/products/blue-mug">Blue mug</a></li><li><a href="/products/green-bowl">Green bowl</a></li></ul>`,
    jsonLd: [crumbs([["Home", "/"], ["Products", "/products/"]])],
  },
  product("blue-mug", "Blue Mug", "28.00"),
  product("green-bowl", "Green Bowl", "34.00"),
  {
    path: "/blog/",
    title: "Studio Blog | Fernwood Pottery",
    desc: "Notes from the Fernwood Pottery studio: glaze tests, kiln schedules and lessons from batches that did not go to plan.",
    h1: "Studio blog",
    intro: "Short notes from the bench.",
    extra: `<ul><li><a href="/blog/glaze-basics">Glaze basics</a></li><li><a href="/blog/kiln-schedule">A kiln schedule that works</a></li></ul>`,
    jsonLd: [crumbs([["Home", "/"], ["Blog", "/blog/"]])],
  },
  post("glaze-basics", "Glaze basics for beginners"),
  post("kiln-schedule", "A kiln schedule that works"),
  {
    path: "/faq",
    title: "Frequently Asked Questions | Fernwood Pottery",
    desc: "Answers to common questions about Fernwood Pottery orders, shipping, dishwasher safety, custom glazes and how long a batch takes to make.",
    h1: "Frequently asked questions",
    intro: "Quick answers before you write to us.",
    extra: `<h2>Orders</h2><p>We ship within five working days.</p><h2>Care</h2><p>Hand wash for the longest life.</p>`,
    jsonLd: [
      {
        "@context": "https://schema.org",
        "@type": "FAQPage",
        mainEntity: [
          { "@type": "Question", name: "Are the mugs dishwasher safe?", acceptedAnswer: { "@type": "Answer", text: "They are, but hand washing keeps the glaze looking new for longer." } },
          { "@type": "Question", name: "How long does shipping take?", acceptedAnswer: { "@type": "Answer", text: "Orders ship within five working days." } },
        ],
      },
    ],
  },
  {
    path: "/podcast/episode-1",
    title: "Episode 1: Why We Throw Pots | Clay Hours Podcast",
    desc: "In the first episode of the fictional Clay Hours podcast, a potter explains why she throws by hand and what a studio week looks like.",
    h1: "Episode 1: Why we throw pots",
    intro: "A short talk about the first year in the studio.",
    jsonLd: [
      {
        "@context": "https://schema.org",
        "@type": "PodcastEpisode",
        name: "Episode 1: Why we throw pots",
        url: `${O}/podcast/episode-1`,
        datePublished: "2026-02-01",
        description: "A potter explains why she throws by hand.",
        duration: "PT23M",
        associatedMedia: { "@type": "MediaObject", contentUrl: `${O}/audio/episode-1.mp3` },
        partOfSeries: { "@type": "PodcastSeries", name: "Clay Hours", url: `${O}/podcast/` },
      },
    ],
  },
  {
    path: "/books/clay-notes",
    title: "Clay Notes: A Studio Handbook | Fernwood Pottery",
    desc: "Clay Notes is a fictional handbook of studio tips, glaze recipes and firing notes collected over one year at Fernwood Pottery.",
    h1: "Clay Notes: a studio handbook",
    intro: "A small book of things we wish we had known earlier.",
    jsonLd: [
      {
        "@context": "https://schema.org",
        "@type": "Book",
        name: "Clay Notes",
        author: { "@type": "Person", name: "Maren Alder" },
        isbn: "9780000000002",
        url: `${O}/books/clay-notes`,
        sameAs: "https://books.example/clay-notes",
        workExample: { "@type": "Book", bookFormat: "https://schema.org/Paperback", isbn: "9780000000002" },
      },
    ],
  },
  {
    path: "/contact",
    title: "Contact Fernwood Pottery",
    desc: "Write to Fernwood Pottery about orders, custom glazes or visiting the studio. We reply within two working days, usually sooner.",
    h1: "Contact",
    intro: "Write to hello@fernwood.example and we will reply within two working days.",
    jsonLd: [{ "@context": "https://schema.org", ...org }],
  },
  {
    path: "/es/",
    lang: "es",
    title: "Fernwood Pottery - Ceramica hecha a mano",
    desc: "Fernwood Pottery es un taller ficticio de ceramica: tazas, cuencos y jarrones hechos a mano en pequenas tandas. Conoce la tienda.",
    h1: "Ceramica hecha a mano en un taller pequeno",
    intro: "Bienvenida al taller ficticio Fernwood Pottery, creado para probar una herramienta de auditoria.",
    head: `<link rel="alternate" hreflang="es" href="${O}/es/">\n<link rel="alternate" hreflang="en" href="${O}/">\n<link rel="alternate" hreflang="x-default" href="${O}/">`,
  },
];

const routes: Record<string, FixtureRoute> = {};
for (const p of pages) routes[p.path] = html(build(p));

routes["/robots.txt"] = {
  type: "text/plain",
  body: `User-agent: *\nDisallow: /admin/\n\nSitemap: ${O}/sitemap.xml\n`,
};
routes["/sitemap.xml"] = { type: "application/xml", body: sitemapIndexXml(O, ["/sitemap-pages.xml", "/sitemap-blog.xml"]) };
routes["/sitemap-pages.xml"] = {
  type: "application/xml",
  body: sitemapXml(O, ["/", "/about", "/products/", "/products/blue-mug", "/products/green-bowl", "/faq", "/podcast/episode-1", "/books/clay-notes", "/contact", "/es/"]),
};
routes["/sitemap-blog.xml"] = { type: "application/xml", body: sitemapXml(O, ["/blog/", "/blog/glaze-basics", "/blog/kiln-schedule"]) };

export const goodSite: FixtureSite = {
  name: "good-site",
  routes,
  notFound: { status: 404, body: "<!doctype html><html lang=\"en\"><title>Page not found</title><h1>Page not found</h1></html>" },
};

export const GOOD_SITE_PAGE_COUNT = pages.length;
