// Where the editor reads and saves the site's files. Three ways, the same two calls (read, save):
//   local   the preview on this computer (npm run dev): saves straight into the folder, nothing goes online
//   github  the site's repository on GitHub, with the owner's GitHub key: saving publishes (the site's
//           GitHub Action builds and puts it online in about a minute)
//   email   the same as github, through the site's login helper (admin/helper/worker.js): the person signs in
//           with a link sent to their e-mail and never needs a GitHub account
// No screen here: this file also runs in Node, for the tests.

const b64 = (bytes) => {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
};
const utf8 = (text) => new TextEncoder().encode(text);
const bytesOf = (c) => (c.bytes ? c.bytes : utf8(c.text));

export class SaveError extends Error {
  constructor(code, detail) {
    super(detail || code);
    this.code = code; // auth | permission | network | conflict | server
  }
}

/* ───────── the preview on this computer ───────── */

export function localBackend(base = '') {
  const call = async (url, init) => {
    let r;
    try {
      r = await fetch(base + url, { cache: 'no-store', ...init });
    } catch (e) {
      throw new SaveError('network', e.message);
    }
    if (!r.ok && r.status !== 404) throw new SaveError('server', `${r.status} ${await r.text()}`);
    return r;
  };
  const read = async (path) => {
    const r = await call(`/__cms/file?path=${encodeURIComponent(path)}`);
    return r.status === 404 ? null : r.text();
  };
  return {
    kind: 'local',
    async check() {
      const r = await fetch(`${base}/__cms/ping`, { cache: 'no-store' }).catch(() => null);
      return !!(r && r.ok && (await r.json().catch(() => ({}))).ok);
    },
    read,
    // build(read) → the changes: [{ path, text } | { path, bytes } | { path, delete: true }]
    async save(message, build) {
      const changes = await build(read);
      if (!changes.length) return { unchanged: true };
      const body = { message, changes: changes.map((c) => (c.delete ? { path: c.path, delete: true } : { path: c.path, base64: b64(bytesOf(c)) })) };
      await call('/__cms/save', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      return { ok: true };
    },
  };
}

/* ───────── GitHub (directly with a key, or through the e-mail login helper) ───────── */

export function githubBackend({ api = 'https://api.github.com', repo, branch = 'main', token, author }) {
  const call = async (method, url, body, accept = 'application/vnd.github+json') => {
    let r;
    try {
      r = await fetch(`${api}${url}`, {
        method,
        cache: 'no-store',
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: accept,
          'X-GitHub-Api-Version': '2022-11-28',
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch (e) {
      throw new SaveError('network', e.message);
    }
    if (r.status === 401) throw new SaveError('auth', await r.text());
    return r;
  };
  const json = async (method, url, body) => {
    const r = await call(method, url, body);
    if (r.status === 403) throw new SaveError('permission', await r.text());
    if (!r.ok) throw Object.assign(new SaveError(r.status === 409 || r.status === 422 ? 'conflict' : 'server', `${method} ${url}: ${r.status} ${await r.text()}`), { status: r.status });
    return r.json();
  };
  const R = `/repos/${repo}`;
  const path = (p) => p.split('/').map(encodeURIComponent).join('/');
  // a file at a commit (or at the tip of the branch): its text, null when it doesn't exist
  const read = async (p, ref = branch) => {
    const r = await call('GET', `${R}/contents/${path(p)}?ref=${encodeURIComponent(ref)}`, null, 'application/vnd.github.raw+json');
    if (r.status === 404) return null;
    if (r.status === 403) throw new SaveError('permission', await r.text());
    if (!r.ok) throw new SaveError('server', `${p}: ${r.status}`);
    return r.text();
  };
  const exists = async (p, ref) => {
    const r = await call('GET', `${R}/contents/${path(p)}?ref=${encodeURIComponent(ref)}`);
    return r.ok;
  };
  return {
    kind: 'github',
    // who is signed in and whether they can save (the key needs "Contents: read and write" on the repository)
    async check() {
      const info = await json('GET', R);
      return { ok: true, canWrite: !!(info.permissions?.push || info.permissions?.admin || info.permissions?.maintain), name: info.full_name };
    },
    read: (p) => read(p),
    // One commit with every change, on top of the latest version of the branch. build(read) gets a reader of
    // that version, so a post is always merged into the newest file (someone else may have just saved).
    // When the branch moves while we save, it starts again from the new version.
    async save(message, build) {
      for (let attempt = 0; attempt < 4; attempt++) {
        try {
          const done = await once();
          if (done) return done;
        } catch (e) {
          // the branch moved while saving (GitHub or the e-mail helper said so): start again on top of it
          if (e.code === 'conflict' && e.status && attempt < 3) continue;
          throw e;
        }
      }
      throw new SaveError('conflict');
      async function once() {
        const ref = await json('GET', `${R}/git/ref/heads/${branch}`);
        const head = ref.object.sha;
        const commit = await json('GET', `${R}/git/commits/${head}`);
        const changes = await build((p) => read(p, head));
        const tree = [];
        for (const c of changes) {
          if (c.delete) {
            if (await exists(c.path, head)) tree.push({ path: c.path, mode: '100644', type: 'blob', sha: null });
            continue;
          }
          const blob = await json('POST', `${R}/git/blobs`, { content: b64(bytesOf(c)), encoding: 'base64' });
          tree.push({ path: c.path, mode: '100644', type: 'blob', sha: blob.sha });
        }
        if (!tree.length) return { unchanged: true, sha: head };
        const newTree = await json('POST', `${R}/git/trees`, { base_tree: commit.tree.sha, tree });
        const created = await json('POST', `${R}/git/commits`, { message, tree: newTree.sha, parents: [head], ...(author ? { author } : {}) });
        // "not a fast forward" (someone saved in the meantime) comes back as a conflict: the loop above starts again
        await json('PATCH', `${R}/git/refs/heads/${branch}`, { sha: created.sha, force: false });
        return { ok: true, sha: created.sha };
      }
    },
  };
}

/* ───────── the e-mail login (admin/helper/worker.js) ───────── */

export function emailLogin(helper) {
  const post = async (url, body) => {
    let r;
    try {
      r = await fetch(`${helper}${url}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    } catch (e) {
      throw new SaveError('network', e.message);
    }
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new SaveError(r.status === 401 ? 'auth' : 'server', data.error || String(r.status));
    return data;
  };
  return {
    // sends the link (the helper answers the same whether or not the e-mail can write: nobody can guess who can)
    send: (email, back) => post('/login', { email, back }),
    // the link's code → a session that lasts 30 days on this device
    open: (code) => post('/session', { code }),
    // the same calls as GitHub, through the helper, which holds the GitHub key and checks every request
    backend: ({ repo, branch, session }) => githubBackend({ api: `${helper}/gh`, repo, branch, token: session }),
  };
}
