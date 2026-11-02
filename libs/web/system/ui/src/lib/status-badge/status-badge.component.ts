import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  output,
} from '@angular/core';
import type { SystemStatus } from '@helmstead/system-model';

type Tone = 'warn' | 'info' | 'danger';

/**
 * Whether the core answers, as a Helm StatusPill: a word and a coloured dot, never colour alone. Presentational: the
 * caller passes the status and handles `retry`.
 */
@Component({
  selector: 'hs-status-badge',
  templateUrl: './status-badge.component.html',
  styleUrl: './status-badge.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class StatusBadgeComponent {
  readonly status = input.required<SystemStatus>();
  readonly retry = output();

  protected readonly view = computed(
    (): {
      tone: Tone;
      label: string;
      title: string | null;
    } => {
      const status = this.status();
      switch (status.state) {
        case 'connecting':
          return { tone: 'warn', label: 'Connecting…', title: null };
        case 'connected':
          return {
            tone: 'info',
            // Build metadata (+commit) is for the tooltip; the pill stays short.
            label: `Connected · v${status.version.split('+')[0] ?? status.version}`,
            title: `Core version ${status.version}`,
          };
        case 'unreachable':
          return { tone: 'danger', label: 'Core unreachable', title: null };
      }
    },
  );
}
