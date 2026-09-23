/**
 * JS Traders ERP - Safety Confirmation Dialog Component
 * Enforces Global Record Action Standard:
 * "This record may affect inventory, accounting or related transactions. Are you sure you want to continue?"
 */

import { openModal, closeModal } from './modal.js';

export function confirmAction({
  title = 'Confirm Critical Action',
  message = 'This record may affect inventory, accounting or related transactions. Are you sure you want to continue?',
  confirmLabel = 'Yes, Proceed',
  cancelLabel = 'Cancel',
  isDestructive = true,
  onConfirm
}) {
  const contentHtml = `
    <div class="space-y-4 text-center py-3">
      <div class="w-12 h-12 rounded-full ${isDestructive ? 'bg-rose-50 text-rose-600' : 'bg-amber-50 text-amber-600'} mx-auto flex items-center justify-center text-xl font-bold">
        ${isDestructive ? '⚠' : 'ℹ'}
      </div>
      <div>
        <h3 class="text-sm font-bold text-slate-800">${title}</h3>
        <p class="text-xs text-slate-500 mt-2 max-w-md mx-auto leading-relaxed">${message}</p>
      </div>
      <div class="flex justify-center gap-3 pt-4 border-t border-slate-100">
        <button id="confirm-cancel-btn" class="px-4 py-2 text-xs font-semibold text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-xl transition-colors cursor-pointer">
          ${cancelLabel}
        </button>
        <button id="confirm-proceed-btn" class="px-4 py-2 text-xs font-semibold text-white ${isDestructive ? 'bg-rose-600 hover:bg-rose-700' : 'bg-[#138FCB] hover:bg-[#0E78AC]'} rounded-xl shadow-xs transition-colors cursor-pointer">
          ${confirmLabel}
        </button>
      </div>
    </div>
  `;

  const modal = openModal({
    title,
    contentHtml,
    size: 'max-w-md',
    onOpen: (overlay) => {
      overlay.querySelector('#confirm-cancel-btn').onclick = () => closeModal();
      overlay.querySelector('#confirm-proceed-btn').onclick = () => {
        closeModal();
        if (onConfirm) onConfirm();
      };
    }
  });

  return modal;
}
