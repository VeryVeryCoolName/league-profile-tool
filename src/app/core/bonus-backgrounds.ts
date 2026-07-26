import {COMMUNITY_DRAGON_LIVE_BRANCH, communityDragonUrl} from './community-dragon';

export interface BonusBackground {
  key: string;
  title: string;
  iconIds: number[];
  animated: boolean;
}

export const BONUS_BACKGROUNDS: BonusBackground[] = [
  {key: 'all-star-fire', title: '2016 All-Star Team Fire', iconIds: [1423], animated: false},
  {key: 'all-star-ice', title: '2016 All-Star Team Ice', iconIds: [1424], animated: false},
  {key: 'udyr-tiger', title: 'Spirit Guard Udyr Tiger', iconIds: [549], animated: true},
  {key: 'udyr-bear', title: 'Spirit Guard Udyr Bear', iconIds: [550], animated: true},
  {key: 'udyr-turtle', title: 'Spirit Guard Udyr Turtle', iconIds: [551], animated: true},
  {key: 'udyr-phoenix', title: 'Spirit Guard Udyr Phoenix', iconIds: [552], animated: true},
  {key: 'dj-sona-ethereal', title: 'DJ Sona Ethereal', iconIds: [778], animated: true},
  {key: 'dj-sona-concussive', title: 'DJ Sona Concussive', iconIds: [779], animated: true},
  {key: 'dj-sona-kinetic', title: 'DJ Sona Kinetic', iconIds: [780], animated: true},
  {key: 'pride', title: 'Pride', iconIds: [3478, 4569, 4570, 4571, 4572, 4573, 4574, 4903, 5367, 5368, 5369, 5370, 5371, 5372, 5373, 5374], animated: false}
];

const bonusBackgroundsByIconId = new Map<number, BonusBackground>();
BONUS_BACKGROUNDS.forEach(background => {
  background.iconIds.forEach(iconId => bonusBackgroundsByIconId.set(iconId, background));
});

export function bonusBackgroundForIconId(iconId: number | null | undefined): BonusBackground | null {
  if (iconId === undefined || iconId === null) return null;
  return bonusBackgroundsByIconId.get(iconId) || null;
}

export function bonusBackdropImageUrl(iconId: number): string {
  return communityDragonUrl(COMMUNITY_DRAGON_LIVE_BRANCH, `v1/summoner-backdrops/${iconId}.jpg`);
}

export function bonusBackdropVideoUrl(background: BonusBackground, iconId: number): string {
  if (!background.animated) return '';
  return communityDragonUrl(COMMUNITY_DRAGON_LIVE_BRANCH, `v1/summoner-backdrops/${iconId}.webm`);
}

export function bonusBackgroundImageUrl(background: BonusBackground): string {
  return bonusBackdropImageUrl(background.iconIds[0]);
}
