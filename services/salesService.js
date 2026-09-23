/**
 * JS Traders ERP - Sales & Customer Management Service
 * Supports Customer Hierarchy (Owner -> Farm -> Deal), Quotations, Sales Orders,
 * Sales Invoices (which NEVER touch inventory), and Last Applied Customer Rate lookup.
 */

import { storageService } from './storageService.js';
import { productService } from './productService.js';

class SalesService {
  // --- PARTIES & CUSTOMERS ---
  getParties(customerOnly = false, supplierOnly = false) {
    let parties = storageService.getCollection('parties');
    if (customerOnly) parties = parties.filter(p => p.isCustomer);
    if (supplierOnly) parties = parties.filter(p => p.isSupplier);
    return parties;
  }

  getPartyById(id) {
    return storageService.getById('parties', id);
  }

  createParty(data) {
    const parties = storageService.getCollection('parties');
    const code = `PTY-${String(parties.length + 1).padStart(5, '0')}`;
    return storageService.insert('parties', {
      ...data,
      code,
      isActive: data.isActive !== undefined ? data.isActive : true
    });
  }

  // --- FARMS & DEALS ---
  getFarmsByCustomer(customerId) {
    return storageService.getCollection('customerFarms').filter(f => f.customerPartyId === customerId);
  }

  getDealsByFarm(farmId) {
    return storageService.getCollection('customerDeals').filter(d => d.farmId === farmId);
  }

  createFarm(customerId, farmData) {
    const farms = storageService.getCollection('customerFarms');
    const code = `FRM-${String(farms.length + 1).padStart(3, '0')}`;
    return storageService.insert('customerFarms', {
      ...farmData,
      customerPartyId: customerId,
      code
    });
  }

  createDeal(farmId, dealData) {
    const deals = storageService.getCollection('customerDeals');
    const code = `DEAL-${String(deals.length + 1).padStart(3, '0')}`;
    return storageService.insert('customerDeals', {
      ...dealData,
      farmId,
      code,
      status: 'Active'
    });
  }

  // --- LAST APPLIED CUSTOMER RATE ENGINE ---
  getLastCustomerRate(customerPartyId, variantId) {
    if (!customerPartyId || !variantId) return null;

    // Search historical invoices first
    const invoices = storageService.getCollection('salesInvoices')
      .filter(inv => inv.customerPartyId === customerPartyId)
      .sort((a, b) => new Date(b.date) - new Date(a.date));

    for (const inv of invoices) {
      const matchLine = (inv.lines || []).find(l => l.variantId === variantId);
      if (matchLine) {
        return {
          rate: Number(matchLine.unitPrice),
          date: inv.date,
          source: `Invoice ${inv.invoiceNumber}`
        };
      }
    }

    // Next search sales orders
    const orders = storageService.getCollection('salesOrders')
      .filter(so => so.customerPartyId === customerPartyId)
      .sort((a, b) => new Date(b.date) - new Date(a.date));

    for (const so of orders) {
      const matchLine = (so.lines || []).find(l => l.variantId === variantId);
      if (matchLine) {
        return {
          rate: Number(matchLine.unitPrice),
          date: so.date,
          source: `Order ${so.orderNumber}`
        };
      }
    }

    // Default to standard variant selling price
    const variant = productService.getVariantById(variantId);
    return variant ? { rate: Number(variant.sellingPrice) || 0, date: null, source: 'Catalog Standard Price' } : null;
  }

  // --- SALES ORDERS (Customer Requirements / Outgoing Demand - No stock movement) ---
  getSalesOrders() {
    const list = storageService.getCollection('salesOrders') || [];
    return [...list].sort((a, b) => {
      const numA = parseInt((a.orderNumber || '').replace(/\D/g, ''), 10) || 0;
      const numB = parseInt((b.orderNumber || '').replace(/\D/g, ''), 10) || 0;
      if (numB !== numA) return numB - numA;
      return new Date(b.createdAt || b.date || 0) - new Date(a.createdAt || a.date || 0);
    });
  }

  getSalesOrderById(id) {
    return storageService.getById('salesOrders', id);
  }

  createSalesOrder(orderData) {
    const orders = this.getSalesOrders();
    let maxNum = 0;
    orders.forEach(o => {
      const match = (o.orderNumber || '').match(/\d+/);
      if (match) {
        const val = parseInt(match[0], 10);
        if (val > maxNum) maxNum = val;
      }
    });
    const orderNumber = `SO-${String(maxNum + 1).padStart(5, '0')}`;

    let subtotal = 0;
    const lines = (orderData.lines || []).map((l, idx) => {
      const qty = Number(l.orderedQty !== undefined ? l.orderedQty : l.quantity) || 0;
      const price = Number(l.unitPrice) || 0;
      const lineTotal = qty * price;
      subtotal += lineTotal;
      const v = productService.getVariantById(l.variantId) || {};
      return {
        id: `sol-${Date.now()}-${idx}`,
        variantId: l.variantId,
        orderedQty: qty,
        deliveredQty: 0,
        pendingQty: qty,
        invoicedQty: 0,
        warehouseQty: Number(l.warehouseQty) || 0,
        officeQty: Number(l.officeQty) || 0,
        isRoll: Boolean(l.isRoll),
        rollSize: l.rollSize || null,
        packagingName: l.packagingName || null,
        totalFeet: l.totalFeet || null,
        unit: l.unit || v.unit || 'PCS',
        unitPrice: price,
        lineTotal,
        notes: l.notes || ''
      };
    });

    const discount = Number(orderData.discount) || 0;
    const tax = Number(orderData.tax) || 0;
    const total = subtotal - discount + tax;
    const totalOrdered = lines.reduce((sum, l) => sum + l.orderedQty, 0);
    const initialStatus = orderData.status === 'Draft' ? 'Draft' : (totalOrdered > 0 ? 'Confirmed' : 'Draft');

    return storageService.insert('salesOrders', {
      ...orderData,
      orderNumber,
      subtotal,
      discount,
      tax,
      total,
      status: initialStatus,
      gdnIds: [],
      lines,
      createdAt: new Date().toISOString()
    });
  }

  // Returns remaining undelivered lines on a Sales Order
  getRemainingDeliveryLines(salesOrderId) {
    const order = this.getSalesOrderById(salesOrderId);
    if (!order) throw new Error(`Sales Order "${salesOrderId}" not found.`);

    return (order.lines || [])
      .map(line => {
        const ord = Number(line.orderedQty) || 0;
        const del = Number(line.deliveredQty) || 0;
        const remaining = Math.max(0, ord - del);
        return {
          ...line,
          remainingDeliveryQty: remaining,
          pendingQty: remaining
        };
      })
      .filter(l => l.remainingDeliveryQty > 0);
  }

  getPendingDeliveryLines(salesOrderId) {
    return this.getRemainingDeliveryLines(salesOrderId);
  }

  // Called when a GDN / Gatepass Outward is posted/approved
  recordDeliveryProgress(salesOrderId, gdnId, deliveredItems = []) {
    const order = this.getSalesOrderById(salesOrderId);
    if (!order) throw new Error(`Sales Order "${salesOrderId}" not found.`);

    const deliveredMap = new Map();
    deliveredItems.forEach(item => {
      const q = Number(item.quantity !== undefined ? item.quantity : (Number(item.warehouseQty || 0) + Number(item.officeQty || 0))) || 0;
      if (item.variantId) {
        deliveredMap.set(item.variantId, (deliveredMap.get(item.variantId) || 0) + q);
      }
    });

    let totalOrdered = 0;
    let totalDelivered = 0;

    const updatedLines = (order.lines || []).map(line => {
      const addQty = deliveredMap.get(line.variantId) || 0;
      const newDel = (Number(line.deliveredQty) || 0) + addQty;
      const ord = Number(line.orderedQty) || 0;
      totalOrdered += ord;
      totalDelivered += newDel;
      return {
        ...line,
        deliveredQty: newDel
      };
    });

    // Update status based on total delivery progress
    let newStatus = order.status;
    if (totalDelivered >= totalOrdered && totalOrdered > 0) {
      newStatus = 'Fully Delivered';
    } else if (totalDelivered > 0) {
      newStatus = 'Partially Delivered';
    } else {
      newStatus = order.status === 'Draft' ? 'Draft' : 'Confirmed';
    }

    const currentGdnIds = order.gdnIds || [];
    const newGdnIds = gdnId && !currentGdnIds.includes(gdnId) ? [...currentGdnIds, gdnId] : currentGdnIds;

    return storageService.update('salesOrders', salesOrderId, {
      lines: updatedLines,
      status: newStatus,
      gdnIds: newGdnIds,
      updatedAt: new Date().toISOString()
    });
  }

  // Called when a GDN is voided/reversed
  revertDeliveryProgress(salesOrderId, gdnId, reversedItems = []) {
    const order = this.getSalesOrderById(salesOrderId);
    if (!order) return null;

    const reversedMap = new Map();
    reversedItems.forEach(item => {
      const q = Number(item.quantity !== undefined ? item.quantity : (Number(item.warehouseQty || 0) + Number(item.officeQty || 0))) || 0;
      if (item.variantId) {
        reversedMap.set(item.variantId, (reversedMap.get(item.variantId) || 0) + q);
      }
    });

    let totalOrdered = 0;
    let totalDelivered = 0;

    const updatedLines = (order.lines || []).map(line => {
      const subQty = reversedMap.get(line.variantId) || 0;
      const newDel = Math.max(0, (Number(line.deliveredQty) || 0) - subQty);
      const ord = Number(line.orderedQty) || 0;
      totalOrdered += ord;
      totalDelivered += newDel;
      return {
        ...line,
        deliveredQty: newDel
      };
    });

    let newStatus = 'Confirmed';
    if (totalDelivered >= totalOrdered && totalOrdered > 0) {
      newStatus = 'Fully Delivered';
    } else if (totalDelivered > 0) {
      newStatus = 'Partially Delivered';
    }

    const currentGdnIds = (order.gdnIds || []).filter(id => id !== gdnId);

    return storageService.update('salesOrders', salesOrderId, {
      lines: updatedLines,
      status: newStatus,
      gdnIds: currentGdnIds,
      updatedAt: new Date().toISOString()
    });
  }

  // Future-proof invoicing: increments invoicedQty independently of delivery
  recordInvoiceProgress(salesOrderId, invoiceId, invoicedItems = []) {
    const order = this.getSalesOrderById(salesOrderId);
    if (!order) return null;

    const invoicedMap = new Map();
    invoicedItems.forEach(item => {
      const q = Number(item.quantity) || 0;
      if (item.variantId) {
        invoicedMap.set(item.variantId, (invoicedMap.get(item.variantId) || 0) + q);
      }
    });

    const updatedLines = (order.lines || []).map(line => {
      const addQty = invoicedMap.get(line.variantId) || 0;
      const newInv = (Number(line.invoicedQty) || 0) + addQty;
      return {
        ...line,
        invoicedQty: newInv
      };
    });

    const currentInvIds = order.invoiceIds || [];
    const newInvIds = invoiceId && !currentInvIds.includes(invoiceId) ? [...currentInvIds, invoiceId] : currentInvIds;

    return storageService.update('salesOrders', salesOrderId, {
      lines: updatedLines,
      invoiceIds: newInvIds,
      updatedAt: new Date().toISOString()
    });
  }

  cancelSalesOrder(orderId) {
    const order = this.getSalesOrderById(orderId);
    if (!order) throw new Error('Sales Order not found.');

    const hasDelivered = (order.lines || []).some(l => (Number(l.deliveredQty) || 0) > 0);
    if (hasDelivered) {
      throw new Error('Cannot cancel a Sales Order that already has delivered goods. Void the linked GDNs first.');
    }

    return storageService.update('salesOrders', orderId, {
      status: 'Cancelled',
      updatedAt: new Date().toISOString()
    });
  }

  // --- SALES INVOICES (Never touches inventory) ---
  getSalesInvoices() {
    return storageService.getCollection('salesInvoices');
  }

  getSalesInvoiceById(id) {
    return storageService.getById('salesInvoices', id);
  }

  createSalesInvoice(invoiceData) {
    const invoices = this.getSalesInvoices();
    const invoiceNumber = `INV-${String(invoices.length + 1).padStart(5, '0')}`;

    let subtotal = 0;
    const lines = (invoiceData.lines || []).map(l => {
      const qty = Number(l.quantity) || 0;
      const price = Number(l.unitPrice) || 0;
      const lineTotal = qty * price;
      subtotal += lineTotal;
      return {
        variantId: l.variantId || null,
        bundleId: l.bundleId || null,
        bundleName: l.bundleName || null,
        isBundle: Boolean(l.isBundle || l.bundleId),
        bundleType: l.bundleType || null,
        bundleQuantity: l.isBundle || l.bundleId ? qty : null,
        bundleComponents: l.bundleComponents || null,
        quantity: qty,
        unitPrice: price,
        lineTotal,
        unit: l.unit || 'PCS'
      };
    });

    const discount = Number(invoiceData.discount) || 0;
    const tax = Number(invoiceData.tax) || 0;
    const total = subtotal - discount + tax;

    const invoice = storageService.insert('salesInvoices', {
      ...invoiceData,
      invoiceNumber,
      subtotal,
      discount,
      tax,
      total,
      paidAmount: 0,
      status: 'Confirmed'
    });

    return invoice;
  }
}

export const salesService = new SalesService();
