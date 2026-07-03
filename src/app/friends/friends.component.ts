import {ChangeDetectionStrategy, Component, OnDestroy} from '@angular/core';
import {firstValueFrom, Subscription} from 'rxjs';
import {ConnectorService} from '../core/services/connector/connector.service';
import {LCUConnectionService} from '../core/services/lcuconnection/lcuconnection.service';
import {ElectronService} from '../core/services/electron/electron.service';
import {LcuEventsService, LcuJsonApiEvent} from '../core/services/lcu-events/lcu-events.service';
import {MatDialog} from '@angular/material/dialog';
import {DialogComponent} from '../core/dialog/dialog.component';

type PresenceFilter = 'all' | 'online' | 'offline' | 'busy' | 'mobile';
type RefineToggle = 'discord' | 'league' | 'eligible' | 'lobby';
type FriendAction = 'invite' | '';
type FriendActionState = 'idle' | 'unfriending' | 'removed' | 'error';

interface RequestResult {
  ok: boolean;
  value: any;
  message: string;
}

interface HelpCapabilities {
  loaded: boolean;
  leagueInvite: boolean;
  unfriend: boolean;
  lobbyLinkGenerate: boolean;
}

interface FriendGroupView {
  id: string;
  name: string;
}

interface FriendCardView {
  key: string;
  friendId: string;
  puuid: string;
  summonerId: string;
  displayName: string;
  gameName: string;
  tagLine: string;
  profileIconUrl: string;
  availability: string;
  availabilityLabel: string;
  statusKind: 'online' | 'offline' | 'busy' | 'mobile';
  isMobile: boolean;
  statusText: string;
  groupName: string;
  isLeagueFriend: boolean;
  isDiscordLinked: boolean;
  isDiscordOnly: boolean;
  discordStatus: string;
  isInviteEligible: boolean;
  inCurrentLobby: boolean;
  inviteReason: string;
  unfriendReason: string;
  actionBusy: FriendAction;
  actionState: FriendActionState;
}

@Component({
    selector: 'app-friends',
    templateUrl: './friends.component.html',
    styleUrls: ['./friends.component.css'],
    changeDetection: ChangeDetectionStrategy.Eager,
    standalone: false
})
export class FriendsComponent implements OnDestroy {
  private readonly lobbyJoinCodePostFunction = 'PostLolLobbyV2AgsByActivityIdJoinCode';
  private readonly fallbackActivityIds = ['lol', 'league_of_legends'];

  public readonly presenceOptions: Array<{id: PresenceFilter; label: string}> = [
    {id: 'all', label: 'All'},
    {id: 'online', label: 'Online'},
    {id: 'offline', label: 'Offline'},
    {id: 'busy', label: 'In Game'},
    {id: 'mobile', label: 'Mobile'}
  ];

  public readonly refineOptions: Array<{id: RefineToggle; label: string}> = [
    {id: 'discord', label: 'Discord'},
    {id: 'league', label: 'League Only'},
    {id: 'eligible', label: 'Invite Eligible'},
    {id: 'lobby', label: 'In Lobby'}
  ];

  public connected$ = this.connector.ready$;
  public searchKeyword = '';
  public presenceFilter: PresenceFilter = 'all';
  public activeRefines: Record<RefineToggle, boolean> = {
    discord: false,
    league: false,
    eligible: false,
    lobby: false
  };
  public friends: FriendCardView[] = [];
  public filteredFriends: FriendCardView[] = [];
  public visibleFriends: FriendCardView[] = [];
  public visibleLimit = 48;
  public presenceCounts: Record<PresenceFilter, number> = {
    all: 0,
    online: 0,
    offline: 0,
    busy: 0,
    mobile: 0
  };
  public refineCounts: Record<RefineToggle, number> = {
    discord: 0,
    league: 0,
    eligible: 0,
    lobby: 0
  };
  public friendGroups: FriendGroupView[] = [];
  public refreshLoading = false;
  public friendsError = '';
  public actionMessage = '';
  public actionError = '';
  public friendActionBusy: Record<string, FriendAction> = {};
  public friendActionStates: Record<string, FriendActionState> = {};

  public helpCapabilities: HelpCapabilities = {
    loaded: false,
    leagueInvite: false,
    unfriend: false,
    lobbyLinkGenerate: false
  };

  public lobbyState = {
    active: false,
    members: [] as any[],
    memberKeys: new Set<string>(),
    lobbyFound: false
  };

  public lobbyLink = {
    generating: false,
    message: 'Create a lobby first.',
    copiedAt: '',
    activityId: ''
  };

  private readonly connectorSubscription: Subscription;
  private readonly removeAnimationMs = 260;
  private readonly removalTimers: Array<ReturnType<typeof setTimeout>> = [];
  private readonly eventsSubscription: Subscription;
  private lobbyRefreshTimer: ReturnType<typeof setTimeout> | null = null;
  private lobbyRefreshActive = false;
  private refreshedForConnection = false;

  constructor(
    private lcuConnectionService: LCUConnectionService,
    private connector: ConnectorService,
    private electronService: ElectronService,
    private lcuEventsService: LcuEventsService,
    private dialog: MatDialog
  ) {
    this.connectorSubscription = this.connector.ready$.subscribe(ready => {
      if (!ready) {
        this.refreshedForConnection = false;
        this.helpCapabilities = {
          loaded: false,
          leagueInvite: false,
          unfriend: false,
          lobbyLinkGenerate: false
        };
        return;
      }
      if (this.refreshedForConnection) return;
      this.refreshedForConnection = true;
      void this.refreshAll();
    });
    this.eventsSubscription = this.lcuEventsService.events$.subscribe(event => this.handleLcuEvent(event));
  }

  ngOnDestroy(): void {
    this.connectorSubscription.unsubscribe();
    this.eventsSubscription.unsubscribe();
    if (this.lobbyRefreshTimer !== null) clearTimeout(this.lobbyRefreshTimer);
    this.removalTimers.forEach(timer => clearTimeout(timer));
  }

  public async refreshAll(): Promise<void> {
    if (this.refreshLoading) return;
    this.refreshLoading = true;
    this.friendsError = '';
    this.actionMessage = '';
    this.actionError = '';

    try {
      await this.ensureHelpCapabilities();

      const [
        friendsResult,
        groupsResult,
        partyActiveResult
      ] = await Promise.all([
        this.fetchValue('/lol-chat/v1/friends'),
        this.fetchValue('/lol-chat/v1/friend-groups'),
        this.fetchValue('/lol-lobby/v2/party-active')
      ]);
      const {lobbyResult, lobbyMembersResult} = await this.fetchLobbyDetailsWhenActive(partyActiveResult);

      this.friendGroups = this.mapGroups(groupsResult.value);
      this.updateLobbyState(lobbyResult.value, lobbyMembersResult.value, partyActiveResult.value);
      this.updateLobbyLinkMessage();

      if (!friendsResult.ok) {
        this.friends = [];
        this.friendsError = friendsResult.message || 'Could not load friends.';
      } else {
        this.friends = this.mapFriends(Array.isArray(friendsResult.value) ? friendsResult.value : []);
      }
      this.applyFilters();
    } catch (error) {
      this.friendsError = this.errorMessage(error);
    } finally {
      this.refreshLoading = false;
    }
  }

  public applyFilters(): void {
    const search = (this.searchKeyword || '').trim().toLowerCase();
    const filtered = this.friends.filter(friend =>
      this.matchesSearch(friend, search)
      && this.matchesPresence(friend, this.presenceFilter)
      && this.matchesActiveRefines(friend));
    this.filteredFriends = filtered;
    this.visibleFriends = filtered.slice(0, this.visibleLimit);
    this.updateFilterCounts();
  }

  public setPresence(presence: PresenceFilter): void {
    this.presenceFilter = presence;
    this.resetVisibleLimit();
  }

  public toggleRefine(toggle: RefineToggle): void {
    this.activeRefines = {...this.activeRefines, [toggle]: !this.activeRefines[toggle]};
    this.resetVisibleLimit();
  }

  public isRefineActive(toggle: RefineToggle): boolean {
    return !!this.activeRefines[toggle];
  }

  public resetVisibleLimit(): void {
    this.visibleLimit = 48;
    this.applyFilters();
  }

  public loadMoreFriends(): void {
    this.visibleLimit += 48;
    this.applyFilters();
  }

  public presenceCount(presence: PresenceFilter): number {
    return this.presenceCounts[presence] || 0;
  }

  public refineCount(toggle: RefineToggle): number {
    return this.refineCounts[toggle] || 0;
  }

  public async invite(friend: FriendCardView): Promise<void> {
    const inviteReason = this.inviteDisabledReason(friend, this.isFriendInCurrentLobby(friend));
    if (inviteReason || this.isFriendBusy(friend)) {
      if (inviteReason) this.actionError = this.disabledInviteMessage(friend, inviteReason);
      return;
    }
    this.setFriendAction(friend, 'invite');
    this.actionMessage = '';
    this.actionError = '';

    try {
      const response = await this.lcuConnectionService.requestCustomAPI(
        [{toSummonerId: this.numericOrString(friend.summonerId)}] as unknown as Record<string, unknown>,
        'POST',
        '/lol-lobby/v2/lobby/invitations'
      );
      if (this.responseContainsError(response)) {
        this.actionError = this.inviteErrorMessage(friend, response);
      } else {
        this.actionMessage = 'Invite sent to ' + friend.displayName + '.';
        await this.refreshLobbyOnly();
      }
    } catch (error) {
      this.actionError = this.inviteErrorMessage(friend, error);
    } finally {
      this.setFriendAction(friend, '');
    }
  }

  public async unfriend(friend: FriendCardView): Promise<void> {
    if (friend.unfriendReason || this.isFriendBusy(friend)) return;
    const confirmed = await this.confirmDialog(
      'Remove Friend',
      'Remove ' + friend.displayName + ' from your League friends list?',
      'Remove'
    );
    if (!confirmed) return;

    this.setUnfriendState(friend, 'unfriending');
    this.actionMessage = '';
    this.actionError = '';

    try {
      const path = '/lol-chat/v1/friends/' + encodeURIComponent(friend.friendId);
      const response = await this.lcuConnectionService.requestCustomAPI({}, 'DELETE', path);
      if (this.responseContainsError(response)) {
        this.setUnfriendState(friend, 'error');
        this.actionError = 'Unfriend failed. Could not remove friend.';
      } else {
        this.setUnfriendState(friend, 'removed');
        this.actionMessage = friend.displayName + ' was removed from your friends list.';
        const timer = setTimeout(() => {
          this.removeFriendLocally(friend);
          void this.refreshAfterUnfriend(friend);
        }, this.removeAnimationMs);
        this.removalTimers.push(timer);
      }
    } catch (error) {
      this.setUnfriendState(friend, 'error');
      this.actionError = 'Unfriend failed. Could not remove friend.';
      return;
    }
  }

  public unfriendButtonText(friend: FriendCardView): string {
    if (friend.actionState === 'unfriending') return 'Removing...';
    if (friend.actionState === 'removed') return 'Removed';
    return 'Unfriend';
  }

  public isFriendBusy(friend: FriendCardView): boolean {
    return !!this.friendActionBusy[friend.key] || friend.actionState === 'unfriending' || friend.actionState === 'removed';
  }

  public isUnfriendDisabled(friend: FriendCardView): boolean {
    return !!friend.unfriendReason || this.isFriendBusy(friend);
  }

  public async generateLobbyLink(): Promise<void> {
    if (this.lobbyLink.generating) return;
    if (!this.lobbyState.active) {
      this.patchLobbyLink({message: 'Create a lobby first.'});
      return;
    }

    this.patchLobbyLink({
      generating: true,
      message: 'Generating and copying lobby link...',
      copiedAt: ''
    });

    try {
      await this.ensureHelpCapabilities();
      if (!this.helpCapabilities.lobbyLinkGenerate) {
        this.patchLobbyLink({
          message: 'Lobby link generation is unavailable.',
          generating: false
        });
        return;
      }

      const activityIds = this.lobbyLink.activityId ? [this.lobbyLink.activityId] : await this.resolveActivityIds();
      const result = await this.fetchFirstJoinCode(activityIds);
      if (!result) {
        this.patchLobbyLink({
          message: 'Could not generate lobby link.',
          activityId: activityIds[0] || '',
          generating: false
        });
        return;
      }

      await this.copyText(result.value);
      this.patchLobbyLink({
        message: 'Lobby link copied.',
        copiedAt: new Date().toLocaleTimeString(),
        activityId: result.activityId,
        generating: false
      });
    } catch (error) {
      this.patchLobbyLink({
        message: 'Could not copy lobby link.',
        generating: false
      });
    } finally {
      if (this.lobbyLink.generating) this.patchLobbyLink({generating: false});
    }
  }

  public trackFriend(_index: number, friend: FriendCardView): string {
    return friend.key;
  }

  private async ensureHelpCapabilities(): Promise<void> {
    if (this.helpCapabilities.loaded) return;
    await this.confirmHelpCapabilities();
  }

  private async confirmHelpCapabilities(): Promise<void> {
    const response = await this.lcuConnectionService.requestCustomAPI({}, 'GET', '/help');
    const raw = this.rawString(response);
    this.helpCapabilities = {
      loaded: raw.length > 0 && !/connection is not ready|failed/i.test(raw),
      leagueInvite: raw.indexOf('PostLolLobbyV2LobbyInvitations') >= 0,
      unfriend: raw.indexOf('DeleteLolChatV1FriendsById') >= 0,
      lobbyLinkGenerate: raw.indexOf(this.lobbyJoinCodePostFunction) >= 0
    };
  }

  private async fetchValue(path: string): Promise<RequestResult> {
    const response = await this.lcuConnectionService.requestCustomAPI({}, 'GET', path);
    const parsed = this.parseResponse(response);
    const raw = this.rawString(response);
    const ok = !this.responseContainsError(response) && !/^404\b|LOBBY_NOT_FOUND|RESOURCE_NOT_FOUND|not found|Invalid URI format/i.test(raw);

    return {
      ok,
      value: ok ? parsed === null ? raw : parsed : null,
      message: ok ? '' : this.summarizeResponse(response)
    };
  }

  private mapGroups(value: any): FriendGroupView[] {
    if (!Array.isArray(value)) return [];
    return value.map(group => ({
      id: this.valueToString(group && group.id),
      name: this.groupDisplayName(group && group.name)
    }));
  }

  private groupDisplayName(name: any): string {
    const value = this.valueToString(name);
    if (!value || value === '**Default') return 'General';
    if (value === '**Offline') return 'Offline';
    if (value === '**Discord') return 'Discord';
    if (value === '**Other') return 'Other';
    if (value === '**Mobile') return 'Mobile';
    return value;
  }

  private updateLobbyState(lobby: any, lobbyMembers: any, partyActive: any): void {
    const members = Array.isArray(lobbyMembers)
      ? lobbyMembers
      : lobby && Array.isArray(lobby.members)
        ? lobby.members
        : [];
    const memberKeys = new Set<string>();
    members.forEach(member => {
      this.memberKeys(member).forEach(key => memberKeys.add(key));
    });
    this.lobbyState = {
      active: partyActive === true || !!(lobby && typeof lobby === 'object' && !Array.isArray(lobby) && lobby.gameConfig),
      members,
      memberKeys,
      lobbyFound: !!(lobby && typeof lobby === 'object' && !Array.isArray(lobby) && !lobby.errorCode)
    };
  }

  private updateLobbyLinkMessage(): void {
    if (!this.lobbyState.active) {
      this.patchLobbyLink({message: 'Create a lobby first.'});
      return;
    }

    if (this.lobbyLink.message === 'Create a lobby first.') {
      this.patchLobbyLink({message: 'Generate a lobby link to copy it.'});
    }
  }

  private async refreshLobbyOnly(): Promise<void> {
    const partyActiveResult = await this.fetchValue('/lol-lobby/v2/party-active');
    const {lobbyResult, lobbyMembersResult} = await this.fetchLobbyDetailsWhenActive(partyActiveResult);
    this.updateLobbyState(lobbyResult.value, lobbyMembersResult.value, partyActiveResult.value);
    this.updateLobbyLinkMessage();
    this.friends = this.friends.map(friend => this.withInviteState({
      ...friend,
      inCurrentLobby: this.isFriendInCurrentLobby(friend)
    }));
    this.applyFilters();
  }

  private handleLcuEvent(event: LcuJsonApiEvent): void {
    const uri = String(event && event.uri || '');
    if (uri.indexOf('/lol-lobby/') === 0 || uri === '/lol-gameflow/v1/gameflow-phase') {
      this.scheduleLobbyRefresh();
    }
  }

  private scheduleLobbyRefresh(): void {
    if (!this.connector.isReady()) return;
    if (this.lobbyRefreshTimer !== null) clearTimeout(this.lobbyRefreshTimer);
    this.lobbyRefreshTimer = setTimeout(() => {
      this.lobbyRefreshTimer = null;
      void this.runScheduledLobbyRefresh();
    }, 350);
  }

  private async runScheduledLobbyRefresh(): Promise<void> {
    if (!this.connector.isReady()) return;
    if (this.refreshLoading || this.lobbyRefreshActive) {
      this.scheduleLobbyRefresh();
      return;
    }
    this.lobbyRefreshActive = true;
    try {
      await this.refreshLobbyOnly();
    } finally {
      this.lobbyRefreshActive = false;
    }
  }

  private async fetchLobbyDetailsWhenActive(partyActiveResult: RequestResult): Promise<{lobbyResult: RequestResult; lobbyMembersResult: RequestResult}> {
    const emptyResult = {ok: false, value: null, message: ''};
    if (partyActiveResult.value !== true) {
      return {lobbyResult: emptyResult, lobbyMembersResult: emptyResult};
    }

    const [lobbyResult, lobbyMembersResult] = await Promise.all([
      this.fetchValue('/lol-lobby/v2/lobby'),
      this.fetchValue('/lol-lobby/v2/lobby/members')
    ]);
    return {lobbyResult, lobbyMembersResult};
  }

  private mapFriends(friends: any[]): FriendCardView[] {
    const groupMap = new Map(this.friendGroups.map(group => [group.id, group.name]));
    return friends.map(friend => this.withInviteState(this.toFriendCard(friend, groupMap)))
      .sort((left, right) => this.friendSortValue(left) - this.friendSortValue(right) || left.displayName.localeCompare(right.displayName));
  }

  private toFriendCard(friend: any, groupMap: Map<string, string>): FriendCardView {
    const gameName = this.valueToString(friend && (friend.gameName || friend.name || friend.summonerName || friend.displayName));
    const tagLine = this.valueToString(friend && (friend.gameTag || friend.tagLine));
    const fallbackName = this.valueToString(friend && (friend.name || friend.displayName || friend.gameName || friend.pid));
    const displayName = this.formatDisplayName(gameName || fallbackName, tagLine);
    const availability = this.valueToString(friend && friend.availability).toLowerCase() || 'offline';
    const lol = friend && friend.lol && typeof friend.lol === 'object' ? friend.lol : {};
    const gameStatus = this.valueToString(lol.gameStatus).toLowerCase();
    const discordInfo = friend && friend.discordInfo && typeof friend.discordInfo === 'object' ? friend.discordInfo : null;
    const discordStatus = this.valueToString(
      friend && (friend.discordOnlineStatus || (discordInfo && discordInfo.onlineStatus))
    ).toLowerCase();
    const isMobile = this.isMobileFriend(friend, availability);
    const isDiscordLinked = Boolean(discordInfo || friend && (friend.discordOnlineStatus || friend.discordId));
    const isDiscordOnly = this.valueToString(friend && friend.relationshipOnRiot).toLowerCase() === 'none';
    const profileIconId = Number(friend && (friend.icon || friend.profileIconId || friend.summonerIcon));
    const friendId = this.valueToString(friend && friend.id);
    const puuid = this.valueToString(friend && friend.puuid);
    const summonerId = this.valueToString(friend && friend.summonerId);
    const groupId = this.valueToString(friend && (friend.displayGroupId || friend.groupId));

    return {
      key: friendId || puuid || summonerId || displayName,
      friendId,
      puuid,
      summonerId,
      displayName,
      gameName,
      tagLine,
      profileIconUrl: this.profileIconUrl(profileIconId),
      availability,
      availabilityLabel: this.availabilityLabel(availability, isMobile),
      statusKind: this.statusKind(availability, gameStatus, isMobile),
      isMobile,
      statusText: this.statusText(availability, gameStatus, friend && friend.statusMessage, isMobile),
      groupName: groupMap.get(groupId) || (isDiscordOnly ? 'Discord' : 'General'),
      isLeagueFriend: !isDiscordOnly,
      isDiscordLinked,
      isDiscordOnly,
      discordStatus,
      isInviteEligible: false,
      inCurrentLobby: false,
      inviteReason: '',
      unfriendReason: '',
      actionBusy: '',
      actionState: this.friendActionStates[friendId || puuid || summonerId || displayName] || 'idle'
    };
  }

  private withInviteState(friend: FriendCardView): FriendCardView {
    const inCurrentLobby = this.isFriendInCurrentLobby(friend);
    const inviteReason = this.inviteDisabledReason(friend, inCurrentLobby);
    const unfriendReason = this.unfriendDisabledReason(friend);
    return {
      ...friend,
      inCurrentLobby,
      inviteReason,
      unfriendReason,
      isInviteEligible: !inviteReason,
      actionBusy: this.friendActionBusy[friend.key] || '',
      actionState: this.friendActionStates[friend.key] || friend.actionState || 'idle'
    };
  }

  private inviteDisabledReason(friend: FriendCardView, inCurrentLobby: boolean): string {
    if (friend.isMobile) return 'On mobile';
    if (!this.helpCapabilities.leagueInvite) return 'Not invite eligible';
    if (!this.lobbyState.active) return 'Create a lobby first';
    if (inCurrentLobby) return 'Already in lobby';
    if (!friend.summonerId) return 'Not invite eligible';
    if (friend.isDiscordOnly) return 'Not invite eligible';
    if (friend.statusKind === 'offline') return 'Offline';
    if (friend.availability === 'dnd' || friend.statusKind === 'busy') return 'Not invite eligible';
    return '';
  }

  private inviteErrorMessage(friend: FriendCardView, response: any): string {
    if (friend.isMobile) return 'This friend is on mobile and cannot be invited to a League lobby.';
    if (!this.lobbyState.active) return 'Create a lobby first.';
    if (this.isInvalidInvitationResponse(response)) return 'League rejected the invite.';
    return 'Invite failed.';
  }

  private disabledInviteMessage(friend: FriendCardView, reason: string): string {
    if (friend.isMobile || reason === 'On mobile') return 'This friend is on mobile and cannot be invited to a League lobby.';
    if (reason === 'Create a lobby first') return 'Create a lobby first.';
    if (reason === 'Offline') return 'Invite failed.';
    return reason || 'Invite failed.';
  }

  private isInvalidInvitationResponse(response: any): boolean {
    const parsed = this.parseResponse(response);
    const raw = this.rawString(response);
    if (/invalid[\s_-]*invitation|invitation[\s_-]*invalid|INVALID_INVITATION|INVITATION_INVALID/i.test(raw)) return true;
    if (parsed && typeof parsed === 'object') {
      const code = this.valueToString(parsed.errorCode || parsed.error || parsed.message);
      return /invalid[\s_-]*invitation|invitation[\s_-]*invalid|INVALID_INVITATION|INVITATION_INVALID/i.test(code);
    }
    return false;
  }

  private unfriendDisabledReason(friend: FriendCardView): string {
    if (!this.helpCapabilities.unfriend) return 'Unavailable';
    if (!friend.friendId) return 'Unavailable';
    if (friend.isDiscordOnly) return 'Unavailable';
    return '';
  }

  private isFriendInCurrentLobby(friend: FriendCardView): boolean {
    const keys = [friend.puuid, friend.summonerId, friend.friendId].filter(Boolean);
    return keys.some(key => this.lobbyState.memberKeys.has(String(key)));
  }

  private memberKeys(member: any): string[] {
    if (!member || typeof member !== 'object') return [];
    return [
      member.puuid,
      member.summonerId,
      member.id,
      member.memberId,
      member.playerId
    ].map(value => this.valueToString(value)).filter(Boolean);
  }

  private friendSortValue(friend: FriendCardView): number {
    if (friend.inCurrentLobby) return 0;
    if (friend.statusKind === 'online') return 1;
    if (friend.statusKind === 'busy') return 2;
    if (friend.isMobile) return 3;
    return 4;
  }

  private matchesSearch(friend: FriendCardView, search: string): boolean {
    if (!search) return true;
    return [
      friend.displayName,
      friend.gameName,
      friend.tagLine,
      friend.groupName,
      friend.statusText,
      friend.availabilityLabel,
      friend.isDiscordLinked ? 'Discord' : ''
    ].join(' ').toLowerCase().indexOf(search) >= 0;
  }

  private matchesPresence(friend: FriendCardView, presence: PresenceFilter): boolean {
    if (presence === 'all') return true;
    if (presence === 'online') return friend.statusKind === 'online' || friend.statusKind === 'mobile';
    if (presence === 'offline') return friend.statusKind === 'offline';
    if (presence === 'busy') return friend.statusKind === 'busy' || friend.availability === 'dnd';
    if (presence === 'mobile') return friend.isMobile;
    return true;
  }

  private matchesRefine(friend: FriendCardView, toggle: RefineToggle): boolean {
    if (toggle === 'discord') return friend.isDiscordLinked;
    if (toggle === 'league') return friend.isLeagueFriend && !friend.isDiscordLinked;
    if (toggle === 'eligible') return friend.isInviteEligible;
    if (toggle === 'lobby') return friend.inCurrentLobby;
    return true;
  }

  private matchesActiveRefines(friend: FriendCardView): boolean {
    return this.refineOptions.every(option => !this.activeRefines[option.id] || this.matchesRefine(friend, option.id));
  }

  private updateFilterCounts(): void {
    const search = (this.searchKeyword || '').trim().toLowerCase();
    const presenceCounts: Record<PresenceFilter, number> = {all: 0, online: 0, offline: 0, busy: 0, mobile: 0};
    const refineCounts: Record<RefineToggle, number> = {discord: 0, league: 0, eligible: 0, lobby: 0};

    for (const friend of this.friends) {
      if (!this.matchesSearch(friend, search)) continue;

      if (this.matchesActiveRefines(friend)) {
        presenceCounts.all++;
        if (this.matchesPresence(friend, 'online')) presenceCounts.online++;
        if (this.matchesPresence(friend, 'offline')) presenceCounts.offline++;
        if (this.matchesPresence(friend, 'busy')) presenceCounts.busy++;
        if (this.matchesPresence(friend, 'mobile')) presenceCounts.mobile++;
      }

      if (this.matchesPresence(friend, this.presenceFilter)) {
        for (const option of this.refineOptions) {
          if (this.matchesRefineFacet(friend, option.id)) refineCounts[option.id]++;
        }
      }
    }

    this.presenceCounts = presenceCounts;
    this.refineCounts = refineCounts;
  }

  private matchesRefineFacet(friend: FriendCardView, toggle: RefineToggle): boolean {
    return this.matchesRefine(friend, toggle)
      && this.refineOptions.every(option => option.id === toggle || !this.activeRefines[option.id] || this.matchesRefine(friend, option.id));
  }

  private setFriendAction(friend: FriendCardView, action: FriendAction): void {
    if (action) {
      this.friendActionBusy = {...this.friendActionBusy, [friend.key]: action};
    } else {
      const next = {...this.friendActionBusy};
      delete next[friend.key];
      this.friendActionBusy = next;
    }
    this.friends = this.friends.map(item => item.key === friend.key ? this.withInviteState(item) : item);
    this.applyFilters();
  }

  private setUnfriendState(friend: FriendCardView, state: FriendActionState): void {
    if (state === 'idle') {
      const next = {...this.friendActionStates};
      delete next[friend.key];
      this.friendActionStates = next;
    } else {
      this.friendActionStates = {...this.friendActionStates, [friend.key]: state};
    }
    this.friends = this.friends.map(item => item.key === friend.key ? this.withInviteState(item) : item);
    this.applyFilters();
  }

  private removeFriendLocally(friend: FriendCardView): void {
    this.friends = this.friends.filter(item => !this.isSameFriend(item, friend));
    const nextStates = {...this.friendActionStates};
    const nextBusy = {...this.friendActionBusy};
    delete nextStates[friend.key];
    delete nextBusy[friend.key];
    this.friendActionStates = nextStates;
    this.friendActionBusy = nextBusy;
    this.applyFilters();
  }

  private async refreshAfterUnfriend(removedFriend: FriendCardView): Promise<void> {
    try {
      await this.confirmHelpCapabilities();
      const [
        friendsResult,
        groupsResult,
        partyActiveResult
      ] = await Promise.all([
        this.fetchValue('/lol-chat/v1/friends'),
        this.fetchValue('/lol-chat/v1/friend-groups'),
        this.fetchValue('/lol-lobby/v2/party-active')
      ]);
      const {lobbyResult, lobbyMembersResult} = await this.fetchLobbyDetailsWhenActive(partyActiveResult);

      this.friendGroups = this.mapGroups(groupsResult.value);
      this.updateLobbyState(lobbyResult.value, lobbyMembersResult.value, partyActiveResult.value);
      this.updateLobbyLinkMessage();

      if (!friendsResult.ok) {
        this.actionError = 'Friend removed, but the friends list could not refresh yet.';
        return;
      }

      const serverFriends = this.mapFriends(Array.isArray(friendsResult.value) ? friendsResult.value : []);
      const stillReturned = serverFriends.some(friend => this.isSameFriend(friend, removedFriend));
      if (stillReturned) {
        this.friendActionStates = {...this.friendActionStates, [removedFriend.key]: 'error'};
        this.friends = serverFriends.map(friend => this.isSameFriend(friend, removedFriend) ? this.withInviteState(friend) : friend);
        this.actionError = 'League still returned that friend. The client may not have updated yet.';
      } else {
        const nextStates = {...this.friendActionStates};
        delete nextStates[removedFriend.key];
        this.friendActionStates = nextStates;
        this.friends = serverFriends;
      }
      this.applyFilters();
    } catch (error) {
      this.actionError = 'Friend removed, but the friends list could not refresh yet.';
    }
  }

  private isSameFriend(left: FriendCardView, right: FriendCardView): boolean {
    if (left.key && right.key && left.key === right.key) return true;
    if (left.friendId && right.friendId && left.friendId === right.friendId) return true;
    if (left.puuid && right.puuid && left.puuid === right.puuid) return true;
    if (left.summonerId && right.summonerId && left.summonerId === right.summonerId) return true;
    return false;
  }

  private async confirmDialog(title: string, body: string, confirmLabel: string): Promise<boolean> {
    const ref = this.dialog.open(DialogComponent, {
      data: {
        title,
        body,
        confirmLabel,
        cancelLabel: 'Cancel'
      }
    });
    return (await firstValueFrom(ref.afterClosed())) === true;
  }

  private statusKind(availability: string, gameStatus: string, isMobile: boolean): FriendCardView['statusKind'] {
    if (isMobile) return 'mobile';
    if (availability === 'offline') return 'offline';
    if (availability === 'dnd' || gameStatus === 'ingame' || gameStatus === 'championselect' || gameStatus === 'spectating') return 'busy';
    return 'online';
  }

  private statusText(availability: string, gameStatus: string, message: any, isMobile: boolean): string {
    if (isMobile) return 'Mobile';
    if (gameStatus === 'ingame') return 'In game';
    if (gameStatus === 'championselect') return 'Champion select';
    if (gameStatus === 'spectating') return 'Spectating';
    const statusMessage = this.valueToString(message);
    if (statusMessage) return statusMessage;
    return this.availabilityLabel(availability, isMobile);
  }

  private availabilityLabel(availability: string, isMobile = false): string {
    if (isMobile) return 'Mobile';
    const value = (availability || '').toLowerCase();
    if (value === 'chat' || value === 'online') return 'Online';
    if (value === 'away') return 'Away';
    if (value === 'dnd') return 'Do Not Disturb';
    if (value === 'mobile') return 'Mobile';
    if (value === 'offline') return 'Offline';
    if (value === 'spectating') return 'Spectating';
    return value ? this.titleCase(value) : 'Unknown';
  }

  private isMobileFriend(friend: any, availability: string): boolean {
    if (String(availability || '').toLowerCase() === 'mobile') return true;
    if (!friend || typeof friend !== 'object') return false;

    const lol = friend.lol && typeof friend.lol === 'object' ? friend.lol : {};
    const discordInfo = friend.discordInfo && typeof friend.discordInfo === 'object' ? friend.discordInfo : {};
    const values = [
      friend.availability,
      friend.status,
      friend.statusMessage,
      friend.summary,
      friend.presenceSummary,
      friend.product,
      friend.productId,
      friend.productName,
      friend.platform,
      friend.platformId,
      friend.platformType,
      friend.client,
      friend.clientId,
      friend.clientType,
      friend.device,
      friend.deviceType,
      friend.source,
      friend.connectionType,
      lol.availability,
      lol.status,
      lol.statusMessage,
      lol.summary,
      lol.gameStatus,
      lol.product,
      lol.productId,
      lol.productName,
      lol.platform,
      lol.platformId,
      lol.platformType,
      lol.client,
      lol.clientId,
      lol.clientType,
      lol.device,
      lol.deviceType,
      lol.source,
      discordInfo.availability,
      discordInfo.status,
      discordInfo.summary,
      discordInfo.platform,
      discordInfo.client
    ];

    return values.some(value => this.isMobileSignal(value));
  }

  private isMobileSignal(value: any): boolean {
    const text = this.valueToString(value).trim().toLowerCase();
    if (!text) return false;
    return /riot[\s_-]*mobile|\bmobile\b|riotmobile/.test(text);
  }

  private formatDisplayName(name: string, tagLine: string): string {
    const base = name || 'Unknown Friend';
    return tagLine ? base + ' #' + tagLine : base;
  }

  public onFriendIconError(event: Event): void {
    const image = event.target as HTMLImageElement;
    const fallback = this.profileIconUrl(1);
    if (image.src !== fallback) image.src = fallback;
  }

  private profileIconUrl(iconId: number): string {
    const id = !isNaN(iconId) && iconId > 0 ? iconId : 1;
    return 'https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default/v1/profile-icons/' + id + '.jpg';
  }

  private titleCase(value: string): string {
    return value.charAt(0).toUpperCase() + value.slice(1).replace(/[-_]/g, ' ');
  }

  private async resolveActivityIds(): Promise<string[]> {
    const response = await this.lcuConnectionService.requestCustomAPI({}, 'GET', '/lol-lobby/v2/ags/agsActivityId');
    const parsed = this.parseResponse(response);
    const ids = new Set<string>();
    this.addActivityId(ids, parsed);
    this.fallbackActivityIds.forEach(id => ids.add(id));
    return Array.from(ids);
  }

  private addActivityId(ids: Set<string>, value: any): void {
    if (!value) return;
    if (typeof value === 'string') {
      ids.add(value);
      return;
    }
    if (typeof value === 'object') {
      ['activityId', 'agsActivityId', 'id'].forEach(key => {
        const candidate = value[key];
        if (typeof candidate === 'string' && candidate.trim()) ids.add(candidate.trim());
      });
    }
  }

  private async fetchFirstJoinCode(activityIds: string[]): Promise<{value: string; activityId: string} | null> {
    for (const activityId of activityIds) {
      const path = '/lol-lobby/v2/ags/' + encodeURIComponent(activityId) + '/joinCode';
      const response = await this.lcuConnectionService.requestCustomAPI({}, 'POST', path);
      const value = this.extractJoinCode(response);
      if (value) return {value, activityId};
    }
    return null;
  }

  private extractJoinCode(response: any): string {
    const parsed = this.parseResponse(response);
    if (typeof parsed === 'string') return this.cleanJoinCode(parsed);
    if (parsed && typeof parsed === 'object') {
      if (parsed.isActive === false) return '';
      for (const key of ['smartUrl', 'joinCode', 'join_code', 'code', 'url', 'link', 'inviteLink']) {
        const value = parsed[key];
        if (typeof value === 'string') return this.cleanJoinCode(value);
      }
      if (parsed.httpStatus || parsed.errorCode) return '';
    }
    if (typeof response === 'string' && response.trim() && response.trim()[0] !== '{') return this.cleanJoinCode(response);
    return '';
  }

  private cleanJoinCode(value: string): string {
    return String(value || '').trim().replace(/^"|"$/g, '');
  }

  private async copyText(value: string): Promise<void> {
    try {
      await this.electronService.writeClipboard(value);
      return;
    } catch (error) {
    }

    const textArea = document.createElement('textarea');
    textArea.value = value;
    textArea.style.position = 'fixed';
    textArea.style.opacity = '0';
    document.body.appendChild(textArea);
    textArea.select();
    const copied = document.execCommand('copy');
    document.body.removeChild(textArea);
    if (!copied) throw new Error('Clipboard write failed.');
  }

  private patchLobbyLink(patch: Partial<typeof this.lobbyLink>): void {
    this.lobbyLink = {
      ...this.lobbyLink,
      ...patch
    };
  }

  private parseResponse(response: any): any {
    if (typeof response !== 'string') return response;
    try {
      return JSON.parse(response);
    } catch (error) {
      const objectStart = response.indexOf('{');
      if (objectStart >= 0) {
        try {
          return JSON.parse(response.slice(objectStart));
        } catch (jsonError) {
          return null;
        }
      }
      return null;
    }
  }

  private rawString(response: any): string {
    if (response === undefined || response === null) return '';
    if (typeof response === 'string') return response;
    try {
      return JSON.stringify(response);
    } catch (error) {
      return String(response);
    }
  }

  private responseContainsError(response: any): boolean {
    if (response === undefined || response === null) return false;
    const parsed = this.parseResponse(response);
    if (parsed && typeof parsed === 'object') {
      const httpStatus = Number(parsed.httpStatus);
      if (!isNaN(httpStatus) && httpStatus >= 400) return true;
      if (parsed.errorCode || parsed.error) return true;
    }
    const raw = this.rawString(response);
    return /failed|error|unauthorized|forbidden|invalid/i.test(raw);
  }

  private summarizeResponse(response: any): string {
    if (!response) return '';
    const parsed = this.parseResponse(response);
    if (parsed && typeof parsed === 'object') {
      const message = parsed.message || parsed.errorCode || parsed.error;
      if (message) return this.redactText(String(message));
    }
    const raw = this.rawString(response);
    return this.redactText(raw.length > 180 ? raw.slice(0, 180) + '...' : raw);
  }

  private numericOrString(value: string): number | string {
    const parsed = Number(value);
    return !isNaN(parsed) ? parsed : value;
  }

  private valueToString(value: any): string {
    if (value === undefined || value === null) return '';
    return String(value);
  }

  private redactText(value: string): string {
    return String(value || '')
      .replace(/[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/g, '[REDACTED]')
      .replace(/(access_token|refresh_token|id_token|joinCode|join_code|authorization|cookie|puuid|summonerId|discordId)([=:]\s*)([^\s&"]+)/gi, '$1$2[REDACTED]');
  }

  private errorMessage(error: any): string {
    if (!error) return 'Unknown error';
    if (typeof error === 'string') return this.redactText(error);
    return this.redactText(error.message || String(error));
  }
}
