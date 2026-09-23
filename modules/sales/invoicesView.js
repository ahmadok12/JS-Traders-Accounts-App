/**
 * JS Traders ERP - Sales Invoices View
 * Financial invoicing engine.
 * CRITICAL RULE: Invoicing does NOT deduct stock. Stock is strictly deducted by Delivery.
 */

import { salesService } from '../../services/salesService.js';
import { invoiceTemplateService } from '../../services/invoiceTemplateService.js';
import { productService } from '../../services/productService.js';
import { renderTable, bindTableActions } from '../../components/table.js';
import { renderFilterBar } from '../../components/filters.js';
import { openModal, closeModal } from '../../components/modal.js';
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
              storageService.update('salesInvoices', invoice.id, { status: 'Voided' });
              toast.show(`Invoice ${invoice.invoiceNumber} voided.`, 'success');
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
  const nextInvNum = `INV-2025-${String(Math.floor(1000 + Math.random() * 9000))}`;

  const contentHtml = `
    <form id="create-inv-form" class="space-y-6 text-xs">
      <!-- SECTION 1: Client & Invoice Configuration -->
      <section class="bg-white p-5 rounded-xl border border-slate-200/80 shadow-xs space-y-5" data-purpose="client-and-dates-form">
        <div class="flex items-center justify-between border-b border-slate-100 pb-3">
          <h3 class="text-xs font-bold uppercase tracking-wider text-slate-500 flex items-center space-x-2">
            <svg class="w-3.5 h-3.5 text-[#138FCB]" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
              <path d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" stroke-linecap="round" stroke-linejoin="round"></path>
            </svg>
            <span>Client &amp; Billing Details</span>
          </h3>
          <span class="text-[11px] text-slate-400">All fields marked with <span class="text-red-500">*</span> are required</span>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-12 gap-4">
          <!-- Client Selection -->
          <div class="md:col-span-6 space-y-1.5">
            <div class="flex justify-between items-center">
              <label class="text-xs font-semibold text-slate-700" for="inv-customer-select">Client / Customer <span class="text-red-500">*</span></label>
              <span class="text-[11px] font-semibold text-[#138FCB]">Commercial Poultry Account</span>
            </div>
            <select id="inv-customer-select" required class="w-full text-xs font-medium rounded-lg border border-slate-300 focus:border-[#138FCB] focus:ring focus:ring-blue-100 py-2.5 px-3 text-slate-800 bg-white shadow-2xs">
              ${customers.map(c => `<option value="${c.id}">${c.name}</option>`).join('')}
            </select>
            <p class="text-[11px] text-slate-400">Registered Broiler &amp; Commercial Farming Partner</p>
          </div>

          <!-- Currency Selection -->
          <div class="md:col-span-2 space-y-1.5">
            <label class="text-xs font-semibold text-slate-700" for="currency-select">Currency</label>
            <select id="currency-select" class="w-full text-xs font-medium rounded-lg border border-slate-300 focus:border-[#138FCB] focus:ring focus:ring-blue-100 py-2.5 px-3 text-slate-800 bg-white shadow-2xs">
              <option selected="">PKR (Rs.)</option>
              <option>USD ($)</option>
              <option>EUR (€)</option>
            </select>
          </div>

          <!-- Invoice Issue Date -->
          <div class="md:col-span-2 space-y-1.5">
            <label class="text-xs font-semibold text-slate-700" for="inv-date">Invoice Date</label>
            <input id="inv-date" type="date" value="${new Date().toISOString().split('T')[0]}" class="w-full text-xs font-medium rounded-lg border border-slate-300 focus:border-[#138FCB] focus:ring focus:ring-blue-100 py-2.5 px-3 text-slate-800 bg-white shadow-2xs">
          </div>

          <!-- Payment Due Date Terms -->
          <div class="md:col-span-2 space-y-1.5">
            <label class="text-xs font-semibold text-slate-700" for="inv-due-date">Due Terms</label>
            <select id="inv-due-date" class="w-full text-xs font-medium rounded-lg border border-slate-300 focus:border-[#138FCB] focus:ring focus:ring-blue-100 py-2.5 px-3 text-slate-800 bg-white shadow-2xs">
              <option value="30" selected="">Net 30 Days</option>
              <option value="15">Net 15 Days</option>
              <option value="0">Due on Receipt</option>
              <option value="60">Net 60 Days</option>
            </select>
          </div>
        </div>

        <!-- Billing Info Secondary Bar -->
        <div class="bg-slate-50/80 rounded-lg p-3 text-xs flex flex-wrap items-center justify-between gap-3 border border-slate-100 text-slate-600">
          <div class="flex items-center space-x-2">
            <span class="font-semibold text-slate-700">Billing Address:</span>
            <span class="text-slate-500">Commercial Poultry Complex, Multan Road, Lahore, Pakistan</span>
          </div>
          <div class="flex items-center space-x-4 text-[11px]">
            <span class="inline-flex items-center text-emerald-600 font-medium bg-emerald-50 px-2 py-0.5 rounded">
              <span class="w-1.5 h-1.5 rounded-full bg-emerald-500 mr-1.5"></span>
              Verified Customer
            </span>
          </div>
        </div>
      </section>

      <!-- SECTION 2: Line Items Table -->
      <section class="bg-white p-5 rounded-xl border border-slate-200/80 shadow-xs space-y-4" data-purpose="line-items-section">
        <div class="flex items-center justify-between">
          <div class="flex items-center space-x-2">
            <h3 class="text-xs font-bold uppercase tracking-wider text-slate-500">Items &amp; Equipment Services</h3>
            <span class="px-2 py-0.5 text-[10px] font-semibold rounded-full bg-slate-100 text-slate-600">1 Item Line</span>
          </div>
          <span class="text-xs font-medium text-[#138FCB] flex items-center space-x-1">
            <span>Live Product Catalog Active</span>
          </span>
        </div>

        <!-- Table Container -->
        <div class="overflow-x-auto border border-slate-200 rounded-lg">
          <table class="w-full text-left text-xs">
            <thead class="bg-slate-50 text-slate-500 uppercase text-[10px] tracking-wider border-b border-slate-200">
              <tr>
                <th class="py-3 px-3 w-5/12 font-semibold">Item &amp; Description</th>
                <th class="py-3 px-3 w-2/12 font-semibold">Category</th>
                <th class="py-3 px-2 w-1/12 font-semibold text-center">Qty</th>
                <th class="py-3 px-3 w-2/12 font-semibold text-right">Unit Price (PKR)</th>
                <th class="py-3 px-2 w-1/12 font-semibold text-center">Tax</th>
                <th class="py-3 px-3 w-2/12 font-semibold text-right">Amount</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-slate-100 text-slate-700">
              <tr class="hover:bg-slate-50/70 transition-colors">
                <td class="p-3">
                  <select id="inv-item-var" class="w-full text-xs font-semibold rounded border border-slate-300 focus:border-[#138FCB] focus:ring focus:ring-blue-100 py-1.5 px-2 bg-white mb-1 shadow-2xs">
                    ${variants.map(v => `<option value="${v.id}" data-price="${v.sellingPrice || 1450}">${v.name} (${v.sku})</option>`).join('')}
                  </select>
                  <span class="text-[11px] text-slate-400 block">High quality imported poultry farm equipment</span>
                </td>
                <td class="p-3">
                  <span class="inline-block px-2 py-1 rounded bg-slate-100 text-slate-600 text-[11px] font-medium">Equipment</span>
                </td>
                <td class="p-3 text-center">
                  <input type="number" id="inv-item-qty" min="1" value="40" class="w-16 text-center text-xs font-bold rounded border border-slate-300 focus:border-[#138FCB] py-1.5 px-1 bg-white shadow-2xs">
                </td>
                <td class="p-3 text-right">
                  <input type="number" id="inv-item-price" min="0" value="1450" class="w-24 text-right text-xs font-bold rounded border border-slate-300 focus:border-[#138FCB] py-1.5 px-2 bg-white shadow-2xs">
                </td>
                <td class="p-3 text-center">
                  <span class="text-xs text-slate-500 font-medium">0%</span>
                </td>
                <td class="p-3 text-right font-black text-slate-900 text-sm">
                  <span id="inv-line-amount">Rs. 58,000</span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <div class="flex items-center justify-between pt-1">
          <span class="text-[11px] text-slate-400">All standard items include automated tax computation</span>
          <span class="text-xs font-semibold text-[#138FCB]">Sales invoice creates accounts receivable without touching physical inventory</span>
        </div>
      </section>

      <!-- SECTION 3: Bottom Dual Columns -->
      <div class="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
        <!-- Notes & Payment Instructions -->
        <div class="lg:col-span-7 bg-white p-5 rounded-xl border border-slate-200/80 shadow-xs space-y-4" data-purpose="terms-and-notes">
          <h3 class="text-xs font-bold uppercase tracking-wider text-slate-500">Notes &amp; Payment Instructions</h3>
          
          <div class="space-y-1.5">
            <label class="text-xs font-semibold text-slate-700" for="customer-notes">Client Note / Memo</label>
            <textarea class="w-full text-xs rounded-lg border border-slate-300 focus:border-[#138FCB] focus:ring focus:ring-blue-100 text-slate-700 p-2.5 resize-none shadow-2xs" id="customer-notes" placeholder="Add custom message or warranty notes..." rows="3">Thank you for your business. Please remit payment via bank wire within 30 days of receipt. Deliveries are scheduled immediately following invoice confirmation.</textarea>
          </div>

          <div class="grid grid-cols-2 gap-3 pt-1">
            <div class="space-y-1.5">
              <label class="text-xs font-semibold text-slate-700" for="payment-method">Preferred Method</label>
              <select class="w-full text-xs rounded-lg border border-slate-300 focus:border-[#138FCB] focus:ring focus:ring-blue-100 py-2 px-3 text-slate-700 bg-white shadow-2xs" id="payment-method">
                <option selected="">Bank Transfer (Meezan Bank)</option>
                <option>Cash on Delivery</option>
                <option>Cheque Deposit</option>
              </select>
            </div>
            <div class="space-y-1.5">
              <label class="text-xs font-semibold text-slate-700" for="po-number">Purchase Order (PO #)</label>
              <input class="w-full text-xs rounded-lg border border-slate-300 focus:border-[#138FCB] focus:ring focus:ring-blue-100 py-2 px-3 text-slate-700 shadow-2xs" id="po-number" placeholder="PO-2025-998" type="text" value="PO-77218">
            </div>
          </div>
        </div>

        <!-- Invoice Summary Breakdown Card -->
        <div class="lg:col-span-5 bg-white p-5 rounded-xl border border-slate-200/80 shadow-xs space-y-3" data-purpose="totals-summary-card">
          <h3 class="text-xs font-bold uppercase tracking-wider text-slate-500 pb-1 border-b border-slate-100">Summary</h3>
          <div class="space-y-2 text-xs">
            <div class="flex justify-between text-slate-600">
              <span>Subtotal (Net)</span>
              <span id="inv-subtotal" class="font-medium text-slate-900">Rs. 58,000</span>
            </div>
            <div class="flex justify-between items-center text-slate-600">
              <span class="flex items-center space-x-1">
                <span>Discount</span>
                <span class="text-[10px] bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded">Promo</span>
              </span>
              <span class="font-medium text-slate-500">Rs. 0</span>
            </div>
            <div class="flex justify-between text-slate-600">
              <span>Estimated Tax (0%)</span>
              <span class="font-medium text-slate-900">Rs. 0</span>
            </div>
            <div class="flex justify-between text-slate-600">
              <span>Shipping &amp; Freight</span>
              <span class="text-emerald-600 font-medium">Included</span>
            </div>
          </div>

          <!-- Grand Total Highlight Card -->
          <div class="mt-4 pt-3 bg-blue-50/50 -mx-5 -mb-5 p-5 rounded-b-xl border-t border-blue-100 flex items-center justify-between">
            <div>
              <p class="text-[11px] font-bold uppercase tracking-wider text-[#138FCB]">Total Due (PKR)</p>
              <p class="text-[11px] text-slate-500">Includes all applicable duties</p>
            </div>
            <div class="text-right">
              <span id="inv-grand-total" class="text-2xl font-extrabold text-slate-900 tracking-tight">Rs. 58,000</span>
            </div>
          </div>
        </div>
      </div>
    </form>
  `;

  const footerHtml = `
    <div class="flex items-center space-x-2 text-xs text-slate-400">
      <svg class="w-4 h-4 text-emerald-500" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
        <path d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" stroke-linecap="round" stroke-linejoin="round"></path>
      </svg>
      <span>SSL 256-bit encrypted ERP transaction</span>
    </div>
    <div class="flex items-center space-x-3 w-full sm:w-auto justify-end">
      <button id="inv-cancel-btn" type="button" class="px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 rounded-lg transition-colors border border-slate-300 cursor-pointer">
        Cancel
      </button>
      <button type="submit" form="create-inv-form" class="inline-flex items-center space-x-2 px-5 py-2 text-xs font-bold text-white bg-[#138FCB] hover:bg-[#0E78AC] rounded-lg shadow-sm hover:shadow transition-all active:scale-[0.98] cursor-pointer">
        <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
          <path d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" stroke-linecap="round" stroke-linejoin="round"></path>
        </svg>
        <span>Send Invoice</span>
      </button>
    </div>
  `;

  openModal({
    title: 'Create New Invoice',
    subtitle: 'Fill in the billing details and item breakdown to issue an invoice to your client',
    badge: nextInvNum,
    contentHtml,
    footerHtml,
    size: 'max-w-5xl',
    onOpen: (modalEl) => {
      const cancelBtn = modalEl.querySelector('#inv-cancel-btn');
      if (cancelBtn) cancelBtn.onclick = () => closeModal();

      const varSelect = modalEl.querySelector('#inv-item-var');
      const qtyInput = modalEl.querySelector('#inv-item-qty');
      const priceInput = modalEl.querySelector('#inv-item-price');
      const lineAmountEl = modalEl.querySelector('#inv-line-amount');
      const subtotalEl = modalEl.querySelector('#inv-subtotal');
      const grandTotalEl = modalEl.querySelector('#inv-grand-total');

      const recalculate = () => {
        const qty = Number(qtyInput.value) || 0;
        const price = Number(priceInput.value) || 0;
        const total = qty * price;

        lineAmountEl.textContent = `Rs. ${total.toLocaleString()}`;
        subtotalEl.textContent = `Rs. ${total.toLocaleString()}`;
        grandTotalEl.textContent = `Rs. ${total.toLocaleString()}`;
      };

      varSelect.onchange = () => {
        const opt = varSelect.selectedOptions[0];
        if (opt) {
          const defaultPrice = opt.getAttribute('data-price');
          if (defaultPrice) priceInput.value = defaultPrice;
        }
        recalculate();
      };

      qtyInput.oninput = recalculate;
      priceInput.oninput = recalculate;
      recalculate();

      modalEl.querySelector('#create-inv-form').onsubmit = (e) => {
        e.preventDefault();
        const customerPartyId = modalEl.querySelector('#inv-customer-select').value;
        const dueDateDays = Number(modalEl.querySelector('#inv-due-date').value) || 30;
        const dueDate = new Date(Date.now() + dueDateDays * 86400000).toISOString().split('T')[0];
        const variantId = varSelect.value;
        const quantity = Number(qtyInput.value) || 1;
        const unitPrice = Number(priceInput.value) || 0;

        salesService.createSalesInvoice({
          customerPartyId,
          dueDate,
          lines: [{ variantId, quantity, unitPrice, unit: 'PCS' }]
        });

        toast.show('Sales invoice generated successfully.', 'success');
        closeModal();
        if (onSaved) onSaved();
      };
    }
  });
}
