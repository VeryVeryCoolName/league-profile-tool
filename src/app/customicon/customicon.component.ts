import {Component, OnDestroy, OnInit} from '@angular/core';
import {DialogComponent} from "../core/dialog/dialog.component";
import {MatDialog} from "@angular/material/dialog";
import {LCUConnectionService} from "../core/services/lcuconnection/lcuconnection.service";
import {ChampionService} from "../core/services/champion/champion.service";
import {IdentityPreviewService} from "../core/services/identity-preview/identity-preview.service";
import {ConnectorService} from "../core/services/connector/connector.service";
import {Subscription} from "rxjs";

type IconUpdateStatus = 'updated' | 'accepted' | 'failed';
type IconOwnershipState = 'owned' | 'not-owned' | 'unknown';

interface IconUpdateResult {
  success: boolean;
  status: IconUpdateStatus;
  response?: any;
}

@Component({
  selector: 'app-customicon',
  templateUrl: './customicon.component.html',
  styleUrls: ['./customicon.component.css']
})
export class CustomiconComponent implements OnInit, OnDestroy {
  private static ownedIconIdsCache: Set<number> | null = null;
  private static inventoryLoaded = false;
  private static inventoryPromise: Promise<Set<number> | null> | null = null;

  public searchKeyword = '';
  public allIcons: Array<Record<string, unknown>> = [];
  public visibleIconLimit = 200;
  public iconsLoading = true;
  public iconsError = '';
  public ownedOnly = false;
  public inventoryLoading = false;
  public inventoryUnavailable = false;
  public selectionNote = '';
  public updatingIconId: number | null = null;
  private connectorSubscription: Subscription;

  constructor(
    public dialog: MatDialog,
    private lcuConnectionService: LCUConnectionService,
    private championData: ChampionService,
    private identityPreviewService: IdentityPreviewService,
    private connector: ConnectorService
  ) {
  }

  async ngOnInit() {
    this.championData.getSummonerIcons().subscribe(icons => {
      this.allIcons = (icons as Array<Record<string, unknown>>)
        .filter(icon => icon && icon.id !== undefined && icon.id !== null)
        .sort((left, right) => Number(left.id) - Number(right.id))
        .map(icon => {
          return {
            ...icon,
            src: `https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default/v1/profile-icons/${icon.id}.jpg`,
            broken: false
          };
        });
      this.iconsLoading = false;
      this.queueOwnedIconInventoryLoad();
    }, error => {
      console.error('[Assets] failed to load summoner icons', error);
      this.iconsLoading = false;
      this.iconsError = 'Could not load summoner icons.';
    })
  }

  ngOnDestroy() {
    if (this.connectorSubscription) this.connectorSubscription.unsubscribe();
  }

  public get filteredIcons() {
    const search = (this.searchKeyword || '').toLowerCase();
    let icons = this.allIcons;
    if (search) {
      icons = icons.filter(icon => {
        const title = String(icon.title || '').toLowerCase();
        const id = String(icon.id || '');
        return title.indexOf(search) >= 0 || id.indexOf(search) >= 0;
      });
    }
    if (this.ownedOnly && this.canFilterOwnedIcons) {
      icons = icons.filter(icon => this.iconOwnershipState(icon) === 'owned');
    }
    return icons;
  }

  public get visibleIcons() {
    return this.filteredIcons.slice(0, this.visibleIconLimit);
  }

  public resetIconLimit() {
    this.visibleIconLimit = 200;
  }

  public toggleOwnedOnly() {
    if (!this.canFilterOwnedIcons) return;
    this.ownedOnly = !this.ownedOnly;
    this.resetIconLimit();
  }

  public get canFilterOwnedIcons(): boolean {
    return CustomiconComponent.inventoryLoaded
      && !!CustomiconComponent.ownedIconIdsCache
      && CustomiconComponent.ownedIconIdsCache.size > 0;
  }

  public loadMoreIcons() {
    this.visibleIconLimit += 200;
  }

  public onIconError(icon: Record<string, unknown>) {
    icon.broken = true;
  }

  public async setIcon(id: unknown) {
    const iconId = Number(id);
    if (isNaN(iconId)) {
      this.dialog.open(DialogComponent, {
        data: {body: 'Select a valid icon ID.'}
      });
      return;
    }
    if (this.updatingIconId !== null) return;

    const selectedOwnership = this.iconOwnershipStateById(iconId);
    this.updatingIconId = iconId;
    this.selectionNote = 'Applying icon...';

    try {
      const accountResult = await this.setAccountProfileIcon(iconId);
      const chatResult = await this.setSocialProfileIcon(iconId);

      if (chatResult.success) {
        this.identityPreviewService.applyProfileIcon(iconId);
        if (chatResult.status === 'updated') await this.identityPreviewService.refreshPreview();
      }

      this.selectionNote = selectedOwnership === 'not-owned'
        ? 'Unowned icons may only affect the social/profile-card icon.'
        : '';

      const message = this.iconUpdateMessage(accountResult, chatResult, selectedOwnership);
      this.dialog.open(DialogComponent, {
        data: {
          title: message.title,
          body: message.body
        }
      });
    } finally {
      this.updatingIconId = null;
    }
  }

  public iconOwnershipState(icon: Record<string, unknown>): IconOwnershipState {
    const iconId = Number(icon && icon.id);
    return this.iconOwnershipStateById(iconId);
  }

  public isOwnedIcon(icon: Record<string, unknown>): boolean {
    return this.iconOwnershipState(icon) === 'owned';
  }

  public ownershipLabel(icon: Record<string, unknown>): string {
    const state = this.iconOwnershipState(icon);
    if (state === 'owned') return 'Owned';
    if (state === 'not-owned') return 'Not owned';
    return 'Unknown';
  }

  private iconOwnershipStateById(iconId: number): IconOwnershipState {
    if (isNaN(iconId) || !CustomiconComponent.inventoryLoaded || !CustomiconComponent.ownedIconIdsCache) {
      return 'unknown';
    }
    return CustomiconComponent.ownedIconIdsCache.has(iconId) ? 'owned' : 'not-owned';
  }

  private async setAccountProfileIcon(iconId: number): Promise<IconUpdateResult> {
    const response = await this.lcuConnectionService.requestCustomAPI(
      {profileIconId: iconId},
      'PUT',
      '/lol-summoner/v1/current-summoner/icon'
    );
    if (this.responseContainsError(response)) return {success: false, status: 'failed', response};

    const success = await this.verifyProfileIconId('/lol-summoner/v1/current-summoner', 'profileIconId', iconId);
    return {success, status: success ? 'updated' : 'accepted', response};
  }

  private async setSocialProfileIcon(iconId: number): Promise<IconUpdateResult> {
    const response = await this.lcuConnectionService.requestSendNoVerify({icon: iconId}, 'PUT', 'lolChat');
    if (response !== 'Success') {
      return {
        success: false,
        status: 'failed',
        response
      };
    }

    const verified = await this.verifyProfileIconId('/lol-chat/v1/me', 'icon', iconId);
    return {
      success: true,
      status: verified ? 'updated' : 'accepted',
      response
    };
  }

  private queueOwnedIconInventoryLoad(): void {
    if (CustomiconComponent.inventoryLoaded) {
      this.syncInventoryUiState();
      return;
    }

    if (!this.connector.isReady()) {
      if (!this.connectorSubscription) {
        this.connectorSubscription = this.connector.ready$.subscribe(ready => {
          if (ready) this.loadOwnedIconInventoryOnce();
        });
      }
      return;
    }

    this.loadOwnedIconInventoryOnce();
  }

  private async loadOwnedIconInventoryOnce(): Promise<void> {
    this.inventoryLoading = true;

    if (!CustomiconComponent.inventoryPromise) {
      CustomiconComponent.inventoryPromise = this.fetchOwnedIconInventory();
    }

    CustomiconComponent.ownedIconIdsCache = await CustomiconComponent.inventoryPromise;
    CustomiconComponent.inventoryLoaded = true;
    this.syncInventoryUiState();
  }

  private async fetchOwnedIconInventory(): Promise<Set<number> | null> {
    const response = await this.lcuConnectionService.requestCustomAPI(
      {},
      'GET',
      '/lol-inventory/v2/inventory/SUMMONER_ICON'
    );
    const inventory = this.parseResponse(response);
    return Array.isArray(inventory) ? this.extractOwnedIconIds(inventory) : null;
  }

  private syncInventoryUiState(): void {
    this.inventoryLoading = false;
    this.inventoryUnavailable = !CustomiconComponent.ownedIconIdsCache || CustomiconComponent.ownedIconIdsCache.size === 0;
    if (!this.canFilterOwnedIcons) this.ownedOnly = false;
  }

  private extractOwnedIconIds(inventory: Array<Record<string, unknown>>): Set<number> {
    const iconIds = new Set<number>();
    inventory.forEach(item => {
      if (!this.isOwnedInventoryItem(item)) return;
      this.inventoryIconIds(item).forEach(iconId => iconIds.add(iconId));
    });
    return iconIds;
  }

  private isOwnedInventoryItem(item: Record<string, unknown>): boolean {
    if (item.owned === true || item.isOwned === true || item.ownershipType === 'OWNED') return true;
    const ownedQuantity = Number(item.ownedQuantity);
    if (!isNaN(ownedQuantity) && ownedQuantity > 0) return true;
    const ownedCount = Number(item.ownedCount);
    if (!isNaN(ownedCount) && ownedCount > 0) return true;
    const quantity = Number(item.quantity);
    if (!isNaN(quantity) && quantity > 0) return true;
    return false;
  }

  private inventoryIconIds(item: Record<string, unknown>): number[] {
    const candidateKeys = ['itemId', 'itemID', 'id', 'iconId', 'profileIconId', 'summonerIconId'];
    const ids: number[] = [];
    candidateKeys.forEach(key => {
      const parsed = Number(item[key]);
      if (!isNaN(parsed)) ids.push(parsed);
    });
    return ids;
  }

  private iconUpdateMessage(
    accountResult: IconUpdateResult,
    chatResult: IconUpdateResult,
    selectedOwnership: IconOwnershipState
  ): {title: string; body: string} {
    if (accountResult.success && chatResult.success && accountResult.status === 'updated' && chatResult.status === 'updated') {
      return {title: 'Success', body: 'Icon updated.'};
    }
    if (chatResult.success) {
      if (chatResult.status === 'accepted') {
        return {
          title: 'Success',
          body: 'Icon update request accepted. League may take a moment to refresh the profile card.'
        };
      }
      if (selectedOwnership === 'not-owned') {
        return {
          title: 'Success',
          body: 'Social/profile icon updated.'
        };
      }
      if (accountResult.status === 'accepted') {
        return {
          title: 'Success',
          body: 'Social/profile icon updated. Account icon request was accepted, but League has not refreshed it yet.'
        };
      }
      return {
        title: 'Success',
        body: `Social/profile icon updated. Account icon was not changed by Riot. ${this.summarizeResponse(accountResult.response)}`
      };
    }
    if (accountResult.success) {
      return {
        title: 'Error',
        body: `Account icon updated, but the social/profile card icon did not update. ${this.summarizeResponse(chatResult.response)}`
      };
    }
    return {
      title: 'Error',
      body: `Icon update failed. ${this.summarizeResponse(chatResult.response || accountResult.response)}`
    };
  }

  private parseResponse(response: any): any {
    if (typeof response !== 'string') return response || {};
    try {
      return JSON.parse(response);
    } catch (error) {
      return {};
    }
  }

  private responseContainsError(response: any): boolean {
    if (response === undefined || response === null) return true;
    if (response === '') return false;
    if (typeof response === 'string') {
      const parsed = this.parseResponse(response);
      return response.indexOf('failed:') >= 0 || response.indexOf('errorCode') >= 0 || !!parsed.errorCode;
    }
    return !!response.errorCode;
  }

  private async verifyProfileIconId(path: string, field: string, iconId: number): Promise<boolean> {
    for (let attempt = 0; attempt < 6; attempt++) {
      if (attempt > 0) await this.delay(350);
      const response = await this.lcuConnectionService.requestCustomAPI({}, 'GET', path);
      const current = this.parseResponse(response);
      if (this.numberMatches(current && current[field], iconId)) return true;
    }
    return false;
  }

  private numberMatches(actual: unknown, expected: number): boolean {
    const parsed = Number(actual);
    return !isNaN(parsed) && parsed === expected;
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  private summarizeResponse(response: any): string {
    if (!response) return '';
    if (typeof response === 'string') return response.length > 180 ? `${response.slice(0, 180)}...` : response;
    const parsed = response as Record<string, unknown>;
    const message = parsed.message || parsed.errorCode;
    if (message) return String(message);
    try {
      const serialized = JSON.stringify(response);
      return serialized.length > 180 ? `${serialized.slice(0, 180)}...` : serialized;
    } catch (error) {
      return String(response);
    }
  }

  public trackByIcon(index: number, icon: Record<string, unknown>) {
    return icon.id;
  }

}
