/**
 * JS Traders ERP - Warehouses & Showrooms View
 * Manage commercial showrooms, storage depots, and regional facilities
 */

import { warehouseService } from '../../services/warehouseService.js';
import { openModal, closeModal } from '../../components/modal.js';
import { toast } from '../../components/toast.js';

export function renderWarehousesView() {
  const warehouses = warehouseService.getAllWarehouses();

  return `
    <div class="space-y-6 animate-in fade-in duration-150">
      <!-- Header Banner -->
      <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white p-5 rounded-2xl border border-slate-200/90 shadow-2xs">
        <div>
          <h2 class="text-base font-bold text-[#1A1D1F] flex items-center gap-2">
            <span>🏢</span>
            <span>Warehouses &amp; Showrooms</span>
          </h2>
          <p class="text-xs text-slate-400 mt-0.5">Commercial showrooms, central depots, and regional inventory facilities</p>
        </div>
        <div class="flex items-center gap-2.5">
          <button id="nav-staff-access-btn" class="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-bold bg-slate-900 text-white rounded-xl hover:bg-slate-800 transition-colors shadow-2xs cursor-pointer">
            <span>👥</span>
            <span>Staff &amp; Mobile Access</span>
          </button>
          <button id="add-wh-btn" class="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-bold bg-[#138FCB] text-white rounded-xl hover:bg-[#0E78AC] transition-colors shadow-2xs cursor-pointer">
            <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" d="M12 4v16m8-8H4"></path>
            </svg>
            <span>Add Showroom / Warehouse</span>
          </button>
        </div>
      </div>

      <!-- Facilities Grid -->
      <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
        ${warehouses.map(wh => {
          const isVoided = Boolean(wh.isVoid || wh.isActive === false);
          return `
            <div class="bg-white rounded-2xl p-5 border ${isVoided ? 'border-dashed border-rose-200 bg-rose-50/20' : 'border-slate-200/90'} shadow-2xs flex flex-col justify-between transition-all hover:shadow-md">
              <div>
                <div class="flex items-center justify-between mb-3">
                  <span class="text-[11px] font-bold uppercase tracking-wider text-[#138FCB] bg-blue-50/80 px-2.5 py-1 rounded-lg border border-blue-100/60 font-mono">
                    ${wh.code || 'WH-LOC'}
                  </span>
                  ${isVoided ? `
                    <span class="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-rose-50 text-rose-700 border border-rose-200">
                      <span class="w-1.5 h-1.5 rounded-full bg-rose-500"></span>
                      <span>Voided / Inactive</span>
                    </span>
                  ` : `
                    <span class="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                      <span class="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                      <span>Active / Operational</span>
                    </span>
                  `}
                </div>

                <h3 class="text-base font-bold ${isVoided ? 'text-slate-500 line-through' : 'text-slate-900'}">${wh.name}</h3>
                <p class="text-xs text-slate-500 mt-1 flex items-start gap-1">
                  <span class="text-slate-400 shrink-0">📍</span>
                  <span>${wh.address || 'Address not configured'}, ${wh.city || ''}</span>
                </p>

                <div class="mt-4 pt-3.5 border-t border-slate-100 text-xs text-slate-600 space-y-2 bg-slate-50/50 -mx-5 -mb-2 p-4 rounded-xl">
                  <div class="flex items-center justify-between">
                    <span class="text-slate-400 font-medium">In-Charge:</span>
                    <span class="font-bold text-slate-800">${wh.contactPerson || 'Tariq Mehmood'}</span>
                  </div>
                  <div class="flex items-center justify-between">
                    <span class="text-slate-400 font-medium">Contact Phone:</span>
                    <span class="font-semibold text-slate-700 font-mono text-[11px]">${wh.phone || '+92 300 1234567'}</span>
                  </div>
                </div>
              </div>

              <!-- Action Bar -->
              <div class="mt-5 pt-3.5 border-t border-slate-100 flex items-center justify-between gap-2">
                <button class="edit-wh-btn inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold bg-slate-100 text-slate-700 hover:bg-slate-200 hover:text-slate-900 transition-colors cursor-pointer" data-id="${wh.id}">
                  <svg class="w-3.5 h-3.5 text-slate-500" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"></path>
                  </svg>
                  <span>Edit Name</span>
                </button>

                <div class="flex items-center gap-1.5">
                  ${isVoided ? `
                    <button class="reactivate-wh-btn inline-flex items-center gap-1 px-3 py-1.5 rounded-xl text-xs font-semibold bg-emerald-50 text-emerald-700 hover:bg-emerald-100 border border-emerald-200 transition-colors cursor-pointer" data-id="${wh.id}">
                      <span>🔄</span>
                      <span>Reactivate</span>
                    </button>
                    <button class="delete-wh-btn p-1.5 rounded-xl text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition-colors cursor-pointer" data-id="${wh.id}" title="Permanently Delete">
                      <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path>
                      </svg>
                    </button>
                  ` : `
                    <button class="void-wh-btn inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold bg-rose-50 text-rose-700 hover:bg-rose-100 border border-rose-200 transition-colors cursor-pointer" data-id="${wh.id}">
                      <span>🚫</span>
                      <span>Void Showroom</span>
                    </button>
                  `}
                </div>
              </div>
            </div>
          `;
        }).join('')}
      </div>
    </div>
  `;
}

export function bindWarehousesEvents(container, refreshCallback) {
  const addBtn = container.querySelector('#add-wh-btn');
  if (addBtn) {
    addBtn.onclick = () => openAddWarehouseModal(refreshCallback);
  }

  const staffBtn = container.querySelector('#nav-staff-access-btn');
  if (staffBtn) {
    staffBtn.onclick = () => {
      window.app?.navigateTo('warehouse-staff');
    };
  }

  // Edit Name Buttons
  container.querySelectorAll('.edit-wh-btn').forEach(btn => {
    btn.onclick = () => {
      const whId = btn.getAttribute('data-id');
      openEditWarehouseModal(whId, () => {
        if (refreshCallback) refreshCallback();
      });
    };
  });

  // Void Showroom Buttons
  container.querySelectorAll('.void-wh-btn').forEach(btn => {
    btn.onclick = () => {
      const whId = btn.getAttribute('data-id');
      const wh = warehouseService.getWarehouseById(whId);
      if (!wh) return;

      if (confirm(`Are you sure you want to void "${wh.name}"?\n\nIt will be deactivated and hidden from active purchase, sales, and manufacturing dropdowns.`)) {
        warehouseService.voidWarehouse(whId);
        toast.show(`Showroom "${wh.name}" has been voided.`, 'info');
        if (refreshCallback) refreshCallback();
      }
    };
  });

  // Reactivate Showroom Buttons
  container.querySelectorAll('.reactivate-wh-btn').forEach(btn => {
    btn.onclick = () => {
      const whId = btn.getAttribute('data-id');
      const wh = warehouseService.getWarehouseById(whId);
      if (!wh) return;

      warehouseService.reactivateWarehouse(whId);
      toast.show(`Showroom "${wh.name}" has been reactivated.`, 'success');
      if (refreshCallback) refreshCallback();
    };
  });

  // Delete Permanently Buttons
  container.querySelectorAll('.delete-wh-btn').forEach(btn => {
    btn.onclick = () => {
      const whId = btn.getAttribute('data-id');
      const wh = warehouseService.getWarehouseById(whId);
      if (!wh) return;

      if (confirm(`Permanently delete "${wh.name}"? This action cannot be undone.`)) {
        warehouseService.deleteWarehouse(whId);
        toast.show(`Showroom "${wh.name}" permanently deleted.`, 'info');
        if (refreshCallback) refreshCallback();
      }
    };
  });
}

function openEditWarehouseModal(warehouseId, onSaved) {
  const wh = warehouseService.getWarehouseById(warehouseId);
  if (!wh) return;

  const contentHtml = `
    <form id="edit-wh-form" class="space-y-6 text-xs">
      <section class="bg-white p-5 rounded-2xl border border-slate-200/90 shadow-2xs space-y-4">
        <div class="flex items-center justify-between border-b border-slate-100 pb-3">
          <h3 class="text-xs font-bold uppercase tracking-wider text-slate-500">Edit Facility Details</h3>
          <span class="text-[11px] text-slate-400">All fields marked with <span class="text-red-500">*</span> are required</span>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div class="space-y-1.5 md:col-span-2">
            <label class="text-xs font-semibold text-slate-700" for="edit-wh-name">Warehouse / Showroom Name <span class="text-red-500">*</span></label>
            <input type="text" id="edit-wh-name" required value="${(wh.name || '').replace(/"/g, '&quot;')}" placeholder="e.g. Warehouse, Office, Showroom" class="w-full text-xs font-bold rounded-xl border border-slate-200 focus:border-[#138FCB] focus:ring focus:ring-blue-100 py-2.5 px-3 text-slate-800 bg-white shadow-2xs">
          </div>
          <div class="space-y-1.5">
            <label class="text-xs font-semibold text-slate-700" for="edit-wh-city">City <span class="text-red-500">*</span></label>
            <input type="text" id="edit-wh-city" required value="${(wh.city || '').replace(/"/g, '&quot;')}" placeholder="e.g. Lahore, Gujranwala" class="w-full text-xs font-medium rounded-xl border border-slate-200 focus:border-[#138FCB] focus:ring focus:ring-blue-100 py-2.5 px-3 text-slate-800 bg-white shadow-2xs">
          </div>
          <div class="space-y-1.5">
            <label class="text-xs font-semibold text-slate-700" for="edit-wh-code">Facility Code</label>
            <input type="text" id="edit-wh-code" readonly value="${wh.code || ''}" class="w-full text-xs font-bold rounded-xl border border-slate-200 py-2.5 px-3 text-slate-400 bg-slate-50 shadow-2xs cursor-not-allowed">
          </div>
          <div class="md:col-span-2 space-y-1.5">
            <label class="text-xs font-semibold text-slate-700" for="edit-wh-address">Physical Address <span class="text-red-500">*</span></label>
            <input type="text" id="edit-wh-address" required value="${(wh.address || '').replace(/"/g, '&quot;')}" placeholder="e.g. Plot 45-B Industrial Area" class="w-full text-xs font-medium rounded-xl border border-slate-200 focus:border-[#138FCB] focus:ring focus:ring-blue-100 py-2.5 px-3 text-slate-800 bg-white shadow-2xs">
          </div>
          <div class="space-y-1.5">
            <label class="text-xs font-semibold text-slate-700" for="edit-wh-contact">In-Charge Contact Person</label>
            <input type="text" id="edit-wh-contact" value="${(wh.contactPerson || '').replace(/"/g, '&quot;')}" placeholder="e.g. Tariq Mehmood" class="w-full text-xs font-medium rounded-xl border border-slate-200 focus:border-[#138FCB] focus:ring focus:ring-blue-100 py-2.5 px-3 text-slate-800 bg-white shadow-2xs">
          </div>
          <div class="space-y-1.5">
            <label class="text-xs font-semibold text-slate-700" for="edit-wh-phone">Phone Number</label>
            <input type="tel" id="edit-wh-phone" value="${(wh.phone || '').replace(/"/g, '&quot;')}" placeholder="e.g. +92 300 1234567" class="w-full text-xs font-medium rounded-xl border border-slate-200 focus:border-[#138FCB] focus:ring focus:ring-blue-100 py-2.5 px-3 text-slate-800 bg-white shadow-2xs">
          </div>
        </div>
      </section>
    </form>
  `;

  const footerHtml = `
    <div class="flex items-center space-x-2 text-xs text-slate-400">
      <span>Changes updated across inventory and warehouse records</span>
    </div>
    <div class="flex items-center space-x-3 w-full sm:w-auto justify-end">
      <button id="edit-wh-cancel-btn" type="button" class="px-4 py-2 text-xs font-semibold text-slate-700 bg-white hover:bg-slate-50 rounded-xl transition-colors border border-slate-300 cursor-pointer shadow-2xs">
        Cancel
      </button>
      <button type="submit" form="edit-wh-form" class="inline-flex items-center space-x-2 px-5 py-2.5 text-xs font-bold text-white bg-[#138FCB] hover:bg-[#0E78AC] rounded-xl shadow-sm transition-all active:scale-[0.98] cursor-pointer">
        <span>Save Changes</span>
      </button>
    </div>
  `;

  openModal({
    title: 'Edit Showroom / Warehouse',
    subtitle: `Update details for ${wh.name}`,
    badge: wh.code,
    icon: '🏢',
    contentHtml,
    footerHtml,
    size: 'max-w-2xl',
    onOpen: (modalEl) => {
      const cancelBtn = modalEl.querySelector('#edit-wh-cancel-btn');
      if (cancelBtn) cancelBtn.onclick = () => closeModal();

      modalEl.querySelector('#edit-wh-form').onsubmit = (e) => {
        e.preventDefault();
        const name = modalEl.querySelector('#edit-wh-name').value.trim();
        const city = modalEl.querySelector('#edit-wh-city').value.trim();
        const address = modalEl.querySelector('#edit-wh-address').value.trim();
        const contactPerson = modalEl.querySelector('#edit-wh-contact').value.trim();
        const phone = modalEl.querySelector('#edit-wh-phone').value.trim();

        if (!name) {
          toast.show('Showroom name cannot be empty.', 'error');
          return;
        }

        warehouseService.updateWarehouse(warehouseId, {
          name,
          city,
          address,
          contactPerson,
          phone
        });

        toast.show(`Showroom "${name}" updated successfully.`, 'success');
        closeModal();
        if (onSaved) onSaved();
      };
    }
  });
}

function openAddWarehouseModal(onSaved) {
  const nextNum = warehouseService.getAllWarehouses().length + 1;
  const autoCode = `WH-${String(nextNum).padStart(3, '0')}`;

  const contentHtml = `
    <form id="add-wh-form" class="space-y-6 text-xs">
      <section class="bg-white p-5 rounded-2xl border border-slate-200/90 shadow-2xs space-y-4">
        <div class="flex items-center justify-between border-b border-slate-100 pb-3">
          <h3 class="text-xs font-bold uppercase tracking-wider text-slate-500">Facility Information</h3>
          <span class="text-[11px] text-slate-400">All fields marked with <span class="text-red-500">*</span> are required</span>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div class="space-y-1.5 md:col-span-2">
            <label class="text-xs font-semibold text-slate-700" for="new-wh-name">Warehouse / Showroom Name <span class="text-red-500">*</span></label>
            <input type="text" id="new-wh-name" required placeholder="e.g. Faisalabad Showroom & Regional Depot" class="w-full text-xs font-bold rounded-xl border border-slate-200 focus:border-[#138FCB] focus:ring focus:ring-blue-100 py-2.5 px-3 text-slate-800 bg-white shadow-2xs">
          </div>
          <div class="space-y-1.5">
            <label class="text-xs font-semibold text-slate-700" for="new-wh-city">City <span class="text-red-500">*</span></label>
            <input type="text" id="new-wh-city" required placeholder="e.g. Faisalabad" class="w-full text-xs font-medium rounded-xl border border-slate-200 focus:border-[#138FCB] focus:ring focus:ring-blue-100 py-2.5 px-3 text-slate-800 bg-white shadow-2xs">
          </div>
          <div class="space-y-1.5">
            <label class="text-xs font-semibold text-slate-700" for="new-wh-code">Facility Code</label>
            <input type="text" id="new-wh-code" readonly value="${autoCode}" class="w-full text-xs font-bold rounded-xl border border-slate-200 py-2.5 px-3 text-slate-400 bg-slate-50 shadow-2xs cursor-not-allowed">
          </div>
          <div class="md:col-span-2 space-y-1.5">
            <label class="text-xs font-semibold text-slate-700" for="new-wh-address">Physical Address <span class="text-red-500">*</span></label>
            <input type="text" id="new-wh-address" required placeholder="e.g. Plot 12, Small Industrial Estate" class="w-full text-xs font-medium rounded-xl border border-slate-200 focus:border-[#138FCB] focus:ring focus:ring-blue-100 py-2.5 px-3 text-slate-800 bg-white shadow-2xs">
          </div>
          <div class="space-y-1.5">
            <label class="text-xs font-semibold text-slate-700" for="new-wh-contact">Contact Person / In-Charge</label>
            <input type="text" id="new-wh-contact" placeholder="e.g. Tariq Mehmood" class="w-full text-xs font-medium rounded-xl border border-slate-200 focus:border-[#138FCB] focus:ring focus:ring-blue-100 py-2.5 px-3 text-slate-800 bg-white shadow-2xs">
          </div>
          <div class="space-y-1.5">
            <label class="text-xs font-semibold text-slate-700" for="new-wh-phone">Phone Number</label>
            <input type="tel" id="new-wh-phone" placeholder="e.g. +92 300 1234567" class="w-full text-xs font-medium rounded-xl border border-slate-200 focus:border-[#138FCB] focus:ring focus:ring-blue-100 py-2.5 px-3 text-slate-800 bg-white shadow-2xs">
          </div>
        </div>
      </section>
    </form>
  `;

  const footerHtml = `
    <div class="flex items-center space-x-2 text-xs text-slate-400">
      <span>Warehouse facility registered with double-entry stock ledger</span>
    </div>
    <div class="flex items-center space-x-3 w-full sm:w-auto justify-end">
      <button id="add-wh-cancel-btn" type="button" class="px-4 py-2 text-xs font-semibold text-slate-700 bg-white hover:bg-slate-50 rounded-xl transition-colors border border-slate-300 cursor-pointer shadow-2xs">
        Cancel
      </button>
      <button type="submit" form="add-wh-form" class="inline-flex items-center space-x-2 px-5 py-2.5 text-xs font-bold text-white bg-[#138FCB] hover:bg-[#0E78AC] rounded-xl shadow-sm transition-all active:scale-[0.98] cursor-pointer">
        <span>Save Facility</span>
      </button>
    </div>
  `;

  openModal({
    title: 'Register New Showroom / Warehouse',
    subtitle: 'Add a showroom or physical storage depot to the multi-facility network',
    badge: autoCode,
    icon: '🏢',
    contentHtml,
    footerHtml,
    size: 'max-w-2xl',
    onOpen: (modalEl) => {
      const cancelBtn = modalEl.querySelector('#add-wh-cancel-btn');
      if (cancelBtn) cancelBtn.onclick = () => closeModal();

      modalEl.querySelector('#add-wh-form').onsubmit = (e) => {
        e.preventDefault();
        const name = modalEl.querySelector('#new-wh-name').value.trim();
        const city = modalEl.querySelector('#new-wh-city').value.trim();
        const address = modalEl.querySelector('#new-wh-address').value.trim();
        const contactPerson = modalEl.querySelector('#new-wh-contact').value.trim();
        const phone = modalEl.querySelector('#new-wh-phone').value.trim();

        if (!name) {
          toast.show('Showroom name is required.', 'error');
          return;
        }

        warehouseService.createWarehouse({
          name,
          city,
          address,
          contactPerson,
          phone
        });

        toast.show(`Showroom "${name}" registered successfully.`, 'success');
        closeModal();
        if (onSaved) onSaved();
      };
    }
  });
}
