/**
 * JS Traders ERP - Current Stock Balances & Warehouse Inventory View
 * The authoritative operational stock viewer.
 * Hides cost and valuation if the user lacks 'View Cost/Profit' permission.
 */

import { inventoryService } from '../../services/inventoryService.js';
import { productService } from '../../services/productService.js';
import { warehouseService } from '../../services/warehouseService.js';
import { authService } from '../../services/authService.js';
import { renderTable, bindTableActions } from '../../components/table.js';
import { renderFilterBar } from '../../components/filters.js';
import { openModal, closeModal } from '../../components/modal.js';
import { toast } from '../../components/toast.js';

export function renderStockView() {
  const warehouses = warehouseService.getWarehouses();
  const activeWh = authService.getActiveWarehouseId();
  const balances = inventoryService.getAllBalances();
  const canViewCost = authService.canViewCostProfit();

  const filterBarHtml = renderFilterBar({
    searchPlaceholder: 'Search stock by SKU, product, or warehouse...',
    dropdowns: [
      {
        id: 'stock-warehouse-filter',
        label: 'Warehouse',
        value: 'all',
        options: [
          { value: 'all', label: 'All Warehouses' },
          ...warehouses.map(w => ({ value: w.id, label: w.name }))
        ]
      },
      {
        id: 'stock-status-filter',
        label: 'Stock Status',
        value: 'all',
        options: [
          { value: 'all', label: 'All Stock Levels' },
          { value: 'low', label: 'Low Stock Alerts' },
          { value: 'negative', label: 'Negative Stock' }
        ]
      }
    ],
    primaryAction: { label: 'Receive Opening Stock' }
  });

  const columns = [
    {
      key: 'product',
      label: 'Product / Variant',
      render: row => `
        <div>
          <div class="font-bold text-slate-800">${row.variant?.name || 'Unknown Variant'}</div>
          <div class="text-[10px] text-slate-400">Master: ${row.product?.businessName || ''} (${row.product?.customerName || ''})</div>
        </div>
      `
    },
    {
      key: 'sku',
      label: 'SKU',
      render: row => `<span class="font-bold text-[#138FCB]">${row.variant?.sku || '-'}</span>`
    },
    {
      key: 'warehouse',
      label: 'Warehouse',
      render: row => `<span class="px-2.5 py-0.5 rounded-lg bg-slate-100 text-slate-700 font-semibold text-[11px]">${row.warehouse?.name || 'Unassigned'}</span>`
    },
    {
      key: 'quantity',
      label: 'Available Balance',
      align: 'right',
      render: row => {
        const isNeg = row.quantity < 0;
        const isLow = row.isLowStock;
        return `
          <div class="flex items-center justify-end gap-1.5">
            <span class="text-sm font-extrabold ${isNeg ? 'text-rose-600' : isLow ? 'text-amber-600' : 'text-slate-900'}">
              ${Number(row.quantity).toLocaleString()}
            </span>
            <span class="text-[10px] text-slate-400 font-semibold uppercase">${row.unit || 'PCS'}</span>
            ${isLow ? '<span class="px-1.5 py-0.5 rounded text-[9px] font-bold bg-amber-100 text-amber-800">LOW</span>' : ''}
            ${isNeg ? '<span class="px-1.5 py-0.5 rounded text-[9px] font-bold bg-rose-100 text-rose-800">NEG</span>' : ''}
          </div>
        `;
      }
    },
    ...(canViewCost ? [
      {
        key: 'averageCost',
        label: 'Moving Avg Cost',
        align: 'right',
        render: row => `<span class="font-semibold text-slate-600">Rs. ${Math.round(Number(row.averageCost || 0)).toLocaleString()}</span>`
      },
      {
        key: 'stockValue',
        label: 'Total Stock Valuation',
        align: 'right',
        render: row => `<span class="font-bold text-slate-900">Rs. ${Math.round(Number(row.stockValue || 0)).toLocaleString()}</span>`
      }
    ] : [])
  ];

  const tableHtml = renderTable({
    columns,
    data: balances,
    emptyMessage: 'No stock recorded in selected warehouse.'
  });

  return `
    <div id="stock-view-container" class="space-y-5 animate-in fade-in duration-150">
      ${!canViewCost ? `
        <div class="bg-amber-50 border border-amber-200 text-amber-800 px-4 py-2.5 rounded-xl text-xs flex items-center justify-between">
          <div class="flex items-center gap-2">
            <span>🛡</span>
            <span>Financial security mode active for role <strong>${authService.getRoleDisplayName(authService.getRole())}</strong>. Cost and profit valuation figures are strictly hidden.</span>
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
    addBtn.onclick = () => openOpeningStockModal(refreshCallback);
  }

  const balances = inventoryService.getAllBalances();

  // Search input
  const searchInput = container.querySelector('#filter-search-input');
  if (searchInput) {
    searchInput.oninput = (e) => {
      const q = e.target.value.toLowerCase().trim();
      const filtered = balances.filter(b =>
        b.variant?.name.toLowerCase().includes(q) ||
        b.variant?.sku.toLowerCase().includes(q) ||
        b.product?.businessName.toLowerCase().includes(q) ||
        b.warehouse?.name.toLowerCase().includes(q)
      );
      updateStockTable(container, filtered);
    };
  }

  // Warehouse filter
  const whFilter = container.querySelector('#stock-warehouse-filter');
  if (whFilter) {
    whFilter.onchange = (e) => {
      const val = e.target.value;
      const filtered = val === 'all' ? balances : balances.filter(b => b.warehouseId === val);
      updateStockTable(container, filtered);
    };
  }
}

function updateStockTable(container, filteredData) {
  const tableContainer = container.querySelector('#stock-table-container');
  if (!tableContainer) return;
  const canViewCost = authService.canViewCostProfit();

  const columns = [
    { key: 'product', label: 'Product / Variant', render: row => `<div><div class="font-bold text-slate-800">${row.variant?.name || 'Unknown Variant'}</div><div class="text-[10px] text-slate-400">Master: ${row.product?.businessName || ''} (${row.product?.customerName || ''})</div></div>` },
    { key: 'sku', label: 'SKU', render: row => `<span class="font-bold text-[#138FCB]">${row.variant?.sku || '-'}</span>` },
    { key: 'warehouse', label: 'Warehouse', render: row => `<span class="px-2.5 py-0.5 rounded-lg bg-slate-100 text-slate-700 font-semibold text-[11px]">${row.warehouse?.name || 'Unassigned'}</span>` },
    { key: 'quantity', label: 'Available Balance', align: 'right', render: row => {
      const isNeg = row.quantity < 0;
      const isLow = row.isLowStock;
      return `<div class="flex items-center justify-end gap-1.5"><span class="text-sm font-extrabold ${isNeg ? 'text-rose-600' : isLow ? 'text-amber-600' : 'text-slate-900'}">${Number(row.quantity).toLocaleString()}</span><span class="text-[10px] text-slate-400 font-semibold uppercase">${row.unit || 'PCS'}</span>${isLow ? '<span class="px-1.5 py-0.5 rounded text-[9px] font-bold bg-amber-100 text-amber-800">LOW</span>' : ''}${isNeg ? '<span class="px-1.5 py-0.5 rounded text-[9px] font-bold bg-rose-100 text-rose-800">NEG</span>' : ''}</div>`;
    }},
    ...(canViewCost ? [
      { key: 'averageCost', label: 'Moving Avg Cost', align: 'right', render: row => `<span class="font-semibold text-slate-600">Rs. ${Math.round(Number(row.averageCost || 0)).toLocaleString()}</span>` },
      { key: 'stockValue', label: 'Total Stock Valuation', align: 'right', render: row => `<span class="font-bold text-slate-900">Rs. ${Math.round(Number(row.stockValue || 0)).toLocaleString()}</span>` }
    ] : [])
  ];

  tableContainer.innerHTML = renderTable({ columns, data: filteredData });
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
      modalEl.querySelector('#os-cancel-btn').onclick = () => closeModal();
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
            userId: authService.getCurrentUser().id
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
