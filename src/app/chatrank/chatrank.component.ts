import {Component, OnInit} from '@angular/core';
import {MatDialog} from "@angular/material/dialog";
import {DialogComponent} from "../core/dialog/dialog.component";
import {LCUConnectionService} from "../core/services/lcuconnection/lcuconnection.service";
import {IdentityPreviewService} from "../core/services/identity-preview/identity-preview.service";

const CHALLENGE_CRYSTAL_POINT_THRESHOLDS: Record<string, number> = {
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

@Component({
  selector: 'app-chatrank',
  templateUrl: './chatrank.component.html',
  styleUrls: ['./chatrank.component.css']
})
export class ChatrankComponent implements OnInit {
  public ranks = ["IRON", "BRONZE", "SILVER", "GOLD", "PLATINUM", "EMERALD", "DIAMOND", "MASTER", "GRANDMASTER", "CHALLENGER"];
  public challengeLevels = ["NONE", "IRON", "BRONZE", "SILVER", "GOLD", "PLATINUM", "DIAMOND", "MASTER", "GRANDMASTER", "CHALLENGER"];
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
  public challengeRankSource = '';

  constructor(public dialog: MatDialog, private lcuConnectionService: LCUConnectionService, private identityPreviewService: IdentityPreviewService) {
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
      if (response === 'Success') this.identityPreviewService.applyChatRank(this.queue, this.rank, this.division);
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
    this.challengeLevel = normalizedLevel;
    this.challengePoints = Math.floor(points);

    const body = {
      lol: {
        challengeCrystalLevel: normalizedLevel,
        challengePoints: String(this.challengePoints)
      },
    };
    this.lcuConnectionService.requestSendNoVerify(body, 'PUT', 'lolChat').then(response => {
      if (response !== 'Success') {
        this.dialog.open(DialogComponent, {
          data: {body: response}
        });
        return;
      }
      this.identityPreviewService.applyChallengeSpoof(normalizedLevel, this.challengePoints);
    });
  }

  public reloadRealChallengeRank() {
    this.identityPreviewService.clearChallengeSpoof();
    this.loadChallengeSummaryRank();
  }

  public syncChallengePointsToLevel() {
    if (!this.challengeLevel) return;
    this.challengePoints = CHALLENGE_CRYSTAL_POINT_THRESHOLDS[this.challengeLevel] || 0;
  }

  private loadCurrentChallengeRank() {
    this.lcuConnectionService.requestCustomAPI({}, 'GET', '/lol-chat/v1/me')
      .then(response => {
        const chat = this.parseResponse(response);
        const lol = chat && chat.lol as Record<string, unknown>;
        const loaded = this.applyChallengeRankFromChat(lol);
        if (!loaded) this.loadChallengeSummaryRank();
      });
  }

  private loadChallengeSummaryRank() {
    this.lcuConnectionService.requestCustomAPI({}, 'GET', '/lol-challenges/v1/summary-player-data/local-player')
      .then(response => {
        const summary = this.parseResponse(response);
        if (!summary) return;
        if (summary.overallChallengeLevel) this.challengeLevel = String(summary.overallChallengeLevel);
        if (summary.totalChallengeScore !== undefined) this.challengePoints = Number(summary.totalChallengeScore);
        if (summary.overallChallengeLevel || summary.totalChallengeScore !== undefined) {
          this.challengeRankSource = '/lol-challenges/v1/summary-player-data/local-player';
          if (this.challengeLevel && this.challengePoints !== undefined && this.challengePoints !== null) {
            this.identityPreviewService.applyRealChallengeRank(this.challengeLevel, this.challengePoints);
          }
        }
      });
  }

  private applyChallengeRankFromChat(lol: Record<string, unknown>): boolean {
    if (!lol) return false;

    let loaded = false;
    if (lol.challengeCrystalLevel) {
      this.challengeLevel = String(lol.challengeCrystalLevel).toUpperCase();
      loaded = true;
    }
    if (lol.challengePoints !== undefined && lol.challengePoints !== null) {
      this.challengePoints = Number(lol.challengePoints);
      loaded = true;
    }
    if (loaded) {
      this.challengeRankSource = '/lol-chat/v1/me.lol';
      this.identityPreviewService.applyRealChallengeRank(this.challengeLevel, this.challengePoints);
    }
    return loaded;
  }

  private parseResponse(response: any): Record<string, any> {
    if (typeof response !== 'string') return response;
    try {
      return JSON.parse(response);
    } catch (err) {
      return null;
    }
  }
}
