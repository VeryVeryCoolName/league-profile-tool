import { NO_ERRORS_SCHEMA } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { CustomiconComponent } from './customicon.component';

describe('CustomiconComponent', () => {
  let component: CustomiconComponent;
  let fixture: ComponentFixture<CustomiconComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      declarations: [CustomiconComponent],
      schemas: [NO_ERRORS_SCHEMA]
    })
    .compileComponents();
  });

  beforeEach(() => {
    fixture = TestBed.createComponent(CustomiconComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
