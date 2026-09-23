/**
 * JS Traders ERP - Suppliers View
 */

import { salesService } from '../../services/salesService.js';
import { renderTable, bindTableActions } from '../../components/table.js';
import { renderFilterBar } from '../../components/filters.js';
import { openModal, closeModal } from '../../components/modal.js';
import { toast } from '../../components/toast.js';

export function renderSuppliersView() {
  const suppliers = salesService.getParties(false, true);

  const filterBarHtml = renderFilterBar({
    searchPlaceholder: 'Search suppliers by name or country...',
    primaryAction: { label: 'New Supplier' }
  });

  const columns = [
    {
      key: 'code',
      label: 'Supplier ID',
      render: row => `<span class="font-bold text-[#138FCB]">${row.code}</span>`
    },
    {
      key: 'name',
      label: 'Supplier Name',
      render: row => `
        <div>
          <div class="font-bold text-slate-800">${row.name}</div>
          <div class="text-[10px] text-slate-400">${row.businessName || ''}</div>
        </div>
      `
    },
    {
      key: 'country',
      label: 'Origin Country',
      render: row => `
        <span class="px-2 py-0.5 rounded text-[10px] font-bold ${row.country === 'China' ? 'bg-red-50 text-red-700' : 'bg-slate-100 text-slate-700'}">
          ${row.country || 'Pakistan'}
        </span>
      `
    },
    {
      key: 'currency',
      label: 'Trade Currency',
      render: row => `<span class="font-semibold text-slate-700">${row.currency || 'USD'}</span>`
    },
    {
      key: 'paymentTerms',
      label: 'Purchase Terms',
      render: row => `<span class="text-slate-600 font-medium">${row.paymentTerms || 'FOB Ningbo'}</span>`
    },
    {
      key: 'contact',
      label: 'Contact Info',
      render: row => `
        <div class="text-xs">
          <div class="font-medium text-slate-700">${row.contactPerson || '-'}</div>
          <div class="text-[10px] text-slate-400">${row.email || row.phone || ''}</div>
        </div>
      `
    }
  ];

  const tableHtml = renderTable({
    columns,
    data: suppliers,
    emptyMessage: 'No suppliers registered.'
  });

  return `
    <div id="suppliers-view-container" class="space-y-5 animate-in fade-in duration-150">
      ${filterBarHtml}
      <div id="suppliers-table-container">
        ${tableHtml}
      </div>
    </div>
  `;
}

export function bindSuppliersEvents(container, refreshCallback) {
  const addBtn = container.querySelector('#filter-primary-btn');
  if (addBtn) {
    addBtn.onclick = () => {
      toast.show('New Supplier registration modal is active in Customers & Parties.', 'info');
    };
  }
}
