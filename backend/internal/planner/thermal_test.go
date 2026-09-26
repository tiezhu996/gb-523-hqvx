package planner

import (
	"testing"

	"datacenter-thermal-capacity-planner/backend/internal/dto"
	"datacenter-thermal-capacity-planner/backend/internal/model"
)

func TestPropagateThermal(t *testing.T) {
	tests := []struct {
		name            string
		heat            map[uint]float64
		wantPeakAtLeast float64
		wantCritical    bool
	}{
		{name: "healthy margin", heat: map[uint]float64{1: 10, 2: 5}, wantPeakAtLeast: 20, wantCritical: false},
		{name: "adjacent overload", heat: map[uint]float64{1: 50, 2: 50}, wantPeakAtLeast: 33, wantCritical: true},
	}
	zones, _ := plannerFixture()
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			results, violations, peak := propagateThermal(zones, tt.heat)
			if len(results) != len(zones) || peak < tt.wantPeakAtLeast {
				t.Fatalf("unexpected thermal result peak=%.2f results=%+v", peak, results)
			}
			hasCritical := false
			for _, violation := range violations {
				hasCritical = hasCritical || violation.Severity == "critical"
			}
			if hasCritical != tt.wantCritical {
				t.Fatalf("critical=%t, want %t; violations=%+v", hasCritical, tt.wantCritical, violations)
			}
		})
	}
}

func TestThermalOrderingStable(t *testing.T) {
	zones := []model.ThermalZone{
		{ID: 2, ZoneCode: "Z-B", CoolingCapacityKW: 20, SupplyTempC: 18, MaxReturnTempC: 30, AdjacencyJSON: `{}`, ZoneStatus: "active"},
		{ID: 1, ZoneCode: "Z-A", CoolingCapacityKW: 20, SupplyTempC: 18, MaxReturnTempC: 30, AdjacencyJSON: `{}`, ZoneStatus: "active"},
	}
	results, _, _ := propagateThermal(zones, map[uint]float64{})
	if results[0].ZoneCode != "Z-A" || results[1].ZoneCode != "Z-B" {
		t.Fatalf("thermal output should be sorted by zone code: %+v", results)
	}
}

func TestPropagateThermalPostOutage(t *testing.T) {
	postOutage := 30.0
	zones := []model.ThermalZone{
		{ID: 1, ZoneCode: "Z-A", CoolingCapacityKW: 40, PostOutageCapacityKW: &postOutage, SupplyTempC: 18, MaxReturnTempC: 31, AdjacencyJSON: `{}`, ZoneStatus: "active"},
		{ID: 2, ZoneCode: "Z-B", CoolingCapacityKW: 40, SupplyTempC: 18, MaxReturnTempC: 31, AdjacencyJSON: `{}`, ZoneStatus: "active"},
	}
	tests := []struct {
		name         string
		heat         map[uint]float64
		wantCode     string
		wantSeverity string
		wantMargin   float64
	}{
		{name: "below post-outage capacity", heat: map[uint]float64{1: 20}, wantCode: "", wantMargin: 10},
		{name: "between post-outage and normal is tight", heat: map[uint]float64{1: 35}, wantCode: "ZONE_CAPACITY_TIGHT", wantSeverity: "warning", wantMargin: -5},
		{name: "beyond normal capacity is critical", heat: map[uint]float64{1: 45}, wantCode: "ZONE_COOLING_LIMIT", wantSeverity: "critical", wantMargin: -15},
		{name: "blank post-outage falls back to normal capacity", heat: map[uint]float64{2: 35}, wantCode: "", wantMargin: 5},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			results, violations, _ := propagateThermal(zones, tt.heat)
			zoneID := uint(1)
			if _, ok := tt.heat[2]; ok {
				zoneID = 2
			}
			var result *dto.ZoneThermalResult
			for i := range results {
				if results[i].ZoneID == zoneID {
					result = &results[i]
				}
			}
			if result == nil || result.PostOutageMarginKW != tt.wantMargin {
				t.Fatalf("post-outage margin=%v want %.2f", result, tt.wantMargin)
			}
			var matched *dto.ConstraintViolation
			for i := range violations {
				if violations[i].EntityID == zoneID && (violations[i].Code == "ZONE_CAPACITY_TIGHT" || violations[i].Code == "ZONE_COOLING_LIMIT") {
					matched = &violations[i]
				}
			}
			if tt.wantCode == "" && matched != nil {
				t.Fatalf("unexpected violation %+v", matched)
			}
			if tt.wantCode != "" && (matched == nil || matched.Code != tt.wantCode || matched.Severity != tt.wantSeverity) {
				t.Fatalf("violation=%+v want code=%s severity=%s", matched, tt.wantCode, tt.wantSeverity)
			}
		})
	}
}
