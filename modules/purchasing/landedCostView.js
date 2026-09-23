/**
 * JS Traders ERP - Landed Cost Engine & Allocation Hub
 * Calculates and allocates freight, customs duty, port clearance, and handling expenses
 * across imported poultry automation cargo to determine true landed product unit costs.
 */

import { purchasingService } from '../../services/purchasingService.js';
import { productService } from '../../services/productService.js';
import { toast } from '../../components/toast.js';

export function renderLandedCostView() {
  const shipments = purchasingService.getImportShipments();
  const variants = productService.getVariants();
  const varMap = new Map(variants.map(v => [v.id, v]));

  // Calculate total landed costs across shipments
  let totalLandedPool = 0;
  shipments.forEach(s => {
    (s.expenses || []).forEach(e => {
      totalLandedPool += Number(e.amountPkr) || 0;
    });
  });

  return `
    <div class="space-y-6 animate-in fade-in duration-150">

      <!-- Header & Intro -->
      <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 class="text-xl font-extrabold text-slate-900 tracking-tight">Landed Cost Engine & Valuation</h2>
          <p class="text-xs text-slate-500 mt-1">Allocate freight, customs, demurrage, and port handling into inventory valuation.</p>
        </div>
        <div class="flex items-center gap-2">
          <button id="recalc-all-landed-btn" class="px-4 py-2 bg-[#138FCB] hover:bg-[#0E78AC] text-white text-xs font-bold rounded-xl shadow-xs transition-colors cursor-pointer">
            ⚡ Recalculate All Active Shipments
          </button>
        </div>
      </div>

      <!-- Landed Cost Metrics -->
      <div class="grid grid-cols-1 sm:grid-cols-4 gap-4">
        <div class="bg-white p-4 rounded-2xl border border-slate-200 shadow-2xs">
          <span class="text-[10px] font-extrabold uppercase text-slate-400">Total Landed Pool</span>
          <div class="text-2xl font-black text-[#138FCB] mt-1">Rs. ${totalLandedPool.toLocaleString()}</div>
          <span class="text-[11px] text-emerald-600 font-bold">● Capitalized into inventory</span>
        </div>

        <div class="bg-white p-4 rounded-2xl border border-slate-200 shadow-2xs">
          <span class="text-[10px] font-extrabold uppercase text-slate-400">Active Import Containers</span>
          <div class="text-2xl font-black text-slate-900 mt-1">${shipments.length} Containers</div>
          <span class="text-[11px] text-slate-500 font-medium">FOB / EXW shipments</span>
        </div>

        <div class="bg-white p-4 rounded-2xl border border-slate-200 shadow-2xs">
          <span class="text-[10px] font-extrabold uppercase text-slate-400">Average Duty & Freight</span>
          <div class="text-2xl font-black text-amber-600 mt-1">28.4%</div>
          <span class="text-[11px] text-slate-500 font-medium">Added on FOB price</span>
        </div>

        <div class="bg-white p-4 rounded-2xl border border-slate-200 shadow-2xs">
          <span class="text-[10px] font-extrabold uppercase text-slate-400">Default Allocation</span>
          <div class="text-2xl font-black text-purple-600 mt-1">By Value</div>
          <span class="text-[11px] text-slate-500 font-medium">Alternative: By Weight / Volume</span>
        </div>
      </div>

      <!-- Shipment Containers with Landed Cost Allocators -->
      <div class="space-y-4">
        <h3 class="text-sm font-extrabold text-slate-800">Containers & Landed Cost Distribution</h3>

        <div class="grid grid-cols-1 gap-4">
          ${shipments.map(s => {
            const expenses = s.expenses || [];
            const shipmentLanded = expenses.reduce((sum, e) => sum + (Number(e.amountPkr) || 0), 0);

            return `
              <div class="bg-white rounded-2xl border border-slate-200 p-5 shadow-2xs space-y-4">
                <div class="flex flex-col sm:flex-row sm:items-center justify-between pb-3 border-b border-slate-100 gap-3">
                  <div class="flex items-center gap-3">
                    <div class="w-10 h-10 rounded-xl bg-blue-50 text-[#138FCB] flex items-center justify-center text-lg font-bold">
                      🚢
                    </div>
                    <div>
                      <div class="flex items-center gap-2">
                        <h4 class="text-sm font-extrabold text-slate-900">${s.shipmentNumber}</h4>
                        <span class="px-2 py-0.5 rounded text-[10px] font-bold ${s.shippingTerm === 'FOB' ? 'bg-blue-50 text-blue-700' : 'bg-amber-50 text-amber-700'}">
                          ${s.shippingTerm}
                        </span>
                        <span class="text-xs font-mono text-slate-500 font-bold">${s.containerNumber}</span>
                      </div>
                      <p class="text-xs text-slate-400 mt-0.5">Route: ${s.originPort || 'Shanghai'} → ${s.destinationPort || 'Karachi Port'} • Carrier: ${s.carrierName || 'Maersk'}</p>
                    </div>
                  </div>

                  <div class="text-right">
                    <span class="text-[10px] font-bold text-slate-400 uppercase">Allocated Landed Cost</span>
                    <div class="text-lg font-black text-[#138FCB]">Rs. ${shipmentLanded.toLocaleString()}</div>
                  </div>
                </div>

                <!-- Expenses breakdown tags -->
                <div class="space-y-1.5">
                  <span class="text-[10px] font-bold text-slate-400 uppercase">Expense Items Incurred</span>
                  <div class="flex flex-wrap gap-2">
                    ${expenses.map(e => `
                      <span class="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg bg-slate-50 border border-slate-200 text-xs font-semibold text-slate-700">
                        <span class="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                        <span>${e.name}:</span>
                        <strong class="text-slate-900 font-bold">Rs. ${Number(e.amountPkr).toLocaleString()}</strong>
                      </span>
                    `).join('')}
                  </div>
                </div>

                <!-- Allocation Formula Switcher & Action -->
                <div class="pt-3 border-t border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
                  <div class="flex items-center gap-3">
                    <span class="font-bold text-slate-700">Allocation Basis:</span>
                    <div class="inline-flex rounded-xl bg-slate-100 p-0.5 text-xs font-semibold text-slate-600">
                      ${['Value', 'Quantity', 'Weight', 'Volume'].map(m => `
                        <button class="lc-basis-btn px-2.5 py-1 rounded-lg transition-all ${
                          (s.allocationMethod || 'Value') === m ? 'bg-white text-[#138FCB] shadow-2xs font-bold' : 'hover:text-slate-900'
                        }" data-shipment-id="${s.id}" data-method="${m}">
                          ${m}
                        </button>
                      `).join('')}
                    </div>
                  </div>

                  <button class="allocate-shipment-btn px-3.5 py-1.5 rounded-xl bg-emerald-50 text-emerald-800 hover:bg-emerald-100 border border-emerald-200 font-bold text-xs transition-colors cursor-pointer" data-id="${s.id}">
                    Apply Landed Cost to SKUs →
                  </button>
                </div>
              </div>
            `;
          }).join('')}
        </div>
      </div>

    </div>
  `;
}

export function bindLandedCostEvents(container, refreshCallback) {
  // Re-calculate all
  const recalcBtn = container.querySelector('#recalc-all-landed-btn');
  if (recalcBtn) {
    recalcBtn.onclick = () => {
      const shipments = purchasingService.getImportShipments();
      shipments.forEach(s => purchasingService.allocateLandedCost(s.id, s.allocationMethod || 'Value'));
      toast.show('All import shipments landed costs successfully recalculated and updated in product valuations.', 'success');
      if (refreshCallback) refreshCallback();
    };
  }

  // Allocate single shipment
  container.querySelectorAll('.allocate-shipment-btn').forEach(btn => {
    btn.onclick = (e) => {
      const id = e.currentTarget.getAttribute('data-id');
      purchasingService.allocateLandedCost(id, 'Value');
      toast.show('Landed cost successfully updated across shipment inventory items.', 'success');
      if (refreshCallback) refreshCallback();
    };
  });

  // Basis buttons
  container.querySelectorAll('.lc-basis-btn').forEach(btn => {
    btn.onclick = (e) => {
      const id = e.currentTarget.getAttribute('data-shipment-id');
      const method = e.currentTarget.getAttribute('data-method');
      purchasingService.allocateLandedCost(id, method);
      toast.show(`Allocation basis changed to: ${method}`, 'info');
      if (refreshCallback) refreshCallback();
    };
  });
}
