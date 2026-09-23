/**
 * JS Traders ERP - Generic Stock Inward Order Management Service
 * Warehouse-only operational receipt demand document.
 * 
 * Core Design Principles:
 * 1. Represents stock expected to enter the warehouse.
 * 2. Does NOT increase physical warehouse stock (Stock Inward Order ≠ Stock Movement).
 * 3. Physical stock is ONLY increased when a GRN / Gatepass Inward is approved.
 * 4. Independently tracks Expected Qty, Received Qty, and Remaining Qty per line.
 * 5. Supports multiple partial GRNs against a single Stock Inward Order.
 * 6. Decoupled architecture: supports optional source_type (PURCHASE, SALES_RETURN, etc.)
 *    for future main ERP integration without forcing accounting concepts now.
 */

import { storageService } from './storageService.js';
import { productService } from './productService.js';

class InwardOrderService {
  getInwardOrders() {
    const list = storageService.getCollection('stockInwardOrders') || [];
    return [...list].sort((a, b) => {
      const numA = parseInt((a.orderNumber || '').replace(/\D/g, ''), 10) || 0;
      const numB = parseInt((b.orderNumber || '').replace(/\D/g, ''), 10) || 0;
      if (numB !== numA) return numB - numA;
      return new Date(b.createdAt || b.date || 0) - new Date(a.createdAt || a.date || 0);
    });
  }

  getInwardOrderById(id) {
    return storageService.getById('stockInwardOrders', id);
  }

  createInwardOrder({
    partyName = 'Generic Supplier / Origin',
    referenceNumber = '',
    vehicleNumber = '',
    driverName = '',
    driverPhone = '',
    assignedStaffIds = [],
    date = new Date().toISOString().split('T')[0],
    expectedArrivalDate = '',
    targetWarehouseId = 'wh-1',
    status = 'Confirmed', // Draft, Confirmed, Partially Received, Fully Received, Cancelled
    source_type = null,   // Optional: 'PURCHASE', 'SALES_RETURN', 'TRANSFER', 'STOCK_ADJUSTMENT', 'OTHER'
    source_id = null,     // Optional: linked document ID for future ERP integration
    lines = [],           // Array of { variantId, expectedQty, unit, notes }
    notes = '',
    userId = 'user-wh-mgr'
  } = {}) {
    const allExisting = storageService.getCollection('stockInwardOrders') || [];
    let maxNum = 0;
    allExisting.forEach(o => {
      const match = (o.orderNumber || '').match(/\d+/);
      if (match) {
        const val = parseInt(match[0], 10);
        if (val > maxNum) maxNum = val;
      }
    });
    const orderNumber = `SIO-${String(maxNum + 1).padStart(5, '0')}`;

    const formattedLines = lines.map((l, idx) => {
      const expQty = Number(l.expectedQty) || 0;
      const variant = productService.getVariantById(l.variantId) || {};
      return {
        id: `siol-${Date.now()}-${idx}`,
        variantId: l.variantId,
        warehouseQty: Number(l.warehouseQty) || 0,
        officeQty: Number(l.officeQty) || 0,
        expectedQty: expQty,
        receivedQty: 0,
        remainingQty: expQty,
        pendingQty: expQty,
        unit: l.unit || variant.unit || 'PCS',
        isRoll: Boolean(l.isRoll),
        rollSize: l.rollSize || null,
        packagingName: l.packagingName || null,
        totalFeet: l.totalFeet || null,
        notes: l.notes || ''
      };
    });

    const totalExpected = formattedLines.reduce((sum, l) => sum + l.expectedQty, 0);
    const initialStatus = status === 'Draft' ? 'Draft' : (totalExpected > 0 ? 'Confirmed' : 'Draft');

    return storageService.insert('stockInwardOrders', {
      orderNumber,
      partyName: partyName.trim(),
      referenceNumber: referenceNumber.trim(),
      vehicleNumber: vehicleNumber.trim(),
      driverName: driverName.trim(),
      driverPhone: driverPhone.trim(),
      assignedStaffIds,
      date,
      expectedArrivalDate: expectedArrivalDate || date,
      targetWarehouseId,
      status: initialStatus,
      source_type,
      source_id,
      grnIds: [],
      notes: notes.trim(),
      lines: formattedLines,
      createdBy: userId,
      createdAt: new Date().toISOString()
    });
  }

  updateInwardOrder(orderId, updateData) {
    const order = this.getInwardOrderById(orderId);
    if (!order) throw new Error('Stock Inward Order not found.');

    const updated = storageService.update('stockInwardOrders', orderId, {
      ...updateData,
      updatedAt: new Date().toISOString()
    });
    return updated;
  }

  // Returns remaining expected lines that still need receiving
  getRemainingExpectedLines(inwardOrderId) {
    const order = this.getInwardOrderById(inwardOrderId);
    if (!order) throw new Error(`Stock Inward Order "${inwardOrderId}" not found.`);

    return (order.lines || [])
      .map(line => {
        const exp = Number(line.expectedQty) || 0;
        const rec = Number(line.receivedQty) || 0;
        const remaining = Math.max(0, exp - rec);
        return {
          ...line,
          remainingQty: remaining,
          pendingQty: remaining
        };
      })
      .filter(l => l.remainingQty > 0);
  }

  getPendingExpectedLines(inwardOrderId) {
    return this.getRemainingExpectedLines(inwardOrderId);
  }

  // Called when a GRN is posted/approved to increment received quantities
  recordReceiptProgress(inwardOrderId, grnId, receivedItems = []) {
    const order = this.getInwardOrderById(inwardOrderId);
    if (!order) throw new Error(`Stock Inward Order "${inwardOrderId}" not found.`);

    const receivedMap = new Map();
    receivedItems.forEach(item => {
      const q = Number(item.quantity !== undefined ? item.quantity : (Number(item.warehouseQty || 0) + Number(item.officeQty || 0))) || 0;
      if (item.variantId) {
        receivedMap.set(item.variantId, (receivedMap.get(item.variantId) || 0) + q);
      }
    });

    let totalExpected = 0;
    let totalReceived = 0;

    const updatedLines = (order.lines || []).map(line => {
      const addQty = receivedMap.get(line.variantId) || 0;
      const newRec = (Number(line.receivedQty) || 0) + addQty;
      const exp = Number(line.expectedQty) || 0;
      totalExpected += exp;
      totalReceived += newRec;
      return {
        ...line,
        receivedQty: newRec,
        remainingQty: Math.max(0, exp - newRec),
        pendingQty: Math.max(0, exp - newRec)
      };
    });

    // Update status based on total receipt progress
    let newStatus = order.status;
    if (totalReceived >= totalExpected && totalExpected > 0) {
      newStatus = 'Fully Received';
    } else if (totalReceived > 0) {
      newStatus = 'Partially Received';
    } else {
      newStatus = order.status === 'Draft' ? 'Draft' : 'Confirmed';
    }

    const currentGrnIds = order.grnIds || [];
    const newGrnIds = grnId && !currentGrnIds.includes(grnId) ? [...currentGrnIds, grnId] : currentGrnIds;

    return storageService.update('stockInwardOrders', inwardOrderId, {
      lines: updatedLines,
      status: newStatus,
      grnIds: newGrnIds,
      updatedAt: new Date().toISOString()
    });
  }

  // Called when a GRN is voided/reversed to roll back received quantities
  revertReceiptProgress(inwardOrderId, grnId, reversedItems = []) {
    const order = this.getInwardOrderById(inwardOrderId);
    if (!order) return null;

    const reversedMap = new Map();
    reversedItems.forEach(item => {
      const q = Number(item.quantity !== undefined ? item.quantity : (Number(item.warehouseQty || 0) + Number(item.officeQty || 0))) || 0;
      if (item.variantId) {
        reversedMap.set(item.variantId, (reversedMap.get(item.variantId) || 0) + q);
      }
    });

    let totalExpected = 0;
    let totalReceived = 0;

    const updatedLines = (order.lines || []).map(line => {
      const subQty = reversedMap.get(line.variantId) || 0;
      const newRec = Math.max(0, (Number(line.receivedQty) || 0) - subQty);
      const exp = Number(line.expectedQty) || 0;
      totalExpected += exp;
      totalReceived += newRec;
      return {
        ...line,
        receivedQty: newRec,
        remainingQty: Math.max(0, exp - newRec),
        pendingQty: Math.max(0, exp - newRec)
      };
    });

    let newStatus = 'Confirmed';
    if (totalReceived >= totalExpected && totalExpected > 0) {
      newStatus = 'Fully Received';
    } else if (totalReceived > 0) {
      newStatus = 'Partially Received';
    }

    const currentGrnIds = (order.grnIds || []).filter(id => id !== grnId);

    return storageService.update('stockInwardOrders', inwardOrderId, {
      lines: updatedLines,
      status: newStatus,
      grnIds: currentGrnIds,
      updatedAt: new Date().toISOString()
    });
  }

  cancelInwardOrder(orderId) {
    const order = this.getInwardOrderById(orderId);
    if (!order) throw new Error('Stock Inward Order not found.');

    const hasReceived = (order.lines || []).some(l => (Number(l.receivedQty) || 0) > 0);
    if (hasReceived) {
      throw new Error('Cannot cancel a Stock Inward Order that already has received goods. Void the linked GRNs first.');
    }

    return storageService.update('stockInwardOrders', orderId, {
      status: 'Cancelled',
      updatedAt: new Date().toISOString()
    });
  }
}

export const inwardOrderService = new InwardOrderService();
