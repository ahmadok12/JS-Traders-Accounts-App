/**
 * JS Traders ERP - Stock Inward Orders View (Incoming Stock Demand)
 * 
 * Core Design Principles:
 * 1. Represents stock expected to enter the warehouse.
 * 2. Does NOT increase physical warehouse inventory (pure demand document).
 * 3. Each line tracks independently: Expected Qty, Received Qty, Remaining Qty.
 * 4. Primary action [Create GRN / Inward] creates Gatepass Inward with remaining quantities.
 * 5. Full traceability of all linked GRNs per Inward Order.
 * 6. Completely decoupled from accounting: generic party and optional source_type.
 */

import { inwardOrderService } from '../../services/inwardOrderService.js';
import { gatepassService } from '../../services/gatepassService.js';
import { productService } from '../../services/productService.js';
import { storageService } from '../../services/storageService.js';
import { renderTable, bindTableActions } from '../../components/table.js';
import { renderFilterBar } from '../../components/filters.js';
import { openModal, closeModal } from '../../components/modal.js';
import { confirmAction } from '../../components/confirmation.js';
import { toast } from '../../components/toast.js';

export function renderInwardOrdersView() {
  const orders = inwardOrderService.getInwardOrders();
  const warehouses = storageService.getCollection('warehouses') || [];
  const whMap = new Map(warehouses.map(w => [w.id, w.name]));

  const filterBarHtml = renderFilterBar({
    searchPlaceholder: 'Search inward orders by SIO #, supplier/party, ref...',
    dropdowns: [
      {
        id: 'sio-status-filter',
        label: 'Status',
        value: 'all',
        options: [
          { value: 'all', label: 'All Statuses' },
          { value: 'Confirmed', label: 'Confirmed (Pending Receipt)' },
          { value: 'Partially Received', label: 'Partially Received' },
          { value: 'Fully Received', label: 'Fully Received' },
          { value: 'Draft', label: 'Draft' },
          { value: 'Cancelled', label: 'Cancelled' }
        ]
      }
    ],
    primaryAction: { label: '+ New Stock Inward Order' }
  });

  const columns = [
    {
      key: 'orderNumber',
      label: 'Inward Order #',
      render: row => `<span class="font-bold text-[#138FCB] font-mono">${row.orderNumber}</span>`
    },
    {
      key: 'partyName',
      label: 'Supplier / Origin',
      render: row => `
        <div>
          <div class="font-bold text-slate-800">${row.partyName || 'Supplier / Origin'}</div>
          <div class="text-[10px] text-slate-400 font-mono">Ref: ${row.referenceNumber || 'N/A'} • Date: ${row.date || 'Today'}</div>
        </div>
      `
    },
    {
      key: 'warehouse',
      label: 'Target Facility',
      render: row => `
        <span class="px-2 py-0.5 rounded text-[11px] font-semibold bg-slate-100 text-slate-700">
          ${whMap.get(row.targetWarehouseId) || 'Warehouse'}
        </span>
      `
    },
    {
      key: 'receiptProgress',
      label: 'Receipt Progress (GRNs)',
      render: row => {
        let totalExp = 0;
        let totalRec = 0;
        (row.lines || []).forEach(l => {
          totalExp += (Number(l.expectedQty) || 0);
          totalRec += (Number(l.receivedQty) || 0);
        });
        const remaining = Math.max(0, totalExp - totalRec);
        const pct = totalExp > 0 ? Math.min(100, Math.round((totalRec / totalExp) * 100)) : 0;
        return `
          <div class="space-y-1 min-w-[130px]">
            <div class="flex items-center justify-between text-[11px] font-bold">
              <span class="text-emerald-700">${totalRec} rec</span>
              <span class="text-slate-400 font-normal">/</span>
              <span class="text-slate-800">${totalExp} exp</span>
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
      key: 'linesCount',
      label: 'Items',
      render: row => `<span class="px-2 py-0.5 rounded-lg bg-slate-100 text-slate-700 text-[10px] font-semibold">${(row.lines || []).length} Item(s)</span>`
    },
    {
      key: 'status',
      label: 'Order Status',
      render: row => `
        <span class="px-2.5 py-0.5 rounded-full text-[10px] font-bold ${
          row.status === 'Fully Received' ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' :
          row.status === 'Partially Received' ? 'bg-blue-50 text-[#138FCB] border border-blue-200' :
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
    { label: 'Create GRN', variant: 'primary' },
    { label: 'Print Voucher', variant: 'secondary' }
  ];

  const tableHtml = renderTable({
    columns,
    data: orders,
    actions,
    emptyMessage: 'No stock inward orders registered yet.'
  });

  return `
    <div id="sio-view-container" class="space-y-5 animate-in fade-in duration-150">
      ${filterBarHtml}
      <div id="sio-table-container">
        ${tableHtml}
      </div>
    </div>
  `;
}

export function bindInwardOrdersEvents(container, refreshCallback) {
  const addBtn = container.querySelector('#filter-primary-btn');
  if (addBtn) {
    addBtn.onclick = () => openCreateInwardOrderModal(refreshCallback);
  }

  const orders = inwardOrderService.getInwardOrders();
  const actions = [
    { label: 'View', variant: 'secondary', onClick: (row) => openInwardOrderDetailModal(row, refreshCallback) },
    { label: 'Create GRN', variant: 'primary', onClick: (row) => openCreateGRNModal(row, refreshCallback) },
    { label: 'Print Voucher', variant: 'secondary', onClick: (row) => printInwardOrderVoucher(row) }
  ];
  bindTableActions(container, actions, orders);

  const searchInput = container.querySelector('#filter-search-input');
  if (searchInput) {
    searchInput.oninput = (e) => {
      const q = e.target.value.toLowerCase().trim();
      const filtered = orders.filter(o =>
        (o.orderNumber && o.orderNumber.toLowerCase().includes(q)) ||
        (o.partyName && o.partyName.toLowerCase().includes(q)) ||
        (o.referenceNumber && o.referenceNumber.toLowerCase().includes(q)) ||
        (o.notes && o.notes.toLowerCase().includes(q))
      );
      updateInwardOrdersTable(container, filtered, refreshCallback);
    };
  }

  const statusFilter = container.querySelector('#sio-status-filter');
  if (statusFilter) {
    statusFilter.onchange = (e) => {
      const val = e.target.value;
      const filtered = val === 'all' ? orders : orders.filter(o => o.status === val);
      updateInwardOrdersTable(container, filtered, refreshCallback);
    };
  }
}

function updateInwardOrdersTable(container, filteredData, refreshCallback) {
  const tableContainer = container.querySelector('#sio-table-container');
  if (!tableContainer) return;

  const warehouses = storageService.getCollection('warehouses') || [];
  const whMap = new Map(warehouses.map(w => [w.id, w.name]));

  const columns = [
    { key: 'orderNumber', label: 'Inward Order #', render: row => `<span class="font-bold text-[#138FCB] font-mono">${row.orderNumber}</span>` },
    {
      key: 'partyName',
      label: 'Supplier / Origin',
      render: row => `
        <div>
          <div class="font-bold text-slate-800">${row.partyName || 'Supplier / Origin'}</div>
          <div class="text-[10px] text-slate-400 font-mono">Ref: ${row.referenceNumber || 'N/A'} • Date: ${row.date || 'Today'}</div>
        </div>
      `
    },
    {
      key: 'warehouse',
      label: 'Target Facility',
      render: row => `<span class="px-2 py-0.5 rounded text-[11px] font-semibold bg-slate-100 text-slate-700">${whMap.get(row.targetWarehouseId) || 'Warehouse'}</span>`
    },
    {
      key: 'receiptProgress',
      label: 'Receipt Progress (GRNs)',
      render: row => {
        let totalExp = 0;
        let totalRec = 0;
        (row.lines || []).forEach(l => {
          totalExp += (Number(l.expectedQty) || 0);
          totalRec += (Number(l.receivedQty) || 0);
        });
        const remaining = Math.max(0, totalExp - totalRec);
        const pct = totalExp > 0 ? Math.min(100, Math.round((totalRec / totalExp) * 100)) : 0;
        return `
          <div class="space-y-1 min-w-[130px]">
            <div class="flex items-center justify-between text-[11px] font-bold">
              <span class="text-emerald-700">${totalRec} rec</span>
              <span class="text-slate-400 font-normal">/</span>
              <span class="text-slate-800">${totalExp} exp</span>
              ${remaining > 0 ? `<span class="text-blue-600 text-[10px]">(${remaining} left)</span>` : ''}
            </div>
            <div class="w-full bg-slate-100 rounded-full h-1.5 overflow-hidden">
              <div class="h-full ${pct === 100 ? 'bg-emerald-500' : pct > 0 ? 'bg-blue-500' : 'bg-slate-300'}" style="width: ${pct}%"></div>
            </div>
          </div>
        `;
      }
    },
    { key: 'linesCount', label: 'Items', render: row => `<span class="px-2 py-0.5 rounded-lg bg-slate-100 text-slate-700 text-[10px] font-semibold">${(row.lines || []).length} Item(s)</span>` },
    {
      key: 'status',
      label: 'Order Status',
      render: row => `
        <span class="px-2.5 py-0.5 rounded-full text-[10px] font-bold ${
          row.status === 'Fully Received' ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' :
          row.status === 'Partially Received' ? 'bg-blue-50 text-[#138FCB] border border-blue-200' :
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
    { label: 'View', variant: 'secondary', onClick: (row) => openInwardOrderDetailModal(row, refreshCallback) },
    { label: 'Create GRN', variant: 'primary', onClick: (row) => openCreateGRNModal(row, refreshCallback) },
    { label: 'Print Voucher', variant: 'secondary', onClick: (row) => printInwardOrderVoucher(row) }
  ];

  tableContainer.innerHTML = renderTable({ columns, data: filteredData, actions });
  bindTableActions(tableContainer, actions, filteredData);
}

export function openInwardOrderDetailModal(order, refreshCallback) {
  const variants = productService.getVariants();
  const varMap = new Map(variants.map(v => [v.id, v.name]));
  const warehouses = storageService.getCollection('warehouses') || [];
  const whMap = new Map(warehouses.map(w => [w.id, w.name]));
  const isCancelled = order.status === 'Cancelled';
  const remainingLines = inwardOrderService.getRemainingExpectedLines(order.id);
  const linkedGRNs = gatepassService.getGRNsByInwardOrder(order.id);

  const contentHtml = `
    <div class="space-y-6 text-xs">
      <!-- SECTION 1: Order Header Overview -->
      <section class="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-xs space-y-4">
        <div class="flex items-center justify-between border-b border-slate-100 pb-3">
          <h3 class="text-xs font-bold uppercase tracking-wider text-slate-700 flex items-center gap-2">
            <span>📥</span>
            <span>1. Stock Inward Order Details</span>
          </h3>
          <span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-bold ${
            order.status === 'Fully Received' ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' :
            order.status === 'Partially Received' ? 'bg-blue-50 text-[#138FCB] border border-blue-200' :
            isCancelled ? 'bg-rose-50 text-rose-700 border border-rose-200' :
            'bg-amber-50 text-amber-700 border border-amber-200'
          }">
            ${order.status}
          </span>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div class="p-3 bg-slate-50/70 rounded-xl border border-slate-200/70 space-y-1">
            <span class="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Supplier / Origin</span>
            <p class="text-sm font-bold text-slate-900">${order.partyName || 'Supplier / Origin'}</p>
            <p class="text-[11px] text-slate-500">Ref: ${order.referenceNumber || 'N/A'}</p>
          </div>

          <div class="p-3 bg-slate-50/70 rounded-xl border border-slate-200/70 space-y-1">
            <span class="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Order Info</span>
            <p class="text-sm font-bold text-slate-800">${order.orderNumber}</p>
            <p class="text-[11px] text-slate-500">Date: ${order.date || 'Today'}</p>
          </div>

          <div class="p-3 bg-blue-50/50 rounded-xl border border-blue-200/70 space-y-1 text-right">
            <span class="text-[10px] font-bold text-[#138FCB] uppercase tracking-wider block">Target Facility</span>
            <p class="text-base font-extrabold text-slate-900">${whMap.get(order.targetWarehouseId) || 'Warehouse'}</p>
            <p class="text-[10px] text-slate-500">Stock increases on GRN verification</p>
          </div>
        </div>
      </section>

      <!-- SECTION 2: Order Line Items -->
      <section class="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-xs space-y-4">
        <div class="flex items-center justify-between border-b border-slate-100 pb-3">
          <h3 class="text-xs font-bold uppercase tracking-wider text-slate-700 flex items-center gap-2">
            <span>📦</span>
            <span>2. Expected Items &amp; Receipt Tracking</span>
          </h3>
          <span class="text-[10px] text-slate-400 font-semibold">${(order.lines || []).length} Item(s)</span>
        </div>

        <div class="border border-slate-200/80 rounded-xl overflow-hidden">
          <table class="w-full text-left text-xs">
            <thead class="bg-slate-50 text-[10px] uppercase font-bold text-slate-500 border-b border-slate-200">
              <tr>
                <th class="py-2.5 px-3">Item Variant</th>
                <th class="py-2.5 px-3 text-center">Expected Qty</th>
                <th class="py-2.5 px-3 text-center text-emerald-700 font-bold">Received Qty</th>
                <th class="py-2.5 px-3 text-center text-blue-600 font-bold">Remaining Expected</th>
                <th class="py-2.5 px-3">Notes</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-slate-100">
              ${(order.lines || []).map(l => {
                const exp = Number(l.expectedQty) || 0;
                const rec = Number(l.receivedQty) || 0;
                const rem = Math.max(0, exp - rec);
                return `
                  <tr class="hover:bg-slate-50/70">
                    <td class="py-3 px-3 font-semibold text-slate-800">${varMap.get(l.variantId) || 'Item'}</td>
                    <td class="py-3 px-3 text-center font-bold text-slate-800">${exp} ${l.unit || 'PCS'}</td>
                    <td class="py-3 px-3 text-center text-emerald-600 font-bold">${rec}</td>
                    <td class="py-3 px-3 text-center ${rem > 0 ? 'text-blue-600 font-extrabold' : 'text-slate-400'}">${rem}</td>
                    <td class="py-3 px-3 text-slate-500">${l.notes || '—'}</td>
                  </tr>
                `;
              }).join('')}
            </tbody>
          </table>
        </div>
      </section>

      <!-- SECTION 3: Linked Receipts (Gatepass Inward / GRNs) -->
      <section class="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-xs space-y-4">
        <div class="flex items-center justify-between border-b border-slate-100 pb-3">
          <h3 class="text-xs font-bold uppercase tracking-wider text-slate-700 flex items-center gap-2">
            <span>📋</span>
            <span>3. Linked Gatepass Inward Receipts (${linkedGRNs.length})</span>
          </h3>
          <span class="text-[10px] text-slate-400 font-semibold">Physical stock added upon GRN approval</span>
        </div>

        ${linkedGRNs.length === 0 ? `
          <div class="p-4 bg-slate-50/60 rounded-xl text-center text-slate-400">
            No inward receipts recorded against this order yet.
          </div>
        ` : `
          <div class="border border-slate-200/80 rounded-xl overflow-hidden">
            <table class="w-full text-left text-xs">
              <thead class="bg-slate-50 text-[10px] uppercase font-bold text-slate-500 border-b border-slate-200">
                <tr>
                  <th class="py-2 px-3">GRN Number</th>
                  <th class="py-2 px-3">Date</th>
                  <th class="py-2 px-3">Vehicle &amp; Carrier</th>
                  <th class="py-2 px-3 text-center">Items Received</th>
                  <th class="py-2 px-3 text-right">Status</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-slate-100">
                ${linkedGRNs.map(g => {
                  const itemsCount = (g.lines || []).reduce((s, l) => s + (Number(l.quantity) || 0), 0);
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
      <span>🛡️ Warehouse Inward Order Management</span>
    </div>
    <div class="flex flex-col sm:flex-row items-center justify-between w-full sm:w-auto gap-3">
      <div>
        ${!isCancelled ? `
          <button id="sio-void-btn" type="button" class="inline-flex items-center space-x-1.5 px-3.5 py-2 text-xs font-bold text-rose-600 hover:text-rose-700 bg-rose-50 hover:bg-rose-100 border border-rose-200 rounded-xl transition-colors cursor-pointer">
            <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path>
            </svg>
            <span>Cancel Inward Order</span>
          </button>
        ` : `
          <span class="text-xs font-bold text-rose-600 bg-rose-50 border border-rose-200 px-3 py-1.5 rounded-xl inline-flex items-center gap-1.5">
            Order Cancelled
          </span>
        `}
      </div>
      <div class="flex items-center space-x-3">
        <button id="sio-close-btn" type="button" class="px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100 rounded-xl transition-colors border border-slate-200 cursor-pointer">
          Close
        </button>
        <button id="sio-print-btn" type="button" class="inline-flex items-center space-x-1.5 px-4 py-2 text-xs font-bold text-slate-700 bg-white hover:bg-slate-50 border border-slate-200 rounded-xl transition-all cursor-pointer shadow-2xs">
          <span>🖨️ Print Voucher</span>
        </button>
        ${!isCancelled && remainingLines.length > 0 ? `
          <button id="sio-create-grn-btn" type="button" class="inline-flex items-center space-x-2 px-4 py-2 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 rounded-xl shadow-xs transition-all cursor-pointer">
            <span>📥 Create GRN / Inward</span>
          </button>
        ` : ''}
      </div>
    </div>
  `;

  openModal({
    title: `Stock Inward Order: ${order.orderNumber}`,
    subtitle: 'Expected incoming stock demand, receipt progress, and linked GRNs',
    badge: order.orderNumber,
    contentHtml,
    footerHtml,
    size: 'max-w-4xl',
    onOpen: (modalEl) => {
      const closeBtn = modalEl.querySelector('#sio-close-btn');
      if (closeBtn) closeBtn.onclick = () => closeModal();

      const printBtn = modalEl.querySelector('#sio-print-btn');
      if (printBtn) {
        printBtn.onclick = () => {
          printInwardOrderVoucher(order);
        };
      }

      const createGrnBtn = modalEl.querySelector('#sio-create-grn-btn');
      if (createGrnBtn) {
        createGrnBtn.onclick = () => {
          closeModal();
          openCreateGRNModal(order, refreshCallback);
        };
      }

      const voidBtn = modalEl.querySelector('#sio-void-btn');
      if (voidBtn) {
        voidBtn.onclick = () => {
          confirmAction({
            title: `Cancel Stock Inward Order: ${order.orderNumber}`,
            message: 'Are you sure you want to cancel this Stock Inward Order? Pending expected items will no longer be available for receipt.',
            confirmLabel: 'Yes, Cancel Order',
            isDestructive: true,
            onConfirm: () => {
              try {
                inwardOrderService.cancelInwardOrder(order.id);
                toast.show(`Stock Inward Order ${order.orderNumber} cancelled.`, 'success');
                closeModal();
                if (refreshCallback) refreshCallback();
              } catch (err) {
                toast.show(err.message, 'error');
              }
            }
          });
        };
      }
    }
  });
}

export function openCreateGRNModal(order, onSaved) {
  const remainingLines = inwardOrderService.getRemainingExpectedLines(order.id);
  if (remainingLines.length === 0) {
    toast.show('This Stock Inward Order has already been fully received.', 'warning');
    return;
  }
  const variants = productService.getVariants();
  const varMap = new Map(variants.map(v => [v.id, v]));
  const warehouses = storageService.getCollection('warehouses') || [];

  const contentHtml = `
    <form id="create-grn-form" class="space-y-4 text-xs">
      <div class="bg-emerald-50/70 p-3.5 rounded-2xl border border-emerald-200/80 flex justify-between items-center">
        <div>
          <span class="text-[10px] font-bold uppercase tracking-wider text-emerald-700">Originating Inward Demand</span>
          <h4 class="text-sm font-extrabold text-slate-800 font-mono">${order.orderNumber}</h4>
          <span class="text-[11px] text-slate-500 font-medium">Party: <strong>${order.partyName || 'Supplier'}</strong></span>
        </div>
        <span class="px-2.5 py-1 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-200">
          ${remainingLines.length} Item(s) Pending Receipt
        </span>
      </div>

      <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div>
          <label class="block font-bold text-slate-700 mb-1">Receiving Facility <span class="text-rose-500">*</span></label>
          <select id="grn-warehouse-select" class="w-full px-3 py-2 border border-slate-200 rounded-xl focus:outline-none focus:border-emerald-600 font-semibold text-slate-800 shadow-2xs">
            ${warehouses.map(w => `<option value="${w.id}" ${w.id === order.targetWarehouseId ? 'selected' : ''}>${w.name} (${w.city || ''})</option>`).join('')}
          </select>
        </div>
        <div>
          <label class="block font-bold text-slate-700 mb-1">Vehicle / Carrier #</label>
          <input type="text" id="grn-vehicle-input" placeholder="e.g. LES-4029 Truck" value="LES-4029 Truck" class="w-full px-3 py-2 border border-slate-200 rounded-xl focus:outline-none focus:border-emerald-600 font-mono text-slate-800 shadow-2xs">
        </div>
        <div>
          <label class="block font-bold text-slate-700 mb-1">Driver / Transporter</label>
          <input type="text" id="grn-driver-input" placeholder="e.g. Tariq Mehmood" value="Tariq Mehmood" class="w-full px-3 py-2 border border-slate-200 rounded-xl focus:outline-none focus:border-emerald-600 text-slate-800 shadow-2xs">
        </div>
      </div>

      <!-- Line Quantities Table -->
      <div class="border border-slate-200/80 rounded-xl overflow-hidden">
        <table class="w-full text-left text-xs">
          <thead class="bg-slate-50 text-[10px] uppercase font-bold text-slate-500 border-b border-slate-200">
            <tr>
              <th class="py-2.5 px-3">Item Variant</th>
              <th class="py-2.5 px-3 text-center">Expected</th>
              <th class="py-2.5 px-3 text-center text-emerald-700 font-bold">Received</th>
              <th class="py-2.5 px-3 text-center text-blue-600 font-bold">Remaining</th>
              <th class="py-2.5 px-3 text-center w-32 text-emerald-800 font-bold">Receive Now</th>
            </tr>
          </thead>
          <tbody id="grn-lines-tbody" class="divide-y divide-slate-100">
            ${remainingLines.map(line => {
              const v = varMap.get(line.variantId) || {};
              return `
                <tr class="hover:bg-slate-50/70" data-variant-id="${line.variantId}" data-remaining="${line.remainingQty}">
                  <td class="py-2.5 px-3 font-semibold text-slate-800">
                    <div>${v.name || 'Item'}</div>
                    <div class="text-[10px] text-slate-400 font-mono">${v.sku || ''}</div>
                  </td>
                  <td class="py-2.5 px-3 text-center text-slate-600">${line.expectedQty}</td>
                  <td class="py-2.5 px-3 text-center text-emerald-600 font-bold">${line.receivedQty}</td>
                  <td class="py-2.5 px-3 text-center font-bold text-blue-600">${line.remainingQty} ${line.unit}</td>
                  <td class="py-2.5 px-3 text-center">
                    <input type="number" min="0" value="${line.remainingQty}" class="grn-line-qty w-24 text-center border border-emerald-300 rounded-xl px-2 py-1.5 text-xs font-bold focus:border-emerald-600 shadow-2xs bg-emerald-50/40">
                  </td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      </div>

      <div>
        <label class="block font-bold text-slate-700 mb-1">Receipt Inspection Notes / Packaging Verification</label>
        <textarea id="grn-notes-input" rows="2" placeholder="Packaging condition intact, verified physical piece count..." class="w-full px-3 py-2 border border-slate-200 rounded-xl focus:outline-none focus:border-emerald-600 text-slate-800 shadow-2xs resize-none"></textarea>
      </div>
    </form>
  `;

  const footerHtml = `
    <div class="flex items-center space-x-2 text-xs text-slate-400">
      <span class="w-2 h-2 rounded-full bg-emerald-500"></span>
      <span>🛡️ Inward stock is added only after gatepass approval</span>
    </div>
    <div class="flex items-center space-x-3 w-full sm:w-auto justify-end">
      <button id="grn-cancel-btn" type="button" class="px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100 rounded-xl transition-colors border border-slate-200 cursor-pointer">
        Cancel
      </button>
      <button id="grn-submit-btn" type="button" class="inline-flex items-center space-x-2 px-5 py-2.5 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 rounded-xl shadow-xs transition-all active:scale-[0.98] cursor-pointer">
        <span>📥 Issue Gatepass Inward (GRN)</span>
      </button>
    </div>
  `;

  openModal({
    title: `Create Gatepass Inward (GRN): ${order.orderNumber}`,
    subtitle: 'Receive physical stock against pending expected stock inward requirements',
    badge: 'GRN-NEW',
    contentHtml,
    footerHtml,
    size: 'max-w-2xl',
    onOpen: (modalEl) => {
      modalEl.querySelector('#grn-cancel-btn').onclick = () => closeModal();

      modalEl.querySelector('#grn-submit-btn').onclick = () => {
        const selectedWh = modalEl.querySelector('#grn-warehouse-select').value;
        const vehicle = modalEl.querySelector('#grn-vehicle-input').value.trim();
        const driver = modalEl.querySelector('#grn-driver-input').value.trim();
        const notes = modalEl.querySelector('#grn-notes-input').value.trim();

        const lines = [];

        modalEl.querySelectorAll('#grn-lines-tbody tr').forEach(tr => {
          const variantId = tr.dataset.variantId;
          const qtyInput = tr.querySelector('.grn-line-qty');
          const qty = Number(qtyInput?.value) || 0;
          if (qty > 0) {
            lines.push({
              variantId,
              warehouseQty: qty,
              officeQty: 0,
              quantity: qty,
              unit: 'PCS'
            });
          }
        });

        if (lines.length === 0) {
          toast.show('Please enter at least one quantity to receive.', 'warning');
          return;
        }

        try {
          const gp = gatepassService.createGRNFromInwardOrder(order.id, {
            warehouseId: selectedWh,
            vehicleNumber: vehicle,
            driverName: driver,
            lines,
            notes
          });
          toast.show(`Gatepass Inward ${gp.gatepassNumber} created successfully!`, 'success');
          closeModal();
          if (onSaved) onSaved();
        } catch (err) {
          toast.show(err.message, 'error');
        }
      };
    }
  });
}

export function printInwardOrderVoucher(order) {
  const variants = productService.getVariants();
  const varMap = new Map(variants.map(v => [v.id, v.name]));
  const warehouses = storageService.getCollection('warehouses') || [];
  const whMap = new Map(warehouses.map(w => [w.id, w.name]));
  const linkedGRNs = gatepassService.getGRNsByInwardOrder(order.id);

  const printWindow = window.open('', '_blank');
  if (!printWindow) {
    toast.show('Pop-up blocked. Please allow pop-ups to print voucher.', 'warning');
    return;
  }

  printWindow.document.write(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Stock Inward Order - ${order.orderNumber}</title>
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
          <div class="subtitle">Warehouse &amp; Supply Chain Inventory Operations</div>
          <div style="font-size: 11px; color: #475569; margin-top: 4px;">Plot 45-B Industrial Area, Multan Road, Lahore • Tel: +92 300 1234567</div>
        </div>
        <div style="text-align: right;">
          <div style="font-size: 20px; font-weight: 900; color: #059669;">STOCK INWARD ORDER</div>
          <div style="font-size: 13px; font-weight: 800; font-family: monospace;">${order.orderNumber}</div>
          <div style="font-size: 11px; color: #64748b;">Date: ${order.date || 'Today'}</div>
        </div>
      </div>

      <div class="grid">
        <div class="card">
          <div class="card-label">Origin / Supplier Information</div>
          <div style="font-size: 14px; font-weight: 800; color: #0f172a;">${order.partyName || 'Supplier / Origin'}</div>
          <div style="font-size: 11px; color: #475569; margin-top: 2px;">Reference #: <strong>${order.referenceNumber || 'N/A'}</strong></div>
          <div style="font-size: 11px; color: #475569;">Target Warehouse: <strong>${whMap.get(order.targetWarehouseId) || 'Main Warehouse'}</strong></div>
        </div>
        <div class="card">
          <div class="card-label">Receipt Status</div>
          <div>Status: <strong>${order.status}</strong></div>
          <div>Linked GRNs: <strong>${linkedGRNs.length} Inward Gatepass(es)</strong></div>
          <div style="font-size: 11px; color: #64748b; margin-top: 4px;">* Note: Stock is incremented upon physical Gatepass Inward verification.</div>
        </div>
      </div>

      <table>
        <thead>
          <tr>
            <th>#</th>
            <th>Item Description</th>
            <th class="text-center">Expected Qty</th>
            <th class="text-center">Received Qty</th>
            <th class="text-center">Remaining</th>
            <th>Item Notes / Specifications</th>
          </tr>
        </thead>
        <tbody>
          ${(order.lines || []).map((l, i) => {
            const exp = Number(l.expectedQty) || 0;
            const rec = Number(l.receivedQty) || 0;
            const rem = Math.max(0, exp - rec);
            return `
              <tr>
                <td>${i + 1}</td>
                <td><strong>${varMap.get(l.variantId) || 'Product Item'}</strong></td>
                <td class="text-center"><strong>${exp}</strong> ${l.unit || 'PCS'}</td>
                <td class="text-center" style="color: #059669; font-weight: 700;">${rec}</td>
                <td class="text-center" style="color: #2563eb; font-weight: 700;">${rem}</td>
                <td style="color: #64748b; font-size: 11px;">${l.notes || '—'}</td>
              </tr>
            `;
          }).join('')}
        </tbody>
      </table>

      ${order.notes ? `
        <div style="margin-bottom: 20px; font-size: 11px; background: #f0fdf4; border: 1px solid #dcfce7; padding: 10px; border-radius: 6px;">
          <strong>Receipt Instructions:</strong> ${order.notes}
        </div>
      ` : ''}

      <div class="signatures">
        <div>
          <div style="height: 40px;"></div>
          <div class="sig-line">Receiving Officer</div>
        </div>
        <div>
          <div style="height: 40px;"></div>
          <div class="sig-line">Warehouse In-Charge</div>
        </div>
        <div>
          <div style="height: 40px;"></div>
          <div class="sig-line">Transporter / Driver Acknowledgment</div>
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

function openCreateInwardOrderModal(onSaved) {
  const warehouses = storageService.getCollection('warehouses') || [];
  const variants = productService.getVariants();

  const contentHtml = `
    <form id="create-sio-form" class="space-y-5 text-xs">
      <section class="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-xs space-y-4">
        <div class="flex items-center justify-between border-b border-slate-100 pb-3">
          <h3 class="text-xs font-bold uppercase tracking-wider text-slate-700 flex items-center gap-2">
            <span>📥</span>
            <span>1. Supplier &amp; Origin Details</span>
          </h3>
          <span class="text-[10px] text-slate-400 font-medium">Generic incoming demand entry</span>
        </div>

        <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div class="space-y-1.5">
            <label class="text-xs font-semibold text-slate-700" for="sio-party-input">Supplier / Party / Origin <span class="text-red-500">*</span></label>
            <input type="text" id="sio-party-input" required placeholder="e.g. Qingdao Jinhe or Local Vendor" value="Qingdao Jinhe Poultry Machinery Co." class="w-full text-xs font-bold rounded-xl border border-slate-200 focus:border-[#138FCB] py-2.5 px-3 text-slate-800 bg-white shadow-2xs">
          </div>

          <div class="space-y-1.5">
            <label class="text-xs font-semibold text-slate-700" for="sio-ref-input">Reference / Consignment #</label>
            <input type="text" id="sio-ref-input" placeholder="e.g. BL-TXZJ-829104 or PO-102" value="REF-IMPORT-${Date.now().toString().slice(-4)}" class="w-full text-xs font-mono rounded-xl border border-slate-200 focus:border-[#138FCB] py-2.5 px-3 text-slate-800 bg-white shadow-2xs">
          </div>

          <div class="space-y-1.5">
            <label class="text-xs font-semibold text-slate-700" for="sio-wh-select">Destination Warehouse <span class="text-red-500">*</span></label>
            <select id="sio-wh-select" class="w-full text-xs font-semibold rounded-xl border border-slate-200 focus:border-[#138FCB] py-2.5 px-3 text-slate-800 bg-white shadow-2xs">
              ${warehouses.map(w => `<option value="${w.id}">${w.name} (${w.city || ''})</option>`).join('')}
            </select>
          </div>
        </div>
      </section>

      <!-- Expected Lines Section -->
      <section class="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-xs space-y-4">
        <div class="flex items-center justify-between border-b border-slate-100 pb-3">
          <h3 class="text-xs font-bold uppercase tracking-wider text-slate-700 flex items-center gap-2">
            <span>📦</span>
            <span>2. Expected Stock Lines</span>
          </h3>
          <button type="button" id="sio-add-line-btn" class="px-3 py-1.5 bg-blue-50 text-[#138FCB] font-bold rounded-xl border border-blue-200 hover:bg-blue-100 text-xs shadow-2xs cursor-pointer">
            + Add Item Line
          </button>
        </div>

        <div class="border border-slate-200/80 rounded-xl overflow-hidden">
          <table class="w-full text-left text-xs">
            <thead class="bg-slate-50 text-[10px] uppercase font-bold text-slate-500 border-b border-slate-200">
              <tr>
                <th class="py-2.5 px-3 w-5/12">Product Variant</th>
                <th class="py-2.5 px-3 text-center w-3/12">Expected Qty</th>
                <th class="py-2.5 px-3 w-3/12">Notes / Batch #</th>
                <th class="py-2.5 px-2 text-center w-1/12"></th>
              </tr>
            </thead>
            <tbody id="sio-lines-tbody" class="divide-y divide-slate-100">
              <tr class="sio-line-row">
                <td class="p-3">
                  <select class="sio-var-select w-full border border-slate-200 rounded-xl px-2.5 py-1.5 text-xs text-slate-800 font-semibold focus:border-[#138FCB]">
                    ${variants.map(v => `<option value="${v.id}">${v.name} (${v.sku})</option>`).join('')}
                  </select>
                </td>
                <td class="p-3 text-center">
                  <input type="number" min="1" value="50" class="sio-qty-input w-24 text-center border border-slate-200 rounded-xl px-2 py-1.5 text-xs font-bold">
                </td>
                <td class="p-3">
                  <input type="text" placeholder="e.g. Lot 1 inspection" class="sio-notes-input w-full border border-slate-200 rounded-xl px-2.5 py-1.5 text-xs text-slate-700">
                </td>
                <td class="p-3 text-center">
                  <button type="button" class="sio-remove-row text-slate-400 hover:text-rose-600 font-bold p-1 cursor-pointer">✕</button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <!-- Notes Section -->
      <section class="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-xs space-y-2">
        <label class="text-xs font-semibold text-slate-700" for="sio-notes">Order Notes / Expected Delivery Window</label>
        <textarea id="sio-notes" rows="2" placeholder="Container arrival ETA, offloading bay instructions..." class="w-full text-xs rounded-xl border border-slate-200 focus:border-[#138FCB] p-3 text-slate-800 bg-white shadow-2xs resize-none"></textarea>
      </section>
    </form>
  `;

  const footerHtml = `
    <div class="flex items-center space-x-2 text-xs text-slate-400">
      <span class="w-2 h-2 rounded-full bg-emerald-500"></span>
      <span>🛡️ Creates Inward Order (No stock movement until GRN verified)</span>
    </div>
    <div class="flex items-center space-x-3 w-full sm:w-auto justify-end">
      <button id="sio-cancel-btn" type="button" class="px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100 rounded-xl transition-colors border border-slate-200 cursor-pointer">
        Cancel
      </button>
      <button type="submit" form="create-sio-form" class="inline-flex items-center space-x-2 px-5 py-2.5 text-xs font-bold text-white bg-[#138FCB] hover:bg-[#0E78AC] rounded-xl shadow-xs transition-all active:scale-[0.98] cursor-pointer">
        <span>Save Stock Inward Order</span>
      </button>
    </div>
  `;

  openModal({
    title: 'New Stock Inward Order',
    subtitle: 'Register expected inbound goods demand for warehouse verification and putaway',
    badge: 'SIO-NEW',
    contentHtml,
    footerHtml,
    size: 'max-w-4xl',
    onOpen: (modalEl) => {
      const cancelBtn = modalEl.querySelector('#sio-cancel-btn');
      if (cancelBtn) cancelBtn.onclick = () => closeModal();

      const tbody = modalEl.querySelector('#sio-lines-tbody');

      const bindRowEvents = (row) => {
        const removeBtn = row.querySelector('.sio-remove-row');
        if (removeBtn) {
          removeBtn.onclick = () => {
            if (tbody.querySelectorAll('.sio-line-row').length > 1) {
              row.remove();
            } else {
              toast.show('Inward order must have at least one line item.', 'warning');
            }
          };
        }
      };

      tbody.querySelectorAll('.sio-line-row').forEach(bindRowEvents);

      const addLineBtn = modalEl.querySelector('#sio-add-line-btn');
      if (addLineBtn) {
        addLineBtn.onclick = () => {
          const tr = document.createElement('tr');
          tr.className = 'sio-line-row';
          tr.innerHTML = `
            <td class="p-3">
              <select class="sio-var-select w-full border border-slate-200 rounded-xl px-2.5 py-1.5 text-xs text-slate-800 font-semibold focus:border-[#138FCB]">
                ${variants.map(v => `<option value="${v.id}">${v.name} (${v.sku})</option>`).join('')}
              </select>
            </td>
            <td class="p-3 text-center">
              <input type="number" min="1" value="20" class="sio-qty-input w-24 text-center border border-slate-200 rounded-xl px-2 py-1.5 text-xs font-bold">
            </td>
            <td class="p-3">
              <input type="text" placeholder="e.g. Lot notes" class="sio-notes-input w-full border border-slate-200 rounded-xl px-2.5 py-1.5 text-xs text-slate-700">
            </td>
            <td class="p-3 text-center">
              <button type="button" class="sio-remove-row text-slate-400 hover:text-rose-600 font-bold p-1 cursor-pointer">✕</button>
            </td>
          `;
          tbody.appendChild(tr);
          bindRowEvents(tr);
        };
      }

      const form = modalEl.querySelector('#create-sio-form');
      if (form) {
        form.onsubmit = (e) => {
          e.preventDefault();
          const partyName = modalEl.querySelector('#sio-party-input').value.trim();
          const referenceNumber = modalEl.querySelector('#sio-ref-input').value.trim();
          const targetWarehouseId = modalEl.querySelector('#sio-wh-select').value;
          const notes = modalEl.querySelector('#sio-notes').value.trim();

          const lines = [];
          tbody.querySelectorAll('.sio-line-row').forEach(row => {
            const variantId = row.querySelector('.sio-var-select').value;
            const expectedQty = Number(row.querySelector('.sio-qty-input').value) || 0;
            const lineNotes = row.querySelector('.sio-notes-input').value.trim();
            if (expectedQty > 0) {
              lines.push({ variantId, expectedQty, notes: lineNotes });
            }
          });

          if (lines.length === 0) {
            toast.show('Please enter at least one expected item with quantity.', 'warning');
            return;
          }

          try {
            const sio = inwardOrderService.createInwardOrder({
              partyName,
              referenceNumber,
              targetWarehouseId,
              notes,
              lines
            });
            toast.show(`Stock Inward Order ${sio.orderNumber} created!`, 'success');
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
