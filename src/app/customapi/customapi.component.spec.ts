import { NO_ERRORS_SCHEMA } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { CustomapiComponent } from './customapi.component';

describe('CustomapiComponent', () => {
  let component: CustomapiComponent;
  let fixture: ComponentFixture<CustomapiComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      declarations: [CustomapiComponent],
      schemas: [NO_ERRORS_SCHEMA]
    })
    .compileComponents();
  });

  beforeEach(() => {
    fixture = TestBed.createComponent(CustomapiComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
