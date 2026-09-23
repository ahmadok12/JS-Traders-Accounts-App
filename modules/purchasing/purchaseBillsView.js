/**
 * JS Traders ERP - Purchase Bills View
 * Vendor invoices with Pending action status.
 */

import { purchasingService } from '../../services/purchasingService.js';
import { salesService } from '../../services/salesService.js';
import { renderTable } from '../../components/table.js';
import { renderFilterBar } from '../../components/filters.js';

export function renderPurchaseBillsView() {
  const bills = purchasingService.getPurchaseBills();
  const suppliers = salesService.getParties(false, true);
  const suppMap = new Map(suppliers.map(s => [s.id, s.name]));

  const filterBarHtml = renderFilterBar({
    searchPlaceholder: 'Search purchase bills...',
    primaryAction: { label: 'New Purchase Bill' }
  });

  const columns = [
    {
      key: 'billNumber',
      label: 'Bill #',
      render: row => `<span class="font-bold text-[#138FCB]">${row.billNumber}</span>`
    },
    {
      key: 'date',
      label: 'Bill Date',
      render: row => `<span class="text-slate-600 font-medium">${row.date}</span>`
    },
    {
      key: 'supplierPartyId',
      label: 'Supplier',
      render: row => `<span class="font-bold text-slate-800">${suppMap.get(row.supplierPartyId) || 'Supplier'}</span>`
    },
    {
      key: 'currency',
      label: 'Currency',
      render: row => `<span class="px-2 py-0.5 rounded bg-slate-100 font-bold text-slate-700 text-[10px]">${row.currency || 'USD'}</span>`
    },
    {
      key: 'total',
      label: 'Bill Total',
      align: 'right',
      render: row => `<span class="font-extrabold text-slate-900">${row.currency === 'USD' ? '$' : 'Rs.'} ${Number(row.total || 0).toLocaleString()}</span>`
    },
    {
      key: 'status',
      label: 'Status',
      render: row => `
        <span class="px-2.5 py-0.5 rounded-full text-[10px] font-bold ${
          row.status === 'Pending' ? 'bg-amber-50 text-amber-700' : 'bg-emerald-50 text-emerald-700'
        }">
          ${row.status === 'Pending' ? '● Pending Review' : row.status}
        </span>
      `
    }
  ];

  const tableHtml = renderTable({
    columns,
    data: bills,
    emptyMessage: 'No purchase bills recorded.'
  });

  return `
    <div id="pb-view-container" class="space-y-5 animate-in fade-in duration-150">
      ${filterBarHtml}
      <div id="pb-table-container">
        ${tableHtml}
      </div>
    </div>
  `;
}

export function bindPurchaseBillsEvents(container, refreshCallback) {
  // Bind events if needed
}
