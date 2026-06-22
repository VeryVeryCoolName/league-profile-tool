const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');

function absolutePath(relativePath) {
  return path.join(root, relativePath);
}

function exists(relativePath) {
  return fs.existsSync(absolutePath(relativePath));
}

function readText(relativePath) {
  return fs.readFileSync(absolutePath(relativePath), 'utf8');
}

function writeText(relativePath, content) {
  const target = absolutePath(relativePath);
  if (exists(relativePath) && fs.readFileSync(target, 'utf8') === content) return;
  fs.writeFileSync(target, content);
}

function readJson(relativePath) {
  return JSON.parse(readText(relativePath));
}

function writeJson(relativePath, value) {
  writeText(relativePath, `${JSON.stringify(value, null, 2)}\n`);
}

function normalizeVersion(value) {
  const match = String(value || '').match(/(\d+(?:\.\d+){0,2})/);
  if (!match) throw new Error('version.json must contain a numeric version.');

  const parts = match[1].split('.');
  while (parts.length < 3) parts.push('0');
  return parts.slice(0, 3).join('.');
}

function shortVersion(version) {
  return version.split('.').slice(0, 2).join('.');
}

function replaceOptional(relativePath, replacements) {
  if (!exists(relativePath)) return false;

  let content = readText(relativePath);
  const original = content;
  replacements.forEach(([pattern, replacement]) => {
    content = content.replace(pattern, replacement);
  });
  if (content !== original) writeText(relativePath, content);
  return content !== original;
}

function syncPackageJson(version) {
  const packageJson = readJson('package.json');
  packageJson.version = version;
  writeJson('package.json', packageJson);
}

function syncPackageLock(version) {
  if (!exists('package-lock.json')) return;

  const packageLock = readJson('package-lock.json');
  packageLock.version = version;
  if (packageLock.packages && packageLock.packages['']) {
    packageLock.packages[''].version = version;
  }
  writeJson('package-lock.json', packageLock);
}

function syncVersionJson(label) {
  const versionJson = readJson('version.json');
  versionJson.version = label;
  writeJson('version.json', versionJson);
}

function syncIndexTitle(short) {
  replaceOptional('src/index.html', [
    [/<title>League Profile Tool [^<]+<\/title>/, `<title>League Profile Tool ${short}</title>`]
  ]);
}

function syncReadme(version, tag) {
  replaceOptional('README.md', [
    [/releases\/download\/V\.?\d+\.\d+\.\d+\//g, `releases/download/${tag}/`],
    [/League\.Profile\.Tool\.Setup\.\d+\.\d+\.\d+\.exe/g, `League.Profile.Tool.Setup.${version}.exe`],
    [/League Profile Tool Setup \d+\.\d+\.\d+\.exe/g, `League Profile Tool Setup ${version}.exe`]
  ]);
}

function syncReleaseNotes(tag) {
  replaceOptional('RELEASE.md', [
    [/git tag V\.?\d+\.\d+\.\d+/g, `git tag ${tag}`],
    [/git push origin V\.?\d+\.\d+\.\d+/g, `git push origin ${tag}`]
  ]);
}

const versionJson = readJson('version.json');
const version = normalizeVersion(versionJson.version);
const label = `V.${version}`;
const tag = `V${version}`;
const short = shortVersion(version);

syncVersionJson(label);
syncPackageJson(version);
syncPackageLock(version);
syncIndexTitle(short);
syncReadme(version, tag);
syncReleaseNotes(tag);

console.log(`Synced League Profile Tool version ${label}.`);
