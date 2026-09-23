/**
 * JS Traders ERP - Roll & Cut-to-Length Inventory View
 * Tracks continuous roll stock in feet, individual physical roll IDs,
 * and remaining continuous length per roll.
 */

import { inventoryService } from '../../services/inventoryService.js';
import { productService } from '../../services/productService.js';
import { warehouseService } from '../../services/warehouseService.js';
import { authService } from '../../services/authService.js';
import { renderTable, bindTableActions } from '../../components/table.js';
import { renderFilterBar } from '../../components/filters.js';
import { openModal, closeModal } from '../../components/modal.js';
import { toast } from '../../components/toast.js';

export function renderRollInventoryView() {
  const rolls = inventoryService.getPhysicalRolls();
  const variants = productService.getVariants();
  const warehouses = warehouseService.getWarehouses();
  const varMap = new Map(variants.map(v => [v.id, v]));
  const whMap = new Map(warehouses.map(w => [w.id, w.name]));

  const totalLength = rolls.reduce((sum, r) => sum + r.remainingLength, 0);
  const fullRolls = rolls.filter(r => r.isFull).length;
  const looseRolls = rolls.filter(r => !r.isFull).length;

  const filterBarHtml = renderFilterBar({
    searchPlaceholder: 'Search rolls by roll code or SKU...',
    primaryAction: { label: 'Cut Length from Roll' }
  });

  const columns = [
    {
      key: 'code',
      label: 'Roll ID / Tag',
      render: row => `<span class="font-bold text-[#138FCB]">${row.code}</span>`
    },
    {
      key: 'variant',
      label: 'Product Variant',
      render: row => {
        const v = varMap.get(row.variantId);
        return v ? `<span class="font-bold text-slate-800">${v.name} (${v.sku})</span>` : '-';
      }
    },
    {
      key: 'warehouse',
      label: 'Warehouse',
      render: row => `<span class="font-medium text-slate-700">${whMap.get(row.warehouseId) || 'Main Warehouse'}</span>`
    },
    {
      key: 'initialLength',
      label: 'Initial Full Length',
      align: 'right',
      render: row => `<span class="text-slate-500 font-medium">${Number(row.initialLength).toLocaleString()} ft</span>`
    },
    {
      key: 'remainingLength',
      label: 'Remaining Length',
      align: 'right',
      render: row => `<span class="font-extrabold text-slate-900 text-sm">${Number(row.remainingLength).toLocaleString()} ft</span>`
    },
    {
      key: 'status',
      label: 'Roll Status',
      render: row => row.isFull
        ? `<span class="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700">Full Sealed Roll</span>`
        : `<span class="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-amber-50 text-amber-700">Partial / Loose (${Number(row.remainingLength).toLocaleString()} ft remaining)</span>`
    }
  ];

  const actions = [
    { label: 'Cut Length', variant: 'primary', onClick: (row) => openCutModal(row) }
  ];

  const tableHtml = renderTable({
    columns,
    data: rolls,
    actions,
    emptyMessage: 'No rolls registered in roll tracking.'
  });

  return `
    <div id="roll-inventory-container" class="space-y-6 animate-in fade-in duration-150">
      <!-- Metric Summary Banner -->
      <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div class="bg-white p-4 rounded-2xl border border-slate-200 shadow-2xs">
          <span class="text-[10px] font-bold uppercase tracking-wider text-slate-400">Total Measured Stock</span>
          <p class="text-2xl font-extrabold text-[#138FCB] mt-1">${totalLength.toLocaleString()} <span class="text-xs font-semibold text-slate-500">feet</span></p>
        </div>
        <div class="bg-white p-4 rounded-2xl border border-slate-200 shadow-2xs">
          <span class="text-[10px] font-bold uppercase tracking-wider text-slate-400">Full Standard Rolls</span>
          <p class="text-2xl font-extrabold text-emerald-600 mt-1">${fullRolls} <span class="text-xs font-semibold text-slate-500">rolls (5,000 ft each)</span></p>
        </div>
        <div class="bg-white p-4 rounded-2xl border border-slate-200 shadow-2xs">
          <span class="text-[10px] font-bold uppercase tracking-wider text-slate-400">Loose / Partial Rolls</span>
          <p class="text-2xl font-extrabold text-amber-600 mt-1">${looseRolls} <span class="text-xs font-semibold text-slate-500">open pieces</span></p>
        </div>
      </div>

      ${filterBarHtml}
      <div id="roll-table-container">
        ${tableHtml}
      </div>
    </div>
  `;
}

export function bindRollInventoryEvents(container, refreshCallback) {
  const addBtn = container.querySelector('#filter-primary-btn');
  if (addBtn) {
    addBtn.onclick = () => openCutModal(null, refreshCallback);
  }

  const rolls = inventoryService.getPhysicalRolls();
  const actions = [
    { label: 'Cut Length', onClick: (row) => openCutModal(row, refreshCallback) }
  ];
  bindTableActions(container, actions, rolls);
}

function openCutModal(roll = null, onSaved) {
  const rolls = inventoryService.getPhysicalRolls().filter(r => r.remainingLength > 0);
  const selectedRoll = roll || rolls[0];

  const contentHtml = `
    <form id="cut-roll-form" class="space-y-4 text-xs">
      <div>
        <label class="block font-bold text-slate-700 mb-1">Select Physical Roll *</label>
        <select id="cut-roll-select" required class="w-full border border-slate-200 rounded-xl px-3 py-2 text-slate-800 font-bold focus:outline-none focus:border-[#138FCB]">
          ${rolls.map(r => `
            <option value="${r.id}" ${selectedRoll && selectedRoll.id === r.id ? 'selected' : ''}>
              ${r.code} - Remaining: ${r.remainingLength.toLocaleString()} ft (${r.isFull ? 'Full Roll' : 'Loose Piece'})
            </option>
          `).join('')}
        </select>
      </div>

      <div>
        <label class="block font-bold text-slate-700 mb-1">Cut Length to Deduct (Feet) *</label>
        <input type="number" id="cut-length" required min="1" max="${selectedRoll ? selectedRoll.remainingLength : 5000}" placeholder="e.g. 1000" class="w-full border border-slate-200 rounded-xl px-3 py-2 text-slate-800 font-extrabold text-sm focus:outline-none focus:border-[#138FCB]">
        <p class="text-[10px] text-slate-400 mt-1">Acceptance Demo: Cutting 1,000 ft from a 5,000 ft roll leaves 4,000 ft loose roll.</p>
      </div>

      <div>
        <label class="block font-bold text-slate-700 mb-1">Customer / Dispatch Order Reference</label>
        <input type="text" id="cut-reference" placeholder="e.g. Cut for Sales Order SO-00001 (Ali Poultry)" class="w-full border border-slate-200 rounded-xl px-3 py-2 text-slate-800 focus:outline-none focus:border-[#138FCB]">
      </div>

      <div class="flex justify-end gap-3 pt-4 border-t border-slate-100">
        <button type="button" id="cut-cancel-btn" class="px-4 py-2 text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-xl font-semibold transition-colors cursor-pointer">Cancel</button>
        <button type="submit" class="px-4 py-2 bg-[#138FCB] hover:bg-[#0E78AC] text-white rounded-xl font-semibold shadow-xs transition-colors cursor-pointer">Execute Cut & Deduct Stock</button>
      </div>
    </form>
  `;

  openModal({
    title: 'Cut-to-Length Dispatch',
    subtitle: 'Deducts precise length and creates remaining loose piece',
    contentHtml,
    size: 'max-w-md',
    onOpen: (modalEl) => {
      modalEl.querySelector('#cut-cancel-btn').onclick = () => closeModal();
      modalEl.querySelector('#cut-roll-form').onsubmit = (e) => {
        e.preventDefault();
        const rollId = modalEl.querySelector('#cut-roll-select').value;
        const cutLength = Number(modalEl.querySelector('#cut-length').value) || 0;
        const notes = modalEl.querySelector('#cut-reference').value.trim();

        try {
          inventoryService.cutFromRoll({
            rollId,
            cutLengthFeet: cutLength,
            notes,
            userId: authService.getCurrentUser().id
          });

          toast.show(`Deducted ${cutLength} ft from roll. Remaining length recorded.`, 'success');
          closeModal();
          if (onSaved) onSaved();
        } catch (err) {
          toast.show(err.message, 'error');
        }
      };
    }
  });
}
