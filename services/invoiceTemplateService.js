/**
 * JS Traders ERP - Invoice Customization Engine
 * Presentation layer for printable and downloadable sales invoices and gatepasses.
 * NEVER affects underlying inventory balances or financial accounting calculations.
 */

import { APP_CONFIG } from '../config/appConfig.js';

class InvoiceTemplateService {
  constructor() {
    this.activeTemplate = {
      id: 'tmpl-modern',
      name: 'Modern Clean ERP (A4)',
      paperSize: 'A4', // A4, Letter, Thermal
      showLogo: true,
      showUrduHeader: true,
      showTaxId: true,
      showPaymentInstructions: true,
      showSignatures: true,
      primaryColor: '#138FCB',
      footerNotes: 'Thank you for your business. Goods once delivered in good order cannot be returned without prior written authorization.'
    };
  }

  getTemplate() {
    return this.activeTemplate;
  }

  updateTemplate(settings) {
    this.activeTemplate = { ...this.activeTemplate, ...settings };
    return this.activeTemplate;
  }

  renderPrintableInvoice(invoice, customer, lines) {
    const tmpl = this.activeTemplate;
    const isThermal = tmpl.paperSize === 'Thermal';

    return `
      <div class="print-container font-sans bg-white p-6 sm:p-8 max-w-4xl mx-auto text-slate-800 border border-slate-200 rounded-xl shadow-sm">
        <!-- Header -->
        <div class="flex justify-between items-start border-b border-slate-200 pb-6">
          <div>
            <div class="flex items-center gap-3">
              <div class="w-10 h-10 rounded-xl bg-[#138FCB] text-white flex items-center justify-center font-bold text-lg shadow-sm">JS</div>
              <div>
                <h1 class="text-xl font-bold tracking-tight text-slate-900">${APP_CONFIG.company.name}</h1>
                <p class="text-xs text-slate-500">${APP_CONFIG.company.legalName}</p>
              </div>
            </div>
            <p class="text-xs text-slate-500 mt-2">${APP_CONFIG.company.address}</p>
            <p class="text-xs text-slate-500">Phone: ${APP_CONFIG.company.phone} | NTN: ${APP_CONFIG.company.taxNumber}</p>
          </div>
          <div class="text-right">
            <h2 class="text-2xl font-extrabold uppercase tracking-wider text-[#138FCB]">Sales Invoice</h2>
            ${tmpl.showUrduHeader ? '<p class="text-sm font-serif text-slate-400 mt-0.5">سیلز انوائس</p>' : ''}
            <div class="mt-2 text-xs space-y-1 text-slate-600">
              <p><span class="font-semibold text-slate-700">Invoice No:</span> ${invoice.invoiceNumber || 'INV-00001'}</p>
              <p><span class="font-semibold text-slate-700">Date:</span> ${invoice.date || new Date().toISOString().split('T')[0]}</p>
              <p><span class="font-semibold text-slate-700">Due Date:</span> ${invoice.dueDate || 'Upon Delivery'}</p>
            </div>
          </div>
        </div>

        <!-- Bill To -->
        <div class="my-6 p-4 rounded-xl bg-slate-50 border border-slate-100 flex justify-between items-start text-xs">
          <div>
            <span class="text-[10px] font-bold uppercase tracking-wider text-slate-400 block mb-1">Customer / Billed To</span>
            <p class="text-sm font-bold text-slate-900">${customer.name || 'Ali Poultry Group'}</p>
            <p class="text-slate-600">${customer.businessName || ''}</p>
            <p class="text-slate-500">${customer.address || 'Lahore, Pakistan'}</p>
            <p class="text-slate-500">Contact: ${customer.phone || customer.contactPerson || ''}</p>
          </div>
          <div class="text-right">
            <span class="text-[10px] font-bold uppercase tracking-wider text-slate-400 block mb-1">Payment Terms</span>
            <p class="font-semibold text-slate-800">${customer.paymentTerms || '30 Days Net'}</p>
            <p class="text-slate-500">Currency: ${invoice.currency || 'PKR'}</p>
          </div>
        </div>

        <!-- Table -->
        <table class="w-full text-left text-xs mb-6">
          <thead>
            <tr class="border-b-2 border-slate-200 text-[11px] uppercase font-bold text-slate-400 tracking-wider">
              <th class="py-2.5 px-3">#</th>
              <th class="py-2.5 px-3">Item / Description</th>
              <th class="py-2.5 px-3 text-right">Quantity</th>
              <th class="py-2.5 px-3 text-right">Unit Rate (${invoice.currency || 'PKR'})</th>
              <th class="py-2.5 px-3 text-right">Line Total</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-slate-100">
            ${(lines || []).map((l, idx) => `
              <tr>
                <td class="py-3 px-3 text-slate-400">${idx + 1}</td>
                <td class="py-3 px-3 font-medium text-slate-800">
                  <div>${l.name || 'Feed Pan 16" - Made in China'}</div>
                  <div class="text-[10px] text-slate-400">${l.sku || 'FP-CN-16'}</div>
                </td>
                <td class="py-3 px-3 text-right font-semibold">${l.quantity || 1} ${l.unit || 'PCS'}</td>
                <td class="py-3 px-3 text-right">${Number(l.unitPrice || 0).toLocaleString()}</td>
                <td class="py-3 px-3 text-right font-bold text-slate-900">${Number(l.lineTotal || 0).toLocaleString()}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>

        <!-- Totals -->
        <div class="flex justify-end border-t border-slate-200 pt-4">
          <div class="w-64 space-y-2 text-xs">
            <div class="flex justify-between text-slate-500">
              <span>Subtotal:</span>
              <span class="font-semibold text-slate-800">${Number(invoice.subtotal || 0).toLocaleString()}</span>
            </div>
            ${invoice.discount ? `
            <div class="flex justify-between text-emerald-600">
              <span>Discount:</span>
              <span>- ${Number(invoice.discount).toLocaleString()}</span>
            </div>` : ''}
            <div class="flex justify-between text-base font-extrabold text-slate-900 border-t border-slate-200 pt-2">
              <span>Total Amount:</span>
              <span class="text-[#138FCB]">Rs. ${Number(invoice.total || 0).toLocaleString()}</span>
            </div>
          </div>
        </div>

        <!-- Footer -->
        ${tmpl.showPaymentInstructions ? `
        <div class="mt-8 pt-4 border-t border-dashed border-slate-200 text-xs text-slate-500">
          <p class="font-bold text-slate-700">Bank Transfer Details:</p>
          <p>Bank: Meezan Bank Ltd | Account Name: JS Traders | Account No: 0102-0100984711</p>
          <p class="mt-2 text-[11px] italic">${tmpl.footerNotes}</p>
        </div>` : ''}

        ${tmpl.showSignatures ? `
        <div class="mt-12 flex justify-between text-xs text-slate-500 pt-6">
          <div class="text-center w-48 border-t border-slate-300 pt-1">Prepared By (Accounts)</div>
          <div class="text-center w-48 border-t border-slate-300 pt-1">Authorized Signatory</div>
        </div>` : ''}
      </div>
    `;
  }
}

export const invoiceTemplateService = new InvoiceTemplateService();
