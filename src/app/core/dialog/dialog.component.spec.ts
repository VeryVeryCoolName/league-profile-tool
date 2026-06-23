import { NO_ERRORS_SCHEMA } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA } from '@angular/material/dialog';

import { DialogComponent } from './dialog.component';

describe('DialogComponent', () => {
  let component: DialogComponent;
  let fixture: ComponentFixture<DialogComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      declarations: [DialogComponent],
      providers: [{
        provide: MAT_DIALOG_DATA,
        useValue: {body: 'Test'}
      }],
      schemas: [NO_ERRORS_SCHEMA]
    })
    .compileComponents();
  });

  beforeEach(() => {
    fixture = TestBed.createComponent(DialogComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('treats plain success responses as success dialogs', () => {
    component.data = {body: 'Success'};

    expect(component.dialogKind).toBe('success');
    expect(component.displayTitle).toBe('Success');
    expect(component.displayBody).toBe('Request made successfully.');
  });

  it('treats titled success responses as success dialogs', () => {
    component.data = {title: 'Success', body: 'Icon updated.'};

    expect(component.dialogKind).toBe('success');
    expect(component.displayTitle).toBe('Success');
    expect(component.displayBody).toBe('Icon updated.');
  });

  it('uses a done button for status dialogs', () => {
    component.data = {body: 'Success'};

    expect(component.primaryLabel).toBe('Done');
  });

  it('treats titled errors as error dialogs', () => {
    component.data = {title: 'Error', body: 'Icon update failed.'};

    expect(component.dialogKind).toBe('error');
  });

  it('keeps confirmation dialogs separate from status dialogs', () => {
    component.data = {title: 'Remove Friend', body: 'Remove this friend?', confirmLabel: 'Remove'};

    expect(component.dialogKind).toBe('confirm');
    expect(component.isDestructiveConfirmation).toBeTrue();
  });
});
