/**
 * JS Traders ERP - Toast Notification Component
 */

class ToastManager {
  constructor() {
    this.container = null;
    this.ensureContainer();
  }

  ensureContainer() {
    if (typeof document === 'undefined') return;
    let el = document.getElementById('toast-container');
    if (!el) {
      el = document.createElement('div');
      el.id = 'toast-container';
      el.className = 'fixed bottom-5 right-5 z-[9999] flex flex-col gap-2 pointer-events-none';
      if (document.body) document.body.appendChild(el);
    }
    this.container = el;
  }

  show(message, type = 'info', duration = 3500) {
    if (typeof document === 'undefined') {
      console.log(`[Toast ${type}] ${message}`);
      return;
    }
    this.ensureContainer();

    const toast = document.createElement('div');
    toast.className = `pointer-events-auto flex items-center gap-3 px-4 py-3 rounded-xl shadow-lg border text-xs font-medium transition-all duration-300 transform translate-y-2 opacity-0 ${
      type === 'success' ? 'bg-emerald-50 text-emerald-800 border-emerald-200' :
      type === 'error' ? 'bg-rose-50 text-rose-800 border-rose-200' :
      type === 'warning' ? 'bg-amber-50 text-amber-800 border-amber-200' :
      'bg-slate-900 text-white border-slate-800'
    }`;

    const iconSvg = type === 'success' ? '✓' : type === 'error' ? '✕' : type === 'warning' ? '⚠' : 'ℹ';

    toast.innerHTML = `
      <span class="w-5 h-5 rounded-full flex items-center justify-center font-bold text-xs ${
        type === 'success' ? 'bg-emerald-200 text-emerald-900' :
        type === 'error' ? 'bg-rose-200 text-rose-900' :
        type === 'warning' ? 'bg-amber-200 text-amber-900' :
        'bg-slate-700 text-white'
      }">${iconSvg}</span>
      <span class="flex-1">${message}</span>
      <button class="text-xs opacity-60 hover:opacity-100 ml-2 font-bold cursor-pointer">×</button>
    `;

    toast.querySelector('button').onclick = () => this.dismiss(toast);
    this.container.appendChild(toast);

    requestAnimationFrame(() => {
      toast.classList.remove('translate-y-2', 'opacity-0');
    });

    setTimeout(() => this.dismiss(toast), duration);
  }

  dismiss(toast) {
    toast.classList.add('opacity-0', 'translate-y-2');
    setTimeout(() => toast.remove(), 250);
  }
}

export const toast = new ToastManager();
