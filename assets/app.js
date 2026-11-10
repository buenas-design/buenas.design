/* buenas.design · v1
   Pages arrive as finished HTML (scripts/build.mjs). This file only adds
   behavior: header + mobile menu, things appearing as you scroll, stamps and
   stickers drifting at their own speed, and the contact form. */

(() => {
  const $ = (sel, el = document) => el.querySelector(sel);
  const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // a project that opens with a video (Mom & Pops) plays it by itself while it is on screen, like the covers
  // below (data-autoplay); with "reduce motion" it stays on the first frame, with the controls to play it
  if (reduceMotion) $$('.project__hero video').forEach((v) => { v.pause(); v.currentTime = 0; v.controls = true; });

  // An iPhone in Low Power Mode (the yellow battery) never lets a video start by itself, not even a silent one: the
  // project's video stayed on its first frame until she pressed play (her report, 05/11/2026). So when the phone
  // refuses, the videos that should be playing start at the first tap on the page, which the phone takes as the
  // person asking for it (a swipe doesn't count). Until then the poster shows.
  // An app that opens links in a bare web view (no inline video) would open the phone's full-screen player on that
  // tap: then it leaves full screen and the videos stay on their posters for the rest of the visit.
  // A refused video isn't asked again on every scroll (data-blocked) until the tap, and gets its first bytes
  // ready meanwhile (preload metadata), so it starts sooner when the tap comes.
  const wake = []; // starts what should be playing now
  const touches = ['touchend', 'pointerup', 'click', 'keydown'];
  let waiting = false;
  let noInline = false;
  const onTouch = () => {
    $$('video[data-blocked]').forEach((v) => { delete v.dataset.blocked; });
    wake.forEach((f) => f());
  };
  const play = (v) => {
    if (noInline) return;
    const p = v.play();
    if (p && p.catch) p.catch((e) => {
      if (noInline || !e || e.name !== 'NotAllowedError') return;
      v.dataset.blocked = '';
      if (v.preload === 'none') v.preload = 'metadata';
      if (waiting) return;
      waiting = true;
      touches.forEach((t) => document.addEventListener(t, onTouch, { capture: true, passive: true }));
    });
  };
  const leaveFullScreen = (e) => {
    const v = e.target;
    noInline = true;
    touches.forEach((t) => document.removeEventListener(t, onTouch, { capture: true }));
    v.pause();
    if (v.webkitExitFullscreen) try { v.webkitExitFullscreen(); } catch (err) { /* already out */ }
  };

  // a project cover that is a video (big panels, cards, previous/next, guide cases; Create Joy, then all the
  // projects with a video, 04/11/2026): it only loads and plays while it is on screen, and pauses when it leaves;
  // with "reduce motion" (or without IntersectionObserver) the poster stays
  // On a phone held upright a panel is tall: it takes its tall, lighter version (just the middle of the video,
  // which is all that shows); a video without one (its middle would cut the logo) stays still and shows the
  // panel's picture instead. Sideways (the panel is wide again) and on a computer: the big video. Turning the
  // phone swaps it back and forth (the big one is kept in data-src-lg / data-poster-lg).
  const covers = $$('video[data-autoplay]');
  const panelVideos = covers.filter((v) => v.dataset.srcSm || v.dataset.stillSm);
  // the page carries the light poster (what a phone held upright shows); the big one is in data-poster-lg
  panelVideos.forEach((v) => { v.dataset.srcLg = v.getAttribute('src') || ''; if (!v.dataset.posterLg) v.dataset.posterLg = v.getAttribute('poster') || ''; });
  const tall = window.matchMedia('(max-width: 760px) and (orientation: portrait)');
  const plays = (v) => 'autoplay' in v.dataset;
  const fitPanels = () => panelVideos.forEach((v) => {
    const src = tall.matches ? v.dataset.srcSm || '' : v.dataset.srcLg;
    const poster = tall.matches ? v.dataset.posterSm || v.dataset.stillSm : v.dataset.posterLg;
    if (poster && v.getAttribute('poster') !== poster) v.poster = poster;
    if (src) {
      v.dataset.autoplay = '';
      if (v.getAttribute('src') !== src) v.src = src;
    } else if (plays(v) || v.hasAttribute('src')) {
      v.pause();
      delete v.dataset.autoplay;
      v.removeAttribute('src');
      v.load(); // stops a download already under way and shows the picture
    }
  });
  fitPanels();
  // The first request for a video the site's server hasn't sent in a while waits 0.3–1 s at the server
  // (measured 05/11/2026, worst right after publishing): asking each video that will play for its first 2 bytes
  // as soon as the page is idle gets the server ready, so the real request later comes back right away.
  // (The project's own video is already being fetched by then: it has no src, only <source>, and is skipped.)
  if (!reduceMotion && !(navigator.connection && navigator.connection.saveData) && window.fetch) {
    const warmUp = () => covers.forEach((v) => {
      const u = plays(v) && v.getAttribute('src');
      if (u) fetch(u, { headers: { Range: 'bytes=0-1' }, priority: 'low' }).catch(() => {});
    });
    if (window.requestIdleCallback) requestIdleCallback(warmUp, { timeout: 3000 });
    else setTimeout(warmUp, 1500);
  }
  let syncCovers = () => {};
  const onTurn = () => { fitPanels(); syncCovers(); };
  if (tall.addEventListener) tall.addEventListener('change', onTurn);
  else if (tall.addListener) tall.addListener(onTurn);
  if (!reduceMotion && 'IntersectionObserver' in window) {
    // the panels stack (sticky): one stays "on screen" under the next one, so it only plays until the next
    // panel has slid all the way over it; then it pauses (and stops downloading)
    const near = new Set();
    const covered = (v) => {
      const p = v.closest('.panel');
      const n = p && p.nextElementSibling;
      // + its bottom margin: the last panel can only climb to one margin below the one before it (the sticky
      // panels can't leave the section), so without it the second to last would never count as covered
      return !!(n && n.classList.contains('panel') && n.getBoundingClientRect().top <= p.getBoundingClientRect().top + (parseFloat(getComputedStyle(p).marginBottom) || 0) + 1);
    };
    const sync = () => near.forEach((v) => {
      if (!plays(v) || covered(v)) v.pause();
      else if (v.paused && !('blocked' in v.dataset)) play(v);
    });
    syncCovers = sync;
    wake.push(sync);
    const vio = new IntersectionObserver((entries) => {
      entries.forEach((e) => {
        if (e.isIntersecting) near.add(e.target);
        else { near.delete(e.target); e.target.pause(); }
      });
      sync();
      // starts one screen before it shows (it was 200px: a video waited up to 3 s on its poster on a weak signal,
      // 05/11/2026), so it already moves when it comes into view
    }, { rootMargin: '100% 0px' });
    covers.forEach((v) => { vio.observe(v); v.addEventListener('webkitbeginfullscreen', leaveFullScreen); });
    let ticking = false;
    window.addEventListener('scroll', () => {
      if (ticking || !near.size) return;
      ticking = true;
      requestAnimationFrame(() => { ticking = false; sync(); });
    }, { passive: true });
  }

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
        if (!imgs) {
          imgs = card.dataset.flip.split('|').map((s) => {
            const im = new Image();
            im.className = 'card__flip';
            im.alt = '';
            im.decoding = 'async';
            im.src = s;
            // only shown once it is decoded, so it never flashes blank on the way in
            im.decode().then(() => { im.dataset.ready = '1'; }, () => {});
            frame.append(im);
            return im;
          });
        }
        clearInterval(timer);
        timer = setInterval(() => {
          // a frame that isn't ready yet is skipped, so the cover never flashes empty
          for (let t = 0; t < imgs.length; t++) {
            k = (k + 1) % (imgs.length + 1);
            if (k === imgs.length || imgs[k].dataset.ready) break;
          }
          show(k);
        }, 400);   // 0,4 s cada foto (pedido dela, 02/11/2026)
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

  /* ───────── contact form, questionnaires and the investment guide ───────── */
  const form = $('form[data-endpoint]');
  // a questionnaire keeps its answers in this browser until they are sent, so a client can stop and come
  // back later (or try again if sending fails). Private windows may not allow it: then it just doesn't save.
  const draftKey = form?.dataset.draft;
  const store = {
    get: () => { try { return JSON.parse(localStorage.getItem(draftKey) || 'null'); } catch { return null; } },
    set: (v) => { try { localStorage.setItem(draftKey, JSON.stringify(v)); } catch {} },
    clear: () => { try { localStorage.removeItem(draftKey); } catch {} },
  };
  let saving;
  const named = (name) => $$(`[name="${CSS.escape(name)}"]`, form);
  // every answer, in the order of the page; the ticked options of a question become one line ("A, B")
  // (the draft keeps them as a list, so an option with a comma comes back ticked too)
  const answers = (asList) => {
    const all = {};
    for (const el of form.elements) {
      if (!el.name || el.name in all) continue;
      const ticked = named(el.name).filter((x) => x.checked).map((x) => x.value);
      all[el.name] = /^(radio|checkbox)$/.test(el.type) ? (asList ? ticked : ticked.join(', ')) : el.value;
    }
    return all;
  };
  if (draftKey) {
    const saved = store.get();
    if (saved) {
      for (const [name, value] of Object.entries(saved)) {
        if (name.startsWith('_')) continue;
        named(name).forEach((el) => {
          if (/^(radio|checkbox)$/.test(el.type)) el.checked = [].concat(value).includes(el.value);
          else el.value = value;
        });
      }
    }
    // how many questions already have an answer
    const questions = $$('[data-q]', form);
    const fill = $('#q-fill');
    const count = $('#q-count');
    const progress = () => {
      const n = questions.filter((q) => $$('input, textarea, select', q).some((el) => (/^(radio|checkbox)$/.test(el.type) ? el.checked : el.value.trim()))).length;
      fill.style.width = `${questions.length ? (n / questions.length) * 100 : 0}%`;
      count.textContent = form.dataset.progress.replace('{n}', n).replace('{total}', questions.length);
    };
    form.addEventListener('input', (e) => {
      // once answered, the question loses its coral warning (sending checks everything again)
      const box = e.target.closest('[data-q], .field');
      if (box) [box, ...$$('[aria-invalid]', box)].forEach((el) => el.setAttribute('aria-invalid', 'false'));
      progress();
      clearTimeout(saving);
      saving = setTimeout(() => store.set(answers(true)), 300);
    });
    progress();
  }

  form?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const status = $('#form-status');
    status.className = 'form__status';
    status.textContent = '';

    let firstBad = null;
    $$('[required]', form).forEach((input) => {
      const bad = /^(radio|checkbox)$/.test(input.type)
        ? !named(input.name).some((x) => x.checked)
        : !input.value.trim() || !input.checkValidity();
      input.setAttribute('aria-invalid', String(bad));
      if (bad && !firstBad) firstBad = input;
    });
    // a questionnaire question where at least one box must be ticked
    $$('[data-required]', form).forEach((group) => {
      const boxes = $$('input', group);
      const bad = !boxes.some((x) => x.checked);
      group.setAttribute('aria-invalid', String(bad));
      if (bad && (!firstBad || group.compareDocumentPosition(firstBad) & Node.DOCUMENT_POSITION_FOLLOWING)) firstBad = boxes[0];
    });
    if (firstBad) {
      status.textContent = form.dataset.error;
      status.classList.add('is-error');
      firstBad.focus();
      return;
    }

    const done = () => {
      status.textContent = '';
      $('#form-fields').hidden = true;
      form.classList.add('is-sent', 'tone-purple');
      const box = $('#form-done');
      box.hidden = false;
      box.focus();
      if (draftKey) box.scrollIntoView({ block: 'center', behavior: reduceMotion ? 'auto' : 'smooth' });
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
    const all = answers();
    // a questionnaire's e-mail says who answered it in the subject; the guide's, also the ticket chosen
    const who = all.business?.trim() || all.name?.trim();
    if (draftKey) all._subject = `${all._subject} - ${who}`;
    if (form.dataset.choice) all._subject = `${all._subject}: ${all[form.dataset.choice]} - ${who}`;
    const body = new FormData();
    for (const [name, value] of Object.entries(all)) body.append(name, value);
    // Web3Forms (contact.form_key) answers in a second or two; FormSubmit took 19 s and 25 s in the test of
    // 10/11/2026. The page keeps FormSubmit's field names (and FormSubmit itself as the action for visitors
    // without JavaScript), so they are renamed here.
    let url = endpoint;
    if (form.dataset.key) {
      url = 'https://api.web3forms.com/submit';
      const honey = body.get('_honey');
      for (const k of ['_honey', '_template', '_next', '_captcha']) body.delete(k);
      if (honey) body.set('botcheck', 'on');
      if (body.has('_subject')) { body.set('subject', body.get('_subject')); body.delete('_subject'); }
      body.set('access_key', form.dataset.key);
      body.set('from_name', location.hostname.replace(/^www\./, ''));
    }
    const btn = form.querySelector('[type="submit"]');
    // The form service can take several seconds to answer: the button says it is sending, so the click
    // never looks like it did nothing, and after 60 s the visitor gets the error with the e-mail address
    // (in the test of 10/11/2026 FormSubmit took 19 s and 25 s to answer, and both messages arrived).
    const pt = document.documentElement.lang.startsWith('pt');
    const label = btn.innerHTML;
    btn.disabled = true;
    btn.setAttribute('aria-busy', 'true');
    btn.textContent = pt ? 'Enviando…' : 'Sending…';
    status.textContent = pt ? 'Enviando sua mensagem…' : 'Sending your message…';
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 60000);
    try {
      const res = await fetch(url, { method: 'POST', body, headers: { Accept: 'application/json' }, signal: ctrl.signal });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || String(data.success) === 'false') throw new Error(data.message || String(res.status));
      form.reset();
      // (a save still waiting would bring the emptied form back as a draft)
      clearTimeout(saving);
      if (draftKey) store.clear();
      done();
    } catch {
      failed();
    } finally {
      clearTimeout(timer);
      btn.disabled = false;
      btn.removeAttribute('aria-busy');
      btn.innerHTML = label;
    }
  });

  // "I want this ticket": ticks that ticket in the form at the end of the page (also on buttons added later,
  // like the ones of a proposal that opens with its key)
  document.addEventListener('click', (e) => {
    const pick = e.target.closest('[data-pick]');
    const choice = form && $$(`input[name="${CSS.escape(form.dataset.choice || '')}"]`, form).find((x) => x.value === pick?.dataset.pick);
    if (!choice) return;
    // scrolls without touching the address: a proposal keeps its key after the "#"
    e.preventDefault();
    choice.checked = true;
    choice.dispatchEvent(new Event('input', { bubbles: true }));
    form.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
  });

  const year = $('#year');
  if (year) year.textContent = String(new Date().getFullYear());
})();
