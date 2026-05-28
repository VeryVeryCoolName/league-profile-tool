const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');

function readText(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function writeText(relativePath, content) {
  fs.writeFileSync(path.join(root, relativePath), content);
}

function readJson(relativePath) {
  return JSON.parse(readText(relativePath));
}

function writeJson(relativePath, value) {
  writeText(relativePath, `${JSON.stringify(value, null, 2)}\n`);
}

function normalizeVersion(value) {
  const match = String(value || '').match(/(\d+(?:\.\d+){0,2})/);
  if (!match) {
    throw new Error('version.json must contain a numeric version.');
  }

  const parts = match[1].split('.');
  while (parts.length < 3) parts.push('0');
  return parts.slice(0, 3).join('.');
}

function shortVersion(version) {
  return version.split('.').slice(0, 2).join('.');
}

function replaceFile(relativePath, replacements) {
  let content = readText(relativePath);
  replacements.forEach(([pattern, replacement]) => {
    content = content.replace(pattern, replacement);
  });
  writeText(relativePath, content);
}

const versionJson = readJson('version.json');
const version = normalizeVersion(versionJson.version);
const tag = `V${version}`;
const label = `V.${version}`;
const short = shortVersion(version);

versionJson.version = label;
writeJson('version.json', versionJson);

const packageJson = readJson('package.json');
packageJson.version = version;
writeJson('package.json', packageJson);

const packageLock = readJson('package-lock.json');
packageLock.version = version;
if (packageLock.packages && packageLock.packages['']) {
  packageLock.packages[''].version = version;
}
writeJson('package-lock.json', packageLock);

replaceFile('src/index.html', [
  [/<title>League Profile Tool [^<]+<\/title>/, `<title>League Profile Tool ${short}</title>`]
]);

replaceFile('README.md', [
  [/releases\/download\/V\d+\.\d+\.\d+\//g, `releases/download/${tag}/`]
]);

replaceFile('RELEASE.md', [
  [/git tag V\d+\.\d+\.\d+/g, `git tag ${tag}`],
  [/git push origin V\d+\.\d+\.\d+/g, `git push origin ${tag}`]
]);

console.log(`Synced League Profile Tool version ${label}.`);
