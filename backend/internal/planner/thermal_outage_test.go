package planner

import (
	"testing"

	"datacenter-thermal-capacity-planner/backend/internal/dto"
	"datacenter-thermal-capacity-planner/backend/internal/model"
)

func outagePtr(value float64) *float64 { return &value }

func TestPropagateThermalOutageClassification(t *testing.T) {
	zone := func(id uint, code string, capacity, outage *float64) model.ThermalZone {
		z := model.ThermalZone{
			ID: id, ZoneCode: code, CoolingCapacityKW: 100,
			SupplyTempC: 18, MaxReturnTempC: 31, AdjacencyJSON: `{}`, ZoneStatus: "active",
		}
		if capacity != nil {
			z.CoolingCapacityKW = *capacity
		}
		z.OutageCoolingCapacityKW = outage
		return z
	}
	tests := []struct {
		name         string
		capacity     *float64
		outage       *float64
		heat         float64
		wantState    string
		wantWarning  bool
		wantCritical bool
	}{
		{name: "within outage envelope", capacity: outagePtr(100), outage: outagePtr(70), heat: 60, wantState: dto.ZoneCapacityOK},
		{name: "between outage and normal envelope is tight", capacity: outagePtr(100), outage: outagePtr(70), heat: 80, wantState: dto.ZoneCapacityTight, wantWarning: true},
		{name: "blank outage falls back to normal capacity", capacity: outagePtr(100), outage: nil, heat: 95, wantState: dto.ZoneCapacityOK},
		{name: "zero outage configured falls back to normal capacity", capacity: outagePtr(100), outage: outagePtr(0), heat: 95, wantState: dto.ZoneCapacityOK},
		{name: "above normal envelope is critical", capacity: outagePtr(100), outage: outagePtr(70), heat: 110, wantState: dto.ZoneCapacityCritical, wantCritical: true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			zones := []model.ThermalZone{zone(1, "TZ-X", tt.capacity, tt.outage)}
			results, violations, _ := propagateThermal(zones, map[uint]float64{1: tt.heat})
			if len(results) != 1 {
				t.Fatalf("expected one zone result, got %d", len(results))
			}
			result := results[0]
			if result.CapacityState != tt.wantState {
				t.Fatalf("capacity_state=%s, want %s; margin=%.2f outage_capacity=%.2f", result.CapacityState, tt.wantState, result.OutageCoolingMarginKW, result.OutageCapacityKW)
			}
			if got := result.OutageCoolingMarginKW; got != result.OutageCapacityKW-round2(tt.heat) {
				t.Fatalf("outage margin %.2f does not match capacity %.2f minus heat %.2f", got, result.OutageCapacityKW, tt.heat)
			}
			hasWarning, hasCritical := false, false
			for _, item := range violations {
				if item.Code == "ZONE_OUTAGE_CAPACITY_TIGHT" {
					hasWarning = true
				}
				if item.Severity == "critical" && item.Code == "ZONE_COOLING_LIMIT" {
					hasCritical = true
				}
			}
			if hasWarning != tt.wantWarning {
				t.Fatalf("tight warning=%t, want %t; violations=%+v", hasWarning, tt.wantWarning, violations)
			}
			if hasCritical != tt.wantCritical {
				t.Fatalf("cooling critical=%t, want %t; violations=%+v", hasCritical, tt.wantCritical, violations)
			}
		})
	}
}
