const { google } = require('googleapis');

async function main() {
  const keySecret = process.env.INDEXING_KEY;
  if (!keySecret) {
    console.error('INDEXING_KEY secret missing!');
    process.exit(1);
  }

  // Parse secret
  const key = JSON.parse(keySecret);

  // JWT Client Initialize
  const client = new google.auth.JWT({
    email: key.client_email,
    key: key.private_key,
    scopes: ['https://www.googleapis.com/auth/indexing'],
  });

  await client.authorize();

  // 1. Sitemap se URLs Fetch karein
  const sitemapUrl = 'https://factzone.online/sitemap.xml';
  console.log(`Fetching sitemap from: ${sitemapUrl}`);

  let urls = [];
  try {
    const res = await fetch(sitemapUrl);
    if (!res.ok) {
      throw new Error(`Failed to fetch sitemap: ${res.statusText}`);
    }
    const xmlText = await res.text();

    // XML se saare <loc> URLs extract karein
    const matches = [...xmlText.matchAll(/<loc>(.*?)<\/loc>/g)];
    urls = Array.from(new Set(matches.map(m => m[1].trim())));
    console.log(`Found ${urls.length} URLs in sitemap.`);
  } catch (err) {
    console.error('Error fetching sitemap:', err.message);
    process.exit(1);
  }

  if (urls.length === 0) {
    console.log('No URLs found in sitemap.');
    return;
  }

  // 2. Loop karke har URL ko Indexing API me submit karein
  for (const targetUrl of urls) {
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
