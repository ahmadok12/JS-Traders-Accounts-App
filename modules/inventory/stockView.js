/**
 * JS Traders ERP - Current Stock Balances & Warehouse Inventory View
 * - Dynamic columns for each warehouse (Warehouse, Office, and future facilities)
 * - SKU-level aggregation with individual warehouse breakdowns & total balance
 * - Live filtering by Search, Warehouse, and Stock Status (All, Low Stock, Negative)
 * - Rounded card theme dropdowns with interactive preview & filter synchronization
 * - Roll / Cut-to-length continuous balance breakdown
 * - Cost and valuation security modes
 */

import { inventoryService } from '../../services/inventoryService.js';
import { productService } from '../../services/productService.js';
import { warehouseService } from '../../services/warehouseService.js';
import { cutToLengthService } from '../../services/cutToLengthService.js';
import { authService } from '../../services/authService.js';
import { renderTable } from '../../components/table.js';
import { renderFilterBar } from '../../components/filters.js';
import { openModal, closeModal } from '../../components/modal.js';
import { toast } from '../../components/toast.js';

let currentSearch = '';
let currentWarehouseFilter = 'all';
let currentStatusFilter = 'all';

/**
 * Builds consolidated SKU rows with separate balances per warehouse
 */
function getConsolidatedStockRows() {
  const warehouses = warehouseService.getWarehouses();
  const variants = productService.getVariants();
  const products = productService.getProducts();
  const prodMap = new Map(products.map(p => [p.id, p]));

  return variants.map(variant => {
    const parentProduct = prodMap.get(variant.productId) || {};
    const warehouseStock = {};
    let totalStock = 0;

    warehouses.forEach(w => {
      const qty = inventoryService.getBalance(w.id, variant.id);
      warehouseStock[w.id] = qty;
      totalStock += qty;
    });

    const lowStockLevel = parentProduct.lowStockLevel !== undefined ? Number(parentProduct.lowStockLevel) : 10;
    const isLowStock = totalStock <= lowStockLevel;
    const isNegative = totalStock < 0 || Object.values(warehouseStock).some(q => q < 0);
    const unit = variant.unit || parentProduct.base_unit || 'PCS';
    const averageCost = Number(variant.costPrice) || 0;
    const stockValue = totalStock * averageCost;

    return {
      id: variant.id,
      variant,
      product: parentProduct,
      warehouseStock,
      totalStock,
      unit,
      isLowStock,
      isNegative,
      lowStockLevel,
      averageCost,
      stockValue
    };
  });
}

/**
 * Dynamically builds table columns based on available warehouses
 */
function buildStockColumns(warehouses, canViewCost) {
  const columns = [
    {
      key: 'product',
      label: 'Product / Variant',
      render: row => `
        <div>
          <div class="font-bold text-slate-800">${row.variant?.name || 'Unknown Variant'}</div>
          <div class="text-[10px] text-slate-400">Master: ${row.product?.businessName || ''} (${row.product?.customerName || ''})</div>
          ${row.product?.urduName ? `<div class="text-[10px] font-serif text-slate-500 font-bold" dir="rtl">${row.product.urduName}</div>` : ''}
        </div>
      `
    },
    {
      key: 'sku',
      label: 'SKU',
      render: row => `<span class="font-bold text-[#138FCB] font-mono">${row.variant?.sku || '-'}</span>`
    }
  ];

  // Separate Column for each warehouse (Warehouse, Office, and future warehouses dynamically)
  warehouses.forEach(w => {
    columns.push({
      key: `wh_${w.id}`,
      label: `${w.name}`,
      align: 'right',
      render: row => {
        const qty = row.warehouseStock[w.id] || 0;
        if (qty > 0) {
          return `
            <div class="text-right">
              <span class="font-bold text-slate-800 font-mono">${qty.toLocaleString()}</span>
              <span class="text-[10px] text-slate-400 font-medium ml-0.5">${row.unit}</span>
            </div>
          `;
        }
        if (qty < 0) {
          return `
            <div class="text-right">
              <span class="font-bold text-rose-600 font-mono bg-rose-50 px-1.5 py-0.5 rounded border border-rose-200">${qty.toLocaleString()}</span>
              <span class="text-[10px] text-rose-500 font-medium ml-0.5">${row.unit}</span>
            </div>
          `;
        }
        return `<div class="text-right text-slate-300 font-mono text-xs">0</div>`;
      }
    });
  });

  // Total Available Stock
  columns.push({
    key: 'totalStock',
    label: 'Total Balance',
    align: 'right',
    render: row => {
      if (row.product?.cut_to_length) {
        const ctlSummary = cutToLengthService.getSummary(row.product.id, null, row.variant.id);
        if (ctlSummary) {
          return `
            <div class="text-right">
              <div class="text-xs font-black text-slate-900 font-mono">
                ${Number(ctlSummary.totalFootage).toLocaleString()} ${ctlSummary.baseUnit}
              </div>
              <div class="text-[10px] text-slate-400 font-medium flex items-center justify-end gap-1 mt-0.5">
                <span>${ctlSummary.fullRollsCount} rolls + ${Number(ctlSummary.loosePiecesFootage).toLocaleString()} ${ctlSummary.baseUnit}</span>
                <a href="#/inventory-rolls" class="text-[#138FCB] hover:underline font-bold ml-1">Rolls →</a>
              </div>
            </div>
          `;
        }
      }

      const isNeg = row.isNegative;
      const isLow = row.isLowStock;
      return `
        <div class="flex items-center justify-end gap-1.5">
          <span class="text-sm font-extrabold font-mono ${isNeg ? 'text-rose-600' : isLow ? 'text-amber-600' : 'text-slate-900'}">
            ${Number(row.totalStock).toLocaleString()}
          </span>
          <span class="text-[10px] text-slate-400 font-semibold uppercase">${row.unit}</span>
        </div>
      `;
    }
  });

  // Stock Status Indicator
  columns.push({
    key: 'status',
    label: 'Status',
    align: 'center',
    render: row => {
      if (row.isNegative) {
        return '<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-50 text-rose-700 border border-rose-200">Negative Stock</span>';
      }
      if (row.isLowStock) {
        return `<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-50 text-amber-700 border border-amber-200" title="Low stock alert threshold: ${row.lowStockLevel}">Low (${row.lowStockLevel})</span>`;
      }
      return '<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">In Stock</span>';
    }
  });

  // Cost and Valuation Columns (Financial Security Gated)
  if (canViewCost) {
    columns.push(
      {
        key: 'averageCost',
        label: 'Moving Avg Cost',
        align: 'right',
        render: row => `<span class="font-semibold text-slate-600 font-mono">Rs. ${Math.round(Number(row.averageCost || 0)).toLocaleString()}</span>`
      },
      {
        key: 'stockValue',
        label: 'Total Stock Valuation',
        align: 'right',
        render: row => `<span class="font-bold text-slate-900 font-mono">Rs. ${Math.round(Number(row.stockValue || 0)).toLocaleString()}</span>`
      }
    );
  }

  return columns;
}

/**
 * Filter rows by search, warehouse, and stock status
 */
function getFilteredStockRows(allRows) {
  return allRows.filter(row => {
    // 1. Text Search
    if (currentSearch) {
      const inSku = row.variant?.sku?.toLowerCase().includes(currentSearch);
      const inName = row.variant?.name?.toLowerCase().includes(currentSearch);
      const inBiz = row.product?.businessName?.toLowerCase().includes(currentSearch);
      const inCust = row.product?.customerName?.toLowerCase().includes(currentSearch);
      const inUrdu = row.product?.urduName && row.product.urduName.includes(currentSearch);
      if (!inSku && !inName && !inBiz && !inCust && !inUrdu) return false;
    }

    // 2. Warehouse Filter
    if (currentWarehouseFilter !== 'all') {
      const qty = row.warehouseStock[currentWarehouseFilter];
      if (qty === undefined || qty === null || qty === 0) return false;
    }

    // 3. Stock Status Filter
    if (currentStatusFilter === 'low') {
      if (!row.isLowStock) return false;
    } else if (currentStatusFilter === 'negative') {
      if (!row.isNegative) return false;
    }

    return true;
  });
}

export function renderStockView() {
  const warehouses = warehouseService.getWarehouses();
  const allRows = getConsolidatedStockRows();
  const filteredRows = getFilteredStockRows(allRows);
  const canViewCost = authService.canViewCostProfit();

  const filterBarHtml = renderFilterBar({
    searchPlaceholder: 'Search stock by SKU, variant name, or product...',
    searchValue: currentSearch,
    dropdowns: [
      {
        id: 'stock-warehouse-filter',
        label: 'Warehouse',
        value: currentWarehouseFilter,
        options: [
          { value: 'all', label: 'All Warehouses' },
          ...warehouses.map(w => ({ value: w.id, label: w.name }))
        ]
      },
      {
        id: 'stock-status-filter',
        label: 'Stock Status',
        value: currentStatusFilter,
        options: [
          { value: 'all', label: 'All Stock Levels' },
          { value: 'low', label: 'Low Stock Alerts' },
          { value: 'negative', label: 'Negative Stock' }
        ]
      }
    ],
    primaryAction: { label: 'Receive Opening Stock' }
  });

  const columns = buildStockColumns(warehouses, canViewCost);
  const tableHtml = renderTable({
    columns,
    data: filteredRows,
    emptyMessage: currentStatusFilter === 'low'
      ? 'No low stock alerts found. All inventory is above minimum threshold levels.'
      : currentStatusFilter === 'negative'
      ? 'No negative stock balances found.'
      : 'No stock recorded in selected warehouse or filter.'
  });

  return `
    <div id="stock-view-container" class="space-y-4 animate-in fade-in duration-150">
      ${!canViewCost ? `
        <div class="bg-amber-50 border border-amber-200 text-amber-800 px-4 py-2.5 rounded-xl text-xs flex items-center justify-between">
          <div class="flex items-center gap-2">
            <span>🛡</span>
            <span>Financial security mode active for role <strong>${authService.getRoleDisplayName(authService.getRole())}</strong>. Cost and valuation figures are strictly hidden.</span>
          </div>
        </div>
      ` : ''}

      ${filterBarHtml}

      <div id="stock-table-container">
        ${tableHtml}
      </div>
    </div>
  `;
}

export function bindStockEvents(container, refreshCallback) {
  const addBtn = container.querySelector('#filter-primary-btn');
  if (addBtn) {
    addBtn.onclick = () => openOpeningStockModal(() => {
      if (refreshCallback) refreshCallback();
      updateTable();
    });
  }

  const updateTable = () => {
    const allRows = getConsolidatedStockRows();
    const filtered = getFilteredStockRows(allRows);
    updateStockTable(container, filtered);
  };

  // Search input filter
  const searchInput = container.querySelector('#filter-search-input');
  if (searchInput) {
    searchInput.oninput = (e) => {
      currentSearch = e.target.value.toLowerCase().trim();
      updateTable();
    };
  }

  // Warehouse filter
  const whFilter = container.querySelector('#stock-warehouse-filter');
  if (whFilter) {
    whFilter.onchange = (e) => {
      currentWarehouseFilter = e.target.value;
      updateTable();
    };
  }

  // Stock status filter (Low Stock Alerts / Negative Stock / All Stock Levels)
  const statusFilter = container.querySelector('#stock-status-filter');
  if (statusFilter) {
    statusFilter.onchange = (e) => {
      currentStatusFilter = e.target.value;
      updateTable();
    };
  }
}

function updateStockTable(container, filteredData) {
  const tableContainer = container.querySelector('#stock-table-container');
  if (!tableContainer) return;

  const warehouses = warehouseService.getWarehouses();
  const canViewCost = authService.canViewCostProfit();
  const columns = buildStockColumns(warehouses, canViewCost);

  tableContainer.innerHTML = renderTable({
    columns,
    data: filteredData,
    emptyMessage: currentStatusFilter === 'low'
      ? 'No low stock alerts found. All inventory is above minimum threshold levels.'
      : currentStatusFilter === 'negative'
      ? 'No negative stock balances found.'
      : 'No stock recorded in selected warehouse or filter.'
  });
}

function openOpeningStockModal(onSaved) {
  const warehouses = warehouseService.getWarehouses();
  const variants = productService.getVariants();

  const contentHtml = `
    <form id="opening-stock-form" class="space-y-4 text-xs">
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label class="block font-bold text-slate-700 mb-1">Target Warehouse *</label>
          <select id="os-warehouse" required class="w-full border border-slate-200 rounded-xl px-3 py-2 text-slate-800 focus:outline-none focus:border-[#138FCB]">
            ${warehouses.map(w => `<option value="${w.id}">${w.name}</option>`).join('')}
          </select>
        </div>

        <div>
          <label class="block font-bold text-slate-700 mb-1">Product Variant / SKU *</label>
          <select id="os-variant" required class="w-full border border-slate-200 rounded-xl px-3 py-2 text-slate-800 focus:outline-none focus:border-[#138FCB]">
            ${variants.map(v => `<option value="${v.id}">${v.name} (${v.sku})</option>`).join('')}
          </select>
        </div>
      </div>

      <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label class="block font-bold text-slate-700 mb-1">Inward Quantity *</label>
          <input type="number" id="os-qty" required min="1" placeholder="e.g. 500" class="w-full border border-slate-200 rounded-xl px-3 py-2 text-slate-800 font-bold focus:outline-none focus:border-[#138FCB]">
        </div>

        <div>
          <label class="block font-bold text-slate-700 mb-1">Unit Inward Cost (PKR) *</label>
          <input type="number" id="os-rate" required min="0" placeholder="e.g. 950" class="w-full border border-slate-200 rounded-xl px-3 py-2 text-slate-800 focus:outline-none focus:border-[#138FCB]">
        </div>
      </div>

      <div>
        <label class="block font-bold text-slate-700 mb-1">Reference / Note</label>
        <input type="text" id="os-notes" placeholder="e.g. Container arrival or physical opening count" class="w-full border border-slate-200 rounded-xl px-3 py-2 text-slate-800 focus:outline-none focus:border-[#138FCB]">
      </div>

      <div class="p-3 bg-blue-50 border border-blue-100 rounded-xl text-[11px] text-blue-900">
        💡 <strong>Ledger Rule:</strong> Receiving stock creates an authoritative <strong>Stock Movement</strong> in the ledger and immediately increases the warehouse stock balance.
      </div>

      <div class="flex justify-end gap-3 pt-4 border-t border-slate-100">
        <button type="button" id="os-cancel-btn" class="px-4 py-2 text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-xl font-semibold transition-colors cursor-pointer">Cancel</button>
        <button type="submit" class="px-4 py-2 bg-[#138FCB] hover:bg-[#0E78AC] text-white rounded-xl font-semibold shadow-xs transition-colors cursor-pointer">Post Inward Stock</button>
      </div>
    </form>
  `;

  openModal({
    title: 'Receive Opening / Inward Stock',
    subtitle: 'Creates an authoritative stock movement transaction',
    contentHtml,
    size: 'max-w-xl',
    onOpen: (modalEl) => {
      const cancelBtn = modalEl.querySelector('#os-cancel-btn');
      if (cancelBtn) cancelBtn.onclick = () => closeModal();

      modalEl.querySelector('#opening-stock-form').onsubmit = (e) => {
        e.preventDefault();
        const warehouseId = modalEl.querySelector('#os-warehouse').value;
        const variantId = modalEl.querySelector('#os-variant').value;
        const quantity = Number(modalEl.querySelector('#os-qty').value) || 0;
        const unitRate = Number(modalEl.querySelector('#os-rate').value) || 0;
        const notes = modalEl.querySelector('#os-notes').value.trim();

        if (quantity <= 0) {
          toast.show('Quantity must be greater than zero.', 'warning');
          return;
        }

        try {
          inventoryService.postStockMovement({
            movementType: 'opening_balance',
            referenceDocType: 'manual_receipt',
            referenceDocId: null,
            warehouseId,
            lines: [
              {
                variantId,
                quantity,
                unitRate,
                unit: 'PCS',
                notes: notes || 'Opening stock transaction'
              }
            ],
            notes: notes || 'Manual stock inward receipt',
            userId: authService.getCurrentUser()?.id || 'admin'
          });

          toast.show(`Successfully posted ${quantity} units to inventory ledger.`, 'success');
          closeModal();
          if (onSaved) onSaved();
        } catch (err) {
          toast.show(err.message, 'error');
        }
      };
    }
  });
}
