import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const desktop = path.join(root, "desktop");
const ui = path.join(desktop, "ui");
if (!fs.existsSync(path.join(ui, "index.html"))) {
  throw new Error("ملفات الويب غير مبنية؛ شغّل pnpm desktop:build أولاً.");
}

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aswaqbadr-win-"));
const outputDir = path.join(root, "release", "windows");
try {
  for (const name of ["main.cjs", "app.ico", "package.json"]) {
    fs.copyFileSync(path.join(desktop, name), path.join(tempRoot, name));
  }
  fs.cpSync(ui, path.join(tempRoot, "ui"), { recursive: true });
  let builderConfig = fs.readFileSync(path.join(desktop, "electron-builder.cjs"), "utf8");
  builderConfig = builderConfig.replace('output: "../release/windows"', 'output: "artifacts"');
  if (!builderConfig.includes('output: "artifacts"')) {
    throw new Error("لم يتم تحديث مجلد إخراج Electron Builder المؤقت.");
  }
  fs.writeFileSync(path.join(tempRoot, "electron-builder.cjs"), builderConfig);

  const packageJson = JSON.parse(fs.readFileSync(path.join(root, "node_modules/electron-builder/package.json"), "utf8"));
  const builderCli = path.resolve(root, "node_modules/electron-builder", packageJson.bin["electron-builder"]);
  const wineCheck = spawnSync("wine", ["--version"], { stdio: "ignore" });
  const target = process.platform === "win32" || wineCheck.status === 0 ? "nsis" : "dir";
  console.log(`بناء Windows x64 (${target === "nsis" ? "مثبّت NSIS" : "مجلد محمول، Wine غير متاح"})…`);

  const result = spawnSync(process.execPath, [
    builderCli,
    "--projectDir", tempRoot,
    "--win", target,
    "--x64",
    "--config", path.join(tempRoot, "electron-builder.cjs"),
  ], { cwd: root, stdio: "inherit", env: process.env });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`فشل Electron Builder برمز ${result.status ?? "غير معروف"}.`);

  fs.rmSync(outputDir, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(outputDir), { recursive: true });
  fs.cpSync(path.join(tempRoot, "artifacts"), outputDir, { recursive: true });
  console.log(`اكتمل بناء أسواق بدر في ${outputDir}`);
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}
