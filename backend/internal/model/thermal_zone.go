package model

import "time"

type ThermalZone struct {
	ID                   uint       `gorm:"primaryKey" json:"id"`
	ZoneCode             string     `gorm:"size:32;not null;uniqueIndex" json:"zone_code"`
	Name                 string     `gorm:"size:120;not null" json:"name"`
	CoolingCapacityKW    float64    `gorm:"not null" json:"cooling_capacity_kw"`
	PostOutageCapacityKW *float64   `json:"post_outage_capacity_kw"`
	SupplyTempC          float64    `gorm:"not null" json:"supply_temp_c"`
	MaxReturnTempC       float64    `gorm:"not null" json:"max_return_temp_c"`
	AdjacencyJSON        string     `gorm:"type:text;not null;default:'{}'" json:"adjacency_json"`
	ZoneStatus           string     `gorm:"size:24;not null;index" json:"zone_status"`
	CreatedAt            time.Time  `json:"created_at"`
	UpdatedAt            time.Time  `json:"updated_at"`
}

func (ThermalZone) TableName() string { return "thermal_zones" }

// PostOutageCapacityKWValue is the cooling available after one cooling unit is
// taken out for maintenance. A blank value falls back to the normal capacity.
func (z ThermalZone) PostOutageCapacityKWValue() float64 {
	if z.PostOutageCapacityKW != nil && *z.PostOutageCapacityKW > 0 {
		return *z.PostOutageCapacityKW
	}
	return z.CoolingCapacityKW
}

func (z ThermalZone) TemperatureHeadroom() float64 {
	return z.MaxReturnTempC - z.SupplyTempC
}

func (z ThermalZone) IsActive() bool {
	return z.ZoneStatus == "active"
}
