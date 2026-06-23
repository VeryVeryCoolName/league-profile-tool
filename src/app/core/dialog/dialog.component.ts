import {AfterViewInit, ChangeDetectionStrategy, Component, ElementRef, Inject, OnInit} from '@angular/core';
import { MAT_DIALOG_DATA } from '@angular/material/dialog';

export interface DialogData {
  body: string;
  title?: string;
  confirmLabel?: string;
  cancelLabel?: string;
}

@Component({
    selector: 'app-dialog',
    templateUrl: './dialog.component.html',
    styleUrls: ['./dialog.component.css'],
    changeDetection: ChangeDetectionStrategy.Eager,
    standalone: false
})
export class DialogComponent implements OnInit, AfterViewInit {
  constructor(@Inject(MAT_DIALOG_DATA) public data: DialogData, private elementRef: ElementRef<HTMLElement>) { }
  ngOnInit(): void {
  }

  ngAfterViewInit(): void {
    window.setTimeout(() => {
      this.elementRef.nativeElement.querySelector<HTMLElement>('.dialog-shell')?.focus({preventScroll: true});
    }, 0);
  }

  public get isConfirmation(): boolean {
    return !!this.data.confirmLabel;
  }

  public get dialogKind(): 'success' | 'error' | 'confirm' | 'info' {
    if (this.isConfirmation) return 'confirm';
    if (!this.data.title && this.data.body === 'Success') return 'success';
    if (!this.data.title) return 'error';
    return 'info';
  }

  public get displayTitle(): string {
    if (this.data.title) return this.data.title;
    if (this.dialogKind === 'success') return 'Success';
    if (this.dialogKind === 'error') return 'Error';
    return '';
  }

  public get displayBody(): string {
    if (this.data.title) return this.data.body;
    if (this.dialogKind === 'success') return 'Request made successfully.';
    return this.data.body;
  }
}
