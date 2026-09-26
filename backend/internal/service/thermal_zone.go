package service

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"datacenter-thermal-capacity-planner/backend/internal/audit"
	"datacenter-thermal-capacity-planner/backend/internal/dto"
	"datacenter-thermal-capacity-planner/backend/internal/model"
	"datacenter-thermal-capacity-planner/backend/internal/repository"
	"datacenter-thermal-capacity-planner/backend/internal/web"
)

type ThermalZoneService struct {
	zones *repository.ThermalZoneRepository
	racks *repository.RackRepository
}

func NewThermalZoneService(zones *repository.ThermalZoneRepository, racks *repository.RackRepository) *ThermalZoneService {
	return &ThermalZoneService{zones: zones, racks: racks}
}

func (s *ThermalZoneService) List(ctx context.Context, search, status string, page, size int) ([]dto.ThermalZoneResponse, int64, error) {
	zones, total, err := s.zones.List(ctx, search, status, page, size)
	if err != nil {
		return nil, 0, err
	}
	allRacks, err := s.racks.All(ctx)
	if err != nil {
		return nil, 0, err
	}
	responses := make([]dto.ThermalZoneResponse, 0, len(zones))
	for _, zone := range zones {
		var count int64
		allocated := 0.0
		for _, rack := range allRacks {
			if rack.ZoneID == zone.ID {
				count++
				allocated += rack.PowerLimitKW
			}
		}
		responses = append(responses, decodeZone(zone, count, allocated))
	}
	return responses, total, nil
}
func (s *ThermalZoneService) Get(ctx context.Context, id uint) (dto.ThermalZoneResponse, error) {
	zone, err := s.zones.Get(ctx, id)
	if err != nil {
		return dto.ThermalZoneResponse{}, err
	}
	count, err := s.zones.RackCount(ctx, id)
	if err != nil {
		return dto.ThermalZoneResponse{}, err
	}
	racks, err := s.racks.All(ctx)
	if err != nil {
		return dto.ThermalZoneResponse{}, err
	}
	allocated := 0.0
	for _, rack := range racks {
		if rack.ZoneID == id {
			allocated += rack.PowerLimitKW
		}
	}
	return decodeZone(zone, count, allocated), nil
}

func (s *ThermalZoneService) Create(ctx context.Context, req dto.CreateThermalZoneRequest, actor audit.Entry) (dto.ThermalZoneResponse, error) {
	zone, err := dto.NewThermalZone(req)
	if err != nil {
		return dto.ThermalZoneResponse{}, web.Unprocessable("INVALID_ZONE_BOUNDARY", err.Error(), err)
	}
	actor.Action = "thermal_zone.create"
	actor.EntityType = "thermal_zone"
	actor.AfterSummary = fmt.Sprintf("%s capacity=%.2f outage=%s supply=%.2f max_return=%.2f", zone.ZoneCode, zone.CoolingCapacityKW, formatOutage(zone.OutageCoolingCapacityKW), zone.SupplyTempC, zone.MaxReturnTempC)
	if err := s.zones.Create(ctx, &zone, actor); err != nil {
		return dto.ThermalZoneResponse{}, err
	}
	return decodeZone(zone, 0, 0), nil
}

func (s *ThermalZoneService) Update(ctx context.Context, id uint, req dto.UpdateThermalZoneRequest, actor audit.Entry) (dto.ThermalZoneResponse, error) {
	current, err := s.zones.Get(ctx, id)
	if err != nil {
		return dto.ThermalZoneResponse{}, err
	}
	if err := req.ValidateBusiness(current.ZoneCode); err != nil {
		return dto.ThermalZoneResponse{}, web.Unprocessable("INVALID_ZONE_BOUNDARY", err.Error(), err)
	}
	adjacency, err := json.Marshal(req.Adjacency)
	if err != nil {
		return dto.ThermalZoneResponse{}, web.BadRequest("INVALID_ADJACENCY", "adjacency cannot be encoded", err)
	}
	beforeSummary := fmt.Sprintf("capacity=%.2f outage=%s supply=%.2f max_return=%.2f", current.CoolingCapacityKW, formatOutage(current.OutageCoolingCapacityKW), current.SupplyTempC, current.MaxReturnTempC)
	current.Name = strings.TrimSpace(req.Name)
	current.CoolingCapacityKW = req.CoolingCapacityKW
	current.OutageCoolingCapacityKW = req.OutageCoolingCapacityKW
	current.SupplyTempC = req.SupplyTempC
	current.MaxReturnTempC = req.MaxReturnTempC
	current.AdjacencyJSON = string(adjacency)
	current.ZoneStatus = req.ZoneStatus
	actor.Action = "thermal_zone.update"
	actor.EntityType = "thermal_zone"
	actor.BeforeSummary = beforeSummary
	actor.AfterSummary = fmt.Sprintf("capacity=%.2f outage=%s supply=%.2f max_return=%.2f", req.CoolingCapacityKW, formatOutage(req.OutageCoolingCapacityKW), req.SupplyTempC, req.MaxReturnTempC)
	actor.EntityID = id
	if err := s.zones.Update(ctx, &current, actor); err != nil {
		return dto.ThermalZoneResponse{}, err
	}
	return s.Get(ctx, id)
}

func decodeZone(zone model.ThermalZone, rackCount int64, allocated float64) dto.ThermalZoneResponse {
	utilization := 0.0
	if zone.CoolingCapacityKW > 0 {
		utilization = allocated / zone.CoolingCapacityKW * 100
	}
	return dto.ThermalZoneResponse{
		ID: zone.ID, ZoneCode: zone.ZoneCode, Name: zone.Name, CoolingCapacityKW: zone.CoolingCapacityKW,
		OutageCoolingCapacityKW: zone.OutageCoolingCapacityKW, EffectiveOutageKW: zone.OutageCoolingKW(),
		SupplyTempC: zone.SupplyTempC, MaxReturnTempC: zone.MaxReturnTempC,
		Adjacency: dto.DecodeAdjacency(zone.AdjacencyJSON), ZoneStatus: zone.ZoneStatus,
		RackCount: rackCount, AllocatedPowerKW: allocated, CapacityUtilization: utilization,
		TemperatureHeadroom: zone.MaxReturnTempC - zone.SupplyTempC,
	}
}

func formatOutage(value *float64) string {
	if value == nil {
		return "normal"
	}
	return fmt.Sprintf("%.2f", *value)
}
