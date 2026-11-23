// Sakuga VFX Engine for Jarvis Hub — High-Contrast B&W Manga / Anime Style
// Adapted from https://github.com/finktheartist/sakuga-vfx (core.js, button.js, toast.js)
// Enforces demand-driven RAF loop: 0% GPU/CPU when IDLE or is_gaming === true.

export const SAKUGA_PALETTES = {
  idle: {
    id: "idle",
    ink: "#0E0E13",
    paper: "#FFFFFF",
    shade: "#D4D4E0",
    primary: "#0E0E13",
    glow: "#FFFFFF",
    accent: "#FFFFFF",
    spark: "#FFFFFF",
    smoke: "#D4D4E0",
  },
  listening: {
    id: "listening",
    ink: "#0E0E13",
    paper: "#FFFFFF",
    shade: "#D4D4E0",
    primary: "#0E0E13",
    glow: "#FFFFFF",
    accent: "#FFFFFF",
    spark: "#0E0E13",
    smoke: "#D4D4E0",
  },
  mcp_local: {
    id: "mcp_local",
    ink: "#0E0E13",
    paper: "#FFFFFF",
    shade: "#FFE2C8",
    primary: "#FF6B00",
    glow: "#FF6B00",
    accent: "#FFFFFF",
    spark: "#FF6B00",
    smoke: "#F2E9E1",
  },
  antigravity: {
    id: "antigravity",
    ink: "#0E0E13",
    paper: "#FFFFFF",
    shade: "#FED7AA",
    primary: "#FF6B00",
    glow: "#FF6B00",
    accent: "#FFFFFF",
    spark: "#FF6B00",
    smoke: "#F2E9E1",
  },
  vram_unload: {
    id: "vram_unload",
    ink: "#0E0E13",
    paper: "#FFFFFF",
    shade: "#DDD6FE",
    primary: "#7C3AED",
    glow: "#7C3AED",
    accent: "#EDE9FE",
    spark: "#7C3AED",
    smoke: "#EDE9FE",
  },
  speaking: {
    id: "speaking",
    ink: "#0E0E13",
    paper: "#FFFFFF",
    shade: "#D4D4E0",
    primary: "#0E0E13",
    glow: "#FFFFFF",
    accent: "#FFFFFF",
    spark: "#0E0E13",
    smoke: "#E2E2EC",
  },
  dictation: {
    id: "dictation",
    ink: "#0E0E13",
    paper: "#FFFFFF",
    shade: "#E5E7EB",
    primary: "#0E0E13",
    glow: "#FFFFFF",
    accent: "#FFFFFF",
    spark: "#0E0E13",
    smoke: "#E5E7EB",
  },
};

// Balanced mood palette: Xanh (#00B4D8), Tím (#7C3AED), Cam (#FF6B00), Đỏ lỗi (#DC2626) + neutral idle ink (#0E0E13)
const CORE_MOOD_COLORS = {
  blue: { color: "#00B4D8", glow: "rgba(0, 180, 216, 0.22)", border: "#00B4D8", tint: "rgba(0, 180, 216, 0.06)" },
  purple: { color: "#7C3AED", glow: "rgba(124, 58, 237, 0.22)", border: "#7C3AED", tint: "rgba(124, 58, 237, 0.06)" },
  orange: { color: "#FF6B00", glow: "rgba(255, 107, 0, 0.24)", border: "#FF6B00", tint: "rgba(255, 107, 0, 0.06)" },
  red: { color: "#DC2626", glow: "rgba(220, 38, 38, 0.26)", border: "#DC2626", tint: "rgba(220, 38, 38, 0.06)" },
  ink: { color: "#0E0E13", glow: "rgba(14, 14, 19, 0.14)", border: "#0E0E13", tint: "rgba(14, 14, 19, 0.03)" },
};

export const MOOD_THEMES = {
  idle: CORE_MOOD_COLORS.ink,
  sleeping: CORE_MOOD_COLORS.purple,
  listening: CORE_MOOD_COLORS.blue,
  searching: CORE_MOOD_COLORS.blue,
  speaking: CORE_MOOD_COLORS.blue,
  happy: CORE_MOOD_COLORS.orange,
  thinking: CORE_MOOD_COLORS.purple,
  vram_unload: CORE_MOOD_COLORS.purple,
  working: CORE_MOOD_COLORS.orange,
  error: CORE_MOOD_COLORS.red,
  antigravity: CORE_MOOD_COLORS.orange,
};

export function resolveMoodTheme(mood = "idle", vfxMode = "idle") {
  if (mood === "error") return MOOD_THEMES.error;
  if (vfxMode === "antigravity") return MOOD_THEMES.antigravity;
  if (vfxMode === "vram_unload") return MOOD_THEMES.vram_unload;
  if (vfxMode === "mcp_local" && mood !== "happy" && mood !== "speaking") return MOOD_THEMES.working;
  return MOOD_THEMES[mood] || MOOD_THEMES.idle;
}

export function resolveSakugaPalette(vfxMode, pillState) {
  if (vfxMode && SAKUGA_PALETTES[vfxMode]) return SAKUGA_PALETTES[vfxMode];
  if (pillState === "listening") return SAKUGA_PALETTES.listening;
  if (pillState === "speaking") return SAKUGA_PALETTES.speaking;
  if (pillState === "dictation") return SAKUGA_PALETTES.dictation;
  if (pillState === "executing") return SAKUGA_PALETTES.mcp_local;
  return SAKUGA_PALETTES.idle;
}

export function routeToVfxMode(route) {
  const r = String(route || "").toLowerCase();
  if (!r) return null;
  if (r.includes("antigravity")) return "antigravity";
  if (r.includes("vram") || r.includes("game")) return "vram_unload";
  if (
    r.includes("fast_desktop") ||
    r.includes("agent_desktop") ||
    r.includes("playwright") ||
    r.includes("mcp") ||
    r.includes("multi_step") ||
    r.includes("vision")
  ) {
    return "mcp_local";
  }
  return null;
}

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const out = (t) => 1 - Math.pow(1 - clamp(t, 0, 1), 3);
const inn = (t) => Math.pow(clamp(t, 0, 1), 3);

function hash12(seed) {
  const s = Math.sin(seed * 127.1 + 311.7) * 43758.5453123;
  return s - Math.floor(s);
}

export class Spring {
  constructor(x = 0, k = 320, d = 22) {
    this.x = x;
    this.v = 0;
    this.t = x;
    this.k = k;
    this.d = d;
  }
  step(dt) {
    const steps = Math.max(1, Math.ceil(dt / (1 / 120)));
    const h = dt / steps;
    for (let i = 0; i < steps; i++) {
      const a = -this.k * (this.x - this.t) - this.d * this.v;
      this.v += a * h;
      this.x += this.v * h;
    }
    return this.x;
  }
}

export class SakugaVfxEngine {
  constructor() {
    this.canvas = null;
    this.ctx = null;
    this.dpr = 1;
    this.width = 0;
    this.height = 0;

    this.live = [];
    this.rafId = null;
    this.lastTime = 0;
    this.elapsed = 0;
    this.step12Tick = 0;

    this.enabled = true;
    this.isGaming = false;
    this.pillState = "idle";
    this.vfxMode = "idle";
    this.mood = "idle";
    this.voiceLevel = 0;
    this.smoothVoice = 0;
    this.auraDist = 0;
    this.pillRect = null;
    this.pillElement = null;

    this.onLoopStateChange = null;
    this._tick = this._tick.bind(this);
  }

  attach(canvas) {
    this.canvas = canvas;
    this.ctx = canvas ? canvas.getContext("2d") : null;
    this.resize();
  }

  detach() {
    this.stopLoop();
    this.canvas = null;
    this.ctx = null;
    this.pillElement = null;
  }

  resize() {
    if (!this.canvas || !this.ctx) return;
    const rect = this.canvas.getBoundingClientRect();
    const dpr = clamp(window.devicePixelRatio || 1, 1, 2);
    this.dpr = dpr;
    this.width = Math.max(1, rect.width || window.innerWidth);
    this.height = Math.max(1, rect.height || window.innerHeight);
    const targetW = Math.round(this.width * dpr);
    const targetH = Math.round(this.height * dpr);
    if (this.canvas.width !== targetW || this.canvas.height !== targetH) {
      this.canvas.width = targetW;
      this.canvas.height = targetH;
    }
  }

  isRunning() {
    return this.rafId !== null;
  }

  shouldMaintainAura() {
    if (!this.enabled || this.isGaming) return false;
    return this.pillState !== "idle" || (this.vfxMode !== "idle" && this.vfxMode !== "vram_unload");
  }

  _syncLivePillRect() {
    if (!this.pillElement || typeof this.pillElement.getBoundingClientRect !== "function") return;
    const r = this.pillElement.getBoundingClientRect();
    if (!r || r.width <= 0 || r.height <= 0) return;
    const cs = typeof window !== "undefined" ? window.getComputedStyle(this.pillElement) : null;
    const parsedRx = cs ? parseFloat(cs.borderTopLeftRadius) : NaN;
    this.pillRect = {
      cx: r.left + r.width / 2,
      cy: r.top + r.height / 2,
      w: r.width,
      h: r.height,
      rx: Number.isFinite(parsedRx) ? Math.min(parsedRx, r.height / 2) : Math.min(r.height / 2, 16),
    };
  }

  updateConfig({ enabled, isGaming, pillState, vfxMode, mood, voiceLevel, pillRect, pillElement }) {
    if (typeof enabled === "boolean") this.enabled = enabled;
    if (typeof isGaming === "boolean") this.isGaming = isGaming;
    if (pillState) this.pillState = pillState;
    if (vfxMode) this.vfxMode = vfxMode;
    if (mood) this.mood = mood;
    if (typeof voiceLevel === "number") this.voiceLevel = voiceLevel;
    if (pillElement !== undefined) this.pillElement = pillElement;
    if (pillRect) this.pillRect = pillRect;
    this._syncLivePillRect();

    if (!this.enabled) {
      this.hardStop();
      return;
    }

    if (this.isGaming && this.live.length === 0) {
      this.hardStop();
      return;
    }

    if (this.shouldMaintainAura() || this.live.length > 0) {
      this.startLoop();
    } else {
      this.stopLoop();
    }
  }

  startLoop() {
    if (this.rafId !== null || !this.canvas || !this.ctx || !this.enabled) return;
    this.lastTime = performance.now();
    this.rafId = requestAnimationFrame(this._tick);
    this.onLoopStateChange?.(true);
  }

  stopLoop() {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
      this.onLoopStateChange?.(false);
    }
    this._clearCanvas();
  }

  hardStop() {
    this.live.length = 0;
    this.stopLoop();
  }

  _clearCanvas() {
    if (!this.ctx || !this.canvas) return;
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }

  _add(item) {
    if (!this.enabled) return;
    this.live.push({ t: 0, ...item });
    this.startLoop();
  }

  // Manga B&W cel-shaded burst + horizontal/radial ink speedlines + diamond shards + clouds
  spawnImpactBurst(cx, cy, mode = "listening", intensity = 1) {
    if (!this.enabled || this.isGaming) return;
    this._syncLivePillRect();
    const anchorX = this.pillRect ? this.pillRect.cx : cx;
    const anchorY = this.pillRect ? this.pillRect.cy : cy;
    const pal = resolveSakugaPalette(mode, this.pillState);
    const hasRouteTint = mode === "mcp_local" || mode === "antigravity";

    // 1. Spiky manga burst (white fill + bold black sumi ink stroke)
    this._add({
      life: 0.28,
      layer: 2,
      draw(c, k) {
        const sc = 0.52 + out(k) * 0.9 * intensity;
        const alpha = 1 - inn(k);
        const spikes = 14;
        const outerR = (52 + 30 * out(k)) * intensity;
        const innerR = (18 + 6 * (1 - k)) * intensity;
        c.save();
        c.translate(anchorX, anchorY);
        c.rotate(0.16 * k);
        c.scale(sc, sc * 0.62);
        c.globalAlpha = clamp(alpha, 0, 1);

        c.beginPath();
        for (let i = 0; i < spikes * 2; i++) {
          const ang = (i * Math.PI) / spikes;
          const r = i % 2 === 0 ? outerR * (0.82 + hash12(i + 3) * 0.36) : innerR;
          const px = Math.cos(ang) * r;
          const py = Math.sin(ang) * r * 0.68;
          if (i === 0) c.moveTo(px, py);
          else c.lineTo(px, py);
        }
        c.closePath();
        c.fillStyle = "#FFFFFF";
        c.strokeStyle = pal.ink;
        c.lineWidth = 3.2;
        c.lineJoin = "miter";
        c.stroke();
        c.fill();
        c.restore();
      },
    });

    // 2. Crisp Black & White Speed Lines sweeping mostly sideways & downward (never clipped by top y=0)
    const lineCount = Math.round(16 * intensity);
    this._add({
      life: 0.3,
      layer: 1,
      draw(c, k) {
        c.save();
        c.translate(anchorX, anchorY);
        c.globalAlpha = 1 - inn(k);
        for (let i = 0; i < lineCount; i++) {
          const ang = (i / lineCount) * Math.PI * 2 + hash12(i * 7) * 0.14;
          const cos = Math.cos(ang);
          const sin = Math.sin(ang) * 0.45;
          const r0 = (68 + hash12(i * 13) * 32 + k * 84) * intensity;
          const r1 = r0 + (48 + hash12(i * 19) * 42) * (1 - k * 0.4) * intensity;
          const x0 = cos * r0;
          const y0 = Math.max(-anchorY + 6, sin * r0);
          const x1 = cos * r1;
          const y1 = Math.max(-anchorY + 4, sin * r1);
          c.beginPath();
          c.moveTo(x0, y0);
          c.lineTo(x1, y1);
          c.strokeStyle = i % 2 === 0 ? pal.ink : hasRouteTint ? pal.spark : "#FFFFFF";
          c.lineWidth = (1 - k) * (i % 2 === 0 ? 3.2 : 2.2);
          c.lineCap = "round";
          c.stroke();
        }
        c.restore();
      },
    });

    // 3. Manga Diamond Shards / Black-Outlined Sparks
    const shards = Array.from({ length: Math.round(10 * intensity) }, (_, i) => {
      const ang = (i / (10 * intensity)) * Math.PI * 2 + (hash12(i + 41) - 0.5) * 0.35;
      const spd = (195 + hash12(i + 9) * 200) * intensity;
      return {
        vx: Math.cos(ang) * spd,
        vy: Math.sin(ang) * spd * 0.45 + 16,
        sz: (4.5 + hash12(i + 23) * 5) * intensity,
        fill: i % 3 === 0 ? pal.ink : hasRouteTint ? pal.spark : "#FFFFFF",
      };
    });
    this._add({
      life: 0.38,
      layer: 3,
      draw(c, k) {
        c.save();
        c.translate(anchorX, anchorY);
        for (const s of shards) {
          const t = k;
          const px = s.vx * t * 0.35 * (1 - t * 0.25);
          const py = Math.max(-anchorY + 6, s.vy * t * 0.35 + 42 * t * t);
          const sc = 1 - inn(k);
          if (sc <= 0.03) continue;
          const ang = Math.atan2(s.vy + 80 * t, s.vx);
          c.save();
          c.translate(px, py);
          c.rotate(ang);
          c.scale(sc, sc);
          c.beginPath();
          c.moveTo(s.sz * 1.8, 0);
          c.lineTo(0, s.sz * 0.62);
          c.lineTo(-s.sz * 1.15, 0);
          c.lineTo(0, -s.sz * 0.62);
          c.closePath();
          c.fillStyle = s.fill;
          c.strokeStyle = pal.ink;
          c.lineWidth = 2.0;
          c.stroke();
          c.fill();
          c.restore();
        }
        c.restore();
      },
    });

    // 4. White Cel-Shaded Side Clouds + Wobble Arcs at left/right Pill edges
    const sideOffset = this.pillRect ? this.pillRect.w * 0.53 : 160;
    for (const side of [-1, 1]) {
      this._add({
        life: 0.42,
        layer: 3,
        draw(c, k) {
          const ease = out(k);
          const rad = (10 + ease * 7) * (1 - inn(clamp((k - 0.55) / 0.45, 0, 1)));
          if (rad <= 0.6) return;
          const px = anchorX + side * (sideOffset + ease * 24);
          const py = anchorY + 8 - ease * 6;
          c.save();
          c.translate(px, py);
          c.beginPath();
          for (let l = 0; l < 5; l++) {
            const a = (l / 5) * Math.PI * 2;
            const bx = Math.cos(a) * rad * 0.42;
            const by = Math.sin(a) * rad * 0.34;
            c.moveTo(bx + rad * 0.58, by);
            c.arc(bx, by, rad * 0.58, 0, Math.PI * 2);
          }
          c.fillStyle = "#FFFFFF";
          c.strokeStyle = pal.ink;
          c.lineWidth = 2.5;
          c.stroke();
          c.fill();
          c.restore();

          c.save();
          c.strokeStyle = pal.ink;
          c.lineWidth = Math.max(0.3, 2.2 * (1 - k));
          c.beginPath();
          for (const d of [0, 7]) {
            const rr = 14 + d + ease * 9;
            const centerAng = side > 0 ? 0 : Math.PI;
            c.moveTo(
              anchorX + side * sideOffset + Math.cos(centerAng - 0.4) * rr,
              anchorY + Math.sin(centerAng - 0.4) * rr
            );
            c.arc(anchorX + side * sideOffset, anchorY, rr, centerAng - 0.4, centerAng + 0.4);
          }
          c.stroke();
          c.restore();
        },
      });
    }
  }

  // Sweeping Anime Impact Slash
  spawnActionSlash(cx, cy, mode = "antigravity") {
    if (!this.enabled || this.isGaming) return;
    this._syncLivePillRect();
    const anchorX = this.pillRect ? this.pillRect.cx : cx;
    const anchorY = this.pillRect ? this.pillRect.cy : cy;
    const pal = resolveSakugaPalette(mode, this.pillState);
    const angles = mode === "antigravity" ? [-0.24, 0.2] : [-0.12];

    angles.forEach((angle, idx) => {
      this._add({
        life: 0.34 + idx * 0.06,
        layer: 4,
        draw(c, k) {
          const p = clamp((k - idx * 0.12) / (1 - idx * 0.12), 0, 1);
          if (p <= 0) return;
          const len = 195 + out(p) * 125;
          const thick = (1 - inn(p)) * 18;
          if (thick <= 0.5) return;
          c.save();
          c.translate(anchorX, anchorY);
          c.rotate(angle);
          c.globalAlpha = clamp((1 - inn(p)) * 1.15, 0, 1);

          c.beginPath();
          c.moveTo(-len * 0.56, 0);
          c.quadraticCurveTo(0, -thick, len * 0.56, 0);
          c.quadraticCurveTo(0, -thick * 0.14, -len * 0.56, 0);
          c.closePath();

          c.fillStyle = mode === "antigravity" || mode === "mcp_local" ? "#FF6B00" : mode === "vram_unload" ? "#7C3AED" : "#FFFFFF";
          c.strokeStyle = pal.ink;
          c.lineWidth = 3;
          c.stroke();
          c.fill();

          c.beginPath();
          c.moveTo(-len * 0.44, 0);
          c.quadraticCurveTo(0, -thick * 0.52, len * 0.44, 0);
          c.quadraticCurveTo(0, -thick * 0.1, -len * 0.44, 0);
          c.fillStyle = "#FFFFFF";
          c.fill();
          c.restore();
        },
      });
    });

    for (let i = 0; i < 4; i++) {
      const ox = (i % 2 === 0 ? -1 : 1) * (74 + hash12(i + 5) * 90);
      const oy = (i < 2 ? -1 : 1) * (8 + hash12(i + 15) * 18);
      this._add({
        life: 0.42,
        layer: 4,
        draw(c, k) {
          const s = (1 - Math.abs(k * 2 - 1)) * (10 + i * 1.5);
          if (s <= 0.4) return;
          c.save();
          c.translate(anchorX + ox, Math.max(10, anchorY + oy));
          c.rotate(k * 0.85);
          c.beginPath();
          for (let q = 0; q < 8; q++) {
            const ang = (q * Math.PI) / 4;
            const r = q % 2 === 0 ? s : s * 0.24;
            const px = Math.cos(ang) * r;
            const py = Math.sin(ang) * r;
            if (q === 0) c.moveTo(px, py);
            else c.lineTo(px, py);
          }
          c.closePath();
          c.fillStyle = "#FFFFFF";
          c.strokeStyle = pal.ink;
          c.lineWidth = 2.2;
          c.stroke();
          c.fill();
          c.restore();
        },
      });
    }
  }

  // Dark Violet cel-shaded smoke dissolve for VRAM Unload / Game Mode
  spawnVramSmokeDissolve(cx, cy, w = 240) {
    if (!this.enabled) return;
    this._syncLivePillRect();
    const anchorX = this.pillRect ? this.pillRect.cx : cx;
    const anchorY = this.pillRect ? this.pillRect.cy : cy;
    const widthRef = this.pillRect ? this.pillRect.w : w;
    const pal = SAKUGA_PALETTES.vram_unload;
    const puffs = Array.from({ length: 12 }, (_, i) => {
      const side = (i / 11) * 2 - 1;
      return {
        x: side * (widthRef * 0.44) + (hash12(i + 2) - 0.5) * 24,
        y: (hash12(i + 9) - 0.5) * 14,
        vx: side * (36 + hash12(i + 14) * 56),
        vy: -10 - hash12(i + 18) * 24,
        r: 13 + hash12(i + 29) * 13,
        dark: i % 2 === 0,
      };
    });

    this._add({
      life: 0.48,
      layer: 4,
      isSmokeDissolve: true,
      draw(c, k) {
        const ease = out(k);
        const fade = 1 - inn(k);
        for (const p of puffs) {
          const px = anchorX + p.x + p.vx * ease;
          const py = Math.max(12, anchorY + p.y + p.vy * ease);
          const rad = p.r * (0.68 + ease * 0.72) * (1 - k * 0.35);
          if (rad <= 0.8 || fade <= 0.02) continue;

          c.save();
          c.translate(px, py);
          c.globalAlpha = fade * 0.94;
          c.beginPath();
          for (let l = 0; l < 6; l++) {
            const ang = (l / 6) * Math.PI * 2;
            const bx = Math.cos(ang) * rad * 0.42;
            const by = Math.sin(ang) * rad * 0.36;
            c.moveTo(bx + rad * 0.58, by);
            c.arc(bx, by, rad * 0.58, 0, Math.PI * 2);
          }
          c.fillStyle = p.dark ? pal.smoke : pal.glow;
          c.strokeStyle = pal.ink;
          c.lineWidth = 2.6;
          c.stroke();
          c.fill();

          c.beginPath();
          c.arc(-rad * 0.22, -rad * 0.24, rad * 0.28, 0, Math.PI * 2);
          c.fillStyle = pal.accent;
          c.fill();
          c.restore();
        }
      },
    });
  }

  // Core sakuga-vfx two-tone cel cloud helper (adapted verbatim from core.js blob())
  _drawCelBlob(ctx, circles, lw, lineCol, shadeCol, fillCol, arcs = true) {
    if (!circles.length) return;
    const u = new Path2D();
    for (const [x, y, r] of circles) {
      if (r > 0.3) {
        u.moveTo(x + r, y);
        u.arc(x, y, r, 0, Math.PI * 2);
      }
    }
    ctx.save();
    ctx.lineWidth = lw * 2;
    ctx.lineJoin = "round";
    ctx.strokeStyle = lineCol;
    ctx.stroke(u);
    ctx.restore();

    ctx.save();
    ctx.clip(u);
    ctx.fillStyle = shadeCol;
    ctx.fillRect(0, 0, this.width, this.height);
    const r0 = circles[0][2] || 8;
    ctx.save();
    ctx.translate(-r0 * 0.24, -r0 * 0.32);
    ctx.fillStyle = fillCol;
    ctx.fill(u);
    ctx.restore();

    if (arcs) {
      ctx.strokeStyle = lineCol;
      ctx.lineWidth = Math.max(0.9, lw * 0.7);
      ctx.lineCap = "round";
      ctx.beginPath();
      for (const [x, y, rr] of circles) {
        if (rr > 4.2) {
          ctx.moveTo(x + Math.cos(-2.7) * (rr * 0.72), y + Math.sin(-2.7) * (rr * 0.72));
          ctx.arc(x, y, rr * 0.72, -2.7, -0.55);
        }
      }
      ctx.stroke();
    }
    ctx.restore();
  }

  // Core sakuga-vfx two-tone cel stone/shard helper (adapted verbatim from core.js shape())
  _drawCelShape(ctx, path, lw, off, lineCol, shadeCol, fillCol) {
    ctx.save();
    ctx.lineWidth = lw * 2;
    ctx.lineJoin = "miter";
    ctx.strokeStyle = lineCol;
    ctx.stroke(path);
    ctx.restore();

    ctx.save();
    ctx.clip(path);
    ctx.fillStyle = shadeCol;
    ctx.fillRect(-100, -100, 200, 200);
    ctx.translate(-off * 0.7, -off);
    ctx.fillStyle = fillCol;
    ctx.fill(path);
    ctx.restore();
  }

  // Draws flowing liquid-flame / wispy anime energy ribbons & sparks around the expanded Hub border (0% GPU in IDLE)
  _drawHandDrawnAura(ctx) {
    if (!this.pillRect || !this.shouldMaintainAura()) return;
    const { cx, cy, w, h, rx } = this.pillRect;
    const t = this.elapsed;
    const halfW = w / 2;
    const halfH = h / 2;

    const activeMood = resolveMoodTheme(this.mood, this.vfxMode);
    const theme =
      activeMood.color === "#DC2626"
        ? { deep: "#991B1B", mid: "#DC2626", tip: "#FB7185", core: "#FFE4E6" }
        : activeMood.color === "#FF6B00"
          ? { deep: "#C2410C", mid: "#FF6B00", tip: "#FDBA74", core: "#FFF7ED" }
          : activeMood.color === "#7C3AED"
            ? { deep: "#6D28D9", mid: "#9333EA", tip: "#E879F9", core: "#FAE8FF" }
            : { deep: "#0369A1", mid: "#00B4D8", tip: "#38BDF8", core: "#E0F7FA" };

    // Track slightly outside the 3px black border + 5px drop shadow so ribbons never clip or wash out
    const pad = 4;
    const ax = cx - halfW - pad;
    const ay = cy - halfH - pad;
    const aw = w + pad * 2;
    const ah = h + pad * 2;
    const ar = Math.min((rx || 16) + pad, ah / 2);

    const straightW = Math.max(0, aw - 2 * ar);
    const straightH = Math.max(0, ah - 2 * ar);
    const cornerArc = (Math.PI / 2) * ar;
    const totalP = Math.max(100, 2 * straightW + 2 * straightH + 4 * cornerArc);

    const perimPoint = (sRaw) => {
      let s = ((sRaw % totalP) + totalP) % totalP;
      if (s < straightW) {
        return { x: ax + ar + s, y: ay, nx: 0, ny: -1, tx: 1, ty: 0 };
      }
      s -= straightW;
      if (s < cornerArc) {
        const ang = -Math.PI / 2 + s / ar;
        return {
          x: ax + aw - ar + Math.cos(ang) * ar,
          y: ay + ar + Math.sin(ang) * ar,
          nx: Math.cos(ang),
          ny: Math.sin(ang),
          tx: -Math.sin(ang),
          ty: Math.cos(ang),
        };
      }
      s -= cornerArc;
      if (s < straightH) {
        return { x: ax + aw, y: ay + ar + s, nx: 1, ny: 0, tx: 0, ty: 1 };
      }
      s -= straightH;
      if (s < cornerArc) {
        const ang = s / ar;
        return {
          x: ax + aw - ar + Math.cos(ang) * ar,
          y: ay + ah - ar + Math.sin(ang) * ar,
          nx: Math.cos(ang),
          ny: Math.sin(ang),
          tx: -Math.sin(ang),
          ty: Math.cos(ang),
        };
      }
      s -= cornerArc;
      if (s < straightW) {
        return { x: ax + aw - ar - s, y: ay + ah, nx: 0, ny: 1, tx: -1, ty: 0 };
      }
      s -= straightW;
      if (s < cornerArc) {
        const ang = Math.PI / 2 + s / ar;
        return {
          x: ax + ar + Math.cos(ang) * ar,
          y: ay + ah - ar + Math.sin(ang) * ar,
          nx: Math.cos(ang),
          ny: Math.sin(ang),
          tx: -Math.sin(ang),
          ty: Math.cos(ang),
        };
      }
      s -= cornerArc;
      if (s < straightH) {
        return { x: ax, y: ay + ah - ar - s, nx: -1, ny: 0, tx: 0, ty: -1 };
      }
      s -= straightH;
      const ang = Math.PI + s / ar;
      return {
        x: ax + ar + Math.cos(ang) * ar,
        y: ay + ar + Math.sin(ang) * ar,
        nx: Math.cos(ang),
        ny: Math.sin(ang),
        tx: -Math.sin(ang),
        ty: Math.cos(ang),
      };
    };

    const drawTaperedRibbon = (sStart, len, maxW, waveAmp, waveFreq, phase, fillStyle, alpha, blur = 0) => {
      const steps = 22;
      const outerPts = [];
      const innerPts = [];
      for (let i = 0; i <= steps; i++) {
        const u = i / steps;
        const env = Math.pow(Math.sin(u * Math.PI), 0.72);
        const p = perimPoint(sStart + u * len);
        const wave = (Math.sin(u * Math.PI * waveFreq - t * 4.2 + phase) * waveAmp + waveAmp * 0.75) * env;
        const cxPt = p.x + p.nx * wave;
        const cyPt = Math.max(2, p.y + p.ny * wave);
        const hw = maxW * env * (0.72 + 0.28 * Math.sin(u * Math.PI * 2.6 + phase));
        outerPts.push([cxPt + p.nx * hw, Math.max(2, cyPt + p.ny * hw)]);
        innerPts.push([cxPt - p.nx * hw * 0.55, Math.max(2, cyPt - p.ny * hw * 0.55)]);
      }
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.fillStyle = fillStyle;
      if (blur > 0) {
        ctx.shadowColor = theme.mid;
        ctx.shadowBlur = blur;
      }
      ctx.beginPath();
      ctx.moveTo(outerPts[0][0], outerPts[0][1]);
      for (let i = 1; i <= steps; i++) ctx.lineTo(outerPts[i][0], outerPts[i][1]);
      for (let i = steps; i >= 0; i--) ctx.lineTo(innerPts[i][0], innerPts[i][1]);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    };

    const drawForkTendril = (sPos, reach, bendDir, phase) => {
      const p = perimPoint(sPos);
      const sway = Math.sin(t * 4.5 + phase) * 3.2;
      const bx = p.x + p.nx * 1.5;
      const by = Math.max(3, p.y + p.ny * 1.5);
      // Outward + tangential curved needle flare (like liquid flame licks in reference image)
      const tipX = bx + p.nx * reach + p.tx * (reach * 0.95 * bendDir + sway);
      const tipY = Math.max(2, by + p.ny * reach + p.ty * (reach * 0.95 * bendDir + sway));
      const cpX = bx + p.nx * (reach * 0.72) + p.tx * (reach * 0.25 * bendDir);
      const cpY = Math.max(2, by + p.ny * (reach * 0.72) + p.ty * (reach * 0.25 * bendDir));

      const perpX = -p.ny * 1.9;
      const perpY = p.nx * 1.9;

      ctx.save();
      ctx.globalAlpha = 0.24;
      ctx.fillStyle = theme.mid;
      ctx.beginPath();
      ctx.moveTo(bx + perpX * 1.6, by + perpY * 1.6);
      ctx.quadraticCurveTo(cpX + perpX * 0.7, cpY + perpY * 0.7, tipX, tipY);
      ctx.quadraticCurveTo(cpX - perpX * 0.7, cpY - perpY * 0.7, bx - perpX * 1.6, by - perpY * 1.6);
      ctx.closePath();
      ctx.fill();

      ctx.globalAlpha = 0.72;
      ctx.fillStyle = theme.tip;
      ctx.beginPath();
      ctx.moveTo(bx + perpX, by + perpY);
      ctx.quadraticCurveTo(cpX + perpX * 0.45, cpY + perpY * 0.45, tipX, tipY);
      ctx.quadraticCurveTo(cpX - perpX * 0.45, cpY - perpY * 0.45, bx - perpX, by - perpY);
      ctx.closePath();
      ctx.fill();

      // Subtle bright crest line along inner curve
      ctx.globalAlpha = 0.58;
      ctx.strokeStyle = theme.core;
      ctx.lineWidth = 0.9;
      ctx.beginPath();
      ctx.moveTo(bx + p.nx * 1.2, by + p.ny * 1.2);
      ctx.quadraticCurveTo(cpX, cpY, bx + (tipX - bx) * 0.62, by + (tipY - by) * 0.62);
      ctx.stroke();
      ctx.restore();
    };

    const flowBase = this.auraDist;
    const voiceSpread = Math.min(2.2, this.smoothVoice * 2.8);

    ctx.save();

    // 1. Soft subtle base aura outline hugging perimeter (no blinding halo)
    ctx.globalAlpha = 0.20;
    ctx.strokeStyle = theme.deep;
    ctx.lineWidth = 3.2;
    ctx.beginPath();
    ctx.roundRect(ax, ay, aw, ah, ar);
    ctx.stroke();

    // 2. Five intertwined flowing liquid-flame ribbons gliding smoothly around all 4 edges & corners
    const ribbonSpecs = [
      { offset: 0.0, lenFrac: 0.34, width: 3.4 + voiceSpread * 0.4, amp: 3.0, freq: 2.3, speed: 1.0, phase: 0.0 },
      { offset: 0.22, lenFrac: 0.30, width: 2.9 + voiceSpread * 0.3, amp: 2.6, freq: 2.8, speed: 1.18, phase: 1.7 },
      { offset: 0.48, lenFrac: 0.35, width: 3.5 + voiceSpread * 0.4, amp: 3.1, freq: 2.1, speed: 0.92, phase: 3.1 },
      { offset: 0.74, lenFrac: 0.28, width: 2.8 + voiceSpread * 0.3, amp: 2.5, freq: 2.9, speed: 1.12, phase: 4.6 },
      { offset: 0.12, lenFrac: 0.24, width: 2.5, amp: 2.2, freq: 3.2, speed: -0.78, phase: 2.4 },
    ];

    for (const r of ribbonSpecs) {
      const sStart = r.offset * totalP + flowBase * r.speed;
      const len = r.lenFrac * totalP;
      // Soft outer glow pass (GPU-light translucent ribbon instead of shadowBlur stalls)
      drawTaperedRibbon(sStart, len, r.width * 1.55, r.amp, r.freq, r.phase, theme.mid, 0.20, 0);
      // Outer deep saturated energy ribbon
      drawTaperedRibbon(sStart, len, r.width, r.amp, r.freq, r.phase, theme.mid, 0.56, 0);
      // Inner lighter intertwined strand
      drawTaperedRibbon(
        sStart + len * 0.10,
        len * 0.78,
        r.width * 0.55,
        r.amp * 0.95,
        r.freq + 0.5,
        r.phase + 0.9,
        theme.tip,
        0.72,
        0
      );
      // Selective bright energy pinch highlight (gives the luminous anime flare without blinding)
      drawTaperedRibbon(
        sStart + len * 0.28,
        len * 0.42,
        r.width * 0.24,
        r.amp * 0.9,
        r.freq + 0.2,
        r.phase + 0.4,
        theme.core,
        0.65,
        0
      );

      // Curved sharp outward flame tendrils branching off crest points
      const flareReach = 7.5 + voiceSpread * 1.4 + Math.sin(t * 3.4 + r.phase) * 2.2;
      drawForkTendril(sStart + len * 0.36, flareReach, r.speed >= 0 ? 1 : -1, r.phase);
      if (r.width >= 3.0) {
        drawForkTendril(sStart + len * 0.70, flareReach * 0.82, r.speed >= 0 ? 1 : -1, r.phase + 2.1);
      }
    }

    // 3. Delicate scattered glowing micro-sparks & tiny flecks drifting along the flow
    const sparkCount = 16;
    for (let i = 0; i < sparkCount; i++) {
      const seed = i * 31.7 + 7.1;
      const life = 1.15 + hash12(seed) * 0.85;
      const prog = ((t + hash12(seed + 2) * life) % life) / life;
      const sBase = hash12(seed + 4) * totalP + flowBase * 0.45;
      const pt = perimPoint(sBase + prog * 18);
      const driftOut = 3 + prog * (11 + hash12(seed + 6) * 7);
      const driftTan = Math.sin(prog * Math.PI * 2 + i) * 3.5;
      const sx = pt.x + pt.nx * driftOut + pt.tx * driftTan;
      const sy = Math.max(2, pt.y + pt.ny * driftOut + pt.ty * driftTan);
      const fade = Math.sin(prog * Math.PI);
      const rad = (0.9 + hash12(seed + 8) * 1.2) * (1 - prog * 0.35);

      ctx.save();
      ctx.globalAlpha = fade * 0.78;
      ctx.fillStyle = prog < 0.45 ? theme.core : theme.tip;
      ctx.beginPath();
      if (i % 3 === 0) {
        // Tiny tilted diamond spark fleck
        ctx.translate(sx, sy);
        ctx.rotate(Math.atan2(pt.ty, pt.tx));
        ctx.moveTo(rad * 2.1, 0);
        ctx.lineTo(0, rad * 0.85);
        ctx.lineTo(-rad * 2.1, 0);
        ctx.lineTo(0, -rad * 0.85);
        ctx.closePath();
      } else {
        ctx.arc(sx, sy, rad, 0, Math.PI * 2);
      }
      ctx.fill();
      ctx.restore();
    }

    ctx.restore();
  }

  _tick(now) {
    this.rafId = null;
    if (!this.enabled || !this.ctx || !this.canvas) {
      this._clearCanvas();
      this.onLoopStateChange?.(false);
      return;
    }

    const dt = Math.min(0.05, Math.max(0.001, (now - this.lastTime) / 1000));
    this.lastTime = now;
    this.elapsed += dt;
    this.step12Tick = Math.floor(this.elapsed * 12);

    // Smooth voice energy and integrate perimeter flow phase continuously (prevents jumps on RMS spikes)
    const rawVoice = clamp(this.voiceLevel, 0, 1);
    const alphaSmooth = 1 - Math.exp(-dt * 12);
    this.smoothVoice += (rawVoice - this.smoothVoice) * alphaSmooth;
    const activeTheme = resolveMoodTheme(this.mood, this.vfxMode);
    const isFast = activeTheme.color === "#FF6B00" || activeTheme.color === "#DC2626";
    const targetSpeed = (isFast ? 124 : 84) + Math.min(42, this.smoothVoice * 58);
    this.auraDist += dt * targetSpeed;

    this.resize();
    // Always sample current animated DOM bounding rect so Framer Motion springs never lag behind Canvas!
    this._syncLivePillRect();

    const ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.width, this.height);

    if (this.isGaming) {
      this.live = this.live.filter((item) => item.isSmokeDissolve);
    }

    if (!this.isGaming) {
      this._drawHandDrawnAura(ctx);
    }

    const alive = [];
    this.live.sort((a, b) => (a.layer || 0) - (b.layer || 0));
    for (const item of this.live) {
      item.t += dt;
      const k = item.t / item.life;
      if (k < 1) {
        item.draw(ctx, k, dt, this);
        alive.push(item);
      }
    }
    this.live = alive;

    const keepRunning =
      this.enabled &&
      ((!this.isGaming && this.shouldMaintainAura()) || this.live.length > 0);

    if (keepRunning) {
      this.rafId = requestAnimationFrame(this._tick);
    } else {
      this._clearCanvas();
      this.onLoopStateChange?.(false);
    }
  }
}
