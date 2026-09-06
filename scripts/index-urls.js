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

  console.log(`Fetching sitemap: ${sitemapUrl}`);

  let urlsToSubmit = [];

  try {
    const res = await fetch(sitemapUrl);

    if (!res.ok) {
      throw new Error(`Failed to fetch sitemap: ${res.status} ${res.statusText}`);
    }

    const xmlText = await res.text();

    const urlBlocks =
      xmlText.match(/<url>[\s\S]*?<\/url>/gi) || [];

    console.log(`Total URLs found in sitemap: ${urlBlocks.length}`);

    const now = Date.now();

    // 36 hours
    const THIRTY_SIX_HOURS = 36 * 60 * 60 * 1000;

    for (const block of urlBlocks) {
      const locMatch = block.match(/<loc>(.*?)<\/loc>/i);
      const lastmodMatch = block.match(/<lastmod>(.*?)<\/lastmod>/i);

      if (!locMatch) {
        continue;
      }

      const url = locMatch[1].trim();

      if (!lastmodMatch) {
        console.warn(`[NO LASTMOD] ${url}`);
        continue;
      }

      const lastmodText = lastmodMatch[1].trim();
      const lastmodDate = new Date(lastmodText).getTime();

      if (Number.isNaN(lastmodDate)) {
        console.warn(`[INVALID LASTMOD] ${url} -> ${lastmodText}`);
        continue;
      }

      const age = now - lastmodDate;

      // Future date protection
      if (age < 0) {
        console.warn(`[FUTURE LASTMOD] ${url}`);
        continue;
      }

      // Only recently updated URLs
      if (age <= THIRTY_SIX_HOURS) {
        urlsToSubmit.push({
          url,
          lastmod: lastmodText,
        });
      }
    }

    console.log(
      `Recently updated URLs: ${urlsToSubmit.length}`
    );

  } catch (err) {
    console.error('Error fetching sitemap:', err.message);
    process.exit(1);
  }

  if (urlsToSubmit.length === 0) {
    console.log(
      'No URLs updated in the last 36 hours. Nothing to submit.'
    );
    return;
  }

  /*
   * Google Indexing API safety limit.
   * Maximum 10 URLs per workflow run.
   */
  const MAX_LIMIT = 10;

  /*
   * Submit the newest URLs first.
   */
  urlsToSubmit.sort((a, b) => {
    return (
      new Date(b.lastmod).getTime() -
      new Date(a.lastmod).getTime()
    );
  });

  const batch = urlsToSubmit.slice(0, MAX_LIMIT);

  console.log(
    `Submitting ${batch.length} of ${urlsToSubmit.length} eligible URLs...`
  );

  let successCount = 0;
  let errorCount = 0;

  for (const item of batch) {
    try {
      const response = await client.request({
        url: 'https://indexing.googleapis.com/v3/urlNotifications:publish',
        method: 'POST',
        data: {
          url: item.url,
          type: 'URL_UPDATED',
        },
      });

      console.log(`[SUCCESS] ${item.url}`);
      successCount++;

    } catch (err) {
      errorCount++;

      console.error(
        `[ERROR] ${item.url}`,
        err.response?.data || err.message
      );
    }
  }

  console.log('--------------------------------');
  console.log('Google Indexing Run Complete');
  console.log(`Eligible URLs : ${urlsToSubmit.length}`);
  console.log(`Submitted     : ${batch.length}`);
  console.log(`Successful    : ${successCount}`);
  console.log(`Failed        : ${errorCount}`);
  console.log('--------------------------------');
}

main();
