import React, { useEffect, useImperativeHandle, useRef } from "react";

const FPS_12_MS = 1000 / 12; // ~83.33ms per stepped anime frame
const TOTAL_FRAMES = 6;      // Frame 0..5 => ~417ms total duration (0% GPU afterwards)
const TOTAL_LIFE_MS = 420;

function hash(n) {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453123;
  return s - Math.floor(s);
}

function createBurst(x, y, { power = "normal", fx = "burst", pillRect = null } = {}) {
  const isHeavy = power === "heavy";
  const seed = Math.random() * 1000;
  const slashCount = isHeavy ? 12 : 9;
  const particleCount = isHeavy ? 10 : 7;

  const slashes = Array.from({ length: slashCount }, (_, i) => {
    const baseAngle = (i / slashCount) * Math.PI * 2;
    const jitter = (hash(seed + i * 3) - 0.5) * 0.22;
    return {
      angle: baseAngle + jitter,
      dist: (isHeavy ? 10 : 7) + hash(seed + i * 7) * (isHeavy ? 9 : 6),
      len: (isHeavy ? 14 : 10) + hash(seed + i * 11) * (isHeavy ? 10 : 7),
      width: (isHeavy ? 3.2 : 2.5) + hash(seed + i * 13) * 1.4,
      isBlack: i % 2 === 0,
    };
  });

  const particles = Array.from({ length: particleCount }, (_, i) => {
    const ang = (i / particleCount) * Math.PI * 2 + (hash(seed + i * 17) - 0.5) * 0.4;
    const speed = (isHeavy ? 6.5 : 4.5) + hash(seed + i * 19) * (isHeavy ? 5.5 : 4.0);
    return {
      x: 0,
      y: 0,
      vx: Math.cos(ang) * speed,
      vy: Math.sin(ang) * speed,
      r: (1.7 + hash(seed + i * 23) * 2.0) * (isHeavy ? 1.15 : 1),
      isShard: i % 3 === 0,
      isBlack: i % 2 === 0,
      rot: ang,
    };
  });

  const puffs = fx === "smoke"
    ? Array.from({ length: 6 }, (_, i) => {
        const ang = (i / 6) * Math.PI * 2 + (hash(seed + i * 41) - 0.5) * 0.3;
        return {
          ang,
          vx: Math.cos(ang) * (isHeavy ? 5.2 : 3.8),
          vy: Math.sin(ang) * (isHeavy ? 4.4 : 3.2) - 0.8,
          r: (isHeavy ? 7.5 : 5.5) + hash(seed + i * 43) * 3.5,
        };
      })
    : [];

  const bolts = fx === "lightning"
    ? Array.from({ length: isHeavy ? 5 : 4 }, (_, i) => {
        const ang = (i / (isHeavy ? 5 : 4)) * Math.PI * 2 + (hash(seed + i * 51) - 0.5) * 0.5;
        return {
          ang,
          len: (isHeavy ? 26 : 19) + hash(seed + i * 53) * 9,
          kink: (hash(seed + i * 57) - 0.5) * 10,
        };
      })
    : [];

  const speedLines = isHeavy && pillRect
    ? Array.from({ length: 12 }, (_, i) => {
        const horiz = i < 8;
        const side = i % 2 === 0 ? -1 : 1;
        return {
          horiz,
          side,
          offset: hash(seed + i * 31),
          len: 20 + hash(seed + i * 37) * 28,
        };
      })
    : [];

  return {
    x,
    y,
    power,
    fx,
    isHeavy,
    seed,
    pillRect,
    frame: 0,
    createdAt: performance.now(),
    lastStepAt: 0,
    slashes,
    particles,
    puffs,
    bolts,
    speedLines,
  };
}

function drawCrossStar(ctx, cx, cy, size, fill, stroke) {
  const inner = size * 0.2;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.beginPath();
  ctx.moveTo(0, -size);
  ctx.lineTo(inner, -inner);
  ctx.lineTo(size * 1.15, 0);
  ctx.lineTo(inner, inner);
  ctx.lineTo(0, size);
  ctx.lineTo(-inner, inner);
  ctx.lineTo(-size * 1.15, 0);
  ctx.lineTo(-inner, -inner);
  ctx.closePath();
  ctx.lineWidth = 2.4;
  ctx.lineJoin = "miter";
  ctx.strokeStyle = stroke;
  ctx.stroke();
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.restore();
}

function drawTaperedDiamond(ctx, x, y, angle, len, width, fill, stroke) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.beginPath();
  ctx.moveTo(len * 0.58, 0);
  ctx.lineTo(0, width * 0.5);
  ctx.lineTo(-len * 0.42, 0);
  ctx.lineTo(0, -width * 0.5);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.strokeStyle = stroke;
  ctx.lineWidth = 1.4;
  ctx.lineJoin = "miter";
  ctx.stroke();
  ctx.fill();
  ctx.restore();
}

function drawParticles(ctx, b, f) {
  if (f < 1 || f > 5) return;
  const shrink = 1 - (f - 1) * 0.18;
  for (const p of b.particles) {
    const px = b.x + p.x;
    const py = b.y + p.y;
    const rad = Math.max(0.6, p.r * shrink);
    if (p.isShard) {
      drawTaperedDiamond(
        ctx,
        px,
        py,
        p.rot,
        rad * 2.8,
        rad * 1.3,
        p.isBlack ? "#0E0E13" : "#FFFFFF",
        p.isBlack ? "#FFFFFF" : "#0E0E13"
      );
    } else {
      ctx.save();
      ctx.beginPath();
      ctx.arc(px, py, rad, 0, Math.PI * 2);
      ctx.fillStyle = p.isBlack ? "#0E0E13" : "#FFFFFF";
      ctx.strokeStyle = p.isBlack ? "#FFFFFF" : "#0E0E13";
      ctx.lineWidth = 1.4;
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }
  }
}

function drawSpeedLines(ctx, b, f) {
  if (!b.isHeavy || !b.pillRect || f > 3) return;
  const { left, top, width, height } = b.pillRect;
  const right = left + width;
  const bottom = top + height;
  const pFrac = 1 - f / 4;
  ctx.save();
  for (const sl of b.speedLines) {
    ctx.beginPath();
    if (sl.horiz) {
      const yPos = top + 6 + sl.offset * Math.max(8, height - 12);
      const startX = sl.side < 0 ? left + 5 : right - 5;
      const endX = startX - sl.side * sl.len * pFrac;
      ctx.moveTo(startX, yPos);
      ctx.lineTo(endX, yPos);
    } else {
      const xPos = left + 18 + sl.offset * Math.max(12, width - 36);
      const startY = sl.side < 0 ? top + 4 : bottom - 4;
      const endY = startY - sl.side * (sl.len * 0.35) * pFrac;
      ctx.moveTo(xPos, startY);
      ctx.lineTo(xPos, endY);
    }
    ctx.strokeStyle = sl.offset > 0.45 ? "#0E0E13" : "#FFFFFF";
    ctx.lineWidth = 1.9 * pFrac;
    ctx.lineCap = "round";
    ctx.stroke();
  }
  ctx.restore();
}

function drawBurstAtFrame(ctx, b) {
  const f = b.frame; // 0..5
  const scale = b.isHeavy ? 0.84 : 0.62; // Compact, sharp button-hugging scale!

  drawSpeedLines(ctx, b, f);

  if (b.fx === "slash") {
    // Effect 2: Razor Anime Katana Arc Slash + Sparkles
    if (f <= 3) {
      const prog = (f + 1) / 4;
      const len = (b.isHeavy ? 44 : 34) * (0.7 + prog * 0.45);
      const thick = (b.isHeavy ? 9.5 : 7.5) * (1 - f * 0.24);
      ctx.save();
      ctx.translate(b.x, b.y);
      ctx.rotate(-0.48);
      ctx.beginPath();
      ctx.moveTo(-len * 0.55, 0);
      ctx.quadraticCurveTo(0, -thick, len * 0.55, 0);
      ctx.quadraticCurveTo(0, -thick * 0.16, -len * 0.55, 0);
      ctx.closePath();
      ctx.fillStyle = "#FFFFFF";
      ctx.strokeStyle = "#0E0E13";
      ctx.lineWidth = 2.4;
      ctx.stroke();
      ctx.fill();
      ctx.restore();
    }
    if (f === 1 || f === 2) {
      drawCrossStar(ctx, b.x + 12, b.y - 10, f === 1 ? 8 : 5, "#FFFFFF", "#0E0E13");
    }
    drawParticles(ctx, b, f);
    return;
  }

  if (b.fx === "smoke") {
    // Effect 3: Manga Cel Smoke Puffs + Wobble Arcs
    const k = f / (TOTAL_FRAMES - 1);
    const fade = 1 - k * 0.85;
    for (let i = 0; i < b.puffs.length; i++) {
      const p = b.puffs[i];
      const px = b.x + p.vx * (f + 1);
      const py = b.y + p.vy * (f + 1);
      const rad = p.r * (0.75 + k * 0.45) * (1 - k * 0.45);
      if (rad <= 0.8 || fade <= 0.05) continue;
      ctx.save();
      ctx.globalAlpha = fade;
      ctx.beginPath();
      ctx.arc(px, py, rad, 0, Math.PI * 2);
      ctx.fillStyle = i % 2 === 0 ? "#FFFFFF" : "#E2E8F0";
      ctx.strokeStyle = "#0E0E13";
      ctx.lineWidth = 2.0;
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }
    if (f >= 1 && f <= 3) {
      drawCrossStar(ctx, b.x, b.y, 8 * scale, "#FFFFFF", "#0E0E13");
    }
    return;
  }

  if (b.fx === "lightning") {
    // Effect 4: Forked Crisp Ink Lightning Bolts + Tight Shock Ring
    if (f <= 3) {
      const lw = 2.5 - f * 0.5;
      for (const bl of b.bolts) {
        const rStart = 4;
        const rEnd = bl.len * (0.65 + (f / 4) * 0.45);
        const sx = b.x + Math.cos(bl.ang) * rStart;
        const sy = b.y + Math.sin(bl.ang) * rStart;
        const ex = b.x + Math.cos(bl.ang) * rEnd;
        const ey = b.y + Math.sin(bl.ang) * rEnd;
        const mx = (sx + ex) / 2 - Math.sin(bl.ang) * bl.kink;
        const my = (sy + ey) / 2 + Math.cos(bl.ang) * bl.kink;
        ctx.save();
        ctx.beginPath();
        ctx.moveTo(sx, sy);
        ctx.lineTo(mx, my);
        ctx.lineTo(ex, ey);
        ctx.strokeStyle = "#FFFFFF";
        ctx.lineWidth = lw + 2.0;
        ctx.lineJoin = "miter";
        ctx.stroke();
        ctx.strokeStyle = "#0E0E13";
        ctx.lineWidth = lw;
        ctx.stroke();
        ctx.restore();
      }
    }
    if (f === 0) drawCrossStar(ctx, b.x, b.y, 14 * scale, "#FFFFFF", "#0E0E13");
    drawParticles(ctx, b, f);
    return;
  }

  // Default Effect 1 ("burst"): 4-Layer Manga Impact Star + Radial Slashes + Jagged Ring + Splatters
  if (f === 0 || f === 1) {
    const starSize = (f === 0 ? 15 : 9) * scale;
    drawCrossStar(ctx, b.x, b.y, starSize, "#FFFFFF", "#0E0E13");
  }

  if (f <= 3) {
    const prog = (f + 1) / 4;
    for (const s of b.slashes) {
      const r = (s.dist + prog * 18) * scale;
      const sx = b.x + Math.cos(s.angle) * r;
      const sy = b.y + Math.sin(s.angle) * r;
      const curLen = s.len * (1 - f * 0.2) * scale;
      const curW = Math.max(1.0, s.width * (1 - f * 0.22));
      drawTaperedDiamond(
        ctx,
        sx,
        sy,
        s.angle,
        curLen,
        curW,
        s.isBlack ? "#0E0E13" : "#FFFFFF",
        s.isBlack ? "#FFFFFF" : "#0E0E13"
      );
    }
  }

  if (f >= 1 && f <= 4) {
    const ringStep = f - 1;
    const baseR = (12 + ringStep * 8.5) * scale;
    const segs = 22;
    const jaggedAmp = (b.isHeavy ? 3.8 : 2.8) * (1 - ringStep * 0.15);
    const brokenPhase = f >= 3;

    ctx.save();
    for (let i = 0; i < segs; i++) {
      if (brokenPhase && i % 2 === 1) continue;
      if (f === 4 && i % 3 !== 0) continue;

      const a0 = (i / segs) * Math.PI * 2;
      const a1 = ((i + 1) / segs) * Math.PI * 2;
      const n0 = (hash(b.seed + i * 5 + f * 13) - 0.5) * 2 * jaggedAmp;
      const n1 = (hash(b.seed + (i + 1) * 5 + f * 13) - 0.5) * 2 * jaggedAmp;

      const x0 = b.x + Math.cos(a0) * (baseR + n0);
      const y0 = b.y + Math.sin(a0) * (baseR + n0);
      const x1 = b.x + Math.cos(a1) * (baseR + n1);
      const y1 = b.y + Math.sin(a1) * (baseR + n1);

      const varWidth = Math.max(0.9, (3.2 - ringStep * 0.7) * (0.7 + hash(b.seed + i * 7) * 0.6));

      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1, y1);
      ctx.strokeStyle = "#FFFFFF";
      ctx.lineWidth = varWidth + 1.6;
      ctx.lineCap = "round";
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1, y1);
      ctx.strokeStyle = "#0E0E13";
      ctx.lineWidth = varWidth;
      ctx.lineCap = "round";
      ctx.stroke();
    }
    ctx.restore();
  }

  drawParticles(ctx, b, f);
}

export const SakugaClickOverlay = React.forwardRef(function SakugaClickOverlay(_, ref) {
  const canvasRef = useRef(null);
  const burstsRef = useRef([]);
  const rafIdRef = useRef(null);
  const dprRef = useRef(1);

  const clearAndStop = () => {
    if (rafIdRef.current !== null) {
      cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = null;
    }
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  };

  const syncCanvasSize = () => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
    dprRef.current = dpr;
    const w = Math.max(1, window.innerWidth);
    const h = Math.max(1, window.innerHeight);
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }
    return canvas.getContext("2d");
  };

  const renderSteppedFrame = (now) => {
    const bursts = burstsRef.current;
    let needsRepaint = false;
    const alive = [];

    for (const b of bursts) {
      if (now - b.createdAt > TOTAL_LIFE_MS) continue;
      if (b.lastStepAt === 0) {
        b.lastStepAt = now;
        b.frame = 0;
        needsRepaint = true;
      } else if (now - b.lastStepAt >= FPS_12_MS) {
        b.lastStepAt += FPS_12_MS;
        b.frame += 1;
        for (const p of b.particles) {
          p.x += p.vx;
          p.y += p.vy;
          p.vx *= 0.78;
          p.vy *= 0.78;
        }
        needsRepaint = true;
      }
      if (b.frame < TOTAL_FRAMES) {
        alive.push(b);
      }
    }
    burstsRef.current = alive;

    if (alive.length === 0) {
      clearAndStop();
      return;
    }

    if (needsRepaint) {
      const ctx = syncCanvasSize();
      const canvas = canvasRef.current;
      if (ctx && canvas) {
        const dpr = dprRef.current;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, canvas.width / dpr, canvas.height / dpr);
        for (const b of alive) {
          drawBurstAtFrame(ctx, b);
        }
      }
    }

    rafIdRef.current = requestAnimationFrame(renderSteppedFrame);
  };

  useImperativeHandle(
    ref,
    () => ({
      spawnBurst(x, y, options = {}) {
        const burst = createBurst(x, y, {
          power: options.power === "heavy" ? "heavy" : "normal",
          fx: options.fx || "burst",
          pillRect: options.pillRect || null,
        });
        burstsRef.current.push(burst);
        if (rafIdRef.current === null) {
          renderSteppedFrame(performance.now());
        }
      },
      isRunning() {
        return rafIdRef.current !== null;
      },
    }),
    []
  );

  useEffect(() => {
    syncCanvasSize();
    window.__sakugaClickDebug = {
      isRunning: () => rafIdRef.current !== null,
      getBurstCount: () => burstsRef.current.length,
    };
    const onResize = () => syncCanvasSize();
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      clearAndStop();
      delete window.__sakugaClickDebug;
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 w-full h-full z-[70]"
    />
  );
});
