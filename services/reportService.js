/**
 * JS Traders ERP - Centralized Reporting & Report Builder Engine
 * Provides standard stock & operational reports and dynamic Report Builder metadata.
 */

import { inventoryService } from './inventoryService.js';
import { productService } from './productService.js';
import { storageService } from './storageService.js';
import { authService } from './authService.js';

class ReportService {
  // Standard Stock Report
  getCurrentStockReport(warehouseFilter = null) {
    const balances = inventoryService.getAllBalances(warehouseFilter);
    const canViewCost = authService.canViewCostProfit();

    return balances.map(item => ({
      warehouse: item.warehouse.name || 'Unassigned',
      productName: item.product.customerName || item.product.businessName,
      businessCode: item.product.businessName,
      variantName: item.variant.name,
      sku: item.variant.sku,
      quantity: item.quantity,
      unit: item.unit,
      averageCost: canViewCost ? item.averageCost : null,
      stockValue: canViewCost ? item.stockValue : null,
      isLowStock: item.isLowStock,
      isNegative: item.isNegative,
      attributes: item.variant.attributes || {}
    }));
  }

  // Stock Grouped by Dynamic Attribute (e.g. Origin: China vs Pakistan)
  getStockByAttributeReport(attributeName = 'Origin') {
    const stock = this.getCurrentStockReport();
    const groups = {};

    for (const item of stock) {
      const val = item.attributes[attributeName] || 'Unspecified';
      if (!groups[val]) {
        groups[val] = { count: 0, totalQty: 0, items: [] };
      }
      groups[val].count += 1;
      groups[val].totalQty += item.quantity;
      groups[val].items.push(item);
    }

    return groups;
  }

  // Stock Movement History
  getStockMovementReport() {
    const movements = storageService.getCollection('stockMovements');
    const warehouses = storageService.getCollection('warehouses');
    const variants = productService.getVariants();
    const whMap = new Map(warehouses.map(w => [w.id, w.name]));
    const varMap = new Map(variants.map(v => [v.id, v.name]));

    const flatRows = [];
    for (const m of movements) {
      for (const line of (m.lines || [])) {
        flatRows.push({
          movementNumber: m.movementNumber,
          date: m.date,
          type: m.movementType,
          warehouse: whMap.get(m.warehouseId) || m.warehouseId,
          variantName: varMap.get(line.variantId) || line.variantId,
          quantity: line.quantity,
          unit: line.unit,
          notes: line.notes || m.notes
        });
      }
    }
    return flatRows;
  }

  // Report Builder Definitions
  getAvailableReportModules() {
    return [
      { id: 'inventory', name: 'Inventory Stock & Ledger', fields: ['Warehouse', 'Product', 'Variant', 'SKU', 'Quantity', 'Unit', 'Value'] },
      { id: 'deliveries', name: 'Deliveries & Logistics', fields: ['Delivery #', 'Sales Order', 'Customer', 'Vehicle', 'Delivered Qty', 'Status'] },
      { id: 'sales', name: 'Sales & Invoicing', fields: ['Invoice #', 'Customer', 'Farm', 'Date', 'Total Amount', 'Status'] },
      { id: 'shipments', name: 'Import Shipments & Containers', fields: ['Shipment #', 'Supplier', 'Term', 'Container #', 'Landed Cost', 'Status'] }
    ];
  }
}

export const reportService = new ReportService();
