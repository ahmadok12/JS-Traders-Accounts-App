/**
 * JS Traders ERP - High-Fidelity Modal Dialog Component
 * Adheres strictly to the ERP design language in Design/code 1.html & user uploaded design.
 */

export function openModal({
  title,
  subtitle = '',
  badge = '',
  icon = null,
  iconHtml = null,
  contentHtml,
  content,
  footerHtml = null,
  headerActionsHtml = '',
  size = 'max-w-5xl',
  width,
  onOpen = null,
  onClose = null
}) {
  // Remove any existing active modal
  closeModal();

  const finalHtml = contentHtml || content || '';
  const finalSize = width || size || 'max-w-5xl';

  const overlay = document.createElement('div');
  overlay.id = 'active-modal-overlay';
  overlay.className = 'fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-3 sm:p-5 lg:p-7 overflow-y-auto animate-in fade-in duration-200';

  // Determine icon HTML
  let resolvedIcon = '';
  if (iconHtml) {
    resolvedIcon = iconHtml;
  } else if (icon && typeof icon === 'string' && icon.startsWith('<svg')) {
    resolvedIcon = icon;
  } else if (icon) {
    resolvedIcon = `<span class="text-xl">${icon}</span>`;
  } else {
    // Default document icon matching Design/code 1.html
    resolvedIcon = `
      <svg class="w-5 h-5 text-[#138FCB]" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path>
      </svg>
    `;
  }

  // Format footer: Ensure standard left security badge + right action buttons layout
  let finalFooter = '';
  const defaultSecurityBadge = `
    <div class="flex items-center space-x-2 text-xs text-slate-400 font-medium shrink-0">
      <svg class="w-4 h-4 text-emerald-500 shrink-0" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
        <path d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" stroke-linecap="round" stroke-linejoin="round"></path>
      </svg>
      <span>SSL 256-bit encrypted ERP transaction</span>
    </div>
  `;

  if (footerHtml) {
    if (footerHtml.includes('SSL 256-bit') || footerHtml.includes('flex items-center justify-between')) {
      finalFooter = footerHtml;
    } else {
      finalFooter = `
        <div class="flex flex-col sm:flex-row items-center justify-between gap-3 w-full">
          ${defaultSecurityBadge}
          <div class="flex items-center space-x-3 w-full sm:w-auto justify-end">
            ${footerHtml}
          </div>
        </div>
      `;
    }
  } else {
    finalFooter = `
      <div class="flex flex-col sm:flex-row items-center justify-between gap-3 w-full">
        ${defaultSecurityBadge}
        <div class="flex items-center space-x-3 w-full sm:w-auto justify-end">
          <button id="modal-default-close-btn" type="button" class="px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 rounded-xl transition-colors border border-slate-300 cursor-pointer shadow-2xs">
            Close
          </button>
        </div>
      </div>
    `;
  }

  overlay.innerHTML = `
    <div class="bg-white w-full ${finalSize} rounded-3xl shadow-2xl border border-slate-100/90 flex flex-col max-h-[92vh] overflow-hidden my-auto animate-in fade-in zoom-in-95 duration-200" data-purpose="modal-window">
      <!-- Modal Header matching Design/code 1.html -->
      <header class="px-7 py-5 border-b border-slate-100 flex items-center justify-between bg-white sticky top-0 z-20 shrink-0">
        <div class="flex items-center space-x-3.5">
          <div class="w-11 h-11 rounded-2xl bg-blue-50 text-[#138FCB] flex items-center justify-center shadow-xs shrink-0 border border-blue-100/60">
            ${resolvedIcon}
          </div>
          <div>
            <div class="flex items-center space-x-3">
              <h2 class="text-lg font-bold text-slate-900 tracking-tight">${title}</h2>
              ${badge ? `
                <span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-blue-50 text-[#138FCB] border border-blue-200">
                  ${badge}
                </span>
              ` : ''}
            </div>
            ${subtitle ? `<p class="text-xs text-slate-500 mt-0.5 font-normal">${subtitle}</p>` : ''}
          </div>
        </div>
        <div class="flex items-center space-x-2.5">
          ${headerActionsHtml ? `<div>${headerActionsHtml}</div>` : ''}
          <button id="modal-close-btn" aria-label="Close dialog" class="w-8 h-8 rounded-full text-slate-400 hover:text-slate-600 hover:bg-slate-100 flex items-center justify-center transition-colors cursor-pointer" type="button">
            <svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"></path>
            </svg>
          </button>
        </div>
      </header>

      <!-- Scrollable Modal Body Form -->
      <div id="modal-body-container" class="p-6 sm:p-7 overflow-y-auto custom-scroll space-y-6 flex-1 bg-slate-50/40">
        ${finalHtml}
      </div>

      <!-- Sticky Footer / Action Bar -->
      <footer id="modal-footer-container" class="px-7 py-4 border-t border-slate-200/80 bg-white flex flex-col sm:flex-row items-center justify-between gap-3 sticky bottom-0 z-20 shrink-0">
        ${finalFooter}
      </footer>
    </div>
  `;

  document.body.appendChild(overlay);

  // Close handlers
  const closeBtn = overlay.querySelector('#modal-close-btn');
  if (closeBtn) {
    closeBtn.onclick = () => closeModal(onClose);
  }

  const defaultCloseBtn = overlay.querySelector('#modal-default-close-btn');
  if (defaultCloseBtn) {
    defaultCloseBtn.onclick = () => closeModal(onClose);
  }

  overlay.onclick = (e) => {
    if (e.target === overlay) {
      closeModal(onClose);
    }
  };

  const keyHandler = (e) => {
    if (e.key === 'Escape') {
      closeModal(onClose);
      document.removeEventListener('keydown', keyHandler);
    }
  };
  document.addEventListener('keydown', keyHandler);

  if (onOpen) {
    onOpen(overlay);
  }

  return overlay;
}

export function closeModal(onClose = null) {
  const overlay = document.getElementById('active-modal-overlay');
  if (overlay) {
    overlay.remove();
    if (onClose) onClose();
  }
}

