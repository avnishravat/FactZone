#!/usr/bin/env node
/**
 * Restore deleted posts into Firestore from their static pages.
 * -------------------------------------------------------------------------
 * The generator only ever writes pages for posts that exist in Firestore and
 * never deletes anything, so when a post is removed from Firestore its page
 * stays behind in posts/ (an "orphan"). This script finds those orphans and
 * re-creates the Firestore document from the page itself:
 *
 *   id         <- the POST_ID embedded in the page's script (original doc ID,
 *                 so existing comments / likes keyed by it reconnect)
 *   slug       <- the file name (URL stays exactly the same)
 *   title      <- the page's <h1>
 *   content    <- the article body HTML as published (already sanitised)
 *   category   <- article:section
 *   createdAt  <- article:published_time  (epoch ms, same type as admin writes)
 *   updatedAt  <- article:modified_time, only when it differs from published
 *   image      <- og:image (empty again if it was only the logo fallback)
 *   desc       <- the page's meta description (the original `desc` text is not
 *                 stored in the static page, so this derived text is used)
 *
 * Safety:
 *   - DRY RUN by default. Nothing is written unless --apply is passed.
 *   - Only CREATES documents. Uses batch.create(), which fails instead of
 *     overwriting, and skips any page whose ID or slug already exists.
 *   - Never deletes or edits any existing document.
 *   - Refuses to run if Firestore returns 0 posts (wrong project/credentials).
 *
 * Usage:
 *   node scripts/restore-from-static.js            # dry run
 *   node scripts/restore-from-static.js --apply    # actually restore
 * Needs FIREBASE_SERVICE_ACCOUNT_FACTZONE (same secret the generator uses).
 * -------------------------------------------------------------------------
 */

const fs = require('fs');
const path = require('path');

const SITE_URL = 'https://factzone.online';

const LABEL_TO_CATEGORY = {
  'Science / विज्ञान': 'science',
  'Tech / तकनीक': 'tech',
  'History / इतिहास': 'history',
  'Mystery / रहस्य': 'mystery',
  'Viral / रोचक तथ्य': 'viral'
};
const VALID_CATEGORIES = new Set(Object.values(LABEL_TO_CATEGORY));

function decodeEntities(s) {
  // &amp; last so "&amp;lt;" correctly becomes the literal text "&lt;"
  return String(s)
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
}

/** Rebuild a Firestore post ({ id, data }) from one generated article page. Throws if anything essential is missing. */
function extractPostFromHtml(html, slug) {
  const grab = (re) => { const m = html.match(re); return m ? m[1] : null; };

  const idRaw = grab(/var POST_ID\s*=\s*"([^"]+)"/);
  const titleRaw = grab(/<h1 itemprop="headline">([\s\S]*?)<\/h1>/);
  const contentRaw = grab(/<div class="content" itemprop="articleBody">([\s\S]*?)<\/div>\s*<div class="reaction-bar">/);
  const sectionRaw = grab(/property="article:section"\s+content="([^"]*)"/);
  const publishedRaw = grab(/property="article:published_time"\s+content="([^"]*)"/);
  const modifiedRaw = grab(/property="article:modified_time"\s+content="([^"]*)"/);
  const imageRaw = grab(/property="og:image"\s+content="([^"]*)"/);
  const descRaw = grab(/<meta name="description" content="([^"]*)">/);

  const missing = [];
  if (!idRaw) missing.push('POST_ID');
  if (!titleRaw) missing.push('title');
  if (contentRaw === null) missing.push('content');
  if (!sectionRaw) missing.push('category');
  if (!publishedRaw) missing.push('published date');
  if (missing.length) throw new Error('could not find: ' + missing.join(', '));

  const id = decodeEntities(idRaw);
  if (id.includes('/') || id.length < 3) throw new Error(`implausible document ID "${id}"`);

  // Kept exactly as published (no trimming) so the restored post re-renders to the identical page.
  const title = decodeEntities(titleRaw);
  const content = contentRaw;
  if (!title.trim()) throw new Error('empty title');
  if (!content.trim()) throw new Error('empty content');

  const category = LABEL_TO_CATEGORY[decodeEntities(sectionRaw)];
  if (!category || !VALID_CATEGORIES.has(category)) throw new Error(`unknown category label "${decodeEntities(sectionRaw)}"`);

  const createdAt = Date.parse(publishedRaw);
  if (isNaN(createdAt)) throw new Error(`bad published date "${publishedRaw}"`);

  let image = imageRaw ? decodeEntities(imageRaw) : '';
  if (image === `${SITE_URL}/logo.png`) image = ''; // generator's fallback when a post had no image

  const data = {
    title,
    desc: descRaw ? decodeEntities(descRaw) : '',
    image,
    content,
    category,
    slug,
    createdAt
  };
  if (modifiedRaw && modifiedRaw !== publishedRaw) {
    const updatedAt = Date.parse(modifiedRaw);
    if (!isNaN(updatedAt)) data.updatedAt = updatedAt;
  }
  return { id, data };
}

const nfc = (s) => String(s).normalize('NFC');

/** Find orphaned pages and (when apply is true) re-create their Firestore documents. `db` is a firebase-admin Firestore. */
async function run({ db, apply, postsDir, log = console.log }) {
  const snap = await db.collection('posts').get();
  const existingIds = new Set();
  const existingSlugs = new Set();
  snap.forEach((d) => {
    existingIds.add(d.id);
    const s = d.data().slug;
    if (s) existingSlugs.add(nfc(s));
  });
  if (existingIds.size === 0) {
    throw new Error('Firestore returned 0 posts - refusing to run (wrong project or credentials?).');
  }
  log(`Firestore currently has ${existingIds.size} post(s).`);

  const files = fs.readdirSync(postsDir).filter((f) => f.endsWith('.html')).sort();
  const orphans = files.filter((f) => !existingSlugs.has(nfc(f.slice(0, -5))));
  log(`posts/ has ${files.length} page(s); ${orphans.length} have no matching post in Firestore.\n`);

  const toRestore = [];
  const skipped = [];
  const seenIds = new Set();
  for (const f of orphans) {
    const slug = f.slice(0, -5);
    try {
      const html = fs.readFileSync(path.join(postsDir, f), 'utf8');
      const post = extractPostFromHtml(html, slug);
      if (existingIds.has(post.id)) throw new Error(`document ID ${post.id} already exists in Firestore - not overwriting`);
      if (seenIds.has(post.id)) throw new Error(`document ID ${post.id} appears on more than one page`);
      seenIds.add(post.id);
      toRestore.push(post);
    } catch (err) {
      skipped.push({ slug, reason: err.message });
    }
  }

  log(`Can restore ${toRestore.length}:`);
  toRestore.forEach((p) => {
    log(`  + ${p.id}  [${p.data.category}]  ${new Date(p.data.createdAt).toISOString().slice(0, 10)}  ${p.data.slug}`);
  });
  if (skipped.length) {
    log(`\nSkipped ${skipped.length}:`);
    skipped.forEach((s) => log(`  ! ${s.slug}  ->  ${s.reason}`));
  }

  if (!apply) {
    log('\nDRY RUN - nothing was written to Firestore. Run again with --apply (tick "apply" in the workflow) to restore.');
    return { restored: 0, wouldRestore: toRestore.length, skipped };
  }
  if (!toRestore.length) {
    log('\nNothing to restore.');
    return { restored: 0, wouldRestore: 0, skipped };
  }

  const CHUNK = 400; // Firestore batch limit is 500 operations
  let restored = 0;
  for (let i = 0; i < toRestore.length; i += CHUNK) {
    const batch = db.batch();
    toRestore.slice(i, i + CHUNK).forEach((p) => batch.create(db.collection('posts').doc(p.id), p.data));
    await batch.commit();
    restored += Math.min(CHUNK, toRestore.length - i);
  }
  log(`\nRestored ${restored} post(s) to Firestore. Existing documents were not touched.`);
  return { restored, wouldRestore: toRestore.length, skipped };
}

module.exports = { extractPostFromHtml, run, LABEL_TO_CATEGORY };

if (require.main === module) {
  (async () => {
    const apply = process.argv.includes('--apply');
    const rawCred = process.env.FIREBASE_SERVICE_ACCOUNT_FACTZONE;
    if (!rawCred) throw new Error('FIREBASE_SERVICE_ACCOUNT_FACTZONE env var is not set.');
    const admin = require('firebase-admin');
    admin.initializeApp({ credential: admin.credential.cert(JSON.parse(rawCred)) });
    await run({ db: admin.firestore(), apply, postsDir: path.join(__dirname, '..', 'posts') });
  })().catch((err) => {
    console.error('Restore failed:', err.message);
    process.exit(1);
  });
}
