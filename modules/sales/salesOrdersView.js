/**
 * JS Traders ERP - Sales Orders View
 * Handles Order Booking, dynamic line items, and fulfillment tracking.
 */

import { salesService } from '../../services/salesService.js';
import { productService } from '../../services/productService.js';
import { storageService } from '../../services/storageService.js';
import { renderTable, bindTableActions } from '../../components/table.js';
import { renderFilterBar } from '../../components/filters.js';
import { openModal, closeModal } from '../../components/modal.js';
import { confirmAction } from '../../components/confirmation.js';
import { toast } from '../../components/toast.js';

export function renderSalesOrdersView() {
  const orders = salesService.getSalesOrders();
  const parties = salesService.getParties(true);
  const partyMap = new Map(parties.map(p => [p.id, p.name]));

  const filterBarHtml = renderFilterBar({
    searchPlaceholder: 'Search orders by SO number, customer name...',
    primaryAction: { label: '+ Create Sales Order' }
  });

  const columns = [
    {
      key: 'orderNumber',
      label: 'Order #',
      render: row => `<span class="font-bold text-[#138FCB] font-mono">${row.orderNumber}</span>`
    },
    {
      key: 'customerPartyId',
      label: 'Customer / Farm',
      render: row => `
        <div>
          <div class="font-bold text-slate-800">${partyMap.get(row.customerPartyId) || 'Customer'}</div>
          <div class="text-[10px] text-slate-400 font-mono">Date: ${row.date || 'Today'}</div>
        </div>
      `
    },
    {
      key: 'total',
      label: 'Contract Total',
      render: row => `<span class="font-extrabold text-slate-900 font-mono">Rs. ${Number(row.total || 0).toLocaleString()}</span>`
    },
    {
      key: 'linesCount',
      label: 'Lines',
      render: row => `<span class="px-2 py-0.5 rounded-lg bg-slate-100 text-slate-700 text-[10px] font-semibold">${(row.lines || []).length} Items</span>`
    },
    {
      key: 'status',
      label: 'Status',
      render: row => `
        <span class="px-2.5 py-0.5 rounded-full text-[10px] font-bold ${
          row.status === 'Delivered' ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' :
          row.status === 'Cancelled' ? 'bg-rose-50 text-rose-700 border border-rose-200' :
          row.status === 'Partially Delivered' ? 'bg-blue-50 text-[#138FCB] border border-blue-200' :
          'bg-amber-50 text-amber-700 border border-amber-200'
        }">
          ${row.status}
        </span>
      `
    }
  ];

  const actions = [
    { label: 'View', variant: 'secondary' }
  ];

  const tableHtml = renderTable({
    columns,
    data: orders,
    actions,
    emptyMessage: 'No sales orders created yet.'
  });

  return `
    <div id="so-view-container" class="space-y-5 animate-in fade-in duration-150">
      ${filterBarHtml}
      <div id="so-table-container">
        ${tableHtml}
      </div>
    </div>
  `;
}

export function bindSalesOrdersEvents(container, refreshCallback) {
  const addBtn = container.querySelector('#filter-primary-btn');
  if (addBtn) {
    addBtn.onclick = () => openCreateOrderModal(refreshCallback);
  }

  const orders = salesService.getSalesOrders();
  const actions = [
    { label: 'View', variant: 'secondary', onClick: (row) => openOrderDetailModal(row, refreshCallback) }
  ];
  bindTableActions(container, actions, orders);

  const searchInput = container.querySelector('#filter-search-input');
  if (searchInput) {
    searchInput.oninput = (e) => {
      const q = e.target.value.toLowerCase().trim();
      const parties = salesService.getParties(true);
      const partyMap = new Map(parties.map(p => [p.id, p.name]));
      const filtered = orders.filter(o =>
        o.orderNumber.toLowerCase().includes(q) ||
        (partyMap.get(o.customerPartyId) && partyMap.get(o.customerPartyId).toLowerCase().includes(q))
      );
      updateOrdersTable(container, filtered, refreshCallback);
    };
  }
}

function updateOrdersTable(container, filteredData, refreshCallback) {
  const tableContainer = container.querySelector('#so-table-container');
  if (!tableContainer) return;

  const parties = salesService.getParties(true);
  const partyMap = new Map(parties.map(p => [p.id, p.name]));

  const columns = [
    { key: 'orderNumber', label: 'Order #', render: row => `<span class="font-bold text-[#138FCB] font-mono">${row.orderNumber}</span>` },
    {
      key: 'customerPartyId',
      label: 'Customer / Farm',
      render: row => `<div><div class="font-bold text-slate-800">${partyMap.get(row.customerPartyId) || 'Customer'}</div><div class="text-[10px] text-slate-400 font-mono">Date: ${row.date || 'Today'}</div></div>`
    },
    { key: 'total', label: 'Contract Total', render: row => `<span class="font-extrabold text-slate-900 font-mono">Rs. ${Number(row.total || 0).toLocaleString()}</span>` },
    { key: 'linesCount', label: 'Lines', render: row => `<span class="px-2 py-0.5 rounded-lg bg-slate-100 text-slate-700 text-[10px] font-semibold">${(row.lines || []).length} Items</span>` },
    {
      key: 'status',
      label: 'Status',
      render: row => `<span class="px-2.5 py-0.5 rounded-full text-[10px] font-bold ${row.status === 'Delivered' ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : row.status === 'Cancelled' ? 'bg-rose-50 text-rose-700 border border-rose-200' : row.status === 'Partially Delivered' ? 'bg-blue-50 text-[#138FCB] border border-blue-200' : 'bg-amber-50 text-amber-700 border border-amber-200'}">${row.status}</span>`
    }
  ];

  const actions = [
    { label: 'View', variant: 'secondary', onClick: (row) => openOrderDetailModal(row, refreshCallback) }
  ];

  tableContainer.innerHTML = renderTable({ columns, data: filteredData, actions });
  bindTableActions(tableContainer, actions, filteredData);
}

export function openOrderDetailModal(order, refreshCallback) {
  const parties = salesService.getParties(true);
  const party = parties.find(p => p.id === order.customerPartyId);
  const variants = productService.getVariants();
  const varMap = new Map(variants.map(v => [v.id, v.name]));
  const isCancelled = order.status === 'Cancelled';

  const contentHtml = `
    <div class="space-y-6 text-xs">
      <!-- SECTION 1: Order Header Overview -->
      <section class="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-xs space-y-4">
        <div class="flex items-center justify-between border-b border-slate-100 pb-3">
          <h3 class="text-xs font-bold uppercase tracking-wider text-slate-700 flex items-center gap-2">
            <span>📋</span>
            <span>1. Contract Details</span>
          </h3>
          <span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-bold ${
            order.status === 'Delivered' ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' :
            isCancelled ? 'bg-rose-50 text-rose-700 border border-rose-200' :
            'bg-amber-50 text-amber-700 border border-amber-200'
          }">
            ${order.status}
          </span>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div class="p-3 bg-slate-50/70 rounded-xl border border-slate-200/70 space-y-1">
            <span class="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Customer Party</span>
            <p class="text-sm font-bold text-slate-900">${party ? party.name : 'Customer'}</p>
            <p class="text-[11px] text-slate-500">Farm: ${order.farmId || 'Main Farm'}</p>
          </div>

          <div class="p-3 bg-slate-50/70 rounded-xl border border-slate-200/70 space-y-1">
            <span class="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Contract Date</span>
            <p class="text-sm font-bold text-slate-800">${order.date || 'Today'}</p>
            <p class="text-[11px] text-slate-500">Order Number: ${order.orderNumber}</p>
          </div>

          <div class="p-3 bg-blue-50/50 rounded-xl border border-blue-200/70 space-y-1 text-right">
            <span class="text-[10px] font-bold text-[#138FCB] uppercase tracking-wider block">Total Contract Value</span>
            <p class="text-xl font-black text-slate-900">Rs. ${Number(order.total || 0).toLocaleString()}</p>
            <p class="text-[10px] text-slate-500">Subtotal: Rs. ${Number(order.subtotal || order.total || 0).toLocaleString()}</p>
          </div>
        </div>
      </section>

      <!-- SECTION 2: Order Line Items with Fulfillment Tracker -->
      <section class="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-xs space-y-4">
        <div class="flex items-center justify-between border-b border-slate-100 pb-3">
          <h3 class="text-xs font-bold uppercase tracking-wider text-slate-700 flex items-center gap-2">
            <span>📦</span>
            <span>2. Order Line Items &amp; Fulfillment Tracker</span>
          </h3>
          <span class="text-[10px] text-slate-400 font-semibold">${(order.lines || []).length} Product(s)</span>
        </div>

        <div class="border border-slate-200/80 rounded-xl overflow-hidden">
          <table class="w-full text-left text-xs">
            <thead class="bg-slate-50 text-[10px] uppercase font-bold text-slate-500 border-b border-slate-200">
              <tr>
                <th class="py-2.5 px-3">Item / Description</th>
                <th class="py-2.5 px-3 text-right">Ordered Qty</th>
                <th class="py-2.5 px-3 text-right">Delivered Qty</th>
                <th class="py-2.5 px-3 text-right">Remaining Qty</th>
                <th class="py-2.5 px-3 text-right">Unit Price</th>
                <th class="py-2.5 px-3 text-right">Line Total</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-slate-100">
              ${(order.lines || []).map(l => {
                const remaining = (Number(l.orderedQty) || 0) - (Number(l.deliveredQty) || 0);
                return `
                  <tr class="hover:bg-slate-50/70">
                    <td class="py-3 px-3 font-semibold text-slate-800">${varMap.get(l.variantId) || 'Item'}</td>
                    <td class="py-3 px-3 text-right font-bold">${l.orderedQty}</td>
                    <td class="py-3 px-3 text-right text-emerald-600 font-bold">${l.deliveredQty}</td>
                    <td class="py-3 px-3 text-right text-blue-600 font-bold">${remaining}</td>
                    <td class="py-3 px-3 text-right font-mono">Rs. ${Number(l.unitPrice).toLocaleString()}</td>
                    <td class="py-3 px-3 text-right font-extrabold text-slate-900 font-mono">Rs. ${Number(l.lineTotal).toLocaleString()}</td>
                  </tr>
                `;
              }).join('')}
            </tbody>
          </table>
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
          <button id="order-void-btn" type="button" class="inline-flex items-center space-x-1.5 px-3.5 py-2 text-xs font-bold text-rose-600 hover:text-rose-700 bg-rose-50 hover:bg-rose-100 border border-rose-200 rounded-xl transition-colors cursor-pointer">
            <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path>
            </svg>
            <span>Void / Cancel Sales Order</span>
          </button>
        ` : `
          <span class="text-xs font-bold text-rose-600 bg-rose-50 border border-rose-200 px-3 py-1.5 rounded-xl inline-flex items-center gap-1.5">
            Order Cancelled
          </span>
        `}
      </div>
      <div class="flex items-center space-x-3">
        <button id="order-close-btn" type="button" class="px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100 rounded-xl transition-colors border border-slate-200 cursor-pointer">
          Close
        </button>
        ${!isCancelled ? `
          <button id="order-edit-btn" type="button" class="inline-flex items-center space-x-1.5 px-4 py-2 text-xs font-bold text-slate-700 bg-white hover:bg-slate-50 border border-slate-200 rounded-xl transition-all cursor-pointer shadow-2xs">
            <svg class="w-3.5 h-3.5 text-[#138FCB]" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"></path>
            </svg>
            <span>Edit Order</span>
          </button>
        ` : ''}
      </div>
    </div>
  `;

  openModal({
    title: `Sales Order: ${order.orderNumber}`,
    subtitle: 'Contract specification, customer destination, and fulfillment status',
    badge: order.orderNumber,
    contentHtml,
    footerHtml,
    size: 'max-w-4xl',
    onOpen: (modalEl) => {
      const closeBtn = modalEl.querySelector('#order-close-btn');
      if (closeBtn) closeBtn.onclick = () => closeModal();

      const voidBtn = modalEl.querySelector('#order-void-btn');
      if (voidBtn) {
        voidBtn.onclick = () => {
          confirmAction({
            title: `Void / Cancel Order: ${order.orderNumber}`,
            message: 'Are you sure you want to cancel this sales order? Undelivered quantities will no longer be available for dispatch.',
            confirmLabel: 'Yes, Cancel Order',
            isDestructive: true,
            onConfirm: () => {
              storageService.update('salesOrders', order.id, { status: 'Cancelled' });
              toast.show(`Sales Order ${order.orderNumber} cancelled.`, 'success');
              closeModal();
              if (refreshCallback) refreshCallback();
            }
          });
        };
      }

      const editBtn = modalEl.querySelector('#order-edit-btn');
      if (editBtn) {
        editBtn.onclick = () => {
          closeModal();
          toast.show('Open order modification dialog', 'info');
        };
      }
    }
  });
}

function openCreateOrderModal(onSaved) {
  const customers = salesService.getParties(true);
  const variants = productService.getVariants();

  const selectedCustomer = customers[0];
  const farms = selectedCustomer ? salesService.getFarmsByCustomer(selectedCustomer.id) : [];

  const contentHtml = `
    <form id="create-so-form" class="space-y-5 text-xs">
      <section class="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-xs space-y-4">
        <div class="flex items-center justify-between border-b border-slate-100 pb-3">
          <h3 class="text-xs font-bold uppercase tracking-wider text-slate-700 flex items-center gap-2">
            <span>👤</span>
            <span>1. Client &amp; Contract Information</span>
          </h3>
          <span class="text-[10px] text-slate-400 font-medium">All fields marked with <span class="text-red-500 font-bold">*</span> are required</span>
        </div>

        <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div class="space-y-1.5">
            <label class="text-xs font-semibold text-slate-700" for="so-customer-select">Customer <span class="text-red-500">*</span></label>
            <select id="so-customer-select" required class="w-full text-xs font-bold rounded-xl border border-slate-200 focus:border-[#138FCB] py-2.5 px-3 text-slate-800 bg-white shadow-2xs">
              ${customers.map(c => `<option value="${c.id}">${c.name}</option>`).join('')}
            </select>
          </div>

          <div class="space-y-1.5">
            <label class="text-xs font-semibold text-slate-700" for="so-farm-select">Target Farm / Branch</label>
            <select id="so-farm-select" class="w-full text-xs font-semibold rounded-xl border border-slate-200 focus:border-[#138FCB] py-2.5 px-3 text-slate-800 bg-white shadow-2xs">
              ${farms.map(f => `<option value="${f.id}">${f.name}</option>`).join('')}
            </select>
          </div>

          <div class="space-y-1.5">
            <label class="text-xs font-semibold text-slate-700" for="so-date">Order Date <span class="text-red-500">*</span></label>
            <input type="date" id="so-date" required value="${new Date().toISOString().split('T')[0]}" class="w-full text-xs rounded-xl border border-slate-200 focus:border-[#138FCB] py-2.5 px-3 text-slate-800 bg-white shadow-2xs">
          </div>
        </div>
      </section>

      <!-- Lines Section -->
      <section class="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-xs space-y-4">
        <div class="flex items-center justify-between border-b border-slate-100 pb-3">
          <h3 class="text-xs font-bold uppercase tracking-wider text-slate-700 flex items-center gap-2">
            <span>📦</span>
            <span>2. Order Line Items</span>
          </h3>
          <button type="button" id="so-add-line-btn" class="px-3 py-1.5 bg-blue-50 text-[#138FCB] font-bold rounded-xl border border-blue-200 hover:bg-blue-100 text-xs shadow-2xs cursor-pointer">
            + Add Line Item
          </button>
        </div>

        <div class="border border-slate-200/80 rounded-xl overflow-hidden">
          <table class="w-full text-left text-xs">
            <thead class="bg-slate-50 text-[10px] uppercase font-bold text-slate-500 border-b border-slate-200">
              <tr>
                <th class="py-2.5 px-3 w-5/12">Product Variant</th>
                <th class="py-2.5 px-3 text-center w-2/12">Quantity</th>
                <th class="py-2.5 px-3 text-center w-2/12">Unit Price (PKR)</th>
                <th class="py-2.5 px-3 text-right w-2/12">Line Total</th>
                <th class="py-2.5 px-2 text-center w-1/12"></th>
              </tr>
            </thead>
            <tbody id="so-lines-tbody" class="divide-y divide-slate-100">
              <tr class="so-line-row">
                <td class="p-3">
                  <select class="so-var-select w-full border border-slate-200 rounded-xl px-2.5 py-1.5 text-xs text-slate-800 font-semibold focus:border-[#138FCB]">
                    ${variants.map(v => `<option value="${v.id}" data-price="${v.sellingPrice || 0}">${v.name} (${v.sku})</option>`).join('')}
                  </select>
                </td>
                <td class="p-3 text-center">
                  <input type="number" min="1" value="10" class="so-qty-input w-20 text-center border border-slate-200 rounded-xl px-2 py-1.5 text-xs font-bold">
                </td>
                <td class="p-3 text-center">
                  <input type="number" min="0" step="any" value="${variants[0]?.sellingPrice || 1200}" class="so-price-input w-28 text-center border border-slate-200 rounded-xl px-2 py-1.5 text-xs font-bold">
                </td>
                <td class="p-3 text-right font-black text-slate-900 text-xs so-line-total">
                  Rs. ${((variants[0]?.sellingPrice || 1200) * 10).toLocaleString()}
                </td>
                <td class="p-3 text-center">
                  <button type="button" class="so-remove-row text-slate-400 hover:text-rose-600 font-bold p-1 cursor-pointer">✕</button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <!-- Totals & Notes -->
      <div class="grid grid-cols-1 md:grid-cols-2 gap-5">
        <section class="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-xs space-y-2">
          <label class="text-xs font-semibold text-slate-700" for="so-notes">Order Notes / Terms</label>
          <textarea id="so-notes" rows="3" placeholder="Contract delivery schedule, terms, or customer requests..." class="w-full text-xs rounded-xl border border-slate-200 focus:border-[#138FCB] p-3 text-slate-800 bg-white shadow-2xs resize-none"></textarea>
        </section>

        <section class="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-xs space-y-3">
          <h3 class="text-xs font-bold uppercase tracking-wider text-slate-700 pb-1 border-b border-slate-100">Order Summary</h3>
          <div class="flex justify-between items-center text-xs">
            <span class="text-slate-500">Total Contract Value:</span>
            <span id="so-total-calc" class="text-xl font-black text-[#138FCB] font-mono">Rs. 0</span>
          </div>
        </section>
      </div>
    </form>
  `;

  const footerHtml = `
    <div class="flex items-center space-x-2 text-xs text-slate-400">
      <span class="w-2 h-2 rounded-full bg-emerald-500"></span>
      <span>🛡️ SSL 256-bit encrypted ERP transaction</span>
    </div>
    <div class="flex items-center space-x-3 w-full sm:w-auto justify-end">
      <button id="so-cancel-btn" type="button" class="px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100 rounded-xl transition-colors border border-slate-200 cursor-pointer">
        Cancel
      </button>
      <button type="submit" form="create-so-form" class="inline-flex items-center space-x-2 px-5 py-2.5 text-xs font-bold text-white bg-[#138FCB] hover:bg-[#0E78AC] rounded-xl shadow-xs transition-all active:scale-[0.98] cursor-pointer">
        <span>Book Sales Order</span>
      </button>
    </div>
  `;

  openModal({
    title: 'Create Sales Order',
    subtitle: 'Book contractual sales commitment and initiate fulfillment tracking',
    badge: 'SO-NEW',
    contentHtml,
    footerHtml,
    size: 'max-w-4xl',
    onOpen: (modalEl) => {
      const cancelBtn = modalEl.querySelector('#so-cancel-btn');
      if (cancelBtn) cancelBtn.onclick = () => closeModal();

      const tbody = modalEl.querySelector('#so-lines-tbody');
      const totalDisplay = modalEl.querySelector('#so-total-calc');

      const recalcTotals = () => {
        let total = 0;
        tbody.querySelectorAll('.so-line-row').forEach(row => {
          const qty = Number(row.querySelector('.so-qty-input')?.value) || 0;
          const price = Number(row.querySelector('.so-price-input')?.value) || 0;
          const lineTot = qty * price;
          total += lineTot;
          const ltEl = row.querySelector('.so-line-total');
          if (ltEl) ltEl.textContent = `Rs. ${lineTot.toLocaleString()}`;
        });
        if (totalDisplay) totalDisplay.textContent = `Rs. ${total.toLocaleString()}`;
      };

      const bindRow = (row) => {
        const vSelect = row.querySelector('.so-var-select');
        const qInput = row.querySelector('.so-qty-input');
        const pInput = row.querySelector('.so-price-input');
        const remBtn = row.querySelector('.so-remove-row');

        if (vSelect) {
          vSelect.onchange = () => {
            const opt = vSelect.selectedOptions[0];
            const price = opt ? opt.getAttribute('data-price') : 0;
            if (pInput) pInput.value = price;
            recalcTotals();
          };
        }
        if (qInput) qInput.oninput = recalcTotals;
        if (pInput) pInput.oninput = recalcTotals;
        if (remBtn) {
          remBtn.onclick = () => {
            if (tbody.querySelectorAll('.so-line-row').length > 1) {
              row.remove();
              recalcTotals();
            }
          };
        }
      };

      tbody.querySelectorAll('.so-line-row').forEach(bindRow);
      recalcTotals();

      const addLineBtn = modalEl.querySelector('#so-add-line-btn');
      if (addLineBtn) {
        addLineBtn.onclick = () => {
          const tr = document.createElement('tr');
          tr.className = 'so-line-row hover:bg-slate-50/70';
          tr.innerHTML = `
            <td class="p-3">
              <select class="so-var-select w-full border border-slate-200 rounded-xl px-2.5 py-1.5 text-xs text-slate-800 font-semibold focus:border-[#138FCB]">
                ${variants.map(v => `<option value="${v.id}" data-price="${v.sellingPrice || 0}">${v.name} (${v.sku})</option>`).join('')}
              </select>
            </td>
            <td class="p-3 text-center">
              <input type="number" min="1" value="10" class="so-qty-input w-20 text-center border border-slate-200 rounded-xl px-2 py-1.5 text-xs font-bold">
            </td>
            <td class="p-3 text-center">
              <input type="number" min="0" step="any" value="${variants[0]?.sellingPrice || 1200}" class="so-price-input w-28 text-center border border-slate-200 rounded-xl px-2 py-1.5 text-xs font-bold">
            </td>
            <td class="p-3 text-right font-black text-slate-900 text-xs so-line-total">
              Rs. ${((variants[0]?.sellingPrice || 1200) * 10).toLocaleString()}
            </td>
            <td class="p-3 text-center">
              <button type="button" class="so-remove-row text-slate-400 hover:text-rose-600 font-bold p-1 cursor-pointer">✕</button>
            </td>
          `;
          tbody.appendChild(tr);
          bindRow(tr);
          recalcTotals();
        };
      }

      modalEl.querySelector('#create-so-form').onsubmit = (e) => {
        e.preventDefault();
        const customerPartyId = modalEl.querySelector('#so-customer-select').value;
        const farmId = modalEl.querySelector('#so-farm-select').value;
        const date = modalEl.querySelector('#so-date').value;
        const notes = modalEl.querySelector('#so-notes').value.trim();

        const lines = [];
        tbody.querySelectorAll('.so-line-row').forEach(row => {
          const variantId = row.querySelector('.so-var-select')?.value;
          const orderedQty = Number(row.querySelector('.so-qty-input')?.value) || 0;
          const unitPrice = Number(row.querySelector('.so-price-input')?.value) || 0;
          if (variantId && orderedQty > 0) {
            lines.push({ variantId, orderedQty, unitPrice, unit: 'PCS' });
          }
        });

        if (lines.length === 0) {
          toast.show('Please enter at least one valid line item.', 'warning');
          return;
        }

        try {
          const order = salesService.createSalesOrder({
            customerPartyId,
            farmId,
            date,
            notes,
            lines
          });

          toast.show(`Sales Order ${order.orderNumber} successfully booked!`, 'success');
          closeModal();
          if (onSaved) onSaved();
        } catch (err) {
          toast.show(err.message, 'error');
        }
      };
    }
  });
}
