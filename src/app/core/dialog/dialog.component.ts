import {AfterViewInit, ChangeDetectionStrategy, Component, ElementRef, Inject, OnInit} from '@angular/core';
import { MAT_DIALOG_DATA } from '@angular/material/dialog';

type DialogKind = 'success' | 'error' | 'confirm' | 'info';

export interface DialogData {
  body: string;
  title?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: 'success' | 'error' | 'info';
}

@Component({
    selector: 'app-dialog',
    templateUrl: './dialog.component.html',
    styleUrls: ['./dialog.component.css'],
    changeDetection: ChangeDetectionStrategy.Eager,
    standalone: false
})
export class DialogComponent implements OnInit, AfterViewInit {
  private readonly errorPattern = /\b(could not|did not|failed|fail|error|invalid|rejected|unavailable|unauthorized|forbidden|not ready|not found|not changed|overwritten)\b/i;

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

  public get dialogKind(): DialogKind {
    if (this.isConfirmation) return 'confirm';
    if (this.data.tone) return this.data.tone;
    const title = this.normalizedText(this.data.title);
    const body = this.normalizedText(this.data.body);
    if (title === 'success' || body === 'success') return 'success';
    if (title === 'error' || this.errorPattern.test(title) || this.errorPattern.test(body)) return 'error';
    if (!title) return 'error';
    return 'info';
  }

  public get displayTitle(): string {
    if (this.data.title) return this.data.title;
    if (this.dialogKind === 'success') return 'Success';
    if (this.dialogKind === 'error') return 'Needs attention';
    return 'Notice';
  }

  public get displayBody(): string {
    if (this.data.title) return this.data.body;
    if (this.dialogKind === 'success') return 'Request made successfully.';
    return this.data.body;
  }

  public get primaryLabel(): string {
    if (this.isConfirmation) return this.data.confirmLabel || 'Confirm';
    return 'Done';
  }

  public get secondaryLabel(): string {
    return this.data.cancelLabel || 'Cancel';
  }

  public get isDestructiveConfirmation(): boolean {
    return /\b(remove|delete|unfriend|discard|reset)\b/i.test(this.data.confirmLabel || '');
  }

  private normalizedText(value: string | undefined): string {
    return String(value || '').trim().toLowerCase();
  }
}
