/**
 * JS Traders ERP - Import Shipments & Landed Cost Engine View
 * Supports FOB / EXW terms, container tracking with Tracktainer credit deduction,
 * View modal with expense itemization, and dynamic Landed Cost allocation.
 */

import { purchasingService } from '../../services/purchasingService.js';
import { trackingService } from '../../services/trackingService.js';
import { salesService } from '../../services/salesService.js';
import { storageService } from '../../services/storageService.js';
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
    primaryAction: { label: '+ New Import Shipment' }
  });

  const columns = [
    {
      key: 'shipmentNumber',
      label: 'Shipment #',
      render: row => `<span class="font-bold text-[#138FCB] font-mono">${row.shipmentNumber}</span>`
    },
    {
      key: 'supplier',
      label: 'Supplier / Origin',
      render: row => `
        <div>
          <div class="font-bold text-slate-800">${suppMap.get(row.supplierPartyId) || 'Supplier'}</div>
          <div class="text-[10px] text-slate-400 font-medium">${row.originPort} → ${row.destinationPort}</div>
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
          <div class="font-semibold text-slate-800 font-mono">${row.containerNumber}</div>
          <div class="text-[10px] text-slate-500 font-medium truncate max-w-xs">${row.currentLocation || 'In Transit'}</div>
        </div>
      `
    },
    {
      key: 'status',
      label: 'Shipment Status',
      render: row => `
        <span class="px-2.5 py-0.5 rounded-full text-[10px] font-bold ${
          row.status === 'Cancelled' ? 'bg-rose-50 text-rose-700 border border-rose-200' :
          row.status === 'Arrived' ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' :
          'bg-blue-50 text-[#138FCB] border border-blue-200'
        }">
          ${row.status}
        </span>
      `
    }
  ];

  const actions = [
    { label: 'View', variant: 'secondary' },
    { label: 'Landed Cost', variant: 'secondary' },
    { label: 'Tracktainer Sync', variant: 'primary' }
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
    { label: 'View', variant: 'secondary', onClick: (row) => openShipmentDetailModal(row, refreshCallback) },
    { label: 'Landed Cost', variant: 'secondary', onClick: (row) => openLandedCostModal(row, refreshCallback) },
    { label: 'Tracktainer Sync', onClick: (row) => handleTracktainerSync(row, refreshCallback) }
  ];
  bindTableActions(container, actions, shipments);

  const searchInput = container.querySelector('#filter-search-input');
  if (searchInput) {
    searchInput.oninput = (e) => {
      const q = e.target.value.toLowerCase().trim();
      const filtered = shipments.filter(s =>
        s.shipmentNumber.toLowerCase().includes(q) ||
        s.containerNumber.toLowerCase().includes(q)
      );
      updateShipmentsTable(container, filtered, refreshCallback);
    };
  }
}

function updateShipmentsTable(container, filteredData, refreshCallback) {
  const tableContainer = container.querySelector('#shipments-table-container');
  if (!tableContainer) return;

  const suppliers = salesService.getParties(false, true);
  const suppMap = new Map(suppliers.map(s => [s.id, s.name]));

  const columns = [
    { key: 'shipmentNumber', label: 'Shipment #', render: row => `<span class="font-bold text-[#138FCB] font-mono">${row.shipmentNumber}</span>` },
    {
      key: 'supplier',
      label: 'Supplier / Origin',
      render: row => `<div><div class="font-bold text-slate-800">${suppMap.get(row.supplierPartyId) || 'Supplier'}</div><div class="text-[10px] text-slate-400 font-medium">${row.originPort} → ${row.destinationPort}</div></div>`
    },
    { key: 'shippingTerm', label: 'Term', render: row => `<span class="px-2 py-0.5 rounded text-[10px] font-bold ${row.shippingTerm === 'FOB' ? 'bg-blue-50 text-blue-700' : 'bg-amber-50 text-amber-700'}">${row.shippingTerm}</span>` },
    {
      key: 'container',
      label: 'Container / Tracking',
      render: row => `<div><div class="font-semibold text-slate-800 font-mono">${row.containerNumber}</div><div class="text-[10px] text-slate-500 font-medium truncate max-w-xs">${row.currentLocation || 'In Transit'}</div></div>`
    },
    {
      key: 'status',
      label: 'Shipment Status',
      render: row => `<span class="px-2.5 py-0.5 rounded-full text-[10px] font-bold ${row.status === 'Cancelled' ? 'bg-rose-50 text-rose-700 border border-rose-200' : row.status === 'Arrived' ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-blue-50 text-[#138FCB] border border-blue-200'}">${row.status}</span>`
    }
  ];

  const actions = [
    { label: 'View', variant: 'secondary', onClick: (row) => openShipmentDetailModal(row, refreshCallback) },
    { label: 'Landed Cost', variant: 'secondary', onClick: (row) => openLandedCostModal(row, refreshCallback) },
    { label: 'Tracktainer Sync', onClick: (row) => handleTracktainerSync(row, refreshCallback) }
  ];

  tableContainer.innerHTML = renderTable({ columns, data: filteredData, actions });
  bindTableActions(tableContainer, actions, filteredData);
}

export function openShipmentDetailModal(shipment, refreshCallback) {
  const suppliers = salesService.getParties(false, true);
  const supplier = suppliers.find(s => s.id === shipment.supplierPartyId);
  const expenses = shipment.expenses || [];
  const totalLandedPkr = expenses.reduce((s, e) => s + (Number(e.amountPkr) || 0), 0);
  const isCancelled = shipment.status === 'Cancelled';

  const contentHtml = `
    <div class="space-y-6 text-xs">
      <!-- SECTION 1: Logistics Overview -->
      <section class="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-xs space-y-4">
        <div class="flex items-center justify-between border-b border-slate-100 pb-3">
          <h3 class="text-xs font-bold uppercase tracking-wider text-slate-700 flex items-center gap-2">
            <span>🚢</span>
            <span>1. Freight &amp; Port Route Details</span>
          </h3>
          <span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-bold ${
            isCancelled ? 'bg-rose-50 text-rose-700 border border-rose-200' :
            shipment.status === 'Arrived' ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' :
            'bg-blue-50 text-[#138FCB] border border-blue-200'
          }">
            ${shipment.status}
          </span>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div class="p-3 bg-slate-50/70 rounded-xl border border-slate-200/70 space-y-1">
            <span class="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Supplier / Shipper</span>
            <p class="text-sm font-bold text-slate-900">${supplier ? supplier.name : 'International Supplier'}</p>
            <p class="text-[11px] text-slate-500">Incoterm: <strong>${shipment.shippingTerm}</strong></p>
          </div>

          <div class="p-3 bg-slate-50/70 rounded-xl border border-slate-200/70 space-y-1">
            <span class="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Ports of Transit</span>
            <p class="text-sm font-bold text-slate-800">${shipment.originPort} → ${shipment.destinationPort}</p>
            <p class="text-[11px] text-slate-500">Carrier: ${shipment.carrierName || 'Maersk Ocean'}</p>
          </div>

          <div class="p-3 bg-slate-50/70 rounded-xl border border-slate-200/70 space-y-1">
            <span class="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Container &amp; Live Location</span>
            <p class="text-sm font-mono font-bold text-slate-800">${shipment.containerNumber}</p>
            <p class="text-[11px] text-emerald-600 font-semibold">${shipment.currentLocation || 'In Transit'}</p>
          </div>
        </div>
      </section>

      <!-- SECTION 2: Landed Cost Expense Items -->
      <section class="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-xs space-y-4">
        <div class="flex items-center justify-between border-b border-slate-100 pb-3">
          <div class="flex items-center space-x-2">
            <h3 class="text-xs font-bold uppercase tracking-wider text-slate-700 flex items-center gap-2">
              <span>💰</span>
              <span>2. Landed Cost &amp; Import Expenses</span>
            </h3>
            <span class="px-2 py-0.5 text-[10px] font-bold rounded-full bg-blue-50 text-[#138FCB] border border-blue-200">
              Total: Rs. ${totalLandedPkr.toLocaleString()}
            </span>
          </div>
          <span class="text-[10px] text-slate-400">Allocated via: <strong>${shipment.allocationMethod || 'Value'}</strong></span>
        </div>

        <div class="border border-slate-200/80 rounded-xl overflow-hidden divide-y divide-slate-100">
          ${expenses.map(e => `
            <div class="p-3 flex justify-between items-center text-xs hover:bg-slate-50/70">
              <div class="flex items-center gap-2.5">
                <span class="w-2 h-2 rounded-full bg-emerald-500"></span>
                <span class="font-bold text-slate-800">${e.name}</span>
              </div>
              <span class="font-mono font-bold text-slate-900">Rs. ${Number(e.amountPkr).toLocaleString()}</span>
            </div>
          `).join('')}
        </div>
      </section>
    </div>
  `;

  const footerHtml = `
    <div class="flex items-center space-x-2 text-xs text-slate-400">
      <span class="w-2 h-2 rounded-full bg-emerald-500"></span>
      <span>🛡️ SSL 256-bit encrypted ERP transaction</span>
    </div>
    <div class="flex flex-col sm:flex-row items-center justify-between w-full sm:w-auto gap-3">
      <div>
        ${!isCancelled ? `
          <button id="ship-void-btn" type="button" class="inline-flex items-center space-x-1.5 px-3.5 py-2 text-xs font-bold text-rose-600 hover:text-rose-700 bg-rose-50 hover:bg-rose-100 border border-rose-200 rounded-xl transition-colors cursor-pointer">
            <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path>
            </svg>
            <span>Void / Cancel Shipment</span>
          </button>
        ` : `
          <span class="text-xs font-bold text-rose-600 bg-rose-50 border border-rose-200 px-3 py-1.5 rounded-xl inline-flex items-center gap-1.5">
            Shipment Cancelled
          </span>
        `}
      </div>
      <div class="flex items-center space-x-3">
        <button id="ship-close-btn" type="button" class="px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100 rounded-xl transition-colors border border-slate-200 cursor-pointer">
          Close
        </button>
        <button id="ship-lc-btn" type="button" class="inline-flex items-center space-x-1.5 px-4 py-2 text-xs font-bold text-slate-700 bg-white hover:bg-slate-50 border border-slate-200 rounded-xl transition-all cursor-pointer shadow-2xs">
          <span>⚙️ Landed Cost</span>
        </button>
        <button id="ship-sync-btn" type="button" class="inline-flex items-center space-x-2 px-4 py-2 text-xs font-bold text-white bg-[#138FCB] hover:bg-[#0E78AC] rounded-xl shadow-xs transition-all cursor-pointer">
          <span>📡 Tracktainer Sync</span>
        </button>
      </div>
    </div>
  `;

  openModal({
    title: `Import Shipment: ${shipment.shipmentNumber}`,
    subtitle: 'Container logistics tracking, port milestones, and inventory landed cost allocation',
    badge: shipment.containerNumber,
    contentHtml,
    footerHtml,
    size: 'max-w-4xl',
    onOpen: (modalEl) => {
      const closeBtn = modalEl.querySelector('#ship-close-btn');
      if (closeBtn) closeBtn.onclick = () => closeModal();

      const voidBtn = modalEl.querySelector('#ship-void-btn');
      if (voidBtn) {
        voidBtn.onclick = () => {
          confirmAction({
            title: `Void Shipment: ${shipment.shipmentNumber}`,
            message: 'Are you sure you want to void / cancel this import shipment?',
            confirmLabel: 'Yes, Void Shipment',
            isDestructive: true,
            onConfirm: () => {
              storageService.update('importShipments', shipment.id, { status: 'Cancelled' });
              toast.show(`Import Shipment ${shipment.shipmentNumber} cancelled.`, 'success');
              closeModal();
              if (refreshCallback) refreshCallback();
            }
          });
        };
      }

      const lcBtn = modalEl.querySelector('#ship-lc-btn');
      if (lcBtn) {
        lcBtn.onclick = () => {
          closeModal();
          openLandedCostModal(shipment, refreshCallback);
        };
      }

      const syncBtn = modalEl.querySelector('#ship-sync-btn');
      if (syncBtn) {
        syncBtn.onclick = () => {
          closeModal();
          handleTracktainerSync(shipment, refreshCallback);
        };
      }
    }
  });
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
      <section class="bg-blue-50/50 p-4 rounded-xl border border-blue-200/70 flex justify-between items-start">
        <div>
          <span class="text-[10px] font-bold uppercase tracking-wider text-blue-600">Import Shipment</span>
          <h3 class="text-base font-extrabold text-slate-900 mt-0.5">${shipment.shipmentNumber} (${shipment.containerNumber})</h3>
          <p class="text-slate-500 mt-0.5">Shipping Term: <strong>${shipment.shippingTerm}</strong> | Carrier: ${shipment.carrierName}</p>
        </div>
        <div class="text-right">
          <span class="text-[10px] font-bold uppercase tracking-wider text-slate-400">Total Landed Costs</span>
          <p class="text-xl font-extrabold text-[#138FCB] mt-0.5 font-mono">Rs. ${totalLandedPkr.toLocaleString()}</p>
        </div>
      </section>

      <!-- Landed Cost Eligible Expenses Breakdown -->
      <section class="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-xs space-y-3">
        <h4 class="font-bold text-slate-700 uppercase tracking-wider text-xs">Landed Cost Eligible Expense Items</h4>
        <div class="border border-slate-200/80 rounded-xl overflow-hidden divide-y divide-slate-100">
          ${expenses.map(e => `
            <div class="p-3 flex justify-between items-center text-xs">
              <div class="flex items-center gap-2">
                <span class="w-2 h-2 rounded-full bg-emerald-500"></span>
                <span class="font-semibold text-slate-800">${e.name}</span>
              </div>
              <span class="font-bold text-slate-900 font-mono">Rs. ${Number(e.amountPkr).toLocaleString()}</span>
            </div>
          `).join('')}
        </div>
      </section>

      <!-- Configurable Allocation Method -->
      <section class="p-4 bg-slate-50/70 rounded-2xl border border-slate-200/80 space-y-2">
        <label class="block font-bold text-slate-800">Landed Cost Allocation Method</label>
        <div class="grid grid-cols-4 gap-2">
          ${['Value', 'Quantity', 'Weight', 'Volume'].map(m => `
            <label class="flex items-center gap-1.5 p-2 bg-white rounded-xl border border-slate-200 hover:border-[#138FCB] text-xs font-semibold cursor-pointer shadow-2xs">
              <input type="radio" name="allocationMethod" value="${m}" ${m === (shipment.allocationMethod || 'Value') ? 'checked' : ''} class="text-[#138FCB]">
              <span>${m}</span>
            </label>
          `).join('')}
        </div>
      </section>
    </div>
  `;

  const footerHtml = `
    <div class="flex items-center space-x-2 text-xs text-slate-400">
      <span class="w-2 h-2 rounded-full bg-emerald-500"></span>
      <span>🛡️ SSL 256-bit encrypted ERP transaction</span>
    </div>
    <div class="flex items-center space-x-3 w-full sm:w-auto justify-end">
      <button id="lc-cancel-btn" type="button" class="px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100 rounded-xl transition-colors border border-slate-200 cursor-pointer">
        Close
      </button>
      <button id="lc-apply-btn" type="button" class="px-4 py-2 bg-[#138FCB] hover:bg-[#0E78AC] text-white rounded-xl font-bold shadow-xs transition-colors cursor-pointer">
        Recalculate Landed Inventory Costs
      </button>
    </div>
  `;

  openModal({
    title: `Landed Cost Engine: ${shipment.shipmentNumber}`,
    subtitle: 'Allocates ocean freight, customs taxes, and port clearance into inventory valuation',
    badge: 'LC-CALC',
    contentHtml,
    footerHtml,
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
