/**
 * JS Traders ERP - Stock Inwards View (Incoming Stock Demand)
 * 
 * Core Design Principles:
 * 1. For any stock coming in, user adds Stock Inwards.
 * 2. Uses the exact same design and content of Sales Order (previously gatepass), with effect reversed.
 * 3. Pure demand document: does NOT increase physical inventory upon creation.
 * 4. Each line tracks independently: Expected Qty, Received Qty, Remaining Qty.
 * 5. Added Stock Inwards can be converted into a GRN (Goods Received Note).
 * 6. In case of partial receiving, there are multiple GRNs belonging to one Stock Inward order.
 */

import { inwardOrderService } from '../../services/inwardOrderService.js';
import { gatepassService } from '../../services/gatepassService.js';
import { productService } from '../../services/productService.js';
import { inventoryService } from '../../services/inventoryService.js';
import { cutToLengthService } from '../../services/cutToLengthService.js';
import { staffAuthService } from '../../services/staffAuthService.js';
import { storageService } from '../../services/storageService.js';
import { renderTable, bindTableActions } from '../../components/table.js';
import { renderFilterBar } from '../../components/filters.js';
import { openModal, closeModal } from '../../components/modal.js';
import { confirmAction } from '../../components/confirmation.js';
import { renderProductVariantPicker, bindProductVariantPicker } from '../../components/searchableSelect.js';
import { toast } from '../../components/toast.js';

export function renderInwardOrdersView() {
  const orders = inwardOrderService.getInwardOrders();
  const users = storageService.getCollection('users') || [];
  const userMap = new Map(users.map(u => [u.id, u.fullName]));
  const variants = productService.getVariants();
  const varMap = new Map(variants.map(v => [v.id, v.name]));

  const filterBarHtml = renderFilterBar({
    searchPlaceholder: 'Search stock inwards by IO #, supplier/origin, vehicle, notes...',
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
    primaryAction: { label: '+ Create Stock Inward' }
  });

  const columns = [
    {
      key: 'orderNumber',
      label: 'Inward Order #',
      render: row => `
        <div>
          <span class="font-bold text-[#138FCB] font-mono">${row.orderNumber}</span>
          <div class="text-[9px] font-bold text-emerald-600 mt-0.5">DRAFT INWARD GRN</div>
        </div>
      `
    },
    {
      key: 'partyName',
      label: 'Supplier / Origin',
      render: row => `
        <div>
          <div class="font-bold text-slate-800">${row.partyName || 'Supplier / Origin'}</div>
          <div class="text-[10px] text-slate-400 font-mono">Date: ${row.date || 'Today'} ${row.vehicleNumber ? `• ${row.vehicleNumber}` : ''}</div>
        </div>
      `
    },
    {
      key: 'productsAndAllocation',
      label: 'Expected Products & Allocation (WH / Office)',
      render: row => {
        const lines = row.lines || [];
        if (lines.length === 0) {
          return `<span class="text-slate-400 text-xs italic">No items</span>`;
        }
        const shownLines = lines.slice(0, 4);
        const remainingCount = lines.length - shownLines.length;

        return `
          <div class="space-y-2 py-1 min-w-[300px] max-w-[420px]">
            ${shownLines.map(l => {
              const pName = varMap.get(l.variantId) || l.variantName || 'Product Item';
              const rawWh = Number(l.warehouseQty) || 0;
              const rawOff = Number(l.officeQty) || 0;
              const exp = Number(l.expectedQty !== undefined ? l.expectedQty : (rawWh + rawOff)) || 0;
              const whTotal = (rawWh === 0 && rawOff === 0 && exp > 0) ? exp : rawWh;
              const offTotal = rawOff;
              const totalRec = Number(l.receivedQty) || 0;
              const unit = l.packagingName || l.unit || 'PCS';

              let whRec = 0;
              let offRec = 0;
              if (l.receivedWarehouseQty !== undefined || l.receivedOfficeQty !== undefined) {
                whRec = Number(l.receivedWarehouseQty) || 0;
                offRec = Number(l.receivedOfficeQty) || 0;
              } else if (whTotal > 0 && offTotal === 0) {
                whRec = Math.min(totalRec, whTotal);
                offRec = 0;
              } else if (whTotal === 0 && offTotal > 0) {
                whRec = 0;
                offRec = Math.min(totalRec, offTotal);
              } else {
                whRec = Math.min(totalRec, whTotal);
                offRec = Math.min(Math.max(0, totalRec - whRec), offTotal);
              }

              const whPct = whTotal > 0 ? Math.min(100, Math.round((whRec / whTotal) * 100)) : 0;
              const offPct = offTotal > 0 ? Math.min(100, Math.round((offRec / offTotal) * 100)) : 0;

              return `
                <div class="flex items-center justify-between gap-3 py-1.5 border-b border-slate-100 last:border-0 bg-transparent">
                  <div class="min-w-0 pr-2">
                    <div class="font-bold text-slate-800 text-xs truncate" title="${pName}">${pName}</div>
                    <div class="text-[10px] text-slate-400 font-medium">${unit}</div>
                  </div>

                  <div class="shrink-0 space-y-1">
                    <div class="flex items-center gap-1.5 text-[9px] text-slate-500 font-medium">
                      <span class="w-6 font-bold text-slate-600">WH :</span>
                      <span class="font-mono text-slate-700 w-11 text-right">${whRec}/${whTotal}</span>
                      <div class="w-14 sm:w-16 h-1.5 bg-slate-200/80 rounded-full overflow-hidden">
                        <div class="h-full ${whPct >= 100 ? 'bg-emerald-500' : 'bg-[#138FCB]'} rounded-full transition-all" style="width: ${whPct}%"></div>
                      </div>
                    </div>

                    <div class="flex items-center gap-1.5 text-[9px] text-slate-500 font-medium">
                      <span class="w-6 font-bold text-slate-600">O :</span>
                      <span class="font-mono text-slate-700 w-11 text-right">${offRec}/${offTotal}</span>
                      <div class="w-14 sm:w-16 h-1.5 bg-slate-200/80 rounded-full overflow-hidden">
                        <div class="h-full ${offPct >= 100 ? 'bg-emerald-500' : 'bg-amber-500'} rounded-full transition-all" style="width: ${offPct}%"></div>
                      </div>
                    </div>
                  </div>
                </div>
              `;
            }).join('')}
            ${remainingCount > 0 ? `
              <div class="text-[10px] text-slate-400 font-medium pt-1 text-center">
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
        (o.vehicleNumber && o.vehicleNumber.toLowerCase().includes(q)) ||
        (o.driverName && o.driverName.toLowerCase().includes(q)) ||
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

  const users = storageService.getCollection('users') || [];
  const userMap = new Map(users.map(u => [u.id, u.fullName]));
  const variants = productService.getVariants();
  const varMap = new Map(variants.map(v => [v.id, v.name]));

  const columns = [
    {
      key: 'orderNumber',
      label: 'Inward Order #',
      render: row => `
        <div>
          <span class="font-bold text-[#138FCB] font-mono">${row.orderNumber}</span>
          <div class="text-[9px] font-bold text-emerald-600 mt-0.5">DRAFT INWARD GRN</div>
        </div>
      `
    },
    {
      key: 'partyName',
      label: 'Supplier / Origin',
      render: row => `
        <div>
          <div class="font-bold text-slate-800">${row.partyName || 'Supplier / Origin'}</div>
          <div class="text-[10px] text-slate-400 font-mono">Date: ${row.date || 'Today'} ${row.vehicleNumber ? `• ${row.vehicleNumber}` : ''}</div>
        </div>
      `
    },
    {
      key: 'productsAndAllocation',
      label: 'Expected Products & Allocation (WH / Office)',
      render: row => {
        const lines = row.lines || [];
        if (lines.length === 0) {
          return `<span class="text-slate-400 text-xs italic">No items</span>`;
        }
        const shownLines = lines.slice(0, 4);
        const remainingCount = lines.length - shownLines.length;

        return `
          <div class="space-y-2 py-1 min-w-[300px] max-w-[420px]">
            ${shownLines.map(l => {
              const pName = varMap.get(l.variantId) || l.variantName || 'Product Item';
              const rawWh = Number(l.warehouseQty) || 0;
              const rawOff = Number(l.officeQty) || 0;
              const exp = Number(l.expectedQty !== undefined ? l.expectedQty : (rawWh + rawOff)) || 0;
              const whTotal = (rawWh === 0 && rawOff === 0 && exp > 0) ? exp : rawWh;
              const offTotal = rawOff;
              const totalRec = Number(l.receivedQty) || 0;
              const unit = l.packagingName || l.unit || 'PCS';

              let whRec = 0;
              let offRec = 0;
              if (l.receivedWarehouseQty !== undefined || l.receivedOfficeQty !== undefined) {
                whRec = Number(l.receivedWarehouseQty) || 0;
                offRec = Number(l.receivedOfficeQty) || 0;
              } else if (whTotal > 0 && offTotal === 0) {
                whRec = Math.min(totalRec, whTotal);
                offRec = 0;
              } else if (whTotal === 0 && offTotal > 0) {
                whRec = 0;
                offRec = Math.min(totalRec, offTotal);
              } else {
                whRec = Math.min(totalRec, whTotal);
                offRec = Math.min(Math.max(0, totalRec - whRec), offTotal);
              }

              const whPct = whTotal > 0 ? Math.min(100, Math.round((whRec / whTotal) * 100)) : 0;
              const offPct = offTotal > 0 ? Math.min(100, Math.round((offRec / offTotal) * 100)) : 0;

              return `
                <div class="flex items-center justify-between gap-3 py-1.5 border-b border-slate-100 last:border-0 bg-transparent">
                  <div class="min-w-0 pr-2">
                    <div class="font-bold text-slate-800 text-xs truncate" title="${pName}">${pName}</div>
                    <div class="text-[10px] text-slate-400 font-medium">${unit}</div>
                  </div>

                  <div class="shrink-0 space-y-1">
                    <div class="flex items-center gap-1.5 text-[9px] text-slate-500 font-medium">
                      <span class="w-6 font-bold text-slate-600">WH :</span>
                      <span class="font-mono text-slate-700 w-11 text-right">${whRec}/${whTotal}</span>
                      <div class="w-14 sm:w-16 h-1.5 bg-slate-200/80 rounded-full overflow-hidden">
                        <div class="h-full ${whPct >= 100 ? 'bg-emerald-500' : 'bg-[#138FCB]'} rounded-full transition-all" style="width: ${whPct}%"></div>
                      </div>
                    </div>

                    <div class="flex items-center gap-1.5 text-[9px] text-slate-500 font-medium">
                      <span class="w-6 font-bold text-slate-600">O :</span>
                      <span class="font-mono text-slate-700 w-11 text-right">${offRec}/${offTotal}</span>
                      <div class="w-14 sm:w-16 h-1.5 bg-slate-200/80 rounded-full overflow-hidden">
                        <div class="h-full ${offPct >= 100 ? 'bg-emerald-500' : 'bg-amber-500'} rounded-full transition-all" style="width: ${offPct}%"></div>
                      </div>
                    </div>
                  </div>
                </div>
              `;
            }).join('')}
            ${remainingCount > 0 ? `
              <div class="text-[10px] text-slate-400 font-medium pt-1 text-center">
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
  const isCancelled = order.status === 'Cancelled';
  const remainingLines = inwardOrderService.getRemainingExpectedLines(order.id);
  const linkedGRNs = gatepassService.getGRNsByInwardOrder(order.id);

  const contentHtml = `
    <div class="space-y-6 text-xs">
      <!-- SECTION 1: Header Overview -->
      <section class="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-xs space-y-4">
        <div class="flex items-center justify-between border-b border-slate-100 pb-3">
          <h3 class="text-xs font-bold uppercase tracking-wider text-slate-700 flex items-center gap-2">
            <span>📥</span>
            <span>1. Stock Inward Overview (Draft GRN)</span>
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
            <p class="text-sm font-bold text-slate-900">${order.partyName || 'Supplier / Vendor'}</p>
            <p class="text-[11px] text-slate-500">Ref: ${order.referenceNumber || 'N/A'}</p>
          </div>

          <div class="p-3 bg-slate-50/70 rounded-xl border border-slate-200/70 space-y-1">
            <span class="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Order Info</span>
            <p class="text-sm font-bold text-slate-800 font-mono">${order.orderNumber}</p>
            <p class="text-[11px] text-slate-500">Date: ${order.date || 'Today'}</p>
          </div>

          <div class="p-3 bg-emerald-50/50 rounded-xl border border-emerald-200/70 space-y-1">
            <span class="text-[10px] font-bold text-emerald-700 uppercase tracking-wider block">Carrier & Logistics</span>
            <p class="text-xs font-bold text-slate-800">${order.vehicleNumber || 'Unassigned Vehicle'}</p>
            <p class="text-[11px] text-slate-500">Driver: ${order.driverName || 'N/A'} ${order.driverPhone ? `(${order.driverPhone})` : ''}</p>
          </div>
        </div>
      </section>

      <!-- SECTION 2: Expected Lines -->
      <section class="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-xs space-y-4">
        <div class="flex items-center justify-between border-b border-slate-100 pb-3">
          <h3 class="text-xs font-bold uppercase tracking-wider text-slate-700 flex items-center gap-2">
            <span>📦</span>
            <span>2. Expected Stock Lines &amp; Quantity Tracking</span>
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
                <th class="py-2.5 px-3 text-center font-bold text-slate-800">Expected Total</th>
                <th class="py-2.5 px-3 text-center text-emerald-700 font-bold">Received (GRN)</th>
                <th class="py-2.5 px-3 text-center text-blue-600 font-bold">Pending</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-slate-100">
              ${(order.lines || []).map(l => {
                const exp = Number(l.expectedQty) || 0;
                const rec = Number(l.receivedQty) || 0;
                const rem = Math.max(0, exp - rec);
                return `
                  <tr class="hover:bg-slate-50/70">
                    <td class="py-3 px-3 font-semibold text-slate-800">
                      <div>${varMap.get(l.variantId) || 'Item'}</div>
                      ${l.isRoll ? `
                        <div class="text-[10px] text-blue-700 font-bold bg-blue-50/80 px-1.5 py-0.5 rounded border border-blue-200/60 inline-block mt-0.5">
                          Roll (${Number(l.rollSize || 5000).toLocaleString()} ${l.totalFeet ? 'ft' : ''})
                        </div>
                      ` : (l.mode === 'loose_continuous' ? `
                        <div class="text-[10px] text-amber-700 font-bold bg-amber-50/80 px-1.5 py-0.5 rounded border border-amber-200/60 inline-block mt-0.5">
                          loose - continuous
                        </div>
                      ` : (l.packagingName ? `<div class="text-[10px] text-slate-400">${l.packagingName}</div>` : ''))}
                    </td>
                    <td class="py-3 px-3 text-center text-blue-700 font-bold">${l.warehouseQty || 0}</td>
                    <td class="py-3 px-3 text-center text-amber-700 font-bold">${l.officeQty || 0}</td>
                    <td class="py-3 px-3 text-center font-extrabold text-slate-900">
                      ${l.isRoll ? `${exp} Roll${exp !== 1 ? 's' : ''}${l.totalFeet ? `<div class="text-[10px] text-slate-500 font-normal">(${l.totalFeet.toLocaleString()} ft)</div>` : ''}` : `${exp.toLocaleString()} ${l.unit || 'PCS'}`}
                    </td>
                    <td class="py-3 px-3 text-center text-emerald-600 font-bold">${rec}</td>
                    <td class="py-3 px-3 text-center ${rem > 0 ? 'text-blue-600 font-extrabold' : 'text-slate-400'}">${rem}</td>
                  </tr>
                `;
              }).join('')}
            </tbody>
          </table>
        </div>
      </section>

      <!-- SECTION 3: Linked GRNs -->
      <section class="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-xs space-y-4">
        <div class="flex items-center justify-between border-b border-slate-100 pb-3">
          <h3 class="text-xs font-bold uppercase tracking-wider text-slate-700 flex items-center gap-2">
            <span>📦</span>
            <span>3. Linked Goods Received Notes / GRNs (${linkedGRNs.length})</span>
          </h3>
          <span class="text-[10px] text-slate-400 font-semibold">Multiple GRNs can be created for partial receipts</span>
        </div>

        ${linkedGRNs.length === 0 ? `
          <div class="p-4 bg-slate-50/60 rounded-xl text-center text-slate-400">
            No goods receipt notes issued against this order yet.
          </div>
        ` : `
          <div class="border border-slate-200/80 rounded-xl overflow-hidden">
            <table class="w-full text-left text-xs">
              <thead class="bg-slate-50 text-[10px] uppercase font-bold text-slate-500 border-b border-slate-200">
                <tr>
                  <th class="py-2 px-3">GRN #</th>
                  <th class="py-2 px-3">Date</th>
                  <th class="py-2 px-3">Carrier &amp; Driver</th>
                  <th class="py-2 px-3 text-center">Received Units</th>
                  <th class="py-2 px-3 text-right">Status</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-slate-100">
                ${linkedGRNs.map(g => {
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
            <span>📥 Convert to GRN</span>
          </button>
        ` : ''}
      </div>
    </div>
  `;

  openModal({
    title: `Stock Inward: ${order.orderNumber}`,
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
            title: `Cancel Inward Order: ${order.orderNumber}`,
            message: 'Are you sure you want to cancel this Inward Order? Pending expected items will no longer be available for receipt.',
            confirmLabel: 'Yes, Cancel Order',
            isDestructive: true,
            onConfirm: () => {
              try {
                inwardOrderService.cancelInwardOrder(order.id);
                toast.show(`Inward Order ${order.orderNumber} cancelled.`, 'success');
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
    toast.show('This Inward Order has already been fully received.', 'warning');
    return;
  }
  const variants = productService.getVariants();
  const varMap = new Map(variants.map(v => [v.id, v]));
  const warehouses = storageService.getCollection('warehouses') || [];

  const contentHtml = `
    <form id="create-grn-form" class="space-y-4 text-xs">
      <div class="bg-emerald-50/70 p-3.5 rounded-2xl border border-emerald-200/80 flex justify-between items-center">
        <div>
          <span class="text-[10px] font-bold uppercase tracking-wider text-emerald-700">Originating Inward Order</span>
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
            ${warehouses.map(w => `<option value="${w.id}">${w.name} (${w.city || ''})</option>`).join('')}
          </select>
        </div>
        <div>
          <label class="block font-bold text-slate-700 mb-1">Vehicle / Carrier #</label>
          <input type="text" id="grn-vehicle-input" placeholder="e.g. LES-4029 Truck" value="${order.vehicleNumber || 'LES-4029 Truck'}" class="w-full px-3 py-2 border border-slate-200 rounded-xl focus:outline-none focus:border-emerald-600 font-mono text-slate-800 shadow-2xs">
        </div>
        <div>
          <label class="block font-bold text-slate-700 mb-1">Driver / Transporter</label>
          <input type="text" id="grn-driver-input" placeholder="e.g. Tariq Mehmood" value="${order.driverName || 'Tariq Mehmood'}" class="w-full px-3 py-2 border border-slate-200 rounded-xl focus:outline-none focus:border-emerald-600 text-slate-800 shadow-2xs">
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
              <th class="py-2.5 px-3 text-center text-blue-600 font-bold">Pending</th>
              <th class="py-2.5 px-3 text-center w-32 text-emerald-800 font-bold">Receive Now (GRN)</th>
            </tr>
          </thead>
          <tbody id="grn-lines-tbody" class="divide-y divide-slate-100">
            ${remainingLines.map(line => {
              const v = varMap.get(line.variantId) || {};
              const origLine = (order.lines || []).find(l => l.variantId === line.variantId) || {};
              const isRoll = Boolean(line.isRoll || origLine.isRoll || origLine.mode === 'roll');
              const isLoose = origLine.mode === 'loose_continuous';
              return `
                <tr class="hover:bg-slate-50/70" data-variant-id="${line.variantId}" data-remaining="${line.remainingQty}">
                  <td class="py-2.5 px-3 font-semibold text-slate-800">
                    <div>${v.name || 'Item'}</div>
                    ${isRoll ? `
                      <div class="text-[10px] text-blue-700 font-bold bg-blue-50/80 px-1.5 py-0.5 rounded border border-blue-200/60 inline-block mt-0.5">
                        Roll (${Number(origLine.rollSize || line.rollSize || 5000).toLocaleString()} ft)
                      </div>
                    ` : (isLoose ? `
                      <div class="text-[10px] text-amber-700 font-bold bg-amber-50/80 px-1.5 py-0.5 rounded border border-amber-200/60 inline-block mt-0.5">
                        loose - continuous
                      </div>
                    ` : (v.sku ? `<div class="text-[10px] text-slate-400 font-mono">${v.sku}</div>` : ''))}
                  </td>
                  <td class="py-2.5 px-3 text-center text-slate-600">${line.expectedQty} ${line.unit || 'PCS'}</td>
                  <td class="py-2.5 px-3 text-center text-emerald-600 font-bold">${line.receivedQty}</td>
                  <td class="py-2.5 px-3 text-center font-bold text-blue-600">${line.remainingQty} ${line.unit || 'PCS'}</td>
                  <td class="py-2.5 px-3 text-center">
                    <input type="number" min="0" max="${line.remainingQty}" value="${line.remainingQty}" class="grn-line-qty w-24 text-center border border-emerald-300 rounded-xl px-2 py-1.5 text-xs font-bold focus:border-emerald-600 shadow-2xs bg-emerald-50/30">
                  </td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      </div>

      <div>
        <label class="block font-bold text-slate-700 mb-1">Receipt Notes / Gate Instructions</label>
        <textarea id="grn-notes-input" rows="2" placeholder="Inspection remarks, quality checks..." class="w-full px-3 py-2 border border-slate-200 rounded-xl focus:outline-none focus:border-emerald-600 text-slate-800 shadow-2xs resize-none"></textarea>
      </div>
    </form>
  `;

  const footerHtml = `
    <div class="flex items-center space-x-2 text-xs text-slate-400">
      <span class="w-2 h-2 rounded-full bg-emerald-500"></span>
      <span>🛡️ Generates Goods Received Note (GRN)</span>
    </div>
    <div class="flex items-center space-x-3 w-full sm:w-auto justify-end">
      <button id="grn-cancel-btn" type="button" class="px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100 rounded-xl transition-colors border border-slate-200 cursor-pointer">
        Cancel
      </button>
      <button id="grn-submit-btn" type="button" class="inline-flex items-center space-x-2 px-5 py-2.5 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 rounded-xl shadow-xs transition-all active:scale-[0.98] cursor-pointer">
        <span>📥 Issue GRN</span>
      </button>
    </div>
  `;

  openModal({
    title: `Convert to GRN: ${order.orderNumber}`,
    subtitle: 'Generate physical Goods Received Note for warehouse receiving. Supports partial receiving batches.',
    badge: 'GRN',
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
        let hasError = false;

        modalEl.querySelectorAll('#grn-lines-tbody tr').forEach(tr => {
          const variantId = tr.dataset.variantId;
          const maxRem = Number(tr.dataset.remaining) || 0;
          const qtyInput = tr.querySelector('.grn-line-qty');
          const qty = Number(qtyInput?.value) || 0;
          if (qty > 0) {
            if (qty > maxRem) {
              toast.show(`Quantity cannot exceed pending ${maxRem}.`, 'error');
              hasError = true;
              return;
            }
            const origLine = (order.lines || []).find(l => l.variantId === variantId) || {};
            const isRoll = Boolean(origLine.isRoll || origLine.mode === 'roll');
            const rollSize = isRoll ? (Number(origLine.rollSize) || 5000) : null;
            lines.push({
              variantId,
              warehouseQty: selectedWh === 'wh-1' ? qty : 0,
              officeQty: selectedWh === 'wh-2' ? qty : 0,
              quantity: qty,
              unit: origLine.unit || 'PCS',
              isRoll,
              mode: origLine.mode || null,
              packagingName: origLine.packagingName || null,
              rollSize,
              totalFeet: isRoll ? qty * rollSize : qty
            });
          }
        });

        if (hasError) return;

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
          toast.show(`Goods Received Note ${gp.gatepassNumber} created successfully!`, 'success');
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
          <div style="font-size: 11px; font-weight: 800; color: #64748b;">(DRAFT INWARD GRN)</div>
          <div style="font-size: 13px; font-weight: 800; font-family: monospace;">${order.orderNumber}</div>
          <div style="font-size: 11px; color: #64748b;">Date: ${order.date || 'Today'}</div>
        </div>
      </div>

      <div class="grid">
        <div class="card">
          <div class="card-label">Supplier / Origin Information</div>
          <div style="font-size: 14px; font-weight: 800; color: #0f172a;">${order.partyName || 'Supplier / Origin'}</div>
          <div style="font-size: 11px; color: #475569; margin-top: 2px;">Carrier / Vehicle: <strong>${order.vehicleNumber || 'Unassigned'}</strong></div>
          <div style="font-size: 11px; color: #475569;">Driver: <strong>${order.driverName || 'N/A'}</strong> ${order.driverPhone ? `(${order.driverPhone})` : ''}</div>
        </div>
        <div class="card">
          <div class="card-label">Receipt &amp; GRN Status</div>
          <div>Status: <strong>${order.status}</strong></div>
          <div>Linked GRNs: <strong>${linkedGRNs.length} GRN(s)</strong></div>
          <div style="font-size: 11px; color: #64748b; margin-top: 4px;">* Physical stock is increased only upon Goods Received Note (GRN) approval.</div>
        </div>
      </div>

      <table>
        <thead>
          <tr>
            <th>#</th>
            <th>Item Description</th>
            <th class="text-center">Receiving to WH</th>
            <th class="text-center">Receiving to Office</th>
            <th class="text-center">Expected Qty</th>
            <th class="text-center">Received (GRN)</th>
            <th class="text-center">Pending Qty</th>
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
                <td>
                  <strong>${varMap.get(l.variantId) || 'Product Item'}</strong>
                  ${l.isRoll ? `
                    <div style="font-size: 10px; color: #1e40af; font-weight: bold;">
                      Roll (${Number(l.rollSize || 5000).toLocaleString()} ${l.totalFeet ? 'ft' : ''})
                    </div>
                  ` : (l.mode === 'loose_continuous' ? `
                    <div style="font-size: 10px; color: #b45309; font-weight: bold;">
                      loose - continuous
                    </div>
                  ` : (l.packagingName ? `<div style="font-size: 10px; color: #64748b;">${l.packagingName}</div>` : ''))}
                </td>
                <td class="text-center font-mono">${l.warehouseQty || 0}</td>
                <td class="text-center font-mono">${l.officeQty || 0}</td>
                <td class="text-center font-mono" style="font-weight: 800;">
                  ${l.isRoll ? `${exp} Roll${exp !== 1 ? 's' : ''}${l.totalFeet ? ` (${l.totalFeet.toLocaleString()} ft)` : ''}` : `${exp.toLocaleString()} ${l.unit || 'PCS'}`}
                </td>
                <td class="text-center font-mono" style="color: #059669; font-weight: 700;">${rec}</td>
                <td class="text-center font-mono" style="color: #2563eb; font-weight: 700;">${rem}</td>
              </tr>
            `;
          }).join('')}
        </tbody>
      </table>

      ${order.notes ? `
        <div style="margin-bottom: 20px; font-size: 11px; background: #f0fdf4; border: 1px solid #dcfce7; padding: 10px; border-radius: 6px;">
          <strong>Receipt Instructions / Notes:</strong> ${order.notes}
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
          <div class="sig-line">Transporter / Carrier Acknowledgment</div>
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
 * Add Stock Inward Dialog
 * SAME design and content as Sales Order (previously gatepass), with effect reversed.
 * Represents draft GRN / incoming demand requirement.
 */
function openCreateInwardOrderModal(onSaved) {
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
    const rollLen = Number(selectedVariant?.rollLength || selectedVariant?.rollSize || selectedProduct?.packagingUnits?.[0]?.factor || 5000);
    const isLoose = initialPackaging === 'loose_continuous' || initialPackaging === 'loose - continuous';

    const whStock = vId ? inventoryService.getBalance('wh-1', vId) : 0;
    const officeStock = vId ? inventoryService.getBalance('wh-2', vId) : 0;
    const wVal = (whQty !== '' && whQty !== null && whQty !== undefined) ? whQty : '';
    const oVal = (offQty !== '' && offQty !== null && offQty !== undefined) ? offQty : '';
    const lineTotal = (Number(wVal) || 0) + (Number(oVal) || 0);

    const pickerHtml = renderProductVariantPicker({
      rowId: `sio-row-${rowIdx}`,
      selectedProductId: selectedProduct ? selectedProduct.id : null,
      selectedVariantId: vId || null,
      products,
      variants,
      whStock,
      officeStock,
      unit: baseUnit
    });

    const ctlHtml = `
      <div class="sio-ctl-container ${isCtl ? '' : 'hidden'} mt-2.5 pt-2 border-t border-slate-100 flex flex-wrap items-center justify-between gap-2 bg-slate-50/80 p-2 rounded-xl border border-slate-200/60">
        <div class="flex items-center gap-1.5">
          <span class="text-[10px] font-bold text-slate-500 uppercase tracking-wider">📦 Inward Type:</span>
          <select class="sio-item-packaging text-xs font-bold border border-slate-200 rounded-lg px-2.5 py-1 bg-white text-slate-800 focus:outline-none focus:border-emerald-600 shadow-2xs cursor-pointer">
            <option value="roll" data-mode="roll" data-is-roll="1" data-factor="${rollLen}" ${!isLoose ? 'selected' : ''}>
              1. Roll (${rollLen.toLocaleString()} ${baseUnit})
            </option>
            <option value="loose_continuous" data-mode="loose_continuous" data-is-roll="0" data-factor="1" ${isLoose ? 'selected' : ''}>
              2. loose - continuous (${baseUnit})
            </option>
          </select>
        </div>
        <div class="sio-ctl-stock-pill text-[10px] font-semibold text-slate-600 bg-white border border-slate-200 px-2.5 py-1 rounded-lg shadow-2xs">
          <!-- Live physical rolls & loose breakdown -->
        </div>
      </div>
    `;

    return `
      <tr class="sio-line-row hover:bg-slate-50/70 transition-colors" data-row-index="${rowIdx}">
        <td class="p-2.5 align-top">
          ${pickerHtml}
          ${ctlHtml}
        </td>
        <td class="p-2.5 text-center align-top">
          <span class="wh-stock-indicator block text-[10px] text-blue-700 bg-blue-50/80 px-1.5 py-0.5 rounded-lg border border-blue-200/80 font-bold mb-1.5 whitespace-nowrap overflow-hidden text-ellipsis">
            ${vId ? `WH Stock: ${whStock.toLocaleString()} ${baseUnit}` : 'WH Stock: —'}
          </span>
          <input type="number" min="0" value="${wVal}" placeholder="0" class="sio-wh-qty w-20 mx-auto text-center text-xs font-black rounded-xl border border-blue-200 focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100 py-1.5 px-2 bg-white text-blue-900 shadow-2xs">
        </td>
        <td class="p-2.5 text-center align-top">
          <span class="office-stock-indicator block text-[10px] text-amber-800 bg-amber-50/80 px-1.5 py-0.5 rounded-lg border border-amber-200/80 font-bold mb-1.5 whitespace-nowrap overflow-hidden text-ellipsis">
            ${vId ? `Office Stock: ${officeStock.toLocaleString()} ${baseUnit}` : 'Office Stock: —'}
          </span>
          <input type="number" min="0" value="${oVal}" placeholder="0" class="sio-office-qty w-20 mx-auto text-center text-xs font-black rounded-xl border border-amber-200 focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100 py-1.5 px-2 bg-white text-amber-900 shadow-2xs">
        </td>
        <td class="p-2.5 text-right align-top pt-3.5">
          <span class="sio-total-calc font-black text-slate-900 text-sm">${lineTotal > 0 ? `${lineTotal.toLocaleString()} ${baseUnit}` : '—'}</span>
        </td>
        <td class="p-2.5 text-center align-top pt-3">
          <button type="button" class="sio-remove-row-btn w-8 h-8 inline-flex items-center justify-center rounded-xl text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition-colors cursor-pointer" title="Remove line item">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
              <path d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" stroke-linecap="round" stroke-linejoin="round"></path>
            </svg>
          </button>
        </td>
      </tr>
    `;
  };

  const contentHtml = `
    <form id="create-sio-form" class="space-y-6 text-xs">
      <!-- SECTION 1: Supplier & Logistics Configuration -->
      <section class="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-xs space-y-4" data-purpose="supplier-and-logistics">
        <div class="flex items-center justify-between border-b border-slate-100 pb-3">
          <h3 class="text-xs font-bold uppercase tracking-wider text-slate-700 flex items-center gap-2">
            <span>📥</span>
            <span>1. Supplier &amp; Logistics Details</span>
          </h3>
          <span class="text-[10px] text-slate-400 font-medium">All fields marked with <span class="text-red-500 font-bold">*</span> are required</span>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-12 gap-4">
          <!-- Supplier / Origin Name -->
          <div class="md:col-span-12 space-y-1.5">
            <label class="text-xs font-semibold text-slate-700" for="sio-party-name">Supplier / Origin Name <span class="text-red-500">*</span></label>
            <input type="text" id="sio-party-name" required placeholder="Enter Supplier / Vendor / Factory Name" class="w-full text-xs font-medium rounded-xl border border-slate-200 focus:border-emerald-600 focus:ring focus:ring-emerald-100 py-2.5 px-3 text-slate-800 bg-white shadow-2xs">
          </div>

          <!-- Vehicle Number -->
          <div class="md:col-span-4 space-y-1.5">
            <label class="text-xs font-semibold text-slate-700" for="sio-vehicle">Carrier / Truck Number <span class="text-red-500">*</span></label>
            <input type="text" id="sio-vehicle" required placeholder="e.g. LES-4029 Truck" value="LES-4029 Truck" class="w-full text-xs font-medium rounded-xl border border-slate-200 focus:border-emerald-600 focus:ring focus:ring-emerald-100 py-2.5 px-3 text-slate-800 bg-white shadow-2xs">
          </div>

          <!-- Driver Name -->
          <div class="md:col-span-4 space-y-1.5">
            <label class="text-xs font-semibold text-slate-700" for="sio-driver">Driver / Transporter <span class="text-red-500">*</span></label>
            <input type="text" id="sio-driver" required placeholder="e.g. Tariq Mehmood" value="Tariq Mehmood" class="w-full text-xs font-medium rounded-xl border border-slate-200 focus:border-emerald-600 focus:ring focus:ring-emerald-100 py-2.5 px-3 text-slate-800 bg-white shadow-2xs">
          </div>

          <!-- Driver Phone -->
          <div class="md:col-span-4 space-y-1.5">
            <label class="text-xs font-semibold text-slate-700" for="sio-driver-phone">Driver Phone</label>
            <input type="tel" id="sio-driver-phone" placeholder="e.g. +92 345 6789012" value="+92 345 6789012" class="w-full text-xs font-medium rounded-xl border border-slate-200 focus:border-emerald-600 focus:ring focus:ring-emerald-100 py-2.5 px-3 text-slate-800 bg-white shadow-2xs">
          </div>
        </div>
      </section>

      <!-- SECTION 2: Inward Items & Target Facility Allocation Table -->
      <section class="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-xs space-y-4" data-purpose="inward-items-section">
        <div class="flex items-center justify-between border-b border-slate-100 pb-3">
          <div class="flex items-center space-x-2">
            <h3 class="text-xs font-bold uppercase tracking-wider text-slate-700 flex items-center gap-1.5">
              <span>📦</span>
              <span>2. Inward Items &amp; Receiving Allocation (No Rates/Amounts)</span>
            </h3>
            <span id="sio-lines-count-badge" class="px-2 py-0.5 text-[10px] font-semibold rounded-full bg-slate-100 text-slate-600">1 Product</span>
          </div>
          <span class="text-[10px] text-slate-400 font-medium">Type to search catalog &amp; pick variants</span>
        </div>

        <!-- Table Container -->
        <div class="overflow-visible border border-slate-200/80 rounded-xl">
          <table class="w-full text-left text-xs">
            <thead class="bg-slate-50 text-slate-500 uppercase text-[10px] tracking-wider border-b border-slate-200/80">
              <tr>
                <th class="py-3 px-3 w-[62%] font-semibold">Product &amp; Variant SKU Selection</th>
                <th class="py-3 px-2 w-[13%] font-semibold text-center">Receiving to WH *</th>
                <th class="py-3 px-2 w-[13%] font-semibold text-center">Receiving to Office *</th>
                <th class="py-3 px-3 w-[8%] font-semibold text-right">Cargo Qty</th>
                <th class="py-3 px-2 w-[4%] font-semibold text-center">Action</th>
              </tr>
            </thead>
            <tbody id="sio-items-tbody" class="divide-y divide-slate-100 text-slate-700">
              ${renderRowHtml(null, '', '', 0)}
            </tbody>
          </table>
        </div>

        <!-- Action Row under Table -->
        <div class="pt-1">
          <button type="button" id="add-sio-row-btn" class="inline-flex items-center space-x-2 px-4 py-2.5 bg-emerald-50/80 hover:bg-emerald-100 text-emerald-700 rounded-xl text-xs font-bold border border-emerald-200 transition-all cursor-pointer shadow-2xs hover:shadow-xs active:scale-98">
            <span class="text-base leading-none font-extrabold">+</span>
            <span>Add Line Item</span>
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
          <span class="text-[10px] text-slate-400">Staff receive instant mobile alert for unloading &amp; inspection</span>
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
                    <input type="checkbox" name="assignedStaff" value="${staff.id}" checked class="w-4 h-4 rounded text-emerald-600 focus:ring-0">
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
          <label class="text-xs font-semibold text-slate-700" for="sio-notes">Receiving Notes / Quality Instructions</label>
          <textarea class="w-full text-xs rounded-xl border border-slate-200 focus:border-emerald-600 focus:ring focus:ring-emerald-100 text-slate-700 p-3 resize-none shadow-2xs" id="sio-notes" placeholder="Consignment packing details, batch numbers, inspection checkpoints..." rows="3"></textarea>
        </div>

        <!-- Summary Breakdown Card -->
        <div class="lg:col-span-5 bg-white p-5 rounded-2xl border border-slate-200/80 shadow-xs space-y-3" data-purpose="totals-summary-card">
          <h3 class="text-xs font-bold uppercase tracking-wider text-slate-700 pb-1 border-b border-slate-100">Inward Cargo Summary</h3>
          <div class="space-y-2 text-xs">
            <div class="flex justify-between text-slate-600">
              <span>Receiving to WH (wh-1)</span>
              <span id="summary-wh-qty" class="font-bold text-blue-700">0 PCS</span>
            </div>
            <div class="flex justify-between text-slate-600">
              <span>Receiving to Office (wh-2)</span>
              <span id="summary-off-qty" class="font-bold text-amber-700">0 PCS</span>
            </div>
            <div class="flex justify-between text-slate-600">
              <span>Document Type</span>
              <span class="text-emerald-700 font-semibold bg-emerald-50 px-2 py-0.5 rounded text-[10px]">Stock Inward (Draft GRN)</span>
            </div>
          </div>

          <!-- Grand Total Highlight Card -->
          <div class="mt-4 pt-3 bg-emerald-50/50 -mx-5 -mb-5 p-5 rounded-b-2xl border-t border-emerald-100 flex items-center justify-between">
            <div>
              <p class="text-[11px] font-bold uppercase tracking-wider text-emerald-800">Total Inward Cargo</p>
              <p class="text-[9px] text-slate-400">Does not increase inventory until GRN approval</p>
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
      <span>🛡️ Creates Stock Inward Order (Draft GRN)</span>
    </div>
    <div class="flex items-center space-x-3 w-full sm:w-auto justify-end">
      <button id="sio-cancel-btn" type="button" class="px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100 rounded-xl transition-colors border border-slate-200 cursor-pointer">
        Cancel
      </button>
      <button type="submit" form="create-sio-form" class="inline-flex items-center space-x-2 px-5 py-2.5 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 rounded-xl shadow-xs transition-all active:scale-[0.98] cursor-pointer">
        <span>Save Stock Inward</span>
      </button>
    </div>
  `;

  openModal({
    title: 'Create Stock Inward',
    subtitle: 'Add incoming stock demand without rates/amounts. Acts as draft GRN convertible to physical GRNs.',
    badge: 'STOCK INWARD',
    contentHtml,
    footerHtml,
    size: 'max-w-5xl',
    onOpen: (modalEl) => {
      const cancelBtn = modalEl.querySelector('#sio-cancel-btn');
      if (cancelBtn) cancelBtn.onclick = () => closeModal();

      const tbody = modalEl.querySelector('#sio-items-tbody');
      const addRowBtn = modalEl.querySelector('#add-sio-row-btn');
      const summaryWh = modalEl.querySelector('#summary-wh-qty');
      const summaryOff = modalEl.querySelector('#summary-off-qty');
      const summaryTotal = modalEl.querySelector('#summary-total-qty');
      const lineCountBadge = modalEl.querySelector('#sio-lines-count-badge');
      let rowCounter = 1;

      const updateRowCalculations = (row) => {
        const prodInput = row.querySelector('.pv-selected-product-id');
        const varInput = row.querySelector('.pv-selected-variant-id') || row.querySelector('.pv-var-input');
        const whIndicator = row.querySelector('.wh-stock-indicator');
        const offIndicator = row.querySelector('.office-stock-indicator');
        const whQtyInput = row.querySelector('.sio-wh-qty');
        const offQtyInput = row.querySelector('.sio-office-qty');
        const totalDisplay = row.querySelector('.sio-total-calc');
        const ctlContainer = row.querySelector('.sio-ctl-container');
        const packagingSelect = row.querySelector('.sio-item-packaging');
        const ctlStockPill = row.querySelector('.sio-ctl-stock-pill');

        let vId = varInput ? varInput.value : '';
        const pId = prodInput ? prodInput.value : '';
        let selectedVariant = variants.find(v => v.id === vId);
        const selectedProduct = selectedVariant
          ? products.find(p => p.id === selectedVariant.productId)
          : (pId ? products.find(p => p.id === pId) : null);

        if (!selectedVariant && selectedProduct) {
          const prodVariants = variants.filter(v => v.productId === selectedProduct.id);
          if (prodVariants.length === 1) {
            selectedVariant = prodVariants[0];
            vId = selectedVariant.id;
          }
        }

        if (!vId && !selectedProduct) {
          if (whIndicator) whIndicator.textContent = 'WH Stock: —';
          if (offIndicator) offIndicator.textContent = 'Office Stock: —';
          if (totalDisplay) totalDisplay.textContent = '—';
          if (ctlContainer) ctlContainer.classList.add('hidden');
          return;
        }

        const isCtl = Boolean(selectedVariant?.isCutToLength || selectedVariant?.rollLength || (selectedProduct && (selectedProduct.cut_to_length || selectedProduct.enableRollTracking)));
        const baseUnit = selectedVariant?.rollUnit || (isCtl ? (selectedProduct?.base_unit || 'ft') : (selectedVariant?.unit || 'PCS'));

        const rollLen = Number(selectedVariant?.rollLength || selectedVariant?.rollSize || selectedProduct?.packagingUnits?.[0]?.factor || 5000);

        if (isCtl && ctlContainer && packagingSelect) {
          ctlContainer.classList.remove('hidden');

          const currentVal = packagingSelect.value;
          const currentMode = packagingSelect.options[packagingSelect.selectedIndex]?.getAttribute('data-mode') || (currentVal === 'loose_continuous' ? 'loose_continuous' : 'roll');

          // Always ensure both "roll" and "loose - continuous" options exist
          const expectedOptionsHtml = `
            <option value="roll" data-mode="roll" data-is-roll="1" data-factor="${rollLen}" ${currentMode !== 'loose_continuous' ? 'selected' : ''}>
              1. Roll (${rollLen.toLocaleString()} ${baseUnit})
            </option>
            <option value="loose_continuous" data-mode="loose_continuous" data-is-roll="0" data-factor="1" ${currentMode === 'loose_continuous' ? 'selected' : ''}>
              2. loose - continuous (${baseUnit})
            </option>
          `.trim();

          const currentNormalized = packagingSelect.innerHTML.replace(/\s+/g, ' ').trim();
          const expectedNormalized = expectedOptionsHtml.replace(/\s+/g, ' ').trim();

          if (currentNormalized !== expectedNormalized) {
            packagingSelect.innerHTML = expectedOptionsHtml;
          }

          const selectedOption = packagingSelect.options[packagingSelect.selectedIndex] || packagingSelect.options[0];
          const isRoll = selectedOption?.getAttribute('data-is-roll') === '1' || selectedOption?.value === 'roll';
          const rollFactor = isRoll ? rollLen : 1;

          const whSummary = cutToLengthService.getSummary(selectedProduct?.id, 'wh-1', vId);
          const offSummary = cutToLengthService.getSummary(selectedProduct?.id, 'wh-2', vId);

          if (ctlStockPill && whSummary) {
            ctlStockPill.innerHTML = `
              <span class="font-bold text-[#138FCB]">WH:</span> ${whSummary.fullRollsCount} rolls + ${whSummary.loosePiecesFootage.toLocaleString()} ${baseUnit} loose | <span class="font-bold text-amber-700">Office:</span> ${offSummary?.fullRollsCount || 0} rolls + ${(offSummary?.loosePiecesFootage || 0).toLocaleString()} ${baseUnit}
            `;
          }

          if (isRoll) {
            const whRollCount = whSummary ? whSummary.fullRollsCount : 0;
            const offRollCount = offSummary ? offSummary.fullRollsCount : 0;

            if (whIndicator) whIndicator.textContent = `WH: ${whRollCount} Full Rolls (${rollLen.toLocaleString()} ${baseUnit}/roll)`;
            if (offIndicator) offIndicator.textContent = `Office: ${offRollCount} Full Rolls (${rollLen.toLocaleString()} ${baseUnit}/roll)`;
            if (whQtyInput) whQtyInput.placeholder = '0 Rolls';
            if (offQtyInput) offQtyInput.placeholder = '0 Rolls';
          } else {
            const whLoose = whSummary ? whSummary.loosePiecesFootage : 0;
            const whTotal = whSummary ? whSummary.totalFootage : 0;
            const offLoose = offSummary ? offSummary.loosePiecesFootage : 0;
            const offTotal = offSummary ? offSummary.totalFootage : 0;

            if (whIndicator) whIndicator.textContent = `WH: ${whLoose.toLocaleString()} ${baseUnit} Loose (${whTotal.toLocaleString()} ${baseUnit} Total)`;
            if (offIndicator) offIndicator.textContent = `Office: ${offLoose.toLocaleString()} ${baseUnit} Loose (${offTotal.toLocaleString()} ${baseUnit} Total)`;
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
            if (isRoll) {
              const totalFeet = lineTotal * rollFactor;
              if (totalDisplay) totalDisplay.innerHTML = `<span class="text-slate-900 font-extrabold">${lineTotal} Roll${lineTotal > 1 ? 's' : ''}</span> <span class="text-[10px] text-slate-500 font-semibold block">(${totalFeet.toLocaleString()} ${baseUnit})</span>`;
            } else {
              if (totalDisplay) totalDisplay.innerHTML = `<span class="text-slate-900 font-extrabold">${lineTotal.toLocaleString()} ${baseUnit}</span> <span class="text-[10px] text-amber-600 font-semibold block">(loose - continuous)</span>`;
            }
          }
        } else {
          if (ctlContainer) ctlContainer.classList.add('hidden');
          const unit = selectedVariant ? (selectedVariant.unit || 'PCS') : 'PCS';
          const wStock = inventoryService.getBalance('wh-1', vId);
          const oStock = inventoryService.getBalance('wh-2', vId);

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
        const rows = tbody.querySelectorAll('.sio-line-row');
        let totalWh = 0;
        let totalOff = 0;

        rows.forEach(row => {
          const whQty = Number(row.querySelector('.sio-wh-qty')?.value) || 0;
          const offQty = Number(row.querySelector('.sio-office-qty')?.value) || 0;
          totalWh += whQty;
          totalOff += offQty;
        });

        const grandTotal = totalWh + totalOff;
        if (summaryWh) summaryWh.textContent = totalWh > 0 ? `${totalWh.toLocaleString()} Cargo Units` : '0 Units';
        if (summaryOff) summaryOff.textContent = totalOff > 0 ? `${totalOff.toLocaleString()} Cargo Units` : '0 Units';
        if (summaryTotal) summaryTotal.textContent = grandTotal > 0 ? `${grandTotal.toLocaleString()} Cargo Units` : '0 Units';
        if (lineCountBadge) lineCountBadge.textContent = `${rows.length} Product${rows.length > 1 ? 's' : ''}`;

        const removeBtns = tbody.querySelectorAll('.sio-remove-row-btn');
        removeBtns.forEach(btn => {
          if (rows.length <= 1) {
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

        const packagingSelect = row.querySelector('.sio-item-packaging');
        if (packagingSelect) {
          packagingSelect.onchange = () => {
            updateRowCalculations(row);
            updateSummaryTotals();
          };
        }

        const whQtyInput = row.querySelector('.sio-wh-qty');
        const offQtyInput = row.querySelector('.sio-office-qty');
        const removeBtn = row.querySelector('.sio-remove-row-btn');

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
            const rows = tbody.querySelectorAll('.sio-line-row');
            if (rows.length > 1) {
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

      // Initial row binding
      tbody.querySelectorAll('.sio-line-row').forEach(row => {
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

      // Form submit
      modalEl.querySelector('#create-sio-form').onsubmit = (e) => {
        e.preventDefault();
        const partyName = modalEl.querySelector('#sio-party-name').value.trim();
        const vehicleNumber = modalEl.querySelector('#sio-vehicle').value.trim();
        const driverName = modalEl.querySelector('#sio-driver').value.trim();
        const driverPhone = modalEl.querySelector('#sio-driver-phone').value.trim();
        const notes = modalEl.querySelector('#sio-notes').value.trim();

        const assignedStaffIds = Array.from(modalEl.querySelectorAll('input[name="assignedStaff"]:checked'))
          .map(cb => cb.value);

        const rows = tbody.querySelectorAll('.sio-line-row');
        const lines = [];

        rows.forEach(row => {
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

          const warehouseQty = Number(row.querySelector('.sio-wh-qty')?.value) || 0;
          const officeQty = Number(row.querySelector('.sio-office-qty')?.value) || 0;
          const totalQty = warehouseQty + officeQty;

          if (variantId && totalQty > 0) {
            const packagingSelect = row.querySelector('.sio-item-packaging');
            let packagingName = null;
            let mode = null;
            let isRoll = false;
            let rollSize = null;
            let totalFeet = null;

            if (isCtl && packagingSelect) {
              const selectedOpt = packagingSelect.options[packagingSelect.selectedIndex] || packagingSelect.options[0];
              isRoll = selectedOpt?.getAttribute('data-is-roll') === '1' || selectedOpt?.value === 'roll';
              const rollLen = Number(selectedVariant?.rollLength || selectedVariant?.rollSize || selectedProduct?.packagingUnits?.[0]?.factor || 5000);
              rollSize = isRoll ? (Number(selectedOpt?.getAttribute('data-factor')) || rollLen) : null;
              mode = isRoll ? 'roll' : 'loose_continuous';
              packagingName = isRoll ? `Roll (${rollSize.toLocaleString()} ${baseUnit})` : 'loose - continuous';
              totalFeet = isRoll ? totalQty * rollSize : totalQty;
            }

            lines.push({
              variantId,
              warehouseQty,
              officeQty,
              expectedQty: totalQty,
              receivedQty: 0,
              remainingQty: totalQty,
              unit: isCtl ? (isRoll ? 'Roll' : baseUnit) : (selectedVariant?.unit || 'PCS'),
              packagingName: isCtl ? packagingName : null,
              mode: isCtl ? mode : null,
              isRoll,
              rollSize,
              totalFeet
            });
          }
        });

        if (lines.length === 0) {
          toast.show('Please allocate at least one product with quantity > 0.', 'error');
          return;
        }

        try {
          const io = inwardOrderService.createInwardOrder({
            partyName,
            vehicleNumber,
            driverName,
            driverPhone,
            assignedStaffIds,
            notes,
            lines,
            targetWarehouseId: 'wh-1'
          });
          toast.show(`Stock Inward ${io.orderNumber} created! This draft GRN can now be converted to GRN.`, 'success');
          closeModal();
          if (onSaved) onSaved();
        } catch (err) {
          toast.show(err.message, 'error');
        }
      };
    }
  });
}
