import {communityDragonUrl} from './community-dragon';

export const CN_ICON_BRANCH = 'cn';

export interface CnExclusiveIcon {
  id: number;
  title: string;
}

export const CN_EXCLUSIVE_SUMMONER_ICONS: CnExclusiveIcon[] = [
  {id: 50, title: 'Chibi Leona'},
  {id: 51, title: 'Chibi Poppy'},
  {id: 52, title: 'Chibi Xin Zhao'},
  {id: 53, title: 'Chibi Vladimir'},
  {id: 54, title: 'Chibi Sona'},
  {id: 55, title: 'Chibi Ashe'},
  {id: 56, title: 'Chibi Tryndamere'},
  {id: 57, title: 'Chibi Rammus'},
  {id: 58, title: 'Chibi Master Yi'},
  {id: 59, title: 'Chibi Alistar'},
  {id: 60, title: 'Chibi Evelynn'},
  {id: 61, title: 'Chibi Twisted Fate'},
  {id: 62, title: 'Chibi Akali'},
  {id: 63, title: 'Chibi Zed'},
  {id: 64, title: 'Chibi Wukong'},
  {id: 65, title: 'Chibi Katarina'},
  {id: 66, title: 'Chibi Garen'},
  {id: 67, title: 'Chibi Lux'},
  {id: 68, title: 'Chibi Vayne'},
  {id: 69, title: 'Chibi Gangplank'},
  {id: 70, title: 'Chibi Ezreal'},
  {id: 71, title: 'Chibi Caitlyn'},
  {id: 72, title: 'Chibi Nasus'},
  {id: 73, title: 'Chibi Olaf'},
  {id: 74, title: 'Chibi LeBlanc'},
  {id: 75, title: 'Team WE'},
  {id: 76, title: 'Chibi Twitch'},
  {id: 77, title: 'Chibi Miss Fortune'},
  {id: 78, title: 'Chibi Renekton'}
];

const cnExclusiveIconIds = new Set<number>(CN_EXCLUSIVE_SUMMONER_ICONS.map(icon => icon.id));

export function isCnExclusiveIconId(iconId: number): boolean {
  return cnExclusiveIconIds.has(iconId);
}

export function cnIconAssetUrl(iconId: number): string {
  return `assets/cn-icons/${iconId}.png`;
}

export function cnIconImageUrl(iconId: number, dataDragonVersion: string): string {
  if (!dataDragonVersion) return cnIconAssetUrl(iconId);
  return `https://ddragon.leagueoflegends.com/cdn/${dataDragonVersion}/img/profileicon/${iconId}.png`;
}

export function profileIconImageUrl(iconId: number, branch: string, dataDragonVersion = ''): string {
  if (branch === CN_ICON_BRANCH || isCnExclusiveIconId(iconId)) return cnIconImageUrl(iconId, dataDragonVersion);
  return communityDragonUrl(branch, `v1/profile-icons/${iconId}.jpg`);
}
