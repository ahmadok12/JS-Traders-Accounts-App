/**
 * JS Traders ERP - Dedicated Warehouse Locations & Zones View
 * Manage multi-warehouse storage racks, bins, aisles, and staging zones.
 */

import { warehouseService } from '../../services/warehouseService.js';
import { renderTable } from '../../components/table.js';
import { renderFilterBar } from '../../components/filters.js';
import { openModal, closeModal } from '../../components/modal.js';
import { confirmAction } from '../../components/confirmation.js';
import { toast } from '../../components/toast.js';

export function renderLocationsView() {
  const warehouses = warehouseService.getWarehouses();
  const locations = warehouseService.getAllLocations();

  const whFilterOptions = [
    { value: 'all', label: 'All Warehouses' },
    ...warehouses.map(w => ({ value: w.id, label: `${w.name} (${w.code})` }))
  ];

  const filterBarHtml = renderFilterBar({
    searchPlaceholder: 'Search locations by code, rack, or zone...',
    dropdowns: [
      {
        id: 'warehouse-location-filter',
        label: 'Warehouse',
        value: 'all',
        options: whFilterOptions
      }
    ]
  });

  const columns = [
    {
      key: 'code',
      header: 'Location Code',
      sortable: true,
      render: (val, row) => `
        <div class="flex items-center gap-2">
          <div class="w-7 h-7 rounded-lg bg-blue-50 text-[#138FCB] flex items-center justify-center font-bold text-xs">
            📍
          </div>
          <div>
            <span class="font-bold text-slate-900">${val}</span>
            <p class="text-[11px] text-slate-400 font-normal">${row.name || '-'}</p>
          </div>
        </div>
      `
    },
    {
      key: 'warehouse',
      header: 'Warehouse',
      sortable: true,
      render: (wh) => `
        <div>
          <span class="font-semibold text-slate-800 text-xs">${wh.name || '-'}</span>
          <span class="inline-block ml-1 px-1.5 py-0.5 rounded text-[10px] font-bold bg-slate-100 text-slate-600">${wh.code || ''}</span>
        </div>
      `
    },
    {
      key: 'zone',
      header: 'Zone / Type',
      sortable: true,
      render: (val, row) => `
        <span class="px-2 py-0.5 rounded-md text-[11px] font-medium bg-slate-100 text-slate-700">
          ${val || row.type || 'Standard Rack'}
        </span>
      `
    },
    {
      key: 'aisleRackBin',
      header: 'Aisle / Rack / Bin',
      render: (_, row) => `
        <span class="text-xs text-slate-600 font-mono">
          ${row.aisle ? `Aisle ${row.aisle}` : ''}${row.rack ? ` / R-${row.rack}` : ''}${row.bin ? ` / B-${row.bin}` : (row.notes ? row.notes : 'General')}
        </span>
      `
    },
    {
      key: 'status',
      header: 'Status',
      render: () => `
        <span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700">
          Available
        </span>
      `
    },
    {
      key: 'id',
      header: 'Actions',
      align: 'right',
      render: (id) => `
        <div class="flex items-center justify-end gap-2">
          <button class="edit-loc-btn text-xs font-semibold text-[#138FCB] hover:text-[#0E78AC] p-1.5 cursor-pointer" data-id="${id}" title="Edit Location">
            Edit
          </button>
          <button class="delete-loc-btn text-xs text-rose-500 hover:text-rose-700 p-1.5 cursor-pointer" data-id="${id}" title="Delete Location">
            🗑
          </button>
        </div>
      `
    }
  ];

  const tableHtml = renderTable({
    id: 'locations-table',
    columns,
    data: locations,
    selectable: false,
    emptyMessage: 'No warehouse storage locations defined yet.'
  });

  return `
    <div class="space-y-6 animate-in fade-in duration-150">
      <!-- Header Bar -->
      <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white p-4 rounded-2xl border border-[#EAECEF] shadow-[0_2px_4px_rgba(0,0,0,0.02)]">
        <div>
          <h2 class="text-base font-bold text-[#1A1D1F]">Storage Locations & Zones</h2>
          <p class="text-xs text-slate-400 mt-0.5">Manage rack, aisle, bin, and yard zones across warehouse network</p>
        </div>
        <button id="add-location-btn" class="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-bold bg-[#138FCB] text-white rounded-xl hover:bg-[#0E78AC] transition-colors shadow-xs cursor-pointer">
          <span>+</span>
          <span>Add Location</span>
        </button>
      </div>

      <!-- Quick Metrics -->
      <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div class="bg-white p-4 rounded-2xl border border-[#EAECEF] shadow-[0_2px_4px_rgba(0,0,0,0.02)]">
          <span class="text-xs text-slate-400 font-medium">Total Locations</span>
          <p class="text-xl font-black text-slate-900 mt-1">${locations.length}</p>
        </div>
        <div class="bg-white p-4 rounded-2xl border border-[#EAECEF] shadow-[0_2px_4px_rgba(0,0,0,0.02)]">
          <span class="text-xs text-slate-400 font-medium">Active Warehouses</span>
          <p class="text-xl font-black text-[#138FCB] mt-1">${warehouses.length}</p>
        </div>
        <div class="bg-white p-4 rounded-2xl border border-[#EAECEF] shadow-[0_2px_4px_rgba(0,0,0,0.02)]">
          <span class="text-xs text-slate-400 font-medium">Zone Types</span>
          <p class="text-xl font-black text-emerald-600 mt-1">Pallet Racks, Bins, Yard</p>
        </div>
      </div>

      <!-- Filter Bar -->
      <div class="bg-white p-4 rounded-2xl border border-[#EAECEF] shadow-[0_2px_4px_rgba(0,0,0,0.02)]">
        ${filterBarHtml}
      </div>

      <!-- Locations Table -->
      <div id="locations-table-container">
        ${tableHtml}
      </div>
    </div>
  `;
}

export function bindLocationsEvents(container, refreshCallback) {
  const warehouses = warehouseService.getWarehouses();

  // Add Location Modal
  const addBtn = container.querySelector('#add-location-btn');
  if (addBtn) {
    addBtn.onclick = () => {
      openLocationModal(null, warehouses, () => {
        if (refreshCallback) refreshCallback();
      });
    };
  }

  // Edit buttons
  container.querySelectorAll('.edit-loc-btn').forEach(btn => {
    btn.onclick = (e) => {
      const id = e.currentTarget.getAttribute('data-id');
      const loc = warehouseService.getLocationById(id);
      if (loc) {
        openLocationModal(loc, warehouses, () => {
          if (refreshCallback) refreshCallback();
        });
      }
    };
  });

  // Delete buttons
  container.querySelectorAll('.delete-loc-btn').forEach(btn => {
    btn.onclick = (e) => {
      const id = e.currentTarget.getAttribute('data-id');
      confirmAction({
        title: 'Delete Storage Location',
        message: 'Are you sure you want to delete this storage location? It will be removed from future bin assignments.',
        confirmLabel: 'Delete',
        danger: true,
        onConfirm: () => {
          warehouseService.deleteLocation(id);
          toast.show('Storage location deleted successfully.', 'success');
          if (refreshCallback) refreshCallback();
        }
      });
    };
  });

  // Warehouse filter
  const whFilter = container.querySelector('#warehouse-location-filter');
  const searchInput = container.querySelector('#filter-search-input');

  const applyFilters = () => {
    const whVal = whFilter ? whFilter.value : 'all';
    const query = searchInput ? searchInput.value.toLowerCase().trim() : '';
    const tableContainer = container.querySelector('#locations-table-container');
    if (!tableContainer) return;

    let filtered = warehouseService.getAllLocations();
    if (whVal !== 'all') {
      filtered = filtered.filter(l => l.warehouseId === whVal);
    }
    if (query) {
      filtered = filtered.filter(l =>
        (l.code && l.code.toLowerCase().includes(query)) ||
        (l.name && l.name.toLowerCase().includes(query)) ||
        (l.warehouse?.name && l.warehouse.name.toLowerCase().includes(query))
      );
    }

    const columns = [
      {
        key: 'code',
        header: 'Location Code',
        sortable: true,
        render: (val, row) => `
          <div class="flex items-center gap-2">
            <div class="w-7 h-7 rounded-lg bg-blue-50 text-[#138FCB] flex items-center justify-center font-bold text-xs">
              📍
            </div>
            <div>
              <span class="font-bold text-slate-900">${val}</span>
              <p class="text-[11px] text-slate-400 font-normal">${row.name || '-'}</p>
            </div>
          </div>
        `
      },
      {
        key: 'warehouse',
        header: 'Warehouse',
        sortable: true,
        render: (wh) => `
          <div>
            <span class="font-semibold text-slate-800 text-xs">${wh.name || '-'}</span>
            <span class="inline-block ml-1 px-1.5 py-0.5 rounded text-[10px] font-bold bg-slate-100 text-slate-600">${wh.code || ''}</span>
          </div>
        `
      },
      {
        key: 'zone',
        header: 'Zone / Type',
        sortable: true,
        render: (val, row) => `
          <span class="px-2 py-0.5 rounded-md text-[11px] font-medium bg-slate-100 text-slate-700">
            ${val || row.type || 'Standard Rack'}
          </span>
        `
      },
      {
        key: 'aisleRackBin',
        header: 'Aisle / Rack / Bin',
        render: (_, row) => `
          <span class="text-xs text-slate-600 font-mono">
            ${row.aisle ? `Aisle ${row.aisle}` : ''}${row.rack ? ` / R-${row.rack}` : ''}${row.bin ? ` / B-${row.bin}` : (row.notes ? row.notes : 'General')}
          </span>
        `
      },
      {
        key: 'status',
        header: 'Status',
        render: () => `
          <span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700">
            Available
          </span>
        `
      },
      {
        key: 'id',
        header: 'Actions',
        align: 'right',
        render: (id) => `
          <div class="flex items-center justify-end gap-2">
            <button class="edit-loc-btn text-xs font-semibold text-[#138FCB] hover:text-[#0E78AC] p-1.5 cursor-pointer" data-id="${id}">
              Edit
            </button>
            <button class="delete-loc-btn text-xs text-rose-500 hover:text-rose-700 p-1.5 cursor-pointer" data-id="${id}">
              🗑
            </button>
          </div>
        `
      }
    ];

    tableContainer.innerHTML = renderTable({
      id: 'locations-table',
      columns,
      data: filtered,
      selectable: false,
      emptyMessage: 'No storage locations match your filter criteria.'
    });

    // Re-bind actions
    bindLocationsEvents(container, refreshCallback);
  };

  if (whFilter) whFilter.onchange = applyFilters;
  if (searchInput) searchInput.oninput = applyFilters;
}

function openLocationModal(locationData = null, warehouses = [], onSave) {
  const isEdit = !!locationData;
  const content = `
    <form id="location-form" class="space-y-4">
      <div>
        <label class="block text-xs font-semibold text-slate-700 mb-1">Target Warehouse *</label>
        <select id="loc-wh-select" required class="w-full px-3 py-2 text-xs border border-slate-200 rounded-xl focus:border-[#138FCB] outline-none">
          ${warehouses.map(w => `
            <option value="${w.id}" ${locationData && locationData.warehouseId === w.id ? 'selected' : ''}>
              ${w.name} (${w.code})
            </option>
          `).join('')}
        </select>
      </div>

      <div class="grid grid-cols-2 gap-3">
        <div>
          <label class="block text-xs font-semibold text-slate-700 mb-1">Location Code *</label>
          <input type="text" id="loc-code" required placeholder="e.g. RACK-A1" value="${locationData ? locationData.code : ''}" class="w-full px-3 py-2 text-xs border border-slate-200 rounded-xl focus:border-[#138FCB] outline-none uppercase font-mono">
        </div>
        <div>
          <label class="block text-xs font-semibold text-slate-700 mb-1">Zone Type</label>
          <select id="loc-zone" class="w-full px-3 py-2 text-xs border border-slate-200 rounded-xl focus:border-[#138FCB] outline-none">
            <option value="Pallet Rack" ${locationData && locationData.zone === 'Pallet Rack' ? 'selected' : ''}>Pallet Rack</option>
            <option value="Shelf Bin" ${locationData && locationData.zone === 'Shelf Bin' ? 'selected' : ''}>Shelf Bin</option>
            <option value="Floor Staging" ${locationData && locationData.zone === 'Floor Staging' ? 'selected' : ''}>Floor Staging</option>
            <option value="Open Yard" ${locationData && locationData.zone === 'Open Yard' ? 'selected' : ''}>Open Yard</option>
            <option value="Cold / Climate" ${locationData && locationData.zone === 'Cold / Climate' ? 'selected' : ''}>Cold / Climate</option>
          </select>
        </div>
      </div>

      <div>
        <label class="block text-xs font-semibold text-slate-700 mb-1">Location Name / Description *</label>
        <input type="text" id="loc-name" required placeholder="e.g. Rack A - High-density Nipples & Regulators" value="${locationData ? locationData.name : ''}" class="w-full px-3 py-2 text-xs border border-slate-200 rounded-xl focus:border-[#138FCB] outline-none">
      </div>

      <div class="grid grid-cols-3 gap-3">
        <div>
          <label class="block text-xs font-semibold text-slate-700 mb-1">Aisle</label>
          <input type="text" id="loc-aisle" placeholder="A1" value="${locationData ? (locationData.aisle || '') : ''}" class="w-full px-3 py-2 text-xs border border-slate-200 rounded-xl focus:border-[#138FCB] outline-none">
        </div>
        <div>
          <label class="block text-xs font-semibold text-slate-700 mb-1">Rack</label>
          <input type="text" id="loc-rack" placeholder="01" value="${locationData ? (locationData.rack || '') : ''}" class="w-full px-3 py-2 text-xs border border-slate-200 rounded-xl focus:border-[#138FCB] outline-none">
        </div>
        <div>
          <label class="block text-xs font-semibold text-slate-700 mb-1">Bin</label>
          <input type="text" id="loc-bin" placeholder="B" value="${locationData ? (locationData.bin || '') : ''}" class="w-full px-3 py-2 text-xs border border-slate-200 rounded-xl focus:border-[#138FCB] outline-none">
        </div>
      </div>

      <div class="flex justify-end gap-2 pt-4 border-t border-slate-100">
        <button type="button" id="cancel-loc-btn" class="px-4 py-2 text-xs font-medium text-slate-600 hover:bg-slate-100 rounded-xl transition-colors cursor-pointer">
          Cancel
        </button>
        <button type="submit" class="px-4 py-2 text-xs font-bold bg-[#138FCB] text-white rounded-xl hover:bg-[#0E78AC] transition-colors shadow-xs cursor-pointer">
          ${isEdit ? 'Update Location' : 'Save Location'}
        </button>
      </div>
    </form>
  `;

  openModal({
    title: isEdit ? 'Edit Storage Location' : 'Add New Storage Location',
    content,
    width: 'max-w-md'
  });

  const form = document.getElementById('location-form');
  const cancelBtn = document.getElementById('cancel-loc-btn');

  if (cancelBtn) {
    cancelBtn.onclick = () => closeModal();
  }

  if (form) {
    form.onsubmit = (e) => {
      e.preventDefault();
      const warehouseId = document.getElementById('loc-wh-select').value;
      const code = document.getElementById('loc-code').value.trim().toUpperCase();
      const name = document.getElementById('loc-name').value.trim();
      const zone = document.getElementById('loc-zone').value;
      const aisle = document.getElementById('loc-aisle').value.trim();
      const rack = document.getElementById('loc-rack').value.trim();
      const bin = document.getElementById('loc-bin').value.trim();

      if (isEdit) {
        warehouseService.updateLocation(locationData.id, {
          warehouseId,
          code,
          name,
          zone,
          aisle,
          rack,
          bin
        });
        toast.show(`Location ${code} updated successfully.`, 'success');
      } else {
        warehouseService.createLocation(warehouseId, {
          code,
          name,
          zone,
          aisle,
          rack,
          bin
        });
        toast.show(`Location ${code} created successfully.`, 'success');
      }

      closeModal();
      if (onSave) onSave();
    };
  }
}
