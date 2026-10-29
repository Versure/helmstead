import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { SystemStatusComponent } from '@helmstead/system-feature';

@Component({
  imports: [RouterOutlet, SystemStatusComponent],
  selector: 'hs-root',
  templateUrl: './app.html',
  styleUrl: './app.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class App {}
