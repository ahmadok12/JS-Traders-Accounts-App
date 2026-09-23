/**
 * JS Traders ERP - Filter Bar Component
 * Matches design specification from Design/code 2.html
 */

export function renderFilterBar({
  searchPlaceholder = 'Search records...',
  searchValue = '',
  dropdowns = [], // Array of { id, label, options: [{ value, label }], value }
  primaryAction = null, // { label, icon, onClick }
  secondaryAction = null // { label, icon, onClick }
}) {
  return `
    <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white p-3 sm:p-4 rounded-2xl border border-[#EAECEF] shadow-[0_2px_4px_rgba(0,0,0,0.02)]">
      <!-- Search Input -->
      <div class="relative flex-1 max-w-md">
        <svg class="w-3.5 h-3.5 text-gray-400 absolute left-3 top-3 pointer-events-none" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"></path>
        </svg>
        <input
          id="filter-search-input"
          class="w-full pl-8 pr-4 py-2 text-xs bg-white border border-[#E2E5EA] rounded-xl focus:outline-none focus:border-[#138FCB] placeholder-gray-400 shadow-2xs transition-colors"
          placeholder="${searchPlaceholder}"
          value="${searchValue}"
          type="text">
      </div>

      <!-- Dropdown Selects & Actions -->
      <div class="flex items-center flex-wrap gap-2.5">
        ${dropdowns.map(dd => `
          <select
            id="${dd.id}"
            class="filter-dropdown text-xs bg-white border border-[#E2E5EA] rounded-xl px-3 py-2 text-slate-700 font-medium focus:outline-none focus:border-[#138FCB] shadow-2xs cursor-pointer">
            ${dd.options.map(opt => `
              <option value="${opt.value}" ${opt.value === dd.value ? 'selected' : ''}>${opt.label}</option>
            `).join('')}
          </select>
        `).join('')}

        ${secondaryAction ? `
          <button id="filter-secondary-btn" class="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold bg-white border border-[#E2E5EA] text-slate-700 rounded-xl hover:bg-slate-50 transition-colors shadow-2xs cursor-pointer">
            ${secondaryAction.icon || ''}
            <span>${secondaryAction.label}</span>
          </button>
        ` : ''}

        ${primaryAction ? `
          <button id="filter-primary-btn" class="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-bold bg-[#138FCB] text-white rounded-xl hover:bg-[#0E78AC] transition-colors shadow-xs cursor-pointer">
            <span>+</span>
            <span>${primaryAction.label}</span>
          </button>
        ` : ''}
      </div>
    </div>
  `;
}
