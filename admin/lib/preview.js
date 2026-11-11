// "Ver prévia": the post as it will look, drawn with the site's own stylesheet (assets/styles.css) and the
// same HTML as src/pages/post.html. The marks are read like scripts/lib/render.mjs reads them (fmt below is
// a copy of the one there: change both together).

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export const fmt = (s) =>
  esc(s)
    .replace(/==([^=]+)==/g, '<mark>$1</mark>')
    .replace(/[^\s~<>*=[\]]+(?:~[^\s~<>*=[\]]+)+/g, (m) => `<span class="nowrap">${m.replace(/~/g, ' ')}</span>`)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
    .replace(/\s*\|\s*/g, '<br>')
    .replace(/(\S+(?:\s+\S+){3,})\s+(\S+)$/, (m, head, last) => {
      const len = (w) => w.replace(/<[^>]+>/g, '').replace(/&[a-z#0-9]+;/gi, 'x').length;
      return len(last) + len(head.split(/\s+|<br>/).pop()) > 22 ? m : `${head}&nbsp;${last}`;
    });

// links inside the text: they look like links in the preview, but don't leave it. Links to other sites are set
// aside while the marks are read (as rich() in render.mjs), so ~ * ( ) in an address don't break them.
const rich = (s) => {
  const held = [];
  const text = String(s ?? '').replace(/\[([^\]]+)\]\((https?:\/\/(?:[^\s()<>"]|\([^\s()<>"]*\))+)\)/g, (m, label) => `\u0000${held.push(label) - 1}\u0000`);
  return fmt(text)
    .replace(/\[([^\]]+)\]\(([a-z]+)(?::([\w-]+))?\)/g, '<a href="#">$1</a>')
    .replace(/\u0000(\d+)\u0000/g, (m, i) => `<a href="#">${fmt(held[i])}</a>`);
};

// l = one language of the post, labels = blog_page of that language's site file, url(src) = where an image is
export function previewHtml({ l, post, lang, labels = {}, base, url, dateText, minutes, projects }) {
  const img = (src, alt, eager) => (src ? `<img src="${esc(url(src))}" alt="${esc(alt || '')}" loading="${eager ? 'eager' : 'lazy'}">` : '');
  const body = l.body
    .map((b) => {
      if (b.type === 'p' && b.text.trim()) return `<p>${rich(b.text)}</p>`;
      if (b.type === 'h2' && b.text.trim()) return `<h2>${fmt(b.text)}</h2>`;
      if (b.type === 'list' && b.items.some((t) => t.trim())) return `<ul>${b.items.filter((t) => t.trim()).map((t) => `<li>${rich(t)}</li>`).join('')}</ul>`;
      if (b.type === 'quote' && b.text.trim()) return `<blockquote class="post__quote"><p>${fmt(b.text)}</p></blockquote>`;
      if (b.type === 'img' && b.src) {
        const link = b.project && projects.has(b.project) ? ` <a href="#">${esc(labels.see_project || 'See the project')} →</a>` : '';
        return `<figure class="post__fig"><span class="post__img">${img(b.src, b.alt)}</span>${b.caption || link ? `<figcaption>${fmt(b.caption || '')}${link}</figcaption>` : ''}</figure>`;
      }
      return '';
    })
    .join('\n');
  return `<!doctype html><html lang="${esc(lang)}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<base href="${esc(base)}"><link rel="stylesheet" href="assets/styles.css">
<style>.post{padding-top:clamp(28px,5vw,64px);padding-bottom:clamp(48px,7vw,96px)} a[href="#"]{cursor:default}</style></head>
<body class="page-post"><main id="main"><article class="post">
<header class="wrap post__head">
<p class="kicker"><a href="#">${esc(labels.kicker || 'Blog')}</a> <span aria-hidden="true">·</span> ${esc(l.category)}</p>
<h1 class="display display--md">${fmt(l.title)}</h1>
<p class="post__lead">${fmt(l.excerpt)}</p>
<p class="post__meta">${esc(labels.by || '')} <span aria-hidden="true">·</span> <time>${esc(dateText)}</time> <span aria-hidden="true">·</span> ${minutes} ${esc(labels.read || 'min')}</p>
</header>
<div class="wrap"><figure class="post__cover">${img(post.cover, l.cover_alt, true)}</figure></div>
<div class="wrap"><div class="post__body">${body}</div></div>
</article></main>
</body></html>`;
}
