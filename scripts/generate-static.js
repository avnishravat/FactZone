#!/usr/bin/env node
/**
 * FactZone static SEO generator
 * -------------------------------------------------------------------------
 * Reads every document in the Firestore "posts" collection and generates:
 *   - posts/<slug>.html            one flat static file per article
 *   - categories/<cat>/index.html  one listing page per category
 *   - sitemap.xml                  homepage + tools.html + articles + categories
 *   - index.html                   real <a href> links injected between the
 *                                   SSG:CRAWLABLE-LINKS markers (nothing else
 *                                   in the file is touched)
 *
 * Article URL: https://factzone.online/posts/<slug>.html  (flat file, no folder)
 *
 * Any post missing a `slug` field gets one assigned (from its title, made
 * unique) and written back to Firestore once. Existing slugs are never
 * changed.
 *
 * Usage:
 *   node scripts/generate-static.js
 *     Live mode. Requires FIREBASE_SERVICE_ACCOUNT_FACTZONE env var to hold
 *     the full JSON of a Firebase service-account key.
 *
 *   node scripts/generate-static.js --dry-run=scripts/fixtures/sample-posts.json
 *     Test mode. Reads posts from a local JSON file instead of Firestore and
 *     never writes back to Firestore (slug backfill is only logged). Lets
 *     you check the generator's output without touching production data.
 * -------------------------------------------------------------------------
 */

const fs = require('fs');
const path = require('path');
const sanitizeHtml = require('sanitize-html');

const ROOT = path.join(__dirname, '..');
const SITE_URL = 'https://factzone.online';

const CATEGORY_LABELS = {
  science: 'Science / विज्ञान',
  tech:    'Tech / तकनीक',
  history: 'History / इतिहास',
  mystery: 'Mystery / रहस्य',
  viral:   'Viral / रोचक तथ्य'
};
const CATEGORY_ORDER = ['science', 'history', 'tech', 'mystery', 'viral'];

const DRY_RUN_ARG = process.argv.find(a => a.startsWith('--dry-run='));
const DRY_RUN_FIXTURE = DRY_RUN_ARG ? DRY_RUN_ARG.split('=')[1] : null;

// ---------------------------------------------------------------------------
// Slug helpers - byte-identical logic to admin.html's slugify()/makeUniqueSlug()
// so a slug the generator assigns looks exactly like one the admin panel would.
// ---------------------------------------------------------------------------
function slugify(str) {
  let s = String(str == null ? '' : str).trim().toLowerCase();
  s = s.replace(/[^\p{L}\p{N}\p{M}]+/gu, '-');
  s = s.replace(/^-+|-+$/g, '');
  return s;
}

function makeUniqueSlug(baseSlug, existingSlugs) {
  if (!baseSlug) baseSlug = 'post';
  if (!existingSlugs.has(baseSlug)) return baseSlug;
  let i = 2;
  while (existingSlugs.has(`${baseSlug}-${i}`)) i++;
  return `${baseSlug}-${i}`;
}

// ---------------------------------------------------------------------------
// Date / text helpers - mirror detail.html's toSafeDate()/formatDate()/readingTime()
// ---------------------------------------------------------------------------
function toSafeDate(val) {
  if (val === undefined || val === null || val === '') return null;
  if (val && typeof val.toDate === 'function') {
    // Firestore Admin SDK Timestamp instance
    const d = val.toDate();
    return isNaN(d.getTime()) ? null : d;
  }
  let d;
  if (typeof val === 'number') {
    d = new Date(val);
  } else if (typeof val === 'string' && /^\d+$/.test(val)) {
    let num = Number(val);
    if (val.length <= 10) num = num * 1000;
    d = new Date(num);
  } else {
    d = new Date(val);
  }
  return isNaN(d.getTime()) ? null : d;
}

function formatDate(iso) {
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
  } catch (e) { return ''; }
}

function readingTime(text) {
  const words = (text || '').trim().split(/\s+/).filter(Boolean).length;
  const mins = Math.max(1, Math.round(words / 200));
  return mins + ' min read';
}

function stripHtml(html) {
  return (html || '').replace(/<[^>]*>/g, '').replace(/\n/g, ' ');
}

function escapeHtml(str) {
  return String(str == null ? '' : str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function sanitizeContent(html) {
  return sanitizeHtml(html || '', {
    allowedTags: sanitizeHtml.defaults.allowedTags.concat(['img', 'span', 'u', 's', 'h1', 'h2']),
    allowedAttributes: Object.assign({}, sanitizeHtml.defaults.allowedAttributes, {
      a: ['href', 'name', 'target', 'rel'],
      img: ['src', 'srcset', 'alt', 'title', 'width', 'height', 'loading', 'decoding'],
      span: ['style'],
      p: ['style'],
      div: ['style']
    }),
    allowedSchemes: ['http', 'https', 'mailto', 'tel']
  });
}

// ---------------------------------------------------------------------------
// Template helpers
// ---------------------------------------------------------------------------
function readTemplate(name) {
  return fs.readFileSync(path.join(ROOT, 'templates', name), 'utf8');
}

function fillTemplate(tpl, data) {
  return tpl.replace(/\{\{(\w+)\}\}/g, (m, k) => (k in data ? String(data[k]) : ''));
}

// ---------------------------------------------------------------------------
// Firestore access (live) / fixture access (dry run)
// ---------------------------------------------------------------------------
async function loadPosts() {
  if (DRY_RUN_FIXTURE) {
    const fixturePath = path.isAbsolute(DRY_RUN_FIXTURE) ? DRY_RUN_FIXTURE : path.join(ROOT, DRY_RUN_FIXTURE);
    const raw = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
    console.log(`[dry-run] loaded ${raw.length} posts from ${fixturePath}`);
    return { db: null, posts: raw };
  }

  const admin = require('firebase-admin');
  const rawCred = process.env.FIREBASE_SERVICE_ACCOUNT_FACTZONE;
  if (!rawCred) {
    throw new Error('FIREBASE_SERVICE_ACCOUNT_FACTZONE env var is not set. ' +
      'Pass --dry-run=<fixture.json> to test without Firestore access.');
  }
  const serviceAccount = JSON.parse(rawCred);
  admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
  const db = admin.firestore();

  const snap = await db.collection('posts').get();
  const posts = [];
  snap.forEach(doc => posts.push({ id: doc.id, ...doc.data() }));
  return { db, posts };
}

async function backfillSlugs(db, posts) {
  const existingSlugs = new Set(posts.map(p => p.slug).filter(Boolean));
  const toWrite = [];

  for (const post of posts) {
    if (post.slug) continue;
    const base = slugify(post.title || '') || `post-${post.id}`;
    const unique = makeUniqueSlug(base, existingSlugs);
    existingSlugs.add(unique);
    post.slug = unique;
    toWrite.push(post);
  }

  if (!toWrite.length) {
    console.log('Slug backfill: nothing to do, every post already has a slug.');
    return;
  }

  if (!db) {
    console.log(`[dry-run] would backfill ${toWrite.length} slug(s):`);
    toWrite.forEach(p => console.log(`  - ${p.id} -> "${p.slug}"`));
    return;
  }

  const batch = db.batch();
  toWrite.forEach(p => batch.update(db.collection('posts').doc(p.id), { slug: p.slug }));
  await batch.commit();
  console.log(`Slug backfill: assigned and saved ${toWrite.length} new slug(s).`);
}

// ---------------------------------------------------------------------------
// Per-post rendering
// ---------------------------------------------------------------------------
function buildJsonLd(post, ctx) {
  const url = ctx.canonicalUrl;
  const graph = [
    {
      '@type': 'Organization',
      '@id': `${SITE_URL}/#organization`,
      name: 'FactZone',
      url: `${SITE_URL}/`,
      logo: { '@type': 'ImageObject', url: `${SITE_URL}/logo.png`, width: 512, height: 512 },
      sameAs: ['https://www.instagram.com/avnish__1203/', 'https://www.youtube.com/@FinupFact'],
      contactPoint: {
        '@type': 'ContactPoint', contactType: 'customer support',
        email: 'avnishravat20@gmail.com', areaServed: 'IN', availableLanguage: ['Hindi', 'English']
      }
    },
    {
      '@type': 'WebSite', '@id': `${SITE_URL}/#website`, name: 'FactZone', url: `${SITE_URL}/`,
      inLanguage: 'hi', publisher: { '@id': `${SITE_URL}/#organization` }
    },
    {
      '@type': 'BreadcrumbList', '@id': `${url}#breadcrumb`,
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Home', item: `${SITE_URL}/` },
        { '@type': 'ListItem', position: 2, name: ctx.categoryLabel, item: ctx.categoryUrl },
        { '@type': 'ListItem', position: 3, name: ctx.title, item: url }
      ]
    },
    {
      '@type': 'WebPage', '@id': `${url}#webpage`, url, name: ctx.title, description: ctx.desc,
      inLanguage: 'hi', isPartOf: { '@id': `${SITE_URL}/#website` },
      primaryImageOfPage: { '@type': 'ImageObject', '@id': `${url}#primaryimage`, url: ctx.image, caption: ctx.title },
      breadcrumb: { '@id': `${url}#breadcrumb` }, mainEntity: { '@id': `${url}#article` }
    },
    {
      '@type': 'Article', '@id': `${url}#article`, mainEntityOfPage: { '@id': `${url}#webpage` },
      headline: ctx.title, description: ctx.desc, image: [ctx.image], inLanguage: 'hi',
      articleSection: ctx.categoryLabel, wordCount: ctx.wordCount,
      datePublished: ctx.publishedISO, dateModified: ctx.updatedISO,
      author: { '@type': 'Person', '@id': `${SITE_URL}/#person-awaneesh`, name: 'Awaneesh', url: `${SITE_URL}/author.html` },
      publisher: { '@id': `${SITE_URL}/#organization` }
    }
  ];
  return JSON.stringify({ '@context': 'https://schema.org', '@graph': graph }, null, 2);
}

function buildRelatedHtml(relatedPosts) {
  if (!relatedPosts.length) return '';
  return relatedPosts.map(p => {
    const img = escapeHtml(p.image || `${SITE_URL}/logo.png`);
    const ttl = escapeHtml(p.title || '');
    return `<a href="/posts/${encodeURIComponent(p.slug)}.html" class="rc" aria-label="Read: ${ttl}">` +
           `<img src="${img}" loading="lazy" width="55" height="55" alt="${ttl}" onerror="this.style.display='none'">` +
           `<h3>${ttl}</h3></a>`;
  }).join('');
}

function renderArticle(post, allPosts, articleTpl) {
  const titleRaw = post.title || 'FactZone Educational Article';
  const contentRaw = post.content || '';
  const image = post.image || `${SITE_URL}/logo.png`;
  const descRaw = stripHtml(contentRaw);
  const desc = descRaw.substring(0, 160);

  const createdDate = toSafeDate(post.createdAt);
  const publishedISO = createdDate ? createdDate.toISOString() : new Date().toISOString();
  const updatedDate = toSafeDate(post.updatedAt);
  const updatedISO = updatedDate ? updatedDate.toISOString() : publishedISO;

  const cleanText = stripHtml(contentRaw);
  const wordCount = cleanText.trim().split(/\s+/).filter(Boolean).length;

  const categoryLabel = CATEGORY_LABELS[post.category] || post.category || 'Amazing Facts';
  const categoryUrl = post.category ? `${SITE_URL}/categories/${post.category}/` : `${SITE_URL}/`;
  const canonicalUrl = `${SITE_URL}/posts/${encodeURIComponent(post.slug)}.html`;

  const title = escapeHtml(titleRaw);
  const content = sanitizeContent(contentRaw);
  const minsRead = readingTime(cleanText);
  const author = 'Awaneesh';

  const metaBits = [`<strong>Author:</strong> ${author}`, `<strong>Date:</strong> ${formatDate(publishedISO)}`];
  if (updatedISO !== publishedISO) metaBits.push(`<strong>Updated:</strong> ${formatDate(updatedISO)}`);
  metaBits.push(`<strong>Read Time:</strong> ${minsRead}`);
  const metaLine = metaBits.join(' &nbsp;•&nbsp; ');

  const shareUrl = encodeURIComponent(canonicalUrl);
  const shareText = encodeURIComponent(titleRaw + ' - Read more on FactZone:\n');

  const related = allPosts
    .filter(p => p.category === post.category && p.slug !== post.slug)
    .sort((a, b) => (toSafeDate(b.createdAt) || 0) - (toSafeDate(a.createdAt) || 0))
    .slice(0, 6);

  const jsonLd = buildJsonLd(post, {
    canonicalUrl, title: titleRaw, desc, image, categoryLabel, categoryUrl,
    wordCount, publishedISO, updatedISO
  });

  const html = fillTemplate(articleTpl, {
    TITLE: title,
    META_DESCRIPTION: escapeHtml(desc),
    CANONICAL_URL: canonicalUrl,
    OG_IMAGE: escapeHtml(image),
    PUBLISHED_ISO: publishedISO,
    MODIFIED_ISO: updatedISO,
    CATEGORY_LABEL: escapeHtml(categoryLabel),
    CATEGORY_URL: categoryUrl,
    JSONLD: jsonLd,
    META_LINE: metaLine,
    CONTENT_HTML: content,
    SHARE_WHATSAPP_URL: `https://api.whatsapp.com/send?text=${shareText}${shareUrl}`,
    SHARE_FACEBOOK_URL: `https://www.facebook.com/sharer/sharer.php?u=${shareUrl}`,
    SHARE_TWITTER_URL: `https://twitter.com/intent/tweet?text=${shareText}&url=${shareUrl}`,
    RELATED_HTML: buildRelatedHtml(related),
    RELATED_SECTION_HIDDEN: related.length ? '' : ' style="display:none"',
    POST_ID: escapeHtml(post.id)
  });

  return { html, canonicalUrl, publishedISO, updatedISO };
}

function renderCategoryPage(category, posts, categoryTpl) {
  const label = CATEGORY_LABELS[category] || category;
  const canonicalUrl = `${SITE_URL}/categories/${category}/`;
  const sorted = posts.slice().sort((a, b) => (toSafeDate(b.createdAt) || 0) - (toSafeDate(a.createdAt) || 0));

  const cards = sorted.map(p => {
    const img = escapeHtml(p.image || `${SITE_URL}/logo.png`);
    const ttl = escapeHtml(p.title || 'Untitled');
    const desc = escapeHtml(stripHtml(p.content || '').substring(0, 110));
    const d = toSafeDate(p.createdAt);
    const dateStr = d ? formatDate(d.toISOString()) : '';
    return `    <a class="post-card" href="/posts/${encodeURIComponent(p.slug)}.html">
      <img src="${img}" alt="${ttl}" loading="lazy" onerror="this.style.display='none'">
      <div class="body">
        <div class="title">${ttl}</div>
        <div class="desc">${desc}</div>
        ${dateStr ? `<div class="date">${escapeHtml(dateStr)}</div>` : ''}
      </div>
    </a>`;
  }).join('\n');

  const jsonLd = JSON.stringify({
    '@context': 'https://schema.org',
    '@graph': [
      { '@type': 'BreadcrumbList', '@id': `${canonicalUrl}#breadcrumb`, itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Home', item: `${SITE_URL}/` },
        { '@type': 'ListItem', position: 2, name: label, item: canonicalUrl }
      ] },
      { '@type': 'CollectionPage', '@id': canonicalUrl, url: canonicalUrl, name: `${label} Facts & Articles`,
        description: `${sorted.length} ${label} articles on FactZone.`, inLanguage: 'hi',
        breadcrumb: { '@id': `${canonicalUrl}#breadcrumb` },
        isPartOf: { '@id': `${SITE_URL}/#website` } }
    ]
  }, null, 2);

  const html = fillTemplate(categoryTpl, {
    CATEGORY_LABEL: escapeHtml(label),
    META_DESCRIPTION: escapeHtml(`Read ${sorted.length} verified ${label} facts and articles on FactZone.`),
    CANONICAL_URL: canonicalUrl,
    JSONLD: jsonLd,
    POST_COUNT: String(sorted.length),
    POST_CARDS_HTML: cards || '    <p class="empty">No articles in this category yet.</p>'
  });

  const latest = sorted[0];
  const lastmodDate = latest ? toSafeDate(latest.createdAt) : null;
  return { html, canonicalUrl, lastmod: lastmodDate ? lastmodDate.toISOString().slice(0, 10) : null };
}

// ---------------------------------------------------------------------------
// Homepage crawlable-links injection (index.html, between the SSG markers only)
// ---------------------------------------------------------------------------
function updateHomepageLinks(posts) {
  const indexPath = path.join(ROOT, 'index.html');
  const raw = fs.readFileSync(indexPath); // read as Buffer - index.html uses CRLF line endings
  const text = raw.toString('utf8');

  const startMarker = '<!-- SSG:CRAWLABLE-LINKS:START (do not edit by hand between these two markers - generator owns this block) -->';
  const endMarker = '<!-- SSG:CRAWLABLE-LINKS:END -->';
  const startIdx = text.indexOf(startMarker);
  const endIdx = text.indexOf(endMarker);

  if (startIdx === -1 || endIdx === -1) {
    console.warn('WARNING: SSG:CRAWLABLE-LINKS markers not found in index.html - homepage links were NOT updated.');
    return;
  }

  const sorted = posts.slice().sort((a, b) => (toSafeDate(b.createdAt) || 0) - (toSafeDate(a.createdAt) || 0));
  const linksHtml = sorted.map(p => {
    const ttl = escapeHtml(p.title || 'Untitled');
    const desc = escapeHtml(stripHtml(p.content || '').substring(0, 140));
    const img = escapeHtml(p.image || `${SITE_URL}/logo.png`);
    return `    <a href="/posts/${encodeURIComponent(p.slug)}.html" data-category="${escapeHtml(p.category || '')}">\r\n` +
           `      <img src="${img}" alt="${ttl}" width="300" height="120">\r\n` +
           `      <h2>${ttl}</h2>\r\n` +
           `      <p>${desc}</p>\r\n` +
           `    </a>`;
  }).join('\r\n');

  const before = text.slice(0, startIdx + startMarker.length);
  const after = text.slice(endIdx);
  const updated = `${before}\r\n${linksHtml}\r\n  ${after}`;

  fs.writeFileSync(indexPath, updated, 'utf8');
  console.log(`index.html: injected ${sorted.length} crawlable article link(s) between the SSG markers.`);
}

// ---------------------------------------------------------------------------
// Sitemap
// ---------------------------------------------------------------------------
function buildSitemap(posts, categoryLastmods) {
  const today = new Date().toISOString().slice(0, 10);
  const entries = [];

  entries.push({ loc: `${SITE_URL}/`, lastmod: today, changefreq: 'daily', priority: '1.0' });
  entries.push({ loc: `${SITE_URL}/tools.html`, lastmod: today, changefreq: 'weekly', priority: '0.9' });

  CATEGORY_ORDER.forEach(cat => {
    entries.push({
      loc: `${SITE_URL}/categories/${cat}/`,
      lastmod: categoryLastmods[cat] || today,
      changefreq: 'daily',
      priority: '0.7'
    });
  });

  posts.forEach(p => {
    if (!p.slug) return;
    const d = toSafeDate(p.updatedAt) || toSafeDate(p.createdAt);
    entries.push({
      loc: `${SITE_URL}/posts/${encodeURIComponent(p.slug)}.html`,
      lastmod: d ? d.toISOString().slice(0, 10) : null,
      changefreq: 'monthly',
      priority: '0.6'
    });
  });

  const body = entries.map(e => {
    const lines = [`  <url>`, `    <loc>${e.loc}</loc>`];
    if (e.lastmod) lines.push(`    <lastmod>${e.lastmod}</lastmod>`);
    lines.push(`    <changefreq>${e.changefreq}</changefreq>`, `    <priority>${e.priority}</priority>`, `  </url>`);
    return lines.join('\n');
  }).join('\n\n');

  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n\n${body}\n\n</urlset>\n`;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  const { db, posts } = await loadPosts();
  console.log(`Loaded ${posts.length} post(s) from ${DRY_RUN_FIXTURE ? 'fixture' : 'Firestore'}.`);

  await backfillSlugs(db, posts);

  const usablePosts = posts.filter(p => p.slug);
  const skipped = posts.length - usablePosts.length;
  if (skipped > 0) console.warn(`WARNING: ${skipped} post(s) still have no slug and were skipped.`);

  const articleTpl = readTemplate('article.html');
  const categoryTpl = readTemplate('category.html');

  // 1. Article pages: posts/<slug>.html (flat file, no folder)
  const postsDir = path.join(ROOT, 'posts');
  fs.mkdirSync(postsDir, { recursive: true });
  let articleCount = 0;
  for (const post of usablePosts) {
    const { html } = renderArticle(post, usablePosts, articleTpl);
    const outPath = path.join(postsDir, `${post.slug}.html`);
    fs.writeFileSync(outPath, html, 'utf8');
    articleCount++;
  }
  console.log(`Generated ${articleCount} article page(s) in posts/<slug>.html`);

  // 2. Category pages: categories/<cat>/index.html
  const categoryLastmods = {};
  let categoryCount = 0;
  for (const cat of CATEGORY_ORDER) {
    const inCat = usablePosts.filter(p => p.category === cat);
    const { html, lastmod } = renderCategoryPage(cat, inCat, categoryTpl);
    if (lastmod) categoryLastmods[cat] = lastmod;
    const catDir = path.join(ROOT, 'categories', cat);
    fs.mkdirSync(catDir, { recursive: true });
    fs.writeFileSync(path.join(catDir, 'index.html'), html, 'utf8');
    categoryCount++;
  }
  console.log(`Generated ${categoryCount} category page(s) in categories/<cat>/index.html`);

  // 3. Homepage crawlable links
  updateHomepageLinks(usablePosts);

  // 4. Sitemap
  const sitemapXml = buildSitemap(usablePosts, categoryLastmods);
  fs.writeFileSync(path.join(ROOT, 'sitemap.xml'), sitemapXml, 'utf8');
  console.log(`sitemap.xml regenerated: ${usablePosts.length + CATEGORY_ORDER.length + 2} URLs.`);

  console.log('\nDone.');
}

main().catch(err => {
  console.error('Generator failed:', err);
  process.exit(1);
});
