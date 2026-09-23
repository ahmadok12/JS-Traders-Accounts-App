/**
 * JS Traders ERP - Customers & Farm Hierarchy View
 * Customer Owner -> Farm / Branch -> Deal / Ledger Account.
 * Demonstrates shared Party architecture (Customer + Supplier in one entity).
 */

import { salesService } from '../../services/salesService.js';
import { renderTable, bindTableActions } from '../../components/table.js';
import { renderFilterBar } from '../../components/filters.js';
import { openModal, closeModal } from '../../components/modal.js';
import { toast } from '../../components/toast.js';

export function renderCustomersView() {
  const parties = salesService.getParties(true); // Customer parties

  const filterBarHtml = renderFilterBar({
    searchPlaceholder: 'Search customer name, city, phone...',
    primaryAction: { label: 'New Customer' }
  });

  const columns = [
    {
      key: 'code',
      label: 'Customer ID',
      render: row => `<span class="font-bold text-[#138FCB]">${row.code}</span>`
    },
    {
      key: 'name',
      label: 'Customer / Business Group',
      render: row => `
        <div>
          <div class="font-bold text-slate-900">${row.name}</div>
          <div class="text-[10px] text-slate-500">${row.businessName || ''}</div>
        </div>
      `
    },
    {
      key: 'roles',
      label: 'Partner Roles',
      render: row => `
        <div class="flex items-center gap-1">
          <span class="px-2 py-0.5 rounded text-[10px] font-bold bg-blue-50 text-[#138FCB]">Customer</span>
          ${row.isSupplier ? '<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-purple-50 text-purple-700">Supplier (Shared Party)</span>' : ''}
        </div>
      `
    },
    {
      key: 'contact',
      label: 'Contact & City',
      render: row => `
        <div>
          <div class="font-medium text-slate-700">${row.contactPerson || '-'} (${row.city || 'Pakistan'})</div>
          <div class="text-[10px] text-slate-400">${row.phone || ''}</div>
        </div>
      `
    },
    {
      key: 'paymentTerms',
      label: 'Terms',
      render: row => `<span class="text-slate-600 font-medium">${row.paymentTerms || 'Cash'}</span>`
    },
    {
      key: 'status',
      label: 'Status',
      render: row => `<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700">Active</span>`
    }
  ];

  const actions = [
    { label: 'Farms & Deals', variant: 'primary', onClick: (row) => openFarmsDealsModal(row) }
  ];

  const tableHtml = renderTable({
    columns,
    data: parties,
    actions,
    emptyMessage: 'No customers registered.'
  });

  return `
    <div id="customers-view-container" class="space-y-5 animate-in fade-in duration-150">
      ${filterBarHtml}
      <div id="customers-table-container">
        ${tableHtml}
      </div>
    </div>
  `;
}

export function bindCustomersEvents(container, refreshCallback) {
  const addBtn = container.querySelector('#filter-primary-btn');
  if (addBtn) {
    addBtn.onclick = () => openCreateCustomerModal(refreshCallback);
  }

  const parties = salesService.getParties(true);
  const actions = [
    { label: 'Farms & Deals', onClick: (row) => openFarmsDealsModal(row) }
  ];
  bindTableActions(container, actions, parties);
}

function openFarmsDealsModal(customer) {
  const farms = salesService.getFarmsByCustomer(customer.id);

  const contentHtml = `
    <div class="space-y-5 text-xs">
      <div class="p-3.5 bg-slate-50 rounded-xl border border-slate-200">
        <span class="text-[10px] font-bold uppercase tracking-wider text-slate-400">Owner Entity</span>
        <h3 class="text-base font-bold text-slate-900 mt-0.5">${customer.name}</h3>
        <p class="text-slate-500">${customer.address || 'Lahore, Pakistan'} | NTN: ${customer.taxNumber || 'N/A'}</p>
      </div>

      <div>
        <div class="flex items-center justify-between mb-3">
          <h4 class="font-bold text-slate-800 uppercase tracking-wider text-[11px]">Associated Poultry Farms & Branches</h4>
          <span class="text-xs text-slate-400">${farms.length} Registered Farms</span>
        </div>

        <div class="space-y-3">
          ${farms.map(farm => {
            const deals = salesService.getDealsByFarm(farm.id);
            return `
              <div class="p-3.5 bg-white rounded-xl border border-slate-200 space-y-2.5">
                <div class="flex justify-between items-start">
                  <div>
                    <span class="text-[10px] font-bold text-[#138FCB] uppercase tracking-wider">${farm.code}</span>
                    <h4 class="text-sm font-bold text-slate-800">${farm.name}</h4>
                    <p class="text-slate-500 text-[11px]">${farm.location || 'Bypass Road'} • Capacity: <strong>${Number(farm.capacity || 0).toLocaleString()} birds</strong></p>
                  </div>
                  <span class="px-2 py-0.5 rounded bg-slate-100 text-slate-700 text-[10px] font-semibold">${deals.length} Active Deals</span>
                </div>

                <!-- Deals Sub-list -->
                <div class="pl-3 border-l-2 border-slate-200 space-y-1.5 mt-2">
                  ${deals.map(deal => `
                    <div class="flex justify-between items-center text-[11px] p-2 bg-slate-50 rounded">
                      <div>
                        <span class="font-bold text-slate-800">${deal.code}:</span>
                        <span class="text-slate-600">${deal.name}</span>
                      </div>
                      <span class="font-bold text-[#138FCB]">Rs. ${Number(deal.budget || 0).toLocaleString()}</span>
                    </div>
                  `).join('')}
                </div>
              </div>
            `;
          }).join('')}
        </div>
      </div>

      <div class="flex justify-end pt-4 border-t border-slate-100">
        <button id="cust-modal-close-btn" class="px-4 py-2 text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-xl font-semibold transition-colors cursor-pointer">Close</button>
      </div>
    </div>
  `;

  openModal({
    title: `Customer Hierarchy: ${customer.name}`,
    subtitle: 'Owner -> Farm/Branch -> Deal structure',
    contentHtml,
    size: 'max-w-2xl',
    onOpen: (modalEl) => {
      modalEl.querySelector('#cust-modal-close-btn').onclick = () => closeModal();
    }
  });
}

function openCreateCustomerModal(onSaved) {
  const contentHtml = `
    <form id="create-customer-form" class="space-y-4 text-xs">
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label class="block font-bold text-slate-700 mb-1">Customer / Group Name *</label>
          <input type="text" id="cust-name" required placeholder="e.g. Al-Madina Poultry Farms" class="w-full border border-slate-200 rounded-xl px-3 py-2 text-slate-800 focus:outline-none focus:border-[#138FCB]">
        </div>

        <div>
          <label class="block font-bold text-slate-700 mb-1">Business Registration Name</label>
          <input type="text" id="cust-biz-name" placeholder="e.g. Al-Madina Farms Pvt Ltd" class="w-full border border-slate-200 rounded-xl px-3 py-2 text-slate-800 focus:outline-none focus:border-[#138FCB]">
        </div>
      </div>

      <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div>
          <label class="block font-bold text-slate-700 mb-1">Contact Person</label>
          <input type="text" id="cust-contact" placeholder="e.g. Chaudhry Tariq" class="w-full border border-slate-200 rounded-xl px-3 py-2 text-slate-800">
        </div>
        <div>
          <label class="block font-bold text-slate-700 mb-1">Phone Number *</label>
          <input type="text" id="cust-phone" required placeholder="e.g. +92 300 9876543" class="w-full border border-slate-200 rounded-xl px-3 py-2 text-slate-800">
        </div>
        <div>
          <label class="block font-bold text-slate-700 mb-1">City / Region</label>
          <input type="text" id="cust-city" placeholder="e.g. Faisalabad" class="w-full border border-slate-200 rounded-xl px-3 py-2 text-slate-800">
        </div>
      </div>

      <div class="p-3 bg-slate-50 border border-slate-200 rounded-xl space-y-2">
        <span class="font-bold text-slate-700 block">Shared Party Roles</span>
        <div class="flex items-center gap-4">
          <label class="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" id="cust-is-customer" checked disabled class="rounded border-slate-300 text-[#138FCB]">
            <span>Customer Role</span>
          </label>
          <label class="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" id="cust-is-supplier" class="rounded border-slate-300 text-[#138FCB]">
            <span>Also a Supplier (Shared Party Architecture)</span>
          </label>
        </div>
      </div>

      <div class="flex justify-end gap-3 pt-4 border-t border-slate-100">
        <button type="button" id="cust-cancel-btn" class="px-4 py-2 text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-xl font-semibold transition-colors cursor-pointer">Cancel</button>
        <button type="submit" class="px-4 py-2 bg-[#138FCB] hover:bg-[#0E78AC] text-white rounded-xl font-semibold shadow-xs transition-colors cursor-pointer">Create Customer</button>
      </div>
    </form>
  `;

  openModal({
    title: 'Register New Customer Entity',
    subtitle: 'Creates parent party record for farms and deals',
    contentHtml,
    size: 'max-w-xl',
    onOpen: (modalEl) => {
      modalEl.querySelector('#cust-cancel-btn').onclick = () => closeModal();
      modalEl.querySelector('#create-customer-form').onsubmit = (e) => {
        e.preventDefault();
        const name = modalEl.querySelector('#cust-name').value.trim();
        const businessName = modalEl.querySelector('#cust-biz-name').value.trim();
        const contactPerson = modalEl.querySelector('#cust-contact').value.trim();
        const phone = modalEl.querySelector('#cust-phone').value.trim();
        const city = modalEl.querySelector('#cust-city').value.trim();
        const isSupplier = modalEl.querySelector('#cust-is-supplier').checked;

        salesService.createParty({
          name,
          businessName,
          contactPerson,
          phone,
          city,
          isCustomer: true,
          isSupplier,
          currency: 'PKR',
          paymentTerms: '30 Days Net'
        });

        toast.show('Customer registered successfully.', 'success');
        closeModal();
        if (onSaved) onSaved();
      };
    }
  });
}
