import {
  NgZone,
  provideZonelessChangeDetection,
  signal,
  ɵNoopNgZone as NoopNgZone,
} from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { SystemStatusService } from '@helmstead/system-data-access';
import { App } from './app';
import { appConfig } from './app.config';

describe('App', () => {
  it('provides zoneless change detection in the app config', () => {
    // provideZonelessChangeDetection() returns environment providers; it is in the config when its providers are.
    const flatten = (providers: readonly unknown[]): unknown[] =>
      providers.flatMap((p): unknown[] => {
        if (Array.isArray(p)) return flatten(p);
        if (p && typeof p === 'object' && 'ɵproviders' in p) {
          const inner: unknown = p.ɵproviders;
          return Array.isArray(inner) ? flatten(inner) : [inner];
        }
        return [p];
      });
    const zoneless = flatten([provideZonelessChangeDetection()]);
    const configured = flatten(appConfig.providers);

    expect(zoneless.length).toBeGreaterThan(0);
    for (const provider of zoneless) {
      expect(configured).toContainEqual(provider);
    }
    TestBed.configureTestingModule({ providers: appConfig.providers });
    expect(TestBed.inject(NgZone)).toBeInstanceOf(NoopNgZone);
  });

  it('renders the core status badge', async () => {
    // No live call to the core: the service is a stand-in (its HTTP is tested in system-data-access).
    TestBed.configureTestingModule({
      providers: [
        ...appConfig.providers,
        {
          provide: SystemStatusService,
          useValue: {
            status: signal({ state: 'connecting' }),
            retry: () => undefined,
          },
        },
      ],
    });
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();

    const badge = hostOf(fixture).querySelector('hs-system-status .pill');
    expect(badge?.textContent?.trim()).toBe('Connecting…');
  });
});

/** The rendered element. `nativeElement` is typed `any`, so check it instead of asserting. */
function hostOf(fixture: ComponentFixture<unknown>): HTMLElement {
  const element: unknown = fixture.nativeElement;
  if (!(element instanceof HTMLElement))
    throw new Error('Not rendered in a DOM');
  return element;
}
