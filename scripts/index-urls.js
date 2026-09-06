const { google } = require('googleapis');

async function main() {
  const keySecret = process.env.INDEXING_KEY;
  if (!keySecret) {
    console.error('INDEXING_KEY secret missing!');
    process.exit(1);
  }

  const key = JSON.parse(keySecret);

  const client = new google.auth.JWT({
    email: key.client_email,
    key: key.private_key,
    scopes: ['https://www.googleapis.com/auth/indexing'],
  });

  await client.authorize();

  const sitemapUrl = 'https://factzone.online/sitemap.xml';
  console.log(`Fetching sitemap from: ${sitemapUrl}`);

  let urlsToSubmit = [];
  try {
    const res = await fetch(sitemapUrl);
    if (!res.ok) throw new Error(`Failed to fetch sitemap: ${res.statusText}`);
    const xmlText = await res.text();

    const urlBlocks = xmlText.match(/<url>[\s\S]*?<\/url>/gi) || [];
    const now = Date.now();
    const THIRTY_SIX_HOURS = 36 * 60 * 60 * 1000;

    let missingLastModCount = 0;

    for (const block of urlBlocks) {
      const locMatch = block.match(/<loc>(.*?)<\/loc>/i);
      const lastmodMatch = block.match(/<lastmod>(.*?)<\/lastmod>/i);

      if (locMatch) {
        const url = locMatch[1].trim();

        if (lastmodMatch) {
          const lastmodDate = new Date(lastmodMatch[1].trim()).getTime();
          // Check if updated in the last 36 hours
          if (now - lastmodDate <= THIRTY_SIX_HOURS) {
            urlsToSubmit.push(url);
          }
        } else {
          missingLastModCount++;
        }
      }
    }

    console.log(`Found ${urlsToSubmit.length} URLs updated in the last 36 hours.`);
    if (missingLastModCount > 0) {
      console.warn(`[WARNING] ${missingLastModCount} URLs in sitemap are missing <lastmod> tags! Please add <lastmod> to your sitemap.`);
    }
  } catch (err) {
    console.error('Error fetching sitemap:', err.message);
    process.exit(1);
  }

  if (urlsToSubmit.length === 0) {
    console.log('No new or updated URLs found in the last 36 hours. Skipping submission.');
    return;
  }

  // Safety cap: Max 10 submissions per run
  const MAX_LIMIT = 10;
  if (urlsToSubmit.length > MAX_LIMIT) {
    console.warn(`[SAFETY TRIGGERED] Capping submissions to ${MAX_LIMIT} URLs.`);
    urlsToSubmit = urlsToSubmit.slice(0, MAX_LIMIT);
  }

  for (const targetUrl of urlsToSubmit) {
    try {
      const response = await client.request({
        url: 'https://indexing.googleapis.com/v3/urlNotifications:publish',
        method: 'POST',
        data: {
          url: targetUrl,
          type: 'URL_UPDATED',
        },
      });
      console.log(`[SUCCESS] Submitted: ${targetUrl}`);
    } catch (err) {
      console.error(`[ERROR] Failed for ${targetUrl}:`, err.response ? err.response.data : err.message);
    }
  }
}

main();
