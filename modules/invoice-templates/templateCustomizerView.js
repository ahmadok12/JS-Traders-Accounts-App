/**
 * JS Traders ERP - Invoice Template Customizer View
 * Visual template designer for commercial invoices and gatepass documents.
 * Changes presentation only without affecting accounting or inventory calculations.
 */

import { invoiceTemplateService } from '../../services/invoiceTemplateService.js';
import { salesService } from '../../services/salesService.js';
import { productService } from '../../services/productService.js';
import { toast } from '../../components/toast.js';

export function renderTemplateCustomizerView() {
  const tmpl = invoiceTemplateService.getTemplate();
  const dummyInvoice = {
    invoiceNumber: 'INV-2025-001',
    date: '2025-09-18',
    dueDate: '2025-10-18',
    currency: 'PKR',
    subtotal: 56000,
    discount: 0,
    total: 56000
  };

  const dummyCustomer = {
    name: 'Ali Poultry Group',
    businessName: 'Ali Broiler & Layer Farms Pvt Ltd',
    address: 'Near Raiwind Road, Lahore, Pakistan',
    phone: '+92 300 8456123',
    paymentTerms: '30 Days Net'
  };

  const dummyLines = [
    { name: 'Feed Pan 16" - Made in China', sku: 'FP-CN-16-CHN', quantity: 40, unit: 'PCS', unitPrice: 1400, lineTotal: 56000 }
  ];

  const previewHtml = invoiceTemplateService.renderPrintableInvoice(dummyInvoice, dummyCustomer, dummyLines);

  return `
    <div id="tmpl-customizer-container" class="space-y-6 animate-in fade-in duration-150">
      <div class="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <!-- Controls Column (4 cols) -->
        <div class="lg:col-span-4 bg-white p-5 rounded-2xl border border-slate-200 shadow-[0_2px_4px_rgba(0,0,0,0.02)] space-y-4">
          <div class="pb-3 border-b border-slate-100">
            <h2 class="text-sm font-bold text-slate-900">Invoice Template Customizer</h2>
            <p class="text-[11px] text-slate-400 mt-0.5">Toggle visual elements and layout styling</p>
          </div>

          <div class="space-y-3 text-xs">
            <div>
              <label class="block font-bold text-slate-700 mb-1">Paper Layout / Format</label>
              <select id="tmpl-paper-size" class="w-full border border-slate-200 rounded-xl px-3 py-2 text-slate-800 font-semibold focus:outline-none focus:border-[#138FCB]">
                <option value="A4" ${tmpl.paperSize === 'A4' ? 'selected' : ''}>Standard Commercial A4</option>
                <option value="Letter" ${tmpl.paperSize === 'Letter' ? 'selected' : ''}>Letterhead (8.5" x 11")</option>
                <option value="Thermal" ${tmpl.paperSize === 'Thermal' ? 'selected' : ''}>Thermal 80mm Warehouse Dispatch</option>
              </select>
            </div>

            <!-- Feature Toggles -->
            <div class="p-3.5 bg-slate-50 rounded-xl border border-slate-200 space-y-2.5">
              <span class="text-[10px] font-bold text-slate-700 uppercase tracking-wider block">Visual Sections</span>

              <label class="flex items-center justify-between cursor-pointer">
                <span class="text-slate-700 font-medium">Show Company Logo</span>
                <input type="checkbox" id="tmpl-logo" ${tmpl.showLogo ? 'checked' : ''} class="rounded text-[#138FCB] focus:ring-0">
              </label>

              <label class="flex items-center justify-between cursor-pointer">
                <span class="text-slate-700 font-medium">Show Urdu Title (سیلز انوائس)</span>
                <input type="checkbox" id="tmpl-urdu" ${tmpl.showUrduHeader ? 'checked' : ''} class="rounded text-[#138FCB] focus:ring-0">
              </label>

              <label class="flex items-center justify-between cursor-pointer">
                <span class="text-slate-700 font-medium">Show Bank Details</span>
                <input type="checkbox" id="tmpl-bank" ${tmpl.showPaymentInstructions ? 'checked' : ''} class="rounded text-[#138FCB] focus:ring-0">
              </label>

              <label class="flex items-center justify-between cursor-pointer">
                <span class="text-slate-700 font-medium">Show Signature Authorization Lines</span>
                <input type="checkbox" id="tmpl-sig" ${tmpl.showSignatures ? 'checked' : ''} class="rounded text-[#138FCB] focus:ring-0">
              </label>
            </div>

            <div>
              <label class="block font-bold text-slate-700 mb-1">Footer Notes & Terms</label>
              <textarea id="tmpl-notes" rows="3" class="w-full border border-slate-200 rounded-xl px-3 py-2 text-slate-800">${tmpl.footerNotes}</textarea>
            </div>

            <button id="save-tmpl-btn" class="w-full py-2.5 bg-[#138FCB] hover:bg-[#0E78AC] text-white rounded-xl font-bold shadow-xs transition-colors cursor-pointer">
              Apply Template Changes
            </button>
          </div>
        </div>

        <!-- Live Preview Column (8 cols) -->
        <div class="lg:col-span-8 bg-white p-6 rounded-2xl border border-slate-200 shadow-[0_2px_4px_rgba(0,0,0,0.02)] flex flex-col justify-between">
          <div class="flex items-center justify-between pb-3 border-b border-slate-100 mb-4">
            <span class="text-xs font-bold text-slate-500 uppercase tracking-wider">Live Document Preview</span>
            <span class="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700">● Real-time Rendering</span>
          </div>

          <div id="tmpl-live-preview-box" class="overflow-x-auto">
            ${previewHtml}
          </div>
        </div>
      </div>
    </div>
  `;
}

export function bindTemplateCustomizerEvents(container, refreshCallback) {
  const saveBtn = container.querySelector('#save-tmpl-btn');
  if (saveBtn) {
    saveBtn.onclick = () => {
      const paperSize = container.querySelector('#tmpl-paper-size').value;
      const showLogo = container.querySelector('#tmpl-logo').checked;
      const showUrduHeader = container.querySelector('#tmpl-urdu').checked;
      const showPaymentInstructions = container.querySelector('#tmpl-bank').checked;
      const showSignatures = container.querySelector('#tmpl-sig').checked;
      const footerNotes = container.querySelector('#tmpl-notes').value.trim();

      invoiceTemplateService.updateTemplate({
        paperSize,
        showLogo,
        showUrduHeader,
        showPaymentInstructions,
        showSignatures,
        footerNotes
      });

      toast.show('Template visual styling applied.', 'success');
      container.innerHTML = renderTemplateCustomizerView();
      bindTemplateCustomizerEvents(container, refreshCallback);
    };
  }
}
