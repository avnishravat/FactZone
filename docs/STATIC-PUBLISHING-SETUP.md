# FactZone automatic static publishing setup

This branch keeps the blog pages as static HTML and adds an event trigger so a
post create, edit, or delete in the existing Firestore-backed Admin requests a
GitHub Actions build. The GitHub token is stored only in Firebase Secret
Manager; it must never be added to `admin.html`, other browser JavaScript, or
a public repository file.

## One-time setup after reviewing and merging this branch

1. Create a fine-grained GitHub personal access token for only
   `avnishravat/FactZone`, with **Contents: Read and write** permission.
   This permission is needed by GitHub's repository-dispatch API.
2. From a trusted terminal with Firebase CLI installed and access to the
   `factzone-a9ace` project, set the secret. Paste the token only into the
   terminal prompt:
   ```sh
   firebase functions:secrets:set GITHUB_DISPATCH_TOKEN --project factzone-a9ace
   ```
3. Deploy the Firestore trigger:
   ```sh
   firebase deploy --only functions:regenerateStaticPosts --project factzone-a9ace
   ```
4. Open GitHub Actions and verify **Generate static article pages** can run.
   Then publish a test post from Admin and confirm the workflow runs and
   generates `posts/<slug>.html`, category pages, sitemap, and homepage links.
5. Keep the scheduled/manual generator as a fallback until event-driven
   publishing has been confirmed. After verification, the six-hour schedule
   can be removed if desired.

## Important

- Deploying Cloud Functions may require the Firebase project to use the
  Blaze billing plan and have the required Google Cloud APIs enabled.
- The generator still reads the existing Firestore collection server-side.
  The public website serves generated HTML and does not need to load article
  content from Firestore at page view time.
- Existing article URLs keep the `.html` suffix.
- Generated output is committed by GitHub Actions. The incremental writer
  leaves unchanged files untouched, although category pages, sitemap, and
  homepage link blocks may update when a post changes.
- Do not merge/deploy until the branch's Actions checks pass and the current
  site UI has been reviewed.
