/**
 * JS Traders ERP - Journal Entries View
 * Double-Entry Vouchers with Debit == Credit validation.
 */

import { accountingService } from '../../services/accountingService.js';
import { renderTable } from '../../components/table.js';
import { renderFilterBar } from '../../components/filters.js';
import { openModal, closeModal } from '../../components/modal.js';
import { toast } from '../../components/toast.js';

export function renderJournalEntriesView() {
  const entries = accountingService.getJournalEntries();
  const accounts = accountingService.getChartOfAccounts();
  const accMap = new Map(accounts.map(a => [a.id, a.name]));

  const filterBarHtml = renderFilterBar({
    searchPlaceholder: 'Search journal vouchers by entry # or memo...',
    primaryAction: { label: 'New Journal Voucher' }
  });

  const columns = [
    {
      key: 'entryNumber',
      label: 'Voucher #',
      render: row => `<span class="font-bold text-[#138FCB]">${row.entryNumber}</span>`
    },
    {
      key: 'date',
      label: 'Posting Date',
      render: row => `<span class="text-slate-600 font-medium">${row.date}</span>`
    },
    {
      key: 'memo',
      label: 'Narration / Memo',
      render: row => `<span class="font-semibold text-slate-800">${row.memo || 'General Journal Entry'}</span>`
    },
    {
      key: 'lines',
      label: 'Account Debit / Credit Breakdown',
      render: row => `
        <div class="space-y-1 text-xs">
          ${(row.lines || []).map(l => `
            <div class="flex justify-between items-center text-slate-600 gap-4">
              <span>● ${accMap.get(l.accountId) || 'GL Account'}</span>
              <div class="font-mono">
                ${l.debit > 0 ? `<span class="font-bold text-slate-900">Dr: Rs. ${Number(l.debit).toLocaleString()}</span>` : ''}
                ${l.credit > 0 ? `<span class="font-bold text-blue-700">Cr: Rs. ${Number(l.credit).toLocaleString()}</span>` : ''}
              </div>
            </div>
          `).join('')}
        </div>
      `
    },
    {
      key: 'isPosted',
      label: 'Status',
      render: row => `
        <span class="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700">
          Posted
        </span>
      `
    }
  ];

  const tableHtml = renderTable({
    columns,
    data: entries,
    emptyMessage: 'No journal entries posted.'
  });

  return `
    <div id="je-view-container" class="space-y-5 animate-in fade-in duration-150">
      ${filterBarHtml}
      <div id="je-table-container">
        ${tableHtml}
      </div>
    </div>
  `;
}

export function bindJournalEntriesEvents(container, refreshCallback) {
  const addBtn = container.querySelector('#filter-primary-btn');
  if (addBtn) {
    addBtn.onclick = () => openCreateJournalModal(refreshCallback);
  }
}

function openCreateJournalModal(onSaved) {
  const accounts = accountingService.getChartOfAccounts();

  const contentHtml = `
    <form id="create-je-form" class="space-y-4 text-xs">
      <div>
        <label class="block font-bold text-slate-700 mb-1">Journal Narration / Memo *</label>
        <input type="text" id="je-memo" required placeholder="e.g. Bank charges or manual adjustment" class="w-full border border-slate-200 rounded-xl px-3 py-2 text-slate-800 focus:outline-none focus:border-[#138FCB]">
      </div>

      <div class="p-3.5 bg-slate-50 rounded-xl border border-slate-200 space-y-3">
        <span class="text-[11px] font-bold text-slate-700 uppercase tracking-wider block">Debit & Credit Lines</span>

        <!-- Line 1: Debit -->
        <div class="grid grid-cols-12 gap-3 items-center">
          <div class="col-span-8">
            <label class="block text-[10px] font-bold text-slate-600 mb-0.5">Debit Account *</label>
            <select id="je-debit-acc" class="w-full border border-slate-200 rounded-lg px-2.5 py-1.5 text-slate-800 bg-white">
              ${accounts.map(a => `<option value="${a.id}">${a.code} - ${a.name}</option>`).join('')}
            </select>
          </div>
          <div class="col-span-4">
            <label class="block text-[10px] font-bold text-slate-600 mb-0.5">Debit Amount (PKR) *</label>
            <input type="number" id="je-debit-amt" min="1" value="25000" class="w-full border border-slate-200 rounded-lg px-2.5 py-1.5 font-bold text-slate-800 bg-white">
          </div>
        </div>

        <!-- Line 2: Credit -->
        <div class="grid grid-cols-12 gap-3 items-center">
          <div class="col-span-8">
            <label class="block text-[10px] font-bold text-slate-600 mb-0.5">Credit Account *</label>
            <select id="je-credit-acc" class="w-full border border-slate-200 rounded-lg px-2.5 py-1.5 text-slate-800 bg-white">
              ${accounts.map((a, idx) => `<option value="${a.id}" ${idx === 3 ? 'selected' : ''}>${a.code} - ${a.name}</option>`).join('')}
            </select>
          </div>
          <div class="col-span-4">
            <label class="block text-[10px] font-bold text-slate-600 mb-0.5">Credit Amount (PKR) *</label>
            <input type="number" id="je-credit-amt" min="1" value="25000" class="w-full border border-slate-200 rounded-lg px-2.5 py-1.5 font-bold text-blue-700 bg-white">
          </div>
        </div>
      </div>

      <div class="flex justify-end gap-3 pt-4 border-t border-slate-100">
        <button type="button" id="je-cancel-btn" class="px-4 py-2 text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-xl font-semibold transition-colors cursor-pointer">Cancel</button>
        <button type="submit" class="px-4 py-2 bg-[#138FCB] hover:bg-[#0E78AC] text-white rounded-xl font-semibold shadow-xs transition-colors cursor-pointer">Post Journal Voucher</button>
      </div>
    </form>
  `;

  openModal({
    title: 'Post Double-Entry Journal Voucher',
    subtitle: 'Enforces Debits = Credits mathematical parity',
    contentHtml,
    size: 'max-w-xl',
    onOpen: (modalEl) => {
      modalEl.querySelector('#je-cancel-btn').onclick = () => closeModal();
      modalEl.querySelector('#create-je-form').onsubmit = (e) => {
        e.preventDefault();
        const memo = modalEl.querySelector('#je-memo').value.trim();
        const debitAccountId = modalEl.querySelector('#je-debit-acc').value;
        const debitAmount = Number(modalEl.querySelector('#je-debit-amt').value) || 0;
        const creditAccountId = modalEl.querySelector('#je-credit-acc').value;
        const creditAmount = Number(modalEl.querySelector('#je-credit-amt').value) || 0;

        try {
          accountingService.createJournalEntry({
            memo,
            lines: [
              { accountId: debitAccountId, debit: debitAmount, credit: 0 },
              { accountId: creditAccountId, debit: 0, credit: creditAmount }
            ]
          });

          toast.show('Journal voucher balanced and posted to General Ledger.', 'success');
          closeModal();
          if (onSaved) onSaved();
        } catch (err) {
          toast.show(err.message, 'error');
        }
      };
    }
  });
}
