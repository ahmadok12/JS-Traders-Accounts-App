/**
 * JS Traders ERP - Unsaved Changes Guard
 * Prevents accidental loss of user data:
 * 1. Blocks closing/refreshing browser tab via beforeunload if any form has entered data.
 * 2. Intercepts accidental close clicks on modals, drawers, or backdrop overlays with a confirmation prompt.
 * 3. Intercepts in-app navigation (sidebar/hash changes) if active forms have unsaved changes.
 */

let isGuardInitialized = false;

/**
 * Filter out search inputs, filter bars, and non-data-entry controls
 */
export function isIgnoredInput(el) {
  if (!el) return true;
  if (el.readOnly || el.disabled) return true;
  if (el.type === 'hidden' || el.type === 'button' || el.type === 'submit' || el.type === 'reset') return true;
  if (el.hasAttribute('data-no-dirty-check') || el.hasAttribute('data-ignore-dirty')) return true;

  // Search & filter components
  if (el.id === 'filter-search-input' || el.id === 'product-search-input' || el.id === 'header-search-bar') return true;
  if (el.type === 'search') return true;
  if (el.classList.contains('filter-dropdown')) return true;
  if (el.closest('.custom-filter-dropdown-container') || el.closest('#category-tabs-container') || el.closest('.filter-bar')) return true;

  return false;
}

/**
 * Capture baseline state of all editable controls inside a container
 */
export function snapshotFormInitialState(container) {
  if (!container) return;

  const inputs = container.querySelectorAll('input, textarea, select');
  inputs.forEach(input => {
    if (isIgnoredInput(input)) return;

    if (input.type === 'checkbox' || input.type === 'radio') {
      input.dataset.initialChecked = input.checked ? 'true' : 'false';
    } else {
      input.dataset.initialValue = input.value;
    }
  });

  // Snapshot dynamic table row counts (e.g. line items)
  const rows = container.querySelectorAll('table tbody tr:not(.empty-placeholder-row):not(.empty-table-row)');
  container.dataset.initialRowCount = String(rows.length);
  container.dataset.isSubmitting = 'false';
  container.dataset.isDirty = 'false';
}

/**
 * Inspect whether user has entered or changed data in the given container
 */
export function hasEnteredData(container) {
  if (!container) return false;
  if (container.dataset.isSubmitting === 'true' || container.dataset.formSaved === 'true') {
    return false;
  }

  const inputs = container.querySelectorAll('input, textarea, select');
  for (const input of inputs) {
    if (isIgnoredInput(input)) continue;

    // Checkbox or radio
    if (input.type === 'checkbox' || input.type === 'radio') {
      const currentChecked = input.checked ? 'true' : 'false';
      if (input.dataset.initialChecked !== undefined) {
        if (currentChecked !== input.dataset.initialChecked) return true;
      } else if (input.checked !== input.defaultChecked) {
        return true;
      }
      continue;
    }

    // Select dropdown
    if (input.tagName === 'SELECT') {
      if (input.dataset.initialValue !== undefined) {
        if (input.value !== input.dataset.initialValue) return true;
      } else if (input.selectedIndex > 0 && input.value !== '') {
        return true;
      }
      continue;
    }

    // Text / Number / Date / Textarea
    const val = input.value || '';
    if (input.dataset.initialValue !== undefined) {
      if (val !== input.dataset.initialValue) return true;
    } else {
      // Fallback: check against defaultValue or non-empty user entry
      if (val.trim() !== '' && val !== input.defaultValue) return true;
      if (input.dataset.userModified === 'true' && val.trim() !== '') return true;
    }
  }

  // Check dynamic table row additions/removals
  if (container.dataset.initialRowCount !== undefined) {
    const initialRows = parseInt(container.dataset.initialRowCount, 10);
    const currentRows = container.querySelectorAll('table tbody tr:not(.empty-placeholder-row):not(.empty-table-row)').length;
    if (currentRows !== initialRows) return true;
  }

  return false;
}

/**
 * Check if there is ANY unsaved entered data anywhere across the active screen
 */
export function hasAnyUnsavedData() {
  // 1. Check active modal overlay
  const activeModal = document.getElementById('active-modal-overlay');
  if (activeModal && hasEnteredData(activeModal)) {
    return true;
  }

  // 2. Check active slide-over drawer
  const activeDrawer = document.getElementById('app-drawer-panel');
  if (activeDrawer && hasEnteredData(activeDrawer)) {
    return true;
  }

  // 3. Check any form in the active workspace
  const workspaceForms = document.querySelectorAll('#primary-workspace form, #wh-primary-workspace form, #sales-primary-workspace form');
  for (const form of workspaceForms) {
    if (hasEnteredData(form)) return true;
  }

  return false;
}

/**
 * Mark a container / form as clean / submitted
 */
export function markFormClean(container) {
  if (!container) return;
  container.dataset.isSubmitting = 'true';
  container.dataset.formSaved = 'true';
  container.dataset.isDirty = 'false';
}

/**
 * Display a high-fidelity confirmation modal to confirm discarding entered data
 */
export function confirmDiscardChanges({
  title = 'Unsaved Changes',
  message = 'You have entered data in this form. If you leave or close now, your unsaved changes will be lost.',
  confirmLabel = 'Discard & Close',
  cancelLabel = 'Keep Editing',
  onDiscard,
  onCancel
}) {
  // Remove any previously open prompt
  const existingPrompt = document.getElementById('unsaved-changes-confirm-overlay');
  if (existingPrompt) existingPrompt.remove();

  const overlay = document.createElement('div');
  overlay.id = 'unsaved-changes-confirm-overlay';
  overlay.className = 'fixed inset-0 z-[70] bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in duration-150';

  overlay.innerHTML = `
    <div class="bg-white rounded-3xl shadow-2xl border border-slate-100 max-w-sm w-full p-6 text-center animate-in zoom-in-95 duration-150" role="dialog" aria-modal="true">
      <div class="w-12 h-12 rounded-2xl bg-amber-50 text-amber-600 border border-amber-200/60 flex items-center justify-center text-xl font-bold mx-auto mb-3 shadow-2xs">
        ⚠️
      </div>
      <h3 class="text-base font-bold text-slate-900">${title}</h3>
      <p class="text-xs text-slate-500 mt-2 leading-relaxed">
        ${message}
      </p>
      <div class="flex items-center justify-center gap-2.5 mt-6 pt-4 border-t border-slate-100">
        <button
          id="discard-keep-btn"
          type="button"
          class="flex-1 px-4 py-2.5 text-xs font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-xl transition-colors cursor-pointer">
          ${cancelLabel}
        </button>
        <button
          id="discard-proceed-btn"
          type="button"
          class="flex-1 px-4 py-2.5 text-xs font-bold text-white bg-rose-600 hover:bg-rose-700 rounded-xl shadow-xs transition-colors cursor-pointer">
          ${confirmLabel}
        </button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  const cleanup = () => {
    document.removeEventListener('keydown', keyHandler);
    overlay.remove();
  };

  const keepBtn = overlay.querySelector('#discard-keep-btn');
  const proceedBtn = overlay.querySelector('#discard-proceed-btn');

  keepBtn.onclick = (e) => {
    e.stopPropagation();
    cleanup();
    if (onCancel) onCancel();
  };

  proceedBtn.onclick = (e) => {
    e.stopPropagation();
    cleanup();
    if (onDiscard) onDiscard();
  };

  // Click outside on overlay backdrop treats as Cancel (keep editing)
  overlay.onclick = (e) => {
    if (e.target === overlay) {
      e.stopPropagation();
      cleanup();
      if (onCancel) onCancel();
    }
  };

  // Keyboard Escape triggers Keep Editing
  const keyHandler = (e) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      cleanup();
      if (onCancel) onCancel();
    }
  };
  document.addEventListener('keydown', keyHandler);

  // Focus keepBtn as safe default
  if (keepBtn) keepBtn.focus();
}

/**
 * Initialize global beforeunload, input tracking, and submit listeners
 */
export function initUnsavedChangesGuard() {
  if (isGuardInitialized || typeof window === 'undefined') return;
  isGuardInitialized = true;

  // 1. Browser Tab Close / Refresh Native Interception
  window.addEventListener('beforeunload', (e) => {
    if (hasAnyUnsavedData()) {
      e.preventDefault();
      // Setting returnValue to empty string triggers native browser confirm prompt in Chrome/Edge/Firefox
      e.returnValue = '';
      return '';
    }
  });

  // 2. Track user modifications on inputs in real time
  const handleUserActivity = (e) => {
    const el = e.target;
    if (isIgnoredInput(el)) return;
    el.dataset.userModified = 'true';
    const form = el.closest('form, #active-modal-overlay, #app-drawer-panel');
    if (form) form.dataset.isDirty = 'true';
  };

  document.addEventListener('input', handleUserActivity, true);
  document.addEventListener('change', handleUserActivity, true);

  // 3. Mark form as submitting when submit event occurs or submit buttons are clicked
  document.addEventListener('submit', (e) => {
    const form = e.target;
    if (form) {
      form.dataset.isSubmitting = 'true';
      const modal = form.closest('#active-modal-overlay');
      if (modal) modal.dataset.isSubmitting = 'true';
      const drawer = form.closest('#app-drawer-panel');
      if (drawer) drawer.dataset.isSubmitting = 'true';
    }
  }, true);

  document.addEventListener('click', (e) => {
    const submitBtn = e.target.closest('button[type="submit"], input[type="submit"], form button:not([type="button"]), .btn-submit, .btn-save, [id*="save"], [id*="submit"]');
    if (submitBtn && !submitBtn.id.toLowerCase().includes('cancel') && !submitBtn.className.includes('cancel') && !submitBtn.closest('#unsaved-changes-confirm-overlay')) {
      const modal = submitBtn.closest('#active-modal-overlay');
      if (modal) {
        modal.dataset.isSubmitting = 'true';
        // Auto-revert isSubmitting after 600ms in case validation failed and modal wasn't closed
        setTimeout(() => {
          if (modal && document.body.contains(modal)) {
            modal.dataset.isSubmitting = 'false';
          }
        }, 600);
      }
      const drawer = submitBtn.closest('#app-drawer-panel');
      if (drawer) {
        drawer.dataset.isSubmitting = 'true';
        setTimeout(() => {
          if (drawer && document.body.contains(drawer)) {
            drawer.dataset.isSubmitting = 'false';
          }
        }, 600);
      }
    }
  }, true);
}
