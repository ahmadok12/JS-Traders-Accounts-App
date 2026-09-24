/**
 * JS Traders ERP - Sales Orders View (Outgoing Stock Demand)
 * 
 * Core Design Principles:
 * 1. Renamed from Gatepass Outward Voucher to Sales Order.
 * 2. Represents the customer's complete requirements / draft gatepass (without rate and amount).
 * 3. Does NOT reduce physical warehouse inventory upon creation.
 * 4. Each line tracks independently: Ordered Qty, Delivered Qty, Remaining Delivery Qty.
 * 5. Primary action [Convert to GDN] generates physical Delivery Note / GDN.
 * 6. In case of partial delivery, multiple GDNs belong to one Sales Order.
 * 7. The printed document of a GDN is titled "GATEPASS".
 */

import { salesService } from '../../services/salesService.js';
import { productService } from '../../services/productService.js';
import { gatepassService } from '../../services/gatepassService.js';
import { inventoryService } from '../../services/inventoryService.js';
import { cutToLengthService } from '../../services/cutToLengthService.js';
import { staffAuthService } from '../../services/staffAuthService.js';
import { storageService } from '../../services/storageService.js';
import { bundleService } from '../../services/bundleService.js';
import { renderTable, bindTableActions } from '../../components/table.js';
import { renderFilterBar } from '../../components/filters.js';
import { openModal, closeModal } from '../../components/modal.js';
import { confirmAction } from '../../components/confirmation.js';
import { renderProductVariantPicker, bindProductVariantPicker } from '../../components/searchableSelect.js';
import { toast } from '../../components/toast.js';

export function renderSalesOrdersView() {
  const orders = salesService.getSalesOrders();
  const parties = salesService.getParties(true);
  const partyMap = new Map(parties.map(p => [p.id, p.name]));
  const users = storageService.getCollection('users') || [];
  const userMap = new Map(users.map(u => [u.id, u.fullName]));
  const variants = productService.getVariants();
  const varMap = new Map(variants.map(v => [v.id, v.name]));

  const filterBarHtml = renderFilterBar({
    searchPlaceholder: 'Search orders by SO #, customer name, vehicle, notes...',
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
      render: row => `
        <div>
          <span class="font-bold text-[#138FCB] font-mono">${row.orderNumber}</span>
          <div class="text-[9px] font-bold text-slate-400 mt-0.5">DRAFT GATEPASS</div>
        </div>
      `
    },
    {
      key: 'customerPartyId',
      label: 'Customer / Destination',
      render: row => `
        <div>
          <div class="font-bold text-slate-800">${partyMap.get(row.customerPartyId) || row.customerName || 'Customer'}</div>
          <div class="text-[10px] text-slate-400 font-mono">Date: ${row.date || 'Today'} ${row.vehicleNumber ? `• ${row.vehicleNumber}` : ''}</div>
        </div>
      `
    },
    {
      key: 'productsAndAllocation',
      label: 'Products & Allocation (WH / Office)',
      render: row => {
        const rawLines = row.lines || [];
        if (rawLines.length === 0) {
          return `<span class="text-slate-400 text-xs italic">No items</span>`;
        }

        const consolidatedLines = [];
        const seenBundles = new Set();

        rawLines.forEach(l => {
          if (l.isBundleComponent && (l.bundleUid || l.bundleId)) {
            const bKey = l.bundleUid || l.bundleId;
            if (!seenBundles.has(bKey)) {
              seenBundles.add(bKey);
              consolidatedLines.push({
                isBundle: true,
                variantName: `🧩 ${l.bundleName || 'Bundle Set'}`,
                orderedQty: l.bundleQty || 1,
                deliveredQty: 0,
                warehouseQty: l.bundleQty || 1,
                officeQty: 0,
                unit: 'Sets'
              });
            }
          } else {
            consolidatedLines.push(l);
          }
        });

        const shownLines = consolidatedLines.slice(0, 4);
        const remainingCount = consolidatedLines.length - shownLines.length;

        return `
          <div class="space-y-1.5 py-1 min-w-[270px] max-w-[380px]">
            ${shownLines.map(l => {
              const pName = l.variantName || varMap.get(l.variantId) || 'Product Item';
              const wh = Number(l.warehouseQty) || 0;
              const off = Number(l.officeQty) || 0;
              const ord = Number(l.orderedQty !== undefined ? l.orderedQty : (wh + off)) || 0;
              const del = Number(l.deliveredQty) || 0;
              const pending = Math.max(0, ord - del);
              const unit = l.packagingName || l.unit || 'PCS';
              const isDone = del >= ord && ord > 0;
              return `
                <div class="bg-slate-50/90 hover:bg-slate-100/90 transition-colors p-2 rounded-xl border border-slate-200/80 text-xs space-y-1 shadow-2xs">
                  <div class="flex items-center justify-between gap-1.5">
                    <span class="font-bold text-slate-800 text-[11px] truncate" title="${pName}">${pName}</span>
                    <span class="text-[10px] font-extrabold shrink-0 px-1.5 py-0.5 rounded ${
                      isDone ? 'text-emerald-700 bg-emerald-50 border border-emerald-200' :
                      del > 0 ? 'text-blue-700 bg-blue-50 border border-blue-200' :
                      'text-slate-600 bg-white border border-slate-200'
                    }">
                      ${del}/${ord} del ${isDone ? '✓' : `(${pending} left)`}
                    </span>
                  </div>
                  <div class="flex items-center gap-2 text-[10px]">
                    <span class="inline-flex items-center gap-1 text-blue-700 font-bold bg-white px-1.5 py-0.5 rounded border border-blue-100 shadow-2xs">
                      <span class="w-1.5 h-1.5 rounded-full bg-blue-500"></span>WH: ${wh}
                    </span>
                    <span class="inline-flex items-center gap-1 text-amber-800 font-bold bg-white px-1.5 py-0.5 rounded border border-amber-100 shadow-2xs">
                      <span class="w-1.5 h-1.5 rounded-full bg-amber-500"></span>Office: ${off}
                    </span>
                    <span class="text-slate-400 font-medium ml-auto">${unit}</span>
                  </div>
                </div>
              `;
            }).join('')}
            ${remainingCount > 0 ? `
              <div class="text-[10px] text-slate-500 font-bold bg-slate-100 px-2 py-0.5 rounded-lg text-center border border-slate-200">
                +${remainingCount} more item(s) in this order
              </div>
            ` : ''}
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
              return `<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-100 text-slate-700">${staff}</span>`;
            }).join('')}
          </div>
        `;
      }
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
    { label: 'Convert to GDN', variant: 'primary' },
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
    { label: 'Convert to GDN', variant: 'primary', onClick: (row) => openCreateDeliveryNoteModal(row, refreshCallback) },
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
        (o.vehicleNumber && o.vehicleNumber.toLowerCase().includes(q)) ||
        (o.driverName && o.driverName.toLowerCase().includes(q)) ||
        (o.customerName && o.customerName.toLowerCase().includes(q)) ||
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
  const users = storageService.getCollection('users') || [];
  const userMap = new Map(users.map(u => [u.id, u.fullName]));
  const variants = productService.getVariants();
  const varMap = new Map(variants.map(v => [v.id, v.name]));

  const columns = [
    {
      key: 'orderNumber',
      label: 'Order #',
      render: row => `
        <div>
          <span class="font-bold text-[#138FCB] font-mono">${row.orderNumber}</span>
          <div class="text-[9px] font-bold text-slate-400 mt-0.5">DRAFT GATEPASS</div>
        </div>
      `
    },
    {
      key: 'customerPartyId',
      label: 'Customer / Destination',
      render: row => `
        <div>
          <div class="font-bold text-slate-800">${partyMap.get(row.customerPartyId) || row.customerName || 'Customer'}</div>
          <div class="text-[10px] text-slate-400 font-mono">Date: ${row.date || 'Today'} ${row.vehicleNumber ? `• ${row.vehicleNumber}` : ''}</div>
        </div>
      `
    },
    {
      key: 'productsAndAllocation',
      label: 'Products & Allocation (WH / Office)',
      render: row => {
        const lines = row.lines || [];
        if (lines.length === 0) {
          return `<span class="text-slate-400 text-xs italic">No items</span>`;
        }
        const shownLines = lines.slice(0, 4);
        const remainingCount = lines.length - shownLines.length;

        return `
          <div class="space-y-1.5 py-1 min-w-[270px] max-w-[380px]">
            ${shownLines.map(l => {
              const pName = varMap.get(l.variantId) || l.variantName || 'Product Item';
              const wh = Number(l.warehouseQty) || 0;
              const off = Number(l.officeQty) || 0;
              const ord = Number(l.orderedQty !== undefined ? l.orderedQty : (wh + off)) || 0;
              const del = Number(l.deliveredQty) || 0;
              const pending = Math.max(0, ord - del);
              const unit = l.packagingName || l.unit || 'PCS';
              const isDone = del >= ord && ord > 0;
              return `
                <div class="bg-slate-50/90 hover:bg-slate-100/90 transition-colors p-2 rounded-xl border border-slate-200/80 text-xs space-y-1 shadow-2xs">
                  <div class="flex items-center justify-between gap-1.5">
                    <span class="font-bold text-slate-800 text-[11px] truncate" title="${pName}">${pName}</span>
                    <span class="text-[10px] font-extrabold shrink-0 px-1.5 py-0.5 rounded ${
                      isDone ? 'text-emerald-700 bg-emerald-50 border border-emerald-200' :
                      del > 0 ? 'text-blue-700 bg-blue-50 border border-blue-200' :
                      'text-slate-600 bg-white border border-slate-200'
                    }">
                      ${del}/${ord} del ${isDone ? '✓' : `(${pending} left)`}
                    </span>
                  </div>
                  <div class="flex items-center gap-2 text-[10px]">
                    <span class="inline-flex items-center gap-1 text-blue-700 font-bold bg-white px-1.5 py-0.5 rounded border border-blue-100 shadow-2xs">
                      <span class="w-1.5 h-1.5 rounded-full bg-blue-500"></span>WH: ${wh}
                    </span>
                    <span class="inline-flex items-center gap-1 text-amber-800 font-bold bg-white px-1.5 py-0.5 rounded border border-amber-100 shadow-2xs">
                      <span class="w-1.5 h-1.5 rounded-full bg-amber-500"></span>Office: ${off}
                    </span>
                    <span class="text-slate-400 font-medium ml-auto">${unit}</span>
                  </div>
                </div>
              `;
            }).join('')}
            ${remainingCount > 0 ? `
              <div class="text-[10px] text-slate-500 font-bold bg-slate-100 px-2 py-0.5 rounded-lg text-center border border-slate-200">
                +${remainingCount} more product(s) in this order
              </div>
            ` : ''}
          </div>
        `;
      }
    },
    {
      key: 'assignedStaff',
      label: 'Assigned Staff',
      render: row => {
        const staffIds = row.assignedStaffIds || [];
        if (staffIds.length === 0) return `<span class="text-slate-400 text-xs italic">Unassigned</span>`;
        return `
          <div class="flex flex-wrap gap-1">
            ${staffIds.map(id => {
              const staff = userMap.get(id) || 'Staff';
              return `<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-100 text-slate-700">${staff}</span>`;
            }).join('')}
          </div>
        `;
      }
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
    { label: 'View', variant: 'secondary', onClick: (row) => openOrderDetailModal(row, refreshCallback) },
    { label: 'Convert to GDN', variant: 'primary', onClick: (row) => openCreateDeliveryNoteModal(row, refreshCallback) },
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
            <span>1. Sales Order Overview (Draft Gatepass)</span>
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
            <span class="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Customer Destination</span>
            <p class="text-sm font-bold text-slate-900">${party ? party.name : (order.customerName || 'Customer')}</p>
            <p class="text-[11px] text-slate-500">Site: ${order.farmId || 'Main Site'}</p>
          </div>

          <div class="p-3 bg-slate-50/70 rounded-xl border border-slate-200/70 space-y-1">
            <span class="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Order Info</span>
            <p class="text-sm font-bold text-slate-800 font-mono">${order.orderNumber}</p>
            <p class="text-[11px] text-slate-500">Date: ${order.date || 'Today'}</p>
          </div>

          <div class="p-3 bg-blue-50/50 rounded-xl border border-blue-200/70 space-y-1">
            <span class="text-[10px] font-bold text-[#138FCB] uppercase tracking-wider block">Carrier & Logistics</span>
            <p class="text-xs font-bold text-slate-800">${order.vehicleNumber || 'Unassigned Vehicle'}</p>
            <p class="text-[11px] text-slate-500">Driver: ${order.driverName || 'N/A'} ${order.driverPhone ? `(${order.driverPhone})` : ''}</p>
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
                <th class="py-2.5 px-3 text-center">WH Qty</th>
                <th class="py-2.5 px-3 text-center">Office Qty</th>
                <th class="py-2.5 px-3 text-center font-bold text-slate-800">Ordered Total</th>
                <th class="py-2.5 px-3 text-center text-emerald-700 font-bold">Delivered (GDN)</th>
                <th class="py-2.5 px-3 text-center text-blue-600 font-bold">Pending</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-slate-100">
              ${(order.lines || []).map(l => {
                const ord = Number(l.orderedQty) || 0;
                const del = Number(l.deliveredQty) || 0;
                const remDel = Math.max(0, ord - del);
                return `
                  <tr class="hover:bg-slate-50/70">
                    <td class="py-3 px-3 font-semibold text-slate-800">
                      <div>${varMap.get(l.variantId) || 'Item'}</div>
                      ${l.packagingName ? `<div class="text-[10px] text-slate-400">${l.packagingName}</div>` : ''}
                    </td>
                    <td class="py-3 px-3 text-center text-blue-700 font-bold">${l.warehouseQty || 0}</td>
                    <td class="py-3 px-3 text-center text-amber-700 font-bold">${l.officeQty || 0}</td>
                    <td class="py-3 px-3 text-center font-extrabold text-slate-900">${ord} ${l.unit || 'PCS'}</td>
                    <td class="py-3 px-3 text-center text-emerald-600 font-bold">${del}</td>
                    <td class="py-3 px-3 text-center ${remDel > 0 ? 'text-blue-600 font-extrabold' : 'text-slate-400'}">${remDel}</td>
                  </tr>
                `;
              }).join('')}
            </tbody>
          </table>
        </div>
      </section>

      <!-- SECTION 3: Linked Dispatches (Delivery Notes / Gatepasses) -->
      <section class="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-xs space-y-4">
        <div class="flex items-center justify-between border-b border-slate-100 pb-3">
          <h3 class="text-xs font-bold uppercase tracking-wider text-slate-700 flex items-center gap-2">
            <span>🚚</span>
            <span>3. Linked Delivery Notes / Gatepasses (${linkedGDNs.length})</span>
          </h3>
          <span class="text-[10px] text-slate-400 font-semibold">Each GDN generates a printed Gatepass</span>
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
                  <th class="py-2 px-3">Gatepass / GDN #</th>
                  <th class="py-2 px-3">Date</th>
                  <th class="py-2 px-3">Vehicle &amp; Driver</th>
                  <th class="py-2 px-3 text-center">Dispatched Qty</th>
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
            <span>🚚 Convert to GDN / Gatepass</span>
          </button>
        ` : ''}
      </div>
    </div>
  `;

  openModal({
    title: `Sales Order: ${order.orderNumber}`,
    subtitle: 'Demand requirement baseline, fulfillment dispatches, and linked gatepasses',
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
          openCreateDeliveryNoteModal(order, refreshCallback);
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
          <span class="text-[10px] font-bold uppercase tracking-wider text-blue-600">Originating Sales Order</span>
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
          <input type="text" id="gdn-vehicle-input" placeholder="e.g. LES-9412 Truck" value="${order.vehicleNumber || 'LES-9412 Truck'}" class="w-full px-3 py-2 border border-slate-200 rounded-xl focus:outline-none focus:border-[#138FCB] font-mono text-slate-800 shadow-2xs">
        </div>
        <div>
          <label class="block font-bold text-slate-700 mb-1">Driver Name &amp; Phone</label>
          <input type="text" id="gdn-driver-input" placeholder="e.g. Muhammad Rasheed" value="${order.driverName || 'Muhammad Rasheed'}" class="w-full px-3 py-2 border border-slate-200 rounded-xl focus:outline-none focus:border-[#138FCB] text-slate-800 shadow-2xs">
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
              <th class="py-2.5 px-3 text-center w-32 text-indigo-700 font-bold">Deliver Now (GDN)</th>
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
      <span>🛡️ Creates GDN (Printed document will be Gatepass)</span>
    </div>
    <div class="flex items-center space-x-3 w-full sm:w-auto justify-end">
      <button id="gdn-cancel-btn" type="button" class="px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100 rounded-xl transition-colors border border-slate-200 cursor-pointer">
        Cancel
      </button>
      <button id="gdn-submit-btn" type="button" class="inline-flex items-center space-x-2 px-5 py-2.5 text-xs font-bold text-white bg-[#138FCB] hover:bg-[#0E78AC] rounded-xl shadow-xs transition-all active:scale-[0.98] cursor-pointer">
        <span>🚚 Issue GDN / Gatepass</span>
      </button>
    </div>
  `;

  openModal({
    title: `Convert to GDN: ${order.orderNumber}`,
    subtitle: 'Generate physical Goods Dispatch Note for warehouse dispatch. Printed document is called Gatepass.',
    badge: 'GDN',
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
          toast.show(`Goods Dispatch Note ${gp.gatepassNumber} created successfully!`, 'success');
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
          <div style="font-size: 11px; font-weight: 800; color: #64748b;">(DRAFT GATEPASS)</div>
          <div style="font-size: 13px; font-weight: 800; font-family: monospace;">${order.orderNumber}</div>
          <div style="font-size: 11px; color: #64748b;">Date: ${order.date || 'Today'}</div>
        </div>
      </div>

      <div class="grid">
        <div class="card">
          <div class="card-label">Customer / Contractee Details</div>
          <div style="font-size: 14px; font-weight: 800; color: #0f172a;">${party ? party.name : (order.customerName || 'Customer')}</div>
          <div style="font-size: 11px; color: #475569; margin-top: 2px;">Farm / Branch: <strong>${order.farmId || 'Main Site'}</strong></div>
          <div style="font-size: 11px; color: #475569;">Vehicle / Carrier: <strong>${order.vehicleNumber || 'Unassigned'}</strong></div>
          <div style="font-size: 11px; color: #475569;">Driver: <strong>${order.driverName || 'N/A'}</strong> ${order.driverPhone ? `(${order.driverPhone})` : ''}</div>
        </div>
        <div class="card">
          <div class="card-label">Order Fulfillment &amp; Gatepass Status</div>
          <div>Status: <strong>${order.status}</strong></div>
          <div>Issued Gatepasses: <strong>${linkedGDNs.length} GDN(s)</strong></div>
          <div style="font-size: 11px; color: #64748b; margin-top: 4px;">* Physical stock is deducted only upon Goods Dispatch Note (GDN / Gatepass) approval.</div>
        </div>
      </div>

      <table>
        <thead>
          <tr>
            <th>#</th>
            <th>Item Description</th>
            <th class="text-center">Delivered from WH</th>
            <th class="text-center">Delivered from Office</th>
            <th class="text-center">Ordered Qty</th>
            <th class="text-center">Dispatched (GDN)</th>
            <th class="text-center">Pending Qty</th>
          </tr>
        </thead>
        <tbody>
          ${(() => {
            const raw = order.lines || [];
            const displayLines = [];
            const seenBundles = new Set();

            raw.forEach(l => {
              if (l.isBundleComponent && (l.bundleUid || l.bundleId)) {
                const bKey = l.bundleUid || l.bundleId;
                if (!seenBundles.has(bKey)) {
                  seenBundles.add(bKey);
                  displayLines.push({
                    isBundle: true,
                    name: l.bundleName || 'Bundle / Set',
                    bundleQty: l.bundleQty || 1,
                    bundleUnitPrice: l.bundleUnitPrice || 0,
                    unit: 'Sets',
                    warehouseQty: l.bundleWhQty || l.bundleQty || 1,
                    officeQty: l.bundleOfficeQty || 0,
                    orderedQty: l.bundleQty || 1,
                    deliveredQty: 0
                  });
                }
              } else {
                displayLines.push(l);
              }
            });

            return displayLines.map((l, i) => {
              if (l.isBundle) {
                const priceFormatted = l.bundleUnitPrice > 0 ? ` (Rs. ${Number(l.bundleUnitPrice).toLocaleString()} each)` : '';
                return `
                  <tr>
                    <td>${i + 1}</td>
                    <td>
                      <strong>${l.name}</strong>
                      <div style="font-size: 10px; color: #7c3aed; font-weight: 600;">Predefined Bundle / Set</div>
                    </td>
                    <td class="text-center font-mono">—</td>
                    <td class="text-center font-mono">—</td>
                    <td class="text-center font-mono" style="font-weight: 800;">
                      ${l.bundleQty} Set${l.bundleQty !== 1 ? 's' : ''}
                      ${l.bundleUnitPrice > 0 ? `<div style="font-size: 10px; color: #64748b;">${l.bundleQty} × Rs. ${Number(l.bundleUnitPrice).toLocaleString()}</div>` : ''}
                    </td>
                    <td class="text-center font-mono" style="color: #059669; font-weight: 700;">—</td>
                    <td class="text-center font-mono" style="color: #2563eb; font-weight: 700;">${l.bundleQty}</td>
                  </tr>
                `;
              }

              const ord = Number(l.orderedQty) || 0;
              const del = Number(l.deliveredQty) || 0;
              const rem = Math.max(0, ord - del);
              const variantObj = variants.find(v => v.id === l.variantId);
              const isCtl = Boolean(l.isRoll || l.mode || l.totalFeet || variantObj?.isCutToLength || variantObj?.rollLength);
              const baseUnit = l.baseUnit || variantObj?.rollUnit || 'ft';
              const rollLen = l.rollSize || variantObj?.rollLength || 5000;

              let qtyDisplay = `${ord} ${l.unit || 'PCS'}`;
              let whDisplay = `${l.warehouseQty || 0}`;
              let offDisplay = `${l.officeQty || 0}`;
              let delDisplay = `${del}`;
              let remDisplay = `${rem}`;

              if (isCtl) {
                if (l.isRoll || l.mode === 'rolls') {
                  const totalFt = l.totalFeet || (ord * rollLen);
                  qtyDisplay = `<div><strong>${ord} Roll${ord !== 1 ? 's' : ''}</strong></div><div style="font-size: 10px; color: #138FCB; font-weight: bold;">(${totalFt.toLocaleString()} ${baseUnit})</div>`;
                  if (l.warehouseQty) whDisplay = `${l.warehouseQty} Roll${l.warehouseQty !== 1 ? 's' : ''} <div style="font-size: 9px; color: #64748b;">(${(l.warehouseQty * rollLen).toLocaleString()} ${baseUnit})</div>`;
                  if (l.officeQty) offDisplay = `${l.officeQty} Roll${l.officeQty !== 1 ? 's' : ''} <div style="font-size: 9px; color: #64748b;">(${(l.officeQty * rollLen).toLocaleString()} ${baseUnit})</div>`;
                  delDisplay = del > 0 ? `${del} Roll${del !== 1 ? 's' : ''} (${(del * rollLen).toLocaleString()} ${baseUnit})` : '0';
                  remDisplay = rem > 0 ? `${rem} Roll${rem !== 1 ? 's' : ''} (${(rem * rollLen).toLocaleString()} ${baseUnit})` : '0';
                } else {
                  const modeLabel = l.mode === 'loose_pcs' ? 'Loose - Pcs' : 'Loose - Continuous';
                  qtyDisplay = `<div><strong>${ord.toLocaleString()} ${baseUnit}</strong></div><div style="font-size: 10px; color: #d97706; font-weight: 600;">(${modeLabel})</div>`;
                  if (l.warehouseQty) whDisplay = `${Number(l.warehouseQty).toLocaleString()} ${baseUnit}`;
                  if (l.officeQty) offDisplay = `${Number(l.officeQty).toLocaleString()} ${baseUnit}`;
                  delDisplay = del > 0 ? `${del.toLocaleString()} ${baseUnit}` : '0';
                  remDisplay = rem > 0 ? `${rem.toLocaleString()} ${baseUnit}` : '0';
                }
              }

              return `
                <tr>
                  <td>${i + 1}</td>
                  <td>
                    <strong>${varMap.get(l.variantId) || 'Product Item'}</strong>
                    ${variantObj?.sku ? `<div style="font-size: 10px; color: #64748b; font-family: monospace;">SKU: ${variantObj.sku}</div>` : ''}
                  </td>
                  <td class="text-center font-mono">${whDisplay}</td>
                  <td class="text-center font-mono">${offDisplay}</td>
                  <td class="text-center font-mono" style="font-weight: 800;">${qtyDisplay}</td>
                  <td class="text-center font-mono" style="color: #059669; font-weight: 700;">${delDisplay}</td>
                  <td class="text-center font-mono" style="color: #2563eb; font-weight: 700;">${remDisplay}</td>
                </tr>
              `;
            }).join('');
          })()}
        </tbody>
      </table>

      ${order.notes ? `
        <div style="margin-bottom: 20px; font-size: 11px; background: #f0f9ff; border: 1px solid #bae6fd; padding: 10px; border-radius: 6px;">
          <strong>Dispatch Instructions / Notes:</strong> ${order.notes}
        </div>
      ` : ''}

      <div class="signatures">
        <div>
          <div style="height: 40px;"></div>
          <div class="sig-line">Prepared By (Warehouse Manager)</div>
        </div>
        <div>
          <div style="height: 40px;"></div>
          <div class="sig-line">Carrier / Driver Acknowledgment</div>
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

/**
 * Add Sales Order Dialog
 * EXACT former "Add Gatepass Outward" dialog without rate or amount.
 * Represents draft gatepass / demand requirement.
 */
function openCreateOrderModal(onSaved) {
  const products = productService.getProducts();
  const variants = productService.getVariants();
  const staffMembers = staffAuthService.getStaffMembers();
  const whStaff = staffMembers.filter(s => s.staffType === 'warehouse_staff' || s.activeWarehouseId === 'wh-1');
  const officeStaff = staffMembers.filter(s => s.staffType === 'office_staff' || s.activeWarehouseId === 'wh-2');

  const renderRowHtml = (variantId = null, whQty = '', offQty = '', rowIdx = 0, initialPackaging = null) => {
    let selectedVariant = variantId ? variants.find(v => v.id === variantId) || null : null;
    let selectedProduct = selectedVariant
      ? products.find(p => p.id === selectedVariant.productId) || products[0]
      : products[0];

    const prodVariants = selectedProduct
      ? variants.filter(v => v.productId === selectedProduct.id)
      : [];

    if (!selectedVariant) {
      if (prodVariants.length === 1) {
        selectedVariant = prodVariants[0];
      } else {
        selectedVariant = null;
      }
    }

    const vId = selectedVariant ? selectedVariant.id : '';
    const isCtl = Boolean(selectedVariant?.isCutToLength || selectedVariant?.rollLength || (selectedProduct && (selectedProduct.cut_to_length || selectedProduct.enableRollTracking)));
    const baseUnit = selectedVariant?.rollUnit || (isCtl ? (selectedProduct?.base_unit || 'ft') : (selectedVariant?.unit || selectedProduct?.baseUnitId || 'PCS'));
    const packagingUnits = isCtl ? (selectedProduct.packagingUnits || []) : [];
    const curPackaging = initialPackaging || (packagingUnits.length > 0 ? packagingUnits[0].name : baseUnit);

    const itemId = vId || selectedProduct?.id;
    const whStock = itemId ? inventoryService.getBalance('wh-1', itemId) : 0;
    const officeStock = itemId ? inventoryService.getBalance('wh-2', itemId) : 0;
    const wVal = (whQty !== '' && whQty !== null && whQty !== undefined) ? whQty : '';
    const oVal = (offQty !== '' && offQty !== null && offQty !== undefined) ? offQty : '';
    const lineTotal = (Number(wVal) || 0) + (Number(oVal) || 0);

    const pickerHtml = renderProductVariantPicker({
      rowId: `so-row-${rowIdx}`,
      selectedProductId: selectedProduct ? selectedProduct.id : null,
      selectedVariantId: vId || null,
      products,
      variants,
      whStock,
      officeStock,
      unit: baseUnit
    });

    const ctlHtml = `
      <div class="so-ctl-container ${isCtl ? '' : 'hidden'} mt-2.5 pt-2 border-t border-slate-100 space-y-2 bg-slate-50/80 p-2.5 rounded-xl border border-slate-200/60">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <div class="flex items-center gap-1.5">
            <span class="text-[10px] font-bold text-slate-500 uppercase tracking-wider">📦 Dispatch Mode:</span>
            <select class="so-item-packaging text-xs font-bold border border-slate-200 rounded-xl px-2.5 py-1 bg-white text-slate-800 focus:outline-none focus:border-[#138FCB] shadow-2xs cursor-pointer">
              <option value="rolls">1. Rolls</option>
              <option value="loose_continuous" selected>2. loose - continuous</option>
              <option value="loose_pcs">3. loose - pcs (more than 1 pcs joined together)</option>
            </select>
          </div>
          <div class="so-ctl-stock-pill text-[10px] font-semibold text-slate-600 bg-white border border-slate-200 px-2.5 py-1 rounded-lg shadow-2xs">
            <!-- Live variant rolls & loose breakdown -->
          </div>
        </div>
        <div class="so-ctl-sim-preview hidden text-[11px] font-medium p-2.5 rounded-xl bg-blue-50 border border-blue-200 text-blue-950 transition-all">
          <!-- Real-time simulation of cuts and remaining rolls & loose pieces -->
        </div>
      </div>
    `;

    return `
      <tr class="so-line-row hover:bg-slate-50/70 transition-colors" data-row-index="${rowIdx}">
        <td class="p-2.5 align-top">
          ${pickerHtml}
          ${ctlHtml}
        </td>
        <td class="p-2.5 text-center align-top">
          <span class="wh-stock-indicator block text-[10px] text-blue-700 bg-blue-50/80 px-1.5 py-0.5 rounded-lg border border-blue-200/80 font-bold mb-1.5 whitespace-nowrap overflow-hidden text-ellipsis">
            ${(vId || selectedProduct) ? `WH Stock: ${whStock.toLocaleString()} ${baseUnit}` : 'WH Stock: —'}
          </span>
          <input type="number" min="0" value="${wVal}" placeholder="0" class="so-wh-qty w-20 mx-auto text-center text-xs font-black rounded-xl border border-blue-200 focus:border-[#138FCB] focus:ring-2 focus:ring-blue-100 py-1.5 px-2 bg-white text-blue-900 shadow-2xs">
        </td>
        <td class="p-2.5 text-center align-top">
          <span class="office-stock-indicator block text-[10px] text-amber-800 bg-amber-50/80 px-1.5 py-0.5 rounded-lg border border-amber-200/80 font-bold mb-1.5 whitespace-nowrap overflow-hidden text-ellipsis">
            ${(vId || selectedProduct) ? `Office Stock: ${officeStock.toLocaleString()} ${baseUnit}` : 'Office Stock: —'}
          </span>
          <input type="number" min="0" value="${oVal}" placeholder="0" class="so-office-qty w-20 mx-auto text-center text-xs font-black rounded-xl border border-amber-200 focus:border-amber-500 focus:ring-2 focus:ring-amber-100 py-1.5 px-2 bg-white text-amber-900 shadow-2xs">
        </td>
        <td class="p-2.5 text-right align-top pt-3.5">
          <span class="so-total-calc font-black text-slate-900 text-sm">${lineTotal > 0 ? `${lineTotal.toLocaleString()} ${baseUnit}` : '—'}</span>
        </td>
        <td class="p-2.5 text-center align-top pt-3">
          <button type="button" class="so-remove-row-btn w-8 h-8 inline-flex items-center justify-center rounded-xl text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition-colors cursor-pointer" title="Remove line item">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
              <path d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" stroke-linecap="round" stroke-linejoin="round"></path>
            </svg>
          </button>
        </td>
      </tr>
    `;
  };

  const contentHtml = `
    <form id="create-so-form" class="space-y-6 text-xs">
      <!-- SECTION 1: Client & Logistics Configuration -->
      <section class="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-xs space-y-4" data-purpose="client-and-logistics">
        <div class="flex items-center justify-between border-b border-slate-100 pb-3">
          <h3 class="text-xs font-bold uppercase tracking-wider text-slate-700 flex items-center gap-2">
            <span>👤</span>
            <span>1. Customer &amp; Logistics Details</span>
          </h3>
          <span class="text-[10px] text-slate-400 font-medium">All fields marked with <span class="text-red-500 font-bold">*</span> are required</span>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-12 gap-4">
          <!-- Client / Customer Destination Text Input -->
          <div class="md:col-span-12 space-y-1.5">
            <label class="text-xs font-semibold text-slate-700" for="so-customer-name">Customer / Farm Name <span class="text-red-500">*</span></label>
            <input type="text" id="so-customer-name" required placeholder="Enter Customer / Farm Name" class="w-full text-xs font-medium rounded-xl border border-slate-200 focus:border-[#138FCB] focus:ring focus:ring-blue-100 py-2.5 px-3 text-slate-800 bg-white shadow-2xs">
          </div>

          <!-- Vehicle Number -->
          <div class="md:col-span-4 space-y-1.5">
            <label class="text-xs font-semibold text-slate-700" for="so-vehicle">Vehicle Number <span class="text-red-500">*</span></label>
            <input type="text" id="so-vehicle" required placeholder="e.g. LES-9412 Truck" value="LES-9412 Truck" class="w-full text-xs font-medium rounded-xl border border-slate-200 focus:border-[#138FCB] focus:ring focus:ring-blue-100 py-2.5 px-3 text-slate-800 bg-white shadow-2xs">
          </div>

          <!-- Driver Name -->
          <div class="md:col-span-4 space-y-1.5">
            <label class="text-xs font-semibold text-slate-700" for="so-driver">Driver Name <span class="text-red-500">*</span></label>
            <input type="text" id="so-driver" required placeholder="e.g. Muhammad Rasheed" value="Muhammad Rasheed" class="w-full text-xs font-medium rounded-xl border border-slate-200 focus:border-[#138FCB] focus:ring focus:ring-blue-100 py-2.5 px-3 text-slate-800 bg-white shadow-2xs">
          </div>

          <!-- Driver Phone -->
          <div class="md:col-span-4 space-y-1.5">
            <label class="text-xs font-semibold text-slate-700" for="so-driver-phone">Driver Phone</label>
            <input type="tel" id="so-driver-phone" placeholder="e.g. +92 345 6789012" value="+92 345 6789012" class="w-full text-xs font-medium rounded-xl border border-slate-200 focus:border-[#138FCB] focus:ring focus:ring-blue-100 py-2.5 px-3 text-slate-800 bg-white shadow-2xs">
          </div>
        </div>
      </section>

      <!-- SECTION 2: Items & Dual-Location Allocation Table -->
      <section class="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-xs space-y-4" data-purpose="line-items-section">
        <div class="flex items-center justify-between border-b border-slate-100 pb-3">
          <div class="flex items-center space-x-2">
            <h3 class="text-xs font-bold uppercase tracking-wider text-slate-700 flex items-center gap-1.5">
              <span>📦</span>
              <span>2. Items &amp; Dual-Location Allocation (No Rates/Amounts)</span>
            </h3>
            <span id="so-lines-count-badge" class="px-2 py-0.5 text-[10px] font-semibold rounded-full bg-slate-100 text-slate-600">1 Product</span>
          </div>
          <span class="text-[10px] text-slate-400 font-medium">Type to search catalog &amp; pick variants</span>
        </div>

        <!-- Table Container -->
        <div class="overflow-visible border border-slate-200/80 rounded-xl">
          <table class="w-full text-left text-xs">
            <thead class="bg-slate-50 text-slate-500 uppercase text-[10px] tracking-wider border-b border-slate-200/80">
              <tr>
                <th class="py-3 px-3 w-[62%] font-semibold">Product &amp; Variant SKU Selection</th>
                <th class="py-3 px-2 w-[13%] font-semibold text-center">Delivered from WH *</th>
                <th class="py-3 px-2 w-[13%] font-semibold text-center">Delivered from Office *</th>
                <th class="py-3 px-3 w-[8%] font-semibold text-right">Cargo Qty</th>
                <th class="py-3 px-2 w-[4%] font-semibold text-center">Action</th>
              </tr>
            </thead>
            <tbody id="so-items-tbody" class="divide-y divide-slate-100 text-slate-700">
              ${renderRowHtml(null, '', '', 0)}
            </tbody>
          </table>
        </div>

        <!-- Action Row under Table -->
        <div class="pt-1 flex items-center gap-2">
          <button type="button" id="add-so-row-btn" class="inline-flex items-center space-x-2 px-4 py-2.5 bg-blue-50/80 hover:bg-blue-100 text-[#138FCB] rounded-xl text-xs font-bold border border-blue-200 transition-all cursor-pointer shadow-2xs hover:shadow-xs active:scale-98">
            <span class="text-base leading-none font-extrabold">+</span>
            <span>Add Line Item</span>
          </button>
          <button type="button" id="add-so-bundle-btn" class="inline-flex items-center space-x-2 px-4 py-2.5 bg-purple-50/80 hover:bg-purple-100 text-purple-700 rounded-xl text-xs font-bold border border-purple-200 transition-all cursor-pointer shadow-2xs hover:shadow-xs active:scale-98">
            <span class="text-base leading-none font-extrabold">🧩</span>
            <span>Add Bundle / Set</span>
          </button>
        </div>
      </section>

      <!-- SECTION 3: Dedicated Station Staff Assignment -->
      <section class="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-xs space-y-4" data-purpose="staff-assignment-section">
        <div class="flex items-center justify-between border-b border-slate-100 pb-3">
          <h3 class="text-xs font-bold uppercase tracking-wider text-slate-700 flex items-center space-x-2">
            <span>👥</span>
            <span>3. Assign Station Floor Staff</span>
          </h3>
          <span class="text-[10px] text-slate-400">Staff receive instant mobile alert for order preparation</span>
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
              ${whStaff.map(staff => `
                <label class="flex items-center justify-between p-2 bg-white hover:bg-blue-50/60 rounded-xl border border-blue-100 hover:border-blue-300 cursor-pointer transition-all shadow-2xs">
                  <div class="flex items-center gap-2.5">
                    <input type="checkbox" name="assignedStaff" value="${staff.id}" checked class="w-4 h-4 rounded text-[#138FCB] focus:ring-0">
                    <div>
                      <span class="text-xs font-bold text-slate-800">${staff.fullName}</span>
                      <span class="text-[10px] text-slate-400 block font-mono">PIN: ${staff.pin || '••••'}</span>
                    </div>
                  </div>
                  <span class="text-[10px] text-emerald-600 font-semibold bg-emerald-50 px-1.5 py-0.5 rounded">Active Staff</span>
                </label>
              `).join('')}
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
              ${officeStaff.map(staff => `
                <label class="flex items-center justify-between p-2 bg-white hover:bg-amber-50/60 rounded-xl border border-amber-100 hover:border-amber-300 cursor-pointer transition-all shadow-2xs">
                  <div class="flex items-center gap-2.5">
                    <input type="checkbox" name="assignedStaff" value="${staff.id}" checked class="w-4 h-4 rounded text-amber-600 focus:ring-0">
                    <div>
                      <span class="text-xs font-bold text-slate-800">${staff.fullName}</span>
                      <span class="text-[10px] text-slate-400 block font-mono">PIN: ${staff.pin || '••••'}</span>
                    </div>
                  </div>
                  <span class="text-[10px] text-emerald-600 font-semibold bg-emerald-50 px-1.5 py-0.5 rounded">Active Staff</span>
                </label>
              `).join('')}
            </div>
          </div>
        </div>
      </section>

      <!-- SECTION 4: Bottom Dual Columns (Notes vs Summary) -->
      <div class="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
        <!-- Notes -->
        <div class="lg:col-span-7 bg-white p-5 rounded-2xl border border-slate-200/80 shadow-xs space-y-2" data-purpose="terms-and-notes">
          <label class="text-xs font-semibold text-slate-700" for="so-notes">Order Notes / Special Instructions</label>
          <textarea class="w-full text-xs rounded-xl border border-slate-200 focus:border-[#138FCB] focus:ring focus:ring-blue-100 text-slate-700 p-3 resize-none shadow-2xs" id="so-notes" placeholder="Contract delivery schedule, partial dispatch terms, drop-off location..." rows="3"></textarea>
        </div>

        <!-- Summary Breakdown Card -->
        <div class="lg:col-span-5 bg-white p-5 rounded-2xl border border-slate-200/80 shadow-xs space-y-3" data-purpose="totals-summary-card">
          <h3 class="text-xs font-bold uppercase tracking-wider text-slate-700 pb-1 border-b border-slate-100">Cargo Demand Summary</h3>
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
              <span>Document Type</span>
              <span class="text-[#138FCB] font-semibold bg-blue-50 px-2 py-0.5 rounded text-[10px]">Sales Order (Draft Gatepass)</span>
            </div>
          </div>

          <!-- Grand Total Highlight Card -->
          <div class="mt-4 pt-3 bg-blue-50/50 -mx-5 -mb-5 p-5 rounded-b-2xl border-t border-blue-100 flex items-center justify-between">
            <div>
              <p class="text-[11px] font-bold uppercase tracking-wider text-[#138FCB]">Total Ordered Cargo</p>
              <p class="text-[9px] text-slate-400">Does not deduct inventory until GDN approval</p>
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
    <div class="flex items-center space-x-2 text-xs text-slate-400">
      <span class="w-2 h-2 rounded-full bg-emerald-500"></span>
      <span>🛡️ Creates Sales Order (Draft Gatepass)</span>
    </div>
    <div class="flex items-center space-x-3 w-full sm:w-auto justify-end">
      <button id="so-cancel-btn" type="button" class="px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100 rounded-xl transition-colors border border-slate-200 cursor-pointer">
        Cancel
      </button>
      <button type="submit" form="create-so-form" class="inline-flex items-center space-x-2 px-5 py-2.5 text-xs font-bold text-white bg-[#138FCB] hover:bg-[#0E78AC] rounded-xl shadow-xs transition-all active:scale-[0.98] cursor-pointer">
        <span>Save Sales Order</span>
      </button>
    </div>
  `;

  openModal({
    title: 'Create Sales Order',
    subtitle: 'Add order demand without rates/amounts. Acts as draft gatepass convertible to physical GDNs.',
    badge: 'SALES ORDER',
    contentHtml,
    footerHtml,
    size: 'max-w-5xl',
    onOpen: (modalEl) => {
      const cancelBtn = modalEl.querySelector('#so-cancel-btn');
      if (cancelBtn) cancelBtn.onclick = () => closeModal();

      const tbody = modalEl.querySelector('#so-items-tbody');
      const addRowBtn = modalEl.querySelector('#add-so-row-btn');
      const summaryWh = modalEl.querySelector('#summary-wh-qty');
      const summaryOff = modalEl.querySelector('#summary-off-qty');
      const summaryTotal = modalEl.querySelector('#summary-total-qty');
      const lineCountBadge = modalEl.querySelector('#so-lines-count-badge');
      let rowCounter = 1;

      const updateRowCalculations = (row) => {
        const varInput = row.querySelector('.pv-selected-variant-id') || row.querySelector('.pv-var-input');
        const prodInput = row.querySelector('.pv-selected-product-id');
        const whIndicator = row.querySelector('.wh-stock-indicator');
        const offIndicator = row.querySelector('.office-stock-indicator');
        const whQtyInput = row.querySelector('.so-wh-qty');
        const offQtyInput = row.querySelector('.so-office-qty');
        const totalDisplay = row.querySelector('.so-total-calc');
        const ctlContainer = row.querySelector('.so-ctl-container');
        const packagingSelect = row.querySelector('.so-item-packaging');
        const ctlStockPill = row.querySelector('.so-ctl-stock-pill');

        const vId = varInput ? varInput.value : '';
        const pId = prodInput ? prodInput.value : '';
        const selectedVariant = variants.find(v => v.id === vId);
        const selectedProduct = selectedVariant ? products.find(p => p.id === selectedVariant.productId) : products.find(p => p.id === pId);

        if (!selectedProduct && !selectedVariant) {
          if (whIndicator) whIndicator.textContent = 'WH Stock: —';
          if (offIndicator) offIndicator.textContent = 'Office Stock: —';
          if (totalDisplay) totalDisplay.textContent = '—';
          if (ctlContainer) ctlContainer.classList.add('hidden');
          const ctlSimPreview = row.querySelector('.so-ctl-sim-preview');
          if (ctlSimPreview) {
            ctlSimPreview.classList.add('hidden');
            ctlSimPreview.innerHTML = '';
          }
          row._simWh = null;
          row._simOff = null;
          return;
        }

        const isCtl = Boolean(selectedVariant?.isCutToLength || selectedVariant?.rollLength || (selectedProduct && (selectedProduct.cut_to_length || selectedProduct.enableRollTracking)));
        const baseUnit = selectedVariant?.rollUnit || (isCtl ? (selectedProduct?.base_unit || 'ft') : (selectedVariant?.unit || 'PCS'));
        const itemId = vId || (selectedProduct ? selectedProduct.id : '');

        if (isCtl && ctlContainer && packagingSelect) {
          ctlContainer.classList.remove('hidden');

          const whStockRec = cutToLengthService.getVariantStock('wh-1', itemId);
          const offStockRec = cutToLengthService.getVariantStock('wh-2', itemId);

          const rollLength = whStockRec?.rollLength || Number(selectedVariant?.rollLength) || 5000;
          const whRolls = whStockRec ? whStockRec.fullRolls : 0;
          const whLoose = whStockRec ? (whStockRec.loosePieces || []) : [];
          const whTotalLoose = whLoose.reduce((sum, p) => sum + p, 0);
          const whTotalFootage = (whRolls * rollLength) + whTotalLoose;

          const offRolls = offStockRec ? offStockRec.fullRolls : 0;
          const offLoose = offStockRec ? (offStockRec.loosePieces || []) : [];
          const offTotalLoose = offLoose.reduce((sum, p) => sum + p, 0);
          const offTotalFootage = (offRolls * rollLength) + offTotalLoose;

          // Ensure packaging select options are preserved for 3 modes
          const currentVal = packagingSelect.value || 'loose_continuous';
          const expectedOptions = [
            { val: 'rolls', label: `1. Rolls (${rollLength.toLocaleString()} ${baseUnit}/roll)` },
            { val: 'loose_continuous', label: `2. loose - continuous (${baseUnit})` },
            { val: 'loose_pcs', label: `3. loose - pcs (${baseUnit}, can join pieces)` }
          ];

          const existingVals = Array.from(packagingSelect.options).map(o => o.value);
          const isSame = existingVals.length === expectedOptions.length && existingVals.every((v, i) => v === expectedOptions[i].val);
          if (!isSame) {
            packagingSelect.innerHTML = expectedOptions.map(opt => `
              <option value="${opt.val}" ${opt.val === currentVal ? 'selected' : ''}>${opt.label}</option>
            `).join('');
            packagingSelect.value = currentVal;
          }

          const mode = packagingSelect.value || 'loose_continuous';

          // Update stock pill
          if (ctlStockPill) {
            const whPcsStr = whLoose.length > 0 ? ` + [${whLoose.map(n => n.toLocaleString()).join(', ')}] ${baseUnit} loose` : '';
            const offPcsStr = offLoose.length > 0 ? ` + [${offLoose.map(n => n.toLocaleString()).join(', ')}] ${baseUnit} loose` : '';
            ctlStockPill.innerHTML = `
              <div class="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px]">
                <span><strong class="text-[#138FCB]">WH:</strong> ${whRolls} roll(s)${whPcsStr} (${whTotalFootage.toLocaleString()} ${baseUnit})</span>
                <span class="text-slate-300">|</span>
                <span><strong class="text-amber-700">Office:</strong> ${offRolls} roll(s)${offPcsStr} (${offTotalFootage.toLocaleString()} ${baseUnit})</span>
              </div>
            `;
          }

          // Update indicators & placeholders according to mode
          if (mode === 'rolls') {
            if (whIndicator) whIndicator.textContent = `WH: ${whRolls} Full Rolls (${rollLength.toLocaleString()} ${baseUnit}/roll)`;
            if (offIndicator) offIndicator.textContent = `Office: ${offRolls} Full Rolls (${rollLength.toLocaleString()} ${baseUnit}/roll)`;
            if (whQtyInput) whQtyInput.placeholder = '0 Rolls';
            if (offQtyInput) offQtyInput.placeholder = '0 Rolls';
          } else {
            if (whIndicator) whIndicator.textContent = `WH: ${whTotalFootage.toLocaleString()} ${baseUnit} (${whRolls} rolls, ${whLoose.length} loose)`;
            if (offIndicator) offIndicator.textContent = `Office: ${offTotalFootage.toLocaleString()} ${baseUnit} (${offRolls} rolls, ${offLoose.length} loose)`;
            if (whQtyInput) whQtyInput.placeholder = `0 ${baseUnit}`;
            if (offQtyInput) offQtyInput.placeholder = `0 ${baseUnit}`;
          }

          const rawW = whQtyInput ? whQtyInput.value.trim() : '';
          const rawO = offQtyInput ? offQtyInput.value.trim() : '';
          const wQty = Number(rawW) || 0;
          const oQty = Number(rawO) || 0;
          const lineTotal = wQty + oQty;

          if (!rawW && !rawO) {
            if (totalDisplay) totalDisplay.textContent = '—';
          } else {
            if (mode === 'rolls') {
              const totalFeet = lineTotal * rollLength;
              if (totalDisplay) totalDisplay.innerHTML = `<span class="text-slate-900 font-extrabold">${lineTotal} Roll${lineTotal > 1 ? 's' : ''}</span> <span class="text-[10px] text-slate-500 font-semibold block">(${totalFeet.toLocaleString()} ${baseUnit})</span>`;
            } else {
              if (totalDisplay) totalDisplay.innerHTML = `<span class="text-slate-900 font-extrabold">${lineTotal.toLocaleString()} ${baseUnit}</span> <span class="text-[10px] text-amber-600 font-semibold block">(${mode === 'loose_continuous' ? 'Continuous Cut' : 'Joined Pieces'})</span>`;
            }
          }

          // Real-time allocation simulation preview
          const ctlSimPreview = row.querySelector('.so-ctl-sim-preview');
          if (ctlSimPreview) {
            if (wQty <= 0 && oQty <= 0) {
              ctlSimPreview.classList.add('hidden');
              ctlSimPreview.innerHTML = '';
              row._simWh = null;
              row._simOff = null;
            } else {
              ctlSimPreview.classList.remove('hidden');
              const previewSections = [];

              if (wQty > 0) {
                const simWh = cutToLengthService.simulateAllocation({
                  warehouseId: 'wh-1',
                  variantId: vId,
                  mode,
                  quantity: wQty
                });
                row._simWh = simWh;

                if (simWh.canFulfill) {
                  previewSections.push(`
                    <div class="flex items-start gap-1.5 text-blue-950">
                      <span class="text-emerald-600 font-bold text-xs mt-0.5">✓</span>
                      <div>
                        <span class="font-bold text-[#138FCB]">WH Allocation:</span> ${simWh.summaryText}
                      </div>
                    </div>
                  `);
                } else {
                  previewSections.push(`
                    <div class="flex items-start gap-1.5 text-rose-900">
                      <span class="text-rose-600 font-bold text-xs mt-0.5">⚠️</span>
                      <div>
                        <span class="font-bold text-rose-700">WH Allocation Error:</span> ${simWh.error}
                      </div>
                    </div>
                  `);
                }
              } else {
                row._simWh = null;
              }

              if (oQty > 0) {
                const simOff = cutToLengthService.simulateAllocation({
                  warehouseId: 'wh-2',
                  variantId: vId,
                  mode,
                  quantity: oQty
                });
                row._simOff = simOff;

                if (simOff.canFulfill) {
                  previewSections.push(`
                    <div class="flex items-start gap-1.5 text-amber-950 ${wQty > 0 ? 'mt-1.5 pt-1.5 border-t border-blue-200/60' : ''}">
                      <span class="text-emerald-600 font-bold text-xs mt-0.5">✓</span>
                      <div>
                        <span class="font-bold text-amber-800">Office Allocation:</span> ${simOff.summaryText}
                      </div>
                    </div>
                  `);
                } else {
                  previewSections.push(`
                    <div class="flex items-start gap-1.5 text-rose-900 ${wQty > 0 ? 'mt-1.5 pt-1.5 border-t border-blue-200/60' : ''}">
                      <span class="text-rose-600 font-bold text-xs mt-0.5">⚠️</span>
                      <div>
                        <span class="font-bold text-rose-700">Office Allocation Error:</span> ${simOff.error}
                      </div>
                    </div>
                  `);
                }
              } else {
                row._simOff = null;
              }

              ctlSimPreview.innerHTML = previewSections.join('');
            }
          }
        } else {
          if (ctlContainer) ctlContainer.classList.add('hidden');
          const ctlSimPreview = row.querySelector('.so-ctl-sim-preview');
          if (ctlSimPreview) {
            ctlSimPreview.classList.add('hidden');
            ctlSimPreview.innerHTML = '';
          }
          row._simWh = null;
          row._simOff = null;

          const unit = selectedVariant ? (selectedVariant.unit || 'PCS') : (selectedProduct?.baseUnitId || 'PCS');
          const wStock = inventoryService.getBalance('wh-1', itemId);
          const oStock = inventoryService.getBalance('wh-2', itemId);

          if (whIndicator) whIndicator.textContent = `WH Stock: ${wStock.toLocaleString()} ${unit}`;
          if (offIndicator) offIndicator.textContent = `Office Stock: ${oStock.toLocaleString()} ${unit}`;
          if (whQtyInput) whQtyInput.placeholder = '0';
          if (offQtyInput) offQtyInput.placeholder = '0';

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
        }
      };

      const updateSummaryTotals = () => {
        const regularRows = tbody.querySelectorAll('.so-line-row');
        const bundleChildRows = tbody.querySelectorAll('.so-bundle-child-row');
        const bundleParentRows = tbody.querySelectorAll('.so-bundle-parent-row');

        let totalWh = 0;
        let totalOff = 0;

        regularRows.forEach(row => {
          const whQty = Number(row.querySelector('.so-wh-qty')?.value) || 0;
          const offQty = Number(row.querySelector('.so-office-qty')?.value) || 0;
          totalWh += whQty;
          totalOff += offQty;
        });

        bundleChildRows.forEach(row => {
          const whQty = Number(row.querySelector('.so-wh-qty')?.value) || 0;
          const offQty = Number(row.querySelector('.so-office-qty')?.value) || 0;
          totalWh += whQty;
          totalOff += offQty;
        });

        const grandTotal = totalWh + totalOff;
        if (summaryWh) summaryWh.textContent = totalWh > 0 ? `${totalWh.toLocaleString()} Cargo Units` : '0 Units';
        if (summaryOff) summaryOff.textContent = totalOff > 0 ? `${totalOff.toLocaleString()} Cargo Units` : '0 Units';
        if (summaryTotal) summaryTotal.textContent = grandTotal > 0 ? `${grandTotal.toLocaleString()} Cargo Units` : '0 Units';
        
        const totalItemsCount = regularRows.length + bundleParentRows.length;
        if (lineCountBadge) lineCountBadge.textContent = `${totalItemsCount} Item${totalItemsCount > 1 ? 's' : ''}`;

        const removeBtns = tbody.querySelectorAll('.so-remove-row-btn');
        removeBtns.forEach(btn => {
          if (regularRows.length <= 1 && bundleParentRows.length === 0) {
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

        const packagingSelect = row.querySelector('.so-item-packaging');
        if (packagingSelect) {
          packagingSelect.onchange = () => {
            updateRowCalculations(row);
            updateSummaryTotals();
          };
        }

        const whQtyInput = row.querySelector('.so-wh-qty');
        const offQtyInput = row.querySelector('.so-office-qty');
        const removeBtn = row.querySelector('.so-remove-row-btn');

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
            const rows = tbody.querySelectorAll('.so-line-row');
            if (rows.length > 1 || tbody.querySelectorAll('.so-bundle-parent-row').length > 0) {
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

      const appendBundleGroup = (bundleId = null, initialBundleQty = 1) => {
        const bundles = bundleService.getBundles();
        if (bundles.length === 0) {
          toast.show('No bundles defined yet. Go to Assembly &gt; Bundles to create a bundle first.', 'warning');
          return;
        }

        const selectedBundle = (bundleId ? bundles.find(b => b.id === bundleId) : null) || bundles[0];
        const bundleUid = 'bnd-' + Math.random().toString(36).substring(2, 9);
        const calc = bundleService.calculateBundleComponents(selectedBundle.id, initialBundleQty);

        // 1. Parent Bundle Row
        const parentTr = document.createElement('tr');
        parentTr.className = 'so-bundle-parent-row bg-purple-50/50 border-t-2 border-purple-300 hover:bg-purple-50/80 transition-colors';
        parentTr.setAttribute('data-bundle-uid', bundleUid);
        parentTr.setAttribute('data-bundle-id', selectedBundle.id);
        parentTr.setAttribute('data-bundle-name', selectedBundle.name);
        parentTr.setAttribute('data-bundle-price', selectedBundle.sellingPrice || 0);

        parentTr.innerHTML = `
          <td class="p-2.5 align-middle">
            <div class="flex items-center gap-2">
              <button type="button" class="so-bundle-toggle-btn w-6 h-6 rounded-lg bg-white border border-purple-300 text-purple-700 font-black text-xs hover:bg-purple-100 transition-colors cursor-pointer flex items-center justify-center shadow-2xs" title="Collapse / Expand Component Products">
                ▼
              </button>
              <span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-purple-100 text-purple-800 border border-purple-200 shrink-0">
                🧩 BUNDLE
              </span>
              <select class="so-bundle-select text-xs font-bold border border-purple-200 rounded-xl px-2.5 py-1.5 bg-white text-slate-800 focus:outline-none focus:border-purple-600 shadow-2xs flex-1">
                ${bundles.map(b => `<option value="${b.id}" ${b.id === selectedBundle.id ? 'selected' : ''}>${b.name} (${b.bundleQty || 1} set/bundle)</option>`).join('')}
              </select>
            </div>
          </td>
          <td class="p-2.5 text-center align-middle" colspan="2">
            <div class="flex items-center justify-center gap-2">
              <span class="text-xs font-bold text-purple-900">Bundle Qty:</span>
              <input type="number" min="1" step="1" value="${initialBundleQty}" class="so-bundle-qty-input w-20 text-center text-xs font-black rounded-xl border border-purple-300 focus:border-purple-600 focus:ring-2 focus:ring-purple-100 py-1.5 px-2 bg-white text-purple-900 shadow-2xs">
              <span class="text-[11px] font-semibold text-slate-500">Sets</span>
            </div>
          </td>
          <td class="p-2.5 text-right align-middle">
            <div class="so-bundle-total-price font-black text-purple-900 text-xs">
              ${(initialBundleQty * (selectedBundle.sellingPrice || 0)) > 0 ? `Rs. ${(initialBundleQty * (selectedBundle.sellingPrice || 0)).toLocaleString()}` : `${initialBundleQty} Set(s)`}
            </div>
            <div class="text-[9px] text-slate-400 font-mono">Consolidated on Print</div>
          </td>
          <td class="p-2.5 text-center align-middle">
            <button type="button" class="so-remove-bundle-btn w-8 h-8 inline-flex items-center justify-center rounded-xl text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition-colors cursor-pointer" title="Remove entire bundle">
              <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                <path d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" stroke-linecap="round" stroke-linejoin="round"></path>
              </svg>
            </button>
          </td>
        `;

        tbody.appendChild(parentTr);

        // 2. Child Rows
        const createChildRows = (components) => {
          components.forEach(c => {
            const childTr = document.createElement('tr');
            childTr.className = 'so-bundle-child-row hover:bg-purple-50/20 transition-colors bg-white/95 border-b border-purple-100/60';
            childTr.setAttribute('data-bundle-uid', bundleUid);
            childTr.setAttribute('data-variant-id', c.componentVariantId);
            childTr.setAttribute('data-product-id', c.productId || '');
            childTr.setAttribute('data-base-qty', c.baseQty || 1);
            childTr.setAttribute('data-unit-price', c.unitPrice || 0);
            childTr.setAttribute('data-unit', c.unit || 'PCS');

            const wBal = inventoryService.getBalance('wh-1', c.componentVariantId);
            const oBal = inventoryService.getBalance('wh-2', c.componentVariantId);

            childTr.innerHTML = `
              <td class="p-2.5 pl-9 align-top">
                <div class="flex items-center gap-2">
                  <span class="text-purple-400 font-bold">↳</span>
                  <div>
                    <div class="font-bold text-slate-800 text-xs">${c.name || 'Component'}</div>
                    <div class="text-[10px] text-slate-400 font-mono">
                      ${c.sku ? `SKU: ${c.sku} • ` : ''}Base: <span class="text-purple-700 font-bold">${c.baseQty} per bundle</span>
                    </div>
                  </div>
                </div>
              </td>
              <td class="p-2.5 text-center align-top">
                <span class="wh-stock-indicator block text-[10px] text-blue-700 bg-blue-50/80 px-1.5 py-0.5 rounded-lg border border-blue-200/80 font-bold mb-1.5 whitespace-nowrap overflow-hidden text-ellipsis">
                  WH Stock: ${wBal.toLocaleString()} ${c.unit || 'PCS'}
                </span>
                <input type="number" min="0" value="${c.calculatedQty}" class="so-wh-qty so-bundle-comp-wh w-20 mx-auto text-center text-xs font-black rounded-xl border border-blue-200 focus:border-[#138FCB] py-1.5 px-2 bg-white text-blue-900 shadow-2xs">
              </td>
              <td class="p-2.5 text-center align-top">
                <span class="office-stock-indicator block text-[10px] text-amber-800 bg-amber-50/80 px-1.5 py-0.5 rounded-lg border border-amber-200/80 font-bold mb-1.5 whitespace-nowrap overflow-hidden text-ellipsis">
                  Office Stock: ${oBal.toLocaleString()} ${c.unit || 'PCS'}
                </span>
                <input type="number" min="0" value="0" class="so-office-qty so-bundle-comp-off w-20 mx-auto text-center text-xs font-black rounded-xl border border-amber-200 focus:border-amber-500 py-1.5 px-2 bg-white text-amber-900 shadow-2xs">
              </td>
              <td class="p-2.5 text-right align-top pt-3.5">
                <span class="so-total-calc font-black text-slate-900 text-xs">${c.calculatedQty.toLocaleString()} ${c.unit || 'PCS'}</span>
              </td>
              <td class="p-2.5 text-center align-top pt-3">
                <span class="text-[9px] text-purple-600 font-semibold bg-purple-50 px-1.5 py-0.5 rounded border border-purple-100">Bundle Part</span>
              </td>
            `;

            tbody.appendChild(childTr);

            // Bind manual override inputs
            const whInput = childTr.querySelector('.so-bundle-comp-wh');
            const offInput = childTr.querySelector('.so-bundle-comp-off');
            const onChildInput = () => {
              childTr.setAttribute('data-manual-override', 'true');
              const w = Number(whInput.value) || 0;
              const o = Number(offInput.value) || 0;
              childTr.querySelector('.so-total-calc').textContent = `${(w + o).toLocaleString()} ${c.unit || 'PCS'}`;
              updateSummaryTotals();
            };
            whInput.oninput = onChildInput;
            offInput.oninput = onChildInput;
          });
        };

        createChildRows(calc.components);

        // Bind parent toggle
        const toggleBtn = parentTr.querySelector('.so-bundle-toggle-btn');
        let isExpanded = true;
        toggleBtn.onclick = () => {
          isExpanded = !isExpanded;
          toggleBtn.textContent = isExpanded ? '▼' : '▶';
          const childRows = tbody.querySelectorAll(`.so-bundle-child-row[data-bundle-uid="${bundleUid}"]`);
          childRows.forEach(r => {
            if (isExpanded) r.classList.remove('hidden');
            else r.classList.add('hidden');
          });
        };

        // Bind parent bundle quantity input (multiplier logic)
        const qtyInput = parentTr.querySelector('.so-bundle-qty-input');
        const priceDisplay = parentTr.querySelector('.so-bundle-total-price');

        qtyInput.oninput = () => {
          const newQty = Math.max(1, Number(qtyInput.value) || 1);
          const childRows = tbody.querySelectorAll(`.so-bundle-child-row[data-bundle-uid="${bundleUid}"]`);

          childRows.forEach(child => {
            const baseQty = Number(child.getAttribute('data-base-qty')) || 1;
            const unit = child.getAttribute('data-unit') || 'PCS';
            const whInput = child.querySelector('.so-bundle-comp-wh');
            const offInput = child.querySelector('.so-bundle-comp-off');

            // Proportional multiplication
            const compTotal = baseQty * newQty;
            whInput.value = compTotal;
            offInput.value = 0;
            child.removeAttribute('data-manual-override');
            child.querySelector('.so-total-calc').textContent = `${compTotal.toLocaleString()} ${unit}`;
          });

          const currentBundle = bundleService.getBundleById(parentTr.getAttribute('data-bundle-id'));
          const unitPrice = currentBundle?.sellingPrice || 0;
          if (unitPrice > 0) {
            priceDisplay.textContent = `Rs. ${(newQty * unitPrice).toLocaleString()}`;
          } else {
            priceDisplay.textContent = `${newQty} Set(s)`;
          }
          updateSummaryTotals();
        };

        // Bind bundle switch dropdown
        const bundleSelect = parentTr.querySelector('.so-bundle-select');
        bundleSelect.onchange = () => {
          const newBundleId = bundleSelect.value;
          const newBundle = bundleService.getBundleById(newBundleId);
          if (!newBundle) return;

          parentTr.setAttribute('data-bundle-id', newBundle.id);
          parentTr.setAttribute('data-bundle-name', newBundle.name);
          parentTr.setAttribute('data-bundle-price', newBundle.sellingPrice || 0);

          // Remove old child rows
          tbody.querySelectorAll(`.so-bundle-child-row[data-bundle-uid="${bundleUid}"]`).forEach(r => r.remove());

          // Re-create child rows
          const bQty = Number(qtyInput.value) || 1;
          const newCalc = bundleService.calculateBundleComponents(newBundle.id, bQty);
          createChildRows(newCalc.components);

          const unitPrice = newBundle.sellingPrice || 0;
          if (unitPrice > 0) {
            priceDisplay.textContent = `Rs. ${(bQty * unitPrice).toLocaleString()}`;
          } else {
            priceDisplay.textContent = `${bQty} Set(s)`;
          }
          updateSummaryTotals();
        };

        // Remove bundle
        const removeBtn = parentTr.querySelector('.so-remove-bundle-btn');
        removeBtn.onclick = () => {
          tbody.querySelectorAll(`.so-bundle-child-row[data-bundle-uid="${bundleUid}"]`).forEach(r => r.remove());
          parentTr.remove();
          updateSummaryTotals();
        };

        updateSummaryTotals();
      };

      // Initial row binding
      tbody.querySelectorAll('.so-line-row').forEach(row => {
        bindRowEvents(row);
        updateRowCalculations(row);
      });
      updateSummaryTotals();

      if (addRowBtn) {
        addRowBtn.onclick = () => {
          const existingIds = new Set(Array.from(tbody.querySelectorAll('.pv-selected-variant-id, .pv-var-input')).map(s => s.value));
          const nextUnused = variants.find(v => !existingIds.has(v.id)) || variants[0];
          appendNewRow(nextUnused ? nextUnused.id : null, '', '');
        };
      }

      const addBundleBtn = modalEl.querySelector('#add-so-bundle-btn');
      if (addBundleBtn) {
        addBundleBtn.onclick = () => {
          appendBundleGroup();
        };
      }

      // Form submit
      modalEl.querySelector('#create-so-form').onsubmit = (e) => {
        e.preventDefault();
        const customerName = modalEl.querySelector('#so-customer-name').value.trim();
        const vehicleNumber = modalEl.querySelector('#so-vehicle').value.trim();
        const driverName = modalEl.querySelector('#so-driver').value.trim();
        const driverPhone = modalEl.querySelector('#so-driver-phone').value.trim();
        const notes = modalEl.querySelector('#so-notes').value.trim();

        const assignedStaffIds = Array.from(modalEl.querySelectorAll('input[name="assignedStaff"]:checked'))
          .map(cb => cb.value);

        const rows = tbody.querySelectorAll('.so-line-row');
        const lines = [];
        const ctlPlansToCommit = [];

        // 1. Process regular product lines
        for (const row of rows) {
          const prodInput = row.querySelector('.pv-selected-product-id');
          const varInput = row.querySelector('.pv-selected-variant-id') || row.querySelector('.pv-var-input');
          const pId = prodInput ? prodInput.value : '';
          let variantId = varInput ? varInput.value : '';

          let selectedProduct = products.find(p => p.id === pId);
          let selectedVariant = variants.find(v => v.id === variantId);

          if (!selectedProduct && selectedVariant) {
            selectedProduct = products.find(p => p.id === selectedVariant.productId);
          }

          if (!selectedVariant && selectedProduct) {
            const prodVariants = variants.filter(v => v.productId === selectedProduct.id);
            if (prodVariants.length === 0) {
              // Auto-create standard variant for product with no variants
              selectedVariant = productService.createVariant({
                productId: selectedProduct.id,
                name: selectedProduct.businessName || selectedProduct.customerName || 'Standard',
                sku: selectedProduct.code,
                costPrice: 0,
                sellingPrice: 0,
                unit: selectedProduct.base_unit || selectedProduct.baseUnitId || 'PCS',
                isActive: true
              });
              variantId = selectedVariant.id;
              variants.push(selectedVariant);
            } else if (prodVariants.length === 1) {
              selectedVariant = prodVariants[0];
              variantId = selectedVariant.id;
            }
          }

          const isCtl = Boolean(selectedVariant?.isCutToLength || selectedVariant?.rollLength || (selectedProduct && (selectedProduct.cut_to_length || selectedProduct.enableRollTracking)));
          const baseUnit = selectedVariant?.rollUnit || (isCtl ? (selectedProduct?.base_unit || 'ft') : (selectedVariant?.unit || 'PCS'));

          const warehouseQty = Number(row.querySelector('.so-wh-qty')?.value) || 0;
          const officeQty = Number(row.querySelector('.so-office-qty')?.value) || 0;
          const totalQty = warehouseQty + officeQty;

          if (variantId && totalQty > 0) {
            const packagingSelect = row.querySelector('.so-item-packaging');
            const mode = isCtl && packagingSelect ? packagingSelect.value : null;
            let isRoll = false;
            let rollSize = null;
            let totalFeet = null;

            if (isCtl) {
              const stockRec = cutToLengthService.getVariantStock('wh-1', variantId);
              rollSize = stockRec?.rollLength || Number(selectedVariant?.rollLength) || 5000;
              isRoll = (mode === 'rolls');
              totalFeet = isRoll ? totalQty * rollSize : totalQty;

              // Validate & prepare warehouse allocation
              if (warehouseQty > 0) {
                const whPlan = cutToLengthService.simulateAllocation({
                  warehouseId: 'wh-1',
                  variantId,
                  mode,
                  quantity: warehouseQty
                });
                if (!whPlan.canFulfill) {
                  toast.show(`WH Allocation: ${whPlan.error || 'Cannot fulfill requested quantity'}`, 'error');
                  return;
                }
                ctlPlansToCommit.push(whPlan);
              }

              // Validate & prepare office allocation
              if (officeQty > 0) {
                const offPlan = cutToLengthService.simulateAllocation({
                  warehouseId: 'wh-2',
                  variantId,
                  mode,
                  quantity: officeQty
                });
                if (!offPlan.canFulfill) {
                  toast.show(`Office Allocation: ${offPlan.error || 'Cannot fulfill requested quantity'}`, 'error');
                  return;
                }
                ctlPlansToCommit.push(offPlan);
              }
            }

            lines.push({
              variantId,
              warehouseQty,
              officeQty,
              orderedQty: totalQty,
              deliveredQty: 0,
              remainingDeliveryQty: totalQty,
              unit: isCtl ? (isRoll ? 'Rolls' : baseUnit) : (selectedVariant?.unit || 'PCS'),
              packagingName: isCtl ? mode : null,
              mode: isCtl ? mode : null,
              isRoll,
              rollSize,
              totalFeet,
              unitPrice: 0,
              lineTotal: 0
            });
          }
        }

        // 2. Process bundle lines
        const bundleParentRows = tbody.querySelectorAll('.so-bundle-parent-row');
        bundleParentRows.forEach(parentRow => {
          const bUid = parentRow.getAttribute('data-bundle-uid');
          const bId = parentRow.getAttribute('data-bundle-id');
          const bName = parentRow.getAttribute('data-bundle-name');
          const bQty = Number(parentRow.querySelector('.so-bundle-qty-input')?.value) || 1;
          const bPrice = Number(parentRow.getAttribute('data-bundle-price')) || 0;

          const childRows = tbody.querySelectorAll(`.so-bundle-child-row[data-bundle-uid="${bUid}"]`);
          childRows.forEach(child => {
            const vId = child.getAttribute('data-variant-id');
            const pId = child.getAttribute('data-product-id');
            const baseQty = Number(child.getAttribute('data-base-qty')) || 1;
            const unitPrice = Number(child.getAttribute('data-unit-price')) || 0;
            const unit = child.getAttribute('data-unit') || 'PCS';
            const whQty = Number(child.querySelector('.so-wh-qty')?.value) || 0;
            const offQty = Number(child.querySelector('.so-office-qty')?.value) || 0;
            const totQty = whQty + offQty;

            if (totQty > 0) {
              lines.push({
                variantId: vId,
                productId: pId,
                orderedQty: totQty,
                warehouseQty: whQty,
                officeQty: offQty,
                deliveredQty: 0,
                remainingDeliveryQty: totQty,
                unit,
                unitPrice,
                lineTotal: totQty * unitPrice,
                isBundleComponent: true,
                bundleUid: bUid,
                bundleId: bId,
                bundleName: bName,
                bundleQty: bQty,
                bundleUnitPrice: bPrice,
                baseQtyPerBundle: baseQty
              });
            }
          });
        });

        if (lines.length === 0) {
          toast.show('Please allocate at least one product with quantity > 0.', 'error');
          return;
        }

        try {
          const so = salesService.createSalesOrder({
            customerName,
            vehicleNumber,
            driverName,
            driverPhone,
            assignedStaffIds,
            notes,
            lines,
            total: 0
          });

          // Commit all cut-to-length allocations
          for (const plan of ctlPlansToCommit) {
            cutToLengthService.commitAllocation(plan, {
              referenceDocType: 'salesOrder',
              referenceDocId: so.orderNumber,
              notes: so.notes || ''
            });
          }

          toast.show(`Sales Order ${so.orderNumber} created! Inventory allocated successfully.`, 'success');
          closeModal();
          if (onSaved) onSaved();
        } catch (err) {
          toast.show(err.message, 'error');
        }
      };
    }
  });
}
