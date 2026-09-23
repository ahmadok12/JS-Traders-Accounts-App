/**
 * JS Traders ERP - Gatepass Management Service
 * Warehouse operational logistics document.
 * Supports:
 * 1. Dual-location inventory allocation (Warehouse vs Office)
 * 2. Multi-staff assignment & notification dispatch
 * 3. Mobile staff proof photo collection & compression tracking
 * 4. Warehouse Manager inspection & approval workflow
 */

import { storageService } from './storageService.js';
import { productService } from './productService.js';
import { inventoryService } from './inventoryService.js';
import { cutToLengthService } from './cutToLengthService.js';

class GatepassService {
  getGatepasses() {
    const list = storageService.getCollection('gatepasses') || [];
    return [...list].sort((a, b) => {
      const numA = parseInt((a.gatepassNumber || '').replace(/\D/g, ''), 10) || 0;
      const numB = parseInt((b.gatepassNumber || '').replace(/\D/g, ''), 10) || 0;
      if (numB !== numA) return numB - numA;
      return new Date(b.createdAt || b.date || 0) - new Date(a.createdAt || a.date || 0);
    });
  }

  getGatepassById(id) {
    return storageService.getById('gatepasses', id);
  }

  getGatepassesForStaff(staffId) {
    const all = this.getGatepasses();
    const users = storageService.getCollection('users') || [];
    const staff = users.find(u => u.id === staffId);
    const isOffice = staff && staff.staffType === 'office_staff';

    return all.filter(gp => {
      if (gp.status === 'Voided' || gp.status === 'Archived') return false;
      if (!(gp.assignedStaffIds || []).includes(staffId)) return false;
      // Staff only sees gatepass if their station has items to arrange
      return (gp.lines || []).some(l => {
        const qty = isOffice ? (Number(l.officeQty) || 0) : (Number(l.warehouseQty) || 0);
        return qty > 0;
      });
    });
  }

  // Create Gatepass from Sales Invoice with automatic bundle final component inheritance
  createGatepassFromInvoice(invoiceId, {
    warehouseId = 'wh-1',
    assignedStaffIds = [],
    vehicleNumber = '',
    driverName = '',
    driverPhone = '',
    notes = '',
    userId = 'user-wh-mgr'
  } = {}) {
    const invoice = storageService.getById('salesInvoices', invoiceId);
    if (!invoice) throw new Error(`Invoice "${invoiceId}" not found.`);

    const expandedLines = [];
    (invoice.lines || []).forEach(line => {
      if (line.isBundle && Array.isArray(line.bundleComponents) && line.bundleComponents.length > 0) {
        // Automatically inherit final component quantities from invoice
        line.bundleComponents.forEach(comp => {
          const finalQ = Number(comp.finalQty !== undefined ? comp.finalQty : comp.calculatedQty) || 0;
          if (finalQ > 0) {
            expandedLines.push({
              variantId: comp.componentVariantId,
              warehouseQty: warehouseId === 'wh-1' ? finalQ : 0,
              officeQty: warehouseId === 'wh-2' ? finalQ : 0,
              quantity: finalQ,
              unit: comp.unit || 'PCS',
              bundleRef: line.bundleName || 'Bundle System',
              notes: `Component from ${line.bundleName || 'Bundle'} (${comp.calculationText || ''})`
            });
          }
        });
      } else if (line.variantId) {
        const q = Number(line.quantity) || 0;
        expandedLines.push({
          variantId: line.variantId,
          warehouseQty: warehouseId === 'wh-1' ? q : 0,
          officeQty: warehouseId === 'wh-2' ? q : 0,
          quantity: q,
          unit: line.unit || 'PCS',
          negotiatedRate: line.unitPrice
        });
      }
    });

    return this.createGatepass({
      gatepassType: 'outward',
      salesOrderId: invoice.salesOrderId || null,
      deliveryId: invoice.deliveryId || null,
      customerPartyId: invoice.customerPartyId || null,
      farmId: invoice.farmId || null,
      vehicleNumber,
      driverName,
      driverPhone,
      assignedStaffIds,
      lines: expandedLines,
      notes: notes || `Created from Invoice ${invoice.invoiceNumber}. ${invoice.notes || ''}`,
      userId
    });
  }

  createGatepass({
    gatepassType = 'outward',
    salesOrderId = null,
    deliveryId = null,
    customerPartyId = null,
    customerName = null,
    farmId = null,
    assignedSalespersonId = null,
    assignedStaffIds = [],
    vehicleNumber = '',
    driverName = '',
    driverPhone = '',
    lines = [], // Array of { variantId, warehouseQty, officeQty, quantity, unit, negotiatedRate }
    notes = '',
    userId = 'user-wh-mgr'
  }) {
    const allExisting = storageService.getCollection('gatepasses') || [];
    let maxNum = 0;
    allExisting.forEach(gp => {
      const match = (gp.gatepassNumber || '').match(/\d+/);
      if (match) {
        const val = parseInt(match[0], 10);
        if (val > maxNum) maxNum = val;
      }
    });
    const gatepassNumber = `GP-${String(maxNum + 1).padStart(5, '0')}`;

    // Flatten any bundle components if passed directly
    const flattenedInputLines = [];
    lines.forEach(l => {
      if (l.bundleComponents && Array.isArray(l.bundleComponents)) {
        l.bundleComponents.forEach(comp => {
          const finalQ = Number(comp.finalQty !== undefined ? comp.finalQty : comp.calculatedQty) || 0;
          flattenedInputLines.push({
            variantId: comp.componentVariantId,
            warehouseQty: l.warehouseQty !== undefined ? (l.warehouseQty > 0 ? finalQ : 0) : finalQ,
            officeQty: l.officeQty !== undefined ? (l.officeQty > 0 ? finalQ : 0) : 0,
            quantity: finalQ,
            unit: comp.unit || 'PCS',
            bundleRef: l.bundleName || 'Bundle'
          });
        });
      } else {
        flattenedInputLines.push(l);
      }
    });

    let totalWhQty = 0;
    let totalOffQty = 0;

    const formattedLines = flattenedInputLines.map(l => {
      const wQty = Number(l.warehouseQty) || 0;
      const oQty = Number(l.officeQty) || 0;
      totalWhQty += wQty;
      totalOffQty += oQty;
      const total = (wQty + oQty) > 0 ? (wQty + oQty) : (Number(l.quantity) || 0);
      return {
        variantId: l.variantId,
        warehouseQty: wQty,
        officeQty: oQty,
        quantity: total,
        unit: l.unit || 'PCS',
        packagingName: l.packagingName || null,
        isRoll: Boolean(l.isRoll),
        rollSize: l.rollSize ? Number(l.rollSize) : null,
        totalFeet: l.totalFeet ? Number(l.totalFeet) : null,
        negotiatedRate: Number(l.negotiatedRate) || null,
        bundleRef: l.bundleRef || null
      };
    });

    const users = storageService.getCollection('users') || [];
    const userMap = new Map(users.map(u => [u.id, u]));

    // If inventory from warehouse or office is 0, don't assign that staff even if checked
    const validAssignedStaffIds = (assignedStaffIds || []).filter(staffId => {
      const staff = userMap.get(staffId);
      if (!staff) return false;
      const isOffice = staff.staffType === 'office_staff';
      return isOffice ? totalOffQty > 0 : totalWhQty > 0;
    });

    const status = validAssignedStaffIds.length > 0 ? 'Draft - Staff Assigned' : (assignedSalespersonId ? 'Rates Pending' : 'Draft');

    const gp = storageService.insert('gatepasses', {
      gatepassNumber,
      gatepassType,
      salesOrderId,
      deliveryId,
      customerPartyId,
      customerName: customerName || null,
      farmId,
      assignedSalespersonId,
      assignedStaffIds: validAssignedStaffIds,
      date: new Date().toISOString().split('T')[0],
      vehicleNumber,
      driverName,
      driverPhone,
      status,
      lines: formattedLines,
      staffProofs: [],
      notes,
      createdBy: userId,
      createdAt: new Date().toISOString()
    });

    // Generate notifications for assigned staff with items to fetch
    this._dispatchStaffNotifications(gp);

    return gp;
  }

  assignStaff(gatepassId, staffIds = []) {
    const gp = this.getGatepassById(gatepassId);
    if (!gp) throw new Error('Gatepass not found.');

    const users = storageService.getCollection('users') || [];
    const userMap = new Map(users.map(u => [u.id, u]));

    let totalWhQty = 0;
    let totalOffQty = 0;
    (gp.lines || []).forEach(l => {
      totalWhQty += (Number(l.warehouseQty) || 0);
      totalOffQty += (Number(l.officeQty) || 0);
    });

    // Only assign staff whose facility has quantity > 0
    const validAssignedStaffIds = (staffIds || []).filter(id => {
      const staff = userMap.get(id);
      if (!staff) return false;
      const isOffice = staff.staffType === 'office_staff';
      return isOffice ? totalOffQty > 0 : totalWhQty > 0;
    });

    const updated = storageService.update('gatepasses', gatepassId, {
      assignedStaffIds: validAssignedStaffIds,
      status: validAssignedStaffIds.length > 0 ? 'Draft - Staff Assigned' : gp.status,
      updatedAt: new Date().toISOString()
    });

    this._dispatchStaffNotifications(updated);
    return updated;
  }

  _dispatchStaffNotifications(gp) {
    if (!gp.assignedStaffIds || gp.assignedStaffIds.length === 0) return;

    const users = storageService.getCollection('users') || [];
    const userMap = new Map(users.map(u => [u.id, u]));
    const variants = productService.getVariants();
    const varMap = new Map(variants.map(v => [v.id, v]));
    const notifiedStaffIds = [];

    for (const staffId of gp.assignedStaffIds) {
      const staff = userMap.get(staffId);
      if (!staff) continue;

      const isOfficeStaff = staff.staffType === 'office_staff';
      const itemsToFetch = [];

      for (const line of (gp.lines || [])) {
        const v = varMap.get(line.variantId);
        const name = v ? v.name : 'Equipment Item';
        const qty = isOfficeStaff ? (Number(line.officeQty) || 0) : (Number(line.warehouseQty) || 0);
        if (qty > 0) {
          const unitStr = line.packagingName || line.unit || 'PCS';
          const rollDetail = line.isRoll ? ` (${(qty * Number(line.rollSize)).toLocaleString()} ft)` : (line.unit === 'ft' ? ' [Loose Cut]' : '');
          itemsToFetch.push(`${qty} ${unitStr}${rollDetail} ${name}`);
        }
      }

      // If inventory from warehouse or office is 0, don't notify that staff even if checkbox was checked
      if (itemsToFetch.length === 0) {
        continue;
      }

      const locationName = isOfficeStaff ? 'Office' : 'Warehouse';
      const summaryText = `Fetch from ${locationName}: ${itemsToFetch.join(', ')}`;

      storageService.insert('staffNotifications', {
        staffId,
        gatepassId: gp.id,
        gatepassNumber: gp.gatepassNumber,
        title: `Stock Fetch: ${gp.gatepassNumber} (${locationName})`,
        message: summaryText,
        location: locationName,
        isRead: false,
        createdAt: new Date().toISOString()
      });

      notifiedStaffIds.push(staffId);
    }

    if (notifiedStaffIds.length === 0) return;

    // Broadcast instant real-time alert to all open staff mobile apps (only for staff with items to fetch)
    const alertPayload = {
      type: 'STAFF_GATEPASS_ALERT',
      gatepassId: gp.id,
      gatepassNumber: gp.gatepassNumber,
      assignedStaffIds: notifiedStaffIds,
      timestamp: Date.now()
    };

    if (typeof BroadcastChannel !== 'undefined') {
      try {
        const bc = new BroadcastChannel('js_traders_staff_alerts');
        bc.postMessage(alertPayload);
        bc.close();
      } catch (e) {
        console.warn('BroadcastChannel error:', e);
      }
    }

    if (typeof localStorage !== 'undefined') {
      try {
        localStorage.setItem('js_staff_realtime_alert', JSON.stringify(alertPayload));
      } catch (e) {
        console.warn('localStorage alert trigger error:', e);
      }
    }
  }

  // Staff submits proof photos from mobile app
  submitStaffProof(gatepassId, staffId, photos = [], notes = '') {
    const gp = this.getGatepassById(gatepassId);
    if (!gp) throw new Error('Gatepass not found.');

    const users = storageService.getCollection('users');
    const staff = users.find(u => u.id === staffId) || { fullName: 'Warehouse Staff', staffType: 'warehouse_staff' };

    const proofEntry = {
      staffId,
      staffName: staff.fullName,
      staffType: staff.staffType || 'warehouse_staff',
      photos, // Array of { id, dataUrl, sizeKb, timestamp, filename }
      notes,
      submittedAt: new Date().toISOString()
    };

    const existingProofs = (gp.staffProofs || []).filter(p => p.staffId !== staffId);
    existingProofs.push(proofEntry);

    // Determine new status: if all assigned staff submitted, status is 'Staff Submitted'
    const assigned = gp.assignedStaffIds || [];
    const submittedStaffIds = new Set(existingProofs.map(p => p.staffId));
    const allSubmitted = assigned.length > 0 && assigned.every(id => submittedStaffIds.has(id));

    const newStatus = allSubmitted ? 'Staff Submitted - Ready for Approval' : 'Draft - Partially Submitted';

    const updated = storageService.update('gatepasses', gatepassId, {
      staffProofs: existingProofs,
      status: newStatus,
      updatedAt: new Date().toISOString()
    });

    // Notify Warehouse Manager
    storageService.insert('staffNotifications', {
      staffId: 'user-wh-mgr',
      gatepassId: gp.id,
      gatepassNumber: gp.gatepassNumber,
      title: `Staff Proof Submitted: ${gp.gatepassNumber}`,
      message: `${staff.fullName} uploaded ${photos.length} photo(s) for ${gp.gatepassNumber}.`,
      isRead: false,
      createdAt: new Date().toISOString()
    });

    return updated;
  }

  // Warehouse Manager reviews photos and approves gatepass
  approveGatepass(gatepassId, approvedByUserId = 'user-wh-mgr') {
    const gp = this.getGatepassById(gatepassId);
    if (!gp) throw new Error('Gatepass not found.');

    // Execute atomic outward stock movements for Warehouse & Office
    const warehouseLines = [];
    const officeLines = [];

    const variants = productService.getVariants();
    const varMap = new Map(variants.map(v => [v.id, v]));

    for (const line of gp.lines) {
      const v = varMap.get(line.variantId);
      const product = v ? productService.getProductById(v.productId) : null;
      const isCtl = Boolean(product && (product.cut_to_length || product.enableRollTracking));

      if (isCtl) {
        // Warehouse dispatch (wh-1)
        if (line.warehouseQty > 0) {
          const plan = cutToLengthService.planAllocation({
            productId: product.id,
            variantId: line.variantId,
            warehouseId: 'wh-1',
            requestedQty: line.warehouseQty,
            unit: line.packagingName || line.unit || 'ft',
            allowMultiPieces: true
          });
          if (plan && plan.canFulfill) {
            cutToLengthService.commitAllocation(plan, {
              referenceDocType: 'gatepass',
              referenceDocId: gp.id,
              userId: approvedByUserId,
              notes: `Outward dispatch approved on ${gp.gatepassNumber} (Warehouse)`
            });
          }
        }

        // Office dispatch (wh-2)
        if (line.officeQty > 0) {
          const plan = cutToLengthService.planAllocation({
            productId: product.id,
            variantId: line.variantId,
            warehouseId: 'wh-2',
            requestedQty: line.officeQty,
            unit: line.packagingName || line.unit || 'ft',
            allowMultiPieces: true
          });
          if (plan && plan.canFulfill) {
            cutToLengthService.commitAllocation(plan, {
              referenceDocType: 'gatepass',
              referenceDocId: gp.id,
              userId: approvedByUserId,
              notes: `Outward dispatch approved on ${gp.gatepassNumber} (Office)`
            });
          }
        }
      } else {
        // Standard piece-based product
        if (line.warehouseQty > 0) {
          warehouseLines.push({
            variantId: line.variantId,
            quantity: -Math.abs(line.warehouseQty),
            unitRate: line.negotiatedRate || 0,
            unit: line.unit,
            notes: `Gatepass Outward ${gp.gatepassNumber} (Warehouse)`
          });
        }
        if (line.officeQty > 0) {
          officeLines.push({
            variantId: line.variantId,
            quantity: -Math.abs(line.officeQty),
            unitRate: line.negotiatedRate || 0,
            unit: line.unit,
            notes: `Gatepass Outward ${gp.gatepassNumber} (Office)`
          });
        }
      }
    }

    // Post standard movements to Warehouse (wh-1)
    if (warehouseLines.length > 0) {
      inventoryService.postStockMovement({
        movementType: 'delivery',
        referenceDocType: 'gatepass',
        referenceDocId: gp.id,
        warehouseId: 'wh-1',
        lines: warehouseLines,
        notes: `Outward dispatch approved for ${gp.gatepassNumber}`,
        userId: approvedByUserId
      });
    }

    // Post standard movements to Office (wh-2)
    if (officeLines.length > 0) {
      inventoryService.postStockMovement({
        movementType: 'delivery',
        referenceDocType: 'gatepass',
        referenceDocId: gp.id,
        warehouseId: 'wh-2',
        lines: officeLines,
        notes: `Office stock dispatch approved for ${gp.gatepassNumber}`,
        userId: approvedByUserId
      });
    }

    return storageService.update('gatepasses', gatepassId, {
      status: 'Approved - Ready to Deliver',
      approvedBy: approvedByUserId,
      approvedAt: new Date().toISOString()
    });
  }

  // Salesperson updates negotiated rates on gatepass
  updateRates(gatepassId, lineRates, userId = 'user-sales') {
    const gp = this.getGatepassById(gatepassId);
    if (!gp) throw new Error('Gatepass not found.');

    const updatedLines = gp.lines.map((line, idx) => ({
      ...line,
      negotiatedRate: lineRates[idx] !== undefined ? Number(lineRates[idx]) : line.negotiatedRate
    }));

    return storageService.update('gatepasses', gp.id, {
      lines: updatedLines,
      status: 'Ready for Invoice',
      ratesEnteredBy: userId,
      ratesEnteredAt: new Date().toISOString()
    });
  }

  updateGatepass(gatepassId, updateData = {}) {
    const gp = this.getGatepassById(gatepassId);
    if (!gp) throw new Error('Gatepass not found.');

    const users = storageService.getCollection('users') || [];
    const userMap = new Map(users.map(u => [u.id, u]));

    // Format and calculate totals for lines if provided
    let formattedLines = gp.lines;
    let totalWhQty = 0;
    let totalOffQty = 0;

    if (updateData.lines) {
      formattedLines = updateData.lines.map(line => {
        const whQty = Number(line.warehouseQty) || 0;
        const offQty = Number(line.officeQty) || 0;
        const totalQty = whQty + offQty;
        totalWhQty += whQty;
        totalOffQty += offQty;
        return {
          variantId: line.variantId,
          warehouseQty: whQty,
          officeQty: offQty,
          quantity: totalQty,
          unit: line.unit || 'PCS',
          packagingName: line.packagingName || null,
          isRoll: Boolean(line.isRoll),
          rollSize: line.rollSize ? Number(line.rollSize) : null,
          totalFeet: line.totalFeet ? Number(line.totalFeet) : null,
          negotiatedRate: line.negotiatedRate || 0
        };
      });
    } else {
      (gp.lines || []).forEach(l => {
        totalWhQty += (Number(l.warehouseQty) || 0);
        totalOffQty += (Number(l.officeQty) || 0);
      });
    }

    // Filter assigned staff based on quantities
    let validAssignedStaffIds = gp.assignedStaffIds || [];
    if (updateData.assignedStaffIds) {
      validAssignedStaffIds = updateData.assignedStaffIds.filter(staffId => {
        const staff = userMap.get(staffId);
        if (!staff) return false;
        const isOffice = staff.staffType === 'office_staff';
        return isOffice ? totalOffQty > 0 : totalWhQty > 0;
      });
    }

    const payload = {
      ...updateData,
      lines: formattedLines,
      assignedStaffIds: validAssignedStaffIds,
      updatedAt: new Date().toISOString()
    };

    const updated = storageService.update('gatepasses', gatepassId, payload);

    // Re-dispatch notifications to assigned staff
    this._dispatchStaffNotifications(updated);

    return updated;
  }

  voidGatepass(gatepassId, voidedByUserId = 'user-wh-mgr') {
    const gp = this.getGatepassById(gatepassId);
    if (!gp) throw new Error('Gatepass not found.');

    // Rollback any cut-to-length allocations made for this gatepass
    try {
      cutToLengthService.rollbackAllocation('gatepass', gp.id, voidedByUserId);
    } catch (e) {
      console.warn('Cut to length rollback error:', e);
    }

    const updated = storageService.update('gatepasses', gatepassId, {
      status: 'Voided',
      voidedBy: voidedByUserId,
      voidedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });

    return updated;
  }

  updateStatus(gatepassId, newStatus) {
    return storageService.update('gatepasses', gatepassId, {
      status: newStatus,
      updatedAt: new Date().toISOString()
    });
  }
}

export const gatepassService = new GatepassService();
