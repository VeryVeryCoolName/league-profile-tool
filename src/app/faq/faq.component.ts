import {Component, ChangeDetectionStrategy} from '@angular/core';

@Component({
    selector: 'app-faq',
    templateUrl: './faq.component.html',
    styleUrls: ['./faq.component.css'],
    changeDetection: ChangeDetectionStrategy.Eager,
    standalone: false
})
export class FaqComponent {

  constructor() {
  }

}
