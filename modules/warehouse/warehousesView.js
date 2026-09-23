/**
 * JS Traders ERP - Warehouses & Locations View
 */

import { warehouseService } from '../../services/warehouseService.js';
import { openModal, closeModal } from '../../components/modal.js';
import { toast } from '../../components/toast.js';

export function renderWarehousesView() {
  const warehouses = warehouseService.getWarehouses();

  return `
    <div class="space-y-6 animate-in fade-in duration-150">
      <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white p-4 rounded-2xl border border-[#EAECEF] shadow-[0_2px_4px_rgba(0,0,0,0.02)]">
        <div>
          <h2 class="text-base font-bold text-[#1A1D1F]">Warehouses &amp; Locations</h2>
          <p class="text-xs text-slate-400 mt-0.5">Multi-warehouse network and rack storage facilities</p>
        </div>
        <div class="flex items-center gap-2">
          <button id="nav-staff-access-btn" class="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-bold bg-slate-900 text-white rounded-xl hover:bg-slate-800 transition-colors shadow-xs cursor-pointer">
            <span>👥</span>
            <span>Staff &amp; Mobile Access</span>
          </button>
          <button id="add-wh-btn" class="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-bold bg-[#138FCB] text-white rounded-xl hover:bg-[#0E78AC] transition-colors shadow-xs cursor-pointer">
            <span>+</span>
            <span>Add Warehouse</span>
          </button>
        </div>
      </div>

      <div class="grid grid-cols-1 lg:grid-cols-3 gap-5">
        ${warehouses.map(wh => {
          const locations = warehouseService.getLocationsByWarehouse(wh.id);
          return `
            <div class="bg-white rounded-2xl p-5 border border-[#EAECEF] shadow-[0_2px_4px_rgba(0,0,0,0.02)] flex flex-col justify-between">
              <div>
                <div class="flex items-center justify-between mb-2">
                  <span class="text-[10px] font-bold uppercase tracking-wider text-[#138FCB]">${wh.code}</span>
                  <span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700">Operational</span>
                </div>
                <h3 class="text-base font-bold text-slate-900">${wh.name}</h3>
                <p class="text-xs text-slate-500 mt-1">${wh.address}, ${wh.city}</p>
                <div class="mt-3 text-xs text-slate-600 space-y-1">
                  <p>In-Charge: <strong>${wh.contactPerson || 'Tariq Mehmood'}</strong></p>
                  <p>Contact: ${wh.phone || '+92 300 1234567'}</p>
                </div>

                <!-- Warehouse Locations Sub-list -->
                <div class="mt-4 pt-3 border-t border-slate-100">
                  <div class="flex items-center justify-between mb-2">
                    <span class="text-[11px] font-bold text-slate-700 uppercase tracking-wider">Storage Racks &amp; Zones</span>
                    <span class="text-[10px] text-slate-400">${locations.length} Locations</span>
                  </div>
                  <div class="space-y-1.5">
                    ${locations.map(loc => `
                      <div class="p-2 bg-slate-50 rounded-lg text-xs flex justify-between items-center">
                        <span class="font-bold text-slate-800">${loc.code}</span>
                        <span class="text-slate-500 text-[11px]">${loc.name}</span>
                      </div>
                    `).join('')}
                  </div>
                </div>
              </div>

              <div class="mt-5 pt-3 border-t border-slate-100 flex justify-end">
                <button class="manage-locs-btn px-3 py-1.5 rounded-lg text-xs font-semibold bg-slate-100 text-slate-700 hover:bg-slate-200 transition-colors cursor-pointer" data-wh="${wh.id}">
                  Manage Locations →
                </button>
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

  container.querySelectorAll('.manage-locs-btn').forEach(btn => {
    btn.onclick = () => {
      window.app?.navigateTo('warehouse-locations');
    };
  });
}

function openAddWarehouseModal(onSaved) {
  const nextNum = warehouseService.getWarehouses().length + 1;
  const autoCode = `WH-${String(nextNum).padStart(3, '0')}`;

  const contentHtml = `
    <form id="add-wh-form" class="space-y-6 text-xs">
      <section class="bg-white p-5 rounded-xl border border-slate-200/80 shadow-xs space-y-4">
        <div class="flex items-center justify-between border-b border-slate-100 pb-3">
          <h3 class="text-xs font-bold uppercase tracking-wider text-slate-500 flex items-center space-x-2">
            <span>Facility Information</span>
          </h3>
          <span class="text-[11px] text-slate-400">All fields marked with <span class="text-red-500">*</span> are required</span>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div class="space-y-1.5">
            <label class="text-xs font-semibold text-slate-700">Warehouse Name <span class="text-red-500">*</span></label>
            <input type="text" id="new-wh-name" required placeholder="e.g. Faisalabad Regional Hub" class="w-full text-xs font-medium rounded-lg border border-slate-300 focus:border-[#138FCB] focus:ring focus:ring-blue-100 py-2.5 px-3 text-slate-800 bg-white shadow-2xs">
          </div>
          <div class="space-y-1.5">
            <label class="text-xs font-semibold text-slate-700">City <span class="text-red-500">*</span></label>
            <input type="text" id="new-wh-city" required placeholder="e.g. Faisalabad" class="w-full text-xs font-medium rounded-lg border border-slate-300 focus:border-[#138FCB] focus:ring focus:ring-blue-100 py-2.5 px-3 text-slate-800 bg-white shadow-2xs">
          </div>
          <div class="md:col-span-2 space-y-1.5">
            <label class="text-xs font-semibold text-slate-700">Physical Address <span class="text-red-500">*</span></label>
            <input type="text" id="new-wh-address" required placeholder="e.g. Plot 12, Small Industrial Estate" class="w-full text-xs font-medium rounded-lg border border-slate-300 focus:border-[#138FCB] focus:ring focus:ring-blue-100 py-2.5 px-3 text-slate-800 bg-white shadow-2xs">
          </div>
          <div class="space-y-1.5">
            <label class="text-xs font-semibold text-slate-700">Contact Person / In-Charge</label>
            <input type="text" id="new-wh-contact" placeholder="e.g. Tariq Mehmood" class="w-full text-xs font-medium rounded-lg border border-slate-300 focus:border-[#138FCB] focus:ring focus:ring-blue-100 py-2.5 px-3 text-slate-800 bg-white shadow-2xs">
          </div>
          <div class="space-y-1.5">
            <label class="text-xs font-semibold text-slate-700">Phone Number</label>
            <input type="tel" id="new-wh-phone" placeholder="e.g. +92 300 1234567" class="w-full text-xs font-medium rounded-lg border border-slate-300 focus:border-[#138FCB] focus:ring focus:ring-blue-100 py-2.5 px-3 text-slate-800 bg-white shadow-2xs">
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
      <button id="add-wh-cancel-btn" type="button" class="px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 rounded-lg transition-colors border border-slate-300 cursor-pointer">
        Cancel
      </button>
      <button type="submit" form="add-wh-form" class="inline-flex items-center space-x-2 px-5 py-2 text-xs font-bold text-white bg-[#138FCB] hover:bg-[#0E78AC] rounded-lg shadow-sm hover:shadow transition-all active:scale-[0.98] cursor-pointer">
        <span>Save Warehouse Facility</span>
      </button>
    </div>
  `;

  openModal({
    title: 'Register New Warehouse Facility',
    subtitle: 'Add a physical storage depot to the multi-warehouse network',
    badge: autoCode,
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

        warehouseService.createWarehouse({
          name,
          city,
          address,
          contactPerson,
          phone
        });

        toast.show(`Warehouse "${name}" created successfully.`, 'success');
        closeModal();
        if (onSaved) onSaved();
      };
    }
  });
}
