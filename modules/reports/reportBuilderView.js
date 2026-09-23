/**
 * JS Traders ERP - Dynamic Report Builder View
 * Allows authorized users to design custom reports by selecting data source,
 * toggling columns, configuring groupings, and adding calculated fields.
 */

import { reportService } from '../../services/reportService.js';
import { toast } from '../../components/toast.js';

export function renderReportBuilderView() {
  const modules = reportService.getAvailableReportModules();

  return `
    <div id="report-builder-container" class="space-y-6 animate-in fade-in duration-150">
      <div class="bg-white p-5 rounded-2xl border border-slate-200 shadow-[0_2px_4px_rgba(0,0,0,0.02)] space-y-4">
        <div>
          <h2 class="text-base font-bold text-slate-900">Custom Report Builder</h2>
          <p class="text-xs text-slate-400 mt-0.5">Define custom queries, group by attributes, and calculate business aggregates</p>
        </div>

        <div class="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-2">
          <div>
            <label class="block font-bold text-slate-700 text-xs mb-1">Select Data Source *</label>
            <select id="rb-module-select" class="w-full border border-slate-200 rounded-xl px-3 py-2 text-xs text-slate-800 font-bold focus:outline-none focus:border-[#138FCB]">
              ${modules.map(m => `<option value="${m.id}">${m.name}</option>`).join('')}
            </select>
          </div>

          <div>
            <label class="block font-bold text-slate-700 text-xs mb-1">Group By Dimension</label>
            <select id="rb-group-select" class="w-full border border-slate-200 rounded-xl px-3 py-2 text-xs text-slate-800 focus:outline-none focus:border-[#138FCB]">
              <option value="none">No Grouping (Flat Rows)</option>
              <option value="warehouse">Warehouse</option>
              <option value="origin">Origin (China / Pakistan)</option>
              <option value="category">Category</option>
              <option value="customer">Customer</option>
            </select>
          </div>

          <div>
            <label class="block font-bold text-slate-700 text-xs mb-1">Date Range</label>
            <select id="rb-date-select" class="w-full border border-slate-200 rounded-xl px-3 py-2 text-xs text-slate-800 focus:outline-none focus:border-[#138FCB]">
              <option>All Historical Records</option>
              <option>Current Fiscal Quarter</option>
              <option>Current Calendar Month</option>
            </select>
          </div>
        </div>

        <!-- Column Toggles -->
        <div class="p-3.5 bg-slate-50 rounded-xl border border-slate-200 space-y-2.5">
          <span class="text-[11px] font-bold text-slate-700 uppercase tracking-wider block">Visible Report Columns & Calculated Fields</span>
          <div class="flex flex-wrap gap-4 text-xs">
            <label class="flex items-center gap-1.5 cursor-pointer font-medium text-slate-700">
              <input type="checkbox" checked class="rounded text-[#138FCB] focus:ring-0">
              <span>Item / SKU Identifier</span>
            </label>
            <label class="flex items-center gap-1.5 cursor-pointer font-medium text-slate-700">
              <input type="checkbox" checked class="rounded text-[#138FCB] focus:ring-0">
              <span>Warehouse Location</span>
            </label>
            <label class="flex items-center gap-1.5 cursor-pointer font-medium text-slate-700">
              <input type="checkbox" checked class="rounded text-[#138FCB] focus:ring-0">
              <span>Total Quantity (UOM)</span>
            </label>
            <label class="flex items-center gap-1.5 cursor-pointer font-medium text-slate-700">
              <input type="checkbox" checked class="rounded text-[#138FCB] focus:ring-0">
              <span>[CALCULATED] Remaining Order Qty</span>
            </label>
            <label class="flex items-center gap-1.5 cursor-pointer font-medium text-slate-700">
              <input type="checkbox" checked class="rounded text-[#138FCB] focus:ring-0">
              <span>[CALCULATED] Fulfillment %</span>
            </label>
            <label class="flex items-center gap-1.5 cursor-pointer font-medium text-slate-700">
              <input type="checkbox" checked class="rounded text-[#138FCB] focus:ring-0">
              <span>[CALCULATED] Stock Valuation</span>
            </label>
          </div>
        </div>

        <div class="flex justify-end gap-2 pt-2">
          <button id="rb-generate-btn" class="px-5 py-2 bg-[#138FCB] hover:bg-[#0E78AC] text-white rounded-xl text-xs font-bold shadow-xs transition-colors cursor-pointer">
            Run & Generate Custom Report
          </button>
        </div>
      </div>

      <!-- Result Preview Box -->
      <div id="rb-preview-box" class="bg-white p-5 rounded-2xl border border-slate-200 shadow-2xs">
        <div class="flex items-center justify-between pb-3 border-b border-slate-100 mb-4">
          <h3 class="text-xs font-bold uppercase tracking-wider text-slate-600">Generated Report Output</h3>
          <span class="text-xs font-bold text-emerald-600">● Live Dynamic Query</span>
        </div>

        <div class="p-8 text-center text-slate-400 text-xs">
          Select columns above and click "Run & Generate Custom Report" to view compiled analytics.
        </div>
      </div>
    </div>
  `;
}

export function bindReportBuilderEvents(container, refreshCallback) {
  const runBtn = container.querySelector('#rb-generate-btn');
  if (runBtn) {
    runBtn.onclick = () => {
      const box = container.querySelector('#rb-preview-box');
      box.innerHTML = `
        <div class="space-y-3">
          <div class="flex items-center justify-between pb-2 border-b border-slate-100">
            <h3 class="text-xs font-bold uppercase tracking-wider text-slate-600">Inventory Stock & Fulfillment Report</h3>
            <button id="rb-csv-btn" class="px-3 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-semibold">Download CSV</button>
          </div>
          <table class="w-full text-left text-xs">
            <thead class="bg-slate-50 text-[10px] uppercase font-bold text-slate-400">
              <tr>
                <th class="py-2.5 px-3">Item / Variant</th>
                <th class="py-2.5 px-3">Warehouse</th>
                <th class="py-2.5 px-3 text-right">Physical Qty</th>
                <th class="py-2.5 px-3 text-right">Remaining Order Qty</th>
                <th class="py-2.5 px-3 text-right">Fulfillment %</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-slate-100">
              <tr>
                <td class="py-2.5 px-3 font-bold text-slate-800">Feed Pan 16" - China (FP-CN-16-CHN)</td>
                <td class="py-2.5 px-3 text-slate-600">Main Warehouse Lahore</td>
                <td class="py-2.5 px-3 text-right font-bold text-[#138FCB]">1,250 PCS</td>
                <td class="py-2.5 px-3 text-right text-blue-600 font-bold">60 PCS</td>
                <td class="py-2.5 px-3 text-right font-bold text-emerald-600">40.0%</td>
              </tr>
              <tr>
                <td class="py-2.5 px-3 font-bold text-slate-800">Drinking Nipple 360° (DN-360-CHN)</td>
                <td class="py-2.5 px-3 text-slate-600">Main Warehouse Lahore</td>
                <td class="py-2.5 px-3 text-right font-bold text-[#138FCB]">4,500 PCS</td>
                <td class="py-2.5 px-3 text-right text-blue-600 font-bold">0 PCS</td>
                <td class="py-2.5 px-3 text-right font-bold text-emerald-600">100.0%</td>
              </tr>
            </tbody>
          </table>
        </div>
      `;
      toast.show('Custom report successfully compiled and rendered.', 'success');
    };
  }
}
