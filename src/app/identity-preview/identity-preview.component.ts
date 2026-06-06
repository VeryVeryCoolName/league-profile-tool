import {Component, OnDestroy, ChangeDetectionStrategy} from '@angular/core';
import {Subscription} from 'rxjs';
import {IdentityPreviewService, IdentityPreviewState} from '../core/services/identity-preview/identity-preview.service';
import {ConnectorService} from '../core/services/connector/connector.service';

@Component({
    selector: 'app-identity-preview',
    templateUrl: './identity-preview.component.html',
    styleUrls: ['./identity-preview.component.css'],
    changeDetection: ChangeDetectionStrategy.Eager,
    standalone: false
})
export class IdentityPreviewComponent implements OnDestroy {
  public state: IdentityPreviewState;
  public iconFailed = false;
  private subscription: Subscription;
  private connectionSubscription: Subscription;
  private loadedForCurrentConnection = false;

  constructor(private identityPreviewService: IdentityPreviewService, private connector: ConnectorService) {
    this.subscription = this.identityPreviewService.state$.subscribe(state => {
      if (!this.state || this.state.profileIconUrl !== state.profileIconUrl) this.iconFailed = false;
      this.state = state;
    });

    this.connectionSubscription = this.connector.ready$.subscribe(ready => {
      if (!ready) {
        this.loadedForCurrentConnection = false;
        return;
      }

      if (this.loadedForCurrentConnection) return;
      this.loadedForCurrentConnection = true;
      this.identityPreviewService.refreshPreview();
    });

    if (this.connector.isReady()) {
      this.loadedForCurrentConnection = true;
      this.identityPreviewService.refreshPreview();
    }
  }

  ngOnDestroy(): void {
    if (this.subscription) this.subscription.unsubscribe();
    if (this.connectionSubscription) this.connectionSubscription.unsubscribe();
  }

  public refreshPreview(): void {
    this.identityPreviewService.refreshPreview();
  }

  public get summonerTitle(): string {
    if (!this.state) return 'Summoner';
    return this.state.tagLine ? `${this.state.summonerName} #${this.state.tagLine}` : this.state.summonerName;
  }

  public get chatRankText(): string {
    if (!this.state || !this.state.chatRankTier) return 'Not loaded';
    const division = this.state.chatRankDivision ? ` ${this.state.chatRankDivision}` : '';
    return `${this.state.chatRankTier}${division}`;
  }

  public get challengeText(): string {
    if (!this.state || !this.state.challengeCrystalLevel) return 'Not loaded';
    return this.state.challengeCrystalLevel;
  }

  public get profileIconName(): string {
    if (!this.state || this.state.profileIconId === undefined || this.state.profileIconId === null) return 'Not loaded';
    return this.state.profileIconName || 'Icon';
  }

  public get backgroundStyle(): string {
    if (!this.state || !this.state.backgroundImageUrl) return '';
    return `url("${this.state.backgroundImageUrl}")`;
  }
}
