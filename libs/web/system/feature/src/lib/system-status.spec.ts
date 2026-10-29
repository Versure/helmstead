import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { SystemStatusService } from '@helmstead/system-data-access';
import type { SystemStatus } from '@helmstead/system-model';
import { SystemStatusComponent } from './system-status';

// Spec 002 criterion 16. The service, and with it every HTTP detail, is tested in system-data-access against the
// recorded /health fixture; here a fake service drives the three states.
describe('SystemStatusComponent', () => {
  const status = signal<SystemStatus>({ state: 'connecting' });
  const retry = vi.fn(() => status.set({ state: 'connecting' }));

  beforeEach(() => {
    status.set({ state: 'connecting' });
    retry.mockClear();
    TestBed.configureTestingModule({
      providers: [
        { provide: SystemStatusService, useValue: { status, retry } },
      ],
    });
  });

  const render = async () => {
    const fixture = TestBed.createComponent(SystemStatusComponent);
    await fixture.whenStable();
    return { fixture, element: hostOf(fixture) };
  };
  const text = (element: HTMLElement) =>
    element.querySelector('.pill')?.textContent?.trim();

  it('shows Connecting… while the request is pending', async () => {
    const { element } = await render();

    expect(text(element)).toBe('Connecting…');
  });

  it('shows Connected · v{version} when the core answered', async () => {
    const { fixture, element } = await render();

    status.set({ state: 'connected', version: '1.0.0+67c771a' });
    await fixture.whenStable();

    expect(text(element)).toBe('Connected · v1.0.0');
  });

  it('shows Core unreachable with Retry, and Retry asks the service again', async () => {
    const { fixture, element } = await render();
    status.set({ state: 'unreachable' });
    await fixture.whenStable();

    expect(text(element)).toBe('Core unreachable');
    element.querySelector('button')?.click();
    await fixture.whenStable();

    expect(retry).toHaveBeenCalledTimes(1);
    expect(text(element)).toBe('Connecting…');
  });
});

/** The rendered element. `nativeElement` is typed `any`, so check it instead of asserting. */
function hostOf(fixture: ComponentFixture<unknown>): HTMLElement {
  const element: unknown = fixture.nativeElement;
  if (!(element instanceof HTMLElement))
    throw new Error('Not rendered in a DOM');
  return element;
}
