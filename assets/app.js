/* buenas.design · v1
   Pages arrive as finished HTML (scripts/build.mjs). This file only adds
   behavior: header + mobile menu, things appearing as you scroll, stamps and
   stickers drifting at their own speed, and the contact form. */

(() => {
  const $ = (sel, el = document) => el.querySelector(sel);
  const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ───────── header ───────── */
  const hdr = $('#hdr');
  let lastY = window.scrollY;
  const onScroll = () => {
    if (!hdr) return;
    const y = window.scrollY;
    hdr.classList.toggle('is-solid', y > 40);
    // hides while going down the page, comes back as soon as you scroll up
    if (Math.abs(y - lastY) > 6) {
      hdr.classList.toggle('is-hidden', y > lastY && y > 400 && !document.body.classList.contains('menu-open'));
      lastY = y;
    }
  };
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  const menuBtn = $('#menu-btn');
  const setMenu = (open) => {
    document.body.classList.toggle('menu-open', open);
    menuBtn?.setAttribute('aria-expanded', String(open));
  };
  menuBtn?.addEventListener('click', () => setMenu(!document.body.classList.contains('menu-open')));
  $$('#nav a').forEach((a) => a.addEventListener('click', () => setMenu(false)));
  window.addEventListener('keydown', (e) => e.key === 'Escape' && setMenu(false));

  /* ───────── appear on scroll ───────── */
  // Titles (data-reveal="title"): each word sits in a mask and slides up on its own.
  if (!reduceMotion) {
    $$('[data-reveal="title"]').forEach((el) => {
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      const texts = [];
      while (walker.nextNode()) texts.push(walker.currentNode);
      let i = 0;
      texts.forEach((node) => {
        const frag = document.createDocumentFragment();
        node.textContent.split(/(\s+)/).forEach((part) => {
          if (!part) return;
          if (/^\s+$/.test(part)) return frag.append(part);
          const mask = document.createElement('span');
          mask.className = 'w';
          const word = document.createElement('span');
          word.className = 'w__i';
          word.style.setProperty('--i', String(i++));
          word.textContent = part;
          mask.append(word);
          frag.append(mask);
        });
        node.replaceWith(frag);
      });
    });
  }

  const reveal = $$('[data-reveal]');
  // A picture behind its curtain (clip-path closed) has no visible area, so the observer
  // would never see it: pictures are watched through their parent instead.
  const groups = new Map(); // watched element → elements to reveal
  reveal.forEach((el) => {
    const target = el.dataset.reveal === 'img' ? el.parentElement : el;
    if (!groups.has(target)) groups.set(target, []);
    groups.get(target).push(el);
  });
  const show = (target, order) =>
    (groups.get(target) || []).forEach((el, k) => {
      el.style.setProperty('--d', `${Math.min((order + k) * 0.09, 0.55)}s`);
      el.classList.add('is-in');
    });
  if (reduceMotion || !('IntersectionObserver' in window)) {
    reveal.forEach((el) => el.classList.add('is-in'));
  } else {
    const io = new IntersectionObserver(
      (entries) => {
        // things that come into view together appear one after another
        entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top || a.boundingClientRect.left - b.boundingClientRect.left)
          .forEach((e, i) => {
            show(e.target, i);
            io.unobserve(e.target);
          });
      },
      { rootMargin: '0px 0px -8% 0px', threshold: 0.06 },
    );
    groups.forEach((_, target) => io.observe(target));
    // Safety net: whatever is already on screen shows up even if the observer is late
    // (background tabs, slow devices).
    setTimeout(() => {
      let i = 0;
      groups.forEach((els, target) => {
        if (els.every((el) => el.classList.contains('is-in'))) return;
        const r = target.getBoundingClientRect();
        if (r.top < window.innerHeight && r.bottom > 0) {
          show(target, i++);
          io.unobserve(target);
        }
      });
    }, 600);
  }

  /* ───────── airport board: labels flip through letters before settling ───────── */
  const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const flip = (el) => {
    const final = el.textContent;
    const chars = Array.from(final);
    el.setAttribute('aria-label', final);
    let frame = 0;
    const total = 16 + chars.length; // each letter settles a little after the one before
    const tick = () => {
      frame++;
      el.textContent = chars
        .map((ch, i) => (!/[a-z]/i.test(ch) || frame > 8 + i * 0.6 ? ch : LETTERS[(Math.random() * 26) | 0]))
        .join('');
      if (frame < total) requestAnimationFrame(() => setTimeout(tick, 28));
      else el.textContent = final;
    };
    tick();
  };
  if (!reduceMotion && 'IntersectionObserver' in window) {
    const flipIo = new IntersectionObserver(
      (entries) =>
        entries.forEach((e) => {
          if (!e.isIntersecting) return;
          flipIo.unobserve(e.target);
          setTimeout(() => flip(e.target), 250);
        }),
      { rootMargin: '0px 0px -10% 0px' },
    );
    $$('.kicker:not(:has(*))').forEach((el) => flipIo.observe(el));
  }

  /* ───────── everything that moves with the scroll ─────────
     data-speed     stamps and pictures drift at their own speed (--py)
     data-drift     the destinations ticker slides sideways (--px)
     data-route     a dotted route draws itself and the plane flies along it
     data-progress  the itinerary line fills in as you go down
     --sy           page scroll, used by the round badges to turn */
  const drifting = $$('[data-speed]');
  const sliding = $$('[data-drift]');
  const progress = $$('[data-progress]');
  const routes = $$('[data-route]').map((svg) => {
    const path = $('.route__path', svg);
    return { svg, path, mask: $('.route__mask', svg), plane: $('.route__plane', svg), len: path.getTotalLength() };
  });
  // 0 when the element's top reaches the bottom of the screen, 1 when its bottom reaches the middle
  const passed = (r, vh) => Math.min(Math.max((vh - r.top) / (r.height + vh * 0.5), 0), 1);
  const visible = (r) => r.bottom > -200 && r.top < window.innerHeight + 200;

  if (reduceMotion) {
    routes.forEach(({ mask, plane }) => {
      mask.style.strokeDashoffset = '0';
      plane.style.display = 'none';
    });
    progress.forEach((el) => el.style.setProperty('--p', '1'));
  } else if (drifting.length || sliding.length || routes.length || progress.length || $('.badge')) {
    let queued = false;
    const update = () => {
      queued = false;
      const vh = window.innerHeight;
      const mid = vh / 2;
      document.documentElement.style.setProperty('--sy', String(Math.round(window.scrollY)));
      for (const el of drifting) {
        // measure the section, not the picture, so its own movement doesn't feed back
        const host = el.closest('section') || el.parentElement;
        const r = host.getBoundingClientRect();
        if (!visible(r)) continue;
        const offset = r.top + r.height / 2 - mid;
        el.style.setProperty('--py', `${(-offset * Number(el.dataset.speed)).toFixed(1)}px`);
      }
      for (const el of sliding) {
        const r = el.parentElement.getBoundingClientRect();
        if (!visible(r)) continue;
        el.style.setProperty('--px', `${((r.top - mid) * 0.5 * Number(el.dataset.drift)).toFixed(1)}px`);
      }
      for (const rt of routes) {
        const r = rt.svg.getBoundingClientRect();
        if (!visible(r)) continue;
        const p = Math.min(passed(r, vh) * 1.15, 1);
        rt.mask.style.strokeDashoffset = String(1 - p);
        const at = rt.path.getPointAtLength(p * rt.len);
        const ahead = rt.path.getPointAtLength(Math.min(p * rt.len + 2, rt.len));
        const back = rt.path.getPointAtLength(Math.max(p * rt.len - 2, 0));
        const angle = (Math.atan2(ahead.y - back.y, ahead.x - back.x) * 180) / Math.PI;
        rt.plane.setAttribute('transform', `translate(${at.x.toFixed(1)} ${at.y.toFixed(1)}) rotate(${angle.toFixed(1)}) scale(1.6)`);
        rt.plane.style.opacity = p > 0.02 ? '1' : '0';
      }
      for (const el of progress) {
        const r = el.getBoundingClientRect();
        if (!visible(r)) continue;
        el.style.setProperty('--p', Math.min(Math.max((mid - r.top) / r.height, 0), 1).toFixed(3));
      }
    };
    const queue = () => {
      if (!queued) {
        queued = true;
        requestAnimationFrame(update);
      }
    };
    window.addEventListener('scroll', queue, { passive: true });
    window.addEventListener('resize', queue);
    update();
  }

  /* ───────── Instagram: latest posts from a Behold JSON feed (contact.instagram_feed) ───────── */
  const ig = $('#ig');
  const feed = ig?.dataset.feed?.trim();
  if (ig && feed) {
    fetch(feed)
      .then((res) => (res.ok ? res.json() : Promise.reject(res.status)))
      .then((data) => {
        const posts = (Array.isArray(data) ? data : data.posts || []).slice(0, 6);
        posts.forEach((p) => {
          const img = p.sizes?.medium?.mediaUrl || p.thumbnailUrl || p.mediaUrl;
          if (!img || !p.permalink) return;
          const a = document.createElement('a');
          a.href = p.permalink;
          a.target = '_blank';
          a.rel = 'noopener';
          a.innerHTML = '<img loading="lazy" alt="">';
          a.querySelector('img').src = img;
          a.querySelector('img').alt = (p.prunedCaption || p.caption || '').slice(0, 120);
          ig.append(a);
        });
        ig.hidden = !ig.children.length;
      })
      .catch(() => {}); // without the feed, the profile link above is enough
  }

  /* ───────── boarding passes tilt towards the mouse (data-tilt) ───────── */
  if (!reduceMotion && window.matchMedia('(hover: hover)').matches) {
    $$('[data-tilt]').forEach((card) => {
      card.addEventListener('mousemove', (e) => {
        const r = card.getBoundingClientRect();
        const x = (e.clientX - r.left) / r.width - 0.5;
        const y = (e.clientY - r.top) / r.height - 0.5;
        card.style.setProperty('--ry', `${(x * 7).toFixed(2)}deg`);
        card.style.setProperty('--rx', `${(-y * 6).toFixed(2)}deg`);
      });
      card.addEventListener('mouseleave', () => {
        card.style.setProperty('--ry', '0deg');
        card.style.setProperty('--rx', '0deg');
      });
    });
  }

  /* ───────── contact form ───────── */
  const form = $('#contact-form');
  form?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const status = $('#form-status');
    status.className = 'form__status';
    status.textContent = '';

    let firstBad = null;
    ['#f-name', '#f-email'].map((s) => $(s, form)).forEach((input) => {
      const bad = !input.value.trim() || (input.type === 'email' && !input.checkValidity());
      input.setAttribute('aria-invalid', String(bad));
      if (bad && !firstBad) firstBad = input;
    });
    if (firstBad) {
      status.textContent = form.dataset.error;
      status.classList.add('is-error');
      firstBad.focus();
      return;
    }

    const done = () => {
      $('#form-fields').hidden = true;
      const box = $('#form-done');
      box.hidden = false;
      box.focus();
    };
    // If sending fails (or there is no service set up yet), say so and show the address.
    // The visitor's email app never opens by itself.
    const failed = () => {
      status.textContent = `${form.dataset.fallback} `;
      const a = document.createElement('a');
      a.href = `mailto:${form.dataset.email}`;
      a.textContent = form.dataset.email;
      status.append(a, '.');
      status.classList.add('is-error');
    };

    // The message goes to the inbox through a form service (contact.form_endpoint in site.yml).
    const endpoint = (form.dataset.endpoint || '').trim();
    if (!endpoint) return failed();
    const btn = form.querySelector('[type="submit"]');
    btn.disabled = true;
    try {
      const res = await fetch(endpoint, { method: 'POST', body: new FormData(form), headers: { Accept: 'application/json' } });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || String(data.success) === 'false') throw new Error(data.message || String(res.status));
      form.reset();
      done();
    } catch {
      failed();
    } finally {
      btn.disabled = false;
    }
  });

  const year = $('#year');
  if (year) year.textContent = String(new Date().getFullYear());
})();
