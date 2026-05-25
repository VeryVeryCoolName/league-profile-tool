import {Component} from '@angular/core';
import {DialogComponent} from "../core/dialog/dialog.component";
import {MatDialog} from "@angular/material/dialog";
import {LCUConnectionService} from "../core/services/lcuconnection/lcuconnection.service";

@Component({
  selector: 'app-practicetool',
  templateUrl: './practicetool.component.html',
  styleUrls: ['./practicetool.component.css']
})
export class PracticetoolComponent {
  public lobbyName = "";

  constructor(public dialog: MatDialog, private lcuConnectionService: LCUConnectionService) {
  }

  public makeLobby() {
    const lobbyName = this.cleanLobbyName(this.lobbyName);
    const body = {
      "customGameLobby": {
        "configuration": {
          "gameMode": "PRACTICETOOL",
          "gameMutator": "",
          "gameServerRegion": "",
          "mapId": 11,
          "mutators": {
            "id": 1
          },
          "spectatorPolicy": "AllAllowed",
          "teamSize": 5
        },
        "lobbyName": lobbyName,
        "lobbyPassword": null
      },
      "isCustom": true
    };
    this.lcuConnectionService.requestSend(body, 'POST', 'lobby').then(response => {
      this.dialog.open(DialogComponent, {
        data: {body: response}
      });
    });
  }

  private cleanLobbyName(name: string): string {
    const cleanName = (name || '').trim().replace(/[^a-zA-Z0-9 _-]/g, '').substring(0, 24);
    return cleanName || `LPT ${Date.now().toString().slice(-6)}`;
  }
}
