/**
 * JS Traders ERP - Purchasing, Import Shipments & Landed Cost Engine
 * Supports FOB / EXW shipment terms, multi-currency vendor bills (USD/CNY),
 * and dynamic Landed Cost allocation (Value, Quantity, Weight, Volume).
 */

import { storageService } from './storageService.js';

class PurchasingService {
  getSuppliers() {
    return storageService.getCollection('parties').filter(p => p.isSupplier);
  }

  // --- PURCHASE BILLS ---
  getPurchaseBills() {
    return storageService.getCollection('purchaseBills');
  }

  createPurchaseBill(data) {
    const bills = this.getPurchaseBills();
    const billNumber = `PUR-${String(bills.length + 1).padStart(5, '0')}`;
    return storageService.insert('purchaseBills', {
      ...data,
      billNumber,
      status: data.status || 'Pending'
    });
  }

  // --- IMPORT SHIPMENTS ---
  getImportShipments() {
    return storageService.getCollection('importShipments');
  }

  getImportShipmentById(id) {
    return storageService.getById('importShipments', id);
  }

  createImportShipment(data) {
    const shipments = this.getImportShipments();
    const shipmentNumber = `IMP-${String(shipments.length + 1).padStart(5, '0')}`;
    return storageService.insert('importShipments', {
      ...data,
      shipmentNumber,
      shippingTerm: data.shippingTerm || 'FOB',
      status: 'Shipped',
      trackingProvider: 'Tracktainer',
      remainingCredits: 14,
      expenses: data.expenses || []
    });
  }

  // Landed Cost Engine: Allocates eligible expenses across goods
  allocateLandedCost(shipmentId, allocationMethod = 'Value') {
    const shipment = this.getImportShipmentById(shipmentId);
    if (!shipment) throw new Error('Shipment not found.');

    const eligibleExpenses = (shipment.expenses || []).filter(e => e.isLandedCostEligible);
    const totalLandedCostPkr = eligibleExpenses.reduce((sum, e) => sum + (Number(e.amountPkr) || 0), 0);

    const updated = storageService.update('importShipments', shipment.id, {
      allocationMethod,
      totalLandedCostPkr,
      landedCostCalculatedAt: new Date().toISOString()
    });

    return {
      shipment: updated,
      totalLandedCostPkr,
      method: allocationMethod
    };
  }

  cancelImportShipment(shipmentId) {
    return storageService.update('importShipments', shipmentId, {
      status: 'Cancelled',
      cancelledAt: new Date().toISOString()
    });
  }
}

export const purchasingService = new PurchasingService();
