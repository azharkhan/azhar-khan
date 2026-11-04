interface Puff {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  grow: number;
  born: number;
  life: number;
  peak: number;
  phase: number;
}

function sprite(rgb: string): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 128;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    const gradient = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
    gradient.addColorStop(0, `rgba(${rgb}, 1)`);
    gradient.addColorStop(0.45, `rgba(${rgb}, 0.55)`);
    gradient.addColorStop(1, `rgba(${rgb}, 0)`);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 128, 128);
  }
  return canvas;
}

export function smoke(x: number, y: number, rgb: string, onPeak: () => void): void {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    onPeak();
    return;
  }
  canvas.className = "smoke";
  const dpr = Math.min(devicePixelRatio || 1, 2);
  canvas.width = innerWidth * dpr;
  canvas.height = innerHeight * dpr;
  document.body.appendChild(canvas);
  ctx.scale(dpr, dpr);
  const puff = sprite(rgb);
  const base = Math.atan2(innerHeight / 2 - y, innerWidth / 2 - x);
  const reach = Math.hypot(innerWidth, innerHeight);
  const parts: Puff[] = [];
  const start = performance.now();
  let emitted = 0;
  let peaked = false;
  let last = start;

  const emit = (now: number): void => {
    const target = Math.min(90, Math.floor((now - start) / 6));
    for (; emitted < target; emitted++) {
      const angle = base + (Math.random() - 0.5) * 2.4;
      const speed = ((0.25 + Math.random() * 0.75) * reach) / 1400;
      parts.push({
        x: x + (Math.random() - 0.5) * 12,
        y: y + (Math.random() - 0.5) * 12,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        r: 10 + Math.random() * 14,
        grow: 0.12 + Math.random() * 0.22,
        born: now,
        life: 1500 + Math.random() * 900,
        peak: 0.28 + Math.random() * 0.3,
        phase: Math.random() * Math.PI * 2,
      });
    }
  };

  const frame = (now: number): void => {
    const dt = Math.min(now - last, 50);
    last = now;
    emit(now);
    if (!peaked && now - start > 320) {
      peaked = true;
      onPeak();
    }
    ctx.clearRect(0, 0, innerWidth, innerHeight);
    let alive = 0;
    for (const p of parts) {
      const t = (now - p.born) / p.life;
      if (t >= 1) continue;
      alive++;
      p.x += (p.vx + Math.sin(p.phase + t * 6) * 0.08) * dt;
      p.y += (p.vy - 0.035 * t) * dt;
      p.r += p.grow * dt;
      const alpha = p.peak * (t < 0.2 ? t / 0.2 : 1 - (t - 0.2) / 0.8);
      ctx.globalAlpha = Math.max(alpha, 0);
      ctx.drawImage(puff, p.x - p.r, p.y - p.r, p.r * 2, p.r * 2);
    }
    if (alive || emitted < 90) requestAnimationFrame(frame);
    else canvas.remove();
  };

  requestAnimationFrame(frame);
}
