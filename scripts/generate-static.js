#!/usr/bin/env node

/**
 * FactZone static SEO generator
 * -------------------------------------------------------------------------
 * Reads every document in the Firestore "posts" collection and generates:
 *
 *   - posts/<slug>.html
 *   - categories/<cat>/index.html
 *   - sitemap.xml
 *   - index.html crawlable-links block
 *
 * IMPORTANT:
 *   Article URLs intentionally remain:
 *   https://factzone.online/posts/<slug>.html
 *
 * DO NOT change ".html" to clean URLs here.
 */

const fs = require("fs");
const path = require("path");
const admin = require("firebase-admin");
const sanitizeHtml = require("sanitize-html");

// ---------------------------------------------------------------------------
// CONFIG
// ---------------------------------------------------------------------------

const ROOT = path.resolve(__dirname, "..");

const SITE_URL = "https://factzone.online";

const POSTS_DIR = path.join(ROOT, "posts");
const CATEGORIES_DIR = path.join(ROOT, "categories");
const TEMPLATE_DIR = path.join(ROOT, "templates");

const ARTICLE_TEMPLATE = path.join(
  TEMPLATE_DIR,
  "article.html"
);

const CATEGORY_TEMPLATE = path.join(
  TEMPLATE_DIR,
  "category.html"
);

const INDEX_FILE = path.join(ROOT, "index.html");

const SITEMAP_FILE = path.join(
  ROOT,
  "sitemap.xml"
);

// ---------------------------------------------------------------------------
// FIREBASE
// ---------------------------------------------------------------------------

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.applicationDefault()
  });
}

const db = admin.firestore();

// ---------------------------------------------------------------------------
// HELPERS
// ---------------------------------------------------------------------------

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function readFile(file) {
  return fs.readFileSync(file, "utf8");
}

function writeFile(file, content) {
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, content, "utf8");
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeXml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function stripHtml(value) {
  return String(value ?? "")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function truncate(value, maxLength = 160) {
  const text = String(value ?? "").trim();

  if (text.length <= maxLength) {
    return text;
  }

  return text.slice(0, maxLength - 1).trimEnd() + "…";
}

function slugify(value) {
  return String(value ?? "")
    .toLowerCase()
    .trim()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
}

function encodeSlug(slug) {
  return encodeURIComponent(String(slug ?? "").trim());
}

function articleUrl(slug) {
  // IMPORTANT: .html is intentional.
  return `${SITE_URL}/posts/${encodeSlug(slug)}.html`;
}

function categoryUrl(category) {
  return `${SITE_URL}/categories/${encodeURIComponent(
    String(category ?? "").trim()
  )}/`;
}

function formatDate(value) {
  if (!value) return "";

  let date;

  if (typeof value?.toDate === "function") {
    date = value.toDate();
  } else if (value instanceof Date) {
    date = value;
  } else {
    date = new Date(value);
  }

  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return date.toISOString().slice(0, 10);
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// CONTENT SANITIZATION
// ---------------------------------------------------------------------------

const allowedTags = [
  "p",
  "br",
  "strong",
  "b",
  "em",
  "i",
  "u",
  "s",
  "blockquote",
  "ul",
  "ol",
  "li",
  "h2",
  "h3",
  "h4",
  "a",
  "img",
  "figure",
  "figcaption",
  "div",
  "span",
  "table",
  "thead",
  "tbody",
  "tr",
  "th",
  "td",
  "code",
  "pre",
  "hr"
];

const allowedAttributes = {
  a: [
    "href",
    "title",
    "target",
    "rel"
  ],

  img: [
    "src",
    "srcset",
    "sizes",
    "alt",
    "title",
    "width",
    "height",
    "loading",
    "decoding",
    "class"
  ],

  figure: [
    "class"
  ],

  div: [
    "class"
  ],

  span: [
    "class"
  ],

  table: [
    "class"
  ],

  code: [
    "class"
  ],

  pre: [
    "class"
  ]
};

function sanitizeContent(html) {
  const input = String(html ?? "");

  return sanitizeHtml(input, {
    allowedTags,
    allowedAttributes,

    allowedSchemes: [
      "http",
      "https",
      "mailto"
    ],

    allowProtocolRelative: false,

    transformTags: {
      /**
       * Prevent duplicate H1s.
       * The article template already creates the main H1.
       */
      h1: "h2",

      /**
       * Content images:
       *
       * - lazy loading
       * - async decoding
       *
       * The hero image is NOT affected because it is outside
       * CONTENT_HTML in article.html.
       */
      img: function (tagName, attribs) {
        const next = {
          ...attribs
        };

        if (!next.loading) {
          next.loading = "lazy";
        }

        if (!next.decoding) {
          next.decoding = "async";
        }

        return {
          tagName: "img",
          attribs: next
        };
      },

      /**
       * External content links.
       */
      a: function (tagName, attribs) {
        const next = {
          ...attribs
        };

        if (!next.target) {
          next.target = "_blank";
        }

        if (!next.rel) {
          next.rel = "noopener noreferrer";
        }

        return {
          tagName: "a",
          attribs: next
        };
      }
    }
  });
}

// ---------------------------------------------------------------------------
// DOCUMENT NORMALIZATION
// ---------------------------------------------------------------------------

function normalizePost(doc) {
  const data = doc.data() || {};

  const title =
    data.title ||
    data.name ||
    "FactZone";

  const content =
    data.content ||
    data.body ||
    data.html ||
    "";

  const category =
    data.category ||
    data.cat ||
    "Facts";

  const description =
    data.description ||
    data.excerpt ||
    data.metaDescription ||
    truncate(stripHtml(content), 160);

  const image =
    data.image ||
    data.ogImage ||
    data.thumbnail ||
    data.featuredImage ||
    "";

  let slug =
    data.slug ||
    slugify(title);

  slug = String(slug)
    .trim()
    .replace(/^\/+|\/+$/g, "")
    .replace(/\.html$/i, "");

  const publishedAt =
    data.publishedAt ||
    data.date ||
    data.createdAt ||
    null;

  const updatedAt =
    data.updatedAt ||
    data.modifiedAt ||
    publishedAt ||
    null;

  return {
    id: doc.id,
    ...data,

    title: String(title),
    content: String(content),
    category: String(category),
    description: String(description),
    image: String(image),
    slug,

    publishedDate: formatDate(publishedAt),
    updatedDate: formatDate(updatedAt)
  };
}

// ---------------------------------------------------------------------------
// BACKFILL MISSING SLUGS
// ---------------------------------------------------------------------------

async function backfillSlugs(snapshot) {
  const used = new Set();

  snapshot.forEach((doc) => {
    const data = doc.data() || {};

    if (data.slug) {
      used.add(
        String(data.slug)
          .trim()
          .replace(/\.html$/i, "")
      );
    }
  });

  const updates = [];

  for (const doc of snapshot.docs) {
    const data = doc.data() || {};

    if (data.slug) {
      continue;
    }

    const base =
      slugify(
        data.title ||
        data.name ||
        doc.id
      ) || doc.id;

    let slug = base;
    let counter = 2;

    while (used.has(slug)) {
      slug = `${base}-${counter}`;
      counter++;
    }

    used.add(slug);

    updates.push({
      ref: doc.ref,
      slug
    });
  }

  if (!updates.length) {
    return;
  }

  console.log(
    `Backfilling ${updates.length} missing slug(s)...`
  );

  const batch = db.batch();

  for (const item of updates) {
    batch.update(item.ref, {
      slug: item.slug
    });
  }

  await batch.commit();

  console.log("Slug backfill complete.");
}

// ---------------------------------------------------------------------------
// JSON-LD
// ---------------------------------------------------------------------------

function buildJsonLd(post) {
  const url = articleUrl(post.slug);

  const image =
    post.image ||
    `${SITE_URL}/logo.png`;

  const published =
    post.publishedDate ||
    today();

  const modified =
    post.updatedDate ||
    published;

  const json = {
    "@context": "https://schema.org",

    "@type": "Article",

    headline: post.title,

    description: truncate(
      stripHtml(post.description),
      160
    ),

    url,

    mainEntityOfPage: {
      "@type": "WebPage",
      "@id": url
    },

    image: [
      image
    ],

    datePublished: published,

    dateModified: modified,

    author: {
      "@type": "Person",
      name: post.author || "Awaneesh"
    },

    publisher: {
      "@type": "Organization",

      name: "FactZone",

      logo: {
        "@type": "ImageObject",
        url: `${SITE_URL}/logo.png`
      }
    }
  };

  return JSON.stringify(
    json,
    null,
    2
  );
}

// ---------------------------------------------------------------------------
// RELATED ARTICLES
// ---------------------------------------------------------------------------

function buildRelatedHtml(currentPost, allPosts) {
  const related = allPosts
    .filter((post) => post.id !== currentPost.id)
    .filter((post) => {
      return (
        post.category &&
        currentPost.category &&
        post.category.toLowerCase() ===
          currentPost.category.toLowerCase()
      );
    })
    .slice(0, 4);

  if (!related.length) {
    return "";
  }

  return related
    .map((post) => {
      const url =
        `/posts/${encodeSlug(post.slug)}.html`;

      const title =
        escapeHtml(post.title);

      const image =
        post.image
          ? escapeHtml(post.image)
          : `${SITE_URL}/logo.png`;

      return `
        <a
          class="related-card"
          href="${url}"
        >
          <img
            src="${image}"
            alt="${title}"
            loading="lazy"
            decoding="async"
            width="82"
            height="82"
          >
          <span>${title}</span>
        </a>
      `;
    })
    .join("\n");
}

// ---------------------------------------------------------------------------
// CATEGORY PAGE
// ---------------------------------------------------------------------------

function renderCategoryPage(category, posts) {
  if (!fs.existsSync(CATEGORY_TEMPLATE)) {
    console.warn(
      "category.html template not found. Skipping category pages."
    );

    return;
  }

  const template =
    readFile(CATEGORY_TEMPLATE);

  const categoryPosts =
    posts.filter((post) => {
      return (
        String(post.category).toLowerCase() ===
        String(category).toLowerCase()
      );
    });

  const cards = categoryPosts
    .map((post) => {
      const url =
        `/posts/${encodeSlug(post.slug)}.html`;

      const image =
        post.image
          ? escapeHtml(post.image)
          : `${SITE_URL}/logo.png`;

      return `
        <a
          class="post-card"
          href="${url}"
        >
          <img
            src="${image}"
            alt="${escapeHtml(post.title)}"
            loading="lazy"
            decoding="async"
            width="300"
            height="169"
          >

          <div class="post-card-content">
            <h2>${escapeHtml(post.title)}</h2>

            <p>
              ${escapeHtml(
                truncate(
                  stripHtml(post.description),
                  140
                )
              )}
            </p>
          </div>
        </a>
      `;
    })
    .join("\n");

  let output = template;

  output = output.replace(
    /{{CATEGORY_NAME}}/g,
    escapeHtml(category)
  );

  output = output.replace(
    /{{CATEGORY}}/g,
    escapeHtml(category)
  );

  output = output.replace(
    /{{CATEGORY_URL}}/g,
    categoryUrl(category)
  );

  output = output.replace(
    /{{POSTS}}/g,
    cards
  );

  output = output.replace(
    /{{CONTENT}}/g,
    cards
  );

  const outputDir =
    path.join(
      CATEGORIES_DIR,
      slugify(category)
    );

  const outputFile =
    path.join(
      outputDir,
      "index.html"
    );

  writeFile(
    outputFile,
    output
  );

  console.log(
    `Category generated: ${category}`
  );
}

// ---------------------------------------------------------------------------
// ARTICLE PAGE
// ---------------------------------------------------------------------------

function renderArticlePage(post, allPosts) {
  if (!fs.existsSync(ARTICLE_TEMPLATE)) {
    throw new Error(
      `Missing article template: ${ARTICLE_TEMPLATE}`
    );
  }

  const template =
    readFile(ARTICLE_TEMPLATE);

  const canonicalUrl =
    articleUrl(post.slug);

  const contentHtml =
    sanitizeContent(post.content);

  const relatedHtml =
    buildRelatedHtml(
      post,
      allPosts
    );

  const description =
    truncate(
      stripHtml(post.description),
      160
    );

  const image =
    post.image ||
    `${SITE_URL}/logo.png`;

  let output = template;

  const replacements = {
    "{{TITLE}}":
      escapeHtml(post.title),

    "{{DESCRIPTION}}":
      escapeHtml(description),

    "{{CANONICAL}}":
      escapeHtml(canonicalUrl),

    "{{URL}}":
      escapeHtml(canonicalUrl),

    "{{OG_IMAGE}}":
      escapeHtml(image),

    "{{IMAGE}}":
      escapeHtml(image),

    "{{CATEGORY}}":
      escapeHtml(post.category),

    "{{CATEGORY_NAME}}":
      escapeHtml(post.category),

    "{{CONTENT_HTML}}":
      contentHtml,

    "{{RELATED_HTML}}":
      relatedHtml,

    "{{AUTHOR}}":
      escapeHtml(
        post.author || "Awaneesh"
      ),

    "{{DATE}}":
      escapeHtml(
        post.publishedDate || ""
      ),

    "{{PUBLISHED_DATE}}":
      escapeHtml(
        post.publishedDate || ""
      ),

    "{{UPDATED_DATE}}":
      escapeHtml(
        post.updatedDate ||
        post.publishedDate ||
        ""
      ),

    "{{JSONLD}}":
      buildJsonLd(post)
  };

  for (const [key, value] of Object.entries(
    replacements
  )) {
    output = output.replaceAll(
      key,
      value
    );
  }

  /**
   * Make sure unresolved common placeholders
   * don't remain visible on the live page.
   */
  output = output.replace(
    /{{[A-Z0-9_]+}}/g,
    ""
  );

  const outputFile =
    path.join(
      POSTS_DIR,
      `${post.slug}.html`
    );

  writeFile(
    outputFile,
    output
  );

  console.log(
    `Article generated: ${post.slug}.html`
  );
}

// ---------------------------------------------------------------------------
// SITEMAP
// ---------------------------------------------------------------------------

function buildSitemap(posts) {
  const urls = [];

  // Homepage
  urls.push({
    loc: `${SITE_URL}/`,
    lastmod: today()
  });

  // Tools page
  urls.push({
    loc: `${SITE_URL}/tools.html`,
    lastmod: today()
  });

  // Articles
  for (const post of posts) {
    urls.push({
      loc: articleUrl(post.slug),

      lastmod:
        post.updatedDate ||
        post.publishedDate ||
        today()
    });
  }

  // Categories
  const categories =
    [
      ...new Set(
        posts
          .map((post) => post.category)
          .filter(Boolean)
      )
    ];

  for (const category of categories) {
    const categoryPosts =
      posts.filter(
        (post) =>
          post.category === category
      );

    const latestDate =
      categoryPosts
        .map(
          (post) =>
            post.updatedDate ||
            post.publishedDate
        )
        .filter(Boolean)
        .sort()
        .pop() ||
      today();

    urls.push({
      loc: categoryUrl(category),
      lastmod: latestDate
    });
  }

  const body =
    urls
      .map(
        (item) => `
  <url>
    <loc>${escapeXml(item.loc)}</loc>
    <lastmod>${escapeXml(item.lastmod)}</lastmod>
  </url>`
      )
      .join("");

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset
  xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
>
${body}
</urlset>
`;
}

// ---------------------------------------------------------------------------
// INDEX CRAWLABLE LINKS
// ---------------------------------------------------------------------------

function buildIndexCrawlableLinks(posts) {
  return posts
    .map((post) => {
      const url =
        `/posts/${encodeSlug(post.slug)}.html`;

      const title =
        escapeHtml(post.title);

      const image =
        post.image
          ? escapeHtml(post.image)
          : `${SITE_URL}/logo.png`;

      return `
<a
  href="${url}"
  aria-label="${title}"
>
  <img
    src="${image}"
    alt="${title}"
    loading="lazy"
    decoding="async"
    width="300"
    height="120"
  >
  <span>${title}</span>
</a>
`;
    })
    .join("\n");
}

function updateIndexFile(posts) {
  if (!fs.existsSync(INDEX_FILE)) {
    console.warn(
      "index.html not found. Skipping index crawlable links."
    );

    return;
  }

  let index =
    readFile(INDEX_FILE);

  const block =
    buildIndexCrawlableLinks(posts);

  /**
   * Expected markers:
   *
   * <!-- CRAWLABLE_ARTICLE_LINKS_START -->
   * ...
   * <!-- CRAWLABLE_ARTICLE_LINKS_END -->
   */

  const startMarker =
    "<!-- CRAWLABLE_ARTICLE_LINKS_START -->";

  const endMarker =
    "<!-- CRAWLABLE_ARTICLE_LINKS_END -->";

  const start =
    index.indexOf(startMarker);

  const end =
    index.indexOf(endMarker);

  if (start === -1 || end === -1) {
    console.warn(
      "Crawlable link markers not found in index.html."
    );

    return;
  }

  const before =
    index.slice(
      0,
      start + startMarker.length
    );

  const after =
    index.slice(end);

  index =
    `${before}
${block}
${after}`;

  writeFile(
    INDEX_FILE,
    index
  );

  console.log(
    "index.html crawlable links updated."
  );
}

// ---------------------------------------------------------------------------
// REMOVE OLD GENERATED ARTICLE FILES
// ---------------------------------------------------------------------------

function removeOldGeneratedArticles(posts) {
  ensureDir(POSTS_DIR);

  const validFiles =
    new Set(
      posts.map(
        (post) =>
          `${post.slug}.html`
      )
    );

  const files =
    fs.readdirSync(
      POSTS_DIR
    );

  for (const file of files) {
    if (
      !file.toLowerCase().endsWith(".html")
    ) {
      continue;
    }

    if (
      !validFiles.has(file)
    ) {
      /**
       * Do not aggressively delete arbitrary
       * HTML files from posts/.
       *
       * Only delete files that look like
       * generated article pages.
       */
      if (
        file !== "index.html"
      ) {
        const fullPath =
          path.join(
            POSTS_DIR,
            file
          );

        console.log(
          `Removing old article: ${file}`
        );

        fs.unlinkSync(
          fullPath
        );
      }
    }
  }
}

// ---------------------------------------------------------------------------
// MAIN
// ---------------------------------------------------------------------------

async function main() {
  console.log(
    "=============================================="
  );

  console.log(
    "FactZone Static SEO Generator"
  );

  console.log(
    "=============================================="
  );

  ensureDir(POSTS_DIR);
  ensureDir(CATEGORIES_DIR);

  // -------------------------------------------------------------------------
  // Read Firestore
  // -------------------------------------------------------------------------

  console.log(
    "Reading posts from Firestore..."
  );

  const snapshot =
    await db
      .collection("posts")
      .get();

  console.log(
    `Found ${snapshot.size} post(s).`
  );

  // -------------------------------------------------------------------------
  // Backfill missing slugs
  // -------------------------------------------------------------------------

  await backfillSlugs(
    snapshot
  );

  /**
   * If slugs were backfilled, read Firestore again
   * so the generated pages use the newly saved slugs.
   */
  const refreshedSnapshot =
    await db
      .collection("posts")
      .get();

  const posts =
    refreshedSnapshot.docs
      .map(normalizePost)
      .filter(
        (post) =>
          post.slug
      );

  // -------------------------------------------------------------------------
  // Sort newest first
  // -------------------------------------------------------------------------

  posts.sort(
    (a, b) => {
      const dateA =
        new Date(
          a.updatedDate ||
          a.publishedDate ||
          0
        ).getTime();

      const dateB =
        new Date(
          b.updatedDate ||
          b.publishedDate ||
          0
        ).getTime();

      return dateB - dateA;
    }
  );

  // -------------------------------------------------------------------------
  // Generate article pages
  // -------------------------------------------------------------------------

  for (const post of posts) {
    renderArticlePage(
      post,
      posts
    );
  }

  // -------------------------------------------------------------------------
  // Generate category pages
  // -------------------------------------------------------------------------

  const categories =
    [
      ...new Set(
        posts
          .map(
            (post) =>
              post.category
          )
          .filter(Boolean)
      )
    ];

  for (const category of categories) {
    renderCategoryPage(
      category,
      posts
    );
  }

  // -------------------------------------------------------------------------
  // Sitemap
  // -------------------------------------------------------------------------

  const sitemap =
    buildSitemap(posts);

  writeFile(
    SITEMAP_FILE,
    sitemap
  );

  console.log(
    "sitemap.xml generated."
  );

  // -------------------------------------------------------------------------
  // Homepage crawlable links
  // -------------------------------------------------------------------------

  updateIndexFile(
    posts
  );

  // -------------------------------------------------------------------------
  // Done
  // -------------------------------------------------------------------------

  console.log(
    "=============================================="
  );

  console.log(
    `Generated ${posts.length} article page(s).`
  );

  console.log(
    `Generated ${categories.length} category page(s).`
  );

  console.log(
    "URL format: /posts/<slug>.html"
  );

  console.log(
    "=============================================="
  );
}

// ---------------------------------------------------------------------------
// ERROR HANDLING
// ---------------------------------------------------------------------------

main()
  .catch((error) => {
    console.error(
      "Static generation failed:"
    );

    console.error(
      error
    );

    process.exit(1);
  });
