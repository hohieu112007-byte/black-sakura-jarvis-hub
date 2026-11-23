import React, { useEffect, useState } from "react";
import { resolveMoodTheme } from "../sakugaVfxEngine.js";

/**
 * Retro CRT Pixel-Matrix Anime Mascot Face (Style 2: Monochrome Ink #0E0E13 directly on White Paper)
 * Inspired by fayazara/robot-heads with all 9 expressions mapped to Jarvis Hub states:
 * - idle: pixel block eyes with anime specular glint, natural blink, glance & micro-hop
 * - sleeping: closed flat pixel eyes + rising pixel "z Z" + slow breathing
 * - listening / dictation: alert pixel eyes + live pixel equalizer mouth bars
 * - thinking: heavy-lidded eyes looking up + 3 cycling pixel dots (...)
 * - searching: darting eyes + monochrome horizontal scan beam
 * - working / executing: focused eyes looking down + pixel progress bar
 * - speaking: friendly pixel eyes + dynamic talking pixel mouth
 * - happy / success: ^ ^ pixel crescent eyes + pixel smile + cheerful bounce
 * - error: red X X pixel eyes + jagged frown + stepped shake
 */

function PixelEyeBlock({ x, y, h = 11, fill, glint = true }) {
  return (
    <g>
      <rect x={x} y={y} width="9" height={h} rx="1.2" fill={fill} />
      {glint && h >= 7 && (
        <>
          <rect x={x + 1.8} y={y + 1.8} width="2.2" height="2.2" rx="0.4" fill="#FFFFFF" />
          <rect x={x + 5.2} y={y + 5.2} width="1.3" height="1.3" rx="0.3" fill="#FFFFFF" />
        </>
      )}
    </g>
  );
}

export function MascotFace({
  state = "idle",
  vfxMode = "idle",
  sakugaEnabled = true,
  voiceLevel = 0,
}) {
  const [blinking, setBlinking] = useState(false);
  const [glanceX, setGlanceX] = useState(0);
  const [hopY, setHopY] = useState(0);
  const [tick, setTick] = useState(0);

  // Normalize state aliases into the 9 robot-heads moods
  const mood =
    state === "dictation"
      ? "listening"
      : state === "executing"
        ? "working"
        : state === "success"
          ? "happy"
          : state;

  const isIdle = mood === "idle";
  const isSleeping = mood === "sleeping";
  const isAnimatedMood =
    sakugaEnabled &&
    (mood === "listening" ||
      mood === "thinking" ||
      mood === "searching" ||
      mood === "working" ||
      mood === "speaking" ||
      mood === "error");

  // Idle natural blink + occasional glance + gentle hop (zero timers when sleeping or sakuga off)
  useEffect(() => {
    if (!isIdle || !sakugaEnabled) {
      setBlinking(false);
      setGlanceX(0);
      setHopY(0);
      return;
    }
    let alive = true;
    let blinkTimer = null;
    let unblinkTimer = null;
    let glanceTimer = null;
    let hopResetTimer = null;

    const scheduleBlink = () => {
      const delay = 2800 + Math.round(Math.random() * 1400);
      blinkTimer = setTimeout(() => {
        if (!alive) return;
        setBlinking(true);
        unblinkTimer = setTimeout(() => {
          if (!alive) return;
          setBlinking(false);
          scheduleBlink();
        }, 125);
      }, delay);
    };

    const scheduleGlance = () => {
      const delay = 2000 + Math.round(Math.random() * 1800);
      glanceTimer = setTimeout(() => {
        if (!alive) return;
        const dirs = [-2, 0, 2, 0];
        setGlanceX(dirs[Math.floor(Math.random() * dirs.length)]);
        if (Math.random() < 0.35) {
          setHopY(-1.5);
          hopResetTimer = setTimeout(() => {
            if (alive) setHopY(0);
          }, 180);
        }
        scheduleGlance();
      }, delay);
    };

    scheduleBlink();
    scheduleGlance();

    return () => {
      alive = false;
      clearTimeout(blinkTimer);
      clearTimeout(unblinkTimer);
      clearTimeout(glanceTimer);
      clearTimeout(hopResetTimer);
    };
  }, [isIdle, sakugaEnabled]);

  // Stepped 12fps-style pixel tick for active agent moods (thinking / searching / working / speaking / listening)
  useEffect(() => {
    if (!isAnimatedMood) {
      setTick(0);
      return;
    }
    const id = setInterval(() => {
      setTick((t) => (t + 1) % 24);
    }, 145);
    return () => clearInterval(id);
  }, [isAnimatedMood]);

  const inkColor = "#0E0E13";
  const moodTheme = resolveMoodTheme(mood, vfxMode);
  const eyeFill = moodTheme.color;

  // Derived offsets per mood
  const searchSweep = mood === "searching" ? Math.round(Math.sin((tick / 24) * Math.PI * 2) * 3) : 0;
  const shakeX = mood === "error" && isAnimatedMood ? (tick % 2 === 0 ? -1.4 : 1.4) : 0;
  const happyBounceY = mood === "happy" ? -0.8 : 0;
  const workingBobY = mood === "working" && isAnimatedMood ? (tick % 2 === 0 ? -0.8 : 0.4) : 0;
  const faceOffsetY = hopY + happyBounceY + workingBobY;

  // Equalizer bars for listening
  const lvlBoost = Math.max(0.15, Math.min(1, voiceLevel * 1.4));
  const eqHeights = [0, 1, 2, 3, 4].map((idx) => {
    const wave = 0.45 + 0.55 * Math.abs(Math.sin(tick * 0.75 + idx * 1.1));
    return Math.max(2, Math.round(2 + lvlBoost * wave * 5));
  });

  // Speaking mouth pixel height
  const speakOpen =
    mood === "speaking"
      ? voiceLevel > 0.03
        ? Math.max(2, Math.min(6, Math.round(2 + voiceLevel * 6)))
        : [2, 4, 3, 5, 2, 4][tick % 6]
      : 0;

  // Lightweight 2.5D head-tilt perspective (zero WebGL / zero rAF loop; stepped anime cadence)
  let headTransform = "perspective(180px)";
  if (sakugaEnabled) {
    if (isIdle) {
      const ry = glanceX * 5;
      const rx = hopY < 0 ? 7 : 0;
      headTransform = `perspective(180px) translateY(${hopY}px) rotateY(${ry}deg) rotateX(${rx}deg)`;
    } else if (isSleeping) {
      headTransform = "perspective(180px) rotateX(-7deg)";
    } else if (mood === "thinking") {
      const side = tick % 12 < 6 ? -1 : 1;
      headTransform = `perspective(180px) rotateX(9deg) rotateY(${side * 9}deg) rotateZ(${side * 5}deg)`;
    } else if (mood === "searching") {
      headTransform = `perspective(180px) rotateY(${searchSweep * 5}deg) rotateZ(${searchSweep * 1.2}deg)`;
    } else if (mood === "working") {
      const bob = tick % 2 === 0 ? -0.6 : 0.4;
      headTransform = `perspective(180px) translateY(${bob}px) rotateX(-9deg)`;
    } else if (mood === "listening") {
      const nod = tick % 8 < 4 ? -3 : 2;
      headTransform = `perspective(180px) rotateY(4deg) rotateZ(${nod}deg)`;
    } else if (mood === "speaking") {
      const nod = tick % 4 < 2 ? 3 : -1;
      headTransform = `perspective(180px) rotateX(${nod}deg)`;
    } else if (mood === "happy") {
      headTransform = "perspective(180px) translateY(-1.5px) scale(1.03) rotateX(6deg)";
    } else if (mood === "error") {
      const errTilt = tick % 2 === 0 ? -5 : 5;
      headTransform = `perspective(180px) rotateY(${errTilt * 2}deg) rotateZ(${errTilt}deg)`;
    }
  }

  return (
    <div
      className="shrink-0 inline-flex items-center justify-center"
      style={{
        transform: headTransform,
        transition: sakugaEnabled && !isSleeping ? "transform 160ms steps(3, end)" : "none",
        transformStyle: "preserve-3d",
      }}
    >
    <svg
      width="70"
      height="32"
      viewBox="0 0 70 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className="shrink-0"
      aria-hidden="true"
    >
      <defs>
        {/* Subtle dot-matrix phosphor pixel grid on white manga paper */}
        <pattern id="jarvis-pixel-grid" width="3" height="3" patternUnits="userSpaceOnUse">
          <rect x="0" y="0" width="1" height="1" fill="#0E0E13" fillOpacity="0.065" />
        </pattern>
      </defs>

      <rect x="4" y="1" width="62" height="30" rx="5" fill="url(#jarvis-pixel-grid)" />

      <g transform={`translate(${shakeX}, ${faceOffsetY})`}>
        {/* 1. SLEEPING: closed - - pixel eyes + rising z Z */}
        {isSleeping && (
          <g className="crt-sleep-breathe">
            <rect x="14" y="13" width="10" height="2.4" rx="0.6" fill={inkColor} opacity="0.78" />
            <rect x="46" y="13" width="10" height="2.4" rx="0.6" fill={inkColor} opacity="0.78" />
            <rect x="31" y="22" width="8" height="2" rx="0.6" fill={inkColor} opacity="0.65" />
            {/* Tiny pixel z Z */}
            <text
              x="58"
              y="10"
              fill={inkColor}
              fontSize="7"
              fontWeight="900"
              fontFamily="monospace"
              opacity="0.7"
            >
              z
            </text>
            <text
              x="62"
              y="6"
              fill={inkColor}
              fontSize="6"
              fontWeight="900"
              fontFamily="monospace"
              opacity="0.45"
            >
              Z
            </text>
          </g>
        )}

        {/* 2. ERROR: crisp red X X pixel eyes + jagged frown */}
        {mood === "error" && (
          <g>
            {/* Left X */}
            <path d="M 14.5 7.5 L 22.5 15.5 M 22.5 7.5 L 14.5 15.5" stroke={eyeFill} strokeWidth="2.8" strokeLinecap="square" />
            {/* Right X */}
            <path d="M 47.5 7.5 L 55.5 15.5 M 55.5 7.5 L 47.5 15.5" stroke={eyeFill} strokeWidth="2.8" strokeLinecap="square" />
            {/* Stepped Pixel Frown */}
            <path
              d="M 28 24.5 L 31.5 22 L 35 24.5 L 38.5 22 L 42 24.5"
              stroke={inkColor}
              strokeWidth="2.2"
              strokeLinecap="square"
              strokeLinejoin="miter"
            />
          </g>
        )}

        {/* 3. HAPPY: ^ ^ pixel crescent eyes + cheerful pixel smile */}
        {mood === "happy" && (
          <g>
            {/* Left ^ pixel arch */}
            <rect x="13" y="12.5" width="3" height="3" rx="0.5" fill={eyeFill} />
            <rect x="16" y="9.5" width="3" height="3" rx="0.5" fill={eyeFill} />
            <rect x="19" y="9.5" width="3" height="3" rx="0.5" fill={eyeFill} />
            <rect x="22" y="12.5" width="3" height="3" rx="0.5" fill={eyeFill} />
            {/* Right ^ pixel arch */}
            <rect x="45" y="12.5" width="3" height="3" rx="0.5" fill={eyeFill} />
            <rect x="48" y="9.5" width="3" height="3" rx="0.5" fill={eyeFill} />
            <rect x="51" y="9.5" width="3" height="3" rx="0.5" fill={eyeFill} />
            <rect x="54" y="12.5" width="3" height="3" rx="0.5" fill={eyeFill} />
            {/* Pixel Smile */}
            <rect x="29" y="21" width="2.4" height="2.2" rx="0.4" fill={inkColor} />
            <rect x="31.4" y="23" width="7.2" height="2.2" rx="0.4" fill={inkColor} />
            <rect x="38.6" y="21" width="2.4" height="2.2" rx="0.4" fill={inkColor} />
          </g>
        )}

        {/* 4. IDLE / LISTENING / THINKING / SEARCHING / WORKING / SPEAKING */}
        {!isSleeping && mood !== "error" && mood !== "happy" && (
          <>
            {/* Eyes */}
            {mood === "thinking" ? (
              // Heavy-lidded pixel eyes looking up
              <g>
                <rect x="14" y="9" width="9" height="2" rx="0.4" fill={eyeFill} opacity="0.45" />
                <PixelEyeBlock x={14} y={10.5} h={6.5} fill={eyeFill} glint={false} />
                <rect x="16" y="11.2" width="2.2" height="2" rx="0.3" fill="#FFFFFF" />

                <rect x="47" y="9" width="9" height="2" rx="0.4" fill={eyeFill} opacity="0.45" />
                <PixelEyeBlock x={47} y={10.5} h={6.5} fill={eyeFill} glint={false} />
                <rect x="49" y="11.2" width="2.2" height="2" rx="0.3" fill="#FFFFFF" />
              </g>
            ) : mood === "working" ? (
              // Focused eyes looking downward at progress bar
              <g>
                <PixelEyeBlock x={14} y={9.5} h={8.5} fill={eyeFill} glint={false} />
                <rect x="16" y="13.5" width="2.2" height="2.2" rx="0.3" fill="#FFFFFF" />
                <PixelEyeBlock x={47} y={9.5} h={8.5} fill={eyeFill} glint={false} />
                <rect x="49" y="13.5" width="2.2" height="2.2" rx="0.3" fill="#FFFFFF" />
              </g>
            ) : (
              // Standard pixel block eyes (idle blink/glance, searching dart, listening alert, speaking friendly)
              <g>
                <PixelEyeBlock
                  x={14 + (isIdle ? glanceX : searchSweep)}
                  y={blinking ? 12.5 : mood === "listening" ? 6.2 : 6.8}
                  h={blinking ? 2.4 : mood === "listening" ? 11.5 : 10.8}
                  fill={eyeFill}
                  glint={!blinking}
                />
                <PixelEyeBlock
                  x={47 + (isIdle ? glanceX : searchSweep)}
                  y={blinking ? 12.5 : mood === "listening" ? 6.2 : 6.8}
                  h={blinking ? 2.4 : mood === "listening" ? 11.5 : 10.8}
                  fill={eyeFill}
                  glint={!blinking}
                />
              </g>
            )}

            {/* Searching Horizontal Pixel Scan Beam */}
            {mood === "searching" && (
              <rect
                x={8 + ((tick * 3) % 48)}
                y="4"
                width="4"
                height="22"
                rx="0.5"
                fill={eyeFill}
                opacity="0.18"
              />
            )}

            {/* Mouth / Chin Pixel Indicator per Mood */}
            {mood === "thinking" && (
              <g>
                {[0, 1, 2].map((i) => {
                  const active = tick % 4 === i;
                  return (
                    <rect
                      key={i}
                      x={28.5 + i * 5}
                      y={active ? 21.5 : 22.8}
                      width="3"
                      height={active ? 3.4 : 2.2}
                      rx="0.5"
                      fill={eyeFill}
                      opacity={active ? 1 : 0.35}
                    />
                  );
                })}
              </g>
            )}

            {mood === "working" && (
              // Mini pixel progress bar
              <g>
                <rect x="23" y="22.5" width="24" height="3" rx="0.8" fill={inkColor} opacity="0.16" />
                <rect
                  x={23 + ((tick * 2) % 16)}
                  y="22.5"
                  width="8"
                  height="3"
                  rx="0.8"
                  fill={eyeFill}
                />
              </g>
            )}

            {mood === "listening" && (
              // Live pixel equalizer bars
              <g>
                {eqHeights.map((bh, idx) => (
                  <rect
                    key={idx}
                    x={26.5 + idx * 3.6}
                    y={26 - bh}
                    width="2.2"
                    height={bh}
                    rx="0.4"
                    fill={eyeFill}
                  />
                ))}
              </g>
            )}

            {mood === "speaking" && (
              // Animated pixel talking mouth tinted with active mood color
              <rect
                x="29.5"
                y={23 - speakOpen / 2}
                width="11"
                height={speakOpen}
                rx="1"
                fill={eyeFill}
              />
            )}

            {(mood === "idle" || mood === "searching") && (
              // Clean retro pixel mouth
              <g>
                <rect x="30" y="22.4" width="10" height="2.2" rx="0.6" fill={inkColor} />
                {mood === "idle" && (
                  <>
                    <rect x="28.6" y="21.4" width="1.6" height="1.6" rx="0.4" fill={inkColor} opacity="0.7" />
                    <rect x="39.8" y="21.4" width="1.6" height="1.6" rx="0.4" fill={inkColor} opacity="0.7" />
                  </>
                )}
              </g>
            )}
          </>
        )}
      </g>
    </svg>
    </div>
  );
}
