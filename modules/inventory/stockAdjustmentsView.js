/**
 * JS Traders ERP - Stock Adjustments View
 * Supports physical inventory audit adjustments (Increase & Decrease)
 * with mandatory audit reason and automated stock movement posting.
 */

import { inventoryService } from '../../services/inventoryService.js';
import { productService } from '../../services/productService.js';
import { warehouseService } from '../../services/warehouseService.js';
import { authService } from '../../services/authService.js';
import { renderTable } from '../../components/table.js';
import { renderFilterBar } from '../../components/filters.js';
import { openModal, closeModal } from '../../components/modal.js';
import { toast } from '../../components/toast.js';

export function renderStockAdjustmentsView() {
  const adjustments = inventoryService.getStockAdjustments();
  const warehouses = warehouseService.getWarehouses();
  const variants = productService.getVariants();
  const whMap = new Map(warehouses.map(w => [w.id, w.name]));
  const varMap = new Map(variants.map(v => [v.id, v.name]));

  const filterBarHtml = renderFilterBar({
    searchPlaceholder: 'Search adjustments by number or reason...',
    primaryAction: { label: 'New Stock Adjustment' }
  });

  const columns = [
    {
      key: 'adjustmentNumber',
      label: 'Adjustment #',
      render: row => `<span class="font-bold text-[#138FCB]">${row.adjustmentNumber}</span>`
    },
    {
      key: 'date',
      label: 'Date',
      render: row => `<span class="text-slate-600 font-medium">${row.date}</span>`
    },
    {
      key: 'type',
      label: 'Adjustment Type',
      render: row => `
        <span class="px-2.5 py-0.5 rounded-full text-[10px] font-bold ${
          row.type === 'increase' ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'
        }">
          ${row.type === 'increase' ? '▲ Increase (+)' : '▼ Decrease (-)'}
        </span>
      `
    },
    {
      key: 'warehouseId',
      label: 'Warehouse',
      render: row => `<span class="font-medium text-slate-700">${whMap.get(row.warehouseId) || 'Main Warehouse'}</span>`
    },
    {
      key: 'items',
      label: 'Adjusted Items',
      render: row => `
        <div class="space-y-0.5">
          ${(row.lines || []).map(l => `
            <div class="text-slate-800 font-medium">
              ${varMap.get(l.variantId) || 'Variant'}: <strong>${l.quantity} ${l.unit || 'PCS'}</strong>
            </div>
          `).join('')}
        </div>
      `
    },
    {
      key: 'reason',
      label: 'Audit Reason',
      render: row => `<span class="text-slate-600 italic">${row.reason}</span>`
    },
    {
      key: 'status',
      label: 'Status',
      render: row => `
        <span class="px-2.5 py-0.5 rounded-full text-[10px] font-bold ${
          row.status === 'Confirmed' ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-600'
        }">
          ${row.status}
        </span>
      `
    }
  ];

  const tableHtml = renderTable({
    columns,
    data: adjustments,
    emptyMessage: 'No stock adjustments recorded.'
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
  const addBtn = container.querySelector('#filter-primary-btn');
  if (addBtn) {
    addBtn.onclick = () => openAdjustmentModal(refreshCallback);
  }
}

function openAdjustmentModal(onSaved) {
  const warehouses = warehouseService.getWarehouses();
  const variants = productService.getVariants();

  const contentHtml = `
    <form id="adjustment-form" class="space-y-4 text-xs">
      <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div>
          <label class="block font-bold text-slate-700 mb-1">Adjustment Type *</label>
          <select id="adj-type" required class="w-full border border-slate-200 rounded-xl px-3 py-2 text-slate-800 font-bold focus:outline-none focus:border-[#138FCB]">
            <option value="increase">Increase Stock (+)</option>
            <option value="decrease">Decrease Stock (-)</option>
          </select>
        </div>

        <div>
          <label class="block font-bold text-slate-700 mb-1">Warehouse *</label>
          <select id="adj-warehouse" required class="w-full border border-slate-200 rounded-xl px-3 py-2 text-slate-800 focus:outline-none focus:border-[#138FCB]">
            ${warehouses.map(w => `<option value="${w.id}">${w.name}</option>`).join('')}
          </select>
        </div>

        <div>
          <label class="block font-bold text-slate-700 mb-1">Variant / SKU *</label>
          <select id="adj-variant" required class="w-full border border-slate-200 rounded-xl px-3 py-2 text-slate-800 focus:outline-none focus:border-[#138FCB]">
            ${variants.map(v => `<option value="${v.id}">${v.name} (${v.sku})</option>`).join('')}
          </select>
        </div>
      </div>

      <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label class="block font-bold text-slate-700 mb-1">Adjustment Quantity *</label>
          <input type="number" id="adj-qty" required min="1" placeholder="e.g. 25" class="w-full border border-slate-200 rounded-xl px-3 py-2 text-slate-800 font-bold focus:outline-none focus:border-[#138FCB]">
        </div>

        <div>
          <label class="block font-bold text-slate-700 mb-1">Audit Reason / Justification *</label>
          <input type="text" id="adj-reason" required placeholder="e.g. Physical inventory variance, Damaged stock write-off" class="w-full border border-slate-200 rounded-xl px-3 py-2 text-slate-800 focus:outline-none focus:border-[#138FCB]">
        </div>
      </div>

      <div>
        <label class="block font-bold text-slate-700 mb-1">Detailed Inspection Notes</label>
        <textarea id="adj-notes" rows="2" placeholder="Details of discrepancy found during periodic warehouse cycle count..." class="w-full border border-slate-200 rounded-xl px-3 py-2 text-slate-800 focus:outline-none focus:border-[#138FCB]"></textarea>
      </div>

      <div class="p-3 bg-amber-50 border border-amber-200 rounded-xl text-[11px] text-amber-900">
        ⚠ <strong>Transactional Confirmation:</strong> Confirming this stock adjustment will immediately generate an immutable stock movement and recalculate physical balances.
      </div>

      <div class="flex justify-end gap-3 pt-4 border-t border-slate-100">
        <button type="button" id="adj-cancel-btn" class="px-4 py-2 text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-xl font-semibold transition-colors cursor-pointer">Cancel</button>
        <button type="submit" class="px-4 py-2 bg-[#138FCB] hover:bg-[#0E78AC] text-white rounded-xl font-semibold shadow-xs transition-colors cursor-pointer">Confirm & Post Adjustment</button>
      </div>
    </form>
  `;

  openModal({
    title: 'New Stock Adjustment',
    subtitle: 'Reconciles physical inventory discrepancies',
    contentHtml,
    size: 'max-w-2xl',
    onOpen: (modalEl) => {
      modalEl.querySelector('#adj-cancel-btn').onclick = () => closeModal();
      modalEl.querySelector('#adjustment-form').onsubmit = (e) => {
        e.preventDefault();
        const type = modalEl.querySelector('#adj-type').value;
        const warehouseId = modalEl.querySelector('#adj-warehouse').value;
        const variantId = modalEl.querySelector('#adj-variant').value;
        const quantity = Number(modalEl.querySelector('#adj-qty').value) || 0;
        const reason = modalEl.querySelector('#adj-reason').value.trim();
        const notes = modalEl.querySelector('#adj-notes').value.trim();

        if (quantity <= 0) {
          toast.show('Adjustment quantity must be greater than zero.', 'warning');
          return;
        }

        try {
          inventoryService.createStockAdjustment({
            type,
            warehouseId,
            reason,
            lines: [{ variantId, quantity, unit: 'PCS' }],
            notes,
            userId: authService.getCurrentUser().id
          });

          toast.show('Stock adjustment confirmed and ledger updated.', 'success');
          closeModal();
          if (onSaved) onSaved();
        } catch (err) {
          toast.show(err.message, 'error');
        }
      };
    }
  });
}
