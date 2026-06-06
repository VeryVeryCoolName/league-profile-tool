import {Component, ChangeDetectionStrategy} from '@angular/core';
import {MatDialog} from "@angular/material/dialog";
import {DialogComponent} from "../core/dialog/dialog.component";
import {LCUConnectionService} from "../core/services/lcuconnection/lcuconnection.service";
import {PresenceAutomationService} from '../core/services/presence-automation/presence-automation.service';

@Component({
    selector: 'app-status',
    templateUrl: './status.component.html',
    styleUrls: ['./status.component.css'],
    changeDetection: ChangeDetectionStrategy.Eager,
    standalone: false
})
export class StatusComponent {
  public text = '';
  public availability = 'chat';
  public statuses = [
    {label: 'Online', value: 'chat'},
    {label: 'Away', value: 'away'},
    {label: 'Mobile', value: 'mobile'},
    {label: 'Offline', value: 'offline'}
  ];

  constructor(public dialog: MatDialog, private lcuConnectionService: LCUConnectionService, private presenceAutomationService: PresenceAutomationService) {
  }

  public setStatus(): void {
    const body = {
      availability: this.availability,
      statusMessage: this.text
    };
    this.presenceAutomationService.suspendAutoReapply();
    this.lcuConnectionService.requestSend(body, 'PUT', 'lolChat').then(response => {
      if (response === 'Success') this.presenceAutomationService.recordStatusPreset(this.availability, this.text);
      this.dialog.open(DialogComponent, {
        data: {body: response}
      });
    });
  }
}
