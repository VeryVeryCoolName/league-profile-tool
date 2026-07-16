export const COMMUNITY_DRAGON_LIVE_BRANCH = 'latest';

export const COMMUNITY_DRAGON_PBE_BRANCH = 'pbe';

export const COMMUNITY_DRAGON_BRANCHES = [COMMUNITY_DRAGON_LIVE_BRANCH, COMMUNITY_DRAGON_PBE_BRANCH];

export function communityDragonUrl(branch: string, relativePath: string): string {
  return `https://raw.communitydragon.org/${branch}/plugins/rcp-be-lol-game-data/global/default/${relativePath}`;
}

export function communityDragonAssetUrl(path: unknown, branch = COMMUNITY_DRAGON_LIVE_BRANCH): string {
  const assetPath = String(path || '').trim();
  if (!assetPath) return '';
  const normalizedPath = assetPath
    .replace(/^\/lol-game-data\/assets\//i, '')
    .replace(/^\//, '')
    .toLowerCase();
  return communityDragonUrl(branch, normalizedPath);
}
