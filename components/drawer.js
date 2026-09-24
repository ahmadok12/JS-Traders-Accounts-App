/**
 * JS Traders ERP - Slide-Over Inspection Drawer Component
 * Provides a sleek side panel sliding from the right edge for deep contextual inspection
 * (e.g., viewing multi-warehouse stock balances, customer ledger breakdown, SKU history)
 * without losing scroll position or navigating away from master data tables.
 */

import { hasEnteredData, snapshotFormInitialState, confirmDiscardChanges } from './unsavedChangesGuard.js';

let activeDrawerElement = null;
let activeBackdropElement = null;
let activeCloseCallback = null;

/**
 * Open a contextual slide-over drawer
 * @param {Object} options
 * @param {string} options.title - Drawer header title
 * @param {string} [options.subtitle] - Optional category or status subtitle
 * @param {string} [options.badge] - Optional pill badge HTML or text
 * @param {string} options.content - HTML body content of the drawer
 * @param {string} [options.footer] - Optional HTML footer buttons/actions
 * @param {string} [options.width='max-w-md'] - Tailwind max-width class (e.g. max-w-md, max-w-lg, max-w-xl)
 * @param {Function} [options.onClose] - Callback when closed
 */
export function openDrawer({
  title = 'Details',
  subtitle = '',
  badge = '',
  content = '',
  footer = '',
  width = 'max-w-md sm:max-w-lg',
  onClose = null
}) {
  closeDrawer(true); // Close any currently open drawer immediately

  activeCloseCallback = onClose;

  // Create backdrop
  const backdrop = document.createElement('div');
  backdrop.id = 'app-drawer-backdrop';
  backdrop.className = 'fixed inset-0 bg-slate-900/40 backdrop-blur-xs z-50 transition-opacity duration-300 opacity-0';
  document.body.appendChild(backdrop);
  activeBackdropElement = backdrop;

  // Create drawer container
  const drawer = document.createElement('aside');
  drawer.id = 'app-drawer-panel';
  drawer.className = `fixed inset-y-0 right-0 w-full ${width} bg-white shadow-2xl z-50 flex flex-col transform translate-x-full transition-transform duration-300 ease-out border-l border-slate-200`;
  
  drawer.innerHTML = `
    <!-- Drawer Header -->
    <div class="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/70 shrink-0">
      <div>
        <div class="flex items-center gap-2">
          <h3 class="text-sm font-extrabold text-slate-900 tracking-tight">${title}</h3>
          ${badge ? `<span>${badge}</span>` : ''}
        </div>
        ${subtitle ? `<p class="text-xs text-slate-500 font-medium mt-0.5">${subtitle}</p>` : ''}
      </div>
      <button id="app-drawer-close-btn" class="w-8 h-8 rounded-lg flex items-center justify-center text-slate-400 hover:text-slate-700 hover:bg-slate-200/60 transition-colors cursor-pointer" title="Close (Esc)">
        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path d="M6 18L18 6M6 6l12 12" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"></path>
        </svg>
      </button>
    </div>

    <!-- Drawer Body -->
    <div class="flex-1 overflow-y-auto p-6 space-y-5 custom-scroll">
      ${content}
    </div>

    <!-- Drawer Footer (Optional) -->
    ${footer ? `
      <div class="px-6 py-3.5 border-t border-slate-100 bg-slate-50/80 flex items-center justify-end gap-2.5 shrink-0">
        ${footer}
      </div>
    ` : ''}
  `;

  document.body.appendChild(drawer);
  activeDrawerElement = drawer;

  // Animate in next tick
  requestAnimationFrame(() => {
    backdrop.classList.remove('opacity-0');
    backdrop.classList.add('opacity-100');
    drawer.classList.remove('translate-x-full');
    drawer.classList.add('translate-x-0');
  });

  // Event handlers with unsaved data guard
  const attemptClose = () => {
    if (activeDrawerElement && activeDrawerElement.dataset.isSubmitting !== 'true' && hasEnteredData(activeDrawerElement)) {
      confirmDiscardChanges({
        title: 'Discard Drawer Changes?',
        message: 'You have entered data in this panel. If you close now, your unsaved changes will be lost.',
        confirmLabel: 'Discard & Close',
        cancelLabel: 'Keep Editing',
        onDiscard: () => {
          closeDrawer(true);
        }
      });
    } else {
      closeDrawer(true);
    }
  };

  backdrop.addEventListener('click', attemptClose);
  const closeBtn = drawer.querySelector('#app-drawer-close-btn');
  if (closeBtn) {
    closeBtn.addEventListener('click', attemptClose);
  }

  // Keyboard escape listener
  document.addEventListener('keydown', handleKeydown);

  // Snapshot initial state
  requestAnimationFrame(() => {
    snapshotFormInitialState(drawer);
  });
}

function handleKeydown(e) {
  if (e.key === 'Escape' && activeDrawerElement) {
    if (document.getElementById('unsaved-changes-confirm-overlay')) return;
    if (activeDrawerElement.dataset.isSubmitting !== 'true' && hasEnteredData(activeDrawerElement)) {
      confirmDiscardChanges({
        title: 'Discard Drawer Changes?',
        message: 'You have entered data in this panel. If you close now, your unsaved changes will be lost.',
        confirmLabel: 'Discard & Close',
        cancelLabel: 'Keep Editing',
        onDiscard: () => {
          closeDrawer(true);
        }
      });
    } else {
      closeDrawer(true);
    }
  }
}

/**
 * Close active slide-over drawer with smooth transition
 */
export function closeDrawer(force = false) {
  if (!activeDrawerElement) return;

  if (!force && activeDrawerElement.dataset.isSubmitting !== 'true' && hasEnteredData(activeDrawerElement)) {
    confirmDiscardChanges({
      title: 'Discard Drawer Changes?',
      message: 'You have entered data in this panel. If you close now, your unsaved changes will be lost.',
      confirmLabel: 'Discard & Close',
      cancelLabel: 'Keep Editing',
      onDiscard: () => {
        closeDrawer(true);
      }
    });
    return;
  }

  document.removeEventListener('keydown', handleKeydown);

  const drawer = activeDrawerElement;
  const backdrop = activeBackdropElement;
  const callback = activeCloseCallback;

  // Animate out
  if (drawer) {
    drawer.classList.remove('translate-x-0');
    drawer.classList.add('translate-x-full');
  }
  if (backdrop) {
    backdrop.classList.remove('opacity-100');
    backdrop.classList.add('opacity-0');
  }

  setTimeout(() => {
    if (drawer && drawer.parentNode) drawer.parentNode.removeChild(drawer);
    if (backdrop && backdrop.parentNode) backdrop.parentNode.removeChild(backdrop);
    if (callback) callback();
  }, 280);

  activeDrawerElement = null;
  activeBackdropElement = null;
  activeCloseCallback = null;
}
