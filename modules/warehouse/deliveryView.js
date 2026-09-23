/**
 * JS Traders ERP - Delivery View (Warehouse Dispatch)
 * Implements strict separation:
 * Stock is deducted ONLY when Delivery is Confirmed.
 * Invoices and Sales Orders NEVER deduct stock.
 */

import { deliveryService } from '../../services/deliveryService.js';
import { salesService } from '../../services/salesService.js';
import { warehouseService } from '../../services/warehouseService.js';
import { productService } from '../../services/productService.js';
import { authService } from '../../services/authService.js';
import { renderTable, bindTableActions } from '../../components/table.js';
import { renderFilterBar } from '../../components/filters.js';
import { openModal, closeModal } from '../../components/modal.js';
import { confirmAction } from '../../components/confirmation.js';
import { toast } from '../../components/toast.js';

export function renderDeliveryView() {
  const deliveries = deliveryService.getDeliveries();
  const parties = salesService.getParties(true);
  const warehouses = warehouseService.getWarehouses();
  const variants = productService.getVariants();

  const partyMap = new Map(parties.map(p => [p.id, p.name]));
  const whMap = new Map(warehouses.map(w => [w.id, w.name]));
  const varMap = new Map(variants.map(v => [v.id, v.name]));

  const filterBarHtml = renderFilterBar({
    searchPlaceholder: 'Search deliveries by number, vehicle, customer...',
    primaryAction: { label: '+ Prepare Delivery' }
  });

  const columns = [
    {
      key: 'deliveryNumber',
      label: 'Delivery #',
      render: row => `<span class="font-bold text-[#138FCB] font-mono">${row.deliveryNumber}</span>`
    },
    {
      key: 'customerPartyId',
      label: 'Customer / Farm',
      render: row => `
        <div>
          <div class="font-semibold text-slate-800">${partyMap.get(row.customerPartyId) || 'Customer'}</div>
          <div class="text-[10px] text-slate-500 font-mono">SO: ${row.salesOrderId || 'Direct'}</div>
        </div>
      `
    },
    {
      key: 'warehouseId',
      label: 'Warehouse',
      render: row => `<span class="px-2 py-0.5 rounded-lg bg-slate-100 text-slate-700 text-[10px] font-semibold">${whMap.get(row.warehouseId) || 'Main Warehouse'}</span>`
    },
    {
      key: 'items',
      label: 'Delivered Items',
      render: row => `
        <div class="space-y-0.5 text-xs">
          ${(row.lines || []).map(l => `
            <div>${varMap.get(l.variantId) || 'Variant'}: <strong class="text-slate-900">${l.deliveredQuantity} ${l.unit || 'PCS'}</strong></div>
          `).join('')}
        </div>
      `
    },
    {
      key: 'status',
      label: 'Status',
      render: row => {
        const isConfirmed = row.status === 'Confirmed';
        const isCancelled = row.status === 'Cancelled';
        return `
          <span class="px-2.5 py-0.5 rounded-full text-[10px] font-bold ${
            isConfirmed ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' :
            isCancelled ? 'bg-rose-50 text-rose-700 border border-rose-200' :
            'bg-amber-50 text-amber-700 border border-amber-200'
          }">
            ${isConfirmed ? 'Confirmed (Stock Deducted)' : row.status}
          </span>
        `;
      }
    }
  ];

  const actions = [
    { label: 'View', variant: 'secondary' },
    { label: 'Confirm', variant: 'emerald' }
  ];

  const tableHtml = renderTable({
    columns,
    data: deliveries,
    actions,
    emptyMessage: 'No deliveries recorded.'
  });

  return `
    <div id="delivery-view-container" class="space-y-5 animate-in fade-in duration-150">
      <div class="p-3.5 bg-blue-50/70 border border-blue-100 rounded-2xl flex items-center justify-between text-xs text-blue-900 shadow-2xs">
        <div class="flex items-center gap-2">
          <span>📦</span>
          <span><strong>Core ERP Inventory Rule:</strong> Stock is deducted <em>strictly</em> when a Delivery is confirmed. Sales Orders and Invoices never touch inventory balances.</span>
        </div>
      </div>

      ${filterBarHtml}
      <div id="delivery-table-container">
        ${tableHtml}
      </div>
    </div>
  `;
}

export function bindDeliveryEvents(container, refreshCallback) {
  const addBtn = container.querySelector('#filter-primary-btn');
  if (addBtn) {
    addBtn.onclick = () => openCreateDeliveryModal(refreshCallback);
  }

  const deliveries = deliveryService.getDeliveries();
  const actions = [
    { label: 'View', variant: 'secondary', onClick: (row) => openDeliveryDetailModal(row, refreshCallback) },
    { label: 'Confirm', variant: 'emerald', onClick: (row) => handleConfirmDelivery(row, refreshCallback) }
  ];
  bindTableActions(container, actions, deliveries);

  const searchInput = container.querySelector('#filter-search-input');
  if (searchInput) {
    searchInput.oninput = (e) => {
      const q = e.target.value.toLowerCase().trim();
      const parties = salesService.getParties(true);
      const partyMap = new Map(parties.map(p => [p.id, p.name]));
      const filtered = deliveries.filter(d =>
        d.deliveryNumber.toLowerCase().includes(q) ||
        (d.vehicleNumber && d.vehicleNumber.toLowerCase().includes(q)) ||
        (partyMap.get(d.customerPartyId) && partyMap.get(d.customerPartyId).toLowerCase().includes(q))
      );
      updateDeliveryTable(container, filtered, refreshCallback);
    };
  }
}

function updateDeliveryTable(container, filteredData, refreshCallback) {
  const tableContainer = container.querySelector('#delivery-table-container');
  if (!tableContainer) return;

  const parties = salesService.getParties(true);
  const warehouses = warehouseService.getWarehouses();
  const variants = productService.getVariants();
  const partyMap = new Map(parties.map(p => [p.id, p.name]));
  const whMap = new Map(warehouses.map(w => [w.id, w.name]));
  const varMap = new Map(variants.map(v => [v.id, v.name]));

  const columns = [
    { key: 'deliveryNumber', label: 'Delivery #', render: row => `<span class="font-bold text-[#138FCB] font-mono">${row.deliveryNumber}</span>` },
    {
      key: 'customerPartyId',
      label: 'Customer / Farm',
      render: row => `<div><div class="font-semibold text-slate-800">${partyMap.get(row.customerPartyId) || 'Customer'}</div><div class="text-[10px] text-slate-500 font-mono">SO: ${row.salesOrderId || 'Direct'}</div></div>`
    },
    { key: 'warehouseId', label: 'Warehouse', render: row => `<span class="px-2 py-0.5 rounded-lg bg-slate-100 text-slate-700 text-[10px] font-semibold">${whMap.get(row.warehouseId) || 'Main Warehouse'}</span>` },
    {
      key: 'items',
      label: 'Delivered Items',
      render: row => `<div class="space-y-0.5 text-xs">${(row.lines || []).map(l => `<div>${varMap.get(l.variantId) || 'Variant'}: <strong class="text-slate-900">${l.deliveredQuantity} ${l.unit || 'PCS'}</strong></div>`).join('')}</div>`
    },
    {
      key: 'status',
      label: 'Status',
      render: row => `<span class="px-2.5 py-0.5 rounded-full text-[10px] font-bold ${row.status === 'Confirmed' ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : row.status === 'Cancelled' ? 'bg-rose-50 text-rose-700 border border-rose-200' : 'bg-amber-50 text-amber-700 border border-amber-200'}">${row.status === 'Confirmed' ? 'Confirmed (Stock Deducted)' : row.status}</span>`
    }
  ];

  const actions = [
    { label: 'View', variant: 'secondary', onClick: (row) => openDeliveryDetailModal(row, refreshCallback) },
    { label: 'Confirm', variant: 'emerald', onClick: (row) => handleConfirmDelivery(row, refreshCallback) }
  ];

  tableContainer.innerHTML = renderTable({ columns, data: filteredData, actions });
  bindTableActions(tableContainer, actions, filteredData);
}

export function openDeliveryDetailModal(delivery, refreshCallback) {
  const parties = salesService.getParties(true);
  const party = parties.find(p => p.id === delivery.customerPartyId);
  const warehouses = warehouseService.getWarehouses();
  const wh = warehouses.find(w => w.id === delivery.warehouseId);
  const variants = productService.getVariants();
  const varMap = new Map(variants.map(v => [v.id, v.name]));

  const isConfirmed = delivery.status === 'Confirmed';
  const isCancelled = delivery.status === 'Cancelled';
  const totalQty = (delivery.lines || []).reduce((sum, l) => sum + (Number(l.deliveredQuantity) || 0), 0);

  const contentHtml = `
    <div class="space-y-6 text-xs">
      <!-- SECTION 1: Logistics & Dispatch Overview -->
      <section class="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-xs space-y-4">
        <div class="flex items-center justify-between border-b border-slate-100 pb-3">
          <h3 class="text-xs font-bold uppercase tracking-wider text-slate-700 flex items-center gap-2">
            <span>🚚</span>
            <span>1. Dispatch Logistics Details</span>
          </h3>
          <span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-bold ${
            isConfirmed ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' :
            isCancelled ? 'bg-rose-50 text-rose-700 border border-rose-200' :
            'bg-amber-50 text-amber-700 border border-amber-200'
          }">
            ${delivery.status}
          </span>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div class="p-3 bg-slate-50/70 rounded-xl border border-slate-200/70 space-y-1">
            <span class="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Customer / Destination</span>
            <p class="text-sm font-bold text-slate-900">${party ? party.name : 'Direct Customer'}</p>
            <p class="text-[11px] text-slate-500 font-mono">SO: ${delivery.salesOrderId || 'Direct Order'}</p>
          </div>

          <div class="p-3 bg-slate-50/70 rounded-xl border border-slate-200/70 space-y-1">
            <span class="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Dispatch Facility</span>
            <p class="text-sm font-bold text-slate-800">${wh ? wh.name : 'Main Warehouse'}</p>
            <p class="text-[11px] text-slate-500">Date: ${delivery.deliveryDate || 'Today'}</p>
          </div>

          <div class="p-3 bg-slate-50/70 rounded-xl border border-slate-200/70 space-y-1">
            <span class="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Carrier &amp; Driver</span>
            <p class="text-sm font-bold text-slate-800">${delivery.vehicleNumber || 'LES-9412 Truck'}</p>
            <p class="text-[11px] text-slate-500">${delivery.driverName || 'Muhammad Rasheed'}</p>
          </div>
        </div>
      </section>

      <!-- SECTION 2: Dispatched Line Items Table -->
      <section class="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-xs space-y-4">
        <div class="flex items-center justify-between border-b border-slate-100 pb-3">
          <h3 class="text-xs font-bold uppercase tracking-wider text-slate-700 flex items-center gap-2">
            <span>📦</span>
            <span>2. Cargo Items &amp; Physical Deductions</span>
          </h3>
          <span class="text-[10px] text-slate-400 font-semibold">${(delivery.lines || []).length} Product(s)</span>
        </div>

        <div class="border border-slate-200/80 rounded-xl overflow-hidden">
          <table class="w-full text-left text-xs">
            <thead class="bg-slate-50 text-[10px] uppercase font-bold text-slate-500 border-b border-slate-200">
              <tr>
                <th class="py-2.5 px-3">Item / SKU</th>
                <th class="py-2.5 px-3 text-right">Dispatched Quantity</th>
                <th class="py-2.5 px-3 text-center">Unit</th>
                <th class="py-2.5 px-3 text-right">Stock Impact</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-slate-100">
              ${(delivery.lines || []).map(l => `
                <tr class="hover:bg-slate-50/70">
                  <td class="py-3 px-3 font-bold text-slate-800">${varMap.get(l.variantId) || 'Variant SKU'}</td>
                  <td class="py-3 px-3 text-right font-black text-slate-900">${l.deliveredQuantity}</td>
                  <td class="py-3 px-3 text-center font-semibold text-slate-500">${l.unit || 'PCS'}</td>
                  <td class="py-3 px-3 text-right">
                    <span class="inline-block px-2 py-0.5 rounded text-[10px] font-bold ${isConfirmed ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}">
                      ${isConfirmed ? `-${l.deliveredQuantity} Deducted` : 'Pending Confirm'}
                    </span>
                  </td>
                </tr>
              `).join('')}
            </tbody>
            <tfoot class="bg-slate-50/80 border-t border-slate-200 font-bold">
              <tr>
                <td class="p-3 text-slate-700 uppercase tracking-wider text-[11px]">Total Outward Cargo</td>
                <td class="p-3 text-right text-sm font-black text-slate-900">${totalQty.toLocaleString()}</td>
                <td class="p-3 text-center text-slate-500">PCS</td>
                <td class="p-3 text-right text-emerald-700">${isConfirmed ? 'Stock Deducted' : 'On Hold'}</td>
              </tr>
            </tfoot>
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
          <button id="del-void-btn" type="button" class="inline-flex items-center space-x-1.5 px-3.5 py-2 text-xs font-bold text-rose-600 hover:text-rose-700 bg-rose-50 hover:bg-rose-100 border border-rose-200 rounded-xl transition-colors cursor-pointer">
            <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path>
            </svg>
            <span>Void / Cancel Delivery</span>
          </button>
        ` : `
          <span class="text-xs font-bold text-rose-600 bg-rose-50 border border-rose-200 px-3 py-1.5 rounded-xl inline-flex items-center gap-1.5">
            Cancelled Delivery
          </span>
        `}
      </div>
      <div class="flex items-center space-x-3">
        <button id="del-detail-close-btn" type="button" class="px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100 rounded-xl transition-colors border border-slate-200 cursor-pointer">
          Close
        </button>
        ${!isConfirmed && !isCancelled ? `
          <button id="del-confirm-btn" type="button" class="inline-flex items-center space-x-2 px-5 py-2 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 rounded-xl shadow-xs transition-all cursor-pointer">
            <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
              <path d="M5 13l4 4L19 7" stroke-linecap="round" stroke-linejoin="round"></path>
            </svg>
            <span>Confirm &amp; Deduct Stock</span>
          </button>
        ` : ''}
      </div>
    </div>
  `;

  openModal({
    title: `Delivery Note: ${delivery.deliveryNumber}`,
    subtitle: 'Review dispatch logistics, cargo items, and inventory release authorization',
    badge: delivery.deliveryNumber,
    contentHtml,
    footerHtml,
    size: 'max-w-4xl',
    onOpen: (modalEl) => {
      const closeBtn = modalEl.querySelector('#del-detail-close-btn');
      if (closeBtn) closeBtn.onclick = () => closeModal();

      const voidBtn = modalEl.querySelector('#del-void-btn');
      if (voidBtn) {
        voidBtn.onclick = () => {
          closeModal();
          handleCancelDelivery(delivery, refreshCallback);
        };
      }

      const confirmBtn = modalEl.querySelector('#del-confirm-btn');
      if (confirmBtn) {
        confirmBtn.onclick = () => {
          closeModal();
          handleConfirmDelivery(delivery, refreshCallback);
        };
      }
    }
  });
}

function handleConfirmDelivery(delivery, refreshCallback) {
  if (delivery.status === 'Confirmed') {
    toast.show('This delivery is already confirmed and stock has already been deducted.', 'warning');
    return;
  }
  if (delivery.status === 'Cancelled') {
    toast.show('Cannot confirm a cancelled delivery.', 'error');
    return;
  }

  confirmAction({
    title: `Confirm Delivery: ${delivery.deliveryNumber}`,
    message: 'Confirming this delivery will atomically deduct physical stock from the warehouse. Are you sure you want to proceed?',
    confirmLabel: 'Confirm & Deduct Stock',
    isDestructive: false,
    onConfirm: () => {
      try {
        deliveryService.confirmDelivery(delivery.id, authService.getCurrentUser().id);
        toast.show(`Delivery ${delivery.deliveryNumber} confirmed! Stock successfully deducted.`, 'success');
        if (refreshCallback) refreshCallback();
      } catch (err) {
        toast.show(err.message, 'error');
      }
    }
  });
}

function handleCancelDelivery(delivery, refreshCallback) {
  if (delivery.status === 'Cancelled') {
    toast.show('This delivery is already cancelled.', 'warning');
    return;
  }

  confirmAction({
    title: `Cancel / Void Delivery: ${delivery.deliveryNumber}`,
    message: delivery.status === 'Confirmed'
      ? 'Cancelling a confirmed delivery will REVERSE stock deduction and return goods to warehouse inventory. Continue?'
      : 'Are you sure you want to cancel / void this draft delivery?',
    confirmLabel: 'Yes, Cancel Delivery',
    isDestructive: true,
    onConfirm: () => {
      try {
        deliveryService.cancelDelivery(delivery.id, authService.getCurrentUser().id);
        toast.show(`Delivery ${delivery.deliveryNumber} cancelled. Stock movement reversed.`, 'success');
        if (refreshCallback) refreshCallback();
      } catch (err) {
        toast.show(err.message, 'error');
      }
    }
  });
}

function openCreateDeliveryModal(onSaved) {
  const salesOrders = salesService.getSalesOrders().filter(so => so.status !== 'Cancelled');
  const warehouses = warehouseService.getWarehouses();
  const variants = productService.getVariants();

  const selectedOrder = salesOrders[0];
  const orderLines = selectedOrder ? (selectedOrder.lines || []) : [];

  const contentHtml = `
    <form id="create-del-form" class="space-y-5 text-xs">
      <!-- Section 1: Order & Facility -->
      <section class="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-xs space-y-4">
        <div class="flex items-center justify-between border-b border-slate-100 pb-3">
          <h3 class="text-xs font-bold uppercase tracking-wider text-slate-700 flex items-center gap-2">
            <span>📋</span>
            <span>1. Source Order &amp; Dispatch Facility</span>
          </h3>
          <span class="text-[10px] text-slate-400 font-medium">All fields marked with <span class="text-red-500 font-bold">*</span> are required</span>
        </div>

        <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div class="space-y-1.5">
            <label class="text-xs font-semibold text-slate-700" for="del-so-select">Source Sales Order <span class="text-red-500">*</span></label>
            <select id="del-so-select" required class="w-full text-xs font-bold rounded-xl border border-slate-200 focus:border-[#138FCB] py-2.5 px-3 text-slate-800 bg-white shadow-2xs">
              ${salesOrders.map(so => `<option value="${so.id}">${so.orderNumber} - (Total: Rs. ${Number(so.total).toLocaleString()})</option>`).join('')}
            </select>
          </div>

          <div class="space-y-1.5">
            <label class="text-xs font-semibold text-slate-700" for="del-warehouse-select">Dispatching Warehouse <span class="text-red-500">*</span></label>
            <select id="del-warehouse-select" required class="w-full text-xs font-semibold rounded-xl border border-slate-200 focus:border-[#138FCB] py-2.5 px-3 text-slate-800 bg-white shadow-2xs">
              ${warehouses.map(w => `<option value="${w.id}">${w.name}</option>`).join('')}
            </select>
          </div>
        </div>
      </section>

      <!-- Section 2: Order Lines Fulfillment Tracker -->
      <section class="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-xs space-y-4">
        <div class="flex items-center justify-between border-b border-slate-100 pb-3">
          <h3 class="text-xs font-bold uppercase tracking-wider text-slate-700 flex items-center gap-2">
            <span>📦</span>
            <span>2. Order Line Fulfillment Tracker</span>
          </h3>
          <span class="text-[10px] text-slate-400">Specify quantity for this delivery dispatch</span>
        </div>

        <div id="del-lines-container" class="space-y-2.5">
          ${orderLines.map(line => {
            const variant = variants.find(v => v.id === line.variantId) || {};
            const remaining = (Number(line.orderedQty) || 0) - (Number(line.deliveredQty) || 0);
            return `
              <div class="del-order-line bg-slate-50/70 p-3.5 rounded-xl border border-slate-200/80 flex items-center justify-between gap-4 shadow-2xs"
                data-sol-id="${line.id}"
                data-variant-id="${line.variantId}"
                data-remaining="${remaining}">
                <div class="flex-1">
                  <div class="font-bold text-slate-800 text-xs">${variant.name || 'Feed Pan 16"'}</div>
                  <div class="text-[10px] text-slate-500 mt-0.5">Ordered: <strong>${line.orderedQty}</strong> | Previously Delivered: <strong>${line.deliveredQty}</strong> | Remaining: <strong class="text-blue-600 font-bold">${remaining} ${line.unit || 'PCS'}</strong></div>
                </div>
                <div class="w-36">
                  <label class="block text-[10px] font-bold text-slate-600 mb-1">Deliver Now</label>
                  <input type="number" min="1" max="${remaining}" value="${Math.min(remaining, 40)}" class="del-qty-input w-full text-xs border border-slate-200 rounded-xl px-2.5 py-1.5 text-slate-800 font-black focus:border-[#138FCB] shadow-2xs bg-white text-center">
                </div>
              </div>
            `;
          }).join('')}
        </div>
      </section>

      <!-- Section 3: Transport Logistics -->
      <section class="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-xs space-y-4">
        <div class="flex items-center justify-between border-b border-slate-100 pb-3">
          <h3 class="text-xs font-bold uppercase tracking-wider text-slate-700 flex items-center gap-2">
            <span>🚛</span>
            <span>3. Transport &amp; Vehicle Details</span>
          </h3>
        </div>

        <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div class="space-y-1.5">
            <label class="text-xs font-semibold text-slate-700" for="del-vehicle">Vehicle Details</label>
            <input type="text" id="del-vehicle" placeholder="e.g. LES-9412 Hino Truck" class="w-full text-xs rounded-xl border border-slate-200 focus:border-[#138FCB] py-2.5 px-3 text-slate-800 bg-white shadow-2xs">
          </div>
          <div class="space-y-1.5">
            <label class="text-xs font-semibold text-slate-700" for="del-driver">Driver Details</label>
            <input type="text" id="del-driver" placeholder="e.g. Muhammad Rasheed (+92 345 6789012)" class="w-full text-xs rounded-xl border border-slate-200 focus:border-[#138FCB] py-2.5 px-3 text-slate-800 bg-white shadow-2xs">
          </div>
        </div>
      </section>
    </form>
  `;

  const footerHtml = `
    <div class="flex items-center space-x-2 text-xs text-slate-400">
      <span class="w-2 h-2 rounded-full bg-emerald-500"></span>
      <span>🛡️ SSL 256-bit encrypted ERP transaction</span>
    </div>
    <div class="flex items-center space-x-3 w-full sm:w-auto justify-end">
      <button id="del-cancel-btn" type="button" class="px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100 rounded-xl transition-colors border border-slate-200 cursor-pointer">
        Cancel
      </button>
      <button type="submit" form="create-del-form" class="inline-flex items-center space-x-2 px-5 py-2.5 text-xs font-bold text-white bg-[#138FCB] hover:bg-[#0E78AC] rounded-xl shadow-xs transition-all active:scale-[0.98] cursor-pointer">
        <span>Create Draft Delivery</span>
      </button>
    </div>
  `;

  openModal({
    title: 'Prepare New Delivery Dispatch',
    subtitle: 'Fulfill ordered quantities against Sales Order and prepare stock decrement',
    badge: 'DEL-NEW',
    contentHtml,
    footerHtml,
    size: 'max-w-3xl',
    onOpen: (modalEl) => {
      const cancelBtn = modalEl.querySelector('#del-cancel-btn');
      if (cancelBtn) cancelBtn.onclick = () => closeModal();

      modalEl.querySelector('#create-del-form').onsubmit = (e) => {
        e.preventDefault();
        const salesOrderId = modalEl.querySelector('#del-so-select').value;
        const warehouseId = modalEl.querySelector('#del-warehouse-select').value;
        const vehicleNumber = modalEl.querySelector('#del-vehicle').value.trim();
        const driverName = modalEl.querySelector('#del-driver').value.trim();

        const so = salesService.getSalesOrderById(salesOrderId);
        const lines = [];

        modalEl.querySelectorAll('.del-order-line').forEach(lineEl => {
          const salesOrderLineId = lineEl.getAttribute('data-sol-id');
          const variantId = lineEl.getAttribute('data-variant-id');
          const deliveredQuantity = Number(lineEl.querySelector('.del-qty-input').value) || 0;
          if (deliveredQuantity > 0) {
            lines.push({ salesOrderLineId, variantId, deliveredQuantity, unit: 'PCS' });
          }
        });

        if (lines.length === 0) {
          toast.show('Please enter at least 1 unit to deliver.', 'warning');
          return;
        }

        try {
          const delivery = deliveryService.createDelivery({
            salesOrderId,
            customerPartyId: so.customerPartyId,
            farmId: so.farmId,
            warehouseId,
            vehicleNumber,
            driverName,
            lines,
            userId: authService.getCurrentUser().id
          });

          toast.show(`Delivery ${delivery.deliveryNumber} created. Confirm delivery to deduct stock.`, 'success');
          closeModal();
          if (onSaved) onSaved();
        } catch (err) {
          toast.show(err.message, 'error');
        }
      };
    }
  });
}
