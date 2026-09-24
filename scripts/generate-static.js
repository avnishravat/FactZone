// ---------------------------------------------------------------------------
// Sitemap - APPEND ONLY
// ---------------------------------------------------------------------------
// IMPORTANT:
// - Existing sitemap URLs are NEVER regenerated.
// - Existing <lastmod>, <changefreq>, and <priority> are NEVER changed.
// - Existing homepage/tools/category/article entries are preserved exactly.
// - Only missing/new URLs are appended.
// - New article URLs use createdAt for <lastmod>.
// - updatedAt is NEVER used for sitemap article <lastmod>.
// - If createdAt is missing, <lastmod> is omitted.
// - If there are no new URLs, sitemap.xml is NOT rewritten.
// ---------------------------------------------------------------------------

function escapeXml(value) {
  return String(value == null ? '' : value)
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

  if (!xml) {
    return urls;
  }

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

  // =========================================================================
  // FIRST RUN
  // =========================================================================

  if (!fs.existsSync(sitemapPath)) {
    const entries = [];

    // -----------------------------------------------------------------------
    // Homepage
    // -----------------------------------------------------------------------
    // No fake/current-date lastmod.
    entries.push(
      buildSitemapEntry({
        loc: `${SITE_URL}/`,
        changefreq: 'daily',
        priority: '1.0'
      })
    );

    // -----------------------------------------------------------------------
    // Tools
    // -----------------------------------------------------------------------
    // No fake/current-date lastmod.
    entries.push(
      buildSitemapEntry({
        loc: `${SITE_URL}/tools.html`,
        changefreq: 'weekly',
        priority: '0.9'
      })
    );

    // -----------------------------------------------------------------------
    // Categories
    // -----------------------------------------------------------------------

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

    // -----------------------------------------------------------------------
    // Articles
    // -----------------------------------------------------------------------
    // IMPORTANT:
    // New article sitemap lastmod = createdAt ONLY.
    // updatedAt is intentionally ignored.
    // -----------------------------------------------------------------------

    posts.forEach(post => {
      if (!post.slug) {
        return;
      }

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

  // =========================================================================
  // EXISTING SITEMAP
  // =========================================================================

  const existingXml = fs.readFileSync(
    sitemapPath,
    'utf8'
  );

  const existingUrls = extractSitemapUrls(existingXml);

  const newEntries = [];

  // -------------------------------------------------------------------------
  // Add only if URL does not already exist
  // -------------------------------------------------------------------------

  function addIfMissing({
    loc,
    lastmod = null,
    changefreq = null,
    priority = null
  }) {
    // IMPORTANT:
    // Existing URL = DO NOTHING.
    //
    // This preserves ALL existing sitemap metadata exactly as it is.
    if (existingUrls.has(loc)) {
      return;
    }

    newEntries.push(
      buildSitemapEntry({
        loc,
        lastmod,
        changefreq,
        priority
      })
    );

    // Prevent duplicate URLs during this same generator run.
    existingUrls.add(loc);
  }

  // =========================================================================
  // Homepage
  // =========================================================================

  addIfMissing({
    loc: `${SITE_URL}/`,
    lastmod: null,
    changefreq: 'daily',
    priority: '1.0'
  });

  // =========================================================================
  // Tools
  // =========================================================================

  addIfMissing({
    loc: `${SITE_URL}/tools.html`,
    lastmod: null,
    changefreq: 'weekly',
    priority: '0.9'
  });

  // =========================================================================
  // Categories
  // =========================================================================

  CATEGORY_ORDER.forEach(cat => {
    addIfMissing({
      loc: `${SITE_URL}/categories/${cat}/`,
      lastmod: categoryLastmods[cat] || null,
      changefreq: 'daily',
      priority: '0.7'
    });
  });

  // =========================================================================
  // Articles
  // =========================================================================

  posts.forEach(post => {
    if (!post.slug) {
      return;
    }

    const loc =
      `${SITE_URL}/posts/${encodeURIComponent(post.slug)}.html`;

    // IMPORTANT:
    // Only createdAt is used for a NEW sitemap URL.
    //
    // updatedAt is NOT used.
    const createdDate = toSafeDate(post.createdAt);

    const lastmod = createdDate
      ? createdDate.toISOString().slice(0, 10)
      : null;

    addIfMissing({
      loc,
      lastmod,
      changefreq: 'monthly',
      priority: '0.6'
    });
  });

  // =========================================================================
  // Nothing new
  // =========================================================================

  if (newEntries.length === 0) {
    console.log(
      'sitemap.xml: no new URLs. Existing sitemap was NOT modified.'
    );

    return;
  }

  // =========================================================================
  // Append new entries before </urlset>
  // =========================================================================

  const closingTag = '</urlset>';

  const closingIndex = existingXml.lastIndexOf(closingTag);

  if (closingIndex === -1) {
    throw new Error(
      'Existing sitemap.xml is invalid: </urlset> closing tag not found.'
    );
  }

  const before = existingXml.slice(
    0,
    closingIndex
  );

  const after = existingXml.slice(
    closingIndex
  );

  const newBlock =
    newEntries.join('\n\n');

  let updatedXml;

  if (before.endsWith('\n')) {
    updatedXml =
      before +
      '\n' +
      newBlock +
      '\n\n' +
      after;
  } else {
    updatedXml =
      before +
      '\n\n' +
      newBlock +
      '\n\n' +
      after;
  }

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
