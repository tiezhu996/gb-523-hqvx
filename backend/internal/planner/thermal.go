package planner

import (
	"sort"

	"datacenter-thermal-capacity-planner/backend/internal/dto"
	"datacenter-thermal-capacity-planner/backend/internal/model"
)

// propagateThermal is an intentionally simplified planning model. It estimates
// return temperature from direct and weighted neighboring heat, not sensor data.
func propagateThermal(zones []model.ThermalZone, directHeat map[uint]float64) ([]dto.ZoneThermalResult, []dto.ConstraintViolation, float64) {
	ordered := append([]model.ThermalZone(nil), zones...)
	sort.SliceStable(ordered, func(i, j int) bool { return ordered[i].ZoneCode < ordered[j].ZoneCode })
	byCode := make(map[string]model.ThermalZone, len(zones))
	for _, zone := range zones {
		byCode[zone.ZoneCode] = zone
	}
	results := make([]dto.ZoneThermalResult, 0, len(zones))
	violations := []dto.ConstraintViolation{}
	peak := 0.0
	for _, zone := range ordered {
		neighborHeat := 0.0
		for code, weight := range dto.DecodeAdjacency(zone.AdjacencyJSON) {
			if neighbor, ok := byCode[code]; ok {
				neighborHeat += directHeat[neighbor.ID] * weight
			}
		}
		effectiveHeat := directHeat[zone.ID] + neighborHeat
		capacity := zone.CoolingCapacityKW
		outageCapacity := zone.OutageCoolingKW()
		utilization := 0.0
		if capacity > 0 {
			utilization = effectiveHeat / capacity
		}
		// A calibrated planning assumption: full envelope adds 12 C to supply.
		estimated := zone.SupplyTempC + utilization*12
		margin := zone.MaxReturnTempC - estimated
		coolingMargin := capacity - effectiveHeat
		outageCoolingMargin := outageCapacity - effectiveHeat
		capacityState := dto.ZoneCapacityOK
		if effectiveHeat > capacity {
			// Effective heat past the normal envelope is a critical violation and
			// automatically overrides the post-outage classification.
			capacityState = dto.ZoneCapacityCritical
		} else if effectiveHeat > outageCapacity {
			capacityState = dto.ZoneCapacityTight
		}
		results = append(results, dto.ZoneThermalResult{
			ZoneID: zone.ID, ZoneCode: zone.ZoneCode, AssignedHeatKW: round2(directHeat[zone.ID]),
			NeighborHeatKW: round2(neighborHeat), EffectiveHeatKW: round2(effectiveHeat),
			CapacityKW:       round2(capacity),
			EstimatedReturnC: round2(estimated), TemperatureMarginC: round2(margin),
			CoolingMarginKW: round2(coolingMargin), OutageCapacityKW: round2(outageCapacity),
			OutageCoolingMarginKW: round2(outageCoolingMargin), CapacityState: capacityState,
		})
		if estimated > peak {
			peak = estimated
		}
		if coolingMargin < 0 {
			violations = append(violations, violation("ZONE_COOLING_LIMIT", zone.ID, "thermal_zone", "effective heat including adjacency exceeds cooling capacity", effectiveHeat, capacity))
		}
		if capacityState == dto.ZoneCapacityTight {
			violations = append(violations, dto.ConstraintViolation{
				Code: "ZONE_OUTAGE_CAPACITY_TIGHT", Severity: "warning", EntityType: "thermal_zone", EntityID: zone.ID,
				Message: "effective heat fits the normal envelope but exceeds post-outage cooling capacity; reviewer acknowledgement required before approval",
				Actual:  round2(effectiveHeat), Limit: round2(outageCapacity),
			})
		}
		if margin < 0 {
			violations = append(violations, violation("ZONE_RETURN_TEMP", zone.ID, "thermal_zone", "estimated return temperature exceeds configured limit", estimated, zone.MaxReturnTempC))
		} else if margin < 2 {
			violations = append(violations, dto.ConstraintViolation{
				Code: "ZONE_TEMP_HEADROOM_LOW", Severity: "warning", EntityType: "thermal_zone", EntityID: zone.ID,
				Message: "estimated return temperature has less than 2 C headroom", Actual: round2(estimated), Limit: zone.MaxReturnTempC,
			})
		}
	}
	return results, violations, round2(peak)
}
