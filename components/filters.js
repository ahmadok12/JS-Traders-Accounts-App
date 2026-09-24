/**
 * JS Traders ERP - Filter Bar Component
 * Replaces square browser OS dropdowns with rounded card theme dropdowns.
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
        ${dropdowns.map(dd => renderCustomDropdown(dd)).join('')}

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

/**
 * Render an individual custom dropdown in rounded card theme.
 * Keeps an underlying hidden <select> to remain 100% compatible with existing form & change listeners.
 */
export function renderCustomDropdown({
  id,
  options = [],
  value = '',
  label = '',
  buttonClass = '',
  cardClass = ''
}) {
  const selectedOption = options.find(opt => String(opt.value) === String(value)) || options[0] || { label: label || 'Select', value: '' };

  return `
    <div class="custom-filter-dropdown-container relative" data-dropdown-id="${id}">
      <!-- Hidden select element to maintain 100% backwards compatibility with element.value and element.onchange -->
      <select
        id="${id}"
        class="filter-dropdown hidden"
        tabindex="-1">
        ${options.map(opt => `
          <option value="${opt.value}" ${String(opt.value) === String(value) ? 'selected' : ''}>${opt.label}</option>
        `).join('')}
      </select>

      <!-- Rounded Card Theme Dropdown Trigger Button -->
      <button
        type="button"
        class="custom-filter-dropdown-trigger text-xs bg-white border border-[#E2E5EA] hover:border-[#138FCB] rounded-xl px-3 py-2 text-slate-700 font-semibold focus:outline-none shadow-2xs cursor-pointer flex items-center justify-between gap-2.5 transition-all ${buttonClass}">
        <span class="custom-filter-dropdown-label text-slate-700 font-semibold">${selectedOption.label}</span>
        <svg class="w-3.5 h-3.5 text-slate-400 shrink-0 transition-transform duration-150" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path d="M19 9l-7 7-7-7" stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5"></path>
        </svg>
      </button>

      <!-- Rounded Card Theme Dropdown Popup -->
      <div
        class="custom-filter-dropdown-card hidden absolute left-0 sm:right-auto top-full mt-1.5 min-w-[200px] max-h-64 overflow-y-auto bg-white rounded-2xl border border-slate-200/90 shadow-xl p-1.5 z-50 animate-in fade-in zoom-in-95 duration-100 ${cardClass}">
        ${options.map(opt => {
          const isSelected = String(opt.value) === String(value);
          return `
            <button
              type="button"
              data-value="${opt.value}"
              class="custom-filter-dropdown-option w-full text-left px-3 py-2 rounded-xl text-xs transition-colors flex items-center justify-between cursor-pointer ${
                isSelected ? 'bg-blue-50 text-[#138FCB] font-bold' : 'text-slate-700 font-medium hover:bg-slate-50 hover:text-slate-900'
              }">
              <span>${opt.label}</span>
              ${isSelected ? '<span class="check-icon text-xs font-bold text-[#138FCB]">✓</span>' : ''}
            </button>
          `;
        }).join('')}
      </div>
    </div>
  `;
}

// Global click event delegation for rounded card dropdowns across the ERP application
if (typeof document !== 'undefined' && !window.__customFilterDropdownsBound) {
  window.__customFilterDropdownsBound = true;

  document.addEventListener('click', (e) => {
    // 1. If clicking a dropdown trigger
    const trigger = e.target.closest('.custom-filter-dropdown-trigger');
    if (trigger) {
      e.stopPropagation();
      const container = trigger.closest('.custom-filter-dropdown-container');
      const card = container?.querySelector('.custom-filter-dropdown-card');
      const arrow = trigger.querySelector('svg');

      // Close all other open cards
      document.querySelectorAll('.custom-filter-dropdown-card').forEach(c => {
        if (c !== card) c.classList.add('hidden');
      });
      document.querySelectorAll('.custom-filter-dropdown-trigger svg').forEach(svg => {
        if (svg !== arrow) svg.classList.remove('rotate-180');
      });

      if (card) {
        const isHidden = card.classList.toggle('hidden');
        if (arrow) arrow.classList.toggle('rotate-180', !isHidden);
      }
      return;
    }

    // 2. If clicking a dropdown option
    const optionBtn = e.target.closest('.custom-filter-dropdown-option');
    if (optionBtn) {
      e.stopPropagation();
      const container = optionBtn.closest('.custom-filter-dropdown-container');
      if (!container) return;
      const card = container.querySelector('.custom-filter-dropdown-card');
      const triggerLabel = container.querySelector('.custom-filter-dropdown-label');
      const select = container.querySelector('select');
      const arrow = container.querySelector('.custom-filter-dropdown-trigger svg');

      const val = optionBtn.getAttribute('data-value');
      const labelText = optionBtn.querySelector('span')?.textContent || optionBtn.textContent.trim();

      // Update trigger button preview text immediately
      if (triggerLabel) triggerLabel.textContent = labelText;

      // Update active styling
      container.querySelectorAll('.custom-filter-dropdown-option').forEach(btn => {
        const isThis = btn.getAttribute('data-value') === val;
        btn.className = `custom-filter-dropdown-option w-full text-left px-3 py-2 rounded-xl text-xs transition-colors flex items-center justify-between cursor-pointer ${
          isThis ? 'bg-blue-50 text-[#138FCB] font-bold' : 'text-slate-700 font-medium hover:bg-slate-50 hover:text-slate-900'
        }`;
        const check = btn.querySelector('.check-icon');
        if (isThis && !check) {
          btn.insertAdjacentHTML('beforeend', '<span class="check-icon text-xs font-bold text-[#138FCB]">✓</span>');
        } else if (!isThis && check) {
          check.remove();
        }
      });

      // Close card
      if (card) card.classList.add('hidden');
      if (arrow) arrow.classList.remove('rotate-180');

      // Update underlying select element value and dispatch change
      if (select) {
        select.value = val;
        select.dispatchEvent(new Event('change', { bubbles: true }));
        if (typeof select.onchange === 'function') {
          select.onchange({ target: select });
        }
      }
      return;
    }

    // 3. Clicked outside -> close all dropdown cards
    document.querySelectorAll('.custom-filter-dropdown-card').forEach(c => c.classList.add('hidden'));
    document.querySelectorAll('.custom-filter-dropdown-trigger svg').forEach(svg => svg.classList.remove('rotate-180'));
  });
}
