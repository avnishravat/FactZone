const { google } = require('googleapis');

async function main() {
  const keySecret = process.env.INDEXING_KEY;
  if (!keySecret) {
    console.error('INDEXING_KEY secret missing!');
    process.exit(1);
  }

  // Secret parse karein
  const key = JSON.parse(keySecret);

  // Private key me newlines (\n) fix karein
  const privateKey = key.private_key.replace(/\\n/g, '\n');

  const client = new google.auth.JWT(
    key.client_email,
    null,
    privateKey,
    ['https://www.googleapis.com/auth/indexing'],
    null
  );

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
    console.log('Successfully submitted:', response.data);
  } catch (err) {
    console.error('Error submitting URL:', err.response ? err.response.data : err.message);
    process.exit(1);
  }
}

main();
