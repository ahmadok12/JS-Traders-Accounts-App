/**
 * JS Traders ERP - Delivery Management Service
 * Independent from Sales Invoice. Stock is deducted ONLY when a Delivery is Confirmed.
 * Enforces line delivery limits: Delivered quantity cannot exceed remaining ordered quantity.
 */

import { storageService } from './storageService.js';
import { inventoryService } from './inventoryService.js';

class DeliveryService {
  getDeliveries() {
    return storageService.getCollection('deliveries');
  }

  getDeliveryById(id) {
    return storageService.getById('deliveries', id);
  }

  // Create Delivery (Draft state - does NOT deduct stock yet)
  createDelivery({
    salesOrderId,
    customerPartyId,
    farmId,
    warehouseId,
    vehicleNumber,
    driverName,
    driverPhone,
    lines, // Array of { salesOrderLineId, variantId, deliveredQuantity, unit }
    notes = '',
    userId = 'user-admin'
  }) {
    const deliveries = this.getDeliveries();
    const deliveryNumber = `DEL-${String(deliveries.length + 1).padStart(5, '0')}`;

    // Validate against sales order lines remaining quantity
    if (salesOrderId) {
      const salesOrder = storageService.getById('salesOrders', salesOrderId);
      if (salesOrder) {
        for (const line of lines) {
          const soLine = (salesOrder.lines || []).find(l => l.id === line.salesOrderLineId);
          if (soLine) {
            const remaining = (Number(soLine.orderedQty) || 0) - (Number(soLine.deliveredQty) || 0);
            if (Number(line.deliveredQuantity) > remaining) {
              throw new Error(
                `Delivery quantity (${line.deliveredQuantity}) exceeds remaining order quantity (${remaining}) for line ${line.salesOrderLineId}.`
              );
            }
          }
        }
      }
    }

    const delivery = storageService.insert('deliveries', {
      deliveryNumber,
      salesOrderId: salesOrderId || null,
      customerPartyId,
      farmId: farmId || null,
      warehouseId,
      deliveryDate: new Date().toISOString().split('T')[0],
      vehicleNumber: vehicleNumber || '',
      driverName: driverName || '',
      driverPhone: driverPhone || '',
      status: 'Draft', // Draft -> Confirmed -> Cancelled
      lines: lines.map(l => ({
        salesOrderLineId: l.salesOrderLineId || null,
        variantId: l.variantId,
        deliveredQuantity: Number(l.deliveredQuantity),
        unit: l.unit || 'PCS'
      })),
      notes,
      createdBy: userId
    });

    return delivery;
  }

  // Confirm Delivery: This is the ONLY trigger for inventory stock deduction!
  confirmDelivery(deliveryId, userId = 'user-admin') {
    const delivery = this.getDeliveryById(deliveryId);
    if (!delivery) throw new Error('Delivery not found.');
    if (delivery.status === 'Confirmed') throw new Error('Delivery is already confirmed.');

    // 1. Prepare negative stock movement lines
    const movementLines = delivery.lines.map(l => ({
      variantId: l.variantId,
      quantity: -Math.abs(Number(l.deliveredQuantity)),
      unit: l.unit || 'PCS',
      notes: `Delivery ${delivery.deliveryNumber}`
    }));

    // 2. Post atomic stock movement
    const movement = inventoryService.postStockMovement({
      movementType: 'delivery',
      referenceDocType: 'delivery',
      referenceDocId: delivery.id,
      warehouseId: delivery.warehouseId,
      lines: movementLines,
      notes: `Delivery confirmed: ${delivery.deliveryNumber}`,
      userId
    });

    // 3. Update Sales Order delivered quantities
    if (delivery.salesOrderId) {
      const salesOrder = storageService.getById('salesOrders', delivery.salesOrderId);
      if (salesOrder && salesOrder.lines) {
        let allFulfilled = true;
        const updatedLines = salesOrder.lines.map(soLine => {
          const matchLine = delivery.lines.find(dl => dl.salesOrderLineId === soLine.id);
          const addQty = matchLine ? Number(matchLine.deliveredQuantity) : 0;
          const newDelivered = (Number(soLine.deliveredQty) || 0) + addQty;
          if (newDelivered < Number(soLine.orderedQty)) {
            allFulfilled = false;
          }
          return {
            ...soLine,
            deliveredQty: newDelivered
          };
        });

        storageService.update('salesOrders', salesOrder.id, {
          lines: updatedLines,
          status: allFulfilled ? 'Delivered' : 'Partially Delivered'
        });
      }
    }

    // 4. Mark Delivery confirmed
    const updated = storageService.update('deliveries', delivery.id, {
      status: 'Confirmed',
      confirmedBy: userId,
      confirmedAt: new Date().toISOString(),
      stockMovementId: movement.id
    });

    return updated;
  }

  // Cancel Delivery: Reverses stock movement if previously confirmed
  cancelDelivery(deliveryId, userId = 'user-admin') {
    const delivery = this.getDeliveryById(deliveryId);
    if (!delivery) throw new Error('Delivery not found.');
    if (delivery.status === 'Cancelled') throw new Error('Delivery is already cancelled.');

    if (delivery.status === 'Confirmed') {
      // Reverse stock movements by adding back delivered quantities
      const reverseLines = delivery.lines.map(l => ({
        variantId: l.variantId,
        quantity: Math.abs(Number(l.deliveredQuantity)),
        unit: l.unit || 'PCS',
        notes: `Reversal of Cancelled Delivery ${delivery.deliveryNumber}`
      }));

      inventoryService.postStockMovement({
        movementType: 'return',
        referenceDocType: 'delivery_reversal',
        referenceDocId: delivery.id,
        warehouseId: delivery.warehouseId,
        lines: reverseLines,
        notes: `Delivery cancelled: ${delivery.deliveryNumber}`,
        userId
      });

      // Reverse Sales Order delivered quantities
      if (delivery.salesOrderId) {
        const salesOrder = storageService.getById('salesOrders', delivery.salesOrderId);
        if (salesOrder && salesOrder.lines) {
          const updatedLines = salesOrder.lines.map(soLine => {
            const matchLine = delivery.lines.find(dl => dl.salesOrderLineId === soLine.id);
            const subQty = matchLine ? Number(matchLine.deliveredQuantity) : 0;
            const newDelivered = Math.max(0, (Number(soLine.deliveredQty) || 0) - subQty);
            return {
              ...soLine,
              deliveredQty: newDelivered
            };
          });

          storageService.update('salesOrders', salesOrder.id, {
            lines: updatedLines,
            status: 'Partially Delivered'
          });
        }
      }
    }

    return storageService.update('deliveries', delivery.id, {
      status: 'Cancelled',
      cancelledBy: userId,
      cancelledAt: new Date().toISOString()
    });
  }
}

export const deliveryService = new DeliveryService();
