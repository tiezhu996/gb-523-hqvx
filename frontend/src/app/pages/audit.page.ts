import { ChangeDetectionStrategy, Component, computed, signal } from '@angular/core';
import { DatePipe, DecimalPipe } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { MatSnackBar } from '@angular/material/snack-bar';
import { LucideAngularModule } from 'lucide-angular';
import { catchError, forkJoin, of } from 'rxjs';
import { AuditEvent } from '../../types/audit';
import { LayoutScenario, ScenarioComparison, ScenarioStatus } from '../../types/scenario';
import { ThermalZone } from '../../types/zone';
import { AuditApi } from '../api/audit.api';
import { ScenarioApi } from '../api/scenario.api';
import { ZoneApi } from '../api/zone.api';
import { CapacityMeterComponent } from '../components/common/capacity-meter.component';
import { ConstraintBadgeComponent } from '../components/common/constraint-badge.component';
import { VersionComparePanelComponent } from '../components/common/version-compare-panel.component';
import { ZoneCapacityPanelComponent } from '../components/common/zone-capacity-panel.component';
import { useAuth } from '../hooks/use-auth';

@Component({
  standalone: true,
  imports: [DatePipe, DecimalPipe, MatButtonModule, MatCheckboxModule, MatFormFieldModule, MatSelectModule, CapacityMeterComponent,
    ConstraintBadgeComponent, VersionComparePanelComponent, ZoneCapacityPanelComponent,
    LucideAngularModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page">
      <header class="page-header">
        <div><h1>Audit & versions</h1><p>Review state transitions, compare evaluated layouts, and trace boundary changes by request ID.</p></div>
        <div class="header-actions"><button mat-stroked-button (click)="load()"><lucide-icon name="refresh-cw" [size]="16" /> Refresh</button></div>
      </header>

      <section class="review-queue">
        <div class="queue-heading"><span><lucide-icon name="shield-check" [size]="20" /><strong>Review queue</strong></span><small>{{ pending().length }} pending</small></div>
        <div class="queue-items">
          @for (scenario of pending(); track scenario.id) {
            <article [class.expanded]="expandedId() === scenario.id">
              <div><span class="status pending_review">pending review</span><h2>{{ scenario.name }}</h2><p>v{{ scenario.version }} / {{ scenario.algorithm_version }} / {{ scenario.assignments.length }} placements</p></div>
              <div class="queue-score"><small>Score</small><strong>{{ scenario.score | number:'1.0-1' }}</strong></div>
              @if (scenario.has_critical_violation) {
                <app-constraint-badge severity="critical" label="Critical evidence" />
              } @else if (scenario.has_unacknowledged_tight_zones) {
                <app-constraint-badge severity="warning" [label]="'Tight: ' + scenario.pending_tight_zone_codes.join(', ')" />
              } @else if (scenario.tight_zone_codes.length > 0) {
                <app-constraint-badge severity="clear" [label]="'Tight zones confirmed: ' + scenario.tight_zone_codes.join(', ')" />
              } @else {
                <app-constraint-badge severity="clear" label="Approval ready" />
              }
              <div class="queue-actions">
                <button mat-stroked-button (click)="toggleDetail(scenario.id)">{{ expandedId() === scenario.id ? 'Hide detail' : 'Capacity detail' }}</button>
                <button mat-flat-button color="primary" [disabled]="scenario.has_critical_violation || scenario.has_unacknowledged_tight_zones" (click)="transition(scenario, 'approved')"><lucide-icon name="check-circle-2" [size]="16" /> Approve</button>
              </div>
              @if (expandedId() === scenario.id) {
                <div class="queue-detail">
                  <app-zone-capacity-panel [scenario]="scenario" [showAcks]="canReview()" [saving]="acknowledgingId() === scenario.id" [selected]="selectedFor(scenario.id)" (toggleZone)="toggleAck(scenario, $event.zoneId, $event.checked)" (confirm)="acknowledge(scenario)" />
                  @if (scenario.has_unacknowledged_tight_zones) {
                    <p class="ack-hint">Approval is blocked until every capacity-tight zone is explicitly confirmed.</p>
                  }
                </div>
              }
            </article>
          } @empty {<div class="queue-empty">No scenarios are waiting for review.</div>}
        </div>
      </section>

      <div class="audit-grid">
        <section class="panel compare-panel">
          <div class="panel-header"><h2><lucide-icon name="git-compare-arrows" [size]="16" /> Version comparison</h2></div>
          <div class="panel-body compare-controls">
            <mat-form-field appearance="outline"><mat-label>Baseline</mat-label><mat-select [value]="leftId()" (selectionChange)="leftId.set($event.value); compare()">@for (scenario of evaluated(); track scenario.id) {<mat-option [value]="scenario.id">{{ scenario.name }} / v{{ scenario.version }}</mat-option>}</mat-select></mat-form-field>
            <mat-form-field appearance="outline"><mat-label>Candidate</mat-label><mat-select [value]="rightId()" (selectionChange)="rightId.set($event.value); compare()">@for (scenario of evaluated(); track scenario.id) {<mat-option [value]="scenario.id">{{ scenario.name }} / v{{ scenario.version }}</mat-option>}</mat-select></mat-form-field>
            <app-version-compare-panel class="full" [comparison]="comparison()" />
          </div>
        </section>

        <section class="panel boundaries-panel">
          <div class="panel-header"><h2>Boundary context</h2><span class="secondary">Current state</span></div>
          <div class="boundary-list">
            @for (zone of zones(); track zone.id) {
              <div><span><strong>{{ zone.zone_code }}</strong><small>{{ zone.name }}</small></span><app-capacity-meter [value]="zone.capacity_utilization" [label]="zone.zone_code + ' capacity'" /><span class="numeric"><strong>{{ zone.cooling_capacity_kw | number:'1.0-0' }} kW</strong><small>{{ zone.effective_outage_cooling_kw | number:'1.0-0' }} kW after outage / {{ zone.max_return_temp_c | number:'1.0-1' }} C max</small></span></div>
            }
          </div>
        </section>
      </div>

      <section class="panel events-panel">
        <div class="panel-header"><h2>Audit events</h2><mat-form-field appearance="outline" subscriptSizing="dynamic"><mat-label>Entity type</mat-label><mat-select [value]="entityFilter()" (selectionChange)="entityFilter.set($event.value); loadEvents()"><mat-option value="">All entities</mat-option><mat-option value="thermal_zone">Thermal zone</mat-option><mat-option value="rack">Rack</mat-option><mat-option value="equipment_load">Equipment load</mat-option><mat-option value="layout_scenario">Layout scenario</mat-option></mat-select></mat-form-field></div>
        <div class="table-wrap"><table class="data-table"><thead><tr><th>Time</th><th>Actor</th><th>Action</th><th>Entity</th><th>Before</th><th>After</th><th>Request ID</th></tr></thead><tbody>
          @for (event of events(); track event.id) {<tr><td>{{ event.created_at | date:'MMM d, HH:mm:ss' }}</td><td class="primary-cell">{{ event.actor_username }}</td><td>{{ event.action }}</td><td>{{ event.entity_type }} #{{ event.entity_id }}</td><td class="secondary summary-cell">{{ event.before_summary || '-' }}</td><td class="secondary summary-cell">{{ event.after_summary || '-' }}</td><td><code>{{ event.request_id }}</code></td></tr>} @empty {<tr><td colspan="7"><div class="empty"><span><strong>No audit events</strong>Recorded changes will appear here.</span></div></td></tr>}
        </tbody></table></div>
      </section>

      @if (auth.hasRole('admin')) {
        <section class="archive-row"><span><strong>Approved scenarios</strong><small>Terminal archival is restricted to administrators.</small></span>@for (scenario of approved(); track scenario.id) {<button mat-stroked-button (click)="transition(scenario, 'archived')"><lucide-icon name="archive" [size]="15" /> Archive {{ scenario.name }}</button>}</section>
      }
    </div>
  `,
  styles: [`
    .review-queue{margin-bottom:16px;background:#15191d;border:1px solid #050607;color:#eef1f3}.queue-heading{min-height:48px;display:flex;align-items:center;justify-content:space-between;padding:10px 14px;border-bottom:1px solid #3a4045}.queue-heading>span{display:flex;align-items:center;gap:8px}.queue-heading strong{font-size:13px}.queue-heading small{color:#aeb6bc;font-size:10px;text-transform:uppercase}.queue-items{display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr))}.queue-items article{min-height:128px;display:grid;grid-template-columns:minmax(0,1fr) auto;gap:9px 14px;align-items:center;padding:14px;border-right:1px solid #3a4045}.queue-items article:last-child{border-right:0}.queue-items article.expanded{align-items:start}.queue-items h2{margin:8px 0 0;font-size:14px}.queue-items p{margin:4px 0 0;color:#aeb6bc;font-size:9px}.queue-score{text-align:right}.queue-score small,.queue-score strong{display:block}.queue-score small{color:#aeb6bc;font-size:9px;text-transform:uppercase}.queue-score strong{margin-top:3px;font-size:20px}.queue-actions{grid-column:2;display:flex;gap:8px;align-items:center}.queue-detail{grid-column:1/-1;margin-top:6px;padding:12px;background:#f3f5f6;color:#1d2328}.ack-hint{margin:10px 2px 0;color:#855900;font-size:10px;font-weight:600}.queue-empty{grid-column:1/-1;padding:30px;color:#aeb6bc;font-size:11px;text-align:center}.audit-grid{display:grid;grid-template-columns:minmax(0,1.3fr) minmax(330px,.7fr);gap:16px;margin-bottom:16px}.panel-header h2{display:flex;align-items:center;gap:7px}.compare-controls{display:grid;grid-template-columns:1fr 1fr;gap:4px 12px}.compare-controls .full{grid-column:1/-1}.boundary-list{padding:4px 14px}.boundary-list>div{display:grid;grid-template-columns:minmax(120px,1fr) minmax(105px,.8fr) 120px;align-items:center;gap:12px;padding:12px 0;border-bottom:1px solid #e5e8ea}.boundary-list>div:last-child{border-bottom:0}.boundary-list strong,.boundary-list small{display:block;letter-spacing:0}.boundary-list strong{font-size:11px}.boundary-list small{margin-top:3px;color:#68717a;font-size:9px}.events-panel .panel-header mat-form-field{width:190px}.summary-cell{max-width:240px;white-space:normal}.events-panel code{font-size:9px;color:#4f5860}.archive-row{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-top:16px;padding:14px 0;border-top:1px solid #aeb6bd}.archive-row>span{margin-right:auto}.archive-row strong,.archive-row small{display:block}.archive-row strong{font-size:12px}.archive-row small{margin-top:3px;color:#68717a;font-size:10px}
    @media(max-width:1050px){.audit-grid{grid-template-columns:1fr}}@media(max-width:650px){.queue-items{grid-template-columns:1fr}.queue-items article{border-right:0;border-bottom:1px solid #3a4045}.queue-actions{grid-column:1/-1}.compare-controls{grid-template-columns:1fr}.compare-controls .full{grid-column:1}.boundary-list>div{grid-template-columns:1fr 110px}.boundary-list>div>.numeric{grid-column:1/-1;text-align:left!important}}
  `]
})
export class AuditPage {
  readonly auth = useAuth();
  readonly scenarios = signal<LayoutScenario[]>([]);
  readonly zones = signal<ThermalZone[]>([]);
  readonly events = signal<AuditEvent[]>([]);
  readonly comparison = signal<ScenarioComparison | null>(null);
  readonly entityFilter = signal('');
  readonly leftId = signal<number | null>(null);
  readonly rightId = signal<number | null>(null);
  readonly expandedId = signal<number | null>(null);
  readonly selectedAcks = signal<Map<number, Set<number>>>(new Map());
  readonly acknowledgingId = signal<number | null>(null);
  readonly pending = computed(() => this.scenarios().filter((item) => item.scenario_status === 'pending_review'));
  readonly approved = computed(() => this.scenarios().filter((item) => item.scenario_status === 'approved'));
  readonly evaluated = computed(() => this.scenarios().filter((item) => item.scenario_status !== 'draft' && item.scenario_status !== 'evaluating'));

  constructor(private readonly scenarioApi: ScenarioApi, private readonly zoneApi: ZoneApi, private readonly auditApi: AuditApi, private readonly snack: MatSnackBar) { this.load(); }
  canReview(): boolean { return this.auth.hasRole('reviewer', 'admin'); }
  selectedFor(id: number): Set<number> { return this.selectedAcks().get(id) ?? new Set<number>(); }
  load(): void { forkJoin({scenarios: this.scenarioApi.list(), zones: this.zoneApi.list(), events: this.auditApi.list(this.entityFilter())}).subscribe(({scenarios, zones, events}) => { this.scenarios.set(scenarios.items); this.zones.set(zones.items); this.events.set(events.items); const evaluated = scenarios.items.filter((item) => item.scenario_status !== 'draft' && item.scenario_status !== 'evaluating'); this.leftId.set(this.leftId() ?? evaluated[0]?.id ?? null); this.rightId.set(this.rightId() ?? evaluated[1]?.id ?? evaluated[0]?.id ?? null); this.compare(); }); }
  loadEvents(): void { this.auditApi.list(this.entityFilter()).subscribe((page) => this.events.set(page.items)); }
  compare(): void { const left = this.leftId(); const right = this.rightId(); if (!left || !right) { this.comparison.set(null); return; } this.scenarioApi.compare(left, right).subscribe((value) => this.comparison.set(value)); }
  toggleDetail(id: number): void { this.expandedId.set(this.expandedId() === id ? null : id); }
  toggleAck(scenario: LayoutScenario, zoneId: number, checked: boolean): void {
    const next = new Map(this.selectedAcks());
    const zones = new Set(next.get(scenario.id) ?? []);
    checked ? zones.add(zoneId) : zones.delete(zoneId);
    next.set(scenario.id, zones);
    this.selectedAcks.set(next);
  }
  acknowledge(scenario: LayoutScenario): void {
    const zones = this.selectedAcks().get(scenario.id) ?? new Set<number>();
    if (zones.size === 0) { this.snack.open('Select at least one tight zone to confirm', 'Dismiss', {duration: 3500}); return; }
    this.acknowledgingId.set(scenario.id);
    this.scenarioApi.acknowledgeTightZones(scenario.id, scenario.version, [...zones]).pipe(
      catchError(() => of(null)),
    ).subscribe({
      next: (updated) => {
        if (!updated) { return; }
        this.scenarios.update((items) => items.map((item) => item.id === updated.id ? updated : item));
        const remaining = new Map(this.selectedAcks());
        remaining.delete(updated.id);
        this.selectedAcks.set(remaining);
        this.snack.open(updated.pending_tight_zone_codes.length ? `Tight zones confirmed; ${updated.pending_tight_zone_codes.length} remain` : 'All tight zones confirmed; scenario ready to approve', undefined, {duration: 3200});
      },
      complete: () => this.acknowledgingId.set(null),
    });
  }
  transition(scenario: LayoutScenario, target: ScenarioStatus): void { this.scenarioApi.transition(scenario.id, scenario.version, target, target === 'approved' ? 'Approved after thermal review' : 'Archived by administrator').subscribe((updated) => { this.scenarios.update((items) => items.map((item) => item.id === updated.id ? updated : item)); this.snack.open(`Scenario ${target}`, undefined, {duration: 2200}); this.loadEvents(); }); }
}
