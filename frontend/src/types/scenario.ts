export type ScenarioStatus = 'draft' | 'evaluating' | 'pending_review' | 'approved' | 'archived';

export type ZoneCapacityState = 'ok' | 'tight' | 'critical';

export interface ConstraintViolation {
  code: string;
  severity: 'critical' | 'warning';
  entity_type: string;
  entity_id: number;
  message: string;
  actual: number;
  limit: number;
}

export interface RackAssignment {
  load_id: number;
  load_name: string;
  rack_id: number;
  rack_code: string;
  zone_id: number;
  zone_code: string;
  power_kw: number;
  heat_kw: number;
  airflow_cfm: number;
  rack_units: number;
  placement_score: number;
  explanation: string[];
}

export interface ZoneThermalResult {
  zone_id: number;
  zone_code: string;
  assigned_heat_kw: number;
  neighbor_heat_kw: number;
  effective_heat_kw: number;
  capacity_kw: number;
  estimated_return_c: number;
  temperature_margin_c: number;
  cooling_margin_kw: number;
  outage_capacity_kw: number;
  outage_cooling_margin_kw: number;
  capacity_state: ZoneCapacityState;
}

export interface TightZoneAck {
  zone_id: number;
  zone_code: string;
  acknowledged_by: number;
  actor_username: string;
  acknowledged_at: string;
}

export interface LayoutScenario {
  id: number;
  name: string;
  scenario_status: ScenarioStatus;
  assignments: RackAssignment[];
  zone_results: ZoneThermalResult[];
  violations: ConstraintViolation[];
  tight_zone_acks: TightZoneAck[];
  total_power_kw: number;
  peak_temp_c: number;
  score: number;
  version: number;
  algorithm_version: string;
  created_by: number;
  approved_by: number | null;
  has_critical_violation: boolean;
  tight_zone_codes: string[];
  pending_tight_zone_codes: string[];
  has_unacknowledged_tight_zones: boolean;
}

export interface ScenarioComparison {
  left: LayoutScenario;
  right: LayoutScenario;
  score_delta: number;
  power_delta_kw: number;
  peak_temp_delta_c: number;
  summary: string[];
}
