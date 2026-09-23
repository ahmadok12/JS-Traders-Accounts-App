/**
 * JS Traders ERP - Delivery Management View
 * Tracks Ordered, Delivered, and Remaining quantities per order line.
 * CRITICAL RULE: Stock is deducted ONLY when a Delivery is Confirmed.
 * Confirmed delivery atomic stock deduction & cancellation stock reversal.
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
  const salesOrders = salesService.getSalesOrders();
  const parties = salesService.getParties(true);
  const warehouses = warehouseService.getWarehouses();
  const variants = productService.getVariants();

  const partyMap = new Map(parties.map(p => [p.id, p.name]));
  const whMap = new Map(warehouses.map(w => [w.id, w.name]));
  const varMap = new Map(variants.map(v => [v.id, v.name]));
  const soMap = new Map(salesOrders.map(s => [s.id, s.orderNumber]));

  const filterBarHtml = renderFilterBar({
    searchPlaceholder: 'Search deliveries by delivery #, order, customer...',
    primaryAction: { label: 'New Delivery' }
  });

  const columns = [
    {
      key: 'deliveryNumber',
      label: 'Delivery #',
      render: row => `<span class="font-bold text-[#138FCB]">${row.deliveryNumber}</span>`
    },
    {
      key: 'salesOrderId',
      label: 'Sales Order',
      render: row => row.salesOrderId
        ? `<span class="font-semibold text-slate-800">${soMap.get(row.salesOrderId) || row.salesOrderId}</span>`
        : `<span class="text-slate-400">Direct Delivery</span>`
    },
    {
      key: 'customerPartyId',
      label: 'Customer',
      render: row => `<span class="font-bold text-slate-800">${partyMap.get(row.customerPartyId) || 'Customer'}</span>`
    },
    {
      key: 'warehouseId',
      label: 'Warehouse',
      render: row => `<span class="font-medium text-slate-700">${whMap.get(row.warehouseId) || 'Main Warehouse'}</span>`
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
            isConfirmed ? 'bg-emerald-50 text-emerald-700' :
            isCancelled ? 'bg-rose-50 text-rose-700' :
            'bg-amber-50 text-amber-700'
          }">
            ${isConfirmed ? 'Confirmed (Stock Deducted)' : row.status}
          </span>
        `;
      }
    }
  ];

  const actions = [
    {
      label: 'Confirm Delivery',
      variant: 'emerald',
      onClick: (row) => handleConfirmDelivery(row)
    },
    {
      label: 'Cancel',
      variant: 'danger',
      onClick: (row) => handleCancelDelivery(row)
    }
  ];

  const tableHtml = renderTable({
    columns,
    data: deliveries,
    actions,
    emptyMessage: 'No deliveries recorded.'
  });

  return `
    <div id="delivery-view-container" class="space-y-5 animate-in fade-in duration-150">
      <!-- Info banner regarding inventory rule -->
      <div class="p-3.5 bg-blue-50/70 border border-blue-100 rounded-2xl flex items-center justify-between text-xs text-blue-900">
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
    { label: 'Confirm Delivery', onClick: (row) => handleConfirmDelivery(row, refreshCallback) },
    { label: 'Cancel', onClick: (row) => handleCancelDelivery(row, refreshCallback) }
  ];
  bindTableActions(container, actions, deliveries);
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
    title: `Cancel Delivery: ${delivery.deliveryNumber}`,
    message: delivery.status === 'Confirmed'
      ? 'Cancelling a confirmed delivery will REVERSE stock deduction and return goods to warehouse inventory. Continue?'
      : 'Are you sure you want to cancel this draft delivery?',
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
    <form id="create-del-form" class="space-y-4 text-xs">
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label class="block font-bold text-slate-700 mb-1">Source Sales Order *</label>
          <select id="del-so-select" required class="w-full border border-slate-200 rounded-xl px-3 py-2 text-slate-800 font-bold focus:outline-none focus:border-[#138FCB]">
            ${salesOrders.map(so => `<option value="${so.id}">${so.orderNumber} - (Total: Rs. ${Number(so.total).toLocaleString()})</option>`).join('')}
          </select>
        </div>

        <div>
          <label class="block font-bold text-slate-700 mb-1">Dispatching Warehouse *</label>
          <select id="del-warehouse-select" required class="w-full border border-slate-200 rounded-xl px-3 py-2 text-slate-800">
            ${warehouses.map(w => `<option value="${w.id}">${w.name}</option>`).join('')}
          </select>
        </div>
      </div>

      <!-- Order Lines Tracker (Ordered, Delivered, Remaining) -->
      <div class="p-3.5 bg-slate-50 rounded-xl border border-slate-200 space-y-2.5">
        <div class="flex items-center justify-between">
          <span class="text-[11px] font-bold text-slate-700 uppercase tracking-wider">Order Line Fulfillment Tracker</span>
          <span class="text-[10px] text-slate-400">Specify quantity for this delivery dispatch</span>
        </div>

        <div id="del-lines-container" class="space-y-2">
          ${orderLines.map(line => {
            const variant = variants.find(v => v.id === line.variantId) || {};
            const remaining = (Number(line.orderedQty) || 0) - (Number(line.deliveredQty) || 0);
            return `
              <div class="del-order-line bg-white p-3 rounded-lg border border-slate-200 flex items-center justify-between gap-4"
                data-sol-id="${line.id}"
                data-variant-id="${line.variantId}"
                data-remaining="${remaining}">
                <div class="flex-1">
                  <div class="font-bold text-slate-800">${variant.name || 'Feed Pan 16"'}</div>
                  <div class="text-[10px] text-slate-500">Ordered: <strong>${line.orderedQty}</strong> | Previously Delivered: <strong>${line.deliveredQty}</strong> | Remaining: <strong class="text-blue-600">${remaining} ${line.unit || 'PCS'}</strong></div>
                </div>
                <div class="w-36">
                  <label class="block text-[10px] font-bold text-slate-600 mb-0.5">Deliver Now</label>
                  <input type="number" min="1" max="${remaining}" value="${Math.min(remaining, 40)}" class="del-qty-input w-full border border-slate-200 rounded px-2.5 py-1 text-slate-800 font-extrabold focus:outline-none focus:border-[#138FCB]">
                </div>
              </div>
            `;
          }).join('')}
        </div>
      </div>

      <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label class="block font-bold text-slate-700 mb-1">Vehicle Details</label>
          <input type="text" id="del-vehicle" placeholder="e.g. LES-9412 Hino Truck" class="w-full border border-slate-200 rounded-xl px-3 py-2 text-slate-800">
        </div>
        <div>
          <label class="block font-bold text-slate-700 mb-1">Driver Details</label>
          <input type="text" id="del-driver" placeholder="e.g. Muhammad Rasheed (+92 345 6789012)" class="w-full border border-slate-200 rounded-xl px-3 py-2 text-slate-800">
        </div>
      </div>

      <div class="flex justify-end gap-3 pt-4 border-t border-slate-100">
        <button type="button" id="del-cancel-btn" class="px-4 py-2 text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-xl font-semibold transition-colors cursor-pointer">Cancel</button>
        <button type="submit" class="px-4 py-2 bg-[#138FCB] hover:bg-[#0E78AC] text-white rounded-xl font-semibold shadow-xs transition-colors cursor-pointer">Create Draft Delivery</button>
      </div>
    </form>
  `;

  openModal({
    title: 'Prepare New Delivery Dispatch',
    subtitle: 'Fulfill ordered quantities against Sales Order',
    contentHtml,
    size: 'max-w-2xl',
    onOpen: (modalEl) => {
      modalEl.querySelector('#del-cancel-btn').onclick = () => closeModal();

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
