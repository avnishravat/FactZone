const { onDocumentWritten } = require("firebase-functions/v2/firestore");
const { defineSecret } = require("firebase-functions/params");
const logger = require("firebase-functions/logger");

const GITHUB_DISPATCH_TOKEN = defineSecret("GITHUB_DISPATCH_TOKEN");
const REPOSITORY = "avnishravat/FactZone";

/**
 * Trigger static-page generation whenever a blog post is created, edited,
 * or deleted. The GitHub token stays in Firebase Secret Manager and is never
 * exposed to admin.html or a visitor's browser.
 *
 * Configure once before deployment:
 *   firebase functions:secrets:set GITHUB_DISPATCH_TOKEN
 * The token needs repository Contents: write permission for repository_dispatch.
 */
exports.regenerateStaticPosts = onDocumentWritten(
  {
    document: "posts/{postId}",
    secrets: [GITHUB_DISPATCH_TOKEN],
    retry: true
  },
  async (event) => {
    const before = event.data && event.data.before && event.data.before.exists
      ? event.data.before.data()
      : null;
    const after = event.data && event.data.after && event.data.after.exists
      ? event.data.after.data()
      : null;

    // Ignore no-op writes. A create or delete always counts as a change.
    if (before && after && JSON.stringify(before) === JSON.stringify(after)) {
      logger.info("Post data unchanged; skipping static generation", {
        postId: event.params.postId
      });
      return;
    }

    const token = GITHUB_DISPATCH_TOKEN.value();
    if (!token) throw new Error("GITHUB_DISPATCH_TOKEN secret is empty");

    const response = await fetch(
      `https://api.github.com/repos/${REPOSITORY}/dispatches`,
      {
        method: "POST",
        headers: {
          "Accept": "application/vnd.github+json",
          "Authorization": `Bearer ${token}`,
          "X-GitHub-Api-Version": "2022-11-28",
          "Content-Type": "application/json",
          "User-Agent": "FactZone-static-publisher"
        },
        body: JSON.stringify({
          event_type: "factzone-post-changed",
          client_payload: {
            postId: String(event.params.postId),
            action: !before ? "created" : !after ? "deleted" : "updated"
          }
        })
      }
    );

    if (!response.ok) {
      const details = await response.text();
      logger.error("GitHub static-generation dispatch failed", {
        status: response.status,
        details
      });
      throw new Error(`GitHub dispatch failed with HTTP ${response.status}`);
    }

    logger.info("Static generation requested", {
      postId: event.params.postId,
      action: !before ? "created" : !after ? "deleted" : "updated"
    });
  }
);
