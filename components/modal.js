/**
 * JS Traders ERP - High-Fidelity Modal Dialog Component
 * Adheres strictly to the ERP design language in Design/code 1.html (2nd reference screenshot).
 */

export function openModal({
  title,
  subtitle = '',
  badge = '',
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
  overlay.className = 'fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-4 sm:p-6 lg:p-8 overflow-y-auto animate-in fade-in duration-200';

  overlay.innerHTML = `
    <div class="bg-white w-full ${finalSize} rounded-2xl shadow-2xl border border-slate-100 flex flex-col max-h-[92vh] overflow-hidden my-auto animate-in fade-in zoom-in-95 duration-200" data-purpose="modal-window">
      <!-- Modal Header matching Design/code 1.html -->
      <header class="px-7 py-5 border-b border-slate-100 flex items-center justify-between bg-white sticky top-0 z-20 shrink-0">
        <div class="flex items-center space-x-3.5">
          <div class="w-10 h-10 rounded-xl bg-blue-50 text-[#138FCB] flex items-center justify-center shadow-xs shrink-0">
            <svg class="w-5 h-5 text-[#138FCB]" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path>
            </svg>
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
            ${subtitle ? `<p class="text-xs text-slate-500 mt-0.5">${subtitle}</p>` : ''}
          </div>
        </div>
        <div class="flex items-center space-x-2.5">
          ${headerActionsHtml ? `<div>${headerActionsHtml}</div>` : ''}
          <button id="modal-close-btn" aria-label="Close dialog" class="w-8 h-8 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 flex items-center justify-center transition-colors cursor-pointer" type="button">
            <svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"></path>
            </svg>
          </button>
        </div>
      </header>

      <!-- Scrollable Modal Body -->
      <div id="modal-body-container" class="p-7 overflow-y-auto custom-scroll space-y-6 flex-1 bg-slate-50/40">
        ${finalHtml}
      </div>

      <!-- Optional Sticky Footer -->
      ${footerHtml ? `
        <footer id="modal-footer-container" class="px-7 py-4 border-t border-slate-200 bg-white flex flex-col sm:flex-row items-center justify-between gap-3 sticky bottom-0 z-20 shrink-0">
          ${footerHtml}
        </footer>
      ` : ''}
    </div>
  `;

  document.body.appendChild(overlay);

  // Close handlers
  const closeBtn = overlay.querySelector('#modal-close-btn');
  if (closeBtn) {
    closeBtn.onclick = () => closeModal(onClose);
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
