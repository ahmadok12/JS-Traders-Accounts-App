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

  // --- SALES ORDERS ---
  getSalesOrders() {
    return storageService.getCollection('salesOrders');
  }

  getSalesOrderById(id) {
    return storageService.getById('salesOrders', id);
  }

  createSalesOrder(orderData) {
    const orders = this.getSalesOrders();
    const orderNumber = `SO-${String(orders.length + 1).padStart(5, '0')}`;

    let subtotal = 0;
    const lines = (orderData.lines || []).map((l, idx) => {
      const qty = Number(l.orderedQty) || 0;
      const price = Number(l.unitPrice) || 0;
      const lineTotal = qty * price;
      subtotal += lineTotal;
      return {
        id: `sol-${Date.now()}-${idx}`,
        variantId: l.variantId,
        orderedQty: qty,
        deliveredQty: 0,
        unit: l.unit || 'PCS',
        unitPrice: price,
        lineTotal
      };
    });

    const discount = Number(orderData.discount) || 0;
    const tax = Number(orderData.tax) || 0;
    const total = subtotal - discount + tax;

    return storageService.insert('salesOrders', {
      ...orderData,
      orderNumber,
      subtotal,
      discount,
      tax,
      total,
      status: 'Confirmed',
      lines
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
