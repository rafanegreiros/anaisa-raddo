(() => {
  const media = matchMedia('(prefers-reduced-motion: reduce)');
  const story = document.querySelector('.scroll-story');
  const stage = document.querySelector('.story-stage');
  const canvas = document.querySelector('.sequence-canvas');
  const ctx = canvas.getContext('2d', { alpha: false });
  const beats = [...document.querySelectorAll('.beat')];
  const progress = document.querySelector('.progress-track span');
  const count = document.querySelector('.frame-count');
  const clamp = (n, a = 0, b = 1) => Math.max(a, Math.min(b, n));
  const smooth = n => { n = clamp(n); return n * n * (3 - 2 * n); };
  const variant = matchMedia('(max-width: 700px)').matches ? 'mobile' : 'desktop';
  const cache = new Map(), pending = new Set(), failures = new Set();
  const cacheLimit = variant === 'mobile' ? 48 : 40;
  let frames = [], clips = [], desired = 0, painted = -1, queued = false, direction = 1, inRange = true;

  function paint(index) {
    const img = cache.get(index);
    if (!img || media.matches) return;
    const scale = Math.max(canvas.width / img.naturalWidth, canvas.height / img.naturalHeight);
    const w = img.naturalWidth * scale, h = img.naturalHeight * scale;
    ctx.drawImage(img, (canvas.width - w) / 2, (canvas.height - h) / 2, w, h);
    painted = index;
    canvas.dataset.frame = String(index);
    canvas.dataset.clip = String(frames[index].clip);
    canvas.classList.add('ready');
  }

  function trim() {
    if (cache.size <= cacheLimit) return;
    const removable = [...cache.keys()].filter(i => i !== desired && i !== painted)
      .sort((a, b) => Math.abs(b - desired) - Math.abs(a - desired));
    while (cache.size > cacheLimit && removable.length) cache.delete(removable.shift());
  }

  // Only nearby decoded images are kept. Requests follow the latest scroll target,
  // so a fast jump never waits for the entire intervening sequence to download.
  function pump() {
    if (!frames.length || media.matches || !inRange) return;
    const candidates = [desired];
    for (let n = 1; n <= 18; n++) {
      candidates.push(desired + n * direction);
      if (n <= 8) candidates.push(desired - n * direction);
    }
    for (const index of candidates) {
      if (pending.size >= 4) break;
      if (index < 0 || index >= frames.length || cache.has(index) || pending.has(index) || failures.has(index)) continue;
      pending.add(index);
      const img = new Image();
      img.decoding = 'async';
      img.onload = async () => {
        try { await img.decode(); } catch { /* onload already confirmed a usable image */ }
        pending.delete(index);
        cache.set(index, img);
        if (index === desired) paint(index);
        trim();
        pump();
      };
      img.onerror = () => { pending.delete(index); failures.add(index); pump(); };
      img.src = frames[index].url;
    }
  }

  function resize() {
    const ratio = Math.min(devicePixelRatio || 1, 1.5);
    canvas.width = Math.round(stage.clientWidth * ratio);
    canvas.height = Math.round(stage.clientHeight * ratio);
    if (cache.has(desired)) paint(desired);
    else if (painted >= 0) paint(painted);
    request();
  }

  function render() {
    queued = false;
    if (media.matches || !frames.length) return;
    const rect = story.getBoundingClientRect();
    const p = clamp(-rect.top / Math.max(1, story.offsetHeight - stage.offsetHeight));
    inRange = rect.bottom > 0 && rect.top < innerHeight;
    const next = Math.round(p * (frames.length - 1));
    if (next !== desired) direction = next > desired ? 1 : -1;
    desired = next;
    const clip = clips.find(c => desired < c.end) || clips[clips.length - 1];
    const active = clip.id - 1;
    const local = (desired - clip.start) / Math.max(1, clip.frames - 1);
    beats.forEach((beat, i) => {
      const show = i === active;
      const fadeIn = active === 0 ? 1 : smooth(local / .1);
      const fadeOut = active === clips.length - 1 ? 1 : 1 - smooth((local - .88) / .12);
      beat.style.opacity = show ? fadeIn * fadeOut : 0;
      beat.style.visibility = show ? 'visible' : 'hidden';
      beat.setAttribute('aria-hidden', String(!show));
      beat.inert = !show;
    });
    progress.style.transform = `scaleX(${p})`;
    count.textContent = `0${clip.id} / 04`;
    if (desired !== painted) paint(desired);
    pump();
  }

  function request() { if (!queued) { queued = true; requestAnimationFrame(render); } }
  const observer = new IntersectionObserver(entries => entries.forEach(e => e.target.classList.toggle('visible', e.isIntersecting)), { threshold: .12 });
  document.querySelectorAll('.reveal').forEach(el => observer.observe(el));
  function mode() {
    document.body.classList.toggle('motion', !media.matches);
    beats.forEach(b => { b.inert = false; b.removeAttribute('aria-hidden'); });
    resize();
  }
  addEventListener('scroll', request, { passive: true });
  addEventListener('resize', resize);
  media.addEventListener('change', mode);
  mode();
  fetch('assets/hero-sequence/manifest.json').then(r => {
    if (!r.ok) throw new Error('Hero manifest unavailable');
    return r.json();
  }).then(manifest => {
    let start = 0;
    clips = manifest.clips.map(c => {
      const clip = { ...c, start, end: start + c.frames };
      for (let n = 1; n <= c.frames; n++) frames.push({ clip: c.id, url: `assets/hero-sequence/${variant}/${String(c.id).padStart(2, '0')}/${String(n).padStart(4, '0')}.webp` });
      start = clip.end;
      return clip;
    });
    request();
  }).catch(error => console.warn('Static hero preserved:', error.message));
})();
