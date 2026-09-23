/**
 * JS Traders ERP - Import Shipments & Landed Cost Engine View
 * Supports FOB / EXW terms, container tracking with Tracktainer credit deduction,
 * and dynamic Landed Cost allocation across shipments.
 */

import { purchasingService } from '../../services/purchasingService.js';
import { trackingService } from '../../services/trackingService.js';
import { salesService } from '../../services/salesService.js';
import { renderTable, bindTableActions } from '../../components/table.js';
import { renderFilterBar } from '../../components/filters.js';
import { openModal, closeModal } from '../../components/modal.js';
import { confirmAction } from '../../components/confirmation.js';
import { toast } from '../../components/toast.js';

export function renderImportShipmentsView() {
  const shipments = purchasingService.getImportShipments();
  const suppliers = salesService.getParties(false, true);
  const suppMap = new Map(suppliers.map(s => [s.id, s.name]));

  const filterBarHtml = renderFilterBar({
    searchPlaceholder: 'Search shipments by container # or BL...',
    dropdowns: [
      {
        id: 'shipment-term-filter',
        label: 'Term',
        value: 'all',
        options: [
          { value: 'all', label: 'All Terms' },
          { value: 'FOB', label: 'FOB (Free on Board)' },
          { value: 'EXW', label: 'EXW (Ex Works Factory)' }
        ]
      }
    ],
    primaryAction: { label: 'New Import Shipment' }
  });

  const columns = [
    {
      key: 'shipmentNumber',
      label: 'Shipment #',
      render: row => `<span class="font-bold text-[#138FCB]">${row.shipmentNumber}</span>`
    },
    {
      key: 'supplier',
      label: 'Supplier / Origin',
      render: row => `
        <div>
          <div class="font-bold text-slate-800">${suppMap.get(row.supplierPartyId) || 'Supplier'}</div>
          <div class="text-[10px] text-slate-400">${row.originPort} → ${row.destinationPort}</div>
        </div>
      `
    },
    {
      key: 'shippingTerm',
      label: 'Term',
      render: row => `
        <span class="px-2 py-0.5 rounded text-[10px] font-bold ${row.shippingTerm === 'FOB' ? 'bg-blue-50 text-blue-700' : 'bg-amber-50 text-amber-700'}">
          ${row.shippingTerm}
        </span>
      `
    },
    {
      key: 'container',
      label: 'Container / Tracking',
      render: row => `
        <div>
          <div class="font-semibold text-slate-800">${row.containerNumber}</div>
          <div class="text-[10px] text-slate-500 font-medium truncate max-w-xs">${row.currentLocation || 'In Transit'}</div>
        </div>
      `
    },
    {
      key: 'status',
      label: 'Shipment Status',
      render: row => `
        <span class="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-blue-50 text-[#138FCB]">
          ${row.status}
        </span>
      `
    }
  ];

  const actions = [
    {
      label: 'Tracktainer Sync',
      variant: 'primary',
      onClick: (row) => handleTracktainerSync(row)
    },
    {
      label: 'Landed Cost',
      variant: 'emerald',
      onClick: (row) => openLandedCostModal(row)
    }
  ];

  const tableHtml = renderTable({
    columns,
    data: shipments,
    actions,
    emptyMessage: 'No import shipments registered.'
  });

  return `
    <div id="shipments-view-container" class="space-y-5 animate-in fade-in duration-150">
      ${filterBarHtml}
      <div id="shipments-table-container">
        ${tableHtml}
      </div>
    </div>
  `;
}

export function bindImportShipmentsEvents(container, refreshCallback) {
  const shipments = purchasingService.getImportShipments();
  const actions = [
    { label: 'Tracktainer Sync', onClick: (row) => handleTracktainerSync(row, refreshCallback) },
    { label: 'Landed Cost', onClick: (row) => openLandedCostModal(row, refreshCallback) }
  ];
  bindTableActions(container, actions, shipments);
}

function handleTracktainerSync(shipment, refreshCallback) {
  confirmAction({
    title: 'Tracktainer Credit Consumption',
    message: `This action will consume 1 Tracktainer credit. Remaining balance: ${shipment.remainingCredits || 14} credits. Do you want to continue?`,
    confirmLabel: 'Sync Now (1 Credit)',
    isDestructive: false,
    onConfirm: async () => {
      try {
        const res = await trackingService.syncShipment(shipment.id);
        toast.show(`Tracktainer synced! Location: ${res.currentLocation}. Credits left: ${res.remainingCredits}`, 'success');
        if (refreshCallback) refreshCallback();
      } catch (err) {
        toast.show(err.message, 'error');
      }
    }
  });
}

function openLandedCostModal(shipment, onSaved) {
  const expenses = shipment.expenses || [];
  const totalLandedPkr = expenses.reduce((s, e) => s + (Number(e.amountPkr) || 0), 0);

  const contentHtml = `
    <div class="space-y-5 text-xs">
      <div class="p-3.5 bg-slate-50 rounded-xl border border-slate-200 flex justify-between items-start">
        <div>
          <span class="text-[10px] font-bold uppercase tracking-wider text-slate-400">Import Shipment</span>
          <h3 class="text-base font-extrabold text-slate-900 mt-0.5">${shipment.shipmentNumber} (${shipment.containerNumber})</h3>
          <p class="text-slate-500 mt-0.5">Shipping Term: <strong>${shipment.shippingTerm}</strong> | Carrier: ${shipment.carrierName}</p>
        </div>
        <div class="text-right">
          <span class="text-[10px] font-bold uppercase tracking-wider text-slate-400">Total Landed Costs</span>
          <p class="text-xl font-extrabold text-[#138FCB] mt-0.5">Rs. ${totalLandedPkr.toLocaleString()}</p>
        </div>
      </div>

      <!-- Landed Cost Eligible Expenses Breakdown -->
      <div>
        <h4 class="font-bold text-slate-700 mb-2">Landed Cost Eligible Expense Items</h4>
        <div class="border border-slate-200 rounded-xl overflow-hidden divide-y divide-slate-100">
          ${expenses.map(e => `
            <div class="p-3 flex justify-between items-center text-xs">
              <div class="flex items-center gap-2">
                <span class="w-2 h-2 rounded-full bg-emerald-500"></span>
                <span class="font-semibold text-slate-800">${e.name}</span>
              </div>
              <span class="font-bold text-slate-900">Rs. ${Number(e.amountPkr).toLocaleString()}</span>
            </div>
          `).join('')}
        </div>
      </div>

      <!-- Configurable Allocation Method -->
      <div class="p-3 bg-blue-50 border border-blue-100 rounded-xl space-y-2">
        <label class="block font-bold text-blue-900">Landed Cost Allocation Method</label>
        <div class="grid grid-cols-4 gap-2">
          ${['Value', 'Quantity', 'Weight', 'Volume'].map(m => `
            <label class="flex items-center gap-1.5 p-2 bg-white rounded-lg border border-blue-200 text-xs font-semibold cursor-pointer">
              <input type="radio" name="allocationMethod" value="${m}" ${m === (shipment.allocationMethod || 'Value') ? 'checked' : ''} class="text-[#138FCB]">
              <span>${m}</span>
            </label>
          `).join('')}
        </div>
      </div>

      <div class="flex justify-end gap-3 pt-4 border-t border-slate-100">
        <button id="lc-cancel-btn" class="px-4 py-2 text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-xl font-semibold transition-colors cursor-pointer">Close</button>
        <button id="lc-apply-btn" class="px-4 py-2 bg-[#138FCB] hover:bg-[#0E78AC] text-white rounded-xl font-semibold shadow-xs transition-colors cursor-pointer">Recalculate Landed Inventory Costs</button>
      </div>
    </div>
  `;

  openModal({
    title: `Landed Cost Engine: ${shipment.shipmentNumber}`,
    subtitle: 'Allocates ocean freight, customs taxes, and port clearance into inventory valuation',
    contentHtml,
    size: 'max-w-xl',
    onOpen: (modalEl) => {
      modalEl.querySelector('#lc-cancel-btn').onclick = () => closeModal();
      modalEl.querySelector('#lc-apply-btn').onclick = () => {
        const method = modalEl.querySelector('input[name="allocationMethod"]:checked').value;
        purchasingService.allocateLandedCost(shipment.id, method);
        toast.show(`Landed costs allocated across goods inventory by ${method}.`, 'success');
        closeModal();
        if (onSaved) onSaved();
      };
    }
  });
}
