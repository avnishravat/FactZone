```javascript
// ---------------------------------------------------------------------------
// Sitemap - APPEND ONLY
// ---------------------------------------------------------------------------
// IMPORTANT:
// - Existing sitemap URLs are NEVER regenerated.
// - Existing <lastmod>, <changefreq>, and <priority> are NEVER changed.
// - Existing homepage and tools.html dates are preserved exactly as they are.
// - Only URLs that do not already exist in sitemap.xml are added.
// - New article URLs use createdAt as <lastmod>.
// - Existing article URLs are NOT affected by updatedAt changes.
// - Existing category URLs are NOT affected by category changes.
// ---------------------------------------------------------------------------

function escapeXml(str) {
  return String(str == null ? '' : str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function buildSitemapEntry({
  loc,
  lastmod = null,
  changefreq = null,
  priority = null
}) {
  const lines = [
    '  <url>',
    `    <loc>${escapeXml(loc)}</loc>`
  ];

  if (lastmod) {
    lines.push(`    <lastmod>${escapeXml(lastmod)}</lastmod>`);
  }

  if (changefreq) {
    lines.push(`    <changefreq>${escapeXml(changefreq)}</changefreq>`);
  }

  if (priority) {
    lines.push(`    <priority>${escapeXml(priority)}</priority>`);
  }

  lines.push('  </url>');

  return lines.join('\n');
}

function extractSitemapUrls(xml) {
  const urls = new Set();

  if (!xml) return urls;

  const locRegex = /<loc>\s*([^<]+?)\s*<\/loc>/gi;

  let match;

  while ((match = locRegex.exec(xml)) !== null) {
    const loc = match[1].trim();

    if (loc) {
      urls.add(loc);
    }
  }

  return urls;
}

function buildSitemap(posts, categoryLastmods) {
  const sitemapPath = path.join(ROOT, 'sitemap.xml');

  // -------------------------------------------------------------------------
  // FIRST RUN
  // -------------------------------------------------------------------------
  // If sitemap.xml does not exist, create it normally.
  // -------------------------------------------------------------------------

  if (!fs.existsSync(sitemapPath)) {
    const entries = [];

    // Homepage.
    // IMPORTANT: No automatic current-date <lastmod>.
    entries.push(
      buildSitemapEntry({
        loc: `${SITE_URL}/`,
        lastmod: null,
        changefreq: 'daily',
        priority: '1.0'
      })
    );

    // Tools page.
    // IMPORTANT: No automatic current-date <lastmod>.
    entries.push(
      buildSitemapEntry({
        loc: `${SITE_URL}/tools.html`,
        lastmod: null,
        changefreq: 'weekly',
        priority: '0.9'
      })
    );

    // Categories.
    CATEGORY_ORDER.forEach(cat => {
      entries.push(
        buildSitemapEntry({
          loc: `${SITE_URL}/categories/${cat}/`,
          lastmod: categoryLastmods[cat] || null,
          changefreq: 'daily',
          priority: '0.7'
        })
      );
    });

    // Articles.
    posts.forEach(post => {
      if (!post.slug) return;

      const createdDate = toSafeDate(post.createdAt);

      const lastmod = createdDate
        ? createdDate.toISOString().slice(0, 10)
        : null;

      entries.push(
        buildSitemapEntry({
          loc: `${SITE_URL}/posts/${encodeURIComponent(post.slug)}.html`,
          lastmod,
          changefreq: 'monthly',
          priority: '0.6'
        })
      );
    });

    const sitemapXml =
      `<?xml version="1.0" encoding="UTF-8"?>\n` +
      `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n\n` +
      entries.join('\n\n') +
      `\n\n</urlset>\n`;

    fs.writeFileSync(
      sitemapPath,
      sitemapXml,
      'utf8'
    );

    console.log(
      `sitemap.xml created: ${entries.length} URLs.`
    );

    return;
  }

  // -------------------------------------------------------------------------
  // EXISTING SITEMAP
  // -------------------------------------------------------------------------
  // From this point onward:
  //
  // EXISTING CONTENT IS NEVER REGENERATED.
  //
  // This means:
  //
  // homepage old date       -> preserved
  // tools.html old date     -> preserved
  // old category dates      -> preserved
  // old article dates       -> preserved
  // old changefreq          -> preserved
  // old priority            -> preserved
  // -------------------------------------------------------------------------

  const existingXml = fs.readFileSync(
    sitemapPath,
    'utf8'
  );

  const existingUrls =
    extractSitemapUrls(existingXml);

  const newEntries = [];

  function addIfMissing({
    loc,
    lastmod = null,
    changefreq = null,
    priority = null
  }) {
    // Existing URL:
    // DO NOTHING.
    //
    // This is what protects old homepage/tools/article/category dates.
    if (existingUrls.has(loc)) {
      return;
    }

    const entry = buildSitemapEntry({
      loc,
      lastmod,
      changefreq,
      priority
    });

    newEntries.push(entry);

    // Prevent duplicate addition during this same run.
    existingUrls.add(loc);
  }

  // -------------------------------------------------------------------------
  // Homepage
  // -------------------------------------------------------------------------
  //
  // If homepage already exists:
  //   NOTHING happens.
  //
  // If homepage does not exist:
  //   It is added WITHOUT <lastmod>.
  //
  addIfMissing({
    loc: `${SITE_URL}/`,
    lastmod: null,
    changefreq: 'daily',
    priority: '1.0'
  });

  // -------------------------------------------------------------------------
  // Tools page
  // -------------------------------------------------------------------------
  //
  // Existing tools.html entry is preserved exactly.
  //
  // If missing, it is added WITHOUT <lastmod>.
  //
  addIfMissing({
    loc: `${SITE_URL}/tools.html`,
    lastmod: null,
    changefreq: 'weekly',
    priority: '0.9'
  });

  // -------------------------------------------------------------------------
  // Categories
  // -------------------------------------------------------------------------
  CATEGORY_ORDER.forEach(cat => {
    addIfMissing({
      loc: `${SITE_URL}/categories/${cat}/`,
      lastmod: categoryLastmods[cat] || null,
      changefreq: 'daily',
      priority: '0.7'
    });
  });

  // -------------------------------------------------------------------------
  // Articles
  // -------------------------------------------------------------------------
  //
  // IMPORTANT:
  // For NEW article URLs only, use createdAt.
  //
  // updatedAt is deliberately NOT used here.
  //
  posts.forEach(post => {
    if (!post.slug) return;

    const loc =
      `${SITE_URL}/posts/${encodeURIComponent(post.slug)}.html`;

    const createdDate =
      toSafeDate(post.createdAt);

    const lastmod =
      createdDate
        ? createdDate.toISOString().slice(0, 10)
        : null;

    addIfMissing({
      loc,
      lastmod,
      changefreq: 'monthly',
      priority: '0.6'
    });
  });

  // -------------------------------------------------------------------------
  // Nothing new
  // -------------------------------------------------------------------------
  //
  // IMPORTANT:
  // Do not even rewrite sitemap.xml.
  //
  // This means the existing file remains byte-for-byte unchanged.
  // -------------------------------------------------------------------------

  if (newEntries.length === 0) {
    console.log(
      'sitemap.xml: no new URLs. Existing sitemap was NOT modified.'
    );

    return;
  }

  // -------------------------------------------------------------------------
  // Add ONLY new entries before </urlset>
  // -------------------------------------------------------------------------

  const closingTag = '</urlset>';

  const closingIndex =
    existingXml.lastIndexOf(closingTag);

  if (closingIndex === -1) {
    throw new Error(
      'Existing sitemap.xml is invalid: </urlset> closing tag not found.'
    );
  }

  const before =
    existingXml.slice(0, closingIndex);

  const after =
    existingXml.slice(closingIndex);

  const separator =
    before.endsWith('\n')
      ? ''
      : '\n';

  const updatedXml =
    before +
    separator +
    '\n' +
    newEntries.join('\n\n') +
    '\n\n' +
    after;

  fs.writeFileSync(
    sitemapPath,
    updatedXml,
    'utf8'
  );

  console.log(
    `sitemap.xml: added ${newEntries.length} new URL(s).`
  );

  console.log(
    'sitemap.xml: all existing URLs and metadata were preserved.'
  );
}
```
