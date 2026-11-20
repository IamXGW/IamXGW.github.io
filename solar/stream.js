// Geometry and dynamics from the saved Sol hero, modules 859820 and 953065.
const TAU = Math.PI * 2;
const TABLE_SEGMENTS = 512;

export const budgets = [
  { desktop: 700, mobile: 500, dpr: 1, fps: 0 },
  { desktop: 1100, mobile: 700, dpr: 1, fps: 30 },
  { desktop: 1800, mobile: 1100, dpr: 1.25, fps: 60 },
  { desktop: 2600, mobile: 1400, dpr: 1.5, fps: 60 },
];

export function makeParticles(count) {
  let seed = 7183;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 0x3c6ef35f) >>> 0;
    return seed / 0x100000000;
  };
  return Array.from({ length: count }, () => ({
    drift: { x: 0, y: 0, vx: 0, vy: 0 },
    speed: 0.015 + 0.045 * random(),
    phase: random(),
    lane: (random() + random() + random() - 1.5) * 3,
    swirl: random() * TAU,
    size: random() > 0.975 ? 3 + 3 * random() : 0.35 + 1.2 * random(),
    color: random() > 0.42 ? 4 : Math.floor(4 * random()),
  }));
}

function centerline(t, mobile) {
  const perspective = 2.4 / (7.9 - 5 * t);
  const u = 1 - t;
  const x = mobile
    ? -0.18 + 1.62 * Math.sin(Math.PI * t)
    : -0.15 * u ** 3 + 2.1675 * u * u * t + 3 * 0.689 * u * t * t + 0.4214 * t ** 3;
  const y = mobile
    ? 0.16 + 0.72 * t
    : 0.12 * u ** 3 + 0.3516 * u * u * t + 1.1748 * u * t * t + 1.2443 * t ** 3;
  return { x: (x - 0.49) / (0.66 * perspective), y: (y - 0.27) / (1.1 * perspective) };
}

export function curveTable(mobile) {
  return Array.from({ length: TABLE_SEGMENTS + 1 }, (_, i) => {
    const t = i / TABLE_SEGMENTS;
    const point = centerline(t, mobile);
    const before = centerline(t - 0.001, mobile);
    const after = centerline(t + 0.001, mobile);
    return { ...point, dx: (after.x - before.x) / 0.002, dy: (after.y - before.y) / 0.002 };
  });
}

export function entranceProgress(star, time, settled) {
  const gate = settled ? 0 : Math.max(0, 1 - time / 4.2) ** 2;
  const t = star.phase + time * star.speed - gate;
  return t < 0 ? -1 : t % 1;
}

export function entranceExcursion(star, time, settled) {
  if (settled || time >= 8.7) return 0;
  const rate = 2 / 4.2 + star.speed;
  const start = 2 * (1 - star.phase) / (rate + Math.sqrt(rate * rate - 4 * (1 - star.phase) / 17.64));
  const age = Math.max(0, time - start);
  const envelope = Math.max(0, 1 - age / 4.5) ** 2;
  return Math.sin(2.6 * age) * (1 - Math.exp(-4 * age)) * Math.exp(-0.9 * age) * envelope;
}

export function project(out, table, t, lane, swirl, excursion) {
  const index = TABLE_SEGMENTS * Math.max(0, Math.min(1, t));
  const left = Math.min(TABLE_SEGMENTS - 1, Math.floor(index));
  const mix = index - left;
  const a = table[left], b = table[left + 1];
  const centerX = a.x + (b.x - a.x) * mix, centerY = a.y + (b.y - a.y) * mix;
  const dx = a.dx + (b.dx - a.dx) * mix, dy = a.dy + (b.dy - a.dy) * mix;
  const len = Math.max(1e-4, Math.hypot(dx, dy)), spatialLen = Math.hypot(len, 5);
  const taper = Math.min(1, t / 0.22);
  excursion *= taper * taper * (3 - 2 * taper);
  const band = 0.055 + 0.035 * Math.sin(t * Math.PI);
  const lateral = Math.cos(swirl) * lane * band, depth = Math.sin(swirl) * lane * band;
  const z = Math.max(0.1, 2.5 + (3 - 5 * t + depth * len / spatialLen - 0.6 * excursion));
  out.scale = 2.4 / (2.4 + z);
  out.x = (centerX - lateral * dy / len + 5 * depth * dx / (spatialLen * len) + Math.cos(swirl) * excursion * 0.85) * out.scale;
  out.y = (centerY + lateral * dx / len + 5 * depth * dy / (spatialLen * len) + Math.sin(swirl) * excursion * 0.65) * out.scale;
  out.blur = Math.min(1, z / 5.5);
  out.opacity = Math.min(1, 15 * t, (1 - t) * 18);
}

export function repel(out, x, y, cx, cy, radius, softness) {
  const dx = x - cx, dy = y - cy, length = Math.hypot(dx, dy);
  if (length >= radius + softness) {
    out.x = x;
    out.y = y;
    return;
  }
  const distance = softness > 0 && length > radius - softness
    ? radius + (length - radius + softness) ** 2 / (4 * softness) : radius;
  out.x = cx + (length > 1e-6 ? dx / length : 1) * distance;
  out.y = cy + (length > 1e-6 ? dy / length : 0) * distance;
}

export function moveSun(sun, time, dt, pointer) {
  if (dt <= 0) return;
  if (pointer) {
    const weight = Math.max(0, 1 - Math.hypot(pointer.x - sun.x, pointer.y - sun.y) / 3) ** 2;
    sun.vx += pointer.dx * weight * 0.8;
    sun.vy += pointer.dy * weight * 0.8;
  }
  const restingX = 0.085 * Math.sin(0.32 * time), restingY = 0.065 * Math.sin(0.23 * time);
  const steps = Math.max(1, Math.ceil(120 * dt)), delta = dt / steps;
  const damping = Math.exp(-4 * delta);
  for (let i = 0; i < steps; i++) {
    sun.vx = (sun.vx + (restingX - sun.x) * 12 * delta) * damping;
    sun.vy = (sun.vy + (restingY - sun.y) * 12 * delta) * damping;
    sun.x += sun.vx * delta;
    sun.y += sun.vy * delta;
    const length = Math.hypot(sun.x, sun.y);
    if (length > 0.32) {
      sun.x *= 0.32 / length;
      sun.y *= 0.32 / length;
      const radial = Math.max(0, (sun.vx * sun.x + sun.vy * sun.y) / 0.32);
      sun.vx -= radial * sun.x / 0.32;
      sun.vy -= radial * sun.y / 0.32;
    }
  }
}

export function moveParticle(drift, size, dt, pos, pointer) {
  if (dt <= 0) return;
  if (drift.x || drift.y || drift.vx || drift.vy) {
    const t = Math.max(0, Math.min(1, (size - 1) / 13));
    const rate = 2.3 / Math.sqrt(0.65 + 1.75 * t * t * (3 - 2 * t));
    const decay = Math.exp(-rate * dt), restore = Math.exp(-dt);
    const travel = (restore - decay) / (rate - 1);
    drift.x = drift.x * restore + drift.vx * travel;
    drift.y = drift.y * restore + drift.vy * travel;
    drift.vx *= decay;
    drift.vy *= decay;
  }
  if (!pointer || !(pointer.dx || pointer.dy)) return;
  const weight = Math.max(0, 1 - Math.hypot(pos.x + drift.x - pointer.x, pos.y + drift.y - pointer.y) / 190) ** 2;
  drift.vx += pointer.dx * weight * 8 * pos.scale;
  drift.vy += pointer.dy * weight * 8 * pos.scale;
}

const cellKey = (x, y) => (x + 1024) * 4096 + y + 1024;

export class Flock {
  constructor(count) {
    this.offsets = Array.from({ length: count }, () => ({ x: 0, y: 0, vx: 0, vy: 0 }));
    this.velocities = new Float64Array(2 * count);
    this.cells = new Map();
    this.buckets = [];
  }

  step(targets, dt, time) {
    if (dt <= 0) return;
    dt = Math.min(dt, 1 / 30);
    const { cells, buckets, offsets, velocities } = this;
    cells.clear();
    let used = 0;
    for (let i = 0; i < targets.length; i++) {
      const p = targets[i], key = cellKey(Math.floor(p.tx / 0.1), Math.floor(p.ty / 0.1));
      let cell = cells.get(key);
      if (!cell) {
        cell = buckets[used] ??= [];
        used++;
        cell.length = 0;
        cells.set(key, cell);
      }
      cell.push(i);
    }
    const damping = Math.exp(-3 * dt);
    for (let i = 0; i < targets.length; i++) {
      const p = targets[i], offset = offsets[i];
      const col = Math.floor(p.tx / 0.1), row = Math.floor(p.ty / 0.1);
      let vx = 0, vy = 0, sx = 0, sy = 0, ax = 0, ay = 0, count = 0;
      for (let x = -1; x <= 1; x++) {
        for (let y = -1; y <= 1; y++) {
          const cell = cells.get(cellKey(col + x, row + y));
          if (!cell) continue;
          for (let j = 0; j < Math.min(6, cell.length); j++) {
            const index = cell[(i + j) % cell.length];
            if (index === i) continue;
            const neighbor = offsets[index];
            const dx = p.tx + offset.x - targets[index].tx - neighbor.x;
            const dy = p.ty + offset.y - targets[index].ty - neighbor.y;
            const squared = dx * dx + dy * dy;
            if (squared > 0.01) continue;
            vx += neighbor.vx;
            vy += neighbor.vy;
            sx += neighbor.x;
            sy += neighbor.y;
            count++;
            if (squared > 1e-6 && squared < 4e-4) {
              ax += dx / squared;
              ay += dy / squared;
            }
          }
        }
      }
      const forceX = (0.035 * Math.sin(9 * p.ty - 0.7 * time) - offset.x) * 8
        + (count ? (sx / count - offset.x) * 4 + (vx / count - offset.vx) * 2 : 0) + 0.00015 * ax;
      const forceY = (0.022 * Math.sin(10 * p.tx + 0.5 * time) - offset.y) * 8
        + (count ? (sy / count - offset.y) * 4 + (vy / count - offset.vy) * 2 : 0) + 0.00015 * ay;
      velocities[2 * i] = (offset.vx + forceX * dt) * damping;
      velocities[2 * i + 1] = (offset.vy + forceY * dt) * damping;
    }
    for (let i = 0; i < targets.length; i++) {
      const offset = offsets[i];
      offset.vx = velocities[2 * i];
      offset.vy = velocities[2 * i + 1];
      offset.x += offset.vx * dt;
      offset.y += offset.vy * dt;
    }
  }
}
