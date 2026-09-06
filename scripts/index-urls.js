const { google } = require('googleapis');

async function main() {
  const keySecret = process.env.INDEXING_KEY;
  if (!keySecret) {
    console.error('INDEXING_KEY secret missing!');
    process.exit(1);
  }

  // Parse secret
  const key = JSON.parse(keySecret);

  // Initialize JWT client using options object syntax
  const client = new google.auth.JWT({
    email: key.client_email,
    key: key.private_key,
    scopes: ['https://www.googleapis.com/auth/indexing'],
  });

  await client.authorize();

  const targetUrl = 'https://factzone.online/';

  try {
    const response = await client.request({
      url: 'https://indexing.googleapis.com/v3/urlNotifications:publish',
      method: 'POST',
      data: {
        url: targetUrl,
        type: 'URL_UPDATED',
      },
    });
    console.log('Successfully submitted for indexing:', response.data);
  } catch (err) {
    console.error('Error submitting URL:', err.response ? err.response.data : err.message);
    process.exit(1);
  }
}

main();
