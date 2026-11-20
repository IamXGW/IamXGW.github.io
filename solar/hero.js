import { createSolSun, createFallbackSun } from './sun.js';
import { budgets, makeParticles, curveTable, entranceProgress, entranceExcursion,
  project, repel, moveSun, moveParticle, Flock } from './stream.js';

const spriteColors = ['109,203,244', '122,177,254', '248,121,21', '250,153,76', '245,246,251'];
// The desktop reference is a 3290 px Retina capture of a 320:153 artwork.
const referenceWidth = 1645;
const referenceHeight = referenceWidth * 153 / 320;

function makeSprites() {
  return spriteColors.map(color => Array.from({ length: 5 }, (_, blur) => {
    const tile = document.createElement('canvas');
    tile.width = tile.height = 64;
    const brush = tile.getContext('2d');
    const gradient = brush.createRadialGradient(32, 32, 0, 32, 32, 32);
    gradient.addColorStop(0, `rgba(255,255,255,${1 - 0.12 * blur})`);
    gradient.addColorStop(0.09 + 0.035 * blur, `rgba(${color},${0.9 - 0.12 * blur})`);
    gradient.addColorStop(0.25 + 0.04 * blur, `rgba(${color},0.16)`);
    gradient.addColorStop(1, `rgba(${color},0)`);
    brush.fillStyle = gradient;
    brush.fillRect(0, 0, 64, 64);
    return tile;
  }));
}

function copyMask(width, height, rects) {
  if (!rects.length) return 'none';
  const cutouts = rects.map(({ x, y, width, height }) =>
    `<rect x="${x}" y="${y}" width="${width}" height="${height}"/>`).join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
    <defs><filter id="blur" x="-100%" y="-100%" width="300%" height="300%">
    <feGaussianBlur stdDeviation="17.5"/></filter>
    <mask id="copy" maskUnits="userSpaceOnUse" x="0" y="0" width="${width}" height="${height}">
    <rect width="100%" height="100%" fill="white"/><g fill="black" filter="url(#blur)">${cutouts}</g></mask></defs>
    <rect width="100%" height="100%" fill="white" mask="url(#copy)"/></svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

function copyVisibility(x, y, rects) {
  let alpha = 1;
  for (const r of rects) {
    const dx = Math.max(r.left - x, 0, x - r.right);
    const dy = Math.max(r.top - y, 0, y - r.bottom);
    const distance = dx * dx + dy * dy;
    if (distance < 1225) alpha = Math.min(alpha, Math.sqrt(distance) / 35);
  }
  return alpha;
}

function mountSolarHero(host) {
  const artwork = host.querySelector('#solar-artwork');
  const canvas = artwork?.querySelector('.solar-stream');
  const ctx = canvas?.getContext('2d');
  if (!ctx) return;
  const button = host.querySelector('.solar-playback');
  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  const phone = matchMedia('(hover: none) and (pointer: coarse)').matches;
  const lowPower = navigator.hardwareConcurrency && navigator.hardwareConcurrency <= 4;
  let tier = lowPower ? 1 : phone ? 2 : 3;
  let sun, gpuSun = true;
  try {
    sun = createSolSun(tier === 1 ? 1024 : 2048, budgets[tier].dpr);
  } catch {
    sun = createFallbackSun();
    gpuSun = false;
  }
  artwork.append(sun.element);

  const stars = makeParticles(budgets[3].desktop);
  const flock = new Flock(stars.length);
  const desktopCurve = curveTable(false), phoneCurve = curveTable(true);
  const sprites = makeSprites();
  const sunDrift = { x: 0, y: 0, vx: 0, vy: 0 };
  const center = {}, deflected = {};
  const points = [];
  let width = 0, height = 0, pixelRatio = 0, rects = [], mask = '';
  let visible = false, paused = false, active = false, settled = motion.matches;
  let time = 0, previous = 0, frame = 0, scrollCooldown = 0;
  let pointer = null, gesture = null, dprQuery;
  let sampleCount = 0, sampleStart = 0;
  const abort = new AbortController();
  const events = { passive: true, signal: abort.signal };

  function clearPointer() {
    pointer = null;
    gesture = null;
  }

  function draw(dt = 0) {
    if (width <= 0 || height <= 0) return;
    const mobileCurve = width < 600, mobileLayout = width <= 700;
    const curve = mobileCurve ? phoneCurve : desktopCurve;
    const count = budgets[tier][mobileCurve ? 'mobile' : 'desktop'];
    const sceneWidth = mobileLayout ? width : referenceWidth;
    const sceneHeight = mobileLayout ? height : referenceHeight;
    const sceneScale = mobileLayout ? 0.9 : Math.min(width / sceneWidth, height / sceneHeight);
    const flockScale = Math.min(0.43 * sceneWidth, 0.42 * sceneHeight);
    const radius = Math.min(0.18 * sceneWidth, 0.14 * sceneHeight);
    const anchorX = mobileLayout ? 0.43 : 0.46, anchorY = mobileLayout ? 0.40 : 0.51;
    const originX = anchorX * sceneWidth, originY = anchorY * sceneHeight;
    const insetX = width * anchorX - sceneScale * originX;
    const insetY = height * anchorY - sceneScale * originY;
    const scenePointer = pointer && {
      x: (pointer.x - insetX) / sceneScale, y: (pointer.y - insetY) / sceneScale,
      dx: pointer.dx / sceneScale, dy: pointer.dy / sceneScale,
    };
    // Translate the entire original orbit with the blog's existing solar anchor.
    const shiftX = originX - sceneWidth * (mobileCurve ? 0.72 : 0.46);
    const shiftY = originY - sceneHeight * (mobileCurve ? 0.55 : 0.50);
    moveSun(sunDrift, time, dt, scenePointer && {
      x: (scenePointer.x - originX) / radius, y: (scenePointer.y - originY) / radius,
      dx: scenePointer.dx / radius, dy: scenePointer.dy / radius,
    });
    const sx = originX + sunDrift.x * radius, sy = originY + sunDrift.y * radius;
    const avoid = settled ? 0 : Math.max(0, 1 - time / 8.7) ** 2;
    const opacity = settled ? 1 : Math.min(1, time / 2.4);
    const centerRadius = 1.7 * radius + 12;
    for (let i = 0; i < count; i++) {
      const star = stars[i], point = points[i] ??= {};
      const progress = entranceProgress(star, time, settled);
      const t = Math.max(0, progress);
      project(point, curve, t, star.lane, star.swirl, entranceExcursion(star, time, settled));
      project(center, curve, t, 0, 0, 0);
      const x = sceneWidth * (0.49 + 0.66 * center.x) + shiftX;
      const y = sceneHeight * (0.27 + 1.1 * center.y) + shiftY;
      repel(deflected, x, y, sx, sy, centerRadius, centerRadius * 0.5);
      point.x = sceneWidth * (0.49 + 0.66 * point.x) + shiftX + deflected.x - x;
      point.y = sceneHeight * (0.27 + 1.1 * point.y) + shiftY + deflected.y - y;
      if (progress < 0) point.opacity = 0;
      point.tx = (point.x - shiftX) / flockScale;
      point.ty = (point.y - shiftY) / flockScale;
    }
    points.length = count;
    const steps = Math.max(1, Math.ceil(60 * dt));
    for (let i = 0; i < steps; i++) flock.step(points, dt / steps, time);
    const sunX = sx * sceneScale + insetX, sunY = sy * sceneScale + insetY;
    const sunRadius = radius * sceneScale;
    try {
      sun.render(time, sunX, sunY, sunRadius, opacity, mask);
    } catch (error) {
      if (!gpuSun) throw error;
      replaceLostSun();
      sun.render(time, sunX, sunY, sunRadius, opacity, mask);
    }
    ctx.clearRect(0, 0, width, height);
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < count; i++) {
      const star = stars[i], point = points[i];
      if (!point.opacity) continue;
      const size = star.size * point.scale * 12 + 3 * point.blur;
      const half = size / 2, offset = flock.offsets[i];
      point.x += offset.x * flockScale;
      point.y += offset.y * flockScale;
      moveParticle(star.drift, 2 * star.size, dt, point, scenePointer);
      const barrier = radius * (1.05 + star.swirl / (Math.PI * 2) * (0.35 + 0.4 * avoid)) + half + 12;
      repel(deflected, point.x + star.drift.x, point.y + star.drift.y, sx, sy, barrier, radius * (0.16 + 0.2 * avoid));
      const x = deflected.x * sceneScale + insetX, y = deflected.y * sceneScale + insetY;
      const drawSize = size * sceneScale, drawHalf = drawSize / 2;
      if (x + drawHalf < 0 || y + drawHalf < 0 || x - drawHalf > width || y - drawHalf > height) continue;
      const alpha = copyVisibility(x, y, rects);
      if (!alpha) continue;
      ctx.globalAlpha = 0.95 * point.opacity * alpha;
      ctx.drawImage(sprites[star.color][Math.round(4 * point.blur)], x - drawHalf, y - drawHalf, drawSize, drawSize);
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  function replaceLostSun() {
    gpuSun = false;
    sun.element.removeEventListener('webglcontextlost', onContextLost, true);
    sun.dispose();
    sun = createFallbackSun();
    artwork.append(sun.element);
  }

  function onContextLost() {
    replaceLostSun();
    draw();
  }
  if (gpuSun) sun.element.addEventListener('webglcontextlost', onContextLost, { capture: true, signal: abort.signal });

  function resize() {
    clearPointer();
    const bounds = artwork.getBoundingClientRect();
    width = bounds.width;
    height = bounds.height;
    pixelRatio = window.devicePixelRatio || 1;
    const scale = Math.min(pixelRatio, budgets[tier].dpr);
    canvas.width = Math.round(width * scale);
    canvas.height = Math.round(height * scale);
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    rects = Array.from(host.querySelectorAll('[data-article-hero-copy-region]'))
      .filter(el => el.getClientRects().length && (width >= 600 || el.dataset.articleHeroCopyRegion !== 'headline'))
      .map(el => {
        const rect = el.getBoundingClientRect();
        return new DOMRect(rect.x - bounds.x - 24, rect.y - bounds.y - 24, rect.width + 48, rect.height + 48);
      });
    mask = copyMask(width, height, rects);
    draw();
  }

  function watchDpr() {
    dprQuery?.removeEventListener('change', watchDpr);
    dprQuery = matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`);
    dprQuery.addEventListener('change', watchDpr, { once: true, signal: abort.signal });
    if (pixelRatio !== (window.devicePixelRatio || 1)) resize();
  }

  function tick(now) {
    if (!active) return;
    if (!previous || now - previous >= 1000 / budgets[tier].fps - 0.8) {
      const dt = previous ? Math.min((now - previous) / 1000, 0.05) : 0;
      previous = now;
      time += dt;
      scrollCooldown = Math.max(0, scrollCooldown - dt);
      draw(dt);
      // Include compositor time: queued canvas draws can return quickly on a slow GPU.
      if (sampleCount === 0) sampleStart = now;
      if (++sampleCount === 61) {
        if (tier > 1 && (now - sampleStart) / 60 > 23) {
          tier--;
          resize();
        }
        sampleCount = 0;
      }
      if (pointer) pointer.dx = pointer.dy = 0;
    }
    frame = requestAnimationFrame(tick);
  }

  function syncPlayback() {
    if (motion.matches) settled = true;
    if (button) {
      const wasHidden = button.hidden;
      button.hidden = motion.matches;
      button.dataset.paused = String(paused);
      button.title = paused ? '播放动画' : '暂停动画';
      button.setAttribute('aria-label', button.title);
      if (wasHidden !== button.hidden) resize();
    }
    const shouldPlay = visible && !document.hidden && !motion.matches && !paused;
    if (shouldPlay !== active) {
      active = shouldPlay;
      cancelAnimationFrame(frame);
      previous = 0;
      sampleCount = 0;
      clearPointer();
      if (active) frame = requestAnimationFrame(tick);
    }
    if (motion.matches) draw();
  }

  function localPointer(e) {
    const bounds = artwork.getBoundingClientRect();
    return { x: e.clientX - bounds.left, y: e.clientY - bounds.top };
  }

  const interactiveTarget = target => target.closest?.('button,a,input,select,textarea,[role="button"]');
  host.addEventListener('pointerdown', e => {
    if (!active || !e.isPrimary || interactiveTarget(e.target) || e.button !== 0) return;
    const pos = localPointer(e);
    gesture = { id: e.pointerId, ...pos, horizontal: e.pointerType !== 'touch' };
    pointer = { ...pos, dx: 0, dy: 0 };
  }, events);
  host.addEventListener('pointermove', e => {
    if (!active || !e.isPrimary || scrollCooldown > 0 || interactiveTarget(e.target)) return clearPointer();
    if (e.pointerType !== 'mouse' && gesture?.id !== e.pointerId) return;
    if (e.pointerType === 'mouse' && e.buttons > 1) return clearPointer();
    const pos = localPointer(e);
    if (gesture && !gesture.horizontal) {
      const dx = Math.abs(pos.x - gesture.x), dy = Math.abs(pos.y - gesture.y);
      if (Math.max(dx, dy) < 6) return;
      if (dy >= dx) return clearPointer();
      gesture.horizontal = true;
    }
    const clamp = (value, limit) => Math.max(-limit, Math.min(limit, value));
    pointer = {
      ...pos,
      dx: pointer ? clamp(pointer.dx + clamp(pos.x - pointer.x, 60), 80) : 0,
      dy: pointer ? clamp(pointer.dy + clamp(pos.y - pointer.y, 60), 80) : 0,
    };
  }, events);
  host.addEventListener('pointerleave', clearPointer, events);
  host.addEventListener('pointercancel', clearPointer, events);
  window.addEventListener('pointerup', e => {
    if (e.isPrimary) clearPointer();
  }, events);
  window.addEventListener('blur', clearPointer, events);
  window.addEventListener('scroll', () => {
    scrollCooldown = 0.12;
    clearPointer();
  }, events);

  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(artwork);
  host.querySelectorAll('[data-article-hero-copy-region]').forEach(el => resizeObserver.observe(el));
  const viewport = new IntersectionObserver(entries => {
    visible = entries[entries.length - 1].isIntersecting;
    syncPlayback();
  });
  viewport.observe(host);
  motion.addEventListener('change', syncPlayback, events);
  document.addEventListener('visibilitychange', syncPlayback, events);
  button?.addEventListener('click', () => {
    paused = !paused;
    syncPlayback();
  }, { signal: abort.signal });
  watchDpr();
  syncPlayback();

  window.addEventListener('pagehide', e => {
    if (e.persisted) return;
    abort.abort();
    cancelAnimationFrame(frame);
    resizeObserver.disconnect();
    viewport.disconnect();
    sun.dispose();
  }, events);
}

const hero = document.querySelector('header.has-solar-hero');
if (hero) mountSolarHero(hero);
