import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { rcedit } from "rcedit";

const __filename = fileURLToPath(import.meta.url);
const HUB_DIR = path.dirname(__filename);
const ICON_PATH = path.join(HUB_DIR, "jarvis.ico");
const ELECTRON_DIST = path.join(HUB_DIR, "node_modules", "electron", "dist");
const RUNTIME_DIR = path.join(HUB_DIR, "runtime");
const JARVIS_EXE = path.join(RUNTIME_DIR, "BlackSakuraJarvisHub.exe");
const WAKE_CS = path.join(HUB_DIR, "src", "JarvisWakeHelper.cs");
const WAKE_EXE = path.join(RUNTIME_DIR, "JarvisWakeHelper.exe");

function smoothstep(edge0, edge1, x) {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

function sdRoundedRect(px, py, halfW, halfH, r) {
  const qx = Math.abs(px) - halfW + r;
  const qy = Math.abs(py) - halfH + r;
  const out = Math.hypot(Math.max(qx, 0), Math.max(qy, 0));
  const inside = Math.min(Math.max(qx, qy), 0);
  return out + inside - r;
}

function makePngIcon(size) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  const half = size / 2;
  const tileHalf = size * 0.435;
  const cornerR = size * 0.22;
  const aa = Math.max(0.85, size * 0.008);
  const borderThick = Math.max(1.2, size * 0.045);

  const eyeOffsetX = tileHalf * 0.34;
  const eyeY = -size * 0.005;
  const eyeR = tileHalf * 0.175;

  for (let y = 0; y < size; y++) {
    const rowStart = y * (size * 4 + 1);
    raw[rowStart] = 0;
    for (let x = 0; x < size; x++) {
      const px = x + 0.5 - half;
      const py = y + 0.5 - half;
      const idx = rowStart + 1 + x * 4;

      // Subtle drop shadow beneath white rounded square
      const shadowDist = sdRoundedRect(px, py - size * 0.025, tileHalf, tileHalf, cornerR);
      const shadowAlpha = (1 - smoothstep(0, size * 0.055, shadowDist)) * 0.28;

      const tileDist = sdRoundedRect(px, py, tileHalf, tileHalf, cornerR);
      if (tileDist > aa && shadowAlpha <= 0.005) {
        raw[idx + 3] = 0;
        continue;
      }

      const tileCov = 1 - smoothstep(-aa, aa, tileDist);

      // Pure crisp white background (#FFFFFF) with thin manga ink outline (#0E0E13)
      let r = 255;
      let g = 255;
      let b = 255;

      const rimCov = smoothstep(-borderThick - aa, -borderThick + aa, tileDist);
      if (rimCov > 0.001) {
        r = r * (1 - rimCov) + 14 * rimCov;
        g = g * (1 - rimCov) + 14 * rimCov;
        b = b * (1 - rimCov) + 19 * rimCov;
      }

      // Two crisp round black eyes (#0E0E13)
      const dLeft = Math.hypot(px + eyeOffsetX, py - eyeY) - eyeR;
      const dRight = Math.hypot(px - eyeOffsetX, py - eyeY) - eyeR;
      const eyeDist = Math.min(dLeft, dRight);
      const eyeCov = 1 - smoothstep(-aa, aa, eyeDist);
      if (eyeCov > 0.001) {
        r = r * (1 - eyeCov) + 14 * eyeCov;
        g = g * (1 - eyeCov) + 14 * eyeCov;
        b = b * (1 - eyeCov) + 19 * eyeCov;
      }

      // Composite tile over soft transparent drop shadow
      const finalA = tileCov + shadowAlpha * (1 - tileCov);
      const shadowRgb = 14 * shadowAlpha * (1 - tileCov);
      const outR = (r * tileCov + shadowRgb) / Math.max(0.001, finalA);
      const outG = (g * tileCov + shadowRgb) / Math.max(0.001, finalA);
      const outB = (b * tileCov + shadowRgb) / Math.max(0.001, finalA);

      raw[idx] = Math.min(255, Math.max(0, Math.round(outR)));
      raw[idx + 1] = Math.min(255, Math.max(0, Math.round(outG)));
      raw[idx + 2] = Math.min(255, Math.max(0, Math.round(outB)));
      raw[idx + 3] = Math.min(255, Math.max(0, Math.round(finalA * 255)));
    }
  }

  const crcTable = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crcTable[n] = c >>> 0;
  }
  const crc32 = (buf) => {
    let c = 0xffffffff;
    for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const tBuf = Buffer.from(type, "ascii");
    const lenBuf = Buffer.alloc(4);
    lenBuf.writeUInt32BE(data.length, 0);
    const crcBuf = Buffer.alloc(4);
    crcBuf.writeUInt32BE(crc32(Buffer.concat([tBuf, data])), 0);
    return Buffer.concat([lenBuf, tBuf, data, crcBuf]);
  };

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const idat = zlib.deflateSync(raw);
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", idat),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function buildMultiResIco(outPath) {
  const sizes = [16, 32, 48, 256];
  const images = sizes.map((s) => ({ size: s, png: makePngIcon(s) }));
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // ICO
  header.writeUInt16LE(images.length, 4);

  const entries = [];
  let offset = 6 + images.length * 16;
  for (const img of images) {
    const entry = Buffer.alloc(16);
    entry[0] = img.size >= 256 ? 0 : img.size;
    entry[1] = img.size >= 256 ? 0 : img.size;
    entry[2] = 0;
    entry[3] = 0;
    entry.writeUInt16LE(1, 4);
    entry.writeUInt16LE(32, 6);
    entry.writeUInt32LE(img.png.length, 8);
    entry.writeUInt32LE(offset, 12);
    entries.push(entry);
    offset += img.png.length;
  }

  fs.writeFileSync(outPath, Buffer.concat([header, ...entries, ...images.map((i) => i.png)]));
  console.log("ICON_BUILT:", outPath, fs.statSync(outPath).size, "bytes");
}

buildMultiResIco(ICON_PATH);

// Copy Electron runtime cleanly to runtime/ and rename to JarvisHub.exe
fs.mkdirSync(RUNTIME_DIR, { recursive: true });
fs.cpSync(ELECTRON_DIST, RUNTIME_DIR, { recursive: true, force: true });
const rawElectronExe = path.join(RUNTIME_DIR, "electron.exe");
if (fs.existsSync(rawElectronExe)) {
  if (fs.existsSync(JARVIS_EXE)) fs.rmSync(JARVIS_EXE, { force: true });
  fs.renameSync(rawElectronExe, JARVIS_EXE);
}

await rcedit(JARVIS_EXE, {
  icon: ICON_PATH,
  "version-string": {
    ProductName: "Black Sakura Jarvis-Hub",
    FileDescription: "Black Sakura Jarvis-Hub — Local AI Desktop Assistant",
    CompanyName: "Black Sakura Open Source",
    InternalName: "BlackSakuraJarvisHub",
    OriginalFilename: "BlackSakuraJarvisHub.exe",
  },
  "file-version": "1.0.0",
  "product-version": "1.0.0",
});
console.log("ELECTRON_BRANDED_EXE_OK:", JARVIS_EXE);

// Compile native JarvisWakeHelper.exe (replaces powershell.exe for hotkey + Hey Jarvis)
const cscPath = "C:\\Windows\\Microsoft.NET\\Framework64\\v4.0.30319\\csc.exe";
const speechDll = "C:\\Windows\\Microsoft.NET\\Framework64\\v4.0.30319\\WPF\\System.Speech.dll";
execFileSync(
  cscPath,
  [
    "/nologo",
    "/target:winexe",
    `/win32icon:${ICON_PATH}`,
    `/out:${WAKE_EXE}`,
    "/reference:System.Windows.Forms.dll",
    `/reference:${speechDll}`,
    "/reference:System.Drawing.dll",
    WAKE_CS,
  ],
  { stdio: "inherit" }
);
console.log("WAKE_HELPER_EXE_OK:", WAKE_EXE);
