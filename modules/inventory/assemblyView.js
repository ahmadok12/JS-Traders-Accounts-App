/**
 * JS Traders ERP - Assembly & Disassembly View
 * Flexible BOM Engine: Assembles finished equipment (e.g. Air Cooler 1.5 kW)
 * by consuming components (Motor, Fan, Pump) and calculates true finished cost.
 * Disassembly returns components to stock.
 */

import { assemblyService } from '../../services/assemblyService.js';
import { productService } from '../../services/productService.js';
import { warehouseService } from '../../services/warehouseService.js';
import { inventoryService } from '../../services/inventoryService.js';
import { authService } from '../../services/authService.js';
import { renderTable } from '../../components/table.js';
import { renderFilterBar } from '../../components/filters.js';
import { openModal, closeModal } from '../../components/modal.js';
import { toast } from '../../components/toast.js';

export function renderAssemblyView() {
  const assemblies = assemblyService.getAssemblies();
  const warehouses = warehouseService.getWarehouses();
  const variants = productService.getVariants();
  const whMap = new Map(warehouses.map(w => [w.id, w.name]));
  const varMap = new Map(variants.map(v => [v.id, v.name]));
  const canViewCost = authService.canViewCostProfit();

  const filterBarHtml = renderFilterBar({
    searchPlaceholder: 'Search assemblies by doc number...',
    primaryAction: { label: 'New Assembly Build' },
    secondaryAction: { label: 'Disassembly Item', icon: '🔄' }
  });

  const columns = [
    {
      key: 'assemblyNumber',
      label: 'Assembly #',
      render: row => `<span class="font-bold text-[#138FCB]">${row.assemblyNumber}</span>`
    },
    {
      key: 'assemblyDate',
      label: 'Date',
      render: row => `<span class="text-slate-600 font-medium">${row.assemblyDate}</span>`
    },
    {
      key: 'finishedGood',
      label: 'Produced Finished Good',
      render: row => `
        <div>
          <div class="font-bold text-slate-800">${varMap.get(row.finishedVariantId) || 'Finished Good'}</div>
          <div class="text-[11px] font-semibold text-emerald-600">+ ${row.finishedQuantity} Units Created</div>
        </div>
      `
    },
    {
      key: 'warehouseId',
      label: 'Warehouse',
      render: row => `<span class="font-medium text-slate-700">${whMap.get(row.warehouseId) || 'Main Warehouse'}</span>`
    },
    {
      key: 'components',
      label: 'Consumed Components',
      render: row => `
        <div class="space-y-0.5 text-[11px]">
          ${(row.lines || []).map(l => `
            <div class="text-slate-600">
              ● ${varMap.get(l.componentVariantId) || 'Component'}: <strong class="text-rose-600">-${l.quantityConsumed} ${l.unit || 'PCS'}</strong>
            </div>
          `).join('')}
        </div>
      `
    },
    ...(canViewCost ? [
      {
        key: 'unitFinishedCost',
        label: 'Unit Finished Cost',
        align: 'right',
        render: row => `<span class="font-bold text-slate-900">Rs. ${Number(row.unitFinishedCost || 0).toLocaleString()}</span>`
      }
    ] : []),
    {
      key: 'status',
      label: 'Status',
      render: row => `
        <span class="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700">
          ${row.status}
        </span>
      `
    }
  ];

  const tableHtml = renderTable({
    columns,
    data: assemblies,
    emptyMessage: 'No equipment assemblies completed yet.'
  });

  return `
    <div id="assembly-view-container" class="space-y-5 animate-in fade-in duration-150">
      ${filterBarHtml}
      <div id="assembly-table-container">
        ${tableHtml}
      </div>
    </div>
  `;
}

export function bindAssemblyEvents(container, refreshCallback) {
  const addBtn = container.querySelector('#filter-primary-btn');
  if (addBtn) {
    addBtn.onclick = () => openAssemblyModal(refreshCallback);
  }

  const disBtn = container.querySelector('#filter-secondary-btn');
  if (disBtn) {
    disBtn.onclick = () => openDisassemblyModal(refreshCallback);
  }
}

function openAssemblyModal(onSaved) {
  const warehouses = warehouseService.getWarehouses();
  const variants = productService.getVariants();
  const finishedVariants = variants.filter(v => v.sku.includes('AC-') || v.name.includes('Cooler') || v.name.includes('Set'));
  const componentVariants = variants.filter(v => !finishedVariants.some(f => f.id === v.id));

  const contentHtml = `
    <form id="assembly-modal-form" class="space-y-4 text-xs">
      <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div>
          <label class="block font-bold text-slate-700 mb-1">Production Warehouse *</label>
          <select id="asm-warehouse" required class="w-full border border-slate-200 rounded-xl px-3 py-2 text-slate-800 focus:outline-none focus:border-[#138FCB]">
            ${warehouses.map(w => `<option value="${w.id}">${w.name}</option>`).join('')}
          </select>
        </div>

        <div>
          <label class="block font-bold text-slate-700 mb-1">Target Finished Variant *</label>
          <select id="asm-finished-var" required class="w-full border border-slate-200 rounded-xl px-3 py-2 text-slate-800 font-bold focus:outline-none focus:border-[#138FCB]">
            ${(finishedVariants.length > 0 ? finishedVariants : variants).map(v => `<option value="${v.id}">${v.name} (${v.sku})</option>`).join('')}
          </select>
        </div>

        <div>
          <label class="block font-bold text-slate-700 mb-1">Output Quantity to Produce *</label>
          <input type="number" id="asm-qty" required min="1" value="1" class="w-full border border-slate-200 rounded-xl px-3 py-2 text-slate-800 font-bold focus:outline-none focus:border-[#138FCB]">
        </div>
      </div>

      <!-- Flexible Bill of Materials Lines -->
      <div class="p-3.5 bg-slate-50 rounded-xl border border-slate-200 space-y-3">
        <div class="flex items-center justify-between">
          <span class="text-[11px] font-bold text-slate-700 uppercase tracking-wider">Flexible Bill of Materials (BOM)</span>
          <span class="text-[10px] text-slate-400">Actual components consumed for this specific build</span>
        </div>

        <div id="bom-lines-container" class="space-y-2">
          <!-- Line 1: Motor -->
          <div class="bom-line grid grid-cols-12 gap-2 items-center bg-white p-2.5 rounded-lg border border-slate-200">
            <div class="col-span-6">
              <label class="block text-[10px] font-semibold text-slate-500 mb-0.5">Component Variant</label>
              <select class="bom-comp-var w-full border border-slate-200 rounded px-2 py-1 text-slate-800">
                ${variants.map(v => `<option value="${v.id}" ${v.sku === 'MOT-15KW' ? 'selected' : ''}>${v.name} (${v.sku})</option>`).join('')}
              </select>
            </div>
            <div class="col-span-3">
              <label class="block text-[10px] font-semibold text-slate-500 mb-0.5">Qty Consumed</label>
              <input type="number" min="1" value="1" class="bom-comp-qty w-full border border-slate-200 rounded px-2 py-1 text-slate-800 font-bold">
            </div>
            <div class="col-span-3">
              <label class="block text-[10px] font-semibold text-slate-500 mb-0.5">Unit Cost (PKR)</label>
              <input type="number" min="0" value="18500" class="bom-comp-cost w-full border border-slate-200 rounded px-2 py-1 text-slate-800">
            </div>
          </div>

          <!-- Line 2: Fan Blade -->
          <div class="bom-line grid grid-cols-12 gap-2 items-center bg-white p-2.5 rounded-lg border border-slate-200">
            <div class="col-span-6">
              <select class="bom-comp-var w-full border border-slate-200 rounded px-2 py-1 text-slate-800">
                ${variants.map(v => `<option value="${v.id}" ${v.sku === 'FAN-50IN' ? 'selected' : ''}>${v.name} (${v.sku})</option>`).join('')}
              </select>
            </div>
            <div class="col-span-3">
              <input type="number" min="1" value="1" class="bom-comp-qty w-full border border-slate-200 rounded px-2 py-1 text-slate-800 font-bold">
            </div>
            <div class="col-span-3">
              <input type="number" min="0" value="9500" class="bom-comp-cost w-full border border-slate-200 rounded px-2 py-1 text-slate-800">
            </div>
          </div>

          <!-- Line 3: Submersible Pump -->
          <div class="bom-line grid grid-cols-12 gap-2 items-center bg-white p-2.5 rounded-lg border border-slate-200">
            <div class="col-span-6">
              <select class="bom-comp-var w-full border border-slate-200 rounded px-2 py-1 text-slate-800">
                ${variants.map(v => `<option value="${v.id}" ${v.sku === 'PMP-SUB' ? 'selected' : ''}>${v.name} (${v.sku})</option>`).join('')}
              </select>
            </div>
            <div class="col-span-3">
              <input type="number" min="1" value="1" class="bom-comp-qty w-full border border-slate-200 rounded px-2 py-1 text-slate-800 font-bold">
            </div>
            <div class="col-span-3">
              <input type="number" min="0" value="3800" class="bom-comp-cost w-full border border-slate-200 rounded px-2 py-1 text-slate-800">
            </div>
          </div>
        </div>
      </div>

      <div>
        <label class="block font-bold text-slate-700 mb-1">Assembly Notes / Batch Number</label>
        <input type="text" id="asm-notes" placeholder="e.g. Assembled for Ali Poultry Bhai Pheru site" class="w-full border border-slate-200 rounded-xl px-3 py-2 text-slate-800 focus:outline-none focus:border-[#138FCB]">
      </div>

      <div class="p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-[11px] text-emerald-900">
        ⚙ <strong>Atomic Stock Transformation:</strong> Component items are deducted immediately from raw materials, and finished goods inventory is increased with computed unit costs.
      </div>

      <div class="flex justify-end gap-3 pt-4 border-t border-slate-100">
        <button type="button" id="asm-cancel-btn" class="px-4 py-2 text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-xl font-semibold transition-colors cursor-pointer">Cancel</button>
        <button type="submit" class="px-4 py-2 bg-[#138FCB] hover:bg-[#0E78AC] text-white rounded-xl font-semibold shadow-xs transition-colors cursor-pointer">Confirm Assembly Build</button>
      </div>
    </form>
  `;

  openModal({
    title: 'Confirm Assembly Production',
    subtitle: 'Consumes raw components and generates finished inventory',
    contentHtml,
    size: 'max-w-2xl',
    onOpen: (modalEl) => {
      modalEl.querySelector('#asm-cancel-btn').onclick = () => closeModal();
      modalEl.querySelector('#assembly-modal-form').onsubmit = (e) => {
        e.preventDefault();
        const warehouseId = modalEl.querySelector('#asm-warehouse').value;
        const finishedVariantId = modalEl.querySelector('#asm-finished-var').value;
        const finishedQuantity = Number(modalEl.querySelector('#asm-qty').value) || 1;
        const notes = modalEl.querySelector('#asm-notes').value.trim();

        const bomLines = [];
        modalEl.querySelectorAll('.bom-line').forEach(lineEl => {
          const compVarId = lineEl.querySelector('.bom-comp-var').value;
          const qty = Number(lineEl.querySelector('.bom-comp-qty').value) || 1;
          const cost = Number(lineEl.querySelector('.bom-comp-cost').value) || 0;
          bomLines.push({
            componentVariantId: compVarId,
            quantityConsumed: qty,
            unitCost: cost,
            unit: 'PCS'
          });
        });

        try {
          assemblyService.confirmAssembly({
            warehouseId,
            finishedVariantId,
            finishedQuantity,
            lines: bomLines,
            notes,
            userId: authService.getCurrentUser().id
          });

          toast.show(`Successfully produced ${finishedQuantity} finished units. Component stock deducted.`, 'success');
          closeModal();
          if (onSaved) onSaved();
        } catch (err) {
          toast.show(err.message, 'error');
        }
      };
    }
  });
}

function openDisassemblyModal(onSaved) {
  const warehouses = warehouseService.getWarehouses();
  const variants = productService.getVariants();
  const coolerVariant = variants.find(v => v.sku === 'AC-15KW-PAD') || variants[0];

  const contentHtml = `
    <form id="disassembly-form" class="space-y-4 text-xs">
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label class="block font-bold text-slate-700 mb-1">Warehouse *</label>
          <select id="dis-warehouse" required class="w-full border border-slate-200 rounded-xl px-3 py-2 text-slate-800">
            ${warehouses.map(w => `<option value="${w.id}">${w.name}</option>`).join('')}
          </select>
        </div>

        <div>
          <label class="block font-bold text-slate-700 mb-1">Finished Good to Disassemble *</label>
          <select id="dis-finished-var" required class="w-full border border-slate-200 rounded-xl px-3 py-2 text-slate-800 font-bold">
            <option value="${coolerVariant.id}">${coolerVariant.name} (${coolerVariant.sku})</option>
          </select>
        </div>
      </div>

      <div>
        <label class="block font-bold text-slate-700 mb-1">Quantity to Disassemble *</label>
        <input type="number" id="dis-qty" required min="1" value="1" class="w-full border border-slate-200 rounded-xl px-3 py-2 text-slate-800 font-bold">
      </div>

      <div class="p-3 bg-amber-50 border border-amber-200 rounded-xl text-[11px] text-amber-900">
        🔄 <strong>Component Restoration:</strong> Disassembly will remove 1 Finished Air Cooler from inventory and restore 1 Motor, 1 Fan Blade, and 1 Pump back into stock.
      </div>

      <div class="flex justify-end gap-3 pt-4 border-t border-slate-100">
        <button type="button" id="dis-cancel-btn" class="px-4 py-2 text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-xl font-semibold transition-colors cursor-pointer">Cancel</button>
        <button type="submit" class="px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white rounded-xl font-semibold shadow-xs transition-colors cursor-pointer">Confirm Disassembly</button>
      </div>
    </form>
  `;

  openModal({
    title: 'Disassembly Finished Equipment',
    subtitle: 'Deducts finished good and restores component inventory',
    contentHtml,
    size: 'max-w-xl',
    onOpen: (modalEl) => {
      modalEl.querySelector('#dis-cancel-btn').onclick = () => closeModal();
      modalEl.querySelector('#disassembly-form').onsubmit = (e) => {
        e.preventDefault();
        const warehouseId = modalEl.querySelector('#dis-warehouse').value;
        const finishedVariantId = modalEl.querySelector('#dis-finished-var').value;
        const finishedQuantity = Number(modalEl.querySelector('#dis-qty').value) || 1;

        const motorVar = variants.find(v => v.sku === 'MOT-15KW');
        const fanVar = variants.find(v => v.sku === 'FAN-50IN');
        const pumpVar = variants.find(v => v.sku === 'PMP-SUB');

        const restored = [
          { componentVariantId: motorVar.id, quantityRestored: 1 * finishedQuantity, unitCost: 18500, unit: 'PCS' },
          { componentVariantId: fanVar.id, quantityRestored: 1 * finishedQuantity, unitCost: 9500, unit: 'PCS' },
          { componentVariantId: pumpVar.id, quantityRestored: 1 * finishedQuantity, unitCost: 3800, unit: 'PCS' }
        ];

        try {
          assemblyService.confirmDisassembly({
            warehouseId,
            finishedVariantId,
            finishedQuantity,
            restoredComponents: restored,
            notes: 'Disassembled unit',
            userId: authService.getCurrentUser().id
          });

          toast.show('Disassembly confirmed. Finished unit removed, components restored.', 'success');
          closeModal();
          if (onSaved) onSaved();
        } catch (err) {
          toast.show(err.message, 'error');
        }
      };
    }
  });
}
