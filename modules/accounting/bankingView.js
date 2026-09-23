/**
 * JS Traders ERP - Banking & Reconciliation View
 * Bank accounts, statement imports, and automated reconciliation simulator.
 */

import { accountingService } from '../../services/accountingService.js';
import { openModal, closeModal } from '../../components/modal.js';
import { toast } from '../../components/toast.js';

export function renderBankingView() {
  const accounts = accountingService.getBankAccounts();

  return `
    <div class="space-y-6 animate-in fade-in duration-150">
      <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white p-4 rounded-2xl border border-[#EAECEF] shadow-[0_2px_4px_rgba(0,0,0,0.02)]">
        <div>
          <h2 class="text-base font-bold text-[#1A1D1F]">Banking & Cash Balances</h2>
          <p class="text-xs text-slate-400 mt-0.5">Commercial banking accounts and bank statement reconciliation</p>
        </div>
        <button id="import-statement-btn" class="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-bold bg-[#138FCB] text-white rounded-xl hover:bg-[#0E78AC] transition-colors shadow-xs cursor-pointer">
          <span>⚡</span>
          <span>Simulate Bank Statement Match</span>
        </button>
      </div>

      <!-- Bank Accounts Grid -->
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-5">
        ${accounts.map(ba => `
          <div class="bg-white rounded-2xl p-5 border border-slate-200 shadow-[0_2px_4px_rgba(0,0,0,0.02)] flex flex-col justify-between">
            <div>
              <div class="flex items-center justify-between mb-2">
                <span class="text-[10px] font-bold uppercase tracking-wider text-slate-400">${ba.currency} Commercial Account</span>
                <span class="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700">Connected</span>
              </div>
              <h3 class="text-base font-bold text-slate-900">${ba.name}</h3>
              <p class="text-xs text-slate-500 mt-0.5">Acc #: <strong class="font-mono text-slate-700">${ba.accountNumber}</strong></p>
              <p class="text-[11px] font-mono text-slate-400 mt-0.5">IBAN: ${ba.iban || 'N/A'}</p>

              <div class="mt-4 pt-3 border-t border-slate-100 flex justify-between items-baseline">
                <span class="text-xs font-medium text-slate-500">GL Book Balance:</span>
                <span class="text-xl font-extrabold text-[#138FCB]">${ba.currency === 'USD' ? '$' : 'Rs.'} ${Number(ba.balance).toLocaleString()}</span>
              </div>
            </div>

            <div class="mt-5 pt-3 border-t border-slate-100 flex justify-end gap-2">
              <button class="reconcile-acc-btn px-3 py-1.5 bg-slate-100 hover:bg-slate-200 rounded-lg text-xs font-semibold text-slate-700 transition-colors cursor-pointer" data-id="${ba.id}">
                Reconciliation Center
              </button>
            </div>
          </div>
        `).join('')}
      </div>
    </div>
  `;
}

export function bindBankingEvents(container, refreshCallback) {
  const importBtn = container.querySelector('#import-statement-btn');
  if (importBtn) {
    importBtn.onclick = () => openReconciliationModal();
  }

  container.querySelectorAll('.reconcile-acc-btn').forEach(btn => {
    btn.onclick = () => openReconciliationModal();
  });
}

function openReconciliationModal() {
  const dummyLines = [
    { date: '2025-09-15', description: 'Customer Direct Deposit - Ali Poultry Group', amount: 140000, type: 'Credit' },
    { date: '2025-09-17', description: 'Freight Transfer - Al-Hussain Logistics', amount: -68500, type: 'Debit' },
    { date: '2025-09-20', description: 'Bank Service Charges & FED', amount: -1250, type: 'Debit' }
  ];

  const contentHtml = `
    <div class="space-y-4 text-xs">
      <div class="p-3.5 bg-slate-50 rounded-xl border border-slate-200">
        <span class="text-[10px] font-bold uppercase tracking-wider text-slate-400">Target Account</span>
        <h4 class="text-sm font-bold text-slate-900 mt-0.5">Meezan Bank - Main Commercial (0102-0100984711)</h4>
        <p class="text-slate-500 text-[11px]">Simulating automated bank statement ingestion and ledger comparison</p>
      </div>

      <div class="border border-slate-200 rounded-xl overflow-hidden divide-y divide-slate-100">
        <div class="p-2.5 bg-slate-50 text-[10px] font-bold text-slate-400 uppercase tracking-wider flex justify-between">
          <span>Statement Feed Line</span>
          <span>Match Status</span>
        </div>
        ${dummyLines.map(l => `
          <div class="p-3 flex justify-between items-center text-xs">
            <div>
              <div class="font-bold text-slate-800">${l.description}</div>
              <div class="text-[10px] text-slate-400">${l.date} • ${l.type}</div>
            </div>
            <div class="text-right">
              <div class="font-bold ${l.amount > 0 ? 'text-emerald-600' : 'text-slate-900'}">Rs. ${Math.abs(l.amount).toLocaleString()}</div>
              <span class="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-50 text-emerald-700">✓ 98% Auto-Matched</span>
            </div>
          </div>
        `).join('')}
      </div>

      <div class="flex justify-end gap-3 pt-4 border-t border-slate-100">
        <button id="recon-close-btn" class="px-4 py-2 text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-xl font-semibold transition-colors cursor-pointer">Close</button>
        <button id="recon-post-btn" class="px-4 py-2 bg-[#138FCB] hover:bg-[#0E78AC] text-white rounded-xl font-semibold shadow-xs transition-colors cursor-pointer">Approve & Post Reconciliation</button>
      </div>
    </div>
  `;

  openModal({
    title: 'Bank Statement Auto-Reconciliation',
    subtitle: 'Matches external bank statement feeds with General Ledger entries',
    contentHtml,
    size: 'max-w-xl',
    onOpen: (modalEl) => {
      modalEl.querySelector('#recon-close-btn').onclick = () => closeModal();
      modalEl.querySelector('#recon-post-btn').onclick = () => {
        toast.show('All statement transactions approved and reconciled with bank ledger.', 'success');
        closeModal();
      };
    }
  });
}
