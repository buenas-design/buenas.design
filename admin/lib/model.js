// The posts, between the files of the site (content/blog.yml, content/blog.br.yml…) and the editor.
// No screen here: the same code runs in the browser and in Node (for the tests).
//
// In the files, each language has its own list of posts, linked by the same "id". In the editor a post is
// one thing with a version per language: { id, cover, date, status, langs: { en: {…}, br: {…} } }.
// Saving changes only what was edited: the other posts, the comments and the way the file is written stay
// exactly as they were (other people, and other tools, edit these files too).
import * as YAML from 'yaml';

// fields that belong to one language (cover and date are shared by every version of a post)
export const LANG_FIELDS = ['slug', 'category', 'title', 'seo_title', 'description', 'excerpt', 'cover_alt'];
// the order of the keys in a new post, the same as the posts written by hand
const KEY_ORDER = ['id', 'slug', 'date', 'updated', 'category', 'title', 'seo_title', 'description', 'excerpt', 'cover', 'cover_alt', 'body'];
const KNOWN = new Set([...KEY_ORDER, 'hidden', 'draft']);
const BLOCKS = ['p', 'h2', 'list', 'quote', 'img'];

export const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

// "Não crie um *logo* antes…" → "nao-crie-um-logo-antes"
export const slugify = (s, max = 80) => {
  const t = String(s ?? '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (t.length <= max) return t;
  const cut = t.slice(0, max + 1);
  return (cut.lastIndexOf('-') > 20 ? cut.slice(0, cut.lastIndexOf('-')) : cut.slice(0, max)).replace(/-+$/, '');
};

// the text without the marks of the site (*ênfase*, **negrito**, ==marca==, palavra~palavra, |)
export const plain = (s) => String(s ?? '').replace(/==|\*/g, '').replace(/~/g, ' ').replace(/\s*\|\s*/g, ' ').trim();

export const deepEqual = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const clone = (x) => (x === undefined ? undefined : JSON.parse(JSON.stringify(x)));

/* ───────── blocks ───────── */

// { p: "…" } in the file ↔ { type: 'p', text: "…" } in the editor
export const blockFromFile = (b) => {
  const key = b && typeof b === 'object' ? Object.keys(b).find((k) => BLOCKS.includes(k)) : null;
  if (!key || Object.keys(b).length !== 1) return { type: 'raw', value: clone(b) };
  if (key === 'list') return { type: 'list', items: (b.list || []).map(String) };
  if (key === 'img') {
    const m = b.img || {};
    return { type: 'img', src: m.src || '', alt: m.alt || '', caption: m.caption || '', project: m.project || '', ...(Object.keys(m).some((k) => !['src', 'alt', 'caption', 'project'].includes(k)) ? { extra: clone(m) } : {}) };
  }
  return { type: key, text: String(b[key] ?? '') };
};

export const blockToFile = (b) => {
  if (b.type === 'raw') return clone(b.value);
  if (b.type === 'list') return { list: b.items.map((t) => t.trim()).filter(Boolean) };
  if (b.type === 'img') {
    const m = { ...(b.extra || {}), src: b.src };
    for (const k of ['alt', 'caption', 'project']) {
      if (String(b[k] || '').trim()) m[k] = String(b[k]).trim();
      else delete m[k];
    }
    return { img: m };
  }
  return { [b.type]: String(b.text || '').trim() };
};

// an empty block (a paragraph with nothing written) never goes to the site
export const blockIsEmpty = (b) =>
  b.type === 'raw' ? false : b.type === 'list' ? !b.items.some((t) => t.trim()) : b.type === 'img' ? !b.src : !String(b.text || '').trim();

/* ───────── posts ───────── */

// files: [{ code, text }] in the order of the site's languages → the posts, newest first (the order of the files)
export function postsFromFiles(files) {
  const byId = new Map();
  const order = [];
  for (const { code, text } of files) {
    const list = (text ? YAML.parse(text) : null)?.posts || [];
    for (const e of list) {
      if (!e || !e.id) continue;
      let post = byId.get(e.id);
      if (!post) {
        post = { id: e.id, cover: e.cover || '', date: e.date ? String(e.date) : '', updated: e.updated ? String(e.updated) : '', status: 'published', langs: {} };
        byId.set(e.id, post);
        order.push(post);
      }
      if (!post.cover && e.cover) post.cover = e.cover;
      if (!post.date && e.date) post.date = String(e.date);
      const extra = Object.fromEntries(Object.entries(e).filter(([k]) => !KNOWN.has(k)));
      post.langs[code] = {
        on: !e.hidden,
        existed: true,
        published: !e.hidden && !e.draft,
        draft: !!e.draft,
        ...Object.fromEntries(LANG_FIELDS.map((k) => [k, e[k] == null ? '' : String(e[k])])),
        body: (e.body || []).map(blockFromFile),
        ...(Object.keys(extra).length ? { extra } : {}),
      };
    }
  }
  // a post is a draft when every version on the site is a draft
  for (const post of order) {
    const on = Object.values(post.langs).filter((l) => l.on);
    post.status = on.length && on.every((l) => l.draft) ? 'draft' : 'published';
  }
  return order;
}

export const emptyLang = () => ({ on: true, existed: false, published: false, draft: false, slug: '', category: '', title: '', seo_title: '', description: '', excerpt: '', cover_alt: '', body: [{ type: 'p', text: '' }] });

export const newPost = (codes) => ({ id: '', isNew: true, cover: '', date: today(), updated: '', status: 'draft', langs: Object.fromEntries(codes.map((c) => [c, emptyLang()])) });

// a short id from the first title, never one already taken
export function makeId(post, taken) {
  const first = Object.values(post.langs).find((l) => l.on && plain(l.title)) || Object.values(post.langs).find((l) => plain(l.title));
  const base = slugify(plain(first?.title || 'post'), 48) || 'post';
  let id = base;
  for (let n = 2; taken.has(id); n++) id = `${base}-${n}`;
  return id;
}

// the entry of one language, as it goes in the file (null = this language has no version of the post)
export function entryOf(post, code) {
  const l = post.langs[code];
  if (!l || (!l.on && !l.existed)) return null;
  const e = { ...(l.extra || {}) };
  const put = (k, v) => {
    if (v != null && String(v).trim() !== '') e[k] = typeof v === 'string' ? v.trim() : v;
  };
  put('id', post.id);
  put('slug', l.slug);
  put('date', post.date);
  put('updated', post.updated);
  for (const k of ['category', 'title', 'seo_title', 'description', 'excerpt']) put(k, l[k]);
  put('cover', post.cover);
  put('cover_alt', l.cover_alt);
  e.body = l.body.filter((b) => !blockIsEmpty(b)).map(blockToFile);
  const ordered = {};
  for (const k of KEY_ORDER) if (k in e) ordered[k] = e[k];
  for (const k of Object.keys(e)) if (!(k in ordered)) ordered[k] = e[k];
  // a language switched off stays in the file, hidden (nothing written is lost)
  if (!l.on) ordered.hidden = true;
  else if (post.status === 'draft') ordered.draft = true;
  return ordered;
}

/* ───────── writing a file ───────── */

const quoteDates = (node) => {
  if (!YAML.isMap(node)) return;
  for (const k of ['date', 'updated']) {
    const v = node.get(k, true);
    if (YAML.isScalar(v)) v.type = 'QUOTE_DOUBLE';
  }
};

// replace the values that changed inside an existing post, keeping everything else as it was written
function mergeInto(doc, map, entry) {
  for (const pair of [...map.items]) {
    const k = YAML.isScalar(pair.key) ? pair.key.value : pair.key;
    if (!(k in entry)) map.delete(k);
  }
  for (const [k, v] of Object.entries(entry)) {
    const old = map.get(k, true);
    const oldValue = old && typeof old.toJSON === 'function' ? old.toJSON() : old;
    if (deepEqual(oldValue, v)) continue;
    if (k === 'body' && YAML.isSeq(old)) {
      // the blocks that did not change keep their own node (and so their quotes and line breaks)
      const pool = [...old.items];
      old.items = v.map((b) => {
        const i = pool.findIndex((n) => deepEqual(n && typeof n.toJSON === 'function' ? n.toJSON() : n, b));
        return i >= 0 ? pool.splice(i, 1)[0] : doc.createNode(b);
      });
      continue;
    }
    const node = doc.createNode(v);
    map.set(k, node);
    if (k === 'date' || k === 'updated') map.get(k, true).type = 'QUOTE_DOUBLE';
  }
}

// a file of posts (its text) with one post written, replaced or taken out (entry null); new posts go on top.
// Returns the new text; the same text when nothing changed.
export function writePost(text, id, entry, header = '') {
  const doc = YAML.parseDocument(text || `${header}posts: []\n`);
  let seq = doc.get('posts', true);
  if (!YAML.isSeq(seq)) {
    doc.set('posts', doc.createNode([]));
    seq = doc.get('posts', true);
  }
  seq.flow = false;
  const i = seq.items.findIndex((n) => YAML.isMap(n) && n.get('id') === id);
  if (entry == null) {
    if (i < 0) return text;
    seq.items.splice(i, 1);
    if (seq.items[0]) seq.items[0].spaceBefore = false;
  } else if (i >= 0) {
    mergeInto(doc, seq.items[i], entry);
  } else {
    const node = doc.createNode(entry);
    quoteDates(node);
    if (seq.items[0]) seq.items[0].spaceBefore = true;
    seq.items.unshift(node);
  }
  const out = doc.toString({ lineWidth: 0 });
  return out === text ? text : out;
}

// every id and every address (slug) already used, per language, to never repeat one
export function taken(posts, exceptId) {
  const ids = new Set();
  const slugs = {};
  for (const p of posts) {
    if (p.id === exceptId) continue;
    ids.add(p.id);
    for (const [code, l] of Object.entries(p.langs)) (slugs[code] ||= new Set()).add(l.slug);
  }
  return { ids, slugs };
}

// the images a post uses (cover and blocks), to upload the new ones and to clean up when it's deleted
export const imagesOf = (post) => [
  post.cover,
  ...Object.values(post.langs).flatMap((l) => l.body.filter((b) => b.type === 'img').map((b) => b.src)),
].filter(Boolean);

// reading time, the same count as the site (~200 words a minute)
export const minutesOf = (l) => {
  const words = l.body
    .flatMap((b) => (b.type === 'list' ? b.items : b.type === 'img' ? [b.caption] : [b.text]))
    .filter(Boolean)
    .join(' ')
    .split(/\s+/).length;
  return Math.max(1, Math.round(words / 200));
};
