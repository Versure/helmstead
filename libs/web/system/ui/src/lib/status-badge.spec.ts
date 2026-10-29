import { ComponentFixture, TestBed } from '@angular/core/testing';
import type { SystemStatus } from '@helmstead/system-model';
import { StatusBadgeComponent } from './status-badge';

describe('StatusBadgeComponent', () => {
  const render = async (status: SystemStatus) => {
    const fixture = TestBed.createComponent(StatusBadgeComponent);
    fixture.componentRef.setInput('status', status);
    await fixture.whenStable();
    const element = hostOf(fixture);
    return { fixture, element, pill: element.querySelector('.pill') };
  };

  it('shows Connecting… as a pending pill while the core has not answered', async () => {
    const { element, pill } = await render({ state: 'connecting' });

    expect(pill?.textContent?.trim()).toBe('Connecting…');
    expect(pill?.classList).toContain('pill--warn');
    expect(element.querySelector('button')).toBeNull();
  });

  it('shows Connected with the version, without build metadata, and the full version as a tooltip', async () => {
    const { element, pill } = await render({
      state: 'connected',
      version: '1.0.0+67c771ad2f5b8dccc8cfee78acf1900ef1587505',
    });

    expect(pill?.textContent?.trim()).toBe('Connected · v1.0.0');
    expect(pill?.getAttribute('title')).toBe(
      'Core version 1.0.0+67c771ad2f5b8dccc8cfee78acf1900ef1587505',
    );
    expect(pill?.classList).toContain('pill--info');
    expect(element.querySelector('button')).toBeNull();
  });

  it('shows Core unreachable with a Retry button that emits retry', async () => {
    const { fixture, element, pill } = await render({ state: 'unreachable' });
    let retried = 0;
    fixture.componentInstance.retry.subscribe(() => retried++);

    expect(pill?.textContent?.trim()).toBe('Core unreachable');
    expect(pill?.classList).toContain('pill--danger');
    const button = element.querySelector('button');
    expect(button?.textContent?.trim()).toBe('Retry');
    expect(button?.getAttribute('type')).toBe('button');

    button?.click();
    expect(retried).toBe(1);
  });

  it('announces changes politely to screen readers', async () => {
    const { element } = await render({ state: 'connecting' });

    const region = element.querySelector('[role="status"]');
    expect(region).not.toBeNull();
    expect(region?.textContent).toContain('Connecting…');
  });
});

/** The rendered element. `nativeElement` is typed `any`, so check it instead of asserting. */
function hostOf(fixture: ComponentFixture<unknown>): HTMLElement {
  const element: unknown = fixture.nativeElement;
  if (!(element instanceof HTMLElement))
    throw new Error('Not rendered in a DOM');
  return element;
}
