/**
 * JS Traders ERP - Sales Orders View
 * Manages customer sales contracts, line quantities, and Last Customer Rate lookup.
 */

import { salesService } from '../../services/salesService.js';
import { productService } from '../../services/productService.js';
import { authService } from '../../services/authService.js';
import { renderTable, bindTableActions } from '../../components/table.js';
import { renderFilterBar } from '../../components/filters.js';
import { openModal, closeModal } from '../../components/modal.js';
import { toast } from '../../components/toast.js';

export function renderSalesOrdersView() {
  const orders = salesService.getSalesOrders();
  const parties = salesService.getParties(true);
  const partyMap = new Map(parties.map(p => [p.id, p.name]));

  const filterBarHtml = renderFilterBar({
    searchPlaceholder: 'Search sales orders by order # or customer...',
    primaryAction: { label: 'New Sales Order' }
  });

  const columns = [
    {
      key: 'orderNumber',
      label: 'Order #',
      render: row => `<span class="font-bold text-[#138FCB]">${row.orderNumber}</span>`
    },
    {
      key: 'date',
      label: 'Date',
      render: row => `<span class="text-slate-600 font-medium">${row.date}</span>`
    },
    {
      key: 'customerPartyId',
      label: 'Customer',
      render: row => `<span class="font-bold text-slate-800">${partyMap.get(row.customerPartyId) || 'Customer'}</span>`
    },
    {
      key: 'fulfillment',
      label: 'Fulfillment Status',
      render: row => {
        const totalOrdered = (row.lines || []).reduce((s, l) => s + (Number(l.orderedQty) || 0), 0);
        const totalDelivered = (row.lines || []).reduce((s, l) => s + (Number(l.deliveredQty) || 0), 0);
        const pct = totalOrdered > 0 ? Math.round((totalDelivered / totalOrdered) * 100) : 0;
        return `
          <div>
            <div class="flex justify-between text-[11px] font-semibold mb-0.5">
              <span>${totalDelivered} / ${totalOrdered} Delivered</span>
              <span class="text-blue-600">${pct}%</span>
            </div>
            <div class="w-28 bg-slate-100 h-1.5 rounded-full overflow-hidden">
              <div class="bg-[#138FCB] h-full rounded-full" style="width: ${pct}%;"></div>
            </div>
          </div>
        `;
      }
    },
    {
      key: 'total',
      label: 'Order Total',
      align: 'right',
      render: row => `<span class="font-extrabold text-slate-900">Rs. ${Number(row.total || 0).toLocaleString()}</span>`
    },
    {
      key: 'status',
      label: 'Status',
      render: row => `
        <span class="px-2.5 py-0.5 rounded-full text-[10px] font-bold ${
          row.status === 'Delivered' ? 'bg-emerald-50 text-emerald-700' :
          row.status === 'Partially Delivered' ? 'bg-blue-50 text-[#138FCB]' :
          'bg-amber-50 text-amber-700'
        }">
          ${row.status}
        </span>
      `
    }
  ];

  const actions = [
    { label: 'View Order', variant: 'secondary', onClick: (row) => openOrderDetailModal(row) }
  ];

  const tableHtml = renderTable({
    columns,
    data: orders,
    actions,
    emptyMessage: 'No sales orders created.'
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
    { label: 'View Order', onClick: (row) => openOrderDetailModal(row) }
  ];
  bindTableActions(container, actions, orders);
}

function openCreateOrderModal(onSaved) {
  const customers = salesService.getParties(true);
  const variants = productService.getVariants();

  const selectedCustomer = customers[0];
  const farms = selectedCustomer ? salesService.getFarmsByCustomer(selectedCustomer.id) : [];

  const contentHtml = `
    <form id="create-so-form" class="space-y-4 text-xs">
      <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div>
          <label class="block font-bold text-slate-700 mb-1">Customer *</label>
          <select id="so-customer-select" required class="w-full border border-slate-200 rounded-xl px-3 py-2 text-slate-800 font-bold">
            ${customers.map(c => `<option value="${c.id}">${c.name}</option>`).join('')}
          </select>
        </div>

        <div>
          <label class="block font-bold text-slate-700 mb-1">Target Farm / Branch</label>
          <select id="so-farm-select" class="w-full border border-slate-200 rounded-xl px-3 py-2 text-slate-800">
            ${farms.map(f => `<option value="${f.id}">${f.name}</option>`).join('')}
          </select>
        </div>

        <div>
          <label class="block font-bold text-slate-700 mb-1">Order Date</label>
          <input type="date" id="so-date" value="${new Date().toISOString().split('T')[0]}" class="w-full border border-slate-200 rounded-xl px-3 py-2 text-slate-800">
        </div>
      </div>

      <!-- Line item with Last Customer Rate helper -->
      <div class="p-3.5 bg-slate-50 rounded-xl border border-slate-200 space-y-3">
        <span class="text-[11px] font-bold text-slate-700 uppercase tracking-wider block">Ordered Equipment Line</span>
        <div class="grid grid-cols-12 gap-3 items-end">
          <div class="col-span-6">
            <label class="block text-[10px] font-bold text-slate-600 mb-1">Product Variant *</label>
            <select id="so-item-var" class="w-full border border-slate-200 rounded-lg px-2.5 py-1.5 text-slate-800 bg-white font-bold">
              ${variants.map(v => `<option value="${v.id}">${v.name} (${v.sku})</option>`).join('')}
            </select>
          </div>

          <div class="col-span-3">
            <label class="block text-[10px] font-bold text-slate-600 mb-1">Quantity *</label>
            <input type="number" id="so-item-qty" min="1" value="100" class="w-full border border-slate-200 rounded-lg px-2.5 py-1.5 text-slate-800 font-extrabold bg-white">
          </div>

          <div class="col-span-3">
            <label class="block text-[10px] font-bold text-slate-600 mb-1">Unit Price (PKR) *</label>
            <input type="number" id="so-item-price" min="0" value="1450" class="w-full border border-slate-200 rounded-lg px-2.5 py-1.5 text-slate-800 font-extrabold bg-white text-[#138FCB]">
          </div>
        </div>

        <!-- Last Customer Rate Helper Box -->
        <div id="last-rate-box" class="p-2.5 bg-blue-50/80 border border-blue-100 rounded-lg flex items-center justify-between text-[11px] text-blue-900">
          <div>
            <span>💡 <strong>Last Applied Customer Rate:</strong> </span>
            <span id="last-rate-text">Rs. 1,400 (Applied on 18/09/2025 in Invoice INV-00001)</span>
          </div>
          <button type="button" id="apply-last-rate-btn" class="px-2 py-1 bg-[#138FCB] text-white rounded font-bold text-[10px] hover:bg-[#0E78AC] cursor-pointer">
            Use Last Rate
          </button>
        </div>
      </div>

      <div class="flex justify-end gap-3 pt-4 border-t border-slate-100">
        <button type="button" id="so-cancel-btn" class="px-4 py-2 text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-xl font-semibold transition-colors cursor-pointer">Cancel</button>
        <button type="submit" class="px-4 py-2 bg-[#138FCB] hover:bg-[#0E78AC] text-white rounded-xl font-semibold shadow-xs transition-colors cursor-pointer">Create Sales Order</button>
      </div>
    </form>
  `;

  openModal({
    title: 'Create New Sales Order',
    subtitle: 'Captures customer agreement and feeds warehouse delivery planner',
    contentHtml,
    size: 'max-w-2xl',
    onOpen: (modalEl) => {
      modalEl.querySelector('#so-cancel-btn').onclick = () => closeModal();

      // Dynamic Last Rate lookup on variant change
      const updateRateDisplay = () => {
        const custId = modalEl.querySelector('#so-customer-select').value;
        const varId = modalEl.querySelector('#so-item-var').value;
        const rateInfo = salesService.getLastCustomerRate(custId, varId);
        const rateText = modalEl.querySelector('#last-rate-text');
        if (rateInfo) {
          rateText.textContent = `Rs. ${rateInfo.rate.toLocaleString()} (${rateInfo.source})`;
          modalEl.querySelector('#apply-last-rate-btn').onclick = () => {
            modalEl.querySelector('#so-item-price').value = rateInfo.rate;
            toast.show(`Applied last customer rate: Rs. ${rateInfo.rate.toLocaleString()}`, 'info');
          };
        }
      };

      modalEl.querySelector('#so-customer-select').onchange = updateRateDisplay;
      modalEl.querySelector('#so-item-var').onchange = updateRateDisplay;
      updateRateDisplay();

      modalEl.querySelector('#create-so-form').onsubmit = (e) => {
        e.preventDefault();
        const customerPartyId = modalEl.querySelector('#so-customer-select').value;
        const farmId = modalEl.querySelector('#so-farm-select').value;
        const variantId = modalEl.querySelector('#so-item-var').value;
        const orderedQty = Number(modalEl.querySelector('#so-item-qty').value) || 1;
        const unitPrice = Number(modalEl.querySelector('#so-item-price').value) || 0;

        salesService.createSalesOrder({
          customerPartyId,
          farmId,
          assignedSalespersonId: authService.getCurrentUser().id,
          lines: [{ variantId, orderedQty, unitPrice, unit: 'PCS' }]
        });

        toast.show('Sales Order created successfully.', 'success');
        closeModal();
        if (onSaved) onSaved();
      };
    }
  });
}

function openOrderDetailModal(order) {
  const parties = salesService.getParties(true);
  const party = parties.find(p => p.id === order.customerPartyId);
  const variants = productService.getVariants();
  const varMap = new Map(variants.map(v => [v.id, v.name]));

  const contentHtml = `
    <div class="space-y-5 text-xs">
      <div class="p-4 bg-slate-50 rounded-xl border border-slate-200 flex justify-between items-start">
        <div>
          <span class="text-[10px] font-bold uppercase tracking-wider text-slate-400">Order Header</span>
          <h3 class="text-base font-extrabold text-slate-900 mt-0.5">${order.orderNumber}</h3>
          <p class="text-slate-600 mt-1">Customer: <strong>${party ? party.name : 'Customer'}</strong></p>
          <p class="text-slate-500">Date: ${order.date} | Status: <strong class="text-[#138FCB]">${order.status}</strong></p>
        </div>
        <div class="text-right">
          <span class="text-[10px] font-bold uppercase tracking-wider text-slate-400">Total Contract Value</span>
          <p class="text-xl font-extrabold text-[#138FCB] mt-0.5">Rs. ${Number(order.total || 0).toLocaleString()}</p>
        </div>
      </div>

      <!-- Line items with delivered & remaining status -->
      <div>
        <h4 class="font-bold text-slate-700 mb-2">Order Line Fulfillment Breakdown</h4>
        <table class="w-full text-left border border-slate-200 rounded-xl overflow-hidden">
          <thead class="bg-slate-50 text-[10px] uppercase font-bold text-slate-400 border-b border-slate-200">
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
                <tr>
                  <td class="py-3 px-3 font-semibold text-slate-800">${varMap.get(l.variantId) || 'Item'}</td>
                  <td class="py-3 px-3 text-right font-bold">${l.orderedQty}</td>
                  <td class="py-3 px-3 text-right text-emerald-600 font-bold">${l.deliveredQty}</td>
                  <td class="py-3 px-3 text-right text-blue-600 font-bold">${remaining}</td>
                  <td class="py-3 px-3 text-right">Rs. ${Number(l.unitPrice).toLocaleString()}</td>
                  <td class="py-3 px-3 text-right font-extrabold text-slate-900">Rs. ${Number(l.lineTotal).toLocaleString()}</td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      </div>

      <div class="flex justify-end pt-4 border-t border-slate-100">
        <button id="order-close-btn" class="px-4 py-2 text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-xl font-semibold transition-colors cursor-pointer">Close</button>
      </div>
    </div>
  `;

  openModal({
    title: `Sales Order: ${order.orderNumber}`,
    subtitle: 'Contract specification and delivery status',
    contentHtml,
    size: 'max-w-2xl',
    onOpen: (modalEl) => {
      modalEl.querySelector('#order-close-btn').onclick = () => closeModal();
    }
  });
}
