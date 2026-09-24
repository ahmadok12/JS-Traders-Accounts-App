/**
 * JS Traders ERP - Warehouse & Location Service
 */

import { storageService } from './storageService.js';

class WarehouseService {
  getWarehouses(includeVoided = false) {
    const list = storageService.getCollection('warehouses') || [];
    if (includeVoided) return list;
    return list.filter(w => !w.isVoid && w.isActive !== false);
  }

  getAllWarehouses() {
    return storageService.getCollection('warehouses') || [];
  }

  getWarehouseById(id) {
    return storageService.getById('warehouses', id);
  }

  createWarehouse(data) {
    const warehouses = this.getAllWarehouses();
    const code = `WH-${String(warehouses.length + 1).padStart(3, '0')}`;
    return storageService.insert('warehouses', {
      ...data,
      code,
      isActive: data.isActive !== undefined ? data.isActive : true,
      isVoid: false,
      createdAt: new Date().toISOString()
    });
  }

  updateWarehouse(id, updates) {
    return storageService.update('warehouses', id, updates);
  }

  voidWarehouse(id) {
    return storageService.update('warehouses', id, {
      isActive: false,
      isVoid: true,
      voidedAt: new Date().toISOString()
    });
  }

  reactivateWarehouse(id) {
    return storageService.update('warehouses', id, {
      isActive: true,
      isVoid: false,
      reactivatedAt: new Date().toISOString()
    });
  }

  deleteWarehouse(id) {
    return storageService.delete('warehouses', id);
  }

  getAllLocations() {
    const locations = storageService.getCollection('warehouseLocations');
    const warehouses = this.getWarehouses();
    const whMap = new Map(warehouses.map(w => [w.id, w]));
    return locations.map(loc => ({
      ...loc,
      warehouse: whMap.get(loc.warehouseId) || { name: 'Unknown', code: 'WH-?' }
    }));
  }

  getLocationsByWarehouse(warehouseId) {
    return storageService.getCollection('warehouseLocations').filter(loc => loc.warehouseId === warehouseId);
  }

  getLocationById(id) {
    return storageService.getById('warehouseLocations', id);
  }

  createLocation(warehouseId, locationData) {
    const id = `loc-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    return storageService.insert('warehouseLocations', {
      id,
      warehouseId,
      ...locationData,
      createdAt: new Date().toISOString()
    });
  }

  updateLocation(id, updates) {
    return storageService.update('warehouseLocations', id, updates);
  }

  deleteLocation(id) {
    return storageService.delete('warehouseLocations', id);
  }
}

export const warehouseService = new WarehouseService();

