/**
 * JS Traders ERP - KPI Metric Cards Component
 * Faithfully matches design specifications from Design/code 2.html
 */

export function renderMetricCard({ title, value, unit = '', delta = '', deltaPositive = true, bars = [2, 4, 7, 5, 8] }) {
  return `
    <div class="bg-white rounded-2xl p-4 border border-[#EAECEF] shadow-[0_2px_4px_rgba(0,0,0,0.02)] flex flex-col justify-between">
      <div class="flex items-center justify-between text-neutralText">
        <span class="text-[11px] font-bold tracking-wider text-gray-400 uppercase">${title}</span>
      </div>
      <div class="flex items-baseline justify-between mt-2">
        <div class="flex items-baseline gap-1.5">
          <span class="text-2xl font-extrabold text-[#1A1D1F] tracking-tight">${value}</span>
          ${unit ? `<span class="text-xs text-slate-500 font-medium">${unit}</span>` : ''}
        </div>
        <!-- Mini Sparkline Bars Indicator -->
        <div class="flex items-end gap-1 h-7">
          ${bars.map(h => `<div class="w-1 bg-[#138FCB] rounded-full" style="height: ${h * 3.5}px;"></div>`).join('')}
        </div>
      </div>
      ${delta ? `
      <div class="mt-3 pt-2.5 border-t border-[#F0F2F4] flex items-center justify-between text-[11px]">
        <div class="w-3.5 h-3.5 rounded-full border border-gray-300 flex items-center justify-center text-[9px] text-gray-400 font-serif">i</div>
        <div class="flex items-center gap-1 font-semibold ${deltaPositive ? 'text-[#138FCB]' : 'text-rose-600'}">
          <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path d="${deltaPositive ? 'M5 10l7-7m0 0l7 7m-7-7v18' : 'M19 14l-7 7m0 0l-7-7m7 7V3'}" stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5"></path>
          </svg>
          <span>${delta}</span>
        </div>
      </div>` : ''}
    </div>
  `;
}
