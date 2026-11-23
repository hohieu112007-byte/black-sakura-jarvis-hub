import React, { useRef } from "react";

const BAR_X = [6, 13, 20, 27, 34, 41, 48];
const BAR_WEIGHTS = [0.42, 0.72, 0.94, 1.0, 0.88, 0.68, 0.45];

/**
 * Sound-Reactive Manga / Sakuga Voice Waveform:
 * - Zero idle timer: lies flat & crisp when voiceLevel < 0.025 (typing, silent, or muted)
 * - Drives 7 ink+aura bars directly from incoming mic/TTS voiceLevel frames
 */
export function SakugaWaveform({
  voiceLevel = 0,
  vfxMode = "listening",
  mood = "listening",
  pillState = "listening",
  sakugaEnabled = true,
  isGaming = false,
}) {
  const phaseRef = useRef(0);
  const clamped = Math.max(0, Math.min(1, Number(voiceLevel) || 0));
  const hasSound = !isGaming && pillState !== "idle" && clamped >= 0.025;

  if (hasSound) {
    phaseRef.current = (phaseRef.current + 0.65 + clamped * 0.9) % (Math.PI * 2);
  } else {
    phaseRef.current = 0;
  }

  const mangaShadeColor = "#D4D4E0";

  const barHeights = BAR_X.map((_, idx) => {
    if (!hasSound) return 2.4;
    const harmonic = 0.68 + 0.32 * Math.sin(phaseRef.current + idx * 1.15 + clamped * 4.2);
    const boosted = Math.pow(clamped, 0.72) * 21.0 * BAR_WEIGHTS[idx] * harmonic;
    return Math.max(3.2, Math.min(23.0, 3.0 + boosted));
  });

  return (
    <svg
      width="58"
      height="28"
      viewBox="0 0 58 28"
      fill="none"
      className="shrink-0 overflow-visible"
      aria-hidden="true"
    >
      {!hasSound ? (
        <>
          <line
            x1="4"
            y1="14"
            x2="54"
            y2="14"
            stroke={mangaShadeColor}
            strokeOpacity="0.8"
            strokeWidth="4.2"
            strokeLinecap="round"
          />
          <line
            x1="4"
            y1="14"
            x2="54"
            y2="14"
            stroke="#0E0E13"
            strokeWidth="2.1"
            strokeLinecap="round"
          />
        </>
      ) : (
        BAR_X.map((x, idx) => {
          const h = barHeights[idx];
          const y = 14 - h / 2;
          return (
            <g key={x}>
              {sakugaEnabled && (
                <rect
                  x={x - 0.8}
                  y={y - 0.8}
                  width="5.2"
                  height={h + 1.6}
                  rx="2.6"
                  fill={mangaShadeColor}
                  fillOpacity="0.85"
                />
              )}
              <rect
                x={x}
                y={y}
                width="3.6"
                height={h}
                rx="1.8"
                fill="#0E0E13"
              />
            </g>
          );
        })
      )}
    </svg>
  );
}
