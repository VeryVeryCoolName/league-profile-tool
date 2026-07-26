const fs = require('fs');
const path = require('path');
const {execFileSync} = require('child_process');

const root = path.resolve(__dirname, '..');

function globToRegExp(glob) {
  let pattern = '';
  for (let index = 0; index < glob.length; index++) {
    const char = glob[index];
    if (char === '*' && glob[index + 1] === '*') {
      pattern += '.*';
      index++;
      continue;
    }
    if (char === '*') {
      pattern += '[^/]*';
      continue;
    }
    if (char === '?') {
      pattern += '[^/]';
      continue;
    }
    pattern += /[.+^${}()|[\]\\]/.test(char) ? `\\${char}` : char;
  }
  return new RegExp(`^${pattern}$`);
}

function listFiles(directory, prefix = '') {
  return fs.readdirSync(directory, {withFileTypes: true}).flatMap(entry => {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    return entry.isDirectory() ? listFiles(path.join(directory, entry.name), relative) : [relative];
  });
}

function collectAssetPatterns() {
  const angularJson = JSON.parse(fs.readFileSync(path.join(root, 'angular.json'), 'utf8'));
  const patterns = [];

  Object.values(angularJson.projects || {}).forEach(project => {
    Object.values(project.architect || {}).forEach(target => {
      [target.options, ...Object.values(target.configurations || {})].forEach(options => {
        ((options && options.assets) || []).forEach(asset => {
          if (asset && typeof asset === 'object' && typeof asset.input === 'string') patterns.push(asset);
        });
      });
    });
  });

  return patterns;
}

function isGitIgnored(relativePath) {
  try {
    execFileSync('git', ['check-ignore', '-q', '--', relativePath], {cwd: root, stdio: 'ignore'});
    return true;
  } catch {
    return false;
  }
}

const seen = new Set();
const problems = [];

collectAssetPatterns().forEach(asset => {
  const key = `${asset.input}|${asset.glob}`;
  if (seen.has(key)) return;
  seen.add(key);

  const absoluteInput = path.join(root, asset.input);
  if (!fs.existsSync(absoluteInput) || !fs.statSync(absoluteInput).isDirectory()) {
    problems.push(`missing asset input directory "${asset.input}" (glob "${asset.glob}")`);
    return;
  }

  const matcher = globToRegExp(asset.glob || '**/*');
  const matches = listFiles(absoluteInput).filter(name => matcher.test(name));
  if (matches.length === 0) {
    problems.push(`glob "${asset.glob}" matched no files in "${asset.input}"`);
    return;
  }

  if (isGitIgnored(asset.input)) {
    problems.push(`asset input "${asset.input}" is git-ignored, so a clean checkout would build without it`);
  }
});

if (problems.length > 0) {
  console.error('verify-assets: angular.json asset patterns are not buildable from a clean checkout.');
  problems.forEach(problem => console.error(`  - ${problem}`));
  process.exit(1);
}

console.log(`verify-assets: ${seen.size} asset pattern(s) verified.`);
