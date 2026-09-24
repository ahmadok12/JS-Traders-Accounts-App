/**
 * JS Traders ERP - Stock Adjustments View
 * Redesigned to match high-fidelity ERP modal design language (media_1790166013548.png / Design/code 1.html).
 * Supports dual adjustment methods with real-time bi-directional synchronization:
 *   1. Delta / Quantity Change: (+/- e.g. +25 pcs, -30 pcs)
 *   2. Physical Count / Final Quantity: (e.g. Current 213 -> New 250 pcs, auto-calculates delta)
 */

import { inventoryService } from '../../services/inventoryService.js';
import { productService } from '../../services/productService.js';
import { warehouseService } from '../../services/warehouseService.js';
import { authService } from '../../services/authService.js';
import { renderTable } from '../../components/table.js';
import { renderFilterBar } from '../../components/filters.js';
import { openModal, closeModal } from '../../components/modal.js';
import { toast } from '../../components/toast.js';
import { renderSearchableDropdown, bindSearchableDropdown } from '../../components/searchableSelect.js';

export function renderStockAdjustmentsView() {
  const adjustments = inventoryService.getStockAdjustments() || [];
  const warehouses = warehouseService.getWarehouses() || [];
  const variants = productService.getVariants() || [];
  const whMap = new Map(warehouses.map(w => [w.id, w.name]));
  const varMap = new Map(variants.map(v => [v.id, v]));

  const filterBarHtml = renderFilterBar({
    searchPlaceholder: 'Search adjustments by number, reason, warehouse...',
    primaryAction: { label: '+ New Stock Adjustment' },
    filters: [
      {
        id: 'adj-filter-type',
        label: 'All Adjustment Types',
        options: [
          { value: 'all', label: 'All Types' },
          { value: 'increase', label: 'Stock Increase (+)' },
          { value: 'decrease', label: 'Stock Decrease (-)' },
          { value: 'reconciliation', label: 'Reconciliation / Audit' }
        ]
      },
      {
        id: 'adj-filter-warehouse',
        label: 'All Warehouses',
        options: [
          { value: 'all', label: 'All Warehouses' },
          ...warehouses.map(w => ({ value: w.id, label: w.name }))
        ]
      }
    ]
  });

  const columns = [
    {
      key: 'adjustmentNumber',
      label: 'Adjustment #',
      render: row => `
        <button class="view-adj-btn font-bold text-[#138FCB] hover:underline cursor-pointer flex items-center gap-1.5" data-id="${row.id}">
          <svg class="w-3.5 h-3.5 text-[#138FCB]" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path>
          </svg>
          ${row.adjustmentNumber}
        </button>
      `
    },
    {
      key: 'date',
      label: 'Date',
      render: row => `<span class="text-slate-600 font-medium text-xs">${row.date || '—'}</span>`
    },
    {
      key: 'warehouseId',
      label: 'Warehouse',
      render: row => `
        <span class="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold bg-slate-100 text-slate-700">
          <svg class="w-3 h-3 text-slate-500" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4"></path>
          </svg>
          ${whMap.get(row.warehouseId) || 'Main Warehouse'}
        </span>
      `
    },
    {
      key: 'type',
      label: 'Type',
      render: row => {
        if (row.type === 'increase') {
          return `<span class="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200/60">▲ Increase (+)</span>`;
        } else if (row.type === 'decrease') {
          return `<span class="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-rose-50 text-rose-700 border border-rose-200/60">▼ Decrease (-)</span>`;
        }
        return `<span class="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-blue-50 text-blue-700 border border-blue-200/60">◈ Reconciliation</span>`;
      }
    },
    {
      key: 'items',
      label: 'Adjusted Items',
      render: row => {
        const lines = row.lines || [];
        if (!lines.length) return `<span class="text-slate-400 text-xs">—</span>`;
        return `
          <div class="space-y-1 max-w-xs">
            ${lines.map(l => {
              const v = varMap.get(l.variantId);
              const name = v ? `${v.name}` : 'Item';
              const isPositive = Number(l.quantity) > 0;
              const isZero = Number(l.quantity) === 0;
              const sign = isPositive ? '+' : '';
              return `
                <div class="text-xs flex items-center justify-between gap-2">
                  <span class="text-slate-800 font-medium truncate">${name}</span>
                  <span class="font-mono font-bold ${isPositive ? 'text-emerald-600' : (isZero ? 'text-slate-500' : 'text-rose-600')} shrink-0">
                    ${sign}${l.quantity} ${l.unit || 'PCS'}
                  </span>
                </div>
              `;
            }).join('')}
          </div>
        `;
      }
    },
    {
      key: 'netVariance',
      label: 'Net Variance',
      render: row => {
        const lines = row.lines || [];
        const net = lines.reduce((acc, l) => acc + (Number(l.quantity) || 0), 0);
        const sign = net > 0 ? '+' : '';
        const colorClass = net > 0 ? 'text-emerald-700 bg-emerald-50 border-emerald-200' : (net < 0 ? 'text-rose-700 bg-rose-50 border-rose-200' : 'text-slate-700 bg-slate-100 border-slate-200');
        return `
          <span class="inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-mono font-bold border ${colorClass}">
            ${sign}${net} PCS
          </span>
        `;
      }
    },
    {
      key: 'reason',
      label: 'Audit Reason',
      render: row => `<span class="text-slate-600 text-xs italic">${row.reason || 'Physical Count Reconciliation'}</span>`
    },
    {
      key: 'status',
      label: 'Status',
      render: row => `
        <span class="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200/60">
          <svg class="w-3 h-3 text-emerald-600" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"></path>
          </svg>
          ${row.status || 'Confirmed'}
        </span>
      `
    },
    {
      key: 'actions',
      label: 'Action',
      render: row => `
        <button class="view-adj-btn px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold rounded-lg text-xs transition-colors cursor-pointer flex items-center gap-1.5" data-id="${row.id}">
          <svg class="w-3.5 h-3.5 text-slate-500" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"></path>
            <path stroke-linecap="round" stroke-linejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"></path>
          </svg>
          Inspect
        </button>
      `
    }
  ];

  const tableHtml = renderTable({
    columns,
    data: adjustments,
    emptyMessage: 'No stock adjustments recorded yet. Click "+ New Stock Adjustment" to record physical audit reconciliations.'
  });

  return `
    <div id="adjustments-view-container" class="space-y-5 animate-in fade-in duration-150">
      ${filterBarHtml}
      <div id="adjustments-table-container">
        ${tableHtml}
      </div>
    </div>
  `;
}

export function bindStockAdjustmentsEvents(container, refreshCallback) {
  // New Stock Adjustment Button
  const addBtn = container.querySelector('#filter-primary-btn');
  if (addBtn) {
    addBtn.onclick = () => openAdjustmentModal(refreshCallback);
  }

  // Row Inspection Buttons
  const viewBtns = container.querySelectorAll('.view-adj-btn');
  viewBtns.forEach(btn => {
    btn.onclick = () => {
      const id = btn.getAttribute('data-id');
      const adjustments = inventoryService.getStockAdjustments() || [];
      const adj = adjustments.find(a => a.id === id);
      if (adj) {
        openAdjustmentDetailsModal(adj);
      }
    };
  });

  // Filter Bar Handlers
  const searchInput = container.querySelector('#filter-search-input');
  const typeFilter = container.querySelector('#adj-filter-type');
  const whFilter = container.querySelector('#adj-filter-warehouse');

  const applyFilters = () => {
    const q = (searchInput ? searchInput.value : '').toLowerCase().trim();
    const typeVal = typeFilter ? typeFilter.value : 'all';
    const whVal = whFilter ? whFilter.value : 'all';

    const adjustments = inventoryService.getStockAdjustments() || [];
    const warehouses = warehouseService.getWarehouses() || [];
    const whMap = new Map(warehouses.map(w => [w.id, w.name]));

    const filtered = adjustments.filter(adj => {
      if (typeVal !== 'all' && adj.type !== typeVal) return false;
      if (whVal !== 'all' && adj.warehouseId !== whVal) return false;
      if (q) {
        const numMatch = (adj.adjustmentNumber || '').toLowerCase().includes(q);
        const reasonMatch = (adj.reason || '').toLowerCase().includes(q);
        const whMatch = (whMap.get(adj.warehouseId) || '').toLowerCase().includes(q);
        if (!numMatch && !reasonMatch && !whMatch) return false;
      }
      return true;
    });

    const tableContainer = container.querySelector('#adjustments-table-container');
    if (tableContainer) {
      // Re-render table with filtered data
      const variants = productService.getVariants() || [];
      const varMap = new Map(variants.map(v => [v.id, v]));
      const columns = [
        {
          key: 'adjustmentNumber',
          label: 'Adjustment #',
          render: row => `
            <button class="view-adj-btn font-bold text-[#138FCB] hover:underline cursor-pointer flex items-center gap-1.5" data-id="${row.id}">
              <svg class="w-3.5 h-3.5 text-[#138FCB]" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path>
              </svg>
              ${row.adjustmentNumber}
            </button>
          `
        },
        {
          key: 'date',
          label: 'Date',
          render: row => `<span class="text-slate-600 font-medium text-xs">${row.date || '—'}</span>`
        },
        {
          key: 'warehouseId',
          label: 'Warehouse',
          render: row => `
            <span class="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold bg-slate-100 text-slate-700">
              ${whMap.get(row.warehouseId) || 'Main Warehouse'}
            </span>
          `
        },
        {
          key: 'type',
          label: 'Type',
          render: row => {
            if (row.type === 'increase') {
              return `<span class="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200/60">▲ Increase (+)</span>`;
            } else if (row.type === 'decrease') {
              return `<span class="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-rose-50 text-rose-700 border border-rose-200/60">▼ Decrease (-)</span>`;
            }
            return `<span class="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-blue-50 text-blue-700 border border-blue-200/60">◈ Reconciliation</span>`;
          }
        },
        {
          key: 'items',
          label: 'Adjusted Items',
          render: row => {
            const lines = row.lines || [];
            if (!lines.length) return `<span class="text-slate-400 text-xs">—</span>`;
            return `
              <div class="space-y-1 max-w-xs">
                ${lines.map(l => {
                  const v = varMap.get(l.variantId);
                  const name = v ? `${v.name}` : 'Item';
                  const isPositive = Number(l.quantity) > 0;
                  const isZero = Number(l.quantity) === 0;
                  const sign = isPositive ? '+' : '';
                  return `
                    <div class="text-xs flex items-center justify-between gap-2">
                      <span class="text-slate-800 font-medium truncate">${name}</span>
                      <span class="font-mono font-bold ${isPositive ? 'text-emerald-600' : (isZero ? 'text-slate-500' : 'text-rose-600')} shrink-0">
                        ${sign}${l.quantity} ${l.unit || 'PCS'}
                      </span>
                    </div>
                  `;
                }).join('')}
              </div>
            `;
          }
        },
        {
          key: 'netVariance',
          label: 'Net Variance',
          render: row => {
            const lines = row.lines || [];
            const net = lines.reduce((acc, l) => acc + (Number(l.quantity) || 0), 0);
            const sign = net > 0 ? '+' : '';
            const colorClass = net > 0 ? 'text-emerald-700 bg-emerald-50 border-emerald-200' : (net < 0 ? 'text-rose-700 bg-rose-50 border-rose-200' : 'text-slate-700 bg-slate-100 border-slate-200');
            return `
              <span class="inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-mono font-bold border ${colorClass}">
                ${sign}${net} PCS
              </span>
            `;
          }
        },
        {
          key: 'reason',
          label: 'Audit Reason',
          render: row => `<span class="text-slate-600 text-xs italic">${row.reason || 'Physical Count Reconciliation'}</span>`
        },
        {
          key: 'status',
          label: 'Status',
          render: row => `
            <span class="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200/60">
              ${row.status || 'Confirmed'}
            </span>
          `
        },
        {
          key: 'actions',
          label: 'Action',
          render: row => `
            <button class="view-adj-btn px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold rounded-lg text-xs transition-colors cursor-pointer flex items-center gap-1.5" data-id="${row.id}">
              Inspect
            </button>
          `
        }
      ];

      tableContainer.innerHTML = renderTable({
        columns,
        data: filtered,
        emptyMessage: 'No matching stock adjustments found.'
      });

      // Re-bind click events
      tableContainer.querySelectorAll('.view-adj-btn').forEach(b => {
        b.onclick = () => {
          const id = b.getAttribute('data-id');
          const adj = (inventoryService.getStockAdjustments() || []).find(a => a.id === id);
          if (adj) openAdjustmentDetailsModal(adj);
        };
      });
    }
  };

  if (searchInput) searchInput.oninput = applyFilters;
  if (typeFilter) typeFilter.onchange = applyFilters;
  if (whFilter) whFilter.onchange = applyFilters;
}

/**
 * Open High-Fidelity Stock Adjustment Dialog
 * Follows Design/code 1.html & media_1790166013548.png:
 *   - Clean rounded-3xl container with glass backdrop
 *   - Dual input modes: (1) Quantity Delta (+/-) & (2) Final Physical Count
 *   - Real-time bi-directional auto-calculation
 *   - Multi-item line items with dynamic live badges
 *   - Warehouse balance live synchronization
 */
export function openAdjustmentModal(onSaved) {
  const warehouses = warehouseService.getWarehouses() || [];
  const variants = productService.getVariants() || [];
  const products = productService.getProducts() || [];
  const currentUser = authService.getCurrentUser() || { name: 'Warehouse Auditor', id: 'user-admin' };

  const prodMap = new Map(products.map(p => [p.id, p]));
  const existingAdjustments = inventoryService.getStockAdjustments() || [];
  const nextNumber = `ADJ-${String(existingAdjustments.length + 1).padStart(5, '0')}`;
  const todayStr = new Date().toISOString().split('T')[0];

  // Helper to get variant display info
  const getVariantInfo = (variantId) => {
    if (!variantId) {
      return {
        variant: null,
        product: null,
        name: 'Select an Item',
        sku: 'SKU-0000',
        category: 'No item selected',
        unit: 'PCS',
        costPrice: 0
      };
    }
    const v = variants.find(item => item.id === variantId);
    const p = v ? prodMap.get(v.productId) : null;
    return {
      variant: v,
      product: p,
      name: v ? (v.name || 'Product Variant') : 'Product Variant',
      sku: v ? v.sku : 'SKU-0000',
      category: p ? p.customerName || p.businessName || 'General Stock' : 'General Stock',
      unit: v ? (v.unit || 'PCS') : 'PCS',
      costPrice: v ? Number(v.costPrice) || 0 : 0
    };
  };

  // State for lines in the modal
  let selectedWarehouseId = warehouses[0]?.id || 'wh-1';
  let activeEntryMode = 'delta'; // 'delta' or 'final'

  // Initialize with 0 lines by default (clean state per ERP standard)
  const linesState = [];

  const contentHtml = `
    <form id="stock-adjustment-modal-form" class="space-y-5 text-slate-800 overflow-visible">
      
      <!-- CARD 1: LOCATION & AUDIT DETAILS -->
      <div class="bg-white p-5 rounded-2xl border border-slate-200/90 shadow-2xs space-y-4 overflow-visible">
        <div class="flex items-center justify-between border-b border-slate-100 pb-3">
          <div class="flex items-center space-x-2">
            <span class="p-1.5 rounded-lg bg-blue-50 text-[#138FCB]">
              <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"></path>
                <path stroke-linecap="round" stroke-linejoin="round" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"></path>
              </svg>
            </span>
            <span class="text-xs font-bold text-slate-800 uppercase tracking-wider">Location & Audit Context</span>
          </div>
          <span class="text-[11px] text-slate-400 font-medium">All fields marked with <span class="text-rose-500">*</span> are required</span>
        </div>

        <div class="grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs overflow-visible">
          <!-- Warehouse Selector -->
          <div class="overflow-visible">
            <label class="block font-bold text-slate-700 mb-1">Target Warehouse <span class="text-rose-500">*</span></label>
            ${renderSearchableDropdown({
              id: 'modal-adj-warehouse',
              placeholder: 'Select Target Warehouse...',
              value: selectedWarehouseId,
              required: true,
              options: warehouses.map(w => ({
                value: w.id,
                label: `${w.name} (${w.city || 'Depot'})`,
                subtext: w.address || w.type || 'Warehouse',
                badge: w.type || 'Warehouse'
              }))
            })}
          </div>

          <!-- Adjustment Date -->
          <div>
            <label class="block font-bold text-slate-700 mb-1">Adjustment Date <span class="text-rose-500">*</span></label>
            <input type="date" id="modal-adj-date" required value="${todayStr}" class="w-full bg-slate-50/50 border border-slate-200 rounded-xl px-3.5 py-2.5 text-slate-800 font-medium focus:outline-none focus:border-[#138FCB] focus:bg-white transition-all">
          </div>

          <!-- Audit Reason Category -->
          <div class="overflow-visible">
            <label class="block font-bold text-slate-700 mb-1">Audit Reason Category <span class="text-rose-500">*</span></label>
            ${renderSearchableDropdown({
              id: 'modal-adj-category',
              placeholder: 'Select Audit Reason...',
              value: 'Physical Cycle Count Variance',
              required: true,
              options: [
                { value: 'Physical Cycle Count Variance', label: 'Physical Cycle Count Variance', subtext: 'Discrepancy in regular physical audit' },
                { value: 'Damaged / Expired Goods Write-off', label: 'Damaged / Expired Goods Write-off', subtext: 'Scrap or write-down bad inventory' },
                { value: 'Surplus / Found Inventory', label: 'Surplus / Found Inventory (+)', subtext: 'Discovered untracked physical stock' },
                { value: 'Missing / Unaccounted Stock', label: 'Missing / Unaccounted Stock (-)', subtext: 'Shrinkage or lost inventory' },
                { value: 'Periodic Warehouse Audit', label: 'Periodic Warehouse Audit', subtext: 'Scheduled end-of-period audit' },
                { value: 'Internal Production Scrap', label: 'Internal Production Scrap', subtext: 'Manufacturing / assembly scrap' },
                { value: 'Other / Discrepancy Correction', label: 'Other / Discrepancy Correction', subtext: 'Manual adjustment memo' }
              ]
            })}
          </div>
        </div>

        <!-- Adjustment Mode Switcher -->
        <div class="pt-2 border-t border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
          <div class="flex items-center space-x-2">
            <span class="font-bold text-slate-700">Preferred Adjustment Entry Mode:</span>
            <span class="text-slate-400 text-[11px]">(Both columns stay synchronized in real time)</span>
          </div>
          <div class="inline-flex p-1 bg-slate-100 rounded-xl border border-slate-200/80">
            <button type="button" id="btn-mode-delta" class="px-3 py-1.5 rounded-lg font-bold text-xs transition-all cursor-pointer bg-white text-[#138FCB] shadow-2xs border border-blue-100">
              ± Quantity Change (+/-)
            </button>
            <button type="button" id="btn-mode-final" class="px-3 py-1.5 rounded-lg font-bold text-xs transition-all cursor-pointer text-slate-600 hover:text-slate-900">
              🎯 Physical Count (Final Stock)
            </button>
          </div>
        </div>
      </div>

      <!-- CARD 2: ITEMS & ADJUSTMENTS -->
      <div class="bg-white p-5 rounded-2xl border border-slate-200/90 shadow-2xs space-y-4 overflow-visible">
        <div class="flex items-center justify-between border-b border-slate-100 pb-3">
          <div class="flex items-center space-x-2">
            <span class="p-1.5 rounded-lg bg-blue-50 text-[#138FCB]">
              <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4"></path>
              </svg>
            </span>
            <span class="text-xs font-bold text-slate-800 uppercase tracking-wider">Inventory Items to Adjust</span>
            <span id="items-count-badge" class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-50 text-[#138FCB] border border-blue-100">0 Items</span>
          </div>
          
          <div class="text-[11px] text-slate-500 flex items-center gap-1.5">
            <span class="inline-block w-2 h-2 rounded-full bg-emerald-500"></span>
            <span>Current stock fetched live from selected warehouse</span>
          </div>
        </div>

        <!-- Instructional Tip Banner -->
        <div class="p-3 bg-blue-50/60 border border-blue-100 rounded-xl text-xs text-blue-900 flex items-start gap-2.5">
          <svg class="w-4 h-4 text-[#138FCB] shrink-0 mt-0.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path>
          </svg>
          <div class="leading-relaxed">
            <strong>Interactive Two-Way Calculation:</strong>
            You can either enter the <strong>Quantity Change</strong> (e.g. <span class="font-mono font-bold text-emerald-700">+25</span> or <span class="font-mono font-bold text-rose-700">-30</span> pcs) OR enter the actual counted <strong>Final Stock</strong> (e.g. Current: 213 &rarr; New: 250). The system automatically recalculates and keeps both values in sync.
          </div>
        </div>

        <!-- Table Container -->
        <div class="border border-slate-200/90 rounded-xl overflow-visible bg-white">
          <table class="w-full text-left text-xs overflow-visible">
            <thead>
              <tr class="bg-slate-50/80 text-slate-500 font-semibold border-b border-slate-200/80">
                <th class="py-3 px-4 font-bold uppercase tracking-wider text-[10px] w-7/16">Item & SKU</th>
                <th class="py-3 px-3 font-bold uppercase tracking-wider text-[10px] text-center w-28">Current Stock</th>
                <th class="py-3 px-3 font-bold uppercase tracking-wider text-[10px] text-center w-36" id="th-delta-header">
                  Quantity Change (+/-)
                </th>
                <th class="py-3 px-3 font-bold uppercase tracking-wider text-[10px] text-center w-36" id="th-final-header">
                  New Final Stock
                </th>
                <th class="py-3 px-3 font-bold uppercase tracking-wider text-[10px] text-center w-32">Net Variance</th>
                <th class="py-3 px-3 text-center w-12"></th>
              </tr>
            </thead>
            <tbody id="adjustment-lines-tbody" class="divide-y divide-slate-100 overflow-visible">
              <!-- Dynamically rendered lines -->
            </tbody>
          </table>
        </div>

        <!-- Add Line Item Button -->
        <div>
          <button type="button" id="btn-add-adj-line" class="w-full py-2.5 border-2 border-dashed border-slate-200 hover:border-[#138FCB] hover:text-[#138FCB] text-slate-600 font-bold rounded-xl text-xs flex items-center justify-center space-x-2 transition-all cursor-pointer group">
            <svg class="w-4 h-4 text-slate-400 group-hover:text-[#138FCB] transition-colors" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" d="M12 4v16m8-8H4"></path>
            </svg>
            <span>+ Add Another Inventory Item</span>
          </button>
        </div>
      </div>

      <!-- CARD 3: AUDIT NOTES & SUMMARY (DUAL-COLUMN) -->
      <div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <!-- Left: Memo & Justification -->
        <div class="bg-white p-5 rounded-2xl border border-slate-200/90 shadow-2xs space-y-3">
          <div class="flex items-center space-x-2 border-b border-slate-100 pb-2">
            <span class="p-1.5 rounded-lg bg-blue-50 text-[#138FCB]">
              <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"></path>
              </svg>
            </span>
            <span class="text-xs font-bold text-slate-800 uppercase tracking-wider">Audit Justification & Notes</span>
          </div>

          <div class="space-y-3 text-xs">
            <div>
              <label class="block font-bold text-slate-700 mb-1">Detailed Inspection Memo</label>
              <textarea id="modal-adj-notes" rows="3" placeholder="Provide context, e.g. Count discrepancy identified during routine cycle count in Rack A, damp cartons discarded..." class="w-full bg-slate-50/50 border border-slate-200 rounded-xl p-3 text-slate-800 focus:outline-none focus:border-[#138FCB] focus:bg-white transition-all resize-none"></textarea>
            </div>

            <div>
              <label class="block font-bold text-slate-700 mb-1">Audited & Verified By</label>
              <input type="text" id="modal-adj-staff" value="${currentUser.name || 'Warehouse Auditor'}" class="w-full bg-slate-50/50 border border-slate-200 rounded-xl px-3 py-2 text-slate-800 font-medium focus:outline-none focus:border-[#138FCB] focus:bg-white transition-all">
            </div>
          </div>
        </div>

        <!-- Right: Real-time Variance Summary -->
        <div class="bg-white p-5 rounded-2xl border border-slate-200/90 shadow-2xs space-y-3 flex flex-col justify-between">
          <div class="space-y-2.5">
            <div class="flex items-center space-x-2 border-b border-slate-100 pb-2">
              <span class="p-1.5 rounded-lg bg-blue-50 text-[#138FCB]">
                <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M9 7h6m0 10v-3m-3 3h.01M9 17h.01M9 14h.01M12 14h.01M15 11h.01M12 11h.01M9 11h.01M7 21h10a2 2 0 002-2V5a2 2 0 00-2-2H7a2 2 0 00-2 2v14a2 2 0 002 2z"></path>
                </svg>
              </span>
              <span class="text-xs font-bold text-slate-800 uppercase tracking-wider">Adjustment Impact Summary</span>
            </div>

            <div class="space-y-2 text-xs">
              <div class="flex justify-between items-center text-slate-600">
                <span>Total Items Adjusted:</span>
                <span id="summary-total-items" class="font-bold text-slate-800 font-mono">0 items</span>
              </div>
              <div class="flex justify-between items-center text-slate-600">
                <span>Total Quantity to Add (+):</span>
                <span id="summary-stock-added" class="font-bold text-emerald-600 font-mono">+0 PCS</span>
              </div>
              <div class="flex justify-between items-center text-slate-600">
                <span>Total Quantity to Deduct (-):</span>
                <span id="summary-stock-deducted" class="font-bold text-rose-600 font-mono">-0 PCS</span>
              </div>
            </div>
          </div>

          <!-- Highlighted Net Delta Box -->
          <div class="p-3.5 rounded-xl bg-blue-50/70 border border-blue-100 text-[#138FCB] flex items-center justify-between">
            <div>
              <div class="text-[10px] uppercase font-bold tracking-wider text-slate-500">Net Inventory Impact</div>
              <div id="summary-overall-type" class="text-xs font-bold text-slate-700">No Quantity Change</div>
            </div>
            <div id="summary-net-delta" class="text-lg font-black font-mono tracking-tight text-[#138FCB]">
              0 PCS
            </div>
          </div>
        </div>
      </div>

      <!-- Action Confirmation Callout -->
      <div id="modal-warning-banner" class="hidden p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-800 flex items-center gap-2">
        <svg class="w-4 h-4 text-rose-600 shrink-0" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path>
        </svg>
        <span id="modal-warning-text">Negative stock disallowed for one or more selected items.</span>
      </div>

      <!-- Extra breathing room for dropdowns -->
      <div class="h-10"></div>

      <!-- FOOTER ACTIONS -->
      <div class="flex justify-end gap-3 pt-3 border-t border-slate-100">
        <button type="button" id="adj-modal-cancel-btn" class="px-4 py-2.5 text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-xl font-bold text-xs transition-colors cursor-pointer">
          Discard & Close
        </button>
        <button type="submit" id="adj-modal-submit-btn" class="px-5 py-2.5 bg-[#138FCB] hover:bg-[#0E78AC] text-white rounded-xl font-bold text-xs shadow-xs transition-all cursor-pointer flex items-center gap-2">
          <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"></path>
          </svg>
          <span>Confirm & Post Adjustment</span>
        </button>
      </div>
    </form>
  `;

  openModal({
    title: 'New Stock Adjustment',
    subtitle: 'Reconcile physical inventory counts, record write-offs, or apply cycle count adjustments',
    badge: nextNumber,
    iconHtml: `
      <div class="w-11 h-11 rounded-2xl bg-blue-50 text-[#138FCB] border border-blue-100/60 flex items-center justify-center shrink-0">
        <svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4"></path>
        </svg>
      </div>
    `,
    contentHtml,
    size: 'max-w-4xl',
    onOpen: (modalEl) => {
      const form = modalEl.querySelector('#stock-adjustment-modal-form');
      const tbody = modalEl.querySelector('#adjustment-lines-tbody');
      const addLineBtn = modalEl.querySelector('#btn-add-adj-line');
      const cancelBtn = modalEl.querySelector('#adj-modal-cancel-btn');
      const submitBtn = modalEl.querySelector('#adj-modal-submit-btn');
      const warningBanner = modalEl.querySelector('#modal-warning-banner');
      const warningText = modalEl.querySelector('#modal-warning-text');

      const btnModeDelta = modalEl.querySelector('#btn-mode-delta');
      const btnModeFinal = modalEl.querySelector('#btn-mode-final');
      const thDeltaHeader = modalEl.querySelector('#th-delta-header');
      const thFinalHeader = modalEl.querySelector('#th-final-header');

      // Bind Warehouse Searchable Dropdown
      const whDropdown = modalEl.querySelector('[data-dropdown-id="modal-adj-warehouse"]');
      if (whDropdown) {
        bindSearchableDropdown(whDropdown, {
          onChange: (newWhId) => {
            selectedWarehouseId = newWhId;
            linesState.forEach(line => {
              if (line.variantId) {
                line.currentStock = inventoryService.getBalance(selectedWarehouseId, line.variantId);
                if (line.mode === 'final') {
                  line.deltaQty = line.newFinalStock - line.currentStock;
                } else {
                  line.newFinalStock = line.currentStock + line.deltaQty;
                }
              }
            });
            renderAllLines();
          }
        });
      }

      // Bind Category Searchable Dropdown
      const catDropdown = modalEl.querySelector('[data-dropdown-id="modal-adj-category"]');
      if (catDropdown) {
        bindSearchableDropdown(catDropdown);
      }

      // Mode switch handler
      const setEntryMode = (mode) => {
        activeEntryMode = mode;
        if (mode === 'delta') {
          btnModeDelta.className = 'px-3 py-1.5 rounded-lg font-bold text-xs transition-all cursor-pointer bg-white text-[#138FCB] shadow-2xs border border-blue-100';
          btnModeFinal.className = 'px-3 py-1.5 rounded-lg font-bold text-xs transition-all cursor-pointer text-slate-600 hover:text-slate-900';
          thDeltaHeader.classList.add('text-[#138FCB]', 'font-black');
          thFinalHeader.classList.remove('text-[#138FCB]', 'font-black');
        } else {
          btnModeFinal.className = 'px-3 py-1.5 rounded-lg font-bold text-xs transition-all cursor-pointer bg-white text-[#138FCB] shadow-2xs border border-blue-100';
          btnModeDelta.className = 'px-3 py-1.5 rounded-lg font-bold text-xs transition-all cursor-pointer text-slate-600 hover:text-slate-900';
          thFinalHeader.classList.add('text-[#138FCB]', 'font-black');
          thDeltaHeader.classList.remove('text-[#138FCB]', 'font-black');
        }
      };

      btnModeDelta.onclick = () => setEntryMode('delta');
      btnModeFinal.onclick = () => setEntryMode('final');

      // Recalculate summary totals
      const recalculateSummary = () => {
        let totalAdded = 0;
        let totalDeducted = 0;
        let netVariance = 0;
        let hasNegativeError = false;

        linesState.forEach(line => {
          if (!line.variantId) return;
          const delta = Number(line.deltaQty) || 0;
          if (delta > 0) totalAdded += delta;
          if (delta < 0) totalDeducted += Math.abs(delta);
          netVariance += delta;

          // Check negative stock rules
          const currentBal = Number(line.currentStock) || 0;
          const newBal = currentBal + delta;
          if (newBal < 0) {
            hasNegativeError = true;
          }
        });

        // Update Summary DOM
        const itemsCountBadge = modalEl.querySelector('#items-count-badge');
        const summaryTotalItems = modalEl.querySelector('#summary-total-items');
        const summaryStockAdded = modalEl.querySelector('#summary-stock-added');
        const summaryStockDeducted = modalEl.querySelector('#summary-stock-deducted');
        const summaryNetDelta = modalEl.querySelector('#summary-net-delta');
        const summaryOverallType = modalEl.querySelector('#summary-overall-type');

        const lineCount = linesState.filter(l => Boolean(l.variantId)).length;
        if (itemsCountBadge) itemsCountBadge.textContent = `${lineCount} ${lineCount === 1 ? 'Item' : 'Items'}`;
        if (summaryTotalItems) summaryTotalItems.textContent = `${lineCount} ${lineCount === 1 ? 'item' : 'items'}`;

        if (summaryStockAdded) summaryStockAdded.textContent = `+${totalAdded.toLocaleString()} PCS`;
        if (summaryStockDeducted) summaryStockDeducted.textContent = `-${totalDeducted.toLocaleString()} PCS`;

        const sign = netVariance > 0 ? '+' : '';
        if (summaryNetDelta) {
          summaryNetDelta.textContent = `${sign}${netVariance.toLocaleString()} PCS`;
          summaryNetDelta.className = `text-lg font-black font-mono tracking-tight ${netVariance > 0 ? 'text-emerald-600' : (netVariance < 0 ? 'text-rose-600' : 'text-[#138FCB]')}`;
        }

        if (summaryOverallType) {
          if (netVariance > 0) {
            summaryOverallType.innerHTML = '<span class="text-emerald-700 font-bold">▲ Net Stock Increase (+)</span>';
          } else if (netVariance < 0) {
            summaryOverallType.innerHTML = '<span class="text-rose-700 font-bold">▼ Net Stock Decrease (-)</span>';
          } else {
            summaryOverallType.textContent = 'Balanced / Unchanged';
          }
        }

        if (hasNegativeError) {
          warningBanner.classList.remove('hidden');
          warningText.textContent = 'Warning: Resulting stock is negative for one or more items. Please verify current on-hand quantities.';
        } else {
          warningBanner.classList.add('hidden');
        }
      };

      // Render a single line in table
      const renderLineRow = (line, index) => {
        const info = getVariantInfo(line.variantId);
        const currentStock = Number(line.currentStock) || 0;
        const delta = Number(line.deltaQty) || 0;
        const finalStock = Number(line.newFinalStock) || 0;

        const isPositive = delta > 0;
        const isNegative = delta < 0;
        const deltaSign = isPositive ? '+' : '';

        const tr = document.createElement('tr');
        tr.id = `line-row-${line.id}`;
        tr.className = 'hover:bg-slate-50/60 transition-colors overflow-visible';

        const lineDdId = `adj-var-dd-${line.id}`;
        const varOptions = variants.map(v => {
          const p = prodMap.get(v.productId);
          const cat = p ? (p.customerName || p.businessName || 'General Stock') : 'General Stock';
          const bal = inventoryService.getBalance(selectedWarehouseId, v.id);
          return {
            value: v.id,
            label: v.name,
            subtext: `${v.sku} • ${cat}`,
            badge: `${bal.toLocaleString()} ${v.unit || 'PCS'}`
          };
        });

        tr.innerHTML = `
          <!-- Item / Variant Dropdown -->
          <td class="py-3 px-4 w-7/16 overflow-visible">
            <div class="space-y-1 overflow-visible">
              ${renderSearchableDropdown({
                id: lineDdId,
                name: `variantId-${line.id}`,
                placeholder: 'Select Product / SKU...',
                value: line.variantId || '',
                required: true,
                menuWidth: 'w-[320px] sm:w-[380px]',
                options: varOptions
              })}
              <div class="line-item-category text-[11px] text-slate-400 font-medium px-1">
                ${line.variantId ? `${info.category} • Base: ${info.unit}` : 'Select a product to inspect on-hand balance'}
              </div>
            </div>
          </td>

          <!-- Current Stock (Read-Only Pill) -->
          <td class="py-3 px-3 text-center">
            <span class="line-current-stock-badge inline-block px-3 py-1.5 rounded-lg text-xs font-mono font-bold bg-slate-100 text-slate-700 border border-slate-200">
              ${line.variantId ? `${currentStock.toLocaleString()} ${line.unit}` : '—'}
            </span>
          </td>

          <!-- Quantity Change (+/- Delta) -->
          <td class="py-3 px-3">
            <div class="relative">
              <input type="number" step="any" class="line-delta-input w-full text-center font-mono font-bold text-xs bg-white border border-slate-200 rounded-lg px-2 py-1.5 focus:outline-none focus:border-[#138FCB] ${isPositive ? 'text-emerald-700 border-emerald-300' : (isNegative ? 'text-rose-700 border-rose-300' : 'text-slate-800')}" placeholder="e.g. +25 or -30" value="${delta !== 0 ? (deltaSign + delta) : ''}">
            </div>
          </td>

          <!-- New Final Stock (Physical Count) -->
          <td class="py-3 px-3">
            <div class="relative">
              <input type="number" step="any" min="0" class="line-final-input w-full text-center font-mono font-bold text-xs bg-white border border-slate-200 rounded-lg px-2 py-1.5 focus:outline-none focus:border-[#138FCB] text-slate-800" placeholder="e.g. 250" value="${line.variantId ? finalStock : ''}">
            </div>
          </td>

          <!-- Net Variance Indicator Pill -->
          <td class="py-3 px-3 text-center">
            <span class="line-status-pill inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-mono font-bold ${
              isPositive ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' :
              (isNegative ? 'bg-rose-50 text-rose-700 border border-rose-200' : 'bg-slate-100 text-slate-500 border border-slate-200')
            }">
              ${isPositive ? `▲ +${delta}` : (isNegative ? `▼ ${delta}` : '◆ 0')} ${line.unit}
            </span>
          </td>

          <!-- Remove Action -->
          <td class="py-3 px-3 text-center">
            <button type="button" class="btn-remove-line text-slate-300 hover:text-rose-600 transition-colors p-1.5 rounded-lg hover:bg-rose-50 cursor-pointer">
              <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path>
              </svg>
            </button>
          </td>
        `;

        // Wire event handlers for this row
        const currentStockBadge = tr.querySelector('.line-current-stock-badge');
        const deltaInput = tr.querySelector('.line-delta-input');
        const finalInput = tr.querySelector('.line-final-input');
        const statusPill = tr.querySelector('.line-status-pill');
        const removeBtn = tr.querySelector('.btn-remove-line');
        const categoryDiv = tr.querySelector('.line-item-category');

        // Helper to update line visuals
        const updateLineVisuals = (deltaVal, newFinalVal) => {
          const pos = deltaVal > 0;
          const neg = deltaVal < 0;
          const s = pos ? '+' : '';

          statusPill.className = `line-status-pill inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-mono font-bold ${
            pos ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' :
            (neg ? 'bg-rose-50 text-rose-700 border border-rose-200' : 'bg-slate-100 text-slate-500 border border-slate-200')
          }`;
          statusPill.textContent = `${pos ? '▲ ' + s : (neg ? '▼ ' : '◆ ')}${deltaVal} ${line.unit}`;

          deltaInput.className = `line-delta-input w-full text-center font-mono font-bold text-xs bg-white border rounded-lg px-2 py-1.5 focus:outline-none focus:border-[#138FCB] ${
            pos ? 'text-emerald-700 border-emerald-300' : (neg ? 'text-rose-700 border-rose-300' : 'text-slate-800 border-slate-200')
          }`;

          recalculateSummary();
        };

        // Wire Searchable Dropdown for this line
        const ddContainer = tr.querySelector(`[data-dropdown-id="${lineDdId}"]`);
        if (ddContainer) {
          bindSearchableDropdown(ddContainer, {
            onChange: (newVarId) => {
              line.variantId = newVarId;
              const newInfo = getVariantInfo(newVarId);
              line.unit = newInfo.unit;
              line.currentStock = inventoryService.getBalance(selectedWarehouseId, newVarId);

              if (categoryDiv) {
                categoryDiv.textContent = `${newInfo.category} • Base: ${newInfo.unit}`;
              }

              if (currentStockBadge) {
                currentStockBadge.textContent = `${line.currentStock.toLocaleString()} ${line.unit}`;
              }

              if (line.mode === 'final') {
                line.deltaQty = line.newFinalStock - line.currentStock;
                deltaInput.value = (line.deltaQty > 0 ? '+' : '') + line.deltaQty;
              } else {
                line.newFinalStock = line.currentStock + line.deltaQty;
                finalInput.value = line.newFinalStock;
              }

              updateLineVisuals(line.deltaQty, line.newFinalStock);
            }
          });
        }

        // 1. When Delta Input changes (+/- pcs)
        deltaInput.oninput = () => {
          const raw = deltaInput.value.trim();
          const parsed = parseFloat(raw);
          const deltaVal = isNaN(parsed) ? 0 : parsed;

          line.deltaQty = deltaVal;
          line.newFinalStock = line.currentStock + deltaVal;
          line.mode = 'delta';

          finalInput.value = line.newFinalStock;
          updateLineVisuals(deltaVal, line.newFinalStock);
        };

        // 2. When Final Stock Input changes (Physical count)
        finalInput.oninput = () => {
          const raw = finalInput.value.trim();
          const parsed = parseFloat(raw);
          if (isNaN(parsed)) return;

          const targetStock = parsed;
          const computedDelta = targetStock - line.currentStock;

          line.newFinalStock = targetStock;
          line.deltaQty = computedDelta;
          line.mode = 'final';

          deltaInput.value = (computedDelta > 0 ? '+' : '') + computedDelta;
          updateLineVisuals(computedDelta, targetStock);
        };

        // 4. Remove Line
        removeBtn.onclick = () => {
          const idx = linesState.findIndex(l => l.id === line.id);
          if (idx !== -1) {
            linesState.splice(idx, 1);
            renderAllLines();
          }
        };

        return tr;
      };

      // Render all lines into table
      const renderAllLines = () => {
        tbody.innerHTML = '';
        if (linesState.length === 0) {
          const emptyTr = document.createElement('tr');
          emptyTr.id = 'adj-empty-state-row';
          emptyTr.innerHTML = `
            <td colspan="6" class="py-8 text-center text-slate-400">
              <div class="flex flex-col items-center justify-center space-y-2">
                <div class="w-10 h-10 rounded-xl bg-slate-100 flex items-center justify-center text-slate-400">
                  <svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4"></path>
                  </svg>
                </div>
                <div class="text-xs font-semibold text-slate-500">No inventory items added yet</div>
                <div class="text-[11px] text-slate-400 max-w-sm">Click "+ Add Another Inventory Item" below to select products and reconcile count variances.</div>
              </div>
            </td>
          `;
          tbody.appendChild(emptyTr);
        } else {
          linesState.forEach((line, idx) => {
            tbody.appendChild(renderLineRow(line, idx));
          });
        }
        recalculateSummary();
      };

      // Initial Render
      renderAllLines();

      // Add Line Button
      addLineBtn.onclick = () => {
        // Find variant not already in lines, or default to empty for user choice
        const usedIds = new Set(linesState.map(l => l.variantId).filter(Boolean));
        const unusedVariant = variants.find(v => !usedIds.has(v.id));
        const vId = unusedVariant ? unusedVariant.id : '';
        const curStock = vId ? inventoryService.getBalance(selectedWarehouseId, vId) : 0;

        linesState.push({
          id: `line-${Date.now()}-${linesState.length + 1}`,
          variantId: vId,
          currentStock: curStock,
          deltaQty: 0,
          newFinalStock: curStock,
          unit: unusedVariant?.unit || 'PCS',
          mode: activeEntryMode
        });

        renderAllLines();
      };

      // Cancel button
      cancelBtn.onclick = () => closeModal();

      // Form submission
      form.onsubmit = (e) => {
        e.preventDefault();

        const warehouseInput = modalEl.querySelector('#modal-adj-warehouse');
        const warehouseId = warehouseInput ? warehouseInput.value : selectedWarehouseId;
        const date = modalEl.querySelector('#modal-adj-date').value;
        const categoryInput = modalEl.querySelector('#modal-adj-category');
        const category = categoryInput ? categoryInput.value : 'Physical Cycle Count Variance';
        const memo = modalEl.querySelector('#modal-adj-notes').value.trim();
        const staff = modalEl.querySelector('#modal-adj-staff').value.trim();

        // Validation: Must have at least one line with non-zero delta
        const validLines = linesState.filter(l => l.variantId && Number(l.deltaQty) !== 0);
        if (validLines.length === 0) {
          toast.show('Please add at least one item with a non-zero quantity change.', 'warning');
          return;
        }

        // Format lines for inventoryService
        const formattedLines = validLines.map(l => ({
          variantId: l.variantId,
          currentStock: l.currentStock,
          newStock: l.newFinalStock,
          quantity: l.deltaQty,
          unit: l.unit || 'PCS',
          mode: l.mode,
          notes: `${category}${memo ? ': ' + memo : ''}`
        }));

        try {
          inventoryService.createStockAdjustment({
            type: 'reconciliation', // auto-detects increase/decrease/mixed
            warehouseId,
            reason: `${category}${memo ? ' — ' + memo : ''}`,
            lines: formattedLines,
            notes: `Audited by: ${staff || 'Staff'}. Memo: ${memo}`,
            userId: currentUser.id || 'user-admin'
          });

          toast.show(`Stock adjustment successfully posted. Balances updated.`, 'success');
          closeModal();
          if (onSaved) onSaved();
        } catch (err) {
          toast.show(err.message || 'Failed to post stock adjustment.', 'error');
        }
      };
    }
  });
}

/**
 * Open Read-Only Inspection Modal for an Adjustment
 * Shows full before/after breakdown, linked stock movement, and audit notes.
 */
export function openAdjustmentDetailsModal(adj) {
  const warehouses = warehouseService.getWarehouses() || [];
  const variants = productService.getVariants() || [];
  const whMap = new Map(warehouses.map(w => [w.id, w.name]));
  const varMap = new Map(variants.map(v => [v.id, v]));

  const lines = adj.lines || [];
  const netVariance = lines.reduce((acc, l) => acc + (Number(l.quantity) || 0), 0);
  const sign = netVariance > 0 ? '+' : '';

  const contentHtml = `
    <div class="space-y-5 text-slate-800 text-xs">
      
      <!-- CARD 1: AUDIT RECORD CONTEXT -->
      <div class="bg-white p-5 rounded-2xl border border-slate-200/90 shadow-2xs space-y-3">
        <div class="flex items-center justify-between border-b border-slate-100 pb-2.5">
          <div class="flex items-center space-x-2">
            <span class="p-1.5 rounded-lg bg-blue-50 text-[#138FCB]">
              <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path>
              </svg>
            </span>
            <span class="font-bold text-slate-800 uppercase tracking-wider">Adjustment Metadata</span>
          </div>
          <span class="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200/60">
            ${adj.status || 'Confirmed'}
          </span>
        </div>

        <div class="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <div>
            <div class="text-slate-400 text-[10px] uppercase font-bold tracking-wider">Warehouse</div>
            <div class="font-bold text-slate-800 mt-0.5">${whMap.get(adj.warehouseId) || 'Main Warehouse'}</div>
          </div>
          <div>
            <div class="text-slate-400 text-[10px] uppercase font-bold tracking-wider">Adjustment Date</div>
            <div class="font-bold text-slate-800 mt-0.5">${adj.date || '—'}</div>
          </div>
          <div>
            <div class="text-slate-400 text-[10px] uppercase font-bold tracking-wider">Net Variance</div>
            <div class="font-mono font-bold mt-0.5 ${netVariance > 0 ? 'text-emerald-600' : (netVariance < 0 ? 'text-rose-600' : 'text-slate-700')}">
              ${sign}${netVariance} PCS
            </div>
          </div>
          <div>
            <div class="text-slate-400 text-[10px] uppercase font-bold tracking-wider">Movement Ref</div>
            <div class="font-mono font-bold text-[#138FCB] mt-0.5">${adj.movementId ? 'Linked (MOV)' : 'Posted'}</div>
          </div>
        </div>
      </div>

      <!-- CARD 2: ADJUSTED LINE ITEMS -->
      <div class="bg-white p-5 rounded-2xl border border-slate-200/90 shadow-2xs space-y-3">
        <div class="flex items-center justify-between border-b border-slate-100 pb-2.5">
          <div class="flex items-center space-x-2">
            <span class="p-1.5 rounded-lg bg-blue-50 text-[#138FCB]">
              <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4"></path>
              </svg>
            </span>
            <span class="font-bold text-slate-800 uppercase tracking-wider">Reconciled Items</span>
            <span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-50 text-[#138FCB]">${lines.length} Items</span>
          </div>
        </div>

        <div class="overflow-x-auto border border-slate-100 rounded-xl">
          <table class="w-full text-left">
            <thead>
              <tr class="bg-slate-50 text-slate-500 font-bold uppercase tracking-wider text-[10px] border-b border-slate-200/80">
                <th class="py-2.5 px-3">Item / SKU</th>
                <th class="py-2.5 px-3 text-center">Before Count</th>
                <th class="py-2.5 px-3 text-center">Quantity Delta (+/-)</th>
                <th class="py-2.5 px-3 text-center">After Count</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-slate-100">
              ${lines.map(l => {
                const v = varMap.get(l.variantId);
                const name = v ? v.name : 'Unknown Variant';
                const sku = v ? v.sku : '—';
                const isPos = Number(l.quantity) > 0;
                const isNeg = Number(l.quantity) < 0;
                const beforeStock = l.currentStock !== undefined ? l.currentStock : '—';
                const afterStock = l.newStock !== undefined ? l.newStock : (typeof beforeStock === 'number' ? beforeStock + Number(l.quantity) : '—');
                return `
                  <tr class="hover:bg-slate-50/50">
                    <td class="py-2.5 px-3">
                      <div class="font-bold text-slate-800">${name}</div>
                      <div class="text-[10px] font-mono text-slate-400">${sku}</div>
                    </td>
                    <td class="py-2.5 px-3 text-center font-mono text-slate-600">
                      ${typeof beforeStock === 'number' ? beforeStock.toLocaleString() : beforeStock} ${l.unit || 'PCS'}
                    </td>
                    <td class="py-2.5 px-3 text-center">
                      <span class="inline-flex items-center px-2 py-0.5 rounded-md font-mono font-bold text-xs ${
                        isPos ? 'bg-emerald-50 text-emerald-700' : (isNeg ? 'bg-rose-50 text-rose-700' : 'bg-slate-100 text-slate-600')
                      }">
                        ${isPos ? '+' : ''}${l.quantity} ${l.unit || 'PCS'}
                      </span>
                    </td>
                    <td class="py-2.5 px-3 text-center font-mono font-bold text-slate-800">
                      ${typeof afterStock === 'number' ? afterStock.toLocaleString() : afterStock} ${l.unit || 'PCS'}
                    </td>
                  </tr>
                `;
              }).join('')}
            </tbody>
          </table>
        </div>
      </div>

      <!-- CARD 3: AUDIT REASON & INSPECTION LOG -->
      <div class="bg-white p-5 rounded-2xl border border-slate-200/90 shadow-2xs space-y-2">
        <div class="text-[10px] font-bold uppercase tracking-wider text-slate-400">Audit Justification & Notes</div>
        <div class="text-xs text-slate-700 bg-slate-50 p-3 rounded-xl border border-slate-100">
          <p class="font-medium"><strong>Reason:</strong> ${adj.reason || 'Routine physical inventory audit'}</p>
          ${adj.notes ? `<p class="mt-1 text-slate-600"><strong>Notes:</strong> ${adj.notes}</p>` : ''}
        </div>
      </div>

      <!-- FOOTER -->
      <div class="flex justify-end pt-3 border-t border-slate-100">
        <button type="button" id="adj-details-close-btn" class="px-5 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-xl text-xs transition-colors cursor-pointer">
          Close Inspection
        </button>
      </div>
    </div>
  `;

  openModal({
    title: `Stock Adjustment Details`,
    subtitle: `Immutable physical audit movement log`,
    badge: adj.adjustmentNumber,
    iconHtml: `
      <div class="w-11 h-11 rounded-2xl bg-blue-50 text-[#138FCB] border border-blue-100/60 flex items-center justify-center shrink-0">
        <svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"></path>
          <path stroke-linecap="round" stroke-linejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"></path>
        </svg>
      </div>
    `,
    contentHtml,
    size: 'max-w-3xl',
    onOpen: (modalEl) => {
      const closeBtn = modalEl.querySelector('#adj-details-close-btn');
      if (closeBtn) closeBtn.onclick = () => closeModal();
    }
  });
}
