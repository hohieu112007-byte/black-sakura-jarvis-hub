import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { rcedit } from "rcedit";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const HUB_DIR = path.resolve(__dirname, "..");
const ROOT_DIR = path.resolve(HUB_DIR, "..");
const ELECTRON_DIST = path.join(HUB_DIR, "node_modules", "electron", "dist");
const OUT_ROOT = path.join(ROOT_DIR, "dist-exe", "Black-Sakura-Jarvis-Hub");
const PKG_VERSION = JSON.parse(fs.readFileSync(path.join(HUB_DIR, "package.json"), "utf8")).version || "1.0.0";
const ZIP_PATH = path.join(ROOT_DIR, "dist-exe", `Black-Sakura-Jarvis-Hub-v${PKG_VERSION}-Windows-Portable.zip`);
const APP_DIR = path.join(OUT_ROOT, "resources", "app");
const ICON_PATH = path.join(HUB_DIR, "jarvis.ico");
const TARGET_EXE = path.join(OUT_ROOT, "BlackSakuraJarvisHub.exe");

if (!fs.existsSync(ELECTRON_DIST)) {
  throw new Error(`Electron dist not found at ${ELECTRON_DIST}. Run 'npm install' in jarvis-hub first.`);
}
if (!fs.existsSync(path.join(HUB_DIR, "src", "renderer", "dist", "index.html"))) {
  throw new Error("React HUD build not found. Run 'npm run build' in jarvis-hub first.");
}

// 1. Ensure icon & wake helper are freshly built
if (!fs.existsSync(ICON_PATH)) {
  execFileSync(process.execPath, [path.join(HUB_DIR, "build-branding.mjs")], { stdio: "inherit" });
}

// 2. Clean target portable directory
fs.rmSync(OUT_ROOT, { recursive: true, force: true });
fs.mkdirSync(OUT_ROOT, { recursive: true });

// 3. Copy Electron runtime and remove default_app.asar so Electron loads resources/app directly
fs.cpSync(ELECTRON_DIST, OUT_ROOT, { recursive: true, force: true });
const defaultAsar = path.join(OUT_ROOT, "resources", "default_app.asar");
if (fs.existsSync(defaultAsar)) fs.rmSync(defaultAsar, { force: true });

const rawElectronExe = path.join(OUT_ROOT, "electron.exe");
if (fs.existsSync(rawElectronExe)) {
  fs.renameSync(rawElectronExe, TARGET_EXE);
}

await rcedit(TARGET_EXE, {
  icon: ICON_PATH,
  "version-string": {
    ProductName: "Black Sakura Jarvis-Hub",
    FileDescription: "Black Sakura Jarvis-Hub — Local-First Windows AI Assistant",
    CompanyName: "Black Sakura Open Source",
    InternalName: "BlackSakuraJarvisHub",
    OriginalFilename: "BlackSakuraJarvisHub.exe",
  },
  "file-version": "1.0.0",
  "product-version": "1.0.0",
});

// 4. Copy compiled native wake helper if available
const wakeExeSrc = path.join(HUB_DIR, "runtime", "JarvisWakeHelper.exe");
if (fs.existsSync(wakeExeSrc)) {
  fs.copyFileSync(wakeExeSrc, path.join(OUT_ROOT, "JarvisWakeHelper.exe"));
} else {
  const cscPath = "C:\\Windows\\Microsoft.NET\\Framework64\\v4.0.30319\\csc.exe";
  const speechDll = "C:\\Windows\\Microsoft.NET\\Framework64\\v4.0.30319\\WPF\\System.Speech.dll";
  const wakeCs = path.join(HUB_DIR, "src", "JarvisWakeHelper.cs");
  if (fs.existsSync(cscPath) && fs.existsSync(speechDll) && fs.existsSync(wakeCs)) {
    try {
      execFileSync(
        cscPath,
        [
          "/nologo",
          "/target:winexe",
          `/win32icon:${ICON_PATH}`,
          `/out:${path.join(OUT_ROOT, "JarvisWakeHelper.exe")}`,
          "/reference:System.Windows.Forms.dll",
          `/reference:${speechDll}`,
          "/reference:System.Drawing.dll",
          wakeCs,
        ],
        { stdio: "inherit" }
      );
    } catch {
      console.warn("Note: Could not compile JarvisWakeHelper.exe; app will use PowerShell fallback.");
    }
  }
}

// 5. Copy Electron app payload into resources/app (strictly excluding secrets/logs/dev source)
fs.mkdirSync(APP_DIR, { recursive: true });
const pkg = JSON.parse(fs.readFileSync(path.join(HUB_DIR, "package.json"), "utf8"));
const runtimePkg = {
  name: pkg.name,
  productName: pkg.productName || "Black Sakura Jarvis-Hub",
  version: pkg.version,
  description: pkg.description,
  main: pkg.main,
  type: pkg.type,
};
fs.writeFileSync(path.join(APP_DIR, "package.json"), JSON.stringify(runtimePkg, null, 2), "utf8");
fs.copyFileSync(ICON_PATH, path.join(APP_DIR, "jarvis.ico"));

fs.cpSync(path.join(HUB_DIR, "src"), path.join(APP_DIR, "src"), {
  recursive: true,
  filter: (src) => !src.includes(`${path.sep}renderer-react`),
});

// Copy production dependency @google/genai if present (used by optional gemini-agent fallback)
const genaiSrc = path.join(HUB_DIR, "node_modules", "@google");
if (fs.existsSync(genaiSrc)) {
  fs.cpSync(genaiSrc, path.join(APP_DIR, "node_modules", "@google"), { recursive: true });
}

// 6. Copy backend & fast-desktop-mcp (STRICTLY excluding .env, .session_token, config.json, __pycache__, logs)
const EXCLUDED_NAMES = new Set([
  ".env",
  ".session_token",
  "config.json",
  "backend_error.log",
  "__pycache__",
  "state.json",
  "task_inbox.json",
  "node_modules",
]);

fs.cpSync(path.join(ROOT_DIR, "backend"), path.join(OUT_ROOT, "backend"), {
  recursive: true,
  filter: (src) => {
    const base = path.basename(src);
    if (EXCLUDED_NAMES.has(base)) return false;
    if (base.endsWith(".pyc") || base.endsWith(".log") || base.startsWith(".env.")) return false;
    return true;
  },
});

fs.cpSync(path.join(ROOT_DIR, "fast-desktop-mcp"), path.join(OUT_ROOT, "fast-desktop-mcp"), {
  recursive: true,
  filter: (src) => !EXCLUDED_NAMES.has(path.basename(src)),
});

for (const rootFile of ["requirements.txt", ".env.example", "start_backend.bat", "LICENSE", "README.md"]) {
  const srcPath = path.join(ROOT_DIR, rootFile);
  if (fs.existsSync(srcPath)) {
    fs.copyFileSync(srcPath, path.join(OUT_ROOT, rootFile));
  }
}
for (const docFile of ["USER_GUIDE.md", "SETUP_GUIDE.md"]) {
  const docSrc = path.join(ROOT_DIR, "docs", docFile);
  if (fs.existsSync(docSrc)) {
    fs.mkdirSync(path.join(OUT_ROOT, "docs"), { recursive: true });
    fs.copyFileSync(docSrc, path.join(OUT_ROOT, "docs", docFile));
  }
}

// 7. Write quickstart guide inside the portable pack
const quickstartTxt = [
  "================================================================",
  `  BLACK SAKURA JARVIS-HUB v${PKG_VERSION} — WINDOWS PORTABLE PACK`,
  "================================================================",
  "",
  "BUOC 1 (Chi can lam 1 lan duy nhat):",
  "  - Dam bao may da cai Python 3.10+ (https://www.python.org/downloads/)",
  "  - Mo Terminal / PowerShell tai thu muc nay va chay:",
  "      pip install -r requirements.txt",
  "",
  "BUOC 2 (Chay ung dung):",
  "  - Bam dup vao file: BlackSakuraJarvisHub.exe",
  "  - Lan dau mo, cua so Thiet lap ban dau (Setup Wizard) se hien len",
  "    de hoi quyen, hien canh bao bao mat, tu nhan dien man hinh / GPU,",
  "    goi y cai Ollama (hoac nhap Cloud Gemini API Key) roi moi thu nho",
  "    thanh Mini HUD tren man hinh.",
  "",
  "LUU Y:",
  "  - Chua cai Ollama? Khong sao! Tang 1 (dieu khien app/tab/am luong/",
  "    do sang/chuyen man hinh) van chay tuc thi (<50ms, 0 MB VRAM).",
  "  - Muon mo lai Setup Wizard sau nay: vao Cai dat -> Chung -> Mo lai",
  "    Thiet lap lan dau, hoac chuot phai icon duoi khay he thong.",
  "  - Tai ban moi & xem tai lieu day du tai:",
  "    https://github.com/hohieu112007-byte/black-sakura-jarvis-hub",
  "",
].join("\r\n");
fs.writeFileSync(path.join(OUT_ROOT, "HUONG-DAN-NHANH.txt"), quickstartTxt, "utf8");

// 8. Secret hygiene audit — abort if any sensitive/local-only file leaked into the portable folder
const FORBIDDEN_BASENAMES = new Set([
  ".env",
  ".session_token",
  "config.json",
  "state.json",
  "task_inbox.json",
  "backend_error.log",
]);
const leakedFiles = [];
function auditDir(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      auditDir(full);
    } else if (
      FORBIDDEN_BASENAMES.has(entry.name) ||
      entry.name.endsWith(".log") ||
      (entry.name.startsWith(".env.") && entry.name !== ".env.example")
    ) {
      leakedFiles.push(path.relative(OUT_ROOT, full));
    }
  }
}
auditDir(OUT_ROOT);
if (leakedFiles.length > 0) {
  throw new Error(`SECURITY ABORT: Forbidden files detected in portable pack: ${leakedFiles.join(", ")}`);
}

// 9. Compress into a single downloadable Windows Portable ZIP pack
if (fs.existsSync(ZIP_PATH)) {
  fs.rmSync(ZIP_PATH, { force: true });
}
console.log("Creating portable ZIP pack:", ZIP_PATH);
execFileSync(
  "powershell.exe",
  [
    "-NoProfile",
    "-NonInteractive",
    "-Command",
    `Compress-Archive -Path '${OUT_ROOT}' -DestinationPath '${ZIP_PATH}' -CompressionLevel Optimal -Force`,
  ],
  { stdio: "inherit" }
);

const zipSizeMb = (fs.statSync(ZIP_PATH).size / (1024 * 1024)).toFixed(1);
console.log("PORTABLE_EXE_PACKAGE_READY:", TARGET_EXE);
console.log(`PORTABLE_ZIP_PACK_READY: ${ZIP_PATH} (${zipSizeMb} MB)`);
