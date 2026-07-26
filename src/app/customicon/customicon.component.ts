import {Component, OnDestroy, OnInit, ChangeDetectionStrategy} from '@angular/core';
import {DialogComponent} from "../core/dialog/dialog.component";
import {MatDialog} from "@angular/material/dialog";
import {ChampionService} from "../core/services/champion/champion.service";
import {VersionService} from "../core/services/version/version.service";
import {IdentityPreviewService} from "../core/services/identity-preview/identity-preview.service";
import {IconAutomationService} from "../core/services/icon-automation/icon-automation.service";
import {IconOwnershipState, ProfileIconService} from "../core/services/profile-icon/profile-icon.service";
import {ConnectorService} from "../core/services/connector/connector.service";
import {Subscription} from "rxjs";
import {COMMUNITY_DRAGON_LIVE_BRANCH} from "../core/community-dragon";
import {cnIconAssetUrl, profileIconImageUrl} from "../core/cn-icons";

interface CustomIconRecord extends Record<string, unknown> {
  id?: unknown;
  title?: unknown;
  branch?: unknown;
  cnExclusive?: boolean;
  src?: string;
  broken?: boolean;
  owned?: boolean;
  ownershipLabel?: string;
  ownershipState?: IconOwnershipState;
}

@Component({
    selector: 'app-customicon',
    templateUrl: './customicon.component.html',
    styleUrls: ['./customicon.component.css'],
    changeDetection: ChangeDetectionStrategy.Eager,
    standalone: false
})
export class CustomiconComponent implements OnInit, OnDestroy {
  public searchKeyword = '';
  public allIcons: CustomIconRecord[] = [];
  public filteredIcons: CustomIconRecord[] = [];
  public visibleIcons: CustomIconRecord[] = [];
  public visibleIconLimit = 80;
  public iconsLoading = true;
  public iconsError = '';
  public ownedOnly = false;
  public inventoryLoading = false;
  public inventoryUnavailable = false;
  public selectionNote = '';
  public updatingIconId: number | null = null;
  public selectedIconId: number | null = null;
  public autoReapplyIcon = false;
  public autoReapplyIconId: number | null = null;
  private dataDragonVersion = '';
  private connectorSubscription: Subscription | null = null;
  private versionSubscription: Subscription | null = null;
  private iconSubscription: Subscription | null = null;
  private previewSubscription: Subscription;
  private automationSubscription: Subscription;

  constructor(
    public dialog: MatDialog,
    private championData: ChampionService,
    private version: VersionService,
    private identityPreviewService: IdentityPreviewService,
    private profileIconService: ProfileIconService,
    private iconAutomationService: IconAutomationService,
    private connector: ConnectorService
  ) {
    this.previewSubscription = this.identityPreviewService.state$.subscribe(state => {
      this.selectedIconId = state.profileIconId;
    });
    this.automationSubscription = this.iconAutomationService.state$.subscribe(state => {
      this.autoReapplyIcon = state.autoReapply;
      this.autoReapplyIconId = state.desiredIconId;
    });
  }

  ngOnInit(): void {
    this.versionSubscription = this.version.apiVersion().subscribe(versions => {
      this.dataDragonVersion = versions && versions.length ? versions[0] : '';
      this.loadIcons();
    }, () => {
      this.loadIcons();
    });
  }

  ngOnDestroy(): void {
    if (this.connectorSubscription) this.connectorSubscription.unsubscribe();
    if (this.versionSubscription) this.versionSubscription.unsubscribe();
    if (this.iconSubscription) this.iconSubscription.unsubscribe();
    if (this.previewSubscription) this.previewSubscription.unsubscribe();
    if (this.automationSubscription) this.automationSubscription.unsubscribe();
  }

  private loadIcons(): void {
    if (this.iconSubscription) return;
    this.iconSubscription = this.championData.getAllSummonerIcons().subscribe(icons => {
      this.allIcons = (icons as CustomIconRecord[])
        .filter(icon => icon && icon.id !== undefined && icon.id !== null)
        .sort((left, right) => Number(left.id) - Number(right.id))
        .map(icon => {
          return this.withOwnershipMetadata({
            ...icon,
            src: profileIconImageUrl(
              Number(icon.id),
              typeof icon.branch === 'string' && icon.branch ? icon.branch : COMMUNITY_DRAGON_LIVE_BRANCH,
              this.dataDragonVersion
            ),
            broken: false
          });
        });
      this.iconsLoading = false;
      this.refreshIconView();
      this.queueOwnedIconInventoryLoad();
    }, error => {
      console.error('[Assets] failed to load summoner icons', error);
      this.iconsLoading = false;
      this.iconsError = 'Could not load summoner icons.';
    });
  }

  private refreshIconView(): void {
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
      icons = icons.filter(icon => icon.owned === true);
    }
    this.filteredIcons = icons;
    this.visibleIcons = icons.slice(0, this.visibleIconLimit);
  }

  public resetIconLimit(): void {
    this.visibleIconLimit = 80;
    this.refreshIconView();
  }

  public toggleOwnedOnly(): void {
    if (!this.canFilterOwnedIcons) return;
    this.ownedOnly = !this.ownedOnly;
    this.resetIconLimit();
  }

  public toggleAutoReapplyIcon(event: Event): void {
    const target = event.target as HTMLInputElement;
    this.iconAutomationService.setAutoReapply(!!target.checked);
  }

  public get canFilterOwnedIcons(): boolean {
    const ownedIconIds = this.profileIconService.ownedIconIdsSnapshot;
    return this.profileIconService.inventoryLoaded && !!ownedIconIds && ownedIconIds.size > 0;
  }

  public loadMoreIcons(): void {
    this.visibleIconLimit += 80;
    this.refreshIconView();
  }

  public onIconError(icon: CustomIconRecord): void {
    const fallback = cnIconAssetUrl(Number(icon.id));
    if (icon.cnExclusive && icon.src !== fallback) {
      icon.src = fallback;
      return;
    }
    icon.broken = true;
  }

  public isSelectedIcon(icon: CustomIconRecord): boolean {
    if (this.selectedIconId === null) return false;
    return Number(icon && icon.id) === this.selectedIconId;
  }

  public iconTooltip(icon: CustomIconRecord): string {
    const name = String(icon.title || icon.id || '');
    const base = `${name} - ${icon.ownershipLabel || 'Unknown'}`;
    return icon.cnExclusive ? `${base} - CN exclusive` : base;
  }

  public async setIcon(id: unknown): Promise<void> {
    const iconId = Number(id);
    if (isNaN(iconId)) {
      this.dialog.open(DialogComponent, {
        data: {body: 'Select a valid icon ID.'}
      });
      return;
    }
    if (this.updatingIconId !== null) return;

    const selectedOwnership = this.profileIconService.ownershipStateFor(iconId);
    this.selectedIconId = iconId;
    this.updatingIconId = iconId;
    this.selectionNote = 'Applying icon...';

    try {
      const outcome = await this.profileIconService.applyIcon(iconId);

      this.selectionNote = selectedOwnership === 'not-owned'
        ? 'Unowned icons may only affect the social/profile-card icon.'
        : '';

      const message = this.profileIconService.applyMessage(outcome, selectedOwnership);
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

  private ownershipLabelForState(state: IconOwnershipState): string {
    if (state === 'owned') return 'Owned';
    if (state === 'not-owned') return 'Not owned';
    return 'Unknown';
  }

  private queueOwnedIconInventoryLoad(): void {
    if (this.profileIconService.inventoryLoaded) {
      this.syncInventoryUiState();
      return;
    }

    if (!this.connector.isReady()) {
      if (!this.connectorSubscription) {
        this.connectorSubscription = this.connector.ready$.subscribe(ready => {
          if (!ready) return;
          void this.loadOwnedIconInventory();
          this.connectorSubscription.unsubscribe();
          this.connectorSubscription = null;
        });
      }
      return;
    }

    void this.loadOwnedIconInventory();
  }

  private async loadOwnedIconInventory(): Promise<void> {
    this.inventoryLoading = true;
    await this.profileIconService.loadOwnedIconIds();
    this.syncInventoryUiState();
  }

  private syncInventoryUiState(): void {
    this.inventoryLoading = false;
    const ownedIconIds = this.profileIconService.ownedIconIdsSnapshot;
    this.inventoryUnavailable = !ownedIconIds || ownedIconIds.size === 0;
    if (!this.canFilterOwnedIcons) this.ownedOnly = false;
    this.applyOwnershipMetadata();
  }

  private applyOwnershipMetadata(): void {
    this.allIcons = this.allIcons.map(icon => this.withOwnershipMetadata(icon));
    this.refreshIconView();
  }

  private withOwnershipMetadata(icon: CustomIconRecord): CustomIconRecord {
    const ownershipState = this.profileIconService.ownershipStateFor(Number(icon.id));
    return {
      ...icon,
      owned: ownershipState === 'owned',
      ownershipState,
      ownershipLabel: this.ownershipLabelForState(ownershipState)
    };
  }

  public trackByIcon(_index: number, icon: CustomIconRecord): unknown {
    return icon.id;
  }

}
