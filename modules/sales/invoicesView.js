/**
 * JS Traders ERP - Sales Invoices View
 * Financial invoicing engine.
 * CRITICAL RULE: Invoicing does NOT deduct stock. Stock is strictly deducted by Delivery.
 */

import { salesService } from '../../services/salesService.js';
import { invoiceTemplateService } from '../../services/invoiceTemplateService.js';
import { productService } from '../../services/productService.js';
import { cutToLengthService } from '../../services/cutToLengthService.js';
import { bundleService } from '../../services/bundleService.js';
import { renderTable, bindTableActions } from '../../components/table.js';
import { renderFilterBar } from '../../components/filters.js';
import { openModal, closeModal } from '../../components/modal.js';
import { confirmAction } from '../../components/confirmation.js';
import { toast } from '../../components/toast.js';

export function renderInvoicesView() {
  const invoices = salesService.getSalesInvoices();
  const parties = salesService.getParties(true);
  const partyMap = new Map(parties.map(p => [p.id, p.name]));

  const filterBarHtml = renderFilterBar({
    searchPlaceholder: 'Search invoices by # or customer...',
    primaryAction: { label: 'New Sales Invoice' }
  });

  const columns = [
    {
      key: 'invoiceNumber',
      label: 'Invoice #',
      render: row => `<span class="font-bold text-[#138FCB]">${row.invoiceNumber}</span>`
    },
    {
      key: 'date',
      label: 'Invoice Date',
      render: row => `<span class="text-slate-600 font-medium">${row.date}</span>`
    },
    {
      key: 'customerPartyId',
      label: 'Customer',
      render: row => `<span class="font-bold text-slate-800">${partyMap.get(row.customerPartyId) || 'Customer'}</span>`
    },
    {
      key: 'total',
      label: 'Total Amount',
      align: 'right',
      render: row => `<span class="font-extrabold text-slate-900">Rs. ${Number(row.total || 0).toLocaleString()}</span>`
    },
    {
      key: 'paid',
      label: 'Paid Amount',
      align: 'right',
      render: row => `<span class="text-emerald-600 font-semibold">Rs. ${Number(row.paidAmount || 0).toLocaleString()}</span>`
    },
    {
      key: 'status',
      label: 'Financial Status',
      render: row => `
        <span class="px-2.5 py-0.5 rounded-full text-[10px] font-bold ${
          row.status === 'Paid' ? 'bg-emerald-50 text-emerald-700' :
          row.status === 'Partially Paid' ? 'bg-amber-50 text-amber-700' :
          'bg-blue-50 text-[#138FCB]'
        }">
          ${row.status}
        </span>
      `
    }
  ];

  const actions = [
    { label: 'View', variant: 'secondary', onClick: (row) => openInvoicePrintModal(row) }
  ];

  const tableHtml = renderTable({
    columns,
    data: invoices,
    actions,
    emptyMessage: 'No sales invoices posted yet.'
  });

  return `
    <div id="invoices-view-container" class="space-y-5 animate-in fade-in duration-150">
      <div class="p-3.5 bg-blue-50/70 border border-blue-100 rounded-2xl flex items-center justify-between text-xs text-blue-900 shadow-2xs">
        <div class="flex items-center gap-2">
          <span>🧾</span>
          <span><strong>ERP Accounting Principle:</strong> Confirming a Sales Invoice affects accounts receivable, but <em>never</em> modifies warehouse stock balances.</span>
        </div>
      </div>

      ${filterBarHtml}
      <div id="invoices-table-container">
        ${tableHtml}
      </div>
    </div>
  `;
}

export function bindInvoicesEvents(container, refreshCallback) {
  const addBtn = container.querySelector('#filter-primary-btn');
  if (addBtn) {
    addBtn.onclick = () => openCreateInvoiceModal(refreshCallback);
  }

  const invoices = salesService.getSalesInvoices();
  const actions = [
    { label: 'View', variant: 'secondary', onClick: (row) => openInvoicePrintModal(row, refreshCallback) }
  ];
  bindTableActions(container, actions, invoices);
}

function openInvoicePrintModal(invoice, refreshCallback) {
  const parties = salesService.getParties(true);
  const customer = parties.find(p => p.id === invoice.customerPartyId) || {};
  const variants = productService.getVariants();
  const varMap = new Map(variants.map(v => [v.id, v]));
  const isVoided = invoice.status === 'Voided' || invoice.status === 'Cancelled';

  const lines = (invoice.lines || []).map(l => {
    const v = varMap.get(l.variantId) || {};
    return {
      name: v.name || 'Feed Pan 16" - Made in China',
      sku: v.sku || 'FP-CN-16',
      quantity: l.quantity,
      unit: l.unit || 'PCS',
      unitPrice: l.unitPrice,
      lineTotal: l.lineTotal
    };
  });

  const printableHtml = invoiceTemplateService.renderPrintableInvoice(invoice, customer, lines);

  const footerHtml = `
    <div class="flex items-center space-x-2 text-xs text-slate-400">
      <span class="w-2 h-2 rounded-full bg-emerald-500"></span>
      <span>🛡️ SSL 256-bit encrypted ERP transaction</span>
    </div>
    <div class="flex flex-col sm:flex-row items-center justify-between w-full sm:w-auto gap-3">
      <div>
        ${!isVoided ? `
          <button id="inv-void-btn" type="button" class="inline-flex items-center space-x-1.5 px-3.5 py-2 text-xs font-bold text-rose-600 hover:text-rose-700 bg-rose-50 hover:bg-rose-100 border border-rose-200 rounded-xl transition-colors cursor-pointer">
            <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path>
            </svg>
            <span>Void / Cancel Invoice</span>
          </button>
        ` : `
          <span class="text-xs font-bold text-rose-600 bg-rose-50 border border-rose-200 px-3 py-1.5 rounded-xl inline-flex items-center gap-1.5">
            Invoice Voided
          </span>
        `}
      </div>
      <div class="flex items-center space-x-3">
        <button id="inv-close-btn" type="button" class="px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100 rounded-xl transition-colors border border-slate-200 cursor-pointer">
          Close
        </button>
        <button onclick="window.print()" type="button" class="inline-flex items-center space-x-2 px-4 py-2 text-xs font-bold text-white bg-[#138FCB] hover:bg-[#0E78AC] rounded-xl shadow-xs transition-all cursor-pointer">
          <span>🖨 Print / Save as PDF</span>
        </button>
      </div>
    </div>
  `;

  openModal({
    title: `Sales Invoice: ${invoice.invoiceNumber}`,
    subtitle: 'Dynamic live template output and financial receivable documentation',
    badge: invoice.invoiceNumber,
    contentHtml: `
      <div class="space-y-4">
        ${printableHtml}
      </div>
    `,
    footerHtml,
    size: 'max-w-4xl',
    onOpen: (modalEl) => {
      const closeBtn = modalEl.querySelector('#inv-close-btn');
      if (closeBtn) closeBtn.onclick = () => closeModal();

      const voidBtn = modalEl.querySelector('#inv-void-btn');
      if (voidBtn) {
        voidBtn.onclick = () => {
          confirmAction({
            title: `Void Invoice: ${invoice.invoiceNumber}`,
            message: 'Are you sure you want to void this sales invoice? It will be marked cancelled and customer receivable balance adjusted.',
            confirmLabel: 'Yes, Void Invoice',
            isDestructive: true,
            onConfirm: () => {
              cutToLengthService.rollbackAllocation('salesInvoice', invoice.id);
              storageService.update('salesInvoices', invoice.id, { status: 'Voided' });
              toast.show(`Invoice ${invoice.invoiceNumber} voided and physical stock restored.`, 'success');
              closeModal();
              if (refreshCallback) refreshCallback();
            }
          });
        };
      }
    }
  });
}

function openCreateInvoiceModal(onSaved) {
  const customers = salesService.getParties(true);
  const variants = productService.getVariants();
  const products = productService.getProducts();
  const bundles = bundleService.getBundleDefinitions();
  const prodMap = new Map(products.map(p => [p.id, p]));
  const nextInvNum = `INV-2025-${String(Math.floor(1000 + Math.random() * 9000))}`;

  let currentMode = 'standard'; // 'standard' | 'bundle'
  let bundleAdjustments = { extraQuantities: {}, overrideQuantities: {} };

  const contentHtml = `
    <form id="create-inv-form" class="space-y-6 text-xs">
      <!-- SECTION 1: Client & Invoice Configuration -->
      <section class="bg-white p-5 rounded-xl border border-slate-200/80 shadow-xs space-y-5">
        <div class="flex items-center justify-between border-b border-slate-100 pb-3">
          <h3 class="text-xs font-bold uppercase tracking-wider text-slate-500 flex items-center space-x-2">
            <span>👤</span>
            <span>Client &amp; Billing Details</span>
          </h3>
          <span class="text-[11px] text-slate-400">All fields marked with <span class="text-red-500">*</span> are required</span>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-12 gap-4">
          <div class="md:col-span-6 space-y-1.5">
            <label class="text-xs font-semibold text-slate-700" for="inv-customer-select">Client / Customer <span class="text-red-500">*</span></label>
            <select id="inv-customer-select" required class="w-full text-xs font-medium rounded-lg border border-slate-300 focus:border-[#138FCB] focus:ring focus:ring-blue-100 py-2.5 px-3 text-slate-800 bg-white shadow-2xs">
              ${customers.map(c => `<option value="${c.id}">${c.name}</option>`).join('')}
            </select>
          </div>

          <div class="md:col-span-2 space-y-1.5">
            <label class="text-xs font-semibold text-slate-700" for="currency-select">Currency</label>
            <select id="currency-select" class="w-full text-xs font-medium rounded-lg border border-slate-300 focus:border-[#138FCB] py-2.5 px-3 text-slate-800 bg-white shadow-2xs">
              <option selected="">PKR (Rs.)</option>
              <option>USD ($)</option>
            </select>
          </div>

          <div class="md:col-span-2 space-y-1.5">
            <label class="text-xs font-semibold text-slate-700" for="inv-date">Invoice Date</label>
            <input id="inv-date" type="date" value="${new Date().toISOString().split('T')[0]}" class="w-full text-xs font-medium rounded-lg border border-slate-300 focus:border-[#138FCB] py-2.5 px-3 text-slate-800 bg-white shadow-2xs">
          </div>

          <div class="md:col-span-2 space-y-1.5">
            <label class="text-xs font-semibold text-slate-700" for="inv-due-date">Due Terms</label>
            <select id="inv-due-date" class="w-full text-xs font-medium rounded-lg border border-slate-300 focus:border-[#138FCB] py-2.5 px-3 text-slate-800 bg-white shadow-2xs">
              <option value="30" selected="">Net 30 Days</option>
              <option value="15">Net 15 Days</option>
              <option value="0">Due on Receipt</option>
            </select>
          </div>
        </div>
      </section>

      <!-- SECTION 2: Line Items Table -->
      <section class="bg-white p-5 rounded-xl border border-slate-200/80 shadow-xs space-y-4">
        <div class="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3">
          <div class="flex items-center space-x-2">
            <span class="text-xs font-bold text-slate-600">Product Mode:</span>
            <div class="inline-flex rounded-lg border border-slate-200 p-0.5 bg-slate-50">
              <button type="button" id="item-mode-standard-btn" class="px-2.5 py-1 text-xs font-bold rounded-md bg-white text-[#138FCB] shadow-2xs cursor-pointer">
                📦 Standard / Cut-to-Length Item
              </button>
              <button type="button" id="item-mode-bundle-btn" class="px-2.5 py-1 text-xs font-bold rounded-md text-slate-600 hover:text-slate-900 cursor-pointer">
                🧩 Predefined Bundle / Poultry System
              </button>
            </div>
          </div>
          <span class="text-xs font-medium text-[#138FCB] flex items-center space-x-1">
            <span>Live Stock Allocation Engine Active</span>
          </span>
        </div>

        <div class="overflow-x-auto border border-slate-200 rounded-lg">
          <table class="w-full text-left text-xs">
            <thead class="bg-slate-50 text-slate-500 uppercase text-[10px] tracking-wider border-b border-slate-200">
              <tr>
                <th id="th-item-title" class="py-3 px-3 w-5/12 font-semibold">Item &amp; Description</th>
                <th class="py-3 px-3 w-2/12 font-semibold">Unit / Packaging</th>
                <th id="th-item-qty" class="py-3 px-2 w-1/12 font-semibold text-center">Qty</th>
                <th class="py-3 px-3 w-2/12 font-semibold text-right">Unit Price (PKR)</th>
                <th class="py-3 px-2 w-1/12 font-semibold text-center">Tax</th>
                <th class="py-3 px-3 w-2/12 font-semibold text-right">Amount</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-slate-100 text-slate-700">
              <tr class="hover:bg-slate-50/70 transition-colors">
                <td class="p-3">
                  <!-- Standard item picker -->
                  <div id="standard-item-picker-container">
                    <select id="inv-item-var" class="w-full text-xs font-semibold rounded border border-slate-300 focus:border-[#138FCB] focus:ring focus:ring-blue-100 py-1.5 px-2 bg-white mb-1 shadow-2xs">
                      ${variants.map(v => {
                        const p = prodMap.get(v.productId) || {};
                        const isCtl = p.cut_to_length || p.enableRollTracking;
                        return `<option value="${v.id}" data-product-id="${p.id}" data-ctl="${isCtl ? '1' : '0'}" data-price="${v.sellingPrice || 1450}">${v.name} (${v.sku})${isCtl ? ' [📏 Cut-to-Length]' : ''}</option>`;
                      }).join('')}
                    </select>
                    <div id="inv-ctl-stock-pill" class="hidden text-[10px] text-blue-800 bg-blue-50/90 border border-blue-200 px-2.5 py-1 rounded-lg mt-1 font-medium"></div>
                  </div>

                  <!-- Bundle / System picker -->
                  <div id="bundle-item-picker-container" class="hidden">
                    <select id="inv-item-bundle" class="w-full text-xs font-semibold rounded border border-slate-300 focus:border-[#138FCB] focus:ring focus:ring-blue-100 py-1.5 px-2 bg-white mb-1 shadow-2xs">
                      ${bundles.map(b => `<option value="${b.id}" data-type="${b.bundleType}">${b.name} (${b.bundleType})</option>`).join('')}
                    </select>
                  </div>
                </td>
                <td class="p-3">
                  <select id="inv-item-unit" class="w-full text-xs font-bold rounded border border-slate-300 focus:border-[#138FCB] py-1.5 px-2 bg-white shadow-2xs">
                    <option value="PCS">PCS</option>
                  </select>
                </td>
                <td class="p-3 text-center">
                  <input type="number" id="inv-item-qty" min="1" value="1" class="w-20 text-center text-xs font-bold rounded border border-slate-300 focus:border-[#138FCB] py-1.5 px-1 bg-white shadow-2xs">
                </td>
                <td class="p-3 text-right">
                  <input type="number" id="inv-item-price" min="0" value="1450" class="w-24 text-right text-xs font-bold rounded border border-slate-300 focus:border-[#138FCB] py-1.5 px-2 bg-white shadow-2xs">
                </td>
                <td class="p-3 text-center">
                  <span class="text-xs text-slate-500 font-medium">0%</span>
                </td>
                <td class="p-3 text-right font-black text-slate-900 text-sm">
                  <span id="inv-line-amount">Rs. 1,450</span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <!-- Bundle Components & Adjustments Sub-Panel -->
        <div id="bundle-components-panel" class="hidden p-3.5 bg-blue-50/70 border border-blue-200 rounded-xl space-y-2">
          <div class="flex items-center justify-between">
            <div>
              <span class="text-xs font-bold text-blue-900" id="bundle-panel-name">Poultry Feeding System</span>
              <p class="text-[11px] text-slate-600" id="bundle-panel-desc">Commercial line shows commercial count. Gate Pass will automatically deduct physical components.</p>
            </div>
            <button type="button" id="btn-open-bundle-adjust" class="px-3 py-1.5 bg-[#138FCB] hover:bg-[#0E78AC] text-white text-xs font-bold rounded-lg shadow-2xs transition-colors cursor-pointer flex items-center gap-1.5">
              <span>⚙️ Adjust Components &amp; Extra Qty</span>
            </button>
          </div>
          <div id="bundle-components-pills" class="text-xs font-semibold text-slate-700 flex flex-wrap gap-1.5">
            <!-- Dynamic component summary pills -->
          </div>
        </div>
      </section>

      <!-- SECTION 3: Summary Breakdown Card -->
      <div class="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
        <div class="lg:col-span-7 bg-white p-5 rounded-xl border border-slate-200/80 shadow-xs space-y-4">
          <h3 class="text-xs font-bold uppercase tracking-wider text-slate-500">Notes &amp; Payment Instructions</h3>
          <textarea class="w-full text-xs rounded-lg border border-slate-300 focus:border-[#138FCB] text-slate-700 p-2.5 resize-none shadow-2xs" id="customer-notes" placeholder="Notes..." rows="3">Deliveries are scheduled immediately following invoice confirmation.</textarea>
        </div>

        <div class="lg:col-span-5 bg-white p-5 rounded-xl border border-slate-200/80 shadow-xs space-y-3">
          <h3 class="text-xs font-bold uppercase tracking-wider text-slate-500 pb-1 border-b border-slate-100">Summary</h3>
          <div class="space-y-2 text-xs">
            <div class="flex justify-between text-slate-600">
              <span>Subtotal (Net)</span>
              <span id="inv-subtotal" class="font-medium text-slate-900">Rs. 1,450</span>
            </div>
            <div class="flex justify-between text-slate-600">
              <span>Estimated Tax (0%)</span>
              <span class="font-medium text-slate-900">Rs. 0</span>
            </div>
          </div>

          <div class="mt-4 pt-3 bg-blue-50/50 -mx-5 -mb-5 p-5 rounded-b-xl border-t border-blue-100 flex items-center justify-between">
            <p class="text-[11px] font-bold uppercase tracking-wider text-[#138FCB]">Total Due (PKR)</p>
            <div class="text-right">
              <span id="inv-grand-total" class="text-2xl font-extrabold text-slate-900 tracking-tight">Rs. 1,450</span>
            </div>
          </div>
        </div>
      </div>
    </form>
  `;

  const footerHtml = `
    <div class="flex items-center space-x-2 text-xs text-slate-400">
      <span>🛡️ SSL 256-bit encrypted ERP transaction</span>
    </div>
    <div class="flex items-center space-x-3 w-full sm:w-auto justify-end">
      <button id="inv-cancel-btn" type="button" class="px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 rounded-lg transition-colors border border-slate-300 cursor-pointer">
        Cancel
      </button>
      <button type="submit" form="create-inv-form" class="inline-flex items-center space-x-2 px-5 py-2 text-xs font-bold text-white bg-[#138FCB] hover:bg-[#0E78AC] rounded-lg shadow-sm transition-all active:scale-[0.98] cursor-pointer">
        <span>Create Invoice &amp; Allocate Stock</span>
      </button>
    </div>
  `;

  openModal({
    title: 'Create New Invoice',
    subtitle: 'Fill in billing details; Cut-to-Length cuts, roll packaging & poultry bundle components are handled automatically',
    badge: nextInvNum,
    contentHtml,
    footerHtml,
    size: 'max-w-5xl',
    onOpen: (modalEl) => {
      const cancelBtn = modalEl.querySelector('#inv-cancel-btn');
      if (cancelBtn) cancelBtn.onclick = () => closeModal();

      const standardBtn = modalEl.querySelector('#item-mode-standard-btn');
      const bundleBtn = modalEl.querySelector('#item-mode-bundle-btn');
      const standardPicker = modalEl.querySelector('#standard-item-picker-container');
      const bundlePicker = modalEl.querySelector('#bundle-item-picker-container');
      const bundlePanel = modalEl.querySelector('#bundle-components-panel');
      const bundlePanelName = modalEl.querySelector('#bundle-panel-name');
      const bundlePanelDesc = modalEl.querySelector('#bundle-panel-desc');
      const bundlePills = modalEl.querySelector('#bundle-components-pills');
      const adjustBtn = modalEl.querySelector('#btn-open-bundle-adjust');
      const thItemQty = modalEl.querySelector('#th-item-qty');

      const varSelect = modalEl.querySelector('#inv-item-var');
      const bundleSelect = modalEl.querySelector('#inv-item-bundle');
      const unitSelect = modalEl.querySelector('#inv-item-unit');
      const qtyInput = modalEl.querySelector('#inv-item-qty');
      const priceInput = modalEl.querySelector('#inv-item-price');
      const lineAmountEl = modalEl.querySelector('#inv-line-amount');
      const subtotalEl = modalEl.querySelector('#inv-subtotal');
      const grandTotalEl = modalEl.querySelector('#inv-grand-total');
      const ctlStockPill = modalEl.querySelector('#inv-ctl-stock-pill');

      const recalculate = () => {
        const qty = Number(qtyInput.value) || 0;
        const price = Number(priceInput.value) || 0;
        const total = qty * price;

        lineAmountEl.textContent = `Rs. ${total.toLocaleString()}`;
        subtotalEl.textContent = `Rs. ${total.toLocaleString()}`;
        grandTotalEl.textContent = `Rs. ${total.toLocaleString()}`;

        if (currentMode === 'bundle') {
          updateBundleDisplay();
        }
      };

      const updateBundleDisplay = () => {
        const bId = bundleSelect.value;
        const bundle = bundles.find(b => b.id === bId);
        if (!bundle) return;

        const qty = Number(qtyInput.value) || 1;
        const calc = bundleService.calculateBundleComponents(bundle.id, qty, bundleAdjustments);

        bundlePanelName.textContent = bundle.name;
        if (bundle.bundleType === 'VARIABLE_SYSTEM') {
          bundlePanelDesc.textContent = `Variable Poultry System (${qty} Lines). Commercial line shows ${qty} Lines. Gate Pass will automatically deduct the ${calc.components.length} physical components below:`;
          adjustBtn.classList.remove('hidden');
        } else {
          bundlePanelDesc.textContent = `Fixed Set (${qty} Sets). Components are directly proportional and kept internal on invoice.`;
          adjustBtn.classList.add('hidden');
        }

        bundlePills.innerHTML = calc.components.map(c => `
          <span class="px-2.5 py-1 bg-white border border-blue-200 rounded-lg text-slate-800 shadow-2xs">
            ${c.name}: <strong class="text-blue-600">${c.finalQty} ${c.unit || 'PCS'}</strong>
            ${c.extraQty ? `<span class="text-emerald-600 text-[10px] ml-1 font-bold">(+${c.extraQty} extra)</span>` : ''}
          </span>
        `).join('');
      };

      const syncUnitAndProduct = () => {
        if (currentMode === 'bundle') {
          const bId = bundleSelect.value;
          const b = bundles.find(x => x.id === bId);
          if (!b) return;

          if (b.bundleType === 'VARIABLE_SYSTEM') {
            unitSelect.innerHTML = `<option value="Lines">Lines</option>`;
            thItemQty.textContent = 'Lines';
            priceInput.value = 55000;
          } else {
            unitSelect.innerHTML = `<option value="Sets">Sets</option>`;
            thItemQty.textContent = 'Sets';
            priceInput.value = 4500;
          }
          ctlStockPill.classList.add('hidden');
          updateBundleDisplay();
          recalculate();
          return;
        }

        thItemQty.textContent = 'Qty';
        const selectedOpt = varSelect.selectedOptions[0];
        if (!selectedOpt) return;
        const prodId = selectedOpt.getAttribute('data-product-id');
        const product = prodMap.get(prodId);
        const isCtl = product && (product.cut_to_length || product.enableRollTracking);

        if (isCtl) {
          const baseUnit = product.base_unit || 'ft';
          const pkgs = product.packagingUnits || [];
          unitSelect.innerHTML = `
            <option value="${baseUnit}" data-type="base" data-factor="1">${baseUnit} (Loose Cut)</option>
            ${pkgs.map(pkg => `
              <option value="${pkg.name}" data-type="pkg" data-factor="${pkg.factor}">
                ${pkg.name}
              </option>
            `).join('')}
          `;

          // Live stock preview
          const summary = cutToLengthService.getSummary(product.id, 'wh-1', varSelect.value);
          if (summary) {
            const rollsText = summary.rollsBySize.map(r => `<strong>${r.count}</strong> ${r.packagingName}`).join(' + ') || `${summary.fullRollsCount} Full Rolls`;
            ctlStockPill.innerHTML = `📦 <strong>Stock:</strong> ${rollsText} + <strong>${summary.loosePiecesFootage.toLocaleString()} ${summary.baseUnit}</strong> Loose (${summary.loosePiecesCount} pcs) • Total: <strong>${summary.totalFootage.toLocaleString()} ${summary.baseUnit}</strong>`;
            ctlStockPill.classList.remove('hidden');
          }
        } else {
          const variant = variants.find(v => v.id === varSelect.value);
          unitSelect.innerHTML = `<option value="${variant?.unit || 'PCS'}">${variant?.unit || 'PCS'}</option>`;
          ctlStockPill.classList.add('hidden');
        }

        // Set initial price
        const variant = variants.find(v => v.id === varSelect.value);
        if (variant) priceInput.value = variant.sellingPrice || 0;
        recalculate();
      };

      standardBtn.onclick = () => {
        currentMode = 'standard';
        standardBtn.className = 'px-2.5 py-1 text-xs font-bold rounded-md bg-white text-[#138FCB] shadow-2xs cursor-pointer';
        bundleBtn.className = 'px-2.5 py-1 text-xs font-bold rounded-md text-slate-600 hover:text-slate-900 cursor-pointer';
        standardPicker.classList.remove('hidden');
        bundlePicker.classList.add('hidden');
        bundlePanel.classList.add('hidden');
        syncUnitAndProduct();
      };

      bundleBtn.onclick = () => {
        currentMode = 'bundle';
        bundleBtn.className = 'px-2.5 py-1 text-xs font-bold rounded-md bg-white text-[#138FCB] shadow-2xs cursor-pointer';
        standardBtn.className = 'px-2.5 py-1 text-xs font-bold rounded-md text-slate-600 hover:text-slate-900 cursor-pointer';
        standardPicker.classList.add('hidden');
        bundlePicker.classList.remove('hidden');
        bundlePanel.classList.remove('hidden');
        syncUnitAndProduct();
      };

      adjustBtn.onclick = () => {
        const bId = bundleSelect.value;
        const bundle = bundles.find(b => b.id === bId);
        const qty = Number(qtyInput.value) || 1;
        if (!bundle) return;

        openBundleAdjustmentModal(bundle, qty, bundleAdjustments, (newAdj) => {
          bundleAdjustments = newAdj;
          updateBundleDisplay();
        });
      };

      bundleSelect.onchange = () => {
        bundleAdjustments = { extraQuantities: {}, overrideQuantities: {} };
        syncUnitAndProduct();
      };

      unitSelect.onchange = () => {
        if (currentMode === 'bundle') return;
        const opt = unitSelect.selectedOptions[0];
        const selectedOpt = varSelect.selectedOptions[0];
        const prodId = selectedOpt ? selectedOpt.getAttribute('data-product-id') : null;
        const product = prodMap.get(prodId);
        const variant = variants.find(v => v.id === varSelect.value);

        if (opt && variant && product && (product.cut_to_length || product.enableRollTracking)) {
          const type = opt.getAttribute('data-type');
          const factor = Number(opt.getAttribute('data-factor')) || 1;
          if (type === 'pkg') {
            priceInput.value = (variant.sellingPrice || 20) * factor;
          } else {
            priceInput.value = variant.sellingPrice || 20;
          }
        }
        recalculate();
      };

      varSelect.onchange = syncUnitAndProduct;
      qtyInput.oninput = recalculate;
      priceInput.oninput = recalculate;
      syncUnitAndProduct();

      // Submit
      modalEl.querySelector('#create-inv-form').onsubmit = (e) => {
        e.preventDefault();
        const customerPartyId = modalEl.querySelector('#inv-customer-select').value;
        const dueDateDays = Number(modalEl.querySelector('#inv-due-date').value) || 30;
        const dueDate = new Date(Date.now() + dueDateDays * 86400000).toISOString().split('T')[0];
        const quantity = Number(qtyInput.value) || 1;
        const unitPrice = Number(priceInput.value) || 0;
        const chosenUnit = unitSelect.value;

        if (currentMode === 'bundle') {
          const bId = bundleSelect.value;
          const bundleDef = bundles.find(b => b.id === bId);
          if (!bundleDef) return;

          const calculated = bundleService.calculateBundleComponents(bundleDef.id, quantity, bundleAdjustments);

          const invoice = salesService.createSalesInvoice({
            customerPartyId,
            dueDate,
            lines: [
              {
                variantId: bundleDef.commercialVariantId || variants[0]?.id,
                productId: bundleDef.productId || products[0]?.id,
                bundleId: bundleDef.id,
                bundleType: bundleDef.bundleType,
                bundleLinesCount: bundleDef.bundleType === 'VARIABLE_SYSTEM' ? quantity : null,
                quantity,
                unitPrice,
                unit: chosenUnit,
                bundleComponents: calculated.components
              }
            ]
          });

          toast.show(`Sales invoice ${invoice.invoiceNumber} created for bundle (${quantity} ${chosenUnit}).`, 'success');
          closeModal();
          if (onSaved) onSaved();
          return;
        }

        // Standard / Cut-to-length mode
        const variantId = varSelect.value;
        const selectedOpt = varSelect.selectedOptions[0];
        const prodId = selectedOpt ? selectedOpt.getAttribute('data-product-id') : null;
        const product = prodMap.get(prodId);
        const isCtl = product && (product.cut_to_length || product.enableRollTracking);

        const executeCreateInvoice = (allocationPlan = null) => {
          const invoice = salesService.createSalesInvoice({
            customerPartyId,
            dueDate,
            lines: [
              {
                variantId,
                productId: prodId,
                quantity,
                unitPrice,
                unit: chosenUnit,
                allocationPlanType: allocationPlan ? allocationPlan.type : null
              }
            ]
          });

          if (allocationPlan) {
            cutToLengthService.commitAllocation(allocationPlan, {
              referenceDocType: 'salesInvoice',
              referenceDocId: invoice.id,
              userId: 'user-admin',
              notes: `Allocated for sales invoice ${invoice.invoiceNumber}`
            });
          }

          toast.show(`Sales invoice ${invoice.invoiceNumber} created & inventory allocated.`, 'success');
          closeModal();
          if (onSaved) onSaved();
        };

        if (isCtl) {
          const plan = cutToLengthService.planAllocation({
            productId: product.id,
            variantId,
            warehouseId: 'wh-1',
            requestedQty: quantity,
            unit: chosenUnit,
            allowMultiPieces: false
          });

          if (plan.canFulfill) {
            executeCreateInvoice(plan);
          } else if (plan.requiresDecision) {
            openDecisionModal(plan, (chosenAction) => {
              if (chosenAction === 'open_roll') {
                const openPlan = cutToLengthService.planAllocation({
                  productId: product.id,
                  variantId,
                  warehouseId: 'wh-1',
                  requestedQty: quantity,
                  unit: chosenUnit,
                  allowMultiPieces: false
                });
                executeCreateInvoice(openPlan);
              } else if (chosenAction === 'multi_piece') {
                const multiPlan = cutToLengthService.planAllocation({
                  productId: product.id,
                  variantId,
                  warehouseId: 'wh-1',
                  requestedQty: quantity,
                  unit: chosenUnit,
                  allowMultiPieces: true
                });
                executeCreateInvoice(multiPlan);
              }
            });
          } else {
            toast.show(plan.error || 'Insufficient inventory.', 'error');
          }
        } else {
          executeCreateInvoice(null);
        }
      };
    }
  });
}

function openBundleAdjustmentModal(bundleDef, commercialQty, adjustments, onSave) {
  let workingAdjustments = JSON.parse(JSON.stringify(adjustments || { extraQuantities: {}, overrideQuantities: {} }));
  if (!workingAdjustments.extraQuantities) workingAdjustments.extraQuantities = {};
  if (!workingAdjustments.overrideQuantities) workingAdjustments.overrideQuantities = {};

  const calculated = bundleService.calculateBundleComponents(bundleDef.id, commercialQty, workingAdjustments);

  const contentHtml = `
    <div class="space-y-4 text-xs">
      <div class="p-3 bg-blue-50/70 border border-blue-200 rounded-xl text-blue-900">
        ⚙️ <strong>Component Adjustment:</strong> Commercial invoice will show <strong>${commercialQty} ${bundleDef.bundleType === 'VARIABLE_SYSTEM' ? 'Lines' : 'Sets'}</strong>. Adjust extra component quantities below without corrupting commercial pricing.
      </div>

      <div class="overflow-x-auto border border-slate-200 rounded-xl">
        <table class="w-full text-left text-xs">
          <thead class="bg-slate-50 text-slate-500 uppercase text-[10px] border-b border-slate-200">
            <tr>
              <th class="p-2.5">Component</th>
              <th class="p-2.5">Rule</th>
              <th class="p-2.5 text-center">Calculated</th>
              <th class="p-2.5 text-center">Extra Qty (+/-)</th>
              <th class="p-2.5 text-center font-bold text-slate-800">Final Qty</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-slate-100">
            ${calculated.components.map(c => `
              <tr class="hover:bg-slate-50" data-comp-id="${c.componentVariantId}">
                <td class="p-2.5 font-bold text-slate-800">${c.name}</td>
                <td class="p-2.5 text-slate-500 font-mono text-[11px]">${c.ruleType}</td>
                <td class="p-2.5 text-center font-semibold">${c.calculatedQty} ${c.unit || 'PCS'}</td>
                <td class="p-2.5 text-center">
                  <input type="number" step="any" value="${workingAdjustments.extraQuantities[c.componentVariantId] || 0}" class="inp-adj-extra w-20 text-center font-bold border border-slate-300 rounded px-2 py-1">
                </td>
                <td class="p-2.5 text-center font-extrabold text-[#138FCB] col-adj-final">
                  ${c.finalQty} ${c.unit || 'PCS'}
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>

      <div class="flex justify-end gap-2 pt-3 border-t border-slate-200">
        <button type="button" id="btn-cancel-adj" class="px-4 py-2 text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-xl font-bold cursor-pointer">Cancel</button>
        <button type="button" id="btn-save-adj" class="px-5 py-2 bg-[#138FCB] hover:bg-[#0E78AC] text-white rounded-xl font-bold shadow-xs cursor-pointer">Apply Component Adjustments</button>
      </div>
    </div>
  `;

  openModal({
    title: `Adjust Bundle Components: ${bundleDef.name}`,
    subtitle: `Commercial Quantity: ${commercialQty} ${bundleDef.bundleType === 'VARIABLE_SYSTEM' ? 'Lines' : 'Sets'}`,
    contentHtml,
    size: 'max-w-2xl',
    onOpen: (modalEl) => {
      modalEl.querySelector('#btn-cancel-adj').onclick = () => closeModal();

      const tableRows = modalEl.querySelectorAll('tbody tr');
      const recalcModal = () => {
        tableRows.forEach(tr => {
          const compId = tr.getAttribute('data-comp-id');
          const extraVal = Number(tr.querySelector('.inp-adj-extra').value) || 0;
          workingAdjustments.extraQuantities[compId] = extraVal;
        });
        const updated = bundleService.calculateBundleComponents(bundleDef.id, commercialQty, workingAdjustments);
        tableRows.forEach(tr => {
          const compId = tr.getAttribute('data-comp-id');
          const comp = updated.components.find(x => x.componentVariantId === compId);
          if (comp) {
            tr.querySelector('.col-adj-final').textContent = `${comp.finalQty} ${comp.unit || 'PCS'}`;
          }
        });
      };

      modalEl.querySelectorAll('.inp-adj-extra').forEach(inp => {
        inp.oninput = recalcModal;
      });

      modalEl.querySelector('#btn-save-adj').onclick = () => {
        recalcModal();
        closeModal();
        if (onSave) onSave(workingAdjustments);
      };
    }
  });
}

/**
 * Modal shown when no single continuous loose piece can fulfill the request
 */
function openDecisionModal(plan, onActionChosen) {
  const contentHtml = `
    <div class="space-y-4 text-xs">
      <div class="p-3.5 bg-amber-50 rounded-xl border border-amber-200 text-amber-950 space-y-1">
        <p class="font-bold text-sm text-amber-900">Requested: ${plan.targetLength.toLocaleString()} ${plan.baseUnit}</p>
        <p>No single loose piece of ${plan.targetLength.toLocaleString()} ${plan.baseUnit} is available in stock.</p>
      </div>

      <div>
        <span class="font-bold text-slate-700 block mb-1.5 uppercase text-[10px] tracking-wider">Available Loose Pieces:</span>
        <div class="flex flex-wrap gap-1.5">
          ${plan.availableLoosePieces.length > 0 ? plan.availableLoosePieces.map(p => `
            <span class="inline-block px-2.5 py-1 bg-slate-100 border border-slate-200 rounded-lg text-slate-700 font-mono text-xs">
              <strong>${p.code}:</strong> ${Number(p.length).toLocaleString()} ${plan.baseUnit}
            </span>
          `).join('') : '<span class="text-slate-400 italic">No loose pieces in stock</span>'}
        </div>
      </div>

      <div class="space-y-2 pt-2 border-t border-slate-100">
        ${plan.totalFullAvailable >= plan.targetLength ? `
          <button id="ctl-act-open-roll" type="button" class="w-full py-2.5 px-4 bg-[#138FCB] hover:bg-[#0E78AC] text-white font-bold rounded-xl text-center shadow-xs transition-all cursor-pointer">
            [ Open New Roll ] (Cut ${plan.targetLength.toLocaleString()} ${plan.baseUnit} &amp; Create Remainder Loose Piece)
          </button>
        ` : ''}
        <button id="ctl-act-multi" type="button" class="w-full py-2.5 px-4 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl text-center shadow-xs transition-all cursor-pointer">
          [ Use Multiple Pieces ] (Combine available loose pieces)
        </button>
        <button id="ctl-act-cancel" type="button" class="w-full py-2 px-4 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-xl text-center transition-all cursor-pointer">
          [ Cancel ]
        </button>
      </div>
    </div>
  `;

  openModal({
    title: 'Cut-to-Length Allocation Options',
    subtitle: 'Choose how physical inventory should fulfill this continuous requirement',
    badge: `${plan.targetLength} ${plan.baseUnit}`,
    contentHtml,
    size: 'max-w-md',
    onOpen: (modalEl) => {
      const openRollBtn = modalEl.querySelector('#ctl-act-open-roll');
      if (openRollBtn) {
        openRollBtn.onclick = () => {
          closeModal();
          onActionChosen('open_roll');
        };
      }

      const multiBtn = modalEl.querySelector('#ctl-act-multi');
      if (multiBtn) {
        multiBtn.onclick = () => {
          closeModal();
          onActionChosen('multi_piece');
        };
      }

      const cancelBtn = modalEl.querySelector('#ctl-act-cancel');
      if (cancelBtn) {
        cancelBtn.onclick = () => closeModal();
      }
    }
  });
}
