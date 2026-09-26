import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { LucideAngularModule } from 'lucide-angular';
import { LayoutScenario, ZoneThermalResult } from '../../../types/scenario';

@Component({
  selector: 'app-zone-capacity-panel',
  standalone: true,
  imports: [DecimalPipe, MatButtonModule, MatCheckboxModule, LucideAngularModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="zone-capacity">
      @for (zone of zones(); track zone.zone_id) {
        <article class="zone-row" [class.tight]="zone.capacity_state === 'tight'" [class.critical]="zone.capacity_state === 'critical'">
          <header>
            <span class="zone-id"><strong>{{ zone.zone_code }}</strong><small>{{ zone.assigned_heat_kw | number:'1.0-1' }} kW direct + {{ zone.neighbor_heat_kw | number:'1.0-1' }} kW adjacent</small></span>
            <span class="state-badge" [class]="'state-badge ' + zone.capacity_state">{{ stateLabel(zone.capacity_state) }}</span>
          </header>
          <div class="margin-grid">
            <div>
              <small>Normal margin</small>
              <strong [class.negative]="zone.cooling_margin_kw < 0">{{ zone.cooling_margin_kw | number:'1.0-1' }} kW</strong>
              <span class="envelope">{{ zone.effective_heat_kw | number:'1.0-1' }} / {{ zone.capacity_kw | number:'1.0-1' }} kW</span>
            </div>
            <div>
              <small>Post-outage margin</small>
              <strong [class.negative]="zone.outage_cooling_margin_kw < 0" [class.warn]="zoneTight(zone)">{{ zone.outage_cooling_margin_kw | number:'1.0-1' }} kW</strong>
              <span class="envelope">{{ zone.effective_heat_kw | number:'1.0-1' }} / {{ zone.outage_capacity_kw | number:'1.0-1' }} kW</span>
            </div>
          </div>
          @if (showAcks() && zone.capacity_state === 'tight') {
            <footer class="ack-row">
              @if (isAcknowledged(zone); as ack) {
                <span class="ack-done"><lucide-icon name="check-circle-2" [size]="14" /> Acknowledged by {{ ack.actor_username }}</span>
              } @else {
                <mat-checkbox [checked]="selected().has(zone.zone_id)" (change)="toggle(zone.zone_id, $event.checked)">
                  Confirm tight zone before approval
                </mat-checkbox>
              }
            </footer>
          }
        </article>
      } @empty {
        <div class="empty">Evaluate the draft to calculate per-zone cooling margins.</div>
      }
      @if (showAcks() && pendingZones().length > 0) {
        <div class="ack-actions">
          <button mat-flat-button color="primary" [disabled]="selected().size === 0 || saving()" (click)="confirm.emit()">
            <lucide-icon name="shield-check" [size]="15" /> {{ saving() ? 'Saving...' : 'Confirm selected tight zones' }}
          </button>
          <small>{{ pendingZones().length }} tight zone(s) still need confirmation</small>
        </div>
      }
    </div>
  `,
  styles: [`
    .zone-capacity{display:grid;gap:10px}
    .zone-row{padding:11px 12px;border:1px solid #d8dde1;border-left:4px solid #3e7f65;background:#fff}
    .zone-row.tight{border-left-color:#d79318;background:#fffaf0}
    .zone-row.critical{border-left-color:#cf3f2e;background:#fff5f4}
    .zone-row header{display:flex;align-items:flex-start;justify-content:space-between;gap:10px;margin-bottom:9px}
    .zone-id strong,.zone-id small{display:block;letter-spacing:0}.zone-id strong{font-size:12px}.zone-id small{margin-top:2px;color:#68717a;font-size:9px}
    .state-badge{padding:2px 8px;border-radius:3px;font:700 9px/1.4 monospace;text-transform:uppercase;white-space:nowrap;background:#eaf7ef;color:#237a4b;border:1px solid #9bcbb0}
    .state-badge.tight{background:#fff3d6;color:#855900;border-color:#e0c66d}
    .state-badge.critical{background:#fdecea;color:#a1281e;border-color:#e1a29b}
    .margin-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px}
    .margin-grid small,.margin-grid strong,.margin-grid span{display:block;letter-spacing:0}
    .margin-grid small{color:#68717a;font-size:9px;text-transform:uppercase}
    .margin-grid strong{margin-top:2px;font-size:15px;font-variant-numeric:tabular-nums}
    .margin-grid strong.negative{color:#a1281e}.margin-grid strong.warn{color:#855900}
    .envelope{color:#68717a;font-size:9px;font-variant-numeric:tabular-nums}
    .ack-row{margin-top:9px;padding-top:9px;border-top:1px dashed #d8dde1}
    .ack-done{display:inline-flex;align-items:center;gap:5px;color:#237a4b;font-size:10px;font-weight:600}
    .ack-actions{display:flex;align-items:center;gap:12px;padding:10px 12px;background:#15191d;color:#eef1f3}
    .ack-actions small{color:#aeb6bc;font-size:10px}
    .empty{padding:18px 4px;color:#68717a;font-size:11px;text-align:center}
  `]
})
export class ZoneCapacityPanelComponent {
  readonly scenario = input.required<LayoutScenario>();
  readonly showAcks = input(false);
  readonly saving = input(false);
  readonly selected = input<Set<number>>(new Set());
  readonly toggleZone = output<{zoneId: number; checked: boolean}>();
  readonly confirm = output<void>();

  readonly zones = computed<ZoneThermalResult[]>(() => this.scenario().zone_results);
  readonly pendingZones = computed(() => this.zones().filter((zone) => zone.capacity_state === 'tight' && !this.isAcknowledged(zone)));

  stateLabel(state: string): string {
    if (state === 'critical') { return 'Critical'; }
    if (state === 'tight') { return 'Capacity tight'; }
    return 'Normal';
  }

  zoneTight(zone: ZoneThermalResult): boolean { return zone.capacity_state === 'tight'; }

  isAcknowledged(zone: ZoneThermalResult) {
    return this.scenario().tight_zone_acks.find((ack) => ack.zone_id === zone.zone_id);
  }

  toggle(zoneId: number, checked: boolean): void { this.toggleZone.emit({zoneId, checked}); }
}
