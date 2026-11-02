import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { SystemStatusService } from '@helmstead/system-data-access';
import { StatusBadgeComponent } from '@helmstead/system-ui';

/** The core's status badge, wired to the service: fetched once on load and again on Retry. */
@Component({
  selector: 'hs-system-status',
  imports: [StatusBadgeComponent],
  template: `<hs-status-badge
    [status]="system.status()"
    (retry)="system.retry()"
  />`,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SystemStatusComponent {
  protected readonly system = inject(SystemStatusService);
}
