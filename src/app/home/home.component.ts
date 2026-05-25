import {Component, OnInit} from '@angular/core';
import {ElectronService} from "../core/services";

@Component({
  selector: 'app-home',
  templateUrl: './home.component.html',
  styleUrls: ['./home.component.css']
})
export class HomeComponent implements OnInit {
  public title = 'LEAGUE PROFILE TOOL';
  public currentVersion = 'V.3.0.0';
  public newestVersion = '';

  constructor(private electronService: ElectronService) {
  }

  ngOnInit() {
    this.newestVersion = this.currentVersion;
    setTimeout(() => this.checkNewestVersion(), 0);
  }

  private async checkNewestVersion() {
    try {
      const url = 'https://raw.githubusercontent.com/VeryVeryCoolName/league-profile-tool/master/version.json';
      const obj = await (await fetch(url)).json();
      this.newestVersion = obj.version;
    } catch (error){
      this.newestVersion = this.currentVersion;
    }
  }

  public github() {
    const url = 'https://github.com/VeryVeryCoolName/league-profile-tool';
    if (this.electronService.shell) {
      this.electronService.shell.openExternal(url);
      return;
    }
    window.open(url, '_blank');
  }
}
