/**
 * JS Traders ERP - Sales Orders View (Outgoing Stock Demand)
 * 
 * Core Design Principles:
 * 1. Renamed from Gatepass Outward Voucher to Sales Order.
 * 2. Represents the customer's complete requirements (created by Warehouse Manager or Sales).
 * 3. Does NOT reduce physical warehouse inventory upon creation.
 * 4. Each line tracks independently: Ordered Qty, Delivered Qty, Remaining Delivery Qty, Invoiced Qty, Remaining Invoice Qty.
 * 5. Primary action [Create GDN / Gatepass] creates partial/full GDN with remaining quantities.
 * 6. Full traceability of all linked GDNs per Sales Order.
 */

import { salesService } from '../../services/salesService.js';
import { productService } from '../../services/productService.js';
import { gatepassService } from '../../services/gatepassService.js';
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
    searchPlaceholder: 'Search orders by SO #, customer name, notes...',
    dropdowns: [
      {
        id: 'so-status-filter',
        label: 'Status',
        value: 'all',
        options: [
          { value: 'all', label: 'All Statuses' },
          { value: 'Confirmed', label: 'Confirmed (Pending Delivery)' },
          { value: 'Partially Delivered', label: 'Partially Delivered' },
          { value: 'Fully Delivered', label: 'Fully Delivered' },
          { value: 'Draft', label: 'Draft' },
          { value: 'Cancelled', label: 'Cancelled' }
        ]
      }
    ],
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
      label: 'Customer / Destination',
      render: row => `
        <div>
          <div class="font-bold text-slate-800">${partyMap.get(row.customerPartyId) || row.customerName || 'Customer'}</div>
          <div class="text-[10px] text-slate-400 font-mono">Date: ${row.date || 'Today'}</div>
        </div>
      `
    },
    {
      key: 'deliveryProgress',
      label: 'Delivery Progress (Dispatches)',
      render: row => {
        let totalOrd = 0;
        let totalDel = 0;
        (row.lines || []).forEach(l => {
          totalOrd += (Number(l.orderedQty) || 0);
          totalDel += (Number(l.deliveredQty) || 0);
        });
        const remaining = Math.max(0, totalOrd - totalDel);
        const pct = totalOrd > 0 ? Math.min(100, Math.round((totalDel / totalOrd) * 100)) : 0;
        return `
          <div class="space-y-1 min-w-[130px]">
            <div class="flex items-center justify-between text-[11px] font-bold">
              <span class="text-emerald-700">${totalDel} del</span>
              <span class="text-slate-400 font-normal">/</span>
              <span class="text-slate-800">${totalOrd} ord</span>
              ${remaining > 0 ? `<span class="text-blue-600 text-[10px]">(${remaining} left)</span>` : ''}
            </div>
            <div class="w-full bg-slate-100 rounded-full h-1.5 overflow-hidden">
              <div class="h-full ${pct === 100 ? 'bg-emerald-500' : pct > 0 ? 'bg-blue-500' : 'bg-slate-300'}" style="width: ${pct}%"></div>
            </div>
          </div>
        `;
      }
    },
    {
      key: 'invoicedProgress',
      label: 'Invoicing',
      render: row => {
        let totalOrd = 0;
        let totalInv = 0;
        (row.lines || []).forEach(l => {
          totalOrd += (Number(l.orderedQty) || 0);
          totalInv += (Number(l.invoicedQty) || 0);
        });
        return `
          <div class="text-center">
            <span class="px-2 py-0.5 rounded-lg text-[10px] font-semibold ${totalInv >= totalOrd && totalOrd > 0 ? 'bg-emerald-50 text-emerald-700' : totalInv > 0 ? 'bg-amber-50 text-amber-700' : 'bg-slate-100 text-slate-500'}">
              ${totalInv} / ${totalOrd} Inv
            </span>
          </div>
        `;
      }
    },
    {
      key: 'total',
      label: 'Contract Total',
      render: row => `<span class="font-extrabold text-slate-900 font-mono">Rs. ${Number(row.total || 0).toLocaleString()}</span>`
    },
    {
      key: 'status',
      label: 'Order Status',
      render: row => `
        <span class="px-2.5 py-0.5 rounded-full text-[10px] font-bold ${
          row.status === 'Fully Delivered' || row.status === 'Delivered' ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' :
          row.status === 'Partially Delivered' ? 'bg-blue-50 text-[#138FCB] border border-blue-200' :
          row.status === 'Cancelled' ? 'bg-rose-50 text-rose-700 border border-rose-200' :
          row.status === 'Confirmed' ? 'bg-amber-50 text-amber-700 border border-amber-200' :
          'bg-slate-100 text-slate-600 border border-slate-200'
        }">
          ${row.status}
        </span>
      `
    }
  ];

  const actions = [
    { label: 'View', variant: 'secondary' },
    { label: 'Create Delivery Note', variant: 'primary' },
    { label: 'Print Voucher', variant: 'secondary' }
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
    { label: 'View', variant: 'secondary', onClick: (row) => openOrderDetailModal(row, refreshCallback) },
    { label: 'Create Delivery Note', variant: 'primary', onClick: (row) => openCreateDeliveryNoteModal(row, refreshCallback) },
    { label: 'Print Voucher', variant: 'secondary', onClick: (row) => printSalesOrderVoucher(row) }
  ];
  bindTableActions(container, actions, orders);

  const searchInput = container.querySelector('#filter-search-input');
  if (searchInput) {
    searchInput.oninput = (e) => {
      const q = e.target.value.toLowerCase().trim();
      const parties = salesService.getParties(true);
      const partyMap = new Map(parties.map(p => [p.id, p.name]));
      const filtered = orders.filter(o =>
        (o.orderNumber && o.orderNumber.toLowerCase().includes(q)) ||
        (o.notes && o.notes.toLowerCase().includes(q)) ||
        (partyMap.get(o.customerPartyId) && partyMap.get(o.customerPartyId).toLowerCase().includes(q))
      );
      updateOrdersTable(container, filtered, refreshCallback);
    };
  }

  const statusFilter = container.querySelector('#so-status-filter');
  if (statusFilter) {
    statusFilter.onchange = (e) => {
      const val = e.target.value;
      const filtered = val === 'all' ? orders : orders.filter(o => o.status === val);
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
      label: 'Customer / Destination',
      render: row => `
        <div>
          <div class="font-bold text-slate-800">${partyMap.get(row.customerPartyId) || row.customerName || 'Customer'}</div>
          <div class="text-[10px] text-slate-400 font-mono">Date: ${row.date || 'Today'}</div>
        </div>
      `
    },
    {
      key: 'deliveryProgress',
      label: 'Delivery Progress (Dispatches)',
      render: row => {
        let totalOrd = 0;
        let totalDel = 0;
        (row.lines || []).forEach(l => {
          totalOrd += (Number(l.orderedQty) || 0);
          totalDel += (Number(l.deliveredQty) || 0);
        });
        const remaining = Math.max(0, totalOrd - totalDel);
        const pct = totalOrd > 0 ? Math.min(100, Math.round((totalDel / totalOrd) * 100)) : 0;
        return `
          <div class="space-y-1 min-w-[130px]">
            <div class="flex items-center justify-between text-[11px] font-bold">
              <span class="text-emerald-700">${totalDel} del</span>
              <span class="text-slate-400 font-normal">/</span>
              <span class="text-slate-800">${totalOrd} ord</span>
              ${remaining > 0 ? `<span class="text-blue-600 text-[10px]">(${remaining} left)</span>` : ''}
            </div>
            <div class="w-full bg-slate-100 rounded-full h-1.5 overflow-hidden">
              <div class="h-full ${pct === 100 ? 'bg-emerald-500' : pct > 0 ? 'bg-blue-500' : 'bg-slate-300'}" style="width: ${pct}%"></div>
            </div>
          </div>
        `;
      }
    },
    {
      key: 'invoicedProgress',
      label: 'Invoicing',
      render: row => {
        let totalOrd = 0;
        let totalInv = 0;
        (row.lines || []).forEach(l => {
          totalOrd += (Number(l.orderedQty) || 0);
          totalInv += (Number(l.invoicedQty) || 0);
        });
        return `
          <div class="text-center">
            <span class="px-2 py-0.5 rounded-lg text-[10px] font-semibold ${totalInv >= totalOrd && totalOrd > 0 ? 'bg-emerald-50 text-emerald-700' : totalInv > 0 ? 'bg-amber-50 text-amber-700' : 'bg-slate-100 text-slate-500'}">
              ${totalInv} / ${totalOrd} Inv
            </span>
          </div>
        `;
      }
    },
    { key: 'total', label: 'Contract Total', render: row => `<span class="font-extrabold text-slate-900 font-mono">Rs. ${Number(row.total || 0).toLocaleString()}</span>` },
    {
      key: 'status',
      label: 'Order Status',
      render: row => `
        <span class="px-2.5 py-0.5 rounded-full text-[10px] font-bold ${
          row.status === 'Fully Delivered' || row.status === 'Delivered' ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' :
          row.status === 'Partially Delivered' ? 'bg-blue-50 text-[#138FCB] border border-blue-200' :
          row.status === 'Cancelled' ? 'bg-rose-50 text-rose-700 border border-rose-200' :
          row.status === 'Confirmed' ? 'bg-amber-50 text-amber-700 border border-amber-200' :
          'bg-slate-100 text-slate-600 border border-slate-200'
        }">
          ${row.status}
        </span>
      `
    }
  ];

  const actions = [
    { label: 'View', variant: 'secondary', onClick: (row) => openOrderDetailModal(row, refreshCallback) },
    { label: 'Create GDN', variant: 'primary', onClick: (row) => openCreateGDNModal(row, refreshCallback) },
    { label: 'Print Voucher', variant: 'secondary', onClick: (row) => printSalesOrderVoucher(row) }
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
  const remainingLines = salesService.getRemainingDeliveryLines(order.id);
  const linkedGDNs = gatepassService.getGDNsBySalesOrder(order.id);

  const contentHtml = `
    <div class="space-y-6 text-xs">
      <!-- SECTION 1: Order Header Overview -->
      <section class="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-xs space-y-4">
        <div class="flex items-center justify-between border-b border-slate-100 pb-3">
          <h3 class="text-xs font-bold uppercase tracking-wider text-slate-700 flex items-center gap-2">
            <span>📋</span>
            <span>1. Sales Order Overview</span>
          </h3>
          <span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-bold ${
            order.status === 'Fully Delivered' ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' :
            order.status === 'Partially Delivered' ? 'bg-blue-50 text-[#138FCB] border border-blue-200' :
            isCancelled ? 'bg-rose-50 text-rose-700 border border-rose-200' :
            'bg-amber-50 text-amber-700 border border-amber-200'
          }">
            ${order.status}
          </span>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div class="p-3 bg-slate-50/70 rounded-xl border border-slate-200/70 space-y-1">
            <span class="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Customer Party</span>
            <p class="text-sm font-bold text-slate-900">${party ? party.name : (order.customerName || 'Customer')}</p>
            <p class="text-[11px] text-slate-500">Farm / Site: ${order.farmId || 'Main Site'}</p>
          </div>

          <div class="p-3 bg-slate-50/70 rounded-xl border border-slate-200/70 space-y-1">
            <span class="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Order Info</span>
            <p class="text-sm font-bold text-slate-800">${order.orderNumber}</p>
            <p class="text-[11px] text-slate-500">Date: ${order.date || 'Today'}</p>
          </div>

          <div class="p-3 bg-blue-50/50 rounded-xl border border-blue-200/70 space-y-1 text-right">
            <span class="text-[10px] font-bold text-[#138FCB] uppercase tracking-wider block">Contract Value</span>
            <p class="text-xl font-black text-slate-900 font-mono">Rs. ${Number(order.total || 0).toLocaleString()}</p>
            <p class="text-[10px] text-slate-500">Subtotal: Rs. ${Number(order.subtotal || order.total || 0).toLocaleString()}</p>
          </div>
        </div>
      </section>

      <!-- SECTION 2: Order Line Items with Independent Quantities -->
      <section class="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-xs space-y-4">
        <div class="flex items-center justify-between border-b border-slate-100 pb-3">
          <h3 class="text-xs font-bold uppercase tracking-wider text-slate-700 flex items-center gap-2">
            <span>📦</span>
            <span>2. Order Line Items &amp; Quantity Tracking</span>
          </h3>
          <span class="text-[10px] text-slate-400 font-semibold">${(order.lines || []).length} Line Item(s)</span>
        </div>

        <div class="border border-slate-200/80 rounded-xl overflow-hidden">
          <table class="w-full text-left text-xs">
            <thead class="bg-slate-50 text-[10px] uppercase font-bold text-slate-500 border-b border-slate-200">
              <tr>
                <th class="py-2.5 px-3">Item Variant</th>
                <th class="py-2.5 px-3 text-center">Ordered</th>
                <th class="py-2.5 px-3 text-center text-emerald-700 font-bold">Delivered</th>
                <th class="py-2.5 px-3 text-center text-blue-600 font-bold">Pending</th>
                <th class="py-2.5 px-3 text-center text-amber-700 font-bold">Invoiced</th>
                <th class="py-2.5 px-3 text-right">Unit Price</th>
                <th class="py-2.5 px-3 text-right">Line Total</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-slate-100">
              ${(order.lines || []).map(l => {
                const ord = Number(l.orderedQty) || 0;
                const del = Number(l.deliveredQty) || 0;
                const inv = Number(l.invoicedQty) || 0;
                const remDel = Math.max(0, ord - del);
                return `
                  <tr class="hover:bg-slate-50/70">
                    <td class="py-3 px-3 font-semibold text-slate-800">
                      <div>${varMap.get(l.variantId) || 'Item'}</div>
                      ${l.notes ? `<div class="text-[10px] text-slate-400">${l.notes}</div>` : ''}
                    </td>
                    <td class="py-3 px-3 text-center font-bold text-slate-800">${ord} ${l.unit || 'PCS'}</td>
                    <td class="py-3 px-3 text-center text-emerald-600 font-bold">${del}</td>
                    <td class="py-3 px-3 text-center ${remDel > 0 ? 'text-blue-600 font-extrabold' : 'text-slate-400'}">${remDel}</td>
                    <td class="py-3 px-3 text-center text-amber-600 font-bold">${inv}</td>
                    <td class="py-3 px-3 text-right font-mono">Rs. ${Number(l.unitPrice || 0).toLocaleString()}</td>
                    <td class="py-3 px-3 text-right font-extrabold text-slate-900 font-mono">Rs. ${Number(l.lineTotal || (ord * (l.unitPrice || 0))).toLocaleString()}</td>
                  </tr>
                `;
              }).join('')}
            </tbody>
          </table>
        </div>
      </section>

      <!-- SECTION 3: Linked Dispatches (Delivery Notes / Stock Issues) -->
      <section class="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-xs space-y-4">
        <div class="flex items-center justify-between border-b border-slate-100 pb-3">
          <h3 class="text-xs font-bold uppercase tracking-wider text-slate-700 flex items-center gap-2">
            <span>🚚</span>
            <span>3. Linked Delivery Notes (${linkedGDNs.length})</span>
          </h3>
          <span class="text-[10px] text-slate-400 font-semibold">Physical inventory deducted via Stock Issue upon approval</span>
        </div>

        ${linkedGDNs.length === 0 ? `
          <div class="p-4 bg-slate-50/60 rounded-xl text-center text-slate-400">
            No delivery notes issued against this order yet.
          </div>
        ` : `
          <div class="border border-slate-200/80 rounded-xl overflow-hidden">
            <table class="w-full text-left text-xs">
              <thead class="bg-slate-50 text-[10px] uppercase font-bold text-slate-500 border-b border-slate-200">
                <tr>
                  <th class="py-2 px-3">Delivery Note #</th>
                  <th class="py-2 px-3">Date</th>
                  <th class="py-2 px-3">Vehicle &amp; Driver</th>
                  <th class="py-2 px-3 text-center">Items Dispatched</th>
                  <th class="py-2 px-3 text-right">Status</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-slate-100">
                ${linkedGDNs.map(g => {
                  const itemsCount = (g.lines || []).reduce((s, l) => s + (Number(l.quantity) || (Number(l.warehouseQty || 0) + Number(l.officeQty || 0))), 0);
                  return `
                    <tr class="hover:bg-slate-50/70">
                      <td class="py-2.5 px-3 font-bold text-[#138FCB] font-mono">${g.gatepassNumber}</td>
                      <td class="py-2.5 px-3 text-slate-600 font-mono">${g.date}</td>
                      <td class="py-2.5 px-3 text-slate-700">${g.vehicleNumber || 'Unassigned'} • ${g.driverName || 'No Driver'}</td>
                      <td class="py-2.5 px-3 text-center font-bold text-slate-800">${itemsCount} units</td>
                      <td class="py-2.5 px-3 text-right">
                        <span class="px-2 py-0.5 rounded text-[10px] font-bold ${g.status && g.status.startsWith('Approved') ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : g.status === 'Voided' ? 'bg-rose-50 text-rose-700' : 'bg-amber-50 text-amber-700'}">
                          ${g.status}
                        </span>
                      </td>
                    </tr>
                  `;
                }).join('')}
              </tbody>
            </table>
          </div>
        `}
      </section>
    </div>
  `;

  const footerHtml = `
    <div class="flex items-center space-x-2 text-xs text-slate-400">
      <span class="w-2 h-2 rounded-full bg-emerald-500"></span>
      <span>🛡️ Warehouse Order Management</span>
    </div>
    <div class="flex flex-col sm:flex-row items-center justify-between w-full sm:w-auto gap-3">
      <div>
        ${!isCancelled ? `
          <button id="order-void-btn" type="button" class="inline-flex items-center space-x-1.5 px-3.5 py-2 text-xs font-bold text-rose-600 hover:text-rose-700 bg-rose-50 hover:bg-rose-100 border border-rose-200 rounded-xl transition-colors cursor-pointer">
            <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path>
            </svg>
            <span>Cancel Sales Order</span>
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
        <button id="order-print-btn" type="button" class="inline-flex items-center space-x-1.5 px-4 py-2 text-xs font-bold text-slate-700 bg-white hover:bg-slate-50 border border-slate-200 rounded-xl transition-all cursor-pointer shadow-2xs">
          <span>🖨️ Print Voucher</span>
        </button>
        ${!isCancelled && remainingLines.length > 0 ? `
          <button id="order-create-gdn-btn" type="button" class="inline-flex items-center space-x-2 px-4 py-2 text-xs font-bold text-white bg-[#138FCB] hover:bg-[#0E78AC] rounded-xl shadow-xs transition-all cursor-pointer">
            <span>🚚 Create Delivery Note</span>
          </button>
        ` : ''}
      </div>
    </div>
  `;

  openModal({
    title: `Sales Order: ${order.orderNumber}`,
    subtitle: 'Customer requirements, quantity tracking, and linked outward dispatches',
    badge: order.orderNumber,
    contentHtml,
    footerHtml,
    size: 'max-w-4xl',
    onOpen: (modalEl) => {
      const closeBtn = modalEl.querySelector('#order-close-btn');
      if (closeBtn) closeBtn.onclick = () => closeModal();

      const printBtn = modalEl.querySelector('#order-print-btn');
      if (printBtn) {
        printBtn.onclick = () => {
          printSalesOrderVoucher(order);
        };
      }

      const createGdnBtn = modalEl.querySelector('#order-create-gdn-btn');
      if (createGdnBtn) {
        createGdnBtn.onclick = () => {
          closeModal();
          openCreateGDNModal(order, refreshCallback);
        };
      }

      const voidBtn = modalEl.querySelector('#order-void-btn');
      if (voidBtn) {
        voidBtn.onclick = () => {
          confirmAction({
            title: `Cancel Order: ${order.orderNumber}`,
            message: 'Are you sure you want to cancel this sales order? Undelivered quantities will no longer be available for dispatch.',
            confirmLabel: 'Yes, Cancel Order',
            isDestructive: true,
            onConfirm: () => {
              salesService.cancelSalesOrder(order.id);
              toast.show(`Sales Order ${order.orderNumber} cancelled.`, 'success');
              closeModal();
              if (refreshCallback) refreshCallback();
            }
          });
        };
      }
    }
  });
}

export function openCreateDeliveryNoteModal(order, onSaved) {
  const remainingLines = salesService.getRemainingDeliveryLines(order.id);
  if (remainingLines.length === 0) {
    toast.show('This Sales Order has already been fully delivered.', 'warning');
    return;
  }
  const variants = productService.getVariants();
  const varMap = new Map(variants.map(v => [v.id, v]));
  const warehouses = storageService.getCollection('warehouses') || [];

  const contentHtml = `
    <form id="create-gdn-form" class="space-y-4 text-xs">
      <div class="bg-blue-50/70 p-3.5 rounded-2xl border border-blue-200/80 flex justify-between items-center">
        <div>
          <span class="text-[10px] font-bold uppercase tracking-wider text-blue-600">Originating Demand</span>
          <h4 class="text-sm font-extrabold text-slate-800 font-mono">${order.orderNumber}</h4>
          <span class="text-[11px] text-slate-500 font-medium">Customer: <strong>${order.customerName || 'Customer'}</strong></span>
        </div>
        <span class="px-2.5 py-1 rounded-full text-[10px] font-bold bg-blue-100 text-blue-800 border border-blue-200">
          ${remainingLines.length} Item(s) Pending Delivery
        </span>
      </div>

      <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div>
          <label class="block font-bold text-slate-700 mb-1">Dispatch Facility <span class="text-rose-500">*</span></label>
          <select id="gdn-warehouse-select" class="w-full px-3 py-2 border border-slate-200 rounded-xl focus:outline-none focus:border-[#138FCB] font-semibold text-slate-800 shadow-2xs">
            ${warehouses.map(w => `<option value="${w.id}">${w.name} (${w.city || ''})</option>`).join('')}
          </select>
        </div>
        <div>
          <label class="block font-bold text-slate-700 mb-1">Vehicle / Truck #</label>
          <input type="text" id="gdn-vehicle-input" placeholder="e.g. LES-9412 Hino Truck" value="LES-9412 Truck" class="w-full px-3 py-2 border border-slate-200 rounded-xl focus:outline-none focus:border-[#138FCB] font-mono text-slate-800 shadow-2xs">
        </div>
        <div>
          <label class="block font-bold text-slate-700 mb-1">Driver Name &amp; Phone</label>
          <input type="text" id="gdn-driver-input" placeholder="e.g. Muhammad Rasheed" value="Muhammad Rasheed" class="w-full px-3 py-2 border border-slate-200 rounded-xl focus:outline-none focus:border-[#138FCB] text-slate-800 shadow-2xs">
        </div>
      </div>

      <!-- Line Quantities Table -->
      <div class="border border-slate-200/80 rounded-xl overflow-hidden">
        <table class="w-full text-left text-xs">
          <thead class="bg-slate-50 text-[10px] uppercase font-bold text-slate-500 border-b border-slate-200">
            <tr>
              <th class="py-2.5 px-3">Item Variant</th>
              <th class="py-2.5 px-3 text-center">Ordered</th>
              <th class="py-2.5 px-3 text-center text-emerald-700 font-bold">Delivered</th>
              <th class="py-2.5 px-3 text-center text-blue-600 font-bold">Pending</th>
              <th class="py-2.5 px-3 text-center w-32 text-indigo-700 font-bold">Deliver Now</th>
            </tr>
          </thead>
          <tbody id="gdn-lines-tbody" class="divide-y divide-slate-100">
            ${remainingLines.map(line => {
              const v = varMap.get(line.variantId) || {};
              return `
                <tr class="hover:bg-slate-50/70" data-variant-id="${line.variantId}" data-remaining="${line.remainingDeliveryQty}">
                  <td class="py-2.5 px-3 font-semibold text-slate-800">
                    <div>${v.name || 'Item'}</div>
                    <div class="text-[10px] text-slate-400 font-mono">${v.sku || ''}</div>
                  </td>
                  <td class="py-2.5 px-3 text-center text-slate-600">${line.orderedQty}</td>
                  <td class="py-2.5 px-3 text-center text-emerald-600 font-bold">${line.deliveredQty}</td>
                  <td class="py-2.5 px-3 text-center font-bold text-blue-600">${line.remainingDeliveryQty} ${line.unit}</td>
                  <td class="py-2.5 px-3 text-center">
                    <input type="number" min="0" max="${line.remainingDeliveryQty}" value="${line.remainingDeliveryQty}" class="gdn-line-qty w-24 text-center border border-indigo-200 rounded-xl px-2 py-1.5 text-xs font-bold focus:border-[#138FCB] shadow-2xs bg-indigo-50/30">
                  </td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      </div>

      <div>
        <label class="block font-bold text-slate-700 mb-1">Delivery Notes / Gate Instructions</label>
        <textarea id="gdn-notes-input" rows="2" placeholder="Site delivery instructions, drop-off location..." class="w-full px-3 py-2 border border-slate-200 rounded-xl focus:outline-none focus:border-[#138FCB] text-slate-800 shadow-2xs resize-none"></textarea>
      </div>
    </form>
  `;

  const footerHtml = `
    <div class="flex items-center space-x-2 text-xs text-slate-400">
      <span class="w-2 h-2 rounded-full bg-emerald-500"></span>
      <span>🛡️ Outward physical movement creates Stock Issue (-Qty) upon approval</span>
    </div>
    <div class="flex items-center space-x-3 w-full sm:w-auto justify-end">
      <button id="gdn-cancel-btn" type="button" class="px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100 rounded-xl transition-colors border border-slate-200 cursor-pointer">
        Cancel
      </button>
      <button id="gdn-submit-btn" type="button" class="inline-flex items-center space-x-2 px-5 py-2.5 text-xs font-bold text-white bg-[#138FCB] hover:bg-[#0E78AC] rounded-xl shadow-xs transition-all active:scale-[0.98] cursor-pointer">
        <span>🚚 Issue Delivery Note</span>
      </button>
    </div>
  `;

  openModal({
    title: `Create Delivery Note: ${order.orderNumber}`,
    subtitle: 'Generate physical Delivery Note for warehouse dispatch. Stock Issue will deduct inventory upon approval.',
    badge: 'DELIVERY NOTE',
    contentHtml,
    footerHtml,
    size: 'max-w-2xl',
    onOpen: (modalEl) => {
      modalEl.querySelector('#gdn-cancel-btn').onclick = () => closeModal();

      modalEl.querySelector('#gdn-submit-btn').onclick = () => {
        const selectedWh = modalEl.querySelector('#gdn-warehouse-select').value;
        const vehicle = modalEl.querySelector('#gdn-vehicle-input').value.trim();
        const driver = modalEl.querySelector('#gdn-driver-input').value.trim();
        const notes = modalEl.querySelector('#gdn-notes-input').value.trim();

        const lines = [];
        let hasError = false;

        modalEl.querySelectorAll('#gdn-lines-tbody tr').forEach(tr => {
          const variantId = tr.dataset.variantId;
          const maxRem = Number(tr.dataset.remaining) || 0;
          const qtyInput = tr.querySelector('.gdn-line-qty');
          const qty = Number(qtyInput?.value) || 0;
          if (qty > 0) {
            if (qty > maxRem) {
              toast.show(`Quantity cannot exceed pending ${maxRem}.`, 'error');
              hasError = true;
              return;
            }
            lines.push({
              variantId,
              warehouseQty: selectedWh === 'wh-1' ? qty : 0,
              officeQty: selectedWh === 'wh-2' ? qty : 0,
              quantity: qty,
              unit: 'PCS'
            });
          }
        });

        if (hasError) return;

        if (lines.length === 0) {
          toast.show('Please enter at least one quantity to dispatch.', 'warning');
          return;
        }

        try {
          const gp = gatepassService.createGDNFromSalesOrder(order.id, {
            warehouseId: selectedWh,
            vehicleNumber: vehicle,
            driverName: driver,
            lines,
            notes
          });
          toast.show(`Delivery Note ${gp.gatepassNumber} created successfully! Stock Issue will occur upon approval.`, 'success');
          closeModal();
          if (onSaved) onSaved();
        } catch (err) {
          toast.show(err.message, 'error');
        }
      };
    }
  });
}

export const openCreateGDNModal = openCreateDeliveryNoteModal;

export function printSalesOrderVoucher(order) {
  const parties = salesService.getParties(true);
  const party = parties.find(p => p.id === order.customerPartyId);
  const variants = productService.getVariants();
  const varMap = new Map(variants.map(v => [v.id, v.name]));
  const linkedGDNs = gatepassService.getGDNsBySalesOrder(order.id);

  const printWindow = window.open('', '_blank');
  if (!printWindow) {
    toast.show('Pop-up blocked. Please allow pop-ups to print voucher.', 'warning');
    return;
  }

  printWindow.document.write(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Sales Order - ${order.orderNumber}</title>
      <style>
        body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; margin: 30px; color: #1e293b; font-size: 13px; line-height: 1.5; }
        .header { display: flex; justify-content: space-between; border-bottom: 2px solid #0f172a; padding-bottom: 12px; margin-bottom: 20px; }
        .title { font-size: 24px; font-weight: 900; color: #0f172a; text-transform: uppercase; letter-spacing: 1px; }
        .subtitle { font-size: 11px; color: #64748b; font-weight: 600; text-transform: uppercase; }
        .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-bottom: 25px; }
        .card { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 12px; }
        .card-label { font-size: 10px; font-weight: 800; color: #64748b; text-transform: uppercase; margin-bottom: 4px; }
        table { width: 100%; border-collapse: collapse; margin-bottom: 25px; }
        th { background: #0f172a; color: white; font-size: 10px; text-transform: uppercase; padding: 8px 10px; text-align: left; }
        td { border-bottom: 1px solid #e2e8f0; padding: 8px 10px; }
        .text-right { text-align: right; }
        .text-center { text-align: center; }
        .font-mono { font-family: monospace; }
        .signatures { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 20px; margin-top: 50px; text-align: center; }
        .sig-line { border-top: 1px dashed #94a3b8; padding-top: 6px; font-size: 11px; font-weight: 700; color: #475569; }
        @media print {
          body { margin: 10mm; }
          button { display: none; }
        }
      </style>
    </head>
    <body>
      <div class="header">
        <div>
          <div class="title">JS TRADERS</div>
          <div class="subtitle">Poultry Equipment &amp; Automation Shed Engineering</div>
          <div style="font-size: 11px; color: #475569; margin-top: 4px;">Plot 45-B Industrial Area, Multan Road, Lahore • Tel: +92 300 1234567</div>
        </div>
        <div style="text-align: right;">
          <div style="font-size: 20px; font-weight: 900; color: #138FCB;">SALES ORDER</div>
          <div style="font-size: 13px; font-weight: 800; font-family: monospace;">${order.orderNumber}</div>
          <div style="font-size: 11px; color: #64748b;">Date: ${order.date || 'Today'}</div>
        </div>
      </div>

      <div class="grid">
        <div class="card">
          <div class="card-label">Customer / Contractee Details</div>
          <div style="font-size: 14px; font-weight: 800; color: #0f172a;">${party ? party.name : (order.customerName || 'Customer')}</div>
          <div style="font-size: 11px; color: #475569; margin-top: 2px;">Farm / Branch: <strong>${order.farmId || 'Main Site'}</strong></div>
          <div style="font-size: 11px; color: #475569;">Contact: ${party ? (party.phone || party.contactPerson || 'N/A') : 'N/A'}</div>
        </div>
        <div class="card">
          <div class="card-label">Order Fulfillment Status</div>
          <div>Status: <strong>${order.status}</strong></div>
          <div>Linked Deliveries: <strong>${linkedGDNs.length} Delivery Note(s)</strong></div>
          <div style="font-size: 11px; color: #64748b; margin-top: 4px;">* Note: Stock is deducted upon individual Delivery Note approval (Stock Issue).</div>
        </div>
      </div>

      <table>
        <thead>
          <tr>
            <th>#</th>
            <th>Item Description</th>
            <th class="text-center">Ordered Qty</th>
            <th class="text-center">Delivered Qty</th>
            <th class="text-center">Pending Qty</th>
            <th class="text-right">Unit Rate</th>
            <th class="text-right">Total Amount</th>
          </tr>
        </thead>
        <tbody>
          ${(order.lines || []).map((l, i) => {
            const ord = Number(l.orderedQty) || 0;
            const del = Number(l.deliveredQty) || 0;
            const rem = Math.max(0, ord - del);
            return `
              <tr>
                <td>${i + 1}</td>
                <td><strong>${varMap.get(l.variantId) || 'Product Item'}</strong></td>
                <td class="text-center"><strong>${ord}</strong> ${l.unit || 'PCS'}</td>
                <td class="text-center" style="color: #059669; font-weight: 700;">${del}</td>
                <td class="text-center" style="color: #2563eb; font-weight: 700;">${rem}</td>
                <td class="text-right font-mono">Rs. ${Number(l.unitPrice || 0).toLocaleString()}</td>
                <td class="text-right font-mono" style="font-weight: 800;">Rs. ${Number(l.lineTotal || (ord * (l.unitPrice || 0))).toLocaleString()}</td>
              </tr>
            `;
          }).join('')}
        </tbody>
        <tfoot>
          <tr>
            <td colspan="6" class="text-right" style="font-weight: 800; font-size: 12px; padding: 10px;">TOTAL CONTRACT VALUE:</td>
            <td class="text-right font-mono" style="font-size: 14px; font-weight: 900; color: #0f172a; padding: 10px;">Rs. ${Number(order.total || 0).toLocaleString()}</td>
          </tr>
        </tfoot>
      </table>

      ${order.notes ? `
        <div style="margin-bottom: 20px; font-size: 11px; background: #fffbeb; border: 1px solid #fef3c7; padding: 10px; border-radius: 6px;">
          <strong>Order Notes / Special Instructions:</strong> ${order.notes}
        </div>
      ` : ''}

      <div class="signatures">
        <div>
          <div style="height: 40px;"></div>
          <div class="sig-line">Prepared By (Warehouse Manager)</div>
        </div>
        <div>
          <div style="height: 40px;"></div>
          <div class="sig-line">Approved By (Sales Executive)</div>
        </div>
        <div>
          <div style="height: 40px;"></div>
          <div class="sig-line">Customer Signature &amp; Stamp</div>
        </div>
      </div>

      <script>
        window.onload = function() {
          window.print();
        };
      </script>
    </body>
    </html>
  `);
  printWindow.document.close();
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
            <span>1. Customer &amp; Order Information</span>
          </h3>
          <span class="text-[10px] text-slate-400 font-medium">Warehouse creates Sales Order for demand tracking</span>
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
            <span>2. Order Line Items (Requirements)</span>
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
                <th class="py-2.5 px-3 text-center w-2/12">Ordered Qty</th>
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
          <label class="text-xs font-semibold text-slate-700" for="so-notes">Order Notes / Delivery Terms</label>
          <textarea id="so-notes" rows="3" placeholder="Contract delivery schedule, partial batch instructions..." class="w-full text-xs rounded-xl border border-slate-200 focus:border-[#138FCB] p-3 text-slate-800 bg-white shadow-2xs resize-none"></textarea>
        </section>

        <section class="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-xs space-y-3">
          <h3 class="text-xs font-bold uppercase tracking-wider text-slate-700 pb-1 border-b border-slate-100">Order Summary</h3>
          <div class="flex justify-between items-center text-xs">
            <span class="text-slate-500">Total Contract Value:</span>
            <span id="so-total-calc" class="text-xl font-black text-[#138FCB] font-mono">Rs. 0</span>
          </div>
          <p class="text-[10px] text-slate-400 italic">Does NOT reduce physical stock until a Delivery Note is approved (Stock Issue).</p>
        </section>
      </div>
    </form>
  `;

  const footerHtml = `
    <div class="flex items-center space-x-2 text-xs text-slate-400">
      <span class="w-2 h-2 rounded-full bg-emerald-500"></span>
      <span>🛡️ Creates Sales Order requirement</span>
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
    subtitle: 'Book customer requirement and establish fulfillment delivery baseline',
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
          const lineTotEl = row.querySelector('.so-line-total');
          if (lineTotEl) lineTotEl.textContent = `Rs. ${lineTot.toLocaleString()}`;
        });
        if (totalDisplay) totalDisplay.textContent = `Rs. ${total.toLocaleString()}`;
      };

      const bindRowEvents = (row) => {
        const select = row.querySelector('.so-var-select');
        const priceInput = row.querySelector('.so-price-input');
        const qtyInput = row.querySelector('.so-qty-input');
        const removeBtn = row.querySelector('.so-remove-row');

        if (select && priceInput) {
          select.onchange = () => {
            const opt = select.options[select.selectedIndex];
            priceInput.value = opt.getAttribute('data-price') || 0;
            recalcTotals();
          };
        }
        if (qtyInput) qtyInput.oninput = recalcTotals;
        if (priceInput) priceInput.oninput = recalcTotals;
        if (removeBtn) {
          removeBtn.onclick = () => {
            if (tbody.querySelectorAll('.so-line-row').length > 1) {
              row.remove();
              recalcTotals();
            } else {
              toast.show('An order must have at least one line item.', 'warning');
            }
          };
        }
      };

      tbody.querySelectorAll('.so-line-row').forEach(bindRowEvents);
      recalcTotals();

      const addLineBtn = modalEl.querySelector('#so-add-line-btn');
      if (addLineBtn) {
        addLineBtn.onclick = () => {
          const tr = document.createElement('tr');
          tr.className = 'so-line-row';
          tr.innerHTML = `
            <td class="p-3">
              <select class="so-var-select w-full border border-slate-200 rounded-xl px-2.5 py-1.5 text-xs text-slate-800 font-semibold focus:border-[#138FCB]">
                ${variants.map(v => `<option value="${v.id}" data-price="${v.sellingPrice || 0}">${v.name} (${v.sku})</option>`).join('')}
              </select>
            </td>
            <td class="p-3 text-center">
              <input type="number" min="1" value="1" class="so-qty-input w-20 text-center border border-slate-200 rounded-xl px-2 py-1.5 text-xs font-bold">
            </td>
            <td class="p-3 text-center">
              <input type="number" min="0" step="any" value="${variants[0]?.sellingPrice || 0}" class="so-price-input w-28 text-center border border-slate-200 rounded-xl px-2 py-1.5 text-xs font-bold">
            </td>
            <td class="p-3 text-right font-black text-slate-900 text-xs so-line-total">
              Rs. ${(variants[0]?.sellingPrice || 0).toLocaleString()}
            </td>
            <td class="p-3 text-center">
              <button type="button" class="so-remove-row text-slate-400 hover:text-rose-600 font-bold p-1 cursor-pointer">✕</button>
            </td>
          `;
          tbody.appendChild(tr);
          bindRowEvents(tr);
          recalcTotals();
        };
      }

      const form = modalEl.querySelector('#create-so-form');
      if (form) {
        form.onsubmit = (e) => {
          e.preventDefault();
          const customerPartyId = modalEl.querySelector('#so-customer-select').value;
          const farmId = modalEl.querySelector('#so-farm-select').value;
          const date = modalEl.querySelector('#so-date').value;
          const notes = modalEl.querySelector('#so-notes').value.trim();

          const lines = [];
          tbody.querySelectorAll('.so-line-row').forEach(row => {
            const variantId = row.querySelector('.so-var-select').value;
            const orderedQty = Number(row.querySelector('.so-qty-input').value) || 0;
            const unitPrice = Number(row.querySelector('.so-price-input').value) || 0;
            if (orderedQty > 0) {
              lines.push({ variantId, orderedQty, unitPrice });
            }
          });

          if (lines.length === 0) {
            toast.show('Please add at least one line item with quantity.', 'warning');
            return;
          }

          try {
            const so = salesService.createSalesOrder({
              customerPartyId,
              farmId,
              date,
              notes,
              lines
            });
            toast.show(`Sales Order ${so.orderNumber} booked successfully!`, 'success');
            closeModal();
            if (onSaved) onSaved();
          } catch (err) {
            toast.show(err.message, 'error');
          }
        };
      }
    }
  });
}
