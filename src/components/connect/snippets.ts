// Copy-paste snippets for the "Connect your site" page. `origin` is the
// address of this Autoblog instance.

export const PLAIN_JS_HTML = (origin: string) => `<div id="blog"></div>

<script type="module">
  const API = "${origin}/api/posts";
  const root = document.getElementById("blog");
  const slug = new URLSearchParams(location.search).get("slug");

  // Tiny DOM helper. Text goes through textContent, so titles can't inject HTML.
  function h(tag, props = {}, ...children) {
    const el = Object.assign(document.createElement(tag), props);
    el.append(...children);
    return el;
  }

  async function showList() {
    const res = await fetch(\`\${API}?limit=10\`);
    if (!res.ok) throw new Error(res.status);
    const { posts } = await res.json();

    root.replaceChildren(
      ...posts.map((post) =>
        h("article", {},
          post.coverImageUrl
            ? h("img", { src: post.coverImageUrl, alt: post.coverImageAlt ?? "", width: 640 })
            : "",
          h("h2", {}, h("a", { href: \`?slug=\${post.slug}\` }, post.title)),
          h("p", {}, post.excerpt),
        ),
      ),
    );
  }

  async function showArticle(slug) {
    const res = await fetch(\`\${API}/\${encodeURIComponent(slug)}\`);
    if (res.status === 404) {
      root.textContent = "Article not found.";
      return;
    }
    if (!res.ok) throw new Error(res.status);
    const { post } = await res.json();

    document.title = post.metaTitle || post.title;
    const body = h("div");
    body.innerHTML = post.contentHtml; // already sanitized by Autoblog

    root.replaceChildren(
      h("h1", {}, post.title),
      h("time", { dateTime: post.publishedAt }, new Date(post.publishedAt).toLocaleDateString()),
      body,
    );
  }

  (slug ? showArticle(slug) : showList()).catch(() => {
    root.textContent = "Could not load the articles.";
  });
</script>`;

export const NEXT_LIST_PAGE = (origin: string) => `import Link from "next/link";

const API = "${origin}/api/posts";

type PostSummary = {
  slug: string;
  title: string;
  excerpt: string;
  coverImageUrl: string | null;
  coverImageAlt: string | null;
  publishedAt: string;
};

export default async function BlogPage() {
  // Re-fetched at most every 5 minutes, like the API's own cache.
  const res = await fetch(\`\${API}?limit=20\`, { next: { revalidate: 300 } });
  if (!res.ok) throw new Error(\`Autoblog API error: \${res.status}\`);
  const { posts }: { posts: PostSummary[] } = await res.json();

  return (
    <main>
      <h1>Blog</h1>
      {posts.map((post) => (
        <article key={post.slug}>
          {post.coverImageUrl && <img src={post.coverImageUrl} alt={post.coverImageAlt ?? ""} />}
          <h2>
            <Link href={\`/blog/\${post.slug}\`}>{post.title}</Link>
          </h2>
          <p>{post.excerpt}</p>
        </article>
      ))}
    </main>
  );
}`;

export const NEXT_ARTICLE_PAGE = (origin: string) => `import type { Metadata } from "next";
import { notFound } from "next/navigation";

const API = "${origin}/api/posts";

async function getPost(slug: string) {
  const res = await fetch(\`\${API}/\${encodeURIComponent(slug)}\`, { next: { revalidate: 300 } });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(\`Autoblog API error: \${res.status}\`);
  const { post } = await res.json();
  return post;
}

export async function generateMetadata(
  { params }: { params: Promise<{ slug: string }> },
): Promise<Metadata> {
  const { slug } = await params;
  const post = await getPost(slug);
  if (!post) return {};
  return {
    title: post.metaTitle || post.title,
    description: post.metaDescription || post.excerpt,
    openGraph: { images: post.coverImageUrl ? [post.coverImageUrl] : [] },
  };
}

export default async function PostPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const post = await getPost(slug);
  if (!post) notFound();

  return (
    <article>
      <h1>{post.title}</h1>
      <time dateTime={post.publishedAt}>
        {new Date(post.publishedAt).toLocaleDateString()}
      </time>
      {/* contentHtml is sanitized by Autoblog */}
      <div dangerouslySetInnerHTML={{ __html: post.contentHtml }} />
    </article>
  );
}`;

export const LIST_RESPONSE_EXAMPLE = `{
  "posts": [
    {
      "slug": "how-to-choose-a-notary",
      "title": "How to choose a notary",
      "excerpt": "Five questions to ask before you sign.",
      "coverImageUrl": "https://…/posts/…/cover.webp",
      "coverImageAlt": "A notary reviewing a contract",
      "tags": ["guide", "legal"],
      "lang": "en",
      "publishedAt": "2026-05-12T07:00:00.000Z",
      "metaTitle": "How to choose a notary | Acme",
      "metaDescription": "Five questions to ask before you sign."
    }
  ],
  "page": 1,
  "limit": 20,
  "total": 42
}`;

export const POST_RESPONSE_EXAMPLE = `{
  "post": {
    "slug": "how-to-choose-a-notary",
    "title": "How to choose a notary",
    "excerpt": "Five questions to ask before you sign.",
    "coverImageUrl": "https://…/posts/…/cover.webp",
    "coverImageAlt": "A notary reviewing a contract",
    "tags": ["guide", "legal"],
    "lang": "en",
    "publishedAt": "2026-05-12T07:00:00.000Z",
    "metaTitle": "How to choose a notary | Acme",
    "metaDescription": "Five questions to ask before you sign.",
    "contentMarkdown": "## Why it matters\\n\\n…",
    "contentHtml": "<h2>Why it matters</h2><p>…</p>",
    "readingTimeMinutes": 6,
    "updatedAt": "2026-05-12T07:00:00.000Z"
  }
}`;
