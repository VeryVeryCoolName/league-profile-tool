export interface ChampionMatchupRequest {
  allyChampionId: number;
  allyChampionName: string;
  allyChampionSlug?: string;
  enemyChampionId: number;
  enemyChampionName: string;
  enemyChampionSlug?: string;
  lane: string;
}

export interface ChampionStatsResult {
  championId: number;
  championName: string;
  lane: string;
  sourceLabel: string;
  sourceUrl: string;
  note: string;
}

export interface LaneMatchupResult {
  title: string;
  winRate: string;
  difficulty: string;
  sourceLabel: string;
  sourceUrl: string;
  note: string;
}

export interface IMatchupProvider {
  id: string;
  label: string;
  getLaneMatchup(request: ChampionMatchupRequest): Promise<LaneMatchupResult>;
  getChampionStats(championId: number, championName: string, lane: string): Promise<ChampionStatsResult>;
}

export class LolalyticsMatchupProvider implements IMatchupProvider {
  public readonly id = 'lolalytics';
  public readonly label = 'Lolalytics';
  private readonly cache = new Map<string, LaneMatchupResult>();

  public getLaneMatchup(request: ChampionMatchupRequest): Promise<LaneMatchupResult> {
    const cacheKey = [
      request.allyChampionName,
      request.enemyChampionName,
      request.lane
    ].map(value => String(value || '').toLowerCase()).join(':');
    if (this.cache.has(cacheKey)) return Promise.resolve(this.cache.get(cacheKey));

    const result = {
      title: `${request.allyChampionName} vs ${request.enemyChampionName}`,
      winRate: '',
      difficulty: '',
      sourceLabel: this.label,
      sourceUrl: this.buildMatchupUrl(
        request.allyChampionSlug || request.allyChampionName,
        request.enemyChampionSlug || request.enemyChampionName,
        request.lane
      ),
      note: ''
    };
    this.cache.set(cacheKey, result);
    return Promise.resolve(result);
  }

  public getChampionStats(championId: number, championName: string, lane: string): Promise<ChampionStatsResult> {
    return Promise.resolve({
      championId,
      championName,
      lane,
      sourceLabel: this.label,
      sourceUrl: this.buildChampionUrl(championName, lane),
      note: ''
    });
  }

  private buildChampionUrl(championName: string, lane: string): string {
    const championSlug = this.slug(championName);
    const role = this.roleSlug(lane);
    return `https://lolalytics.com/lol/${championSlug}/build/${role ? `?lane=${role}` : ''}`;
  }

  private buildMatchupUrl(allyChampionName: string, enemyChampionName: string, lane: string): string {
    const championSlug = this.slug(allyChampionName);
    const enemySlug = this.slug(enemyChampionName);
    const role = this.roleSlug(lane);
    return `https://lolalytics.com/lol/${championSlug}/vs/${enemySlug}/build/${role ? `?lane=${role}` : ''}`;
  }

  private slug(value: string): string {
    return String(value || 'unknown')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '')
      .replace(/^monkeyking$/, 'wukong');
  }

  private roleSlug(lane: string): string {
    const normalized = String(lane || '').toUpperCase();
    if (normalized === 'UTILITY' || normalized === 'SUPPORT') return 'support';
    if (normalized === 'MIDDLE') return 'middle';
    if (normalized === 'BOTTOM') return 'bottom';
    if (normalized === 'JUNGLE') return 'jungle';
    if (normalized === 'TOP') return 'top';
    return '';
  }
}
