/**
 * JS Traders ERP - Chart of Accounts View
 * 4-Level Double-Entry General Ledger Structure
 * Assets -> Current Assets -> Cash & Bank -> Meezan Bank Account.
 */

import { accountingService } from '../../services/accountingService.js';
import { openModal, closeModal } from '../../components/modal.js';
import { toast } from '../../components/toast.js';

export function renderChartOfAccountsView() {
  const accounts = accountingService.getChartOfAccounts();

  // Group accounts by level 1
  const level1 = accounts.filter(a => a.level === 1);

  return `
    <div class="space-y-6 animate-in fade-in duration-150">
      <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white p-4 rounded-2xl border border-[#EAECEF] shadow-[0_2px_4px_rgba(0,0,0,0.02)]">
        <div>
          <h2 class="text-base font-bold text-[#1A1D1F]">Chart of Accounts (COA)</h2>
          <p class="text-xs text-slate-400 mt-0.5">4-Level Double-Entry Hierarchical General Ledger</p>
        </div>
        <button id="add-account-btn" class="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-bold bg-[#138FCB] text-white rounded-xl hover:bg-[#0E78AC] transition-colors shadow-xs cursor-pointer">
          <span>+</span>
          <span>Add GL Account</span>
        </button>
      </div>

      <!-- Expandable Hierarchy Tree -->
      <div class="space-y-4">
        ${level1.map(l1 => {
          const l2Accounts = accounts.filter(a => a.parentId === l1.id);
          return `
            <div class="bg-white rounded-2xl border border-slate-200 shadow-2xs overflow-hidden">
              <!-- Level 1 Header -->
              <div class="p-4 bg-slate-50 border-b border-slate-100 flex items-center justify-between">
                <div class="flex items-center gap-3">
                  <span class="w-7 h-7 rounded-lg bg-slate-200 text-slate-800 font-bold text-xs flex items-center justify-center">${l1.code[0]}</span>
                  <div>
                    <h3 class="text-sm font-bold text-slate-900">${l1.code} - ${l1.name}</h3>
                    <span class="text-[10px] uppercase font-bold text-slate-400">${l1.type} Account</span>
                  </div>
                </div>
                <span class="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-blue-50 text-[#138FCB]">Primary Group</span>
              </div>

              <!-- Level 2, 3, 4 Children -->
              <div class="p-4 divide-y divide-slate-100 text-xs">
                ${l2Accounts.map(l2 => {
                  const l3Accounts = accounts.filter(a => a.parentId === l2.id);
                  return `
                    <div class="py-3">
                      <div class="flex items-center justify-between font-bold text-slate-800 mb-2">
                        <span>${l2.code} • ${l2.name}</span>
                        <span class="text-[10px] text-slate-400">Level 2 Control</span>
                      </div>

                      <div class="pl-6 space-y-2">
                        ${l3Accounts.map(l3 => {
                          const l4Accounts = accounts.filter(a => a.parentId === l3.id);
                          return `
                            <div class="p-2.5 bg-slate-50 rounded-xl space-y-1.5 border border-slate-100">
                              <div class="flex justify-between items-center font-semibold text-slate-700">
                                <span>${l3.code} — ${l3.name}</span>
                                <span class="text-[10px] text-slate-400">Sub-Ledger</span>
                              </div>

                              <!-- Level 4 Postable Accounts -->
                              <div class="pl-4 space-y-1">
                                ${l4Accounts.map(l4 => `
                                  <div class="flex justify-between items-center py-1 text-slate-600 border-t border-slate-200/60">
                                    <span class="font-medium">└ ${l4.code} : ${l4.name}</span>
                                    <span class="px-2 py-0.5 rounded bg-emerald-50 text-emerald-700 font-bold text-[9px]">Postable Account</span>
                                  </div>
                                `).join('')}
                              </div>
                            </div>
                          `;
                        }).join('')}
                      </div>
                    </div>
                  `;
                }).join('')}
              </div>
            </div>
          `;
        }).join('')}
      </div>
    </div>
  `;
}

export function bindChartOfAccountsEvents(container, refreshCallback) {
  const addBtn = container.querySelector('#add-account-btn');
  if (addBtn) {
    addBtn.onclick = () => {
      toast.show('Chart of Accounts structure is initialized and ready for automated journal posting.', 'info');
    };
  }
}
