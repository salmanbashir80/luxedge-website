// ============================================================================
// BLOG STOREFRONT PAGES — /blog, /blog/:slug, /blog/write
//
// Kept in their own module and lazy-loaded as a route chunk so the homepage
// never downloads the blog pages (or the ads they mount). Only public-facing
// pages live here — the CMS editor stays in the admin section.
// ============================================================================
import { useEffect, useState, type ChangeEvent, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import type { BlogPost } from '../App';
import { useApp } from '../App';
import { loadPublishedBlogBySlug } from '../services/blog';
import { isHeldProduct, isLinkablePublicPath } from '../content/reviewHolds';
import AdSenseAd from '../components/AdSenseAd';
import AdsterraBanner from '../components/AdsterraBanner';
import { BookOpen01, PencilLine, Calendar, ArrowRight, Send01, Eye, ChevronRight, ArrowLeft, Upload01, Tag01 } from '@untitledui/icons';

const blogSlug = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

export function BlogImage({ src, alt, className, imgClassName }: { src: string; alt: string; className?: string; imgClassName?: string }) {
  const [failed, setFailed] = useState(false);
  const show = !!src && !failed;
  return (
    <div className={`${className || ''} bg-gradient-to-br from-luxe-gold-soft to-luxe-cream flex items-center justify-center`}>
      {show ? (
        <img src={src} alt={alt} loading="lazy" onError={() => setFailed(true)} className={imgClassName || 'w-full h-full object-cover'} />
      ) : (
        <BookOpen01 strokeWidth={1.5} size={32} className="text-luxe-gold/40" />
      )}
    </div>
  );
}

export function BlogListPage() {
  const { blogs, user } = useApp();
  const published = blogs.filter(b => b.status === 'published');

  return (
    <div>
      <section className="bg-gradient-to-b from-luxe-light to-white border-b border-gray-100 py-10">
        <div className="max-w-7xl mx-auto px-4 text-center">
          <p className="text-luxe-gold text-xs font-semibold uppercase tracking-wider mb-2">Luxedge Blog</p>
          <h1 className="font-serif text-3xl sm:text-4xl font-bold text-luxe-black mb-2">Insights & Inspiration</h1>
          <p className="text-gray-500 text-sm max-w-lg mx-auto">Styling guides, sizing advice, and luxury fashion inspiration.</p>
        </div>
      </section>

      <section className="py-10 bg-gray-50">
        <div className="max-w-6xl mx-auto px-4">
          {user && (
            <div className="flex justify-end mb-6">
              <Link to="/blog/write" className="px-5 py-2.5 bg-luxe-gold hover:bg-luxe-gold-dark text-white font-semibold rounded-lg flex items-center gap-2 text-sm">
                <PencilLine strokeWidth={1.5} size={16} /> Write a Post
              </Link>
            </div>
          )}

          {published.length > 0 ? (
            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
              {published.map(post => (
                <Link key={post.id} to={`/blog/${post.slug}`} className="group bg-white rounded-2xl border border-gray-100 overflow-hidden hover:shadow-xl transition-all duration-300">
                  <div className="aspect-[16/10] overflow-hidden">
                    <BlogImage src={post.image} alt={post.title} className="w-full h-full" imgClassName="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" />
                  </div>
                  <div className="p-5">
                    <div className="flex items-center gap-3 mb-3">
                      <div className="flex items-center gap-1.5 text-xs text-gray-400"><Calendar strokeWidth={1.5} size={12} />{new Date(post.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</div>
                      <span className="text-gray-200">·</span>
                      <span className="text-xs text-gray-400">{post.authorName}</span>
                    </div>
                    <h2 className="font-bold text-gray-900 mb-2 group-hover:text-luxe-gold transition-colors leading-tight">{post.title}</h2>
                    <p className="text-sm text-gray-500 line-clamp-2 mb-4">{post.excerpt}</p>
                    <div className="flex items-center justify-between">
                      <div className="flex gap-1.5">{post.tags.slice(0, 3).map(t => <span key={t} className="px-2 py-0.5 bg-gray-100 text-gray-500 rounded-full text-[10px] font-medium">#{t}</span>)}</div>
                      <span className="text-luxe-gold text-sm font-semibold group-hover:underline flex items-center gap-1">Read More <ArrowRight strokeWidth={1.5} size={14} /></span>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          ) : (
            <div className="text-center py-20 bg-white rounded-xl border">
              <BookOpen01 strokeWidth={1.5} size={48} className="mx-auto text-gray-200 mb-4" />
              <p className="text-lg font-semibold text-gray-700 mb-2">No posts yet</p>
              <p className="text-sm text-gray-500">Check back soon for new content!</p>
            </div>
          )}

          {/* Ad below blog listing */}
          {published.length > 0 && <AdSenseAd placement="blog_after_article" />}
        </div>
      </section>
    </div>
  );
}

export function BlogDetailPage() {
  const { slug } = useParams<{ slug: string }>();
  const { blogs: allBlogs } = useApp();
  const listPost = allBlogs.find(b => b.slug === slug && b.status === 'published');
  const [cmsPost, setCmsPost] = useState<BlogPost | null>(null);
  const post = cmsPost || listPost;
  const relatedPosts = allBlogs.filter(b => b.slug !== slug && b.status === 'published').slice(0, 3);

  useEffect(() => { window.scrollTo(0, 0); }, [slug]);
  useEffect(() => {
    let cancelled = false;
    setCmsPost(null);
    if (!slug) return () => { cancelled = true; };
    void loadPublishedBlogBySlug(slug).then((row) => { if (!cancelled && row) setCmsPost(row); });
    return () => { cancelled = true; };
  }, [slug]);

  // SEO: canonical + meta description + BlogPosting & BreadcrumbList JSON-LD
  useEffect(() => {
    if (!post) return;
    const setMeta = (n: string, c: string) => {
      let el = document.head.querySelector(`meta[name="${n}"]`);
      if (!el) { el = document.createElement('meta'); el.setAttribute('name', n); document.head.appendChild(el); }
      el.setAttribute('content', c);
    };
    setMeta('description', (post.excerpt || post.content.slice(0, 155)));
    let canonical = document.head.querySelector('link[rel="canonical"]');
    if (!canonical) { canonical = document.createElement('link'); canonical.setAttribute('rel', 'canonical'); document.head.appendChild(canonical); }
    canonical.setAttribute('href', `https://luxedge.us/blog/${post.slug}`);
    const jsonLd = [
      {
        '@context': 'https://schema.org',
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'Home', item: 'https://luxedge.us/' },
          { '@type': 'ListItem', position: 2, name: 'Blog', item: 'https://luxedge.us/blog' },
          { '@type': 'ListItem', position: 3, name: post.title, item: `https://luxedge.us/blog/${post.slug}` },
        ],
      },
      {
        '@context': 'https://schema.org',
        '@type': 'BlogPosting',
        headline: post.title,
        description: post.excerpt || post.content.slice(0, 155),
        image: post.image || undefined,
        datePublished: post.date,
        dateModified: post.date,
        author: { '@type': 'Person', name: post.authorName || 'Luxedge Editorial Team' },
        publisher: { '@type': 'Organization', name: 'Luxedge', url: 'https://luxedge.us' },
        mainEntityOfPage: `https://luxedge.us/blog/${post.slug}`,
        keywords: post.tags.join(', '),
      },
      ...(post.faq && post.faq.length ? [{
        '@context': 'https://schema.org',
        '@type': 'FAQPage',
        mainEntity: post.faq.map((f) => ({
          '@type': 'Question',
          name: f.q,
          acceptedAnswer: { '@type': 'Answer', text: f.a },
        })),
      }] : []),
    ];
    const script = document.createElement('script');
    script.type = 'application/ld+json';
    script.id = 'blog-jsonld';
    script.text = JSON.stringify(jsonLd);
    document.getElementById('blog-jsonld')?.remove();
    document.head.appendChild(script);
    return () => { document.getElementById('blog-jsonld')?.remove(); };
  }, [post?.id, post?.slug]);

  if (!post) return (
    <div className="min-h-[60vh] flex items-center justify-center">
      <div className="text-center"><BookOpen01 strokeWidth={1.5} size={48} className="mx-auto text-gray-300 mb-4" /><h2 className="text-2xl font-bold mb-2">Post Not Found</h2><Link to="/blog" className="px-6 py-3 bg-luxe-gold text-white font-semibold rounded-lg inline-block">Back to Blog</Link></div>
    </div>
  );

  // Simple markdown-ish rendering for ## headings, paragraphs and
  // [label](/path) internal links (used by buyer guides to link products).
  const renderInline = (text: string, keyBase: number) => {
    const parts = text.split(/(\[[^\]]+\]\([^)]+\))/g).filter(Boolean);
    return parts.map((part, j) => {
      const m = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
      if (m) {
        const productSlug = m[2].match(/^\/product\/([^/?#]+)/)?.[1];
        // Held products and retired routes are rendered as plain text so a
        // stale CMS body can never link a reader to a 404.
        if ((productSlug && isHeldProduct(productSlug)) || !isLinkablePublicPath(m[2])) {
          return <span key={`${keyBase}-${j}`}>{m[1]}</span>;
        }
        return <Link key={`${keyBase}-${j}`} to={m[2]} className="text-luxe-gold-dark font-semibold underline decoration-luxe-gold/40 underline-offset-2 hover:text-luxe-gold transition-colors">{m[1]}</Link>;
      }
      return <span key={`${keyBase}-${j}`}>{part}</span>;
    });
  };
  const renderContent = (text: string) => {
    return text.split('\n').map((line, i) => {
      const trimmed = line.trim();
      if (!trimmed) return <br key={i} />;
      if (trimmed.startsWith('## ')) return <h2 key={i} className="text-xl font-bold text-gray-900 mt-8 mb-3">{trimmed.slice(3)}</h2>;
      if (trimmed.startsWith('# ')) return <h1 key={i} className="text-2xl font-bold text-gray-900 mt-8 mb-4">{trimmed.slice(2)}</h1>;
      return <p key={i} className="text-gray-600 leading-relaxed mb-3">{renderInline(trimmed, i)}</p>;
    });
  };

  return (
    <div>
      {/* Hero Image (graceful placeholder when a post has no image) */}
      <div className="relative h-64 sm:h-80 lg:h-96 bg-luxe-light">
        <BlogImage src={post.image} alt={post.title} className="w-full h-full" imgClassName="w-full h-full object-cover" />
        {post.image && <div className="absolute inset-0 bg-gradient-to-t from-luxe-black/70 via-transparent to-transparent" />}
      </div>

      <div className="max-w-3xl mx-auto px-4 -mt-20 relative z-10">
        {/* Post Header */}
        <div className="bg-white rounded-2xl shadow-xl border p-6 sm:p-10 mb-8">
          {/* Breadcrumb */}
          <nav className="flex items-center gap-2 text-xs text-gray-400 mb-4">
            <Link to="/" className="hover:text-luxe-gold">Home</Link><ChevronRight strokeWidth={1.5} size={12} />
            <Link to="/blog" className="hover:text-luxe-gold">Blog</Link><ChevronRight strokeWidth={1.5} size={12} />
            <span className="text-gray-600 truncate max-w-[200px]">{post.title}</span>
          </nav>

          {/* Tags */}
          <div className="flex gap-2 mb-4">{post.tags.map(t => <span key={t} className="px-3 py-1 bg-luxe-gold-soft text-luxe-gold-dark rounded-full text-xs font-medium">#{t}</span>)}</div>

          {/* Title */}
          <h1 className="font-serif text-2xl sm:text-3xl lg:text-4xl font-bold text-luxe-black leading-tight mb-4">{post.title}</h1>

          {/* Meta — truthful attribution: individual author when the CMS records
              one, otherwise the Luxedge editorial team. No invented personas. */}
          <div className="flex items-center gap-4 pb-6 border-b mb-8">
            <div className="w-10 h-10 bg-luxe-gold-soft rounded-full flex items-center justify-center"><span className="font-bold text-luxe-gold-dark text-sm">{(post.authorName || 'Luxedge Editorial Team').charAt(0)}</span></div>
            <div>
              <p className="font-semibold text-sm text-gray-900">Written by {post.authorName || 'Luxedge Editorial Team'}</p>
              <p className="text-xs text-gray-400 flex items-center gap-1"><Calendar strokeWidth={1.5} size={11} />{new Date(post.date).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}</p>
              {(post.authorName || 'Luxedge Editorial Team') === 'Luxedge Editorial Team' && (
                <p className="text-[11px] text-gray-400 mt-1">Buying guides are prepared by the Luxedge editorial team for general product information. Always follow the product label and instructions.</p>
              )}
            </div>
          </div>

          {/* Ad: Top of Article */}
          <AdSenseAd placement="blog_in_article" />

          {/* Content with mid-article ad */}
          <article className="prose-custom">
            {renderContent(post.content)}
          </article>

          {/* Inline images — these are article content, not decoration, so an
              empty alt would hide them from a screen reader and leave the post
              with no image description at all. Same wording pattern as
              altTextFor() in features/catalog/seo.ts. */}
          {post.images.length > 0 && (
            <div className="grid grid-cols-2 gap-4 mt-8">
              {post.images.map((img, i) => (
                <img key={i} src={img} alt={`${post.title} — image ${i + 1}`} loading="lazy" decoding="async" className="rounded-xl w-full object-cover" />
              ))}
            </div>
          )}

          {/* Ad: End of Article */}
          <AdSenseAd placement="blog_after_article" />
          <AdsterraBanner />

          {/* Related Posts */}
          {relatedPosts.length > 0 && (
            <div className="mt-10 pt-8 border-t">
              <h3 className="font-bold text-lg text-gray-900 mb-4">You May Also Like</h3>
              <div className="grid sm:grid-cols-3 gap-4">
                {relatedPosts.map(r => (
                  <Link key={r.id} to={`/blog/${r.slug}`} className="group flex gap-3 p-3 bg-gray-50 rounded-xl hover:bg-luxe-gold-soft transition-colors">
                    <BlogImage src={r.image} alt={r.title} className="w-16 h-16 rounded-lg shrink-0 overflow-hidden" imgClassName="w-full h-full object-cover" />
                    <div>
                      <p className="text-sm font-semibold text-gray-900 group-hover:text-luxe-gold line-clamp-2 leading-tight">{r.title}</p>
                      <p className="text-[10px] text-gray-400 mt-1">{new Date(r.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</p>
                    </div>
                  </Link>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Back link */}
        <div className="text-center mb-12">
          <Link to="/blog" className="text-luxe-gold font-semibold text-sm hover:underline flex items-center justify-center gap-2"><ArrowLeft strokeWidth={1.5} size={16} /> Back to All Posts</Link>
        </div>
      </div>
    </div>
  );
}

export function BlogWritePage() {
  const { user, setBlogs, notify } = useApp();
  const nav = useNavigate();
  const [title, setTitle] = useState('');
  const [excerpt, setExcerpt] = useState('');
  const [content, setContent] = useState('');
  const [tagInput, setTagInput] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [images, setImages] = useState<string[]>([]);
  const [cover, setCover] = useState('');

  useEffect(() => { if (!user) nav('/login'); }, [user, nav]);

  const handleCover = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return;
    const r = new FileReader(); r.onload = ev => { if (ev.target?.result) setCover(ev.target.result as string); }; r.readAsDataURL(file);
    e.target.value = '';
  };

  const handleImages = (e: ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files; if (!files) return;
    Array.from(files).slice(0, 5 - images.length).forEach(file => {
      const r = new FileReader(); r.onload = ev => { if (ev.target?.result) setImages(prev => [...prev, ev.target!.result as string]); }; r.readAsDataURL(file);
    });
    e.target.value = '';
  };

  const addTag = () => { if (tagInput.trim() && !tags.includes(tagInput.trim())) { setTags([...tags, tagInput.trim()]); setTagInput(''); } };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!title || !content) { notify('Title and content required'); return; }
    if (!cover) { notify('Please add a cover image'); return; }

    const newPost: BlogPost = {
      id: `b${Date.now()}`, slug: blogSlug(title), title, excerpt: excerpt || content.slice(0, 150) + '...',
      content, image: cover, images, tags,
      authorId: user!.id, authorName: user!.name,
      status: user!.role === 'admin' ? 'published' : 'pending',
      date: new Date().toISOString(),
    };
    setBlogs(prev => [newPost, ...prev]);
    notify(user!.role === 'admin' ? 'Blog published!' : 'Blog submitted for review!');
    nav('/blog');
  };

  const I = 'w-full px-4 py-3 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-luxe-gold focus:ring-2 focus:ring-luxe-gold/20';

  return (
    <div className="py-10 bg-gray-50 min-h-screen">
      <div className="max-w-3xl mx-auto px-4">
        <Link to="/blog" className="text-sm text-gray-500 hover:text-luxe-gold flex items-center gap-1 mb-6"><ArrowLeft strokeWidth={1.5} size={14} />Back to Blog</Link>
        <h1 className="text-2xl font-bold mb-8 flex items-center gap-2"><PencilLine strokeWidth={1.5} size={22} className="text-luxe-gold" />Write a Blog Post</h1>

        <form onSubmit={submit} className="space-y-6">
          {/* Cover Image */}
          <div className="bg-white rounded-2xl border p-6">
            <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wider mb-3">Cover Image *</label>
            {cover ? (
              <div className="relative rounded-xl overflow-hidden mb-3 aspect-[16/9]">
                <img src={cover} alt="" className="w-full h-full object-cover" />
                <button type="button" onClick={() => setCover('')} className="absolute top-3 right-3 w-8 h-8 bg-red-500 text-white rounded-full flex items-center justify-center text-sm hover:bg-red-600">✕</button>
              </div>
            ) : (
              <label className="flex flex-col items-center justify-center w-full h-40 border-2 border-dashed border-gray-300 rounded-xl cursor-pointer hover:border-luxe-gold hover:bg-luxe-gold-soft/30 transition-all">
                <Upload01 strokeWidth={1.5} size={28} className="text-gray-400 mb-2" />
                <span className="text-sm font-medium text-gray-600">Upload cover image</span>
                <span className="text-xs text-gray-400">JPG, PNG · Max 5MB</span>
                <input type="file" accept="image/*" onChange={handleCover} className="hidden" />
              </label>
            )}
          </div>

          {/* Title & Excerpt */}
          <div className="bg-white rounded-2xl border p-6 space-y-4">
            <div><label className="block text-xs font-semibold text-gray-600 uppercase tracking-wider mb-1.5">Title *</label><input value={title} onChange={e => setTitle(e.target.value)} className={I} placeholder="Your blog post title" required /></div>
            <div><label className="block text-xs font-semibold text-gray-600 uppercase tracking-wider mb-1.5">Excerpt</label><input value={excerpt} onChange={e => setExcerpt(e.target.value)} className={I} placeholder="Short preview text (optional)" maxLength={200} /></div>
          </div>

          {/* Content */}
          <div className="bg-white rounded-2xl border p-6">
            <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wider mb-1.5">Content * <span className="normal-case text-gray-400 font-normal">Use ## for headings</span></label>
            <textarea value={content} onChange={e => setContent(e.target.value)} className={I + ' resize-none'} rows={12} placeholder="Write your article here...&#10;&#10;## Section Heading&#10;Your paragraph text..." required />
          </div>

          {/* Inline Images */}
          <div className="bg-white rounded-2xl border p-6">
            <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wider mb-3">Article Images ({images.length}/5)</label>
            {images.length > 0 && <div className="flex gap-3 mb-3 overflow-x-auto">{images.map((img, i) => <div key={i} className="relative shrink-0"><img src={img} alt="" className="w-20 h-20 rounded-lg object-cover" /><button type="button" onClick={() => setImages(prev => prev.filter((_, idx) => idx !== i))} className="absolute -top-2 -right-2 w-5 h-5 bg-red-500 text-white rounded-full text-[10px] flex items-center justify-center">✕</button></div>)}</div>}
            {images.length < 5 && <label className="flex items-center gap-2 px-4 py-2 border border-dashed border-gray-300 rounded-xl cursor-pointer hover:border-luxe-gold text-sm text-gray-500 hover:text-luxe-gold w-fit"><Upload01 strokeWidth={1.5} size={16} />Add images<input type="file" accept="image/*" multiple onChange={handleImages} className="hidden" /></label>}
          </div>

          {/* Tags */}
          <div className="bg-white rounded-2xl border p-6">
            <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wider mb-3">Tags</label>
            <div className="flex flex-wrap gap-2 mb-3">{tags.map(t => <span key={t} className="flex items-center gap-1 px-3 py-1 bg-luxe-gold-soft text-luxe-gold-dark rounded-full text-sm"><Tag01 strokeWidth={1.5} size={12} />{t}<button type="button" onClick={() => setTags(prev => prev.filter(x => x !== t))} className="text-luxe-gold hover:text-red-500 ml-1">×</button></span>)}</div>
            <div className="flex gap-2"><input value={tagInput} onChange={e => setTagInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), addTag())} className={I} placeholder="Add tag & press Enter" /><button type="button" onClick={addTag} className="px-4 py-2 bg-gray-100 hover:bg-gray-200 rounded-xl text-sm font-medium shrink-0">Add</button></div>
          </div>

          {user?.role !== 'admin' && <div className="p-4 bg-luxe-gold-soft border border-luxe-gold/30 rounded-xl text-sm text-luxe-gold-dark flex items-center gap-2"><Eye strokeWidth={1.5} size={16} />Your post will be reviewed by admin before publishing.</div>}

          <div className="flex gap-3">
            <button type="submit" className="flex-1 py-3.5 bg-luxe-gold hover:bg-luxe-gold-dark text-white font-bold rounded-xl text-sm flex items-center justify-center gap-2"><Send01 strokeWidth={1.5} size={16} />{user?.role === 'admin' ? 'Publish Now' : 'Submit for Review'}</button>
            <button type="button" onClick={() => nav('/blog')} className="px-6 py-3.5 border rounded-xl text-sm font-medium hover:bg-gray-50">Cancel</button>
          </div>
        </form>
      </div>
    </div>
  );
}
