import {Component, ChangeDetectionStrategy, OnDestroy} from '@angular/core';
import {LCUConnectionService} from "../core/services/lcuconnection/lcuconnection.service";
import {PresenceAutomationService} from '../core/services/presence-automation/presence-automation.service';
import {IdentityPreviewService} from '../core/services/identity-preview/identity-preview.service';
import {Subscription} from 'rxjs';

interface StatusOption {
  label: string;
  value: string;
  field: 'availability';
}

@Component({
    selector: 'app-status',
    templateUrl: './status.component.html',
    styleUrls: ['./status.component.css'],
    changeDetection: ChangeDetectionStrategy.Eager,
    standalone: false
})
export class StatusComponent implements OnDestroy {
  public text = '';
  public selectedStatus = 'chat';
  public keepInvisible = false;
  public availabilitySaving = false;
  public messageSaving = false;
  public statusFeedback = '';
  public messageFeedback = '';
  public statuses: StatusOption[] = [
    {label: 'Online', value: 'chat', field: 'availability'},
    {label: 'Away', value: 'away', field: 'availability'},
    {label: 'Mobile', value: 'mobile', field: 'availability'},
    {label: 'Invisible / Offline', value: 'offline', field: 'availability'}
  ];
  private automationSubscription: Subscription;

  constructor(
    private lcuConnectionService: LCUConnectionService,
    private presenceAutomationService: PresenceAutomationService,
    private identityPreviewService: IdentityPreviewService
  ) {
    this.automationSubscription = this.presenceAutomationService.state$.subscribe(state => {
      this.keepInvisible = state.persistentInvisible;
      if (state.persistentInvisible) this.selectedStatus = 'offline';
      if (!this.statuses.some(status => status.value === this.selectedStatus)) this.selectedStatus = 'chat';
    });
  }

  ngOnDestroy(): void {
    this.automationSubscription.unsubscribe();
  }

  public setAvailability(): void {
    if (this.availabilitySaving) return;
    const status = this.selectedStatusOption();
    const body = this.availabilityBody(status);
    const shouldKeepInvisible = this.isInvisibleSelected() && this.keepInvisible;

    this.availabilitySaving = true;
    this.statusFeedback = '';
    this.presenceAutomationService.suspendAutoReapply();
    this.lcuConnectionService.requestSendNoVerify(body, 'PUT', 'lolChat').then(response => {
      if (response === 'Success') {
        this.presenceAutomationService.recordStatusPreset(body);
        if (shouldKeepInvisible) {
          this.presenceAutomationService.setPersistentInvisible(true, body);
        } else {
          this.presenceAutomationService.clearPersistentInvisible();
        }
        this.identityPreviewService.applyAvailability(String(body.availability || ''));
        this.statusFeedback = 'Status updated.';
      } else {
        this.statusFeedback = 'Could not update status.';
      }
      this.availabilitySaving = false;
    }).catch(() => {
      this.statusFeedback = 'Could not update status.';
      this.availabilitySaving = false;
    });
  }

  public onStatusSelectionChanged(): void {
    if (!this.isInvisibleSelected() && this.keepInvisible) {
      this.keepInvisible = false;
      this.presenceAutomationService.clearPersistentInvisible();
    }
    this.setAvailability();
  }

  public toggleKeepInvisible(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.keepInvisible = input.checked;
    if (!this.keepInvisible) {
      this.presenceAutomationService.clearPersistentInvisible();
      return;
    }
    if (!this.isInvisibleSelected()) this.selectedStatus = 'offline';
    this.setAvailability();
  }

  public setMessage(): void {
    if (this.messageSaving) return;
    const body = this.messageBody();
    this.messageSaving = true;
    this.messageFeedback = '';
    this.presenceAutomationService.suspendAutoReapply();
    this.lcuConnectionService.requestSendNoVerify(body, 'PUT', 'lolChat').then(response => {
      if (response === 'Success') {
        this.presenceAutomationService.recordStatusPreset(body);
        if (this.isInvisibleSelected() && this.keepInvisible) {
          this.presenceAutomationService.setPersistentInvisible(true, {...body, availability: 'offline'});
        }
        this.identityPreviewService.applyStatusMessage(this.text);
        this.messageFeedback = 'Message updated.';
      } else {
        this.messageFeedback = 'Could not update message.';
      }
      this.messageSaving = false;
    }).catch(() => {
      this.messageFeedback = 'Could not update message.';
      this.messageSaving = false;
    });
  }

  public isInvisibleSelected(): boolean {
    return this.selectedStatus === 'offline';
  }

  private selectedStatusOption(): StatusOption {
    return this.statuses.find(item => item.value === this.selectedStatus) || this.statuses[0];
  }

  private availabilityBody(status: StatusOption): Record<string, unknown> {
    return {
      [status.field]: status.value
    };
  }

  private messageBody(): Record<string, unknown> {
    return {
      statusMessage: this.text
    };
  }
}
