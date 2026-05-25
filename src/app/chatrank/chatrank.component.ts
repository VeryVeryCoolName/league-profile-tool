import {Component, OnInit} from '@angular/core';
import {MatDialog} from "@angular/material/dialog";
import {DialogComponent} from "../core/dialog/dialog.component";
import {LCUConnectionService} from "../core/services/lcuconnection/lcuconnection.service";

@Component({
  selector: 'app-chatrank',
  templateUrl: './chatrank.component.html',
  styleUrls: ['./chatrank.component.css']
})
export class ChatrankComponent implements OnInit {
  public ranks = ["IRON", "BRONZE", "SILVER", "GOLD", "PLATINUM", "EMERALD", "DIAMOND", "MASTER", "GRANDMASTER", "CHALLENGER"];
  public challengeLevels = ["NONE", "IRON", "BRONZE", "SILVER", "GOLD", "PLATINUM", "DIAMOND", "MASTER", "GRANDMASTER", "CHALLENGER"];
  private challengePointMinimums: Record<string, number> = {
    NONE: 0,
    IRON: 0,
    BRONZE: 750,
    SILVER: 1650,
    GOLD: 4300,
    PLATINUM: 8600,
    DIAMOND: 13800,
    MASTER: 24500,
    GRANDMASTER: 25000,
    CHALLENGER: 26500
  };
  public divisions = ["I", "II", "III", "IV"];
  public queues = [
    {label: "Ranked Solo/Duo", value: "RANKED_SOLO_5x5"},
    {label: "Ranked Flex", value: "RANKED_FLEX_SR"},
    {label: "Ranked TFT", value: "RANKED_TFT"}
  ];
  public queue: string;
  public division: string;
  public rank: string;
  public challengeLevel: string;
  public challengePoints: number;

  constructor(public dialog: MatDialog, private lcuConnectionService: LCUConnectionService) {
  }

  ngOnInit() {
    this.loadCurrentChallengeRank();
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

  public setChallengeRank() {
    const points = Number(this.challengePoints);
    if (!this.challengeLevel || isNaN(points) || points < 0) {
      this.dialog.open(DialogComponent, {
        data: {body: 'Select a challenge level and enter challenge points before updating challenge rank.'}
      });
      return;
    }

    const normalizedLevel = this.challengeLevel.toUpperCase();
    const adjustedPoints = Math.max(Math.floor(points), this.challengePointMinimums[normalizedLevel] || 0);
    this.challengeLevel = normalizedLevel;
    this.challengePoints = adjustedPoints;

    const body = {
      lol: {
        challengeCrystalLevel: normalizedLevel,
        challengePoints: String(adjustedPoints)
      },
    };
    this.lcuConnectionService.requestSend(body, 'PUT', 'lolChat').then(response => {
      this.dialog.open(DialogComponent, {
        data: {body: response}
      });
    });
  }

  public syncChallengePointsToLevel() {
    if (!this.challengeLevel) return;
    const minimum = this.challengePointMinimums[this.challengeLevel] || 0;
    const points = Number(this.challengePoints);
    if (isNaN(points) || points < minimum) {
      this.challengePoints = minimum;
    }
  }

  private loadCurrentChallengeRank() {
    this.lcuConnectionService.requestCustomAPI({}, 'GET', '/lol-challenges/v1/summary-player-data/local-player')
      .then(response => {
        const summary = this.parseResponse(response);
        if (!summary) return;
        if (summary.overallChallengeLevel) this.challengeLevel = String(summary.overallChallengeLevel);
        if (summary.totalChallengeScore !== undefined) this.challengePoints = Number(summary.totalChallengeScore);
      });
  }

  private parseResponse(response: any): Record<string, unknown> {
    if (typeof response !== 'string') return response;
    try {
      return JSON.parse(response);
    } catch (err) {
      return null;
    }
  }
}
