import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const electronRoot = path.join(projectRoot, 'node_modules', 'electron');
const electronRequire = createRequire(path.join(electronRoot, 'install.js'));
const executableName = process.platform === 'win32'
  ? 'electron.exe'
  : process.platform === 'darwin'
    ? 'Electron.app/Contents/MacOS/Electron'
    : 'electron';
const executablePath = path.join(electronRoot, 'dist', executableName);
const markerPath = path.join(electronRoot, 'path.txt');

if (fs.existsSync(executablePath) && fs.existsSync(markerPath)) {
  process.exit(0);
}

const electronPackage = require(path.join(electronRoot, 'package.json'));
const checksums = require(path.join(electronRoot, 'checksums.json'));
const downloaderPath = electronRequire.resolve('@electron/get');
const { downloadArtifact } = await import(pathToFileURL(downloaderPath).href);
const archivePath = await downloadArtifact({
  version: electronPackage.version,
  artifactName: 'electron',
  platform: process.platform,
  arch: process.arch,
  checksums
});
const distPath = path.join(electronRoot, 'dist');

fs.rmSync(distPath, { recursive: true, force: true });
fs.mkdirSync(distPath, { recursive: true });

if (process.platform !== 'win32') {
  throw new Error('The Electron runtime fallback currently supports Windows only.');
}

execFileSync(
  'powershell.exe',
  [
    '-NoProfile',
    '-NonInteractive',
    '-Command',
    '& { param($archive, $destination) Expand-Archive -LiteralPath $archive -DestinationPath $destination -Force }',
    archivePath,
    distPath
  ],
  { stdio: 'inherit' }
);
fs.writeFileSync(markerPath, executableName);

console.log(`Electron ${electronPackage.version} runtime installed.`);
