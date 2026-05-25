import {Component} from '@angular/core';
import {MatDialog} from "@angular/material/dialog";
import {DialogComponent} from "../core/dialog/dialog.component";
import {LCUConnectionService} from "../core/services/lcuconnection/lcuconnection.service";

@Component({
  selector: 'app-chatrank',
  templateUrl: './chatrank.component.html',
  styleUrls: ['./chatrank.component.css']
})
export class ChatrankComponent {
  public ranks = ["IRON", "BRONZE", "SILVER", "GOLD", "PLATINUM", "EMERALD", "DIAMOND", "MASTER", "GRANDMASTER", "CHALLENGER"];
  public divisions = ["I", "II", "III", "IV"];
  public queues = ["RANKED_TFT", "RANKED_SOLO_5x5"];
  public queue: string;
  public division: string;
  public rank: string;

  constructor(public dialog: MatDialog, private lcuConnectionService: LCUConnectionService) {
  }

  public chatRank() {
    if (!this.queue || !this.rank || !this.division) {
      this.dialog.open(DialogComponent, {
        data: {body: 'Select a queue, rank, and division before updating chat rank.'}
      });
      return;
    }
    const body = {
      lol: {
        rankedLeagueQueue: this.queue,
        rankedLeagueTier: this.rank,
        rankedLeagueDivision: this.division,
      },
    };
    this.lcuConnectionService.requestSend(body, 'PUT', 'lolChat').then(response => {
      this.dialog.open(DialogComponent, {
        data: {body: response}
      });
    });
  }
}
