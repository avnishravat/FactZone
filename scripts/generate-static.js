const fs = require('fs');
const path = require('path');
const sanitizeHtml = require('sanitize-html');

const postsDir = path.join(__dirname, '../data/posts');
const outputPostsDir = path.join(__dirname, '../posts');
const indexHtmlPath = path.join(__dirname, '../index.html');
const postsIndexJsonPath = path.join(__dirname, '../posts-index.json');

if (!fs.existsSync(outputPostsDir)) {
    fs.mkdirSync(outputPostsDir, { recursive: true });
}

function stripTags(html) {
    return sanitizeHtml(html || '', { allowedTags: [], allowedAttributes: {} });
}

function formatDate(dateString) {
    if (!dateString) return '';
    const date = new Date(dateString);
    return date.toLocaleDateString('hi-IN', {
        day: 'numeric',
        month: 'short',
        year: 'numeric'
    });
}

function generatePostPage(post) {
    const title = post.title || 'Untitled';
    const slug = post.slug;
    const date = post.date || new Date().toISOString();
    const formattedDate = formatDate(date);
    const category = post.category || 'General';
    const cleanContent = sanitizeHtml(post.content || '', {
        allowedTags: sanitizeHtml.defaults.allowedTags.concat(['img', 'iframe', 'h1', 'h2']),
        allowedAttributes: {
            '*': ['class', 'style'],
            'a': ['href', 'target', 'rel'],
            'img': ['src', 'alt', 'width', 'height', 'loading']
        }
    });
    const description = post.description || stripTags(cleanContent).substring(0, 160);
    const author = post.author || 'FactZone Team';
    const imageUrl = `https://factzone.online/assets/images/posts/${slug}.webp`;
    const postUrl = `https://factzone.online/posts/${slug}.html`;

    return `<!DOCTYPE html>
<html lang="hi">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${title} - FactZone</title>
    <meta name="description" content="${description}">
    <link rel="canonical" href="${postUrl}">

    <meta property="og:type" content="article">
    <meta property="og:url" content="${postUrl}">
    <meta property="og:title" content="${title}">
    <meta property="og:description" content="${description}">
    <meta property="og:image" content="${imageUrl}">
    <meta property="og:image:width" content="1200">
    <meta property="og:image:height" content="675">

    <meta name="twitter:card" content="summary_large_image">
    <meta name="twitter:url" content="${postUrl}">
    <meta name="twitter:title" content="${title}">
    <meta name="twitter:description" content="${description}">
    <meta name="twitter:image" content="${imageUrl}">

    <script type="application/ld+json">
    {
      "@context": "https://schema.org",
      "@type": "BlogPosting",
      "headline": "${title.replace(/"/g, '\\"')}",
      "image": ["${imageUrl}"],
      "datePublished": "${date}",
      "author": {
        "@type": "Person",
        "name": "${author}"
      },
      "publisher": {
        "@type": "Organization",
        "name": "FactZone",
        "logo": {
          "@type": "ImageObject",
          "url": "https://factzone.online/logo.png"
        }
      },
      "description": "${description.replace(/"/g, '\\"')}"
    }
    </script>

    <style>
        :root {
            --bg-color: #0f172a;
            --card-bg: #1e293b;
            --text-color: #f8fafc;
            --text-muted: #94a3b8;
            --accent-color: #38bdf8;
            --border-color: #334155;
        }
        body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            background-color: var(--bg-color);
            color: var(--text-color);
            margin: 0;
            padding: 0;
            line-height: 1.7;
        }
        header {
            background-color: var(--card-bg);
            border-bottom: 1px solid var(--border-color);
            padding: 1rem 2rem;
            display: flex;
            justify-content: space-between;
            align-items: center;
        }
        header a {
            color: var(--accent-color);
            text-decoration: none;
            font-weight: bold;
            font-size: 1.25rem;
        }
        main {
            max-width: 800px;
            margin: 2rem auto;
            padding: 0 1rem;
        }
        .post-meta {
            color: var(--text-muted);
            font-size: 0.9rem;
            margin-bottom: 1rem;
        }
        .category-badge {
            background-color: var(--accent-color);
            color: #0f172a;
            padding: 0.2rem 0.6rem;
            border-radius: 4px;
            font-size: 0.8rem;
            font-weight: bold;
            display: inline-block;
        }
        .featured-image {
            width: 100%;
            height: auto;
            aspect-ratio: 16 / 9;
            border-radius: 8px;
            object-fit: cover;
            margin: 1.5rem 0;
        }
        .content {
            font-size: 1.1rem;
        }
        .content img {
            max-width: 100%;
            height: auto;
            border-radius: 6px;
        }
        footer {
            text-align: center;
            padding: 2rem;
            border-top: 1px solid var(--border-color);
            margin-top: 3rem;
            color: var(--text-muted);
        }
    </style>
</head>
<body>
    <header>
        <a href="/">FactZone</a>
        <a href="/" style="font-size: 0.9rem;">← Home</a>
    </header>
    <main>
        <article>
            <span class="category-badge">${category}</span>
            <h1 style="margin-top: 0.5rem; font-size: 2rem;">${title}</h1>
            <div class="post-meta">
                <span>By ${author}</span> • <time datetime="${date}">${formattedDate}</time>
            </div>
            <img class="featured-image" src="/assets/images/posts/${slug}.webp" alt="${title}" width="1200" height="675" loading="eager">
            <div class="content">
                ${cleanContent}
            </div>
        </article>
    </main>
    <footer>
        <p>&copy; ${new Date().getFullYear()} FactZone. All rights reserved.</p>
    </footer>
</body>
</html>`;
}

async function buildSite() {
    if (!fs.existsSync(postsDir)) {
        console.log('No posts found in data/posts directory.');
        return;
    }

    const files = fs.readdirSync(postsDir);
    const postList = [];

    for (const file of files) {
        if (file.endsWith('.json')) {
            try {
                const rawData = fs.readFileSync(path.join(postsDir, file), 'utf-8');
                const post = JSON.parse(rawData);

                if (!post.slug) {
                    post.slug = path.parse(file).name;
                }

                const postHtml = generatePostPage(post);
                fs.writeFileSync(path.join(outputPostsDir, `${post.slug}.html`), postHtml);
                console.log(`[GENERATED] posts/${post.slug}.html`);

                postList.push(post);
            } catch (err) {
                console.error(`[ERROR] File ${file}:`, err.message);
            }
        }
    }

    postList.sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));
    fs.writeFileSync(postsIndexJsonPath, JSON.stringify(postList, null, 2));

    if (fs.existsSync(indexHtmlPath)) {
        let indexHtml = fs.readFileSync(indexHtmlPath, 'utf-8');

        const postCardsHtml = postList.map(post => {
            const excerpt = post.excerpt || stripTags(post.content).substring(0, 110) + '...';
            const formattedDate = formatDate(post.date);
            return `
        <article class="post-card">
            <a href="/posts/${post.slug}.html" class="card-link">
                <div class="card-image-wrapper">
                    <img src="/assets/images/posts/${post.slug}.webp" alt="${post.title}" width="1200" height="675" loading="lazy" class="card-image">
                    <span class="category-tag">${post.category || 'General'}</span>
                </div>
                <div class="card-body">
                    <h2 class="card-title">${post.title}</h2>
                    <p class="card-excerpt">${excerpt}</p>
                    <time class="card-date" datetime="${post.date}">${formattedDate}</time>
                </div>
            </a>
        </article>`;
        }).join('\n');

        const gridStartMarker = '<!-- POSTS_GRID_START -->';
        const gridEndMarker = '<!-- POSTS_GRID_END -->';

        if (indexHtml.includes(gridStartMarker) && indexHtml.includes(gridEndMarker)) {
            const startIndex = indexHtml.indexOf(gridStartMarker) + gridStartMarker.length;
            const endIndex = indexHtml.indexOf(gridEndMarker);

            indexHtml = indexHtml.slice(0, startIndex) + '\n' + postCardsHtml + '\n        ' + indexHtml.slice(endIndex);
            fs.writeFileSync(indexHtmlPath, indexHtml);
            console.log('[UPDATED] index.html updated successfully.');
        }
    }
}

buildSite();
