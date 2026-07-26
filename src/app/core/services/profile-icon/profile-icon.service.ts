import {Injectable} from '@angular/core';
import {Observable, Subject} from 'rxjs';
import {LCUConnectionService} from '../lcuconnection/lcuconnection.service';
import {IdentityPreviewService} from '../identity-preview/identity-preview.service';

export type IconUpdateStatus = 'updated' | 'accepted' | 'failed';
export type IconOwnershipState = 'owned' | 'not-owned' | 'unknown';

export interface IconUpdateResult {
  success: boolean;
  status: IconUpdateStatus;
  response?: any;
}

export interface IconApplyOutcome {
  iconId: number;
  account: IconUpdateResult;
  chat: IconUpdateResult;
  applied: boolean;
}

@Injectable({
  providedIn: 'root'
})
export class ProfileIconService {
  private readonly appliedSubject = new Subject<IconApplyOutcome>();
  private ownedIconIdsPromise: Promise<Set<number> | null> | null = null;
  private ownedIconIdsValue: Set<number> | null = null;
  private ownedInventoryLoaded = false;

  public readonly applied$: Observable<IconApplyOutcome> = this.appliedSubject.asObservable();

  constructor(
    private lcuConnectionService: LCUConnectionService,
    private identityPreviewService: IdentityPreviewService
  ) { }

  public get inventoryLoaded(): boolean {
    return this.ownedInventoryLoaded;
  }

  public get ownedIconIdsSnapshot(): Set<number> | null {
    return this.ownedIconIdsValue;
  }

  public loadOwnedIconIds(): Promise<Set<number> | null> {
    if (this.ownedIconIdsPromise === null) {
      this.ownedIconIdsPromise = this.fetchOwnedIconInventory().then(ownedIconIds => {
        if (ownedIconIds === null) {
          this.ownedIconIdsPromise = null;
          return null;
        }
        this.ownedIconIdsValue = ownedIconIds;
        this.ownedInventoryLoaded = true;
        return ownedIconIds;
      }).catch(error => {
        console.error('[LCU] failed to load owned icon inventory', error);
        this.ownedIconIdsPromise = null;
        return null;
      });
    }
    return this.ownedIconIdsPromise;
  }

  public ownershipStateFor(iconId: number): IconOwnershipState {
    if (isNaN(iconId) || !this.ownedInventoryLoaded || !this.ownedIconIdsValue) return 'unknown';
    return this.ownedIconIdsValue.has(iconId) ? 'owned' : 'not-owned';
  }

  public async applyIcon(iconId: number): Promise<IconApplyOutcome> {
    const account = await this.setAccountProfileIcon(iconId);
    const chat = await this.setSocialProfileIcon(iconId);
    const outcome: IconApplyOutcome = {iconId, account, chat, applied: chat.success};

    if (chat.success) {
      this.identityPreviewService.applyProfileIcon(iconId);
      if (chat.status === 'updated') await this.identityPreviewService.refreshPreview();
    }

    this.appliedSubject.next(outcome);
    return outcome;
  }

  public applyMessage(outcome: IconApplyOutcome, selectedOwnership: IconOwnershipState): {title: string; body: string} {
    const {account, chat} = outcome;
    if (account.success && chat.success && account.status === 'updated' && chat.status === 'updated') {
      return {title: 'Success', body: 'Icon updated.'};
    }
    if (chat.success) {
      if (chat.status === 'accepted') {
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
      if (account.status === 'accepted') {
        return {
          title: 'Success',
          body: 'Social/profile icon updated. Account icon request was accepted, but League has not refreshed it yet.'
        };
      }
      return {
        title: 'Success',
        body: `Social/profile icon updated. Account icon was not changed by Riot. ${this.summarizeResponse(account.response)}`
      };
    }
    if (account.success) {
      return {
        title: 'Error',
        body: `Account icon updated, but the social/profile card icon did not update. ${this.summarizeResponse(chat.response)}`
      };
    }
    return {
      title: 'Error',
      body: `Icon update failed. ${this.summarizeResponse(chat.response || account.response)}`
    };
  }

  public async readCurrentIconIds(): Promise<{accountIconId: number | null; chatIconId: number | null}> {
    const [summonerResponse, chatResponse] = await Promise.all([
      this.lcuConnectionService.requestCustomAPI({}, 'GET', '/lol-summoner/v1/current-summoner'),
      this.lcuConnectionService.requestCustomAPI({}, 'GET', '/lol-chat/v1/me')
    ]);
    const summoner = this.parseResponse(summonerResponse);
    const chat = this.parseResponse(chatResponse);
    return {
      accountIconId: this.numberOrNull(summoner && summoner.profileIconId),
      chatIconId: this.numberOrNull(chat && chat.icon)
    };
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

  private async fetchOwnedIconInventory(): Promise<Set<number> | null> {
    const response = await this.lcuConnectionService.requestCustomAPI(
      {},
      'GET',
      '/lol-inventory/v2/inventory/SUMMONER_ICON'
    );
    const inventory = this.parseResponse(response);
    return Array.isArray(inventory) ? this.extractOwnedIconIds(inventory) : null;
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

  private async verifyProfileIconId(path: string, field: string, iconId: number): Promise<boolean> {
    for (let attempt = 0; attempt < 6; attempt++) {
      if (attempt > 0) await this.delay(350);
      const response = await this.lcuConnectionService.requestCustomAPI({}, 'GET', path);
      const current = this.parseResponse(response);
      if (this.numberOrNull(current && current[field]) === iconId) return true;
    }
    return false;
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

  private numberOrNull(value: unknown): number | null {
    if (value === undefined || value === null || value === '') return null;
    const parsed = Number(value);
    return isNaN(parsed) ? null : parsed;
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
}
