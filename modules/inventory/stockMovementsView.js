/**
 * JS Traders ERP - Dedicated Stock Movements Ledger View
 * Authoritative Inventory Audit Trail tracking all inward and outward stock transactions.
 */

import { storageService } from '../../services/storageService.js';
import { productService } from '../../services/productService.js';
import { warehouseService } from '../../services/warehouseService.js';
import { renderTable } from '../../components/table.js';
import { renderFilterBar } from '../../components/filters.js';

export function renderStockMovementsView() {
  const movements = storageService.getCollection('stockMovements');
  const warehouses = warehouseService.getWarehouses();
  const variants = productService.getVariants();
  const whMap = new Map(warehouses.map(w => [w.id, w.name]));
  const varMap = new Map(variants.map(v => [v.id, v]));

  // Flatten movements and lines
  const flatRows = [];
  for (const m of movements) {
    for (const line of (m.lines || [])) {
      const v = varMap.get(line.variantId) || {};
      flatRows.push({
        id: `${m.id}-${line.variantId}`,
        movementNumber: m.movementNumber,
        date: m.date ? m.date.split('T')[0] : '2025-09-01',
        movementType: m.movementType,
        warehouse: whMap.get(m.warehouseId) || 'Main Warehouse',
        variantName: v.name || 'Equipment Item',
        sku: v.sku || '-',
        quantity: line.quantity,
        unit: line.unit || 'PCS',
        referenceDocType: m.referenceDocType || 'Direct Transaction',
        notes: line.notes || m.notes || '-'
      });
    }
  }

  const filterBarHtml = renderFilterBar({
    searchPlaceholder: 'Search movements by doc #, SKU, or type...',
    dropdowns: [
      {
        id: 'movement-type-filter',
        label: 'Movement Type',
        value: 'all',
        options: [
          { value: 'all', label: 'All Movement Types' },
          { value: 'stock_issue', label: 'Stock Issue (-)' },
          { value: 'stock_receipt', label: 'Stock Receipt (+)' },
          { value: 'opening_balance', label: 'Opening Balance' },
          { value: 'adjustment_increase', label: 'Adjustment (+)' },
          { value: 'adjustment_decrease', label: 'Adjustment (-)' },
          { value: 'assembly_output', label: 'Assembly Output' },
          { value: 'disassembly_consumption', label: 'Disassembly' }
        ]
      }
    ]
  });

  const columns = [
    {
      key: 'movementNumber',
      label: 'Movement #',
      render: row => `<span class="font-bold text-[#138FCB] font-mono">${row.movementNumber}</span>`
    },
    {
      key: 'date',
      label: 'Posting Date',
      render: row => `<span class="text-slate-600 font-medium font-mono">${row.date}</span>`
    },
    {
      key: 'movementType',
      label: 'Transaction Type',
      render: row => {
        const isPositive = row.quantity > 0;
        let displayLabel = row.movementType.replace(/_/g, ' ');
        let colorClass = isPositive ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-rose-50 text-rose-700 border border-rose-200';

        if (row.movementType === 'delivery' || row.movementType === 'stock_issue') {
          displayLabel = 'Stock Issue (-)';
          colorClass = 'bg-rose-50 text-rose-700 border border-rose-200 font-bold';
        } else if (row.movementType === 'receipt' || row.movementType === 'stock_receipt') {
          displayLabel = 'Stock Receipt (+)';
          colorClass = 'bg-emerald-50 text-emerald-700 border border-emerald-200 font-bold';
        } else if (row.movementType === 'opening_balance') {
          displayLabel = 'Opening Balance';
          colorClass = 'bg-blue-50 text-blue-700 border border-blue-200 font-semibold';
        }
        return `
          <span class="px-2 py-0.5 rounded text-[10px] font-bold uppercase ${colorClass}">
            ${displayLabel}
          </span>
        `;
      }
    },
    {
      key: 'warehouse',
      label: 'Warehouse',
      render: row => `<span class="font-medium text-slate-700">${row.warehouse}</span>`
    },
    {
      key: 'variant',
      label: 'Variant / SKU',
      render: row => `
        <div>
          <div class="font-bold text-slate-800">${row.variantName}</div>
          <div class="text-[10px] text-slate-400 font-mono">${row.sku}</div>
        </div>
      `
    },
    {
      key: 'quantity',
      label: 'Ledger Delta',
      align: 'right',
      render: row => {
        const isPos = row.quantity > 0;
        return `
          <span class="text-sm font-extrabold ${isPos ? 'text-emerald-600' : 'text-rose-600'}">
            ${isPos ? '+' : ''}${row.quantity} <span class="text-[10px] text-slate-400 font-semibold uppercase">${row.unit}</span>
          </span>
        `;
      }
    },
    {
      key: 'reference',
      label: 'Reference Source',
      render: row => `<span class="text-slate-500 font-medium text-[11px]">${row.referenceDocType}</span>`
    }
  ];

  const tableHtml = renderTable({
    columns,
    data: flatRows,
    emptyMessage: 'No stock movements recorded in ledger.'
  });

  return `
    <div id="stock-movements-container" class="space-y-5 animate-in fade-in duration-150">
      <div class="p-3.5 bg-blue-50/70 border border-blue-100 rounded-2xl flex items-center justify-between text-xs text-blue-900">
        <div class="flex items-center gap-2">
          <span>📜</span>
          <span><strong>Stock Source of Truth:</strong> Physical inventory balances are strictly derived from this immutable Stock Movement Ledger.</span>
        </div>
      </div>

      ${filterBarHtml}
      <div id="movements-table-container">
        ${tableHtml}
      </div>
    </div>
  `;
}

export function bindStockMovementsEvents(container, refreshCallback) {
  // Search input filter
  const searchInput = container.querySelector('#filter-search-input');
  const typeFilter = container.querySelector('#movement-type-filter');

  const filterRows = () => {
    const q = (searchInput ? searchInput.value : '').toLowerCase().trim();
    const typeVal = typeFilter ? typeFilter.value : 'all';
    const rows = container.querySelectorAll('tbody tr');

    rows.forEach(r => {
      const text = r.textContent.toLowerCase();
      let matchSearch = !q || text.includes(q);
      let matchType = true;
      if (typeVal !== 'all') {
        if (typeVal === 'stock_issue') matchType = text.includes('stock issue') || text.includes('delivery');
        else if (typeVal === 'stock_receipt') matchType = text.includes('stock receipt') || text.includes('receipt');
        else matchType = text.includes(typeVal.replace(/_/g, ' '));
      }
      r.style.display = (matchSearch && matchType) ? '' : 'none';
    });
  };

  if (searchInput) searchInput.oninput = filterRows;
  if (typeFilter) typeFilter.onchange = filterRows;
}
