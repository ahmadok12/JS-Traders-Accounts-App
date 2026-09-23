/**
 * JS Traders ERP - Gatepass Management View
 * Warehouse operational logistics document.
 * Demonstrates:
 * 1. Dual-location inventory check (Warehouse vs Office)
 * 2. Multi-staff assignment & notification dispatch
 * 3. Review of mobile staff uploaded & compressed proof photos
 * 4. Warehouse Manager inspection & approval workflow
 */

import { gatepassService } from '../../services/gatepassService.js';
import { salesService } from '../../services/salesService.js';
import { warehouseService } from '../../services/warehouseService.js';
import { productService } from '../../services/productService.js';
import { inventoryService } from '../../services/inventoryService.js';
import { staffAuthService } from '../../services/staffAuthService.js';
import { authService } from '../../services/authService.js';
import { storageService } from '../../services/storageService.js';
import { renderTable, bindTableActions } from '../../components/table.js';
import { renderFilterBar } from '../../components/filters.js';
import { openModal, closeModal } from '../../components/modal.js';
import { confirmAction } from '../../components/confirmation.js';
import { renderProductVariantPicker, bindProductVariantPicker } from '../../components/searchableSelect.js';
import { toast } from '../../components/toast.js';

export function renderGatepassView() {
  const gatepasses = gatepassService.getGatepasses();
  const parties = salesService.getParties(true);
  const warehouses = warehouseService.getWarehouses();
  const partyMap = new Map(parties.map(p => [p.id, p.name]));
  const whMap = new Map(warehouses.map(w => [w.id, w.name]));
  const users = storageService.getCollection('users');
  const userMap = new Map(users.map(u => [u.id, u.fullName]));

  const filterBarHtml = renderFilterBar({
    searchPlaceholder: 'Search gatepasses by number, customer, vehicle...',
    primaryAction: { label: 'Create Draft Gatepass Outward' }
  });

  const columns = [
    {
      key: 'gatepassNumber',
      label: 'Gatepass #',
      render: row => `
        <div>
          <span class="font-bold text-[#138FCB] text-xs">${row.gatepassNumber}</span>
          <span class="block text-[10px] text-slate-400 uppercase tracking-wider">${row.gatepassType || 'Outward'}</span>
        </div>
      `
    },
    {
      key: 'date',
      label: 'Date',
      render: row => `<span class="text-slate-600 font-medium">${row.date}</span>`
    },
    {
      key: 'customer',
      label: 'Customer / Farm',
      render: row => `
        <div>
          <div class="font-bold text-slate-800">${row.customerName || partyMap.get(row.customerPartyId) || 'Customer'}</div>
          <div class="text-[10px] text-slate-400">Driver: ${row.driverName || 'N/A'} (${row.vehicleNumber || 'N/A'})</div>
        </div>
      `
    },
    {
      key: 'locationBreakdown',
      label: 'Dispatch Breakdown',
      render: row => {
        let totalWh = 0;
        let totalOff = 0;
        (row.lines || []).forEach(l => {
          totalWh += (Number(l.warehouseQty) || 0);
          totalOff += (Number(l.officeQty) || 0);
        });
        return `
          <div class="text-xs space-y-0.5">
            <div class="flex items-center gap-1.5">
              <span class="w-2 h-2 rounded-full bg-blue-500"></span>
              <span class="text-slate-700">Warehouse: <strong>${totalWh}</strong></span>
            </div>
            <div class="flex items-center gap-1.5">
              <span class="w-2 h-2 rounded-full bg-amber-500"></span>
              <span class="text-slate-700">Office: <strong>${totalOff}</strong></span>
            </div>
          </div>
        `;
      }
    },
    {
      key: 'assignedStaff',
      label: 'Assigned Staff',
      render: row => {
        const staffIds = row.assignedStaffIds || [];
        if (staffIds.length === 0) {
          return `<span class="text-slate-400 text-xs italic">Unassigned</span>`;
        }
        return `
          <div class="flex flex-wrap gap-1">
            ${staffIds.map(id => {
              const staff = userMap.get(id) || 'Staff';
              const hasProof = (row.staffProofs || []).some(p => p.staffId === id);
              return `
                <span class="px-2 py-0.5 rounded text-[10px] font-bold ${hasProof ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-slate-100 text-slate-700'}">
                  ${hasProof ? '✓ ' : ''}${staff}
                </span>
              `;
            }).join('')}
          </div>
        `;
      }
    },
    {
      key: 'status',
      label: 'Workflow Status',
      render: row => {
        let badgeClass = 'bg-slate-100 text-slate-700';
        if (row.status === 'Draft - Staff Assigned') badgeClass = 'bg-blue-50 text-blue-700 border border-blue-200';
        else if (row.status === 'Staff Submitted - Ready for Approval') badgeClass = 'bg-amber-50 text-amber-700 border border-amber-200 animate-pulse';
        else if (row.status === 'Approved - Ready to Deliver') badgeClass = 'bg-emerald-50 text-emerald-700 border border-emerald-200 font-extrabold';
        else if (row.status === 'Ready for Invoice') badgeClass = 'bg-purple-50 text-purple-700 border border-purple-200';
        else if (row.status === 'Completed') badgeClass = 'bg-slate-100 text-slate-500';
        else if (row.status === 'Voided') badgeClass = 'bg-rose-50 text-rose-700 border border-rose-200';

        const photoCount = (row.staffProofs || []).reduce((acc, p) => acc + (p.photos?.length || 0), 0);

        return `
          <div>
            <span class="px-2.5 py-0.5 rounded-full text-[10px] font-bold ${badgeClass}">
              ${row.status}
            </span>
            ${photoCount > 0 ? `
              <span class="block text-[10px] font-bold text-slate-500 mt-1">
                📸 ${photoCount} proof photo(s)
              </span>
            ` : ''}
          </div>
        `;
      }
    }
  ];

  const actions = [
    { label: 'View Draft', variant: 'secondary', onClick: (row) => openGatepassDetailModal(row) }
  ];

  const tableHtml = renderTable({
    columns,
    data: gatepasses,
    actions,
    emptyMessage: 'No gatepasses issued.'
  });

  return `
    <div id="gatepass-view-container" class="space-y-5 animate-in fade-in duration-150">
      ${filterBarHtml}
      <div id="gatepass-table-container">
        ${tableHtml}
      </div>
    </div>
  `;
}

export function bindGatepassEvents(container, refreshCallback) {
  const addBtn = container.querySelector('#filter-primary-btn');
  if (addBtn) {
    addBtn.onclick = () => openCreateGatepassModal(refreshCallback);
  }

  const gatepasses = gatepassService.getGatepasses();
  const actions = [
    { label: 'View', variant: 'secondary', onClick: (row) => openGatepassDetailModal(row, refreshCallback) }
  ];
  bindTableActions(container, actions, gatepasses);
}

function openCreateGatepassModal(onSaved, gatepassToEdit = null) {
  const isEdit = !!gatepassToEdit;
  const products = productService.getProducts();
  const variants = productService.getVariants();
  const staffMembers = staffAuthService.getStaffMembers();
  const whStaff = staffMembers.filter(s => s.staffType === 'warehouse_staff' || s.activeWarehouseId === 'wh-1');
  const officeStaff = staffMembers.filter(s => s.staffType === 'office_staff' || s.activeWarehouseId === 'wh-2');

  const renderRowHtml = (variantId = null, whQty = '', offQty = '', rowIdx = 0) => {
    const selectedVariant = variantId ? variants.find(v => v.id === variantId) || variants[0] : variants[0];
    const vId = selectedVariant ? selectedVariant.id : '';
    const selectedProduct = selectedVariant ? products.find(p => p.id === selectedVariant.productId) || products[0] : products[0];
    const unit = selectedVariant ? (selectedVariant.unit || 'PCS') : 'PCS';
    const whStock = inventoryService.getBalance('wh-1', vId);
    const officeStock = inventoryService.getBalance('wh-2', vId);
    const wVal = (whQty !== '' && whQty !== null && whQty !== undefined) ? whQty : '';
    const oVal = (offQty !== '' && offQty !== null && offQty !== undefined) ? offQty : '';
    const lineTotal = (Number(wVal) || 0) + (Number(oVal) || 0);

    const pickerHtml = renderProductVariantPicker({
      rowId: `gp-row-${rowIdx}`,
      selectedProductId: selectedProduct ? selectedProduct.id : null,
      selectedVariantId: vId,
      products,
      variants,
      whStock,
      officeStock,
      unit
    });

    return `
      <tr class="gp-line-row hover:bg-slate-50/70 transition-colors" data-row-index="${rowIdx}">
        <td class="p-3 align-top">
          ${pickerHtml}
        </td>
        <td class="p-3 text-center align-top">
          <span class="wh-stock-indicator block text-[10px] text-blue-700 bg-blue-50/80 px-2 py-1 rounded-lg border border-blue-200/80 font-bold mb-2">
            WH Stock: ${whStock.toLocaleString()} ${unit}
          </span>
          <input type="number" min="0" value="${wVal}" placeholder="0" class="gp-wh-qty w-28 text-center text-xs font-black rounded-xl border border-blue-200 focus:border-[#138FCB] focus:ring-2 focus:ring-blue-100 py-2 px-2 bg-white text-blue-900 shadow-2xs">
        </td>
        <td class="p-3 text-center align-top">
          <span class="office-stock-indicator block text-[10px] text-amber-800 bg-amber-50/80 px-2 py-1 rounded-lg border border-amber-200/80 font-bold mb-2">
            Office Stock: ${officeStock.toLocaleString()} ${unit}
          </span>
          <input type="number" min="0" value="${oVal}" placeholder="0" class="gp-office-qty w-28 text-center text-xs font-black rounded-xl border border-amber-200 focus:border-amber-500 focus:ring-2 focus:ring-amber-100 py-2 px-2 bg-white text-amber-900 shadow-2xs">
        </td>
        <td class="p-3 text-right align-top pt-4">
          <span class="gp-total-calc font-black text-slate-900 text-sm">${lineTotal > 0 ? `${lineTotal.toLocaleString()} ${unit}` : '—'}</span>
        </td>
        <td class="p-3 text-center align-top pt-3.5">
          <button type="button" class="gp-remove-row-btn w-8 h-8 inline-flex items-center justify-center rounded-xl text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition-colors cursor-pointer" title="Remove line item">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
              <path d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" stroke-linecap="round" stroke-linejoin="round"></path>
            </svg>
          </button>
        </td>
      </tr>
    `;
  };

  const contentHtml = `
    <form id="create-gp-form" class="space-y-6 text-xs">
      <!-- SECTION 1: Client & Logistics Configuration -->
      <section class="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-xs space-y-4" data-purpose="client-and-logistics">
        <div class="flex items-center justify-between border-b border-slate-100 pb-3">
          <h3 class="text-xs font-bold uppercase tracking-wider text-slate-700 flex items-center gap-2">
            <span>👤</span>
            <span>1. Client &amp; Logistics Details</span>
          </h3>
          <span class="text-[10px] text-slate-400 font-medium">All fields marked with <span class="text-red-500 font-bold">*</span> are required</span>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-12 gap-4">
          <!-- Client / Customer Destination Text Input -->
          <div class="md:col-span-12 space-y-1.5">
            <label class="text-xs font-semibold text-slate-700" for="gp-customer-name">Customer / Farm Name <span class="text-red-500">*</span></label>
            <input type="text" id="gp-customer-name" required placeholder="Enter Customer / Farm Name" value="${isEdit ? (gatepassToEdit.customerName || '') : ''}" class="w-full text-xs font-medium rounded-xl border border-slate-200 focus:border-[#138FCB] focus:ring focus:ring-blue-100 py-2.5 px-3 text-slate-800 bg-white shadow-2xs">
          </div>

          <!-- Vehicle Number -->
          <div class="md:col-span-4 space-y-1.5">
            <label class="text-xs font-semibold text-slate-700" for="gp-vehicle">Vehicle Number <span class="text-red-500">*</span></label>
            <input type="text" id="gp-vehicle" required placeholder="e.g. LES-9412 Truck" value="${isEdit ? (gatepassToEdit.vehicleNumber || '') : ''}" class="w-full text-xs font-medium rounded-xl border border-slate-200 focus:border-[#138FCB] focus:ring focus:ring-blue-100 py-2.5 px-3 text-slate-800 bg-white shadow-2xs">
          </div>

          <!-- Driver Name -->
          <div class="md:col-span-4 space-y-1.5">
            <label class="text-xs font-semibold text-slate-700" for="gp-driver">Driver Name <span class="text-red-500">*</span></label>
            <input type="text" id="gp-driver" required placeholder="e.g. Muhammad Rasheed" value="${isEdit ? (gatepassToEdit.driverName || '') : ''}" class="w-full text-xs font-medium rounded-xl border border-slate-200 focus:border-[#138FCB] focus:ring focus:ring-blue-100 py-2.5 px-3 text-slate-800 bg-white shadow-2xs">
          </div>

          <!-- Driver Phone -->
          <div class="md:col-span-4 space-y-1.5">
            <label class="text-xs font-semibold text-slate-700" for="gp-driver-phone">Driver Phone</label>
            <input type="tel" id="gp-driver-phone" placeholder="e.g. +92 345 6789012" value="${isEdit ? (gatepassToEdit.driverPhone || '') : ''}" class="w-full text-xs font-medium rounded-xl border border-slate-200 focus:border-[#138FCB] focus:ring focus:ring-blue-100 py-2.5 px-3 text-slate-800 bg-white shadow-2xs">
          </div>
        </div>
      </section>

      <!-- SECTION 2: Items & Dual-Location Allocation Table -->
      <section class="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-xs space-y-4" data-purpose="line-items-section">
        <div class="flex items-center justify-between border-b border-slate-100 pb-3">
          <div class="flex items-center space-x-2">
            <h3 class="text-xs font-bold uppercase tracking-wider text-slate-700 flex items-center gap-1.5">
              <span>📦</span>
              <span>2. Items &amp; Dual-Location Allocation</span>
            </h3>
            <span id="gp-lines-count-badge" class="px-2 py-0.5 text-[10px] font-semibold rounded-full bg-slate-100 text-slate-600">${isEdit && gatepassToEdit.lines?.length ? gatepassToEdit.lines.length : 1} Product${(isEdit && gatepassToEdit.lines?.length > 1) ? 's' : ''}</span>
          </div>
          <span class="text-[10px] text-slate-400 font-medium">Type to search catalog &amp; pick variants</span>
        </div>

        <!-- Table Container -->
        <div class="overflow-visible border border-slate-200/80 rounded-xl">
          <table class="w-full text-left text-xs">
            <thead class="bg-slate-50 text-slate-500 uppercase text-[10px] tracking-wider border-b border-slate-200/80">
              <tr>
                <th class="py-3 px-3 w-5/12 font-semibold">Item &amp; Description</th>
                <th class="py-3 px-2 w-[22%] font-semibold text-center">Delivered from WH *</th>
                <th class="py-3 px-2 w-[22%] font-semibold text-center">Delivered from Office *</th>
                <th class="py-3 px-3 w-[10%] font-semibold text-right">Cargo Qty</th>
                <th class="py-3 px-2 w-[4%] font-semibold text-center">Action</th>
              </tr>
            </thead>
            <tbody id="gp-items-tbody" class="divide-y divide-slate-100 text-slate-700">
              ${isEdit && (gatepassToEdit.lines || []).length > 0
                ? gatepassToEdit.lines.map((l, idx) => renderRowHtml(l.variantId, l.warehouseQty, l.officeQty, idx)).join('')
                : renderRowHtml(variants[0]?.id, '', '', 0)}
            </tbody>
          </table>
        </div>

        <!-- Action Row under Table (Add Product Button placed above Assign Staff) -->
        <div class="pt-1">
          <button type="button" id="add-gp-row-btn" class="inline-flex items-center space-x-2 px-4 py-2.5 bg-blue-50/80 hover:bg-blue-100 text-[#138FCB] rounded-xl text-xs font-bold border border-blue-200 transition-all cursor-pointer shadow-2xs hover:shadow-xs active:scale-98">
            <span class="text-base leading-none font-extrabold">+</span>
            <span>Add Line Item</span>
          </button>
        </div>
      </section>

      <!-- SECTION 3: Dedicated Station Staff Assignment (Under Add Line Item) -->
      <section class="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-xs space-y-4" data-purpose="staff-assignment-section">
        <div class="flex items-center justify-between border-b border-slate-100 pb-3">
          <h3 class="text-xs font-bold uppercase tracking-wider text-slate-700 flex items-center space-x-2">
            <span>👥</span>
            <span>3. Assign Station Floor Staff</span>
          </h3>
          <span class="text-[10px] text-slate-400">Staff receive instant mobile siren &amp; pick tasks</span>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
          <!-- Warehouse Staff Group (wh-1) -->
          <div class="p-3.5 bg-blue-50/40 rounded-xl border border-blue-200/70 space-y-2">
            <div class="flex items-center justify-between pb-1.5 border-b border-blue-200/60">
              <span class="text-xs font-bold text-blue-800 flex items-center gap-1.5">
                <span>📦 Warehouse Floor Staff</span>
              </span>
              <span class="text-[10px] font-bold text-blue-600 bg-white px-2 py-0.5 rounded-full border border-blue-200">Main Warehouse (wh-1)</span>
            </div>
            <div class="space-y-1.5">
              ${whStaff.map(staff => {
                const isChecked = isEdit ? (gatepassToEdit.assignedStaffIds || []).includes(staff.id) : true;
                return `
                  <label class="flex items-center justify-between p-2 bg-white hover:bg-blue-50/60 rounded-xl border border-blue-100 hover:border-blue-300 cursor-pointer transition-all shadow-2xs">
                    <div class="flex items-center gap-2.5">
                      <input type="checkbox" name="assignedStaff" value="${staff.id}" ${isChecked ? 'checked' : ''} class="w-4 h-4 rounded text-[#138FCB] focus:ring-0">
                      <div>
                        <span class="text-xs font-bold text-slate-800">${staff.fullName}</span>
                        <span class="text-[10px] text-slate-400 block font-mono">PIN: ${staff.pin || '••••'}</span>
                      </div>
                    </div>
                    <span class="text-[10px] text-emerald-600 font-semibold bg-emerald-50 px-1.5 py-0.5 rounded">Active Staff</span>
                  </label>
                `;
              }).join('')}
            </div>
          </div>

          <!-- Office Staff Group (wh-2) -->
          <div class="p-3.5 bg-amber-50/40 rounded-xl border border-amber-200/70 space-y-2">
            <div class="flex items-center justify-between pb-1.5 border-b border-amber-200/60">
              <span class="text-xs font-bold text-amber-800 flex items-center gap-1.5">
                <span>🏢 Office Floor Staff</span>
              </span>
              <span class="text-[10px] font-bold text-amber-700 bg-white px-2 py-0.5 rounded-full border border-amber-200">Office Hub (wh-2)</span>
            </div>
            <div class="space-y-1.5">
              ${officeStaff.map(staff => {
                const isChecked = isEdit ? (gatepassToEdit.assignedStaffIds || []).includes(staff.id) : true;
                return `
                  <label class="flex items-center justify-between p-2 bg-white hover:bg-amber-50/60 rounded-xl border border-amber-100 hover:border-amber-300 cursor-pointer transition-all shadow-2xs">
                    <div class="flex items-center gap-2.5">
                      <input type="checkbox" name="assignedStaff" value="${staff.id}" ${isChecked ? 'checked' : ''} class="w-4 h-4 rounded text-amber-600 focus:ring-0">
                      <div>
                        <span class="text-xs font-bold text-slate-800">${staff.fullName}</span>
                        <span class="text-[10px] text-slate-400 block font-mono">PIN: ${staff.pin || '••••'}</span>
                      </div>
                    </div>
                    <span class="text-[10px] text-emerald-600 font-semibold bg-emerald-50 px-1.5 py-0.5 rounded">Active Staff</span>
                  </label>
                `;
              }).join('')}
            </div>
          </div>
        </div>
      </section>

      <!-- SECTION 4: Bottom Dual Columns (Notes vs Summary) -->
      <div class="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
        <!-- Notes -->
        <div class="lg:col-span-7 bg-white p-5 rounded-2xl border border-slate-200/80 shadow-xs space-y-2" data-purpose="terms-and-notes">
          <label class="text-xs font-semibold text-slate-700" for="gp-notes">Dispatch Note / Special Instructions</label>
          <textarea class="w-full text-xs rounded-xl border border-slate-200 focus:border-[#138FCB] focus:ring focus:ring-blue-100 text-slate-700 p-3 resize-none shadow-2xs" id="gp-notes" placeholder="Add custom message, transport notes, or loading precautions..." rows="3">${isEdit ? (gatepassToEdit.notes || '') : ''}</textarea>
        </div>

        <!-- Summary Breakdown Card -->
        <div class="lg:col-span-5 bg-white p-5 rounded-2xl border border-slate-200/80 shadow-xs space-y-3" data-purpose="totals-summary-card">
          <h3 class="text-xs font-bold uppercase tracking-wider text-slate-700 pb-1 border-b border-slate-100">Cargo Summary</h3>
          <div class="space-y-2 text-xs">
            <div class="flex justify-between text-slate-600">
              <span>From Warehouse (wh-1)</span>
              <span id="summary-wh-qty" class="font-bold text-blue-700">0 PCS</span>
            </div>
            <div class="flex justify-between text-slate-600">
              <span>From Office (wh-2)</span>
              <span id="summary-off-qty" class="font-bold text-amber-700">0 PCS</span>
            </div>
            <div class="flex justify-between text-slate-600">
              <span>Workflow State</span>
              <span class="text-amber-600 font-semibold bg-amber-50 px-2 py-0.5 rounded text-[10px]">Draft - Awaiting Staff Pick</span>
            </div>
          </div>

          <!-- Grand Total Highlight Card -->
          <div class="mt-4 pt-3 bg-blue-50/50 -mx-5 -mb-5 p-5 rounded-b-2xl border-t border-blue-100 flex items-center justify-between">
            <div>
              <p class="text-[11px] font-bold uppercase tracking-wider text-[#138FCB]">Total Outward Cargo</p>
            </div>
            <div class="text-right">
              <span id="summary-total-qty" class="text-2xl font-black text-slate-900 tracking-tight">0 PCS</span>
            </div>
          </div>
        </div>
      </div>
    </form>
  `;

  const footerHtml = `
    <div class="flex items-center space-x-2 text-xs text-emerald-600 font-medium">
      <span class="w-2 h-2 rounded-full bg-emerald-500"></span>
      <span>🛡️ SSL 256-bit encrypted ERP transaction</span>
    </div>
    <div class="flex items-center space-x-3 w-full sm:w-auto justify-end">
      <button id="gp-cancel-btn" type="button" class="px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100 rounded-xl transition-colors border border-slate-200 cursor-pointer">
        Cancel
      </button>
      <button type="submit" form="create-gp-form" class="inline-flex items-center space-x-2 px-5 py-2.5 text-xs font-bold text-white bg-[#138FCB] hover:bg-[#0E78AC] rounded-xl shadow-xs transition-all active:scale-[0.98] cursor-pointer">
        <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
          <path d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" stroke-linecap="round" stroke-linejoin="round"></path>
        </svg>
        <span>${isEdit ? 'Save Changes &amp; Update Staff' : 'Create &amp; Notify Staff'}</span>
      </button>
    </div>
  `;

  openModal({
    title: isEdit ? 'Edit Draft Gatepass Outward' : 'Create Draft Gatepass Outward',
    subtitle: isEdit ? `Modify dispatch details, stock allocation, or assigned staff for ${gatepassToEdit.gatepassNumber}` : 'Fill in the dispatch details and multi-location item breakdown to issue gatepass outward',
    badge: isEdit ? gatepassToEdit.gatepassNumber : 'GP-DRAFT',
    contentHtml,
    footerHtml,
    size: 'max-w-5xl',
    onOpen: (modalEl) => {
      const cancelBtn = modalEl.querySelector('#gp-cancel-btn');
      if (cancelBtn) cancelBtn.onclick = () => closeModal();

      const tbody = modalEl.querySelector('#gp-items-tbody');
      const addRowBtn = modalEl.querySelector('#add-gp-row-btn');
      const summaryWh = modalEl.querySelector('#summary-wh-qty');
      const summaryOff = modalEl.querySelector('#summary-off-qty');
      const summaryTotal = modalEl.querySelector('#summary-total-qty');
      const lineCountBadge = modalEl.querySelector('#gp-lines-count-badge');
      let rowCounter = isEdit && gatepassToEdit.lines?.length ? gatepassToEdit.lines.length : 1;

      const updateRowCalculations = (row) => {
        const varInput = row.querySelector('.gp-item-var');
        const whIndicator = row.querySelector('.wh-stock-indicator');
        const offIndicator = row.querySelector('.office-stock-indicator');
        const whQtyInput = row.querySelector('.gp-wh-qty');
        const offQtyInput = row.querySelector('.gp-office-qty');
        const totalDisplay = row.querySelector('.gp-total-calc');

        const vId = varInput ? varInput.value : '';
        const selectedVariant = variants.find(v => v.id === vId);
        const unit = selectedVariant ? (selectedVariant.unit || 'PCS') : (varInput?.getAttribute('data-unit') || 'PCS');
        const wStock = inventoryService.getBalance('wh-1', vId);
        const oStock = inventoryService.getBalance('wh-2', vId);

        if (whIndicator) whIndicator.textContent = `WH Stock: ${wStock.toLocaleString()} ${unit}`;
        if (offIndicator) offIndicator.textContent = `Office Stock: ${oStock.toLocaleString()} ${unit}`;

        const rawW = whQtyInput ? whQtyInput.value.trim() : '';
        const rawO = offQtyInput ? offQtyInput.value.trim() : '';
        const wQty = Number(rawW) || 0;
        const oQty = Number(rawO) || 0;
        const lineTotal = wQty + oQty;
        if (!rawW && !rawO) {
          if (totalDisplay) totalDisplay.textContent = '—';
        } else {
          if (totalDisplay) totalDisplay.textContent = `${lineTotal.toLocaleString()} ${unit}`;
        }
      };

      const updateSummaryTotals = () => {
        const rows = tbody.querySelectorAll('.gp-line-row');
        let totalWh = 0;
        let totalOff = 0;

        rows.forEach(row => {
          const whQty = Number(row.querySelector('.gp-wh-qty')?.value) || 0;
          const offQty = Number(row.querySelector('.gp-office-qty')?.value) || 0;
          totalWh += whQty;
          totalOff += offQty;
        });

        const grandTotal = totalWh + totalOff;
        if (summaryWh) summaryWh.textContent = totalWh > 0 ? `${totalWh.toLocaleString()} PCS` : '0 PCS';
        if (summaryOff) summaryOff.textContent = totalOff > 0 ? `${totalOff.toLocaleString()} PCS` : '0 PCS';
        if (summaryTotal) summaryTotal.textContent = grandTotal > 0 ? `${grandTotal.toLocaleString()} PCS` : '0 PCS';
        if (lineCountBadge) lineCountBadge.textContent = `${rows.length} Product${rows.length > 1 ? 's' : ''}`;

        // Update remove button state
        const removeBtns = tbody.querySelectorAll('.gp-remove-row-btn');
        removeBtns.forEach(btn => {
          if (rows.length <= 1) {
            btn.classList.add('opacity-30', 'cursor-not-allowed');
            btn.setAttribute('disabled', 'true');
          } else {
            btn.classList.remove('opacity-30', 'cursor-not-allowed');
            btn.removeAttribute('disabled');
          }
        });
      };

      const bindRowEvents = (row) => {
        const pickerContainer = row.querySelector('.pv-picker-container');
        if (pickerContainer) {
          bindProductVariantPicker(pickerContainer, {
            products,
            variants,
            onVariantChanged: () => {
              updateRowCalculations(row);
              updateSummaryTotals();
            }
          });
        }

        const whQtyInput = row.querySelector('.gp-wh-qty');
        const offQtyInput = row.querySelector('.gp-office-qty');
        const removeBtn = row.querySelector('.gp-remove-row-btn');

        if (whQtyInput) {
          whQtyInput.oninput = () => {
            updateRowCalculations(row);
            updateSummaryTotals();
          };
        }

        if (offQtyInput) {
          offQtyInput.oninput = () => {
            updateRowCalculations(row);
            updateSummaryTotals();
          };
        }

        if (removeBtn) {
          removeBtn.onclick = () => {
            const rows = tbody.querySelectorAll('.gp-line-row');
            if (rows.length > 1) {
              row.remove();
              updateSummaryTotals();
            }
          };
        }
      };

      const appendNewRow = (variantId = null, whQty = '', offQty = '') => {
        rowCounter++;
        const tempDiv = document.createElement('tbody');
        tempDiv.innerHTML = renderRowHtml(variantId, whQty, offQty, rowCounter);
        const newRow = tempDiv.firstElementChild;
        tbody.appendChild(newRow);
        bindRowEvents(newRow);
        updateRowCalculations(newRow);
        updateSummaryTotals();
        return newRow;
      };

      // Initial row binding
      tbody.querySelectorAll('.gp-line-row').forEach(row => {
        bindRowEvents(row);
        updateRowCalculations(row);
      });
      updateSummaryTotals();

      const handleAddRow = () => {
        const existingIds = new Set(Array.from(tbody.querySelectorAll('.gp-item-var')).map(s => s.value));
        const nextUnused = variants.find(v => !existingIds.has(v.id)) || variants[0];
        appendNewRow(nextUnused ? nextUnused.id : null, '', '');
      };

      if (addRowBtn) addRowBtn.onclick = handleAddRow;

      // Form submission
      modalEl.querySelector('#create-gp-form').onsubmit = (e) => {
        e.preventDefault();
        const customerName = modalEl.querySelector('#gp-customer-name').value.trim();
        const vehicleNumber = modalEl.querySelector('#gp-vehicle').value.trim();
        const driverName = modalEl.querySelector('#gp-driver').value.trim();
        const driverPhone = modalEl.querySelector('#gp-driver-phone').value.trim();
        const notes = modalEl.querySelector('#gp-notes').value.trim();

        const assignedStaffIds = Array.from(modalEl.querySelectorAll('input[name="assignedStaff"]:checked'))
          .map(cb => cb.value);

        const rows = tbody.querySelectorAll('.gp-line-row');
        const lines = [];

        rows.forEach(row => {
          const varInput = row.querySelector('.gp-item-var');
          const variantId = varInput ? varInput.value : '';
          const selectedVariant = variants.find(v => v.id === variantId);
          const unit = selectedVariant ? (selectedVariant.unit || 'PCS') : (varInput?.getAttribute('data-unit') || 'PCS');
          const warehouseQty = Number(row.querySelector('.gp-wh-qty')?.value) || 0;
          const officeQty = Number(row.querySelector('.gp-office-qty')?.value) || 0;

          if (variantId && (warehouseQty > 0 || officeQty > 0)) {
            lines.push({
              variantId,
              warehouseQty,
              officeQty,
              quantity: warehouseQty + officeQty,
              unit
            });
          }
        });

        if (lines.length === 0) {
          toast.show('Please specify quantity to be delivered from Warehouse or Office for at least one product.', 'warning');
          return;
        }

        if (isEdit) {
          gatepassService.updateGatepass(gatepassToEdit.id, {
            customerName,
            assignedStaffIds,
            vehicleNumber,
            driverName,
            driverPhone,
            lines,
            notes
          });
          toast.show(`Draft Gatepass ${gatepassToEdit.gatepassNumber} updated! Assigned staff have been notified.`, 'success');
        } else {
          gatepassService.createGatepass({
            gatepassType: 'outward',
            customerName,
            assignedStaffIds,
            vehicleNumber,
            driverName,
            driverPhone,
            lines,
            notes,
            userId: authService.getCurrentUser().id
          });
          toast.show(`Draft Gatepass Outward created with ${lines.length} product(s)! Assigned staff have been notified on their mobile app.`, 'success');
        }

        closeModal();
        if (onSaved) onSaved();
      };
    }
  });
}

function openGatepassDetailModal(gatepass, onSaved) {
  const parties = salesService.getParties(true);
  const party = parties.find(p => p.id === gatepass.customerPartyId);
  const variants = productService.getVariants();
  const varMap = new Map(variants.map(v => [v.id, v.name]));
  const users = storageService.getCollection('users');
  const userMap = new Map(users.map(u => [u.id, u]));

  const staffProofs = gatepass.staffProofs || [];
  const assignedStaffIds = gatepass.assignedStaffIds || [];
  const isApproved = gatepass.status === 'Approved - Ready to Deliver' || gatepass.status === 'Completed';
  const isDraftOrEditable = gatepass.status !== 'Approved - Ready to Deliver' && gatepass.status !== 'Completed' && gatepass.status !== 'Voided';

  const totalCargo = (gatepass.lines || []).reduce((sum, l) => sum + (l.quantity || 0), 0);
  const totalWhCargo = (gatepass.lines || []).reduce((sum, l) => sum + (l.warehouseQty || 0), 0);
  const totalOffCargo = (gatepass.lines || []).reduce((sum, l) => sum + (l.officeQty || 0), 0);

  const assignedStaffMembers = assignedStaffIds.map(id => userMap.get(id)).filter(Boolean);
  const assignedWhStaff = assignedStaffMembers.filter(s => s.staffType === 'warehouse_staff');
  const assignedOfficeStaff = assignedStaffMembers.filter(s => s.staffType === 'office_staff');

  const headerActionsHtml = isDraftOrEditable ? `
    <button id="gp-header-edit-btn" type="button" class="inline-flex items-center space-x-1.5 px-3 py-1.5 text-xs font-bold text-[#138FCB] bg-blue-50 hover:bg-blue-100 rounded-lg transition-colors border border-blue-200 cursor-pointer shadow-2xs">
      <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"></path>
      </svg>
      <span>Edit Gatepass</span>
    </button>
  ` : '';

  const contentHtml = `
    <div class="space-y-6 text-xs">
      <!-- SECTION 1: Destination & Transport Card -->
      <section class="bg-white p-5 rounded-xl border border-slate-200/80 shadow-xs space-y-4">
        <div class="flex items-center justify-between border-b border-slate-100 pb-3">
          <h3 class="text-xs font-bold uppercase tracking-wider text-slate-500 flex items-center space-x-2">
            <svg class="w-3.5 h-3.5 text-[#138FCB]" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
              <path d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" stroke-linecap="round" stroke-linejoin="round"></path>
            </svg>
            <span>Customer &amp; Dispatch Logistics</span>
          </h3>
          <div class="flex items-center space-x-2">
            ${isDraftOrEditable ? `
              <button id="gp-card-edit-btn" type="button" class="inline-flex items-center space-x-1 px-2.5 py-1 rounded-lg text-[11px] font-bold text-slate-700 bg-white hover:bg-slate-50 border border-slate-300 shadow-2xs transition-colors cursor-pointer">
                <svg class="w-3 h-3 text-[#138FCB]" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"></path>
                </svg>
                <span>Edit</span>
              </button>
            ` : ''}
            <span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-semibold ${gatepass.status === 'Voided' ? 'bg-rose-50 text-rose-700 border border-rose-200' : isApproved ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-amber-50 text-amber-700 border border-amber-200'}">
              ${gatepass.status}
            </span>
          </div>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-12 gap-4">
          <div class="md:col-span-6 space-y-1">
            <span class="text-[11px] text-slate-400 font-semibold block">Client / Customer</span>
            <p class="text-sm font-bold text-slate-900">${gatepass.customerName || (party ? party.name : 'Customer')}</p>
            <p class="text-[11px] text-slate-400">Date: ${gatepass.date ? new Date(gatepass.date).toLocaleDateString() : 'Today'}</p>
          </div>
          <div class="md:col-span-3 space-y-1">
            <span class="text-[11px] text-slate-400 font-semibold block">Carrier / Vehicle</span>
            <p class="text-xs font-bold text-slate-800">${gatepass.vehicleNumber || 'LES-9412 Truck'}</p>
            <p class="text-[11px] text-slate-500">Commercial Transport</p>
          </div>
          <div class="md:col-span-3 space-y-1">
            <span class="text-[11px] text-slate-400 font-semibold block">Assigned Driver</span>
            <p class="text-xs font-bold text-slate-800">${gatepass.driverName || 'Muhammad Rasheed'}</p>
            <p class="text-[11px] text-slate-500">${gatepass.driverPhone || '+92 345 6789012'}</p>
          </div>
        </div>

        <!-- Secondary Status Banner -->
        <div class="bg-slate-50/80 rounded-lg p-3 text-xs flex flex-wrap items-center justify-between gap-3 border border-slate-100 text-slate-600">
          <div class="flex items-center space-x-2">
            <span class="font-semibold text-slate-700">Dispatch Points:</span>
            <span class="text-slate-500">Warehouse (${totalWhCargo} PCS) &amp; Office (${totalOffCargo} PCS)</span>
          </div>
          <div class="text-[11px] text-slate-500 font-medium">
            Staff Progress: <strong class="text-slate-800">${staffProofs.length} of ${assignedStaffIds.length} submitted</strong>
          </div>
        </div>
      </section>

      <!-- SECTION 2: Dispatched Line Items Table with Assigned Staff directly under WH and Office -->
      <section class="bg-white p-5 rounded-xl border border-slate-200/80 shadow-xs space-y-4">
        <div class="flex items-center justify-between">
          <h3 class="text-xs font-bold uppercase tracking-wider text-slate-500">Cargo Line Items &amp; Dual-Location Split</h3>
          <span class="px-2 py-0.5 text-[10px] font-semibold rounded-full bg-slate-100 text-slate-600">${(gatepass.lines || []).length} Item(s)</span>
        </div>

        <div class="overflow-x-auto border border-slate-200 rounded-lg">
          <table class="w-full text-left text-xs">
            <thead class="bg-slate-50 text-slate-500 uppercase text-[10px] tracking-wider border-b border-slate-200">
              <tr>
                <th class="py-3 px-3 w-4/12 font-semibold">Item &amp; Description</th>
                <th class="py-3 px-3 w-[24%] font-semibold text-center">Warehouse Qty</th>
                <th class="py-3 px-3 w-[24%] font-semibold text-center">Office Qty</th>
                <th class="py-3 px-3 w-2/12 font-semibold text-right">Total Cargo</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-slate-100 text-slate-700">
              ${(gatepass.lines || []).map(l => `
                <tr class="hover:bg-slate-50/70 transition-colors">
                  <td class="p-3 font-semibold text-slate-800">${varMap.get(l.variantId) || 'Feed Pan 16"'}</td>
                  <td class="p-3 text-center">
                    <span class="inline-block px-2.5 py-1 rounded bg-blue-50 text-blue-700 font-bold border border-blue-200 text-xs">
                      ${l.warehouseQty || 0} ${l.unit}
                    </span>
                  </td>
                  <td class="p-3 text-center">
                    <span class="inline-block px-2.5 py-1 rounded bg-amber-50 text-amber-700 font-bold border border-amber-200 text-xs">
                      ${l.officeQty || 0} ${l.unit}
                    </span>
                  </td>
                  <td class="p-3 text-right font-black text-slate-900 text-sm">
                    ${l.quantity} ${l.unit}
                  </td>
                </tr>
              `).join('')}
            </tbody>
            <tfoot class="bg-slate-50/80 border-t-2 border-slate-200" data-purpose="assigned-staff-tfoot">
              <tr>
                <td class="p-3 align-top">
                  <div class="space-y-1">
                    <span class="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                      <svg class="w-3.5 h-3.5 text-[#138FCB]" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                        <path d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" stroke-linecap="round" stroke-linejoin="round"></path>
                      </svg>
                      <span>Assigned Staff:</span>
                    </span>
                    <p class="text-[10px] text-slate-500 leading-normal">
                      Staff assigned to physically arrange and verify goods at each facility.
                    </p>
                  </div>
                </td>
                <td class="p-2.5 align-top bg-blue-50/40 border-x border-slate-200">
                  <!-- Warehouse Staff directly under Warehouse Qty -->
                  <div class="space-y-1.5">
                    <div class="flex items-center justify-between pb-1 border-b border-blue-200/60">
                      <span class="text-[10px] font-bold text-blue-700 uppercase tracking-wider flex items-center gap-1">
                        <span>📦 WH Staff</span>
                      </span>
                      <span class="text-[10px] font-extrabold text-blue-800">${totalWhCargo} PCS</span>
                    </div>
                    ${assignedWhStaff.length === 0 ? `
                      <span class="text-[10px] text-slate-400 italic block py-1 text-center">No WH staff assigned</span>
                    ` : assignedWhStaff.map(staff => {
                      const proof = staffProofs.find(p => p.staffId === staff.id);
                      const hasSubmitted = !!proof;
                      return `
                        <div class="p-1.5 bg-white rounded-lg border ${hasSubmitted ? 'border-emerald-300 bg-emerald-50/40' : 'border-blue-200'} space-y-0.5 shadow-2xs">
                          <div class="flex items-center justify-between gap-1">
                            <span class="text-xs font-bold text-slate-800 truncate">${staff.fullName}</span>
                            <span class="text-[9px] font-bold px-1.5 py-0.5 rounded ${hasSubmitted ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'} shrink-0">
                              ${hasSubmitted ? '✓ Submitted' : '⏳ Pending'}
                            </span>
                          </div>
                          ${hasSubmitted && proof.submittedAt ? `
                            <span class="text-[9px] text-emerald-700 block">${(proof.photos || []).length} photo(s) submitted</span>
                          ` : ''}
                        </div>
                      `;
                    }).join('')}
                  </div>
                </td>
                <td class="p-2.5 align-top bg-amber-50/40 border-r border-slate-200">
                  <!-- Office Staff directly under Office Qty -->
                  <div class="space-y-1.5">
                    <div class="flex items-center justify-between pb-1 border-b border-amber-200/60">
                      <span class="text-[10px] font-bold text-amber-700 uppercase tracking-wider flex items-center gap-1">
                        <span>🏢 Office Staff</span>
                      </span>
                      <span class="text-[10px] font-extrabold text-amber-800">${totalOffCargo} PCS</span>
                    </div>
                    ${assignedOfficeStaff.length === 0 ? `
                      <span class="text-[10px] text-slate-400 italic block py-1 text-center">No Office staff assigned</span>
                    ` : assignedOfficeStaff.map(staff => {
                      const proof = staffProofs.find(p => p.staffId === staff.id);
                      const hasSubmitted = !!proof;
                      return `
                        <div class="p-1.5 bg-white rounded-lg border ${hasSubmitted ? 'border-emerald-300 bg-emerald-50/40' : 'border-amber-200'} space-y-0.5 shadow-2xs">
                          <div class="flex items-center justify-between gap-1">
                            <span class="text-xs font-bold text-slate-800 truncate">${staff.fullName}</span>
                            <span class="text-[9px] font-bold px-1.5 py-0.5 rounded ${hasSubmitted ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'} shrink-0">
                              ${hasSubmitted ? '✓ Submitted' : '⏳ Pending'}
                            </span>
                          </div>
                          ${hasSubmitted && proof.submittedAt ? `
                            <span class="text-[9px] text-emerald-700 block">${(proof.photos || []).length} photo(s) submitted</span>
                          ` : ''}
                        </div>
                      `;
                    }).join('')}
                  </div>
                </td>
                <td class="p-3 align-top text-right bg-slate-50/40">
                  <div class="space-y-1">
                    <span class="text-[10px] text-slate-400 block uppercase font-bold tracking-wider">Total Cargo</span>
                    <span class="text-base font-extrabold text-slate-900">${totalCargo} PCS</span>
                  </div>
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </section>

      <!-- SECTION 4: Staff Mobile Submissions & Proof Photos -->
      <section class="bg-white p-5 rounded-xl border border-slate-200/80 shadow-xs space-y-4">
        <div class="flex items-center justify-between border-b border-slate-100 pb-3">
          <h3 class="text-xs font-bold uppercase tracking-wider text-slate-500 flex items-center space-x-2">
            <svg class="w-3.5 h-3.5 text-[#138FCB]" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
              <path d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" stroke-linecap="round" stroke-linejoin="round"></path>
              <path d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" stroke-linecap="round" stroke-linejoin="round"></path>
            </svg>
            <span>Mobile Staff Physical Proof Submissions</span>
          </h3>
          <span id="proof-count-badge" class="text-[11px] font-bold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-100">
            ${staffProofs.length} proof record(s)
          </span>
        </div>

        <div id="staff-proofs-live-container">
          ${renderStaffProofsSection(staffProofs, userMap)}
        </div>
      </section>
    </div>
  `;

  const footerHtml = `
    <div class="flex items-center space-x-2 text-xs text-slate-400">
      <svg class="w-4 h-4 text-emerald-500" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
        <path d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" stroke-linecap="round" stroke-linejoin="round"></path>
      </svg>
      <span>SSL 256-bit encrypted ERP transaction</span>
    </div>
    <div class="flex flex-col sm:flex-row items-center justify-between w-full sm:w-auto gap-3">
      <div>
        ${isDraftOrEditable ? `
          <button id="gp-void-btn" type="button" class="inline-flex items-center space-x-1.5 px-3.5 py-2 text-xs font-semibold text-rose-600 hover:text-rose-700 bg-rose-50 hover:bg-rose-100 rounded-lg transition-colors border border-rose-200 cursor-pointer">
            <svg class="w-3.5 h-3.5 text-rose-500" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path>
            </svg>
            <span>Archive / Void Gatepass</span>
          </button>
        ` : gatepass.status === 'Voided' ? `
          <span class="text-xs font-bold text-rose-600 bg-rose-50 border border-rose-200 px-3 py-1.5 rounded-lg inline-flex items-center gap-1.5">
            <svg class="w-3.5 h-3.5 text-rose-500" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636"></path>
            </svg>
            <span>Gatepass Voided &amp; Archived</span>
          </span>
        ` : ''}
      </div>
      <div class="flex items-center space-x-3">
        <button id="gp-detail-close-btn" type="button" class="px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 rounded-lg transition-colors border border-slate-300 cursor-pointer">
          Close
        </button>
        ${!isApproved && gatepass.status !== 'Voided' ? `
          <button id="gp-approve-btn" type="button" class="inline-flex items-center space-x-2 px-5 py-2 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg shadow-sm hover:shadow transition-all active:scale-[0.98] cursor-pointer">
            <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
              <path d="M5 13l4 4L19 7" stroke-linecap="round" stroke-linejoin="round"></path>
            </svg>
            <span>Approve Gatepass &amp; Release Stock</span>
          </button>
        ` : ''}
      </div>
    </div>
  `;

  openModal({
    title: `Gatepass Outward Document`,
    subtitle: 'Review cargo breakdown, staff photo submissions, and authorize delivery dispatch',
    badge: gatepass.gatepassNumber,
    headerActionsHtml,
    contentHtml,
    footerHtml,
    size: 'max-w-5xl',
    onOpen: (modalEl) => {
      const closeBtn = modalEl.querySelector('#gp-detail-close-btn');
      if (closeBtn) closeBtn.onclick = () => closeModal();

      // Edit Gatepass handlers (header and card)
      const handleEdit = () => {
        closeModal();
        openCreateGatepassModal(onSaved, gatepass);
      };
      const headerEditBtn = modalEl.querySelector('#gp-header-edit-btn');
      if (headerEditBtn) headerEditBtn.onclick = handleEdit;
      const cardEditBtn = modalEl.querySelector('#gp-card-edit-btn');
      if (cardEditBtn) cardEditBtn.onclick = handleEdit;

      // Void / Archive Gatepass handler
      const voidBtn = modalEl.querySelector('#gp-void-btn');
      if (voidBtn) {
        voidBtn.onclick = () => {
          const confirmed = window.confirm(`Are you sure you want to void / archive Gatepass ${gatepass.gatepassNumber}? This action will cancel this gatepass.`);
          if (!confirmed) return;
          gatepassService.voidGatepass(gatepass.id, authService.getCurrentUser()?.id);
          toast.show(`Gatepass ${gatepass.gatepassNumber} has been voided and archived.`, 'warning');
          closeModal();
          if (onSaved) onSaved();
        };
      }

      // Photo thumbnail lightbox
      const bindThumbnails = (container) => {
        container.querySelectorAll('.photo-thumbnail').forEach(thumb => {
          thumb.onclick = () => {
            const imgSrc = thumb.getAttribute('data-img');
            openPhotoLightbox(imgSrc);
          };
        });
      };
      bindThumbnails(modalEl);

      // Real-time listener: if staff submits photos on mobile while this modal is open, update photos live!
      const unsubscribe = storageService.subscribe('gatepasses', () => {
        const liveContainer = modalEl.querySelector('#staff-proofs-live-container');
        if (!liveContainer) {
          unsubscribe();
          return;
        }
        const freshGp = gatepassService.getGatepassById(gatepass.id);
        if (freshGp) {
          liveContainer.innerHTML = renderStaffProofsSection(freshGp.staffProofs || [], userMap);
          bindThumbnails(liveContainer);
          const countBadge = modalEl.querySelector('#proof-count-badge');
          if (countBadge) {
            countBadge.textContent = `${(freshGp.staffProofs || []).length} proof record(s)`;
          }
        }
      });

      // Approve Gatepass
      const approveBtn = modalEl.querySelector('#gp-approve-btn');
      if (approveBtn) {
        approveBtn.onclick = () => {
          gatepassService.approveGatepass(gatepass.id, authService.getCurrentUser().id);
          toast.show(`Gatepass ${gatepass.gatepassNumber} approved! Outward stock deducted from Warehouse & Office.`, 'success');
          closeModal();
          if (onSaved) onSaved();
        };
      }
    }
  });
}

function renderStaffProofsSection(staffProofs = [], userMap = new Map()) {
  if (staffProofs.length === 0) {
    return `
      <div class="p-6 text-center bg-slate-50 border border-dashed border-slate-200 rounded-xl space-y-2">
        <span class="text-3xl block">⏳</span>
        <h4 class="font-bold text-slate-700 text-xs">Awaiting Mobile Staff Proof Photos</h4>
        <p class="text-[11px] text-slate-400 max-w-sm mx-auto">
          Staff members open the mobile app on their phone, live-capture equipment photos, and submit verification.
        </p>
        <a href="mobile.html" target="_blank" class="inline-block mt-2 px-3.5 py-2 text-xs font-bold bg-[#138FCB] text-white rounded-lg hover:bg-[#0E78AC] transition-colors shadow-xs">
          📱 Launch Mobile Staff App to Test
        </a>
      </div>
    `;
  }

  return `
    <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
      ${staffProofs.map(proof => {
        const staff = userMap.get(proof.staffId) || { fullName: proof.staffName, staffType: proof.staffType };
        const isOffice = staff.staffType === 'office_staff';
        return `
          <div class="p-4 bg-slate-50/70 border border-slate-200 rounded-xl space-y-3">
            <div class="flex items-center justify-between">
              <div class="flex items-center gap-2">
                <span class="px-2 py-0.5 rounded text-[10px] font-bold ${isOffice ? 'bg-amber-100 text-amber-800' : 'bg-blue-100 text-[#138FCB]'}">
                  ${isOffice ? '🏢 Office Staff' : '📦 Warehouse Staff'}
                </span>
                <strong class="text-xs text-slate-800">${staff.fullName}</strong>
              </div>
              <span class="text-[10px] text-slate-400">
                ${proof.submittedAt ? new Date(proof.submittedAt).toLocaleTimeString() : 'Verified'}
              </span>
            </div>

            <!-- Photos Grid -->
            <div class="grid grid-cols-3 gap-2">
              ${(proof.photos || []).map(ph => `
                <div class="relative group rounded-lg overflow-hidden border border-slate-200 aspect-square bg-slate-200 cursor-pointer photo-thumbnail hover:opacity-90 transition-opacity" data-img="${ph.dataUrl}">
                  <img src="${ph.dataUrl}" alt="Proof" class="w-full h-full object-cover">
                  <div class="absolute bottom-0 inset-x-0 bg-black/60 text-white text-[9px] font-bold px-1 py-0.5 text-center truncate">
                    ${ph.sizeKb ? `${ph.sizeKb} KB` : 'Compressed'}
                  </div>
                </div>
              `).join('')}
            </div>
          </div>
        `;
      }).join('')}
    </div>
  `;
}

function openPhotoLightbox(dataUrl) {
  const lightboxHtml = `
    <div class="space-y-3 text-center">
      <div class="max-h-[70vh] overflow-hidden rounded-xl bg-black flex items-center justify-center">
        <img src="${dataUrl}" class="max-h-[70vh] max-w-full object-contain">
      </div>
      <div class="flex justify-end">
        <button id="close-lightbox-btn" class="px-4 py-2 text-xs font-semibold bg-slate-100 hover:bg-slate-200 rounded-xl cursor-pointer">
          Close Preview
        </button>
      </div>
    </div>
  `;

  openModal({
    title: 'Equipment Verification Photo Proof',
    contentHtml: lightboxHtml,
    size: 'max-w-3xl',
    onOpen: (el) => {
      el.querySelector('#close-lightbox-btn').onclick = () => closeModal();
    }
  });
}
