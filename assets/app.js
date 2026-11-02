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
        // split on ordinary spaces only: a no-break space (the last two words that fmt() keeps together) stays inside the word
        node.textContent.split(/([ \t\n\r]+)/).forEach((part) => {
          if (!part) return;
          if (/^[ \t\n\r]+$/.test(part)) return frag.append(part);
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

  /* ───────── portfolio cards: on hover, the project's images take turns like a gif ───────── */
  if (!reduceMotion && window.matchMedia('(hover: hover) and (pointer: fine)').matches) {
    $$('.card[data-flip]').forEach((card) => {
      const frame = $('.card__img', card);
      let imgs = null;
      let timer = 0;
      let k = -1;
      const show = (i) => imgs.forEach((im, j) => im.classList.toggle('is-on', j === i));
      card.addEventListener('pointerenter', () => {
        // the images are only fetched the first time the mouse comes by
        imgs ??= card.dataset.flip.split('|').map((s) => {
          const im = new Image();
          im.className = 'card__flip';
          im.alt = '';
          im.decoding = 'async';
          im.src = s;
          frame.append(im);
          return im;
        });
        clearInterval(timer);
        timer = setInterval(() => {
          // a frame that hasn't arrived yet is skipped, so the cover never flashes empty
          for (let t = 0; t < imgs.length; t++) {
            k = (k + 1) % (imgs.length + 1);
            if (k === imgs.length || imgs[k].complete) break;
          }
          show(k);
        }, 650);
      });
      card.addEventListener('pointerleave', () => {
        clearInterval(timer);
        k = -1;
        if (imgs) show(-1);
      });
    });
  }

  /* ───────── portfolio: the purple mosaic opens up as you scroll (data-mosaic) ───────── */
  // It starts zoomed in on the middle picture (filling the purple frame) and shrinks back to the whole
  // mosaic while its section passes; the section is taller than the screen and the frame stays put (sticky).
  // The mosaic is laid out at the big size and scaled DOWN (not a small one scaled up), so the
  // pictures are drawn at full size and stay sharp while zoomed in.
  const mosaic = $('[data-mosaic]');
  if (mosaic && !reduceMotion) {
    const frame = $('.mosaic__frame', mosaic);
    const grid = $('.mosaic__grid', mosaic);
    const center = $('.mosaic__tile--center', mosaic);
    // the tiles around start hidden behind the zoom: fetch them now, so none pops in while it opens
    $$('img[loading="lazy"]', grid).forEach((im) => { im.loading = 'eager'; });
    let zoom = 1;
    const measure = () => {
      Object.assign(grid.style, { transform: 'none', width: '', height: '', left: '', top: '' });
      grid.style.removeProperty('--g');
      const g = grid.getBoundingClientRect();
      const c = center.getBoundingClientRect();
      zoom = Math.max(g.width / c.width, g.height / c.height) * 1.04; // the middle picture covers the frame
      const gap = parseFloat(getComputedStyle(grid).getPropertyValue('--g')) || 12;
      const cx = (c.left - g.left + c.width / 2) * zoom;
      const cy = (c.top - g.top + c.height / 2) * zoom;
      const f = frame.getBoundingClientRect();
      Object.assign(grid.style, { width: `${g.width * zoom}px`, height: `${g.height * zoom}px`, left: `${f.width / 2 - cx}px`, top: `${f.height / 2 - cy}px`, transformOrigin: `${cx}px ${cy}px` });
      grid.style.setProperty('--g', `${gap * zoom}px`);
    };
    let queued = false;
    const paint = () => {
      queued = false;
      const r = mosaic.getBoundingClientRect();
      const p = Math.min(Math.max(-r.top / (r.height - window.innerHeight), 0), 1);
      const eased = 1 - (1 - p) ** 2;
      grid.style.transform = `scale(${(1 + (1 / zoom - 1) * eased).toFixed(4)})`;
    };
    const queue = () => {
      if (!queued) { queued = true; requestAnimationFrame(paint); }
    };
    window.addEventListener('scroll', queue, { passive: true });
    window.addEventListener('resize', () => { measure(); queue(); });
    measure();
    paint();
  }

  /* ───────── testimonials: the arrows move one card at a time, in an endless loop ───────── */
  // The cards are copied once before and once after; whenever the strip comes to rest inside a copy it
  // jumps (invisibly) to the same spot in the real set, so it keeps going round in both directions.
  $$('.quotes-box').forEach((box) => {
    const strip = $('.quotes', box);
    const track = $('.quotes__track', box);
    const real = $$('.quote', track);
    if (real.length < 2) return;
    // every other card sits a little lower; set here (not with :nth-child) so the copies match
    real.forEach((q, i) => q.classList.toggle('is-low', i % 2 === 1));
    const copy = () =>
      real.map((q) => {
        const c = q.cloneNode(true);
        c.setAttribute('aria-hidden', 'true');
        return c;
      });
    track.prepend(...copy());
    track.append(...copy());
    track.classList.add('is-loop');
    const setW = () => real[0].offsetLeft - track.children[0].offsetLeft;
    const step = () => real[1].offsetLeft - real[0].offsetLeft;
    const settle = () => {
      const w = setW();
      if (strip.scrollLeft < w * 0.5) strip.scrollLeft += w;
      else if (strip.scrollLeft > w * 1.5) strip.scrollLeft -= w;
    };
    strip.scrollLeft = setW();
    let t = 0;
    const onRest = () => {
      clearTimeout(t);
      t = setTimeout(settle, 140);
    };
    if ('onscrollend' in window) strip.addEventListener('scrollend', settle);
    else strip.addEventListener('scroll', onRest, { passive: true });
    window.addEventListener('resize', onRest);
    $$('.quotes__arrow', box).forEach((btn) =>
      btn.addEventListener('click', () => {
        settle();
        strip.scrollBy({ left: Number(btn.dataset.step) * step(), behavior: reduceMotion ? 'auto' : 'smooth' });
      }),
    );
  });

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
     data-float     project pictures in the purple bands drift up/down, sideways and tilt */
  const drifting = $$('[data-speed]');
  const sliding = $$('[data-drift]');
  const floating = $$('[data-float]');
  const progress = $$('[data-progress]');
  const routes = $$('[data-route]').map((svg) => {
    const path = $('.route__path', svg);
    return { svg, path, mask: $('.route__mask', svg), plane: $('.route__plane', svg), len: path.getTotalLength(), vbw: svg.viewBox.baseVal.width };
  });
  // the route shrinks with the screen; the plane keeps at least this size (px) so it still reads on phones
  const PLANE_MIN_PX = 34;
  const visible = (r) => r.bottom > -200 && r.top < window.innerHeight + 200;

  if (reduceMotion) {
    routes.forEach(({ mask, plane }) => {
      mask.style.strokeDashoffset = '0';
      plane.style.display = 'none';
    });
    progress.forEach((el) => el.style.setProperty('--p', '1'));
  } else if (drifting.length || sliding.length || routes.length || progress.length || floating.length) {
    let queued = false;
    const update = () => {
      queued = false;
      const vh = window.innerHeight;
      const mid = vh / 2;
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
        // 0 when the route enters the screen, 1 when it leaves; the plane stops just before the end
        const p = Math.min(Math.max((vh - r.top) / (vh + r.height), 0), 0.97);
        rt.mask.style.strokeDashoffset = String(1 - p);
        const at = rt.path.getPointAtLength(p * rt.len);
        const ahead = rt.path.getPointAtLength(Math.min(p * rt.len + 2, rt.len));
        const back = rt.path.getPointAtLength(Math.max(p * rt.len - 2, 0));
        const angle = (Math.atan2(ahead.y - back.y, ahead.x - back.x) * 180) / Math.PI;
        const scale = Math.max(1.6, PLANE_MIN_PX / (24 * (r.width / rt.vbw)));
        rt.plane.setAttribute('transform', `translate(${at.x.toFixed(1)} ${at.y.toFixed(1)}) rotate(${angle.toFixed(1)}) scale(${scale.toFixed(2)})`);
        rt.plane.style.opacity = p > 0.02 ? '1' : '0';
      }
      for (const el of floating) {
        const r = el.closest('section').getBoundingClientRect();
        if (!visible(r)) continue;
        const k = (r.top + r.height / 2 - mid) / vh; // about -1 … 1 while the band crosses the screen
        const side = Number(el.dataset.side);
        // up/down at its own speed, outwards (away from the text) as the band enters and leaves, and a tilt.
        // On phones the stamps already sit at the panel's edges: they only bob a little, so they never get cut
        const wide = window.innerWidth > 760;
        el.style.setProperty('--fy', `${(-k * vh * Number(el.dataset.float) * (wide ? 2 : 0.1)).toFixed(1)}px`);
        el.style.setProperty('--fx', `${(wide ? Math.abs(k) * 220 * side : 0).toFixed(1)}px`);
        el.style.setProperty('--fr', `${(k * (wide ? 28 : 6) * side).toFixed(2)}deg`);
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

  /* ───────── boarding passes side by side (Services, data-boarding) ─────────
     On a computer one is open and the others show only their stub; clicking a stub opens that one
     (its photos only show up around it once it has finished opening).
     Below 1001px they are all open, one under the other, and the stubs are just decoration. */
  $$('[data-boarding]').forEach((box) => {
    const tickets = $$('.tk', box);
    const wide = window.matchMedia('(min-width: 1001px)');
    const show = (open) =>
      tickets.forEach((t) => {
        const on = t === open;
        const stub = $('.tk__stub', t);
        t.classList.toggle('is-open', on);
        $('.tk__main', t).inert = wide.matches && !on;
        stub.setAttribute('aria-expanded', String(wide.matches ? on : true));
        // below 1001px the stub is only decoration: out of the tab order and hidden from screen readers
        if (wide.matches) stub.removeAttribute('tabindex');
        else stub.setAttribute('tabindex', '-1');
        stub.toggleAttribute('aria-hidden', !wide.matches);
      });
    let opening;
    tickets.forEach((t) =>
      $('.tk__stub', t).addEventListener('click', () => {
        if (!wide.matches || t.classList.contains('is-open')) return;
        show(t);
        t.classList.add('is-opening');
        clearTimeout(opening);
        opening = setTimeout(() => t.classList.remove('is-opening'), reduceMotion ? 0 : 800);
      })
    );
    const sync = () => show(tickets.find((t) => t.classList.contains('is-open')) || tickets[0]);
    wide.addEventListener('change', sync);
    sync();
  });

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
      form.classList.add('is-sent', 'tone-purple');
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
