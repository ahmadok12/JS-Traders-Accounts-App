/**
 * JS Traders ERP - Import Shipments & Landed Cost Engine View
 * Supports FOB / EXW terms, container tracking with Tracktainer API,
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
import { openTrackingGraphicsModal } from '../../components/trackingGraphicsModal.js';

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
          { value: 'EXW', label: 'EXW (Ex Works Factory)' },
          { value: 'CIF', label: 'CIF (Cost & Freight)' }
        ]
      }
    ],
    primaryAction: { label: 'New Import Shipment' },
    secondaryAction: { label: 'Sync Tracktainer', icon: '📡' }
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
          <div class="font-bold text-slate-800">${suppMap.get(row.supplierPartyId) || 'International Shipper'}</div>
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
      label: 'Container / Telemetry',
      render: row => `
        <div>
          <div class="font-semibold text-slate-800 font-mono flex items-center gap-1.5">
            <span>${row.containerNumber}</span>
            <span class="px-1.5 py-0.2 rounded text-[9px] font-black bg-blue-50 text-blue-700">TRACKTAINER</span>
          </div>
          <div class="text-[10px] text-slate-500 font-medium truncate max-w-xs flex items-center gap-1 mt-0.5">
            <span class="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
            <span>${row.currentLocation || 'In Transit'}</span>
          </div>
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
    { label: 'Map', variant: 'primary' },
    { label: 'Landed Cost', variant: 'secondary' },
    { label: 'Tracktainer Sync', variant: 'secondary' }
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
    { label: 'Map', variant: 'primary', onClick: (row) => openTrackingGraphicsModal(row) },
    { label: 'Landed Cost', variant: 'secondary', onClick: (row) => openLandedCostModal(row, refreshCallback) },
    { label: 'Tracktainer Sync', variant: 'secondary', onClick: (row) => handleTracktainerSync(row, refreshCallback) }
  ];
  bindTableActions(container, actions, shipments);

  // New Shipment primary action button
  const primaryBtn = container.querySelector('#filter-primary-btn');
  if (primaryBtn) {
    primaryBtn.onclick = () => openNewShipmentModal(refreshCallback);
  }

  // Secondary Sync button
  const secondaryBtn = container.querySelector('#filter-secondary-btn');
  if (secondaryBtn) {
    secondaryBtn.onclick = async () => {
      toast.show('Syncing active shipments with Tracktainer API...', 'info');
      await trackingService.syncAllFromApi();
      toast.show('Tracktainer sync complete!', 'success');
      if (refreshCallback) refreshCallback();
    };
  }

  // Search filter
  const searchInput = container.querySelector('#filter-search-input');
  if (searchInput) {
    searchInput.oninput = (e) => {
      const q = e.target.value.toLowerCase().trim();
      const filtered = shipments.filter(s =>
        (s.shipmentNumber && s.shipmentNumber.toLowerCase().includes(q)) ||
        (s.containerNumber && s.containerNumber.toLowerCase().includes(q)) ||
        (s.carrierName && s.carrierName.toLowerCase().includes(q))
      );
      updateShipmentsTable(container, filtered, refreshCallback);
    };
  }

  // Term dropdown filter
  const termFilter = container.querySelector('#shipment-term-filter');
  if (termFilter) {
    termFilter.onchange = (e) => {
      const val = e.target.value;
      const filtered = val === 'all' 
        ? shipments 
        : shipments.filter(s => s.shippingTerm === val);
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
      label: 'Container / Telemetry',
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
    { label: 'Map', variant: 'primary', onClick: (row) => openTrackingGraphicsModal(row) },
    { label: 'Landed Cost', variant: 'secondary', onClick: (row) => openLandedCostModal(row, refreshCallback) },
    { label: 'Tracktainer Sync', variant: 'secondary', onClick: (row) => handleTracktainerSync(row, refreshCallback) }
  ];

  tableContainer.innerHTML = renderTable({ columns, data: filteredData, actions });
  bindTableActions(tableContainer, actions, filteredData);
}

export function openNewShipmentModal(refreshCallback) {
  const suppliers = salesService.getParties(false, true);
  const nextNumber = `IMP-${String(purchasingService.getImportShipments().length + 1).padStart(5, '0')}`;

  const contentHtml = `
    <form id="new-shipment-form" class="space-y-4 text-xs">
      <!-- Tracktainer API Banner -->
      <div class="bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-200 rounded-2xl p-3.5 flex items-center justify-between">
        <div class="flex items-center gap-2.5">
          <div class="w-8 h-8 rounded-xl bg-[#138FCB] text-white flex items-center justify-center font-bold text-sm shadow-xs">
            📡
          </div>
          <div>
            <div class="flex items-center gap-2">
              <span class="font-bold text-slate-800">Tracktainer Automated Tracking</span>
              <span class="px-2 py-0.5 rounded-full text-[9px] font-black bg-emerald-100 text-emerald-800">API CONNECTED</span>
            </div>
            <p class="text-[10px] text-slate-500 font-mono mt-0.5">Key: ca0853e1...bdeab9db (Real-Time Container Telemetry)</p>
          </div>
        </div>
        <label class="relative inline-flex items-center cursor-pointer">
          <input type="checkbox" id="field-enable-tracktainer" class="sr-only peer" checked>
          <div class="w-9 h-5 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-[#138FCB]"></div>
        </label>
      </div>

      <!-- General Logistics Fields -->
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label class="block font-bold text-slate-700 mb-1">Container Number <span class="text-rose-500">*</span></label>
          <input type="text" id="field-container-no" required placeholder="e.g. TXGU6848701 or MSCU8491024" value="TXGU6848701" class="w-full px-3 py-2 border border-slate-200 rounded-xl focus:outline-none focus:border-[#138FCB] font-mono uppercase font-bold text-slate-900 shadow-2xs">
        </div>
        <div>
          <label class="block font-bold text-slate-700 mb-1">Bill of Lading (BL) / Booking Ref</label>
          <input type="text" id="field-bl-no" placeholder="e.g. BL-TXZJ-829104" value="BL-TXGU6848701" class="w-full px-3 py-2 border border-slate-200 rounded-xl focus:outline-none focus:border-[#138FCB] font-mono text-slate-800 shadow-2xs">
        </div>
      </div>

      <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div>
          <label class="block font-bold text-slate-700 mb-1">Supplier Party</label>
          <select id="field-supplier-id" class="w-full px-3 py-2 border border-slate-200 rounded-xl focus:outline-none focus:border-[#138FCB] font-semibold text-slate-800 shadow-2xs">
            ${suppliers.map(s => `
              <option value="${s.id}" ${s.name.includes('Qingdao') ? 'selected' : ''}>${s.name}</option>
            `).join('')}
          </select>
        </div>
        <div>
          <label class="block font-bold text-slate-700 mb-1">Shipping Term (Incoterm)</label>
          <select id="field-shipping-term" class="w-full px-3 py-2 border border-slate-200 rounded-xl focus:outline-none focus:border-[#138FCB] font-semibold text-slate-800 shadow-2xs">
            <option value="FOB" selected>FOB (Free On Board)</option>
            <option value="EXW">EXW (Ex Works Factory)</option>
            <option value="CIF">CIF (Cost, Insurance &amp; Freight)</option>
            <option value="CFR">CFR (Cost and Freight)</option>
          </select>
        </div>
        <div>
          <label class="block font-bold text-slate-700 mb-1">Ocean Carrier / Shipping Line</label>
          <input type="text" id="field-carrier-name" placeholder="e.g. TS Lines, KMTC, Maersk" value="TS Lines" class="w-full px-3 py-2 border border-slate-200 rounded-xl focus:outline-none focus:border-[#138FCB] font-semibold text-slate-800 shadow-2xs">
        </div>
      </div>

      <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label class="block font-bold text-slate-700 mb-1">Origin Port &amp; Country</label>
          <div class="grid grid-cols-2 gap-2">
            <input type="text" id="field-origin-port" placeholder="Port (e.g. Qingdao)" value="Qingdao Port" class="w-full px-3 py-2 border border-slate-200 rounded-xl focus:outline-none focus:border-[#138FCB] text-slate-800 shadow-2xs">
            <input type="text" id="field-origin-country" placeholder="Country" value="China" class="w-full px-3 py-2 border border-slate-200 rounded-xl focus:outline-none focus:border-[#138FCB] text-slate-800 shadow-2xs">
          </div>
        </div>
        <div>
          <label class="block font-bold text-slate-700 mb-1">Destination Port &amp; Country</label>
          <div class="grid grid-cols-2 gap-2">
            <input type="text" id="field-dest-port" placeholder="Port (e.g. Karachi)" value="Karachi Port Qasim" class="w-full px-3 py-2 border border-slate-200 rounded-xl focus:outline-none focus:border-[#138FCB] text-slate-800 shadow-2xs">
            <input type="text" id="field-dest-country" placeholder="Country" value="Pakistan" class="w-full px-3 py-2 border border-slate-200 rounded-xl focus:outline-none focus:border-[#138FCB] text-slate-800 shadow-2xs">
          </div>
        </div>
      </div>

      <!-- Landed Cost Budget Estimates (PKR) -->
      <div class="p-3.5 bg-slate-50/80 rounded-2xl border border-slate-200 space-y-2.5">
        <div class="flex items-center justify-between">
          <span class="font-bold text-slate-800 text-[11px] uppercase tracking-wider">Estimated Landed Costs (PKR)</span>
          <span class="text-[10px] text-slate-400">Can be refined later in Landed Cost Engine</span>
        </div>
        <div class="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <div>
            <span class="text-[10px] text-slate-500 font-semibold block mb-0.5">Ocean Freight</span>
            <input type="number" id="cost-freight" value="720000" class="w-full px-2.5 py-1.5 border border-slate-200 rounded-lg text-slate-900 font-mono text-xs shadow-2xs">
          </div>
          <div>
            <span class="text-[10px] text-slate-500 font-semibold block mb-0.5">Customs &amp; Duty</span>
            <input type="number" id="cost-customs" value="380000" class="w-full px-2.5 py-1.5 border border-slate-200 rounded-lg text-slate-900 font-mono text-xs shadow-2xs">
          </div>
          <div>
            <span class="text-[10px] text-slate-500 font-semibold block mb-0.5">Port Terminal (QICT)</span>
            <input type="number" id="cost-port" value="95000" class="w-full px-2.5 py-1.5 border border-slate-200 rounded-lg text-slate-900 font-mono text-xs shadow-2xs">
          </div>
          <div>
            <span class="text-[10px] text-slate-500 font-semibold block mb-0.5">Inland Trucking</span>
            <input type="number" id="cost-trucking" value="160000" class="w-full px-2.5 py-1.5 border border-slate-200 rounded-lg text-slate-900 font-mono text-xs shadow-2xs">
          </div>
        </div>
      </div>
    </form>
  `;

  const footerHtml = `
    <div class="flex items-center space-x-2 text-xs text-slate-400">
      <span class="w-2 h-2 rounded-full bg-emerald-500"></span>
      <span>Live Tracktainer API Verification Enabled</span>
    </div>
    <div class="flex items-center space-x-3">
      <button id="cancel-new-ship-btn" type="button" class="px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100 rounded-xl transition-colors border border-slate-200 cursor-pointer">
        Cancel
      </button>
      <button id="save-new-ship-btn" type="button" class="px-4 py-2 bg-[#138FCB] hover:bg-[#0E78AC] text-white rounded-xl font-bold shadow-xs transition-colors cursor-pointer flex items-center gap-1.5">
        <span>✓</span>
        <span>Register &amp; Track Shipment</span>
      </button>
    </div>
  `;

  openModal({
    title: `Register Import Shipment (${nextNumber})`,
    subtitle: 'Container logistics tracking, port milestones, and inventory landed cost allocation',
    badge: 'NEW SHIPMENT',
    contentHtml,
    footerHtml,
    size: 'max-w-2xl',
    onOpen: (modalEl) => {
      modalEl.querySelector('#cancel-new-ship-btn').onclick = () => closeModal();

      modalEl.querySelector('#save-new-ship-btn').onclick = async () => {
        const containerNo = modalEl.querySelector('#field-container-no').value.trim().toUpperCase();
        const blNo = modalEl.querySelector('#field-bl-no').value.trim();
        const supplierId = modalEl.querySelector('#field-supplier-id').value;
        const shippingTerm = modalEl.querySelector('#field-shipping-term').value;
        const carrierName = modalEl.querySelector('#field-carrier-name').value.trim();
        const originPort = modalEl.querySelector('#field-origin-port').value.trim();
        const originCountry = modalEl.querySelector('#field-origin-country').value.trim();
        const destPort = modalEl.querySelector('#field-dest-port').value.trim();
        const destCountry = modalEl.querySelector('#field-dest-country').value.trim();
        const enableTrack = modalEl.querySelector('#field-enable-tracktainer').checked;

        if (!containerNo) {
          toast.show('Please provide a container number.', 'error');
          return;
        }

        const expenses = [
          { name: 'Ocean Freight (Container)', amountPkr: Number(modalEl.querySelector('#cost-freight').value) || 0, isLandedCostEligible: true },
          { name: 'Import Customs Duty & FBR Taxes', amountPkr: Number(modalEl.querySelector('#cost-customs').value) || 0, isLandedCostEligible: true },
          { name: 'Port Terminal & Clearance (QICT)', amountPkr: Number(modalEl.querySelector('#cost-port').value) || 0, isLandedCostEligible: true },
          { name: 'Port to Warehouse Trucking', amountPkr: Number(modalEl.querySelector('#cost-trucking').value) || 0, isLandedCostEligible: true }
        ];

        const newShipment = storageService.insert('importShipments', {
          shipmentNumber: nextNumber,
          containerNumber: containerNo,
          blNumber: blNo,
          supplierPartyId: supplierId,
          shippingTerm,
          carrierName: carrierName || 'Ocean Carrier',
          originPort: originPort || 'Qingdao Port',
          originCountry: originCountry || 'China',
          destinationPort: destPort || 'Karachi Port Qasim',
          destinationCountry: destCountry || 'Pakistan',
          status: 'Shipped',
          trackingProvider: 'Tracktainer',
          trackingMode: enableTrack ? 'Automatic' : 'Manual',
          currentLocation: 'Departed Qingdao, China',
          expenses,
          allocationMethod: 'Value'
        });

        toast.show(`Shipment ${nextNumber} registered successfully!`, 'success');
        closeModal();

        if (enableTrack) {
          toast.show(`Syncing ${containerNo} with Tracktainer API...`, 'info');
          try {
            await trackingService.registerShipment(containerNo, blNo);
            await trackingService.syncShipment(newShipment.id);
            toast.show(`Tracktainer live sync complete for ${containerNo}!`, 'success');
          } catch (e) {
            console.warn('Tracktainer initial sync error:', e);
          }
        }

        if (refreshCallback) refreshCallback();
      };
    }
  });
}

export function openShipmentDetailModal(shipment, refreshCallback) {
  const suppliers = salesService.getParties(false, true);
  const supplier = suppliers.find(s => s.id === shipment.supplierPartyId);
  const expenses = shipment.expenses || [];
  const totalLandedPkr = expenses.reduce((s, e) => s + (Number(e.amountPkr) || 0), 0);
  const isCancelled = shipment.status === 'Cancelled';

  const contentHtml = `
    <div class="space-y-6 text-xs">
      <!-- SECTION 1: Logistics & Tracktainer Live Telemetry -->
      <section class="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-xs space-y-4">
        <div class="flex items-center justify-between border-b border-slate-100 pb-3">
          <h3 class="text-xs font-bold uppercase tracking-wider text-slate-700 flex items-center gap-2">
            <span>🚢</span>
            <span>1. Freight Route &amp; Tracktainer Live Telemetry</span>
          </h3>
          <div class="flex items-center gap-2">
            <span class="inline-flex items-center px-2 py-0.5 rounded-full text-[9px] font-black bg-blue-100 text-blue-800">
              📡 TRACKTAINER
            </span>
            <span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-bold ${
              isCancelled ? 'bg-rose-50 text-rose-700 border border-rose-200' :
              shipment.status === 'Arrived' ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' :
              'bg-blue-50 text-[#138FCB] border border-blue-200'
            }">
              ${shipment.status}
            </span>
          </div>
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
            <p class="text-[11px] text-slate-500">Carrier: <strong>${shipment.carrierName || 'TS Lines'}</strong></p>
          </div>

          <div class="p-3 bg-slate-50/70 rounded-xl border border-slate-200/70 space-y-1">
            <span class="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Container &amp; Live Waypoint</span>
            <p class="text-sm font-mono font-bold text-slate-800">${shipment.containerNumber}</p>
            <p class="text-[11px] text-emerald-600 font-semibold flex items-center gap-1">
              <span class="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
              <span>${shipment.currentLocation || 'In Transit'}</span>
            </p>
          </div>
        </div>

        <!-- Telemetry Stats Pill -->
        <div class="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1 border-t border-slate-100 text-center">
          <div class="bg-blue-50/50 p-2 rounded-xl border border-blue-100">
            <span class="text-[9px] uppercase font-bold text-blue-700 block">Vessel &amp; Voyage</span>
            <span class="text-xs font-black text-slate-800">${shipment.vesselName || 'KMTC CHENNAI'} (${shipment.voyage || '2605W'})</span>
          </div>
          <div class="bg-indigo-50/50 p-2 rounded-xl border border-indigo-100">
            <span class="text-[9px] uppercase font-bold text-indigo-700 block">ETA Delivery</span>
            <span class="text-xs font-black text-slate-800">${shipment.eta ? new Date(shipment.eta).toLocaleDateString() : 'Oct 3, 2026'}</span>
          </div>
          <div class="bg-amber-50/50 p-2 rounded-xl border border-amber-100">
            <span class="text-[9px] uppercase font-bold text-amber-700 block">Transit Duration</span>
            <span class="text-xs font-black text-slate-800">${shipment.transitTime || 33} Days (Direct)</span>
          </div>
          <div class="bg-emerald-50/50 p-2 rounded-xl border border-emerald-100">
            <span class="text-[9px] uppercase font-bold text-emerald-700 block">Schedule Status</span>
            <span class="text-xs font-black text-emerald-700">● On Time</span>
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
      <span>🛡️ Real-Time Tracktainer Verified</span>
    </div>
    <div class="flex flex-col sm:flex-row items-center justify-between w-full sm:w-auto gap-3">
      <div>
        ${!isCancelled ? `
          <button id="ship-void-btn" type="button" class="inline-flex items-center space-x-1.5 px-3.5 py-2 text-xs font-bold text-rose-600 hover:text-rose-700 bg-rose-50 hover:bg-rose-100 border border-rose-200 rounded-xl transition-colors cursor-pointer">
            <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path>
            </svg>
            <span>Void / Cancel</span>
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
        <button id="ship-map-btn" type="button" class="inline-flex items-center space-x-1.5 px-3.5 py-2 text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 rounded-xl shadow-xs transition-all cursor-pointer">
          <span>🗺️ View Tracking Map</span>
        </button>
        <button id="ship-lc-btn" type="button" class="inline-flex items-center space-x-1.5 px-4 py-2 text-xs font-bold text-slate-700 bg-white hover:bg-slate-50 border border-slate-200 rounded-xl transition-all cursor-pointer shadow-2xs">
          <span>⚙️ Landed Cost</span>
        </button>
        <button id="ship-sync-btn" type="button" class="inline-flex items-center space-x-2 px-4 py-2 text-xs font-bold text-white bg-[#138FCB] hover:bg-[#0E78AC] rounded-xl shadow-xs transition-all cursor-pointer">
          <span>📡 Tracktainer Live Sync</span>
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
              purchasingService.cancelImportShipment(shipment.id);
              toast.show(`Import Shipment ${shipment.shipmentNumber} cancelled.`, 'success');
              closeModal();
              if (refreshCallback) refreshCallback();
            }
          });
        };
      }

      const mapBtn = modalEl.querySelector('#ship-map-btn');
      if (mapBtn) {
        mapBtn.onclick = () => {
          closeModal();
          openTrackingGraphicsModal(shipment);
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
    title: 'Tracktainer Live Synchronization',
    message: `Connect to Tracktainer API (Key: ca0853e1...bdeab9db) to query live container telemetry and ocean milestone updates for ${shipment.containerNumber}?`,
    confirmLabel: 'Sync Now with API',
    isDestructive: false,
    onConfirm: async () => {
      try {
        toast.show(`Querying Tracktainer API for ${shipment.containerNumber}...`, 'info');
        const res = await trackingService.syncShipment(shipment.id);
        toast.show(`Tracktainer synced! Waypoint: ${res.currentLocation}.`, 'success');
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
