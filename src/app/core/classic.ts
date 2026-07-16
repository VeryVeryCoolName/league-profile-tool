export const CLASSIC_CHAMPION_ID_OFFSET = 60000;

export const CLASSIC_DATA_BRANCHES = ['latest', 'pbe'];

export const CLASSIC_RANKED_QUEUE = 'JADE_RANKED_SOLO_5x5';

export const CLASSIC_RANKED_TIERS = ['UNRANKED', 'SALT', 'WOOD', 'SILVER', 'GOLD', 'PLATINUM', 'DIAMOND', 'LEGEND'];

export const CLASSIC_TIERS_WITHOUT_DIVISION = ['LEGEND', 'UNRANKED'];

export function isClassicChampionKey(championKey: number): boolean {
  return Number.isFinite(championKey)
    && championKey >= CLASSIC_CHAMPION_ID_OFFSET
    && championKey < CLASSIC_CHAMPION_ID_OFFSET + 10000;
}

export function isClassicSkinId(skinId: number): boolean {
  return isClassicChampionKey(Math.floor(skinId / 1000));
}

export function isClassicRankedQueue(queue: string): boolean {
  return String(queue || '').toUpperCase().indexOf('JADE') === 0;
}
