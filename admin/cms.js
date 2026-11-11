// The blog editor: a page of the site (/admin/) where whoever writes the blog creates, edits and publishes
// posts, with photos, in every language of the site, without touching the files.
// Everything about the site (its name, languages, files, colors, how people sign in) is in config.json,
// so the same editor works on another site with another config (see LEIA-ME.md).
import * as YAML from 'yaml';
import * as M from './lib/model.js';
import { localBackend, githubBackend, emailLogin, SaveError } from './lib/backends.js';
import { prepareImage, shareImage, kb } from './lib/images.js';
import { previewHtml } from './lib/preview.js';
import { local, blobs } from './lib/store.js';
import { strings } from './lib/i18n.js';

const ROOT = new URL('../', location.href).href; // the site's root: the editor lives at /admin/
const app = document.getElementById('app');
let C; // config.json
let T; // the words of the editor
let B; // where files are read and saved (lib/backends.js)
let P; // prefix of what this site keeps on the device
const S = { posts: [], site: {}, projects: [], projectsOf: {}, files: {}, post: null, base: null, key: null, lang: null, urls: new Map(), resumed: false };

/* ───────── little helpers ───────── */

const e = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const t = (k, vars = {}) => String(T[k] ?? k).replace(/\{(\w+)\}/g, (m, v) => (v in vars ? vars[v] : m));
const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];
const clone = (x) => JSON.parse(JSON.stringify(x));
const langOf = (code) => C.languages.find((L) => L.code === code);
const nameOf = (code) => langOf(code)?.name || code;
// the preview on this computer, also opened from a phone on the same Wi-Fi (192.168.…)
const isLocalHost = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname) || /^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(location.hostname);
const uid = () => Math.random().toString(36).slice(2, 8);
const dateText = (d, code) => {
  try {
    return new Intl.DateTimeFormat(langOf(code)?.locale || code, { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${d}T00:00:00Z`));
  } catch {
    return d;
  }
};
// where an image can be seen: a new photo (only on this device for now) or a file of the site
const url = (src) => (!src ? '' : S.urls.get(src) || (/^https?:/.test(src) ? src : ROOT + src));
const uiLocale = () => (C.ui === 'en' ? 'en' : 'pt-BR');
// the title in the language of the editor, or in the first language that has one
const titleOf = (post) => {
  const ui = C.languages.find((L) => (L.locale || L.code).startsWith(C.ui === 'en' ? 'en' : 'pt'))?.code;
  const l = post.langs[ui]?.title ? post.langs[ui] : Object.values(post.langs).find((x) => x.title);
  return M.plain(l?.title) || t('untitled');
};
const grow = (el) => {
  el.style.height = 'auto';
  el.style.height = `${el.scrollHeight + 2}px`;
};

function toast(msg, kind = '') {
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.setAttribute('role', 'status');
  el.textContent = msg;
  document.body.append(el);
  setTimeout(() => el.classList.add('is-out'), 3600);
  setTimeout(() => el.remove(), 4200);
}

// a window over the page. d.shut() closes it and calls onClose right away (the browser's own "close" event can
// arrive late or not at all, so nothing depends on it; it only covers the Esc key)
function dialog(html, cls = '', { locked = false, onClose } = {}) {
  const d = document.createElement('dialog');
  d.className = `modal ${cls}`;
  d.innerHTML = html;
  document.body.append(d);
  let shut = false;
  d.shut = () => {
    if (shut) return;
    shut = true;
    if (d.open) d.close();
    d.remove();
    onClose?.(d.dataset.next);
  };
  d.addEventListener('close', d.shut);
  if (locked) d.addEventListener('cancel', (ev) => ev.preventDefault());
  d.addEventListener('click', (ev) => {
    if (locked) return;
    const btn = ev.target.closest('[data-close]');
    if (btn?.dataset.next) d.dataset.next = btn.dataset.next;
    if (ev.target === d || btn) d.shut();
  });
  d.showModal();
  return d;
}

const errorText = (err) => t({ network: 'err_network', auth: 'err_auth', permission: 'err_permission', conflict: 'err_conflict' }[err?.code] || 'err_server');

/* ───────── start ───────── */

async function boot() {
  C = await (await fetch('config.json', { cache: 'no-store' })).json();
  T = strings[C.ui] || strings.pt;
  P = `blog-editor:${C.repo || location.host}:`;
  document.documentElement.lang = C.ui === 'en' ? 'en' : 'pt-BR';
  document.title = `${t('app')} · ${C.name}`;
  theme();
  app.innerHTML = `<p class="center muted">${e(t('loading'))}</p>`;

  // 1. the preview on this computer (npm run dev): no sign-in
  if (isLocalHost) {
    const lb = localBackend();
    if (await lb.check()) B = lb;
  }
  // 2. coming back from the e-mail link (#login=…)
  const code = new URLSearchParams(location.hash.slice(1)).get('login');
  if (!B && code && C.login?.email) {
    history.replaceState(null, '', location.pathname);
    app.innerHTML = `<p class="center muted">${e(t('email_opening'))}</p>`;
    try {
      const { session, email } = await emailLogin(C.login.email).open(code);
      local.set(`${P}session`, { session, email });
    } catch {
      return showLogin({ badLink: true });
    }
  }
  // 3. signed in before on this device
  if (!B) {
    const s = local.get(`${P}session`);
    const k = local.get(`${P}token`);
    if (s && C.login?.email) B = Object.assign(emailLogin(C.login.email).backend({ repo: C.repo, branch: C.branch, session: s.session }), { who: s.email });
    else if (k && C.login?.github) B = githubBackend({ repo: C.repo, branch: C.branch, token: k });
  }
  if (!B) return showLogin();
  try {
    await loadAll();
  } catch (err) {
    if (err?.code === 'auth') return signOut();
    app.innerHTML = `<div class="center"><p>${e(t('load_error'))}</p><button class="btn" data-act="reload">${e(t('try_again'))}</button></div>`;
    return;
  }
  window.addEventListener('hashchange', route);
  route();
}

function theme() {
  const th = C.theme || {};
  const root = document.documentElement.style;
  for (const [k, v] of Object.entries(th)) root.setProperty(`--${k.replace(/_/g, '-')}`, v);
  if (C.fonts?.length) {
    const st = document.createElement('style');
    st.textContent = C.fonts.map((f) => `@font-face{font-family:"${f.family}";src:url("${ROOT + f.src}");font-weight:${f.weight || 400};font-style:${f.style || 'normal'};font-display:swap}`).join('\n');
    document.head.append(st);
  }
  if (C.font_head) root.setProperty('--font-head', `"${C.font_head}", Georgia, serif`);
}

async function loadAll() {
  const reads = [];
  for (const L of C.languages) {
    reads.push(B.read(L.blog).then((text) => (S.files[L.code] = text)));
    if (L.site) reads.push(B.read(L.site).then((text) => (S.site[L.code] = text ? YAML.parse(text) || {} : {})).catch(() => (S.site[L.code] = {})));
    if (L.projects) reads.push(B.read(L.projects).then((text) => (S.projectsOf[L.code] = text ? (YAML.parse(text)?.projects || []).filter((p) => p && !p.hidden) : [])).catch(() => (S.projectsOf[L.code] = [])));
  }
  await Promise.all(reads);
  S.posts = M.postsFromFiles(C.languages.map((L) => ({ code: L.code, text: S.files[L.code] })));
  // projects for links and the photo picker: the first language has them all
  const first = S.projectsOf[C.languages[0].code] || [];
  S.projects = first.map((p) => ({
    slug: p.slug,
    name: p.name || p.slug,
    images: [...new Set([p.cover, p.hero && !/\.mp4$/i.test(p.hero.src || '') ? p.hero.src : p.hero?.poster, ...(p.modules || []).flatMap((m) => (m.t === 'image' ? [m.src] : m.t === 'grid' ? (m.items || []).map((i) => i.src) : []))])].filter((s) => s && /\.(webp|jpe?g|png|gif)$/i.test(s)),
  }));
}

/* ───────── signing in ───────── */

function showLogin({ badLink = false } = {}) {
  const gh = C.login?.github;
  const mail = C.login?.email;
  const [owner, repoName] = String(C.repo || '').split('/');
  const tokenUrl = `https://github.com/settings/personal-access-tokens/new?${new URLSearchParams({ name: t('token_name'), description: t('token_description'), target_name: owner, expires_in: '366', contents: 'write' })}`;
  app.innerHTML = `
  <main class="login">
    <header class="login__head">
      <p class="kicker">${e(t('app'))}</p>
      <h1>${e(t('login_title'))}</h1>
      <p>${e(t('login_lead', { name: C.name }))}</p>
    </header>
    ${mail ? `
    <form class="card" data-form="email">
      ${badLink ? `<p class="notice">${e(t('email_bad_link'))}</p>` : ''}
      <label class="field"><span>${e(t('email_label'))}</span><input type="email" name="email" autocomplete="email" required></label>
      <button class="btn" type="submit">${e(t('email_send'))}</button>
      <p class="hint">${e(t('email_hint'))}</p>
      <p class="sent" hidden></p>
    </form>` : ''}
    ${mail && gh ? `<p class="or">${e(t('or'))}</p>` : ''}
    ${gh ? `
    <form class="card" data-form="token">
      <h2>${e(t('gh_title'))}</h2>
      <p>${e(t('gh_lead'))}</p>
      <ol class="steps">
        <li>${e(t('gh_step1'))} <a class="btn btn--small btn--ghost" href="${e(tokenUrl)}" target="_blank" rel="noopener">${e(t('gh_open'))} ↗</a></li>
        <li>${e(t('gh_step2', { repo: repoName }))}</li>
        <li>${e(t('gh_step3'))}</li>
      </ol>
      <label class="field"><span>${e(t('gh_paste'))}</span><input type="password" name="token" autocomplete="off" spellcheck="false" required></label>
      <button class="btn" type="submit">${e(t('gh_enter'))}</button>
      <p class="notice" hidden></p>
    </form>` : ''}
  </main>`;
}

async function signIn(form) {
  const kind = form.dataset.form;
  const btn = $('button[type=submit]', form);
  btn.disabled = true;
  if (kind === 'email') {
    const email = form.email.value.trim();
    try {
      await emailLogin(C.login.email).send(email, location.href.split('#')[0]);
      const sent = $('.sent', form);
      sent.textContent = t('email_sent', { email });
      sent.hidden = false;
    } catch (err) {
      toast(errorText(err), 'is-bad');
    }
    btn.disabled = false;
    return;
  }
  const token = form.token.value.trim();
  const note = $('.notice', form);
  note.hidden = false;
  note.textContent = t('gh_checking');
  try {
    const gb = githubBackend({ repo: C.repo, branch: C.branch, token });
    const info = await gb.check();
    if (!info.canWrite) {
      note.textContent = t('gh_readonly');
      btn.disabled = false;
      return;
    }
    local.set(`${P}token`, token);
    B = gb;
    app.innerHTML = `<p class="center muted">${e(t('loading'))}</p>`;
    await loadAll();
    window.addEventListener('hashchange', route);
    route();
  } catch {
    note.textContent = t('gh_bad');
    btn.disabled = false;
  }
}

function signOut() {
  local.del(`${P}token`);
  local.del(`${P}session`);
  B = null;
  window.removeEventListener('hashchange', route);
  history.replaceState(null, '', location.pathname);
  showLogin();
}

/* ───────── screens ───────── */

function route() {
  const h = decodeURIComponent(location.hash);
  if (h.startsWith('#/post/')) return openPost(h.slice(7));
  if (h.startsWith('#/new')) return openNew(h.slice(6));
  return showList();
}

// what is waiting on this device: a new post never saved, or changes to a saved one
const copies = () => local.keys(`${P}copy:`).map((k) => ({ key: k.slice(`${P}copy:`.length), ...local.get(k) })).filter((c) => c.post);

function banner() {
  if (B.kind === 'local') return `<p class="banner">${e(t('local_banner'))}</p>`;
  return `<p class="banner">${e(t('online_banner'))}${B.who ? ` <span class="muted">${e(B.who)}</span>` : ''} <button class="link" data-act="signout">${e(t('signout'))}</button></p>`;
}

function showList() {
  S.post = null;
  document.body.classList.remove('is-editing');
  const waiting = copies();
  const fresh = waiting.filter((c) => c.key.startsWith('new-'));
  const changed = new Set(waiting.filter((c) => !c.key.startsWith('new-')).map((c) => c.key));
  const row = (post, href, chips) => {
    const langs = C.languages.length > 1 ? C.languages.filter((L) => post.langs[L.code]?.on && (post.langs[L.code].existed || post.langs[L.code].title)).map((L) => `<span class="tag">${e(L.short || L.code.toUpperCase())}</span>`).join('') : '';
    return `<li><a class="row" href="${e(href)}">
      <span class="row__img">${post.cover ? `<img src="${e(url(post.cover))}" alt="" loading="lazy">` : ''}</span>
      <span class="row__body">
        <span class="row__meta"><span>${e(post.date ? dateText(post.date, uiLocale()) : '')}</span>${langs ? `<span class="row__langs">${langs}</span>` : ''}</span>
        <span class="row__title">${e(titleOf(post))}</span>
        <span class="row__chips">${chips}</span>
      </span></a></li>`;
  };
  const chip = (k, cls = '') => `<span class="chip ${cls}">${e(t(k))}</span>`;
  app.innerHTML = `
  <header class="bar">
    <div class="bar__brand"><span class="kicker">${e(C.name)}</span><span class="bar__title">${e(C.title || t('app'))}</span></div>
    <a class="btn" href="#/new">+ ${e(t('new_post'))}</a>
  </header>
  ${banner()}
  <main class="list">
    ${!S.posts.length && !fresh.length ? `<p class="empty">${e(t('empty_list'))}</p>` : ''}
    <ul class="rows">
      ${fresh.map((c) => row(c.post, `#/new/${c.key}`, chip('chip_device', 'chip--mark'))).join('')}
      ${S.posts.map((p) => row(p, `#/post/${encodeURIComponent(p.id)}`, `${p.status === 'draft' ? chip('chip_draft') : ''}${changed.has(p.id) ? chip('chip_unsaved', 'chip--mark') : ''}`)).join('')}
    </ul>
  </main>`;
  scrollTo(0, 0);
}

function ensureLangs(post) {
  for (const L of C.languages) if (!post.langs[L.code]) post.langs[L.code] = { ...M.emptyLang(), on: false };
  return post;
}

async function openNew(key) {
  if (!key) {
    location.replace(`#/new/new-${Date.now().toString(36)}`);
    return;
  }
  const copy = local.get(`${P}copy:${key}`);
  S.key = key;
  S.base = null;
  S.post = ensureLangs(copy?.post || M.newPost(C.languages.map((L) => L.code)));
  S.resumed = !!copy?.post;
  await showEditor();
}

async function openPost(id) {
  const saved = S.posts.find((p) => p.id === id);
  if (!saved) return location.replace('#/');
  const copy = local.get(`${P}copy:${id}`);
  S.key = id;
  // a copy kept on this device is compared, when saved, with the version it started from
  S.base = ensureLangs(copy?.post && copy.base ? copy.base : clone(saved));
  S.post = ensureLangs(copy?.post ? copy.post : clone(saved));
  S.resumed = !!copy?.post;
  await showEditor();
}

async function showEditor() {
  const post = S.post;
  if (!post.langs[S.lang]) S.lang = (C.languages.find((L) => post.langs[L.code]?.on) || C.languages[0]).code;
  // the new photos of this post, kept on the device
  for (const src of M.imagesOf(post)) {
    if (src.startsWith('pending:') && !S.urls.has(src)) {
      const rec = await blobs.get(src);
      if (rec?.blob) S.urls.set(src, URL.createObjectURL(rec.blob));
    }
  }
  document.body.classList.add('is-editing');
  renderEditor();
  scrollTo(0, 0);
}

/* ───────── the editor ───────── */

const published = (post) => post && Object.values(post.langs).some((l) => l.published);
const changed = () => {
  if (!S.base) return true;
  if (S.post.cover !== S.base.cover || S.post.date !== S.base.date) return true;
  return C.languages.some((L) => !M.deepEqual(M.entryOf(S.post, L.code), M.entryOf(S.base, L.code)) || S.post.langs[L.code].on !== S.base.langs[L.code].on);
};

function statusText() {
  const post = S.post;
  const base = !S.base ? t('st_new') : post.status === 'draft' && !published(S.base) ? t('st_draft') : t('st_published');
  return S.base && changed() ? `${base} · ${t('st_unsaved')}` : base;
}

function actionsHtml() {
  const live = S.base && published(S.base) && S.base.status !== 'draft';
  return `<button class="btn btn--ghost" data-act="preview">${e(t('preview'))}</button>
    ${live ? '' : `<button class="btn btn--ghost" data-act="draft">${e(t('save_draft'))}</button>`}
    <button class="btn" data-act="publish">${e(t(live ? 'publish_changes' : 'publish'))}</button>`;
}

function renderEditor() {
  const post = S.post;
  const multi = C.languages.length > 1;
  app.innerHTML = `
  <header class="bar bar--edit">
    <a class="back" href="#/">← ${e(t('back'))}</a>
    <span class="state" data-state>${e(statusText())}</span>
    <div class="actions">${actionsHtml()}</div>
  </header>
  <main class="edit">
    ${S.resumed ? `<p class="banner banner--mark">${e(t('resumed'))} <button class="link" data-act="discard">${e(t('discard'))}</button></p>` : ''}
    <div class="problems" data-problems hidden></div>
    <section class="card shared">
      <div class="cover">
        <div class="cover__img" data-cover>${coverHtml()}</div>
        <div class="cover__side">
          <h2 class="card__title">${e(t('cover'))}</h2>
          <p class="hint">${e(t('cover_hint'))}</p>
          <button class="btn btn--ghost btn--small" data-act="pick-cover">${e(t(post.cover ? 'change_photo' : 'choose_photo'))}</button>
          <label class="field field--date"><span>${e(t('date'))}</span><input type="date" data-post="date" value="${e(post.date)}" required></label>
        </div>
      </div>
    </section>
    ${multi ? `<nav class="tabs" role="tablist">${C.languages.map((L) => `<button role="tab" class="tab${L.code === S.lang ? ' is-on' : ''}" aria-selected="${L.code === S.lang}" data-act="tab" data-code="${L.code}"><span class="dot${post.langs[L.code].on ? ' is-on' : ''}"></span>${e(L.label)}</button>`).join('')}</nav>` : ''}
    <section class="card lang" data-lang></section>
    ${S.base ? `<details class="more"><summary>${e(t('more_options'))}</summary>
      ${published(S.base) && S.base.status !== 'draft' ? `<button class="btn btn--ghost btn--small" data-act="unpublish">${e(t('unpublish'))}</button>` : ''}
      <button class="btn btn--danger btn--small" data-act="delete">${e(t('delete'))}</button>
    </details>` : ''}
  </main>
  <div class="dock">${actionsHtml()}</div>`;
  renderLang();
}

const coverHtml = () => (S.post.cover ? `<img src="${e(url(S.post.cover))}" alt="">` : `<button class="cover__empty" data-act="pick-cover">+ ${e(t('choose_photo'))}</button>`);

function field(label, input, hint = '', extra = '') {
  return `<label class="field"><span>${e(label)}</span>${input}${hint ? `<small class="hint">${hint}</small>` : ''}${extra}</label>`;
}

function renderLang() {
  const code = S.lang;
  const l = S.post.langs[code];
  const L = langOf(code);
  const others = C.languages.filter((x) => x.code !== code && S.post.langs[x.code]?.body.some((b) => !M.blockIsEmpty(b)));
  const empty = l.body.every(M.blockIsEmpty);
  const cats = [...new Set(S.posts.map((p) => p.langs[code]?.category).filter(Boolean))];
  const locked = l.published;
  const sec = $('[data-lang]');
  sec.innerHTML = `
    ${C.languages.length > 1 ? `<label class="switch"><input type="checkbox" data-l="on"${l.on ? ' checked' : ''}><span class="switch__ui" aria-hidden="true"></span><span>${e(t('lang_on', { lang: L.name }))}</span></label>
    ${l.on ? '' : `<p class="hint">${e(t('lang_off_note', { lang: L.name }))}</p>`}` : ''}
    <div class="lang__fields"${l.on ? '' : ' inert'}>
      <div class="field">
        <span class="field__row"><label for="f-title">${e(t('title'))}</label><span class="tools">${tool('italic')}</span></span>
        <textarea id="f-title" class="input--title" data-l="title" rows="1">${e(l.title)}</textarea>
        <small class="hint">${e(t('title_hint'))}</small>
      </div>
      ${field(t('excerpt'), `<textarea data-l="excerpt" rows="2">${e(l.excerpt)}</textarea>`, e(t('excerpt_hint')))}
      <div class="grid2">
        ${field(t('category'), `<input data-l="category" list="cats" value="${e(l.category)}" autocomplete="off"><datalist id="cats">${cats.map((c) => `<option value="${e(c)}">`).join('')}</datalist>`, e(t('category_hint')))}
        ${field(t('cover_alt'), `<input data-l="cover_alt" value="${e(l.cover_alt)}">`, e(t('alt_hint')))}
      </div>
      <h2 class="card__title card__title--body">${e(t('body'))}</h2>
      ${empty && others.length ? `<p class="copyfrom">${others.map((o) => `<button class="btn btn--ghost btn--small" data-act="copy-from" data-code="${o.code}">${e(t('copy_from', { lang: o.name }))}</button>`).join(' ')}<small class="hint">${e(t('copy_from_hint'))}</small></p>` : ''}
      <div class="blocks" data-blocks></div>
      <div class="add" role="group" aria-label="${e(t('add'))}"><span class="add__label">${e(t('add'))}</span>
        ${['p', 'h2', 'list', 'quote', 'img'].map((k) => `<button class="btn btn--ghost btn--small" data-act="add" data-type="${k}">+ ${e(t(`b_${k}`))}</button>`).join('')}
      </div>
      <details class="seo"${l.seo_title || l.description ? ' open' : ''}><summary>${e(t('seo'))}</summary>
        ${field(t('seo_title'), `<input data-l="seo_title" value="${e(l.seo_title)}" maxlength="90">`, e(t('seo_title_hint')), `<small class="count" data-count="seo_title"></small>`)}
        ${field(t('description'), `<textarea data-l="description" rows="2" maxlength="220">${e(l.description)}</textarea>`, e(t('description_hint')), `<small class="count" data-count="description"></small>`)}
        ${field(t('slug'), `<span class="slug"><span class="slug__base">${e(new URL(L.url, C.site_url || ROOT).href.replace(/^https?:\/\//, ''))}</span><input data-l="slug" value="${e(l.slug)}" autocapitalize="off" spellcheck="false"></span>`, e(t(locked ? 'slug_locked' : 'slug_hint')))}
      </details>
    </div>`;
  renderBlocks();
  counts();
  $$('textarea', sec).forEach(grow);
}

const tool = (k) => `<button type="button" class="tool tool--${k}" data-tool="${k}" title="${e(t(k))}" aria-label="${e(t(k))}">${{ bold: '<b>N</b>', italic: '<i>A</i>', link: '🔗' }[k]}<span>${e(t(k))}</span></button>`;

function renderBlocks() {
  const l = S.post.langs[S.lang];
  const box = $('[data-blocks]');
  if (!box) return;
  const opts = (sel) =>
    `<option value="">${e(t('no_project'))}</option>${S.projects.map((p) => `<option value="${e(p.slug)}"${p.slug === sel ? ' selected' : ''}>${e(p.name)}</option>`).join('')}`;
  box.innerHTML = l.body
    .map((b, i) => {
      const bar = `<div class="block__bar"><span class="block__name">${e(t(`b_${b.type}`))}</span>
        ${['p', 'list'].includes(b.type) ? `<span class="tools">${tool('bold')}${tool('italic')}${tool('link')}</span>` : b.type === 'quote' ? `<span class="tools">${tool('italic')}</span>` : ''}
        <span class="block__move">
          <button type="button" class="icon" data-act="up" title="${e(t('up'))}" aria-label="${e(t('up'))}"${i === 0 ? ' disabled' : ''}>↑</button>
          <button type="button" class="icon" data-act="down" title="${e(t('down'))}" aria-label="${e(t('down'))}"${i === l.body.length - 1 ? ' disabled' : ''}>↓</button>
          <button type="button" class="icon icon--del" data-act="del" title="${e(t('remove'))}" aria-label="${e(t('remove'))}">×</button>
        </span></div>`;
      let inner = '';
      if (b.type === 'p') inner = `<textarea data-b="text" rows="3" aria-label="${e(t('b_p'))}">${e(b.text)}</textarea>`;
      if (b.type === 'h2') inner = `<textarea class="input--h2" data-b="text" rows="1" aria-label="${e(t('b_h2'))}">${e(b.text)}</textarea>`;
      if (b.type === 'quote') inner = `<textarea class="input--quote" data-b="text" rows="2" aria-label="${e(t('b_quote'))}">${e(b.text)}</textarea>`;
      if (b.type === 'list') inner = `<textarea data-b="items" rows="3" aria-label="${e(t('b_list'))}">${e(b.items.join('\n'))}</textarea><small class="hint">${e(t('list_hint'))}</small>`;
      if (b.type === 'img')
        inner = `<div class="pic">
          <button type="button" class="pic__img" data-act="pick-img">${b.src ? `<img src="${e(url(b.src))}" alt="">` : `<span>+ ${e(t('choose_photo'))}</span>`}</button>
          <div class="pic__fields">
            ${field(t('img_alt'), `<input data-b="alt" value="${e(b.alt)}">`, e(t('alt_hint')))}
            ${field(t('img_caption'), `<input data-b="caption" value="${e(b.caption)}">`)}
            ${S.projects.length ? field(t('img_project'), `<select data-b="project">${opts(b.project)}</select>`) : ''}
          </div></div>`;
      if (b.type === 'raw') inner = `<p class="hint">${e(t('raw_note'))}</p>`;
      return `<div class="block block--${b.type}" data-i="${i}">${bar}${inner}</div>`;
    })
    .join('');
  $$('textarea', box).forEach(grow);
}

function counts() {
  const l = S.post.langs[S.lang];
  for (const [k, max] of [['seo_title', 60], ['description', 155]]) {
    const el = $(`[data-count="${k}"]`);
    if (!el) continue;
    const n = (l[k] || '').length;
    el.textContent = t('chars', { n, max });
    el.classList.toggle('is-over', n > max);
  }
}

// every change: kept on the device (until it's saved), and the status line updated
let saveTimer;
function touch() {
  const live = changed();
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    if (!S.post) return;
    if (live) local.set(`${P}copy:${S.key}`, { post: S.post, base: S.base, at: Date.now() });
    else local.del(`${P}copy:${S.key}`);
  }, 300);
  const st = $('[data-state]');
  if (st) st.textContent = statusText();
}

function onInput(ev) {
  const el = ev.target;
  if (!S.post || !(el.dataset.post || el.dataset.l || el.dataset.b)) return;
  const l = S.post.langs[S.lang];
  if (el.matches('textarea')) grow(el);
  if (el.dataset.post) S.post[el.dataset.post] = el.value;
  if (el.dataset.l) {
    const k = el.dataset.l;
    if (k === 'on') {
      l.on = el.checked;
      renderLang();
      $$('.tab .dot').forEach((d, i) => d.classList.toggle('is-on', S.post.langs[C.languages[i].code].on));
    } else {
      l[k] = el.value;
      if (k === 'slug') {
        l._slugTouched = true;
        el.value = el.value.toLowerCase().replace(/[^a-z0-9-]+/g, '-');
        l.slug = el.value;
      }
      // the address follows the title, until it's written by hand or the post is on the site
      if (k === 'title' && !l._slugTouched && !l.published) {
        l.slug = M.slugify(M.plain(l.title));
        const s = $('[data-l="slug"]');
        if (s) s.value = l.slug;
      }
      if (k === 'seo_title' || k === 'description') counts();
    }
  }
  if (el.dataset.b) {
    const b = l.body[Number(el.closest('[data-i]').dataset.i)];
    if (el.dataset.b === 'items') b.items = el.value.split('\n');
    else b[el.dataset.b] = el.value;
  }
  touch();
}

/* ───────── formatting: bold, highlight, link ───────── */

function wrapSelection(input, before, after, fallback) {
  const a = input.selectionStart ?? input.value.length;
  const z = input.selectionEnd ?? a;
  const sel = input.value.slice(a, z);
  // already marked: take the marks off
  if (sel && input.value.slice(a - before.length, a) === before && input.value.slice(z, z + after.length) === after) {
    input.setRangeText(sel, a - before.length, z + after.length, 'select');
  } else {
    const text = sel || fallback;
    input.setRangeText(before + text + after, a, z, 'end');
    input.setSelectionRange(a + before.length, a + before.length + text.length);
  }
  input.focus();
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

function linkDialog(input) {
  const a = input.selectionStart ?? input.value.length;
  const z = input.selectionEnd ?? a;
  const code = S.lang;
  const nav = S.site[code]?.nav || {};
  const posts = S.posts.filter((p) => p.id !== S.post.id && p.langs[code]?.on);
  const d = dialog(`
    <form method="dialog" class="modal__box">
      <h2>${e(t('link_title'))}</h2>
      ${field(t('link_text'), `<input name="text" value="${e(input.value.slice(a, z))}" required>`)}
      ${field(t('link_to'), `<select name="to">
        <optgroup label="${e(t('link_pages'))}">${(C.pages || []).map((k) => `<option value="${k}">${e(M.plain(nav[k] || k))}</option>`).join('')}</optgroup>
        ${posts.length ? `<optgroup label="${e(t('link_posts'))}">${posts.map((p) => `<option value="post:${e(p.id)}">${e(M.plain(p.langs[code].title))}</option>`).join('')}</optgroup>` : ''}
        ${S.projects.length ? `<optgroup label="${e(t('link_projects'))}">${S.projects.map((p) => `<option value="project:${e(p.slug)}">${e(p.name)}</option>`).join('')}</optgroup>` : ''}
        <option value="url">${e(t('link_url'))}</option>
      </select>`)}
      <label class="field" data-url hidden><span>https://</span><input name="url" type="url" placeholder="https://"></label>
      <div class="modal__actions"><button type="button" class="btn btn--ghost" data-close>${e(t('cancel'))}</button><button class="btn" value="ok">${e(t('link_insert'))}</button></div>
    </form>`);
  const f = $('form', d);
  f.to.addEventListener('change', () => {
    $('[data-url]', d).hidden = f.to.value !== 'url';
    f.url.required = f.to.value === 'url';
  });
  f.addEventListener('submit', (ev) => {
    ev.preventDefault();
    let to = f.to.value;
    if (to === 'url') {
      to = f.url.value.trim();
      if (!/^https?:\/\//.test(to)) to = `https://${to}`;
    }
    const text = f.text.value.trim().replace(/[[\]]/g, '');
    d.shut();
    input.setRangeText(`[${text}](${to})`, a, z, 'end');
    input.focus();
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

/* ───────── photos ───────── */

function pickPhoto(done) {
  const blogImgs = [...new Set(S.posts.flatMap(M.imagesOf))].filter((s) => !s.startsWith('pending:'));
  const tabs = [['upload', t('pick_upload')], ...(S.projects.length ? [['portfolio', t('pick_portfolio')]] : []), ...(blogImgs.length ? [['blog', t('pick_blog')]] : [])];
  const thumbs = (list) => list.map((s) => `<button type="button" class="thumb" data-src="${e(s)}"><img src="${e(url(s))}" alt="" loading="lazy"></button>`).join('');
  const d = dialog(`
    <div class="modal__box modal__box--wide">
      <div class="modal__head"><h2>${e(t('pick_title'))}</h2><button class="icon" data-close aria-label="${e(t('close'))}">×</button></div>
      ${tabs.length > 1 ? `<nav class="tabs tabs--small">${tabs.map(([k, label], i) => `<button type="button" class="tab${i ? '' : ' is-on'}" data-pane="${k}">${e(label)}</button>`).join('')}</nav>` : ''}
      <div class="pane" data-pane-body="upload">
        <label class="drop"><input type="file" accept="image/*"><b>${e(t('upload_cta'))}</b><span>${e(t('upload_drop'))}</span></label>
        <p class="hint" data-upload-note hidden></p>
      </div>
      ${S.projects.length ? `<div class="pane" data-pane-body="portfolio" hidden>
        <select data-project>${S.projects.map((p) => `<option value="${e(p.slug)}">${e(p.name)}</option>`).join('')}</select>
        <div class="thumbs" data-project-thumbs>${thumbs(S.projects[0].images)}</div></div>` : ''}
      ${blogImgs.length ? `<div class="pane" data-pane-body="blog" hidden><div class="thumbs">${thumbs(blogImgs)}</div></div>` : ''}
    </div>`, 'modal--pick');
  d.addEventListener('click', (ev) => {
    const tab = ev.target.closest('[data-pane]');
    if (tab) {
      $$('[data-pane]', d).forEach((x) => x.classList.toggle('is-on', x === tab));
      $$('[data-pane-body]', d).forEach((x) => (x.hidden = x.dataset.paneBody !== tab.dataset.pane));
    }
    const th = ev.target.closest('.thumb');
    if (th) {
      d.shut();
      done(th.dataset.src);
    }
  });
  $('[data-project]', d)?.addEventListener('change', (ev) => {
    $('[data-project-thumbs]', d).innerHTML = thumbs(S.projects.find((p) => p.slug === ev.target.value)?.images || []);
  });
  const input = $('input[type=file]', d);
  const take = async (file) => {
    if (!file) return;
    const note = $('[data-upload-note]', d);
    note.hidden = false;
    note.textContent = t('preparing');
    try {
      const img = await prepareImage(file, { ...(C.images || {}), bg: C.theme?.bg });
      const name = M.slugify(file.name.replace(/\.[^.]+$/, ''), 40) || 'foto';
      const key = `pending:${name}-${uid()}.${img.ext}`;
      await blobs.put(key, { blob: img.blob, name, ext: img.ext });
      S.urls.set(key, URL.createObjectURL(img.blob));
      toast(`${file.name} · ${img.w}×${img.h} · ${kb(img.blob.size, langOf(S.lang)?.locale)}`);
      d.shut();
      done(key);
    } catch {
      note.textContent = t('err_image');
    }
  };
  input.addEventListener('change', () => take(input.files[0]));
  const drop = $('.drop', d);
  drop.addEventListener('dragover', (ev) => {
    ev.preventDefault();
    drop.classList.add('is-over');
  });
  drop.addEventListener('dragleave', () => drop.classList.remove('is-over'));
  drop.addEventListener('drop', (ev) => {
    ev.preventDefault();
    drop.classList.remove('is-over');
    take(ev.dataTransfer.files[0]);
  });
}

/* ───────── preview ───────── */

function preview(code = S.lang) {
  const l = S.post.langs[code];
  const html = previewHtml({
    l,
    post: S.post,
    lang: langOf(code)?.locale || code,
    labels: S.site[code]?.blog_page || {},
    base: ROOT,
    url,
    dateText: dateText(S.post.date, code),
    minutes: M.minutesOf(l),
    projects: new Set(S.projects.map((p) => p.slug)),
  });
  const langs = C.languages.filter((L) => S.post.langs[L.code]?.on);
  const d = dialog(`
    <div class="pv">
      <div class="pv__bar">
        ${langs.length > 1 ? `<nav class="tabs tabs--small">${langs.map((L) => `<button type="button" class="tab${L.code === code ? ' is-on' : ''}" data-pv="${L.code}">${e(L.label)}</button>`).join('')}</nav>` : '<span></span>'}
        <button class="btn btn--small" data-close>${e(t('close'))}</button>
      </div>
      <iframe title="${e(t('preview'))}" sandbox="allow-same-origin"></iframe>
    </div>`, 'modal--pv');
  $('iframe', d).srcdoc = html;
  d.addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-pv]');
    if (b) {
      d.shut();
      preview(b.dataset.pv);
    }
  });
}

/* ───────── saving ───────── */

// what is missing before publishing (or before saving a draft, which asks only for a title)
function problems(post, kind) {
  const out = [];
  const on = C.languages.filter((L) => post.langs[L.code].on);
  const blank = (l) => !M.plain(l.title) && l.body.every(M.blockIsEmpty) && !l.excerpt.trim();
  if (kind === 'draft') {
    if (!on.some((L) => M.plain(post.langs[L.code].title))) out.push(t('need_any_title'));
    return out;
  }
  if (!on.length) out.push(t('need_lang'));
  if (!post.cover) out.push(t('need_cover'));
  const { slugs } = M.taken(S.posts, post.id);
  for (const L of on) {
    const l = post.langs[L.code];
    const lang = L.label;
    if (blank(l)) {
      out.push(t('blank_on', { lang }));
      continue;
    }
    if (!M.plain(l.title)) out.push(t('need_title', { lang }));
    if (!l.excerpt.trim()) out.push(t('need_excerpt', { lang }));
    if (l.body.every(M.blockIsEmpty)) out.push(t('need_body', { lang }));
    if (l.slug && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(l.slug)) out.push(t('slug_bad', { lang }));
    if (l.slug && slugs[L.code]?.has(l.slug)) out.push(t('slug_taken', { lang }));
  }
  return out;
}

function showProblems(list) {
  const box = $('[data-problems]');
  if (!box) return;
  box.hidden = !list.length;
  box.innerHTML = list.length ? `<b>${e(t('fix_first'))}</b><ul>${list.map((x) => `<li>${e(x)}</li>`).join('')}</ul>` : '';
  if (list.length) box.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function busy(text) {
  return dialog(`<div class="modal__box modal__box--busy"><span class="spinner" aria-hidden="true"></span><p>${e(text)}</p></div>`, 'modal--busy', { locked: true });
}

// a real date (YYYY-MM-DD): a post without one would stop the site from being built
const validDate = (d) => /^\d{4}-\d{2}-\d{2}$/.test(d || '') && !Number.isNaN(Date.parse(`${d}T00:00:00Z`));

// kind: draft | publish | unpublish | delete. force: save even though the post changed somewhere else
// since it was opened here (she said yes to replacing that version)
async function save(kind, { force = false } = {}) {
  const title = titleOf(S.post);
  if (!force && kind === 'delete' && !confirm(t('confirm_delete', { title }))) return;
  if (!force && kind === 'unpublish' && !confirm(t('confirm_unpublish', { title }))) return;
  const post = clone(S.post);
  if (kind === 'draft' || kind === 'unpublish') post.status = 'draft';
  if (kind === 'publish') post.status = 'published';
  if (!validDate(post.date)) post.date = M.today();
  // a language switched on but never written isn't saved (it would be an empty post on the site)
  for (const L of C.languages) {
    const l = post.langs[L.code];
    if (l.on && !l.existed && !M.plain(l.title) && l.body.every(M.blockIsEmpty) && kind === 'draft') l.on = false;
  }
  const list = kind === 'delete' || kind === 'unpublish' ? [] : problems(post, kind);
  showProblems(list);
  if (list.length) return;

  // a new post: look at the list again first (another device may have just made one with the same name)
  if (!post.id) {
    try {
      await loadAll();
    } catch {}
  }
  const others = S.posts.filter((p) => p.id !== post.id);
  if (!post.id) post.id = M.makeId(post, new Set(others.map((p) => p.id)));
  const { slugs } = M.taken(S.posts, post.id);
  for (const L of C.languages) {
    const l = post.langs[L.code];
    if (!l.on && !l.existed) continue;
    if (!l.slug) {
      let s = M.slugify(M.plain(l.title)) || post.id;
      for (let n = 2; slugs[L.code]?.has(s); n++) s = `${M.slugify(M.plain(l.title)) || post.id}-${n}`;
      l.slug = s;
    }
  }
  const wasLive = !!(S.base && published(S.base) && S.base.status !== 'draft');
  // republishing a post already on the site: the date of the change goes to Google too
  if (kind === 'publish' && wasLive && changed() && post.date !== M.today()) post.updated = M.today();

  // the new photos get their place: assets/blog/<post>/<name>. They go to the site's files (private), and
  // the build puts on the public site only the photos of published posts (admin/build.mjs)
  const dir = `${(C.images?.dir || 'assets/blog/').replace(/\/?$/, '/')}${post.id}/`;
  const uploads = [];
  const renamed = new Map();
  if (kind !== 'delete') {
    for (const src of M.imagesOf(post)) {
      if (!src.startsWith('pending:') || renamed.has(src)) continue;
      const rec = await blobs.get(src);
      if (!rec) continue;
      const path = `${dir}${src.slice('pending:'.length)}`;
      renamed.set(src, path);
      uploads.push({ path, bytes: new Uint8Array(await rec.blob.arrayBuffer()) });
    }
  }
  const swap = (s) => renamed.get(s) || s;
  post.cover = swap(post.cover);
  for (const l of Object.values(post.langs)) for (const b of l.body) if (b.type === 'img') b.src = swap(b.src);
  if (kind !== 'delete' && M.imagesOf(post).some((s) => s.startsWith('pending:'))) {
    toast(t('err_image'), 'is-bad');
    return;
  }

  // the picture for shared links: only when the post goes on the site (a draft leaves nothing public),
  // and again when the cover changes
  let share = null;
  if (kind === 'publish' && C.share && post.cover && (!wasLive || S.base.cover !== S.post.cover)) {
    try {
      const blob = await shareImage(url(S.post.cover), C.share.logo ? ROOT + C.share.logo : null, { pill: C.share.pill, bg: C.theme?.bg });
      share = { path: `${C.share.dir}post-${post.id}.jpg`, bytes: new Uint8Array(await blob.arrayBuffer()) };
    } catch {}
  }

  // photos of its own folder that the post doesn't use anymore (replaced or taken out), when no other post uses them
  const stillUsed = new Set(others.flatMap(M.imagesOf));
  const keep = new Set(kind === 'delete' ? [] : M.imagesOf(post));
  const dropped = [...new Set(S.base ? M.imagesOf(S.base) : [])].filter((s) => s.startsWith(dir) && !keep.has(s) && !stillUsed.has(s));

  const base = S.base;
  const verbs = { draft: 'rascunho', publish: wasLive ? 'atualiza' : 'publica', unpublish: 'tira do ar', delete: 'apaga' };
  const message = `Blog: ${verbs[kind]} "${titleOf(post)}" (pelo editor)`;
  const wait = busy(t(kind === 'publish' && B.kind !== 'local' ? 'publishing' : 'saving'));
  try {
    await B.save(message, async (read) => {
      const texts = {};
      for (const L of C.languages) texts[L.code] = await read(L.blog);
      // the post as it is now in the files: did someone change it since it was opened here?
      const latest = M.postsFromFiles(C.languages.map((L) => ({ code: L.code, text: texts[L.code] }))).find((p) => p.id === post.id);
      if (!base && latest) throw new SaveError('conflict', 'a post with this id was just created');
      if (base && !force && C.languages.some((L) => !M.deepEqual(latest ? M.entryOf(latest, L.code) : null, M.entryOf(base, L.code)))) throw new SaveError('stale');
      const changes = [...uploads, ...(share ? [share] : []), ...dropped.map((path) => ({ path, delete: true }))];
      for (const L of C.languages) {
        const text = texts[L.code];
        const entry = kind === 'delete' ? null : M.entryOf(post, L.code);
        const next = M.writePost(text, post.id, entry, `# ${C.name}: blog (${L.label}). Feito pelo editor do blog (/admin/).\n`);
        if (next !== text && !(text == null && entry == null)) changes.push({ path: L.blog, text: next });
      }
      if (kind === 'delete' && C.share) changes.push({ path: `${C.share.dir}post-${post.id}.jpg`, delete: true });
      return changes;
    });
  } catch (err) {
    wait.shut();
    if (err?.code === 'stale') {
      if (confirm(t('confirm_stale', { title }))) return save(kind, { force: true });
      toast(t('stale_kept'), 'is-bad');
      return;
    }
    if (err?.code === 'auth') {
      toast(errorText(err), 'is-bad');
      return signOut();
    }
    toast(errorText(err), 'is-bad');
    console.error(err);
    return;
  }
  // saved: the photos are on the site now, the copy on the device isn't needed anymore
  clearTimeout(saveTimer);
  for (const [from, to] of renamed) {
    if (S.urls.has(from)) S.urls.set(to, S.urls.get(from));
    blobs.del(from);
  }
  local.del(`${P}copy:${S.key}`);
  try {
    await loadAll();
  } catch {}
  wait.shut();
  if (kind === 'delete') {
    toast(t('removed'));
    return location.replace('#/');
  }
  const saved = S.posts.find((p) => p.id === post.id);
  done(kind, saved || post);
}

function done(kind, post) {
  const head = B.kind === 'local' ? ['saved_local', 'saved_local_note'] : kind === 'publish' ? ['published', 'published_note'] : kind === 'unpublish' ? ['unpublished', ''] : ['saved_draft', 'saved_draft_note'];
  const onSite = B.kind === 'local' || post.status !== 'draft';
  const links = onSite
    ? C.languages.filter((L) => post.langs[L.code]?.on).map((L) => `<a class="btn btn--ghost" href="${e(ROOT + L.url + post.langs[L.code].slug + '/')}" target="_blank" rel="noopener">${e(t('see_on_site', { lang: L.name }))} ↗</a>`).join('')
    : '';
  dialog(`
    <div class="modal__box modal__box--done">
      <p class="done__mark" aria-hidden="true">✓</p>
      <h2>${e(t(head[0]))}</h2>
      ${head[1] ? `<p>${e(t(head[1]))}</p>` : ''}
      ${links ? `<p class="done__links">${links}</p>` : ''}
      <div class="modal__actions"><button class="btn btn--ghost" data-close data-next="list">${e(t('back_to_posts'))}</button><button class="btn" data-close data-next="edit">${e(t('keep_editing'))}</button></div>
    </div>`, '', {
    onClose: (next) => {
      if (next === 'list') return (location.hash = '#/');
      const here = `#/post/${encodeURIComponent(post.id)}`;
      if (location.hash !== here) location.replace(here);
      else openPost(post.id);
    },
  });
}

/* ───────── clicks ───────── */

document.addEventListener('input', onInput);
// the e-mail link opened in a tab where the editor was already open: start again with it
window.addEventListener('hashchange', () => {
  if (location.hash.startsWith('#login=')) location.reload();
});
document.addEventListener('submit', (ev) => {
  const f = ev.target.closest('[data-form]');
  if (!f) return;
  ev.preventDefault();
  signIn(f);
});
// the formatting buttons keep the cursor in the text (on a phone, a tap would close the keyboard)
document.addEventListener('pointerdown', (ev) => {
  if (ev.target.closest('[data-tool]')) ev.preventDefault();
});
document.addEventListener('click', (ev) => {
  const tb = ev.target.closest('[data-tool]');
  if (tb) {
    const input = tb.closest('.block, .field')?.querySelector('textarea, input');
    if (!input) return;
    if (tb.dataset.tool === 'bold') wrapSelection(input, '**', '**', t('bold').toLowerCase());
    if (tb.dataset.tool === 'italic') wrapSelection(input, '*', '*', t('italic').toLowerCase());
    if (tb.dataset.tool === 'link') linkDialog(input);
    return;
  }
  const a = ev.target.closest('[data-act]');
  if (!a) return;
  const act = a.dataset.act;
  const l = S.post?.langs[S.lang];
  const i = Number(a.closest('[data-i]')?.dataset.i);
  if (act === 'reload') location.reload();
  if (act === 'signout') signOut();
  if (act === 'tab') {
    S.lang = a.dataset.code;
    $$('.tabs .tab').forEach((x) => {
      x.classList.toggle('is-on', x === a);
      x.setAttribute('aria-selected', x === a);
    });
    renderLang();
  }
  if (act === 'add') {
    const type = a.dataset.type;
    const b = type === 'list' ? { type, items: [''] } : type === 'img' ? { type, src: '', alt: '', caption: '', project: '' } : { type, text: '' };
    l.body.push(b);
    renderBlocks();
    touch();
    const el = $(`[data-i="${l.body.length - 1}"]`);
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    if (type === 'img') pickPhoto((src) => setBlockImage(l.body.length - 1, src));
    else el?.querySelector('textarea')?.focus({ preventScroll: true });
  }
  if (act === 'up' || act === 'down') {
    const j = act === 'up' ? i - 1 : i + 1;
    [l.body[i], l.body[j]] = [l.body[j], l.body[i]];
    renderBlocks();
    touch();
    $(`[data-i="${j}"] [data-act="${act}"]`)?.focus();
  }
  if (act === 'del') {
    l.body.splice(i, 1);
    if (!l.body.length) l.body.push({ type: 'p', text: '' });
    renderBlocks();
    touch();
  }
  if (act === 'pick-img') pickPhoto((src) => setBlockImage(i, src));
  if (act === 'pick-cover')
    pickPhoto((src) => {
      S.post.cover = src;
      $('[data-cover]').innerHTML = coverHtml();
      $('[data-act="pick-cover"].btn').textContent = t('change_photo');
      touch();
    });
  if (act === 'copy-from') {
    const from = S.post.langs[a.dataset.code];
    l.body = clone(from.body).map((b) => (b.type === 'img' ? { ...b, alt: '', caption: '' } : b));
    if (!l.cover_alt) l.cover_alt = '';
    renderLang();
    touch();
  }
  if (act === 'preview') preview();
  if (['draft', 'publish', 'unpublish', 'delete'].includes(act)) save(act);
  if (act === 'discard' && confirm(t('confirm_discard'))) {
    local.del(`${P}copy:${S.key}`);
    S.base ? openPost(S.post.id) : location.replace('#/');
  }
});

function setBlockImage(i, src) {
  const b = S.post.langs[S.lang].body[i];
  if (!b) return;
  b.src = src;
  renderBlocks();
  touch();
}

boot().catch((err) => {
  console.error(err);
  app.innerHTML = `<p class="center">${e(String(err.message || err))}</p>`;
});
