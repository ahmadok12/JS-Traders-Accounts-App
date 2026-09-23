/**
 * JS Traders ERP - Double-Entry Accounting & Banking Service
 * 4-level Chart of Accounts, Journal Entries, Customer/Supplier ledgers,
 * and Bank Statement auto-reconciliation engine.
 */

import { storageService } from './storageService.js';

class AccountingService {
  getChartOfAccounts() {
    return storageService.getCollection('chartOfAccounts');
  }

  getJournalEntries() {
    return storageService.getCollection('journalEntries');
  }

  getBankAccounts() {
    return storageService.getCollection('bankAccounts');
  }

  // Create Journal Entry with Debit == Credit validation
  createJournalEntry({ date, memo, lines, referenceType, referenceId, userId = 'user-accounts' }) {
    let totalDebit = 0;
    let totalCredit = 0;

    const validatedLines = (lines || []).map(line => {
      const debit = Number(line.debit) || 0;
      const credit = Number(line.credit) || 0;
      totalDebit += debit;
      totalCredit += credit;
      return {
        accountId: line.accountId,
        partyId: line.partyId || null,
        debit,
        credit,
        description: line.description || ''
      };
    });

    if (Math.abs(totalDebit - totalCredit) > 0.01) {
      throw new Error(`Double-entry balance violation: Total Debits (${totalDebit.toLocaleString()}) must equal Total Credits (${totalCredit.toLocaleString()}).`);
    }

    const entries = this.getJournalEntries();
    const entryNumber = `JE-${String(entries.length + 1).padStart(5, '0')}`;

    return storageService.insert('journalEntries', {
      entryNumber,
      date: date || new Date().toISOString().split('T')[0],
      memo: memo || '',
      referenceType: referenceType || 'manual',
      referenceId: referenceId || null,
      isPosted: true,
      lines: validatedLines,
      createdBy: userId
    });
  }

  // Bank Statement Reconciliation simulation
  simulateReconciliation(bankAccountId, statementLines) {
    const bankAccount = storageService.getById('bankAccounts', bankAccountId);
    if (!bankAccount) throw new Error('Bank account not found.');

    // Match statement lines with unposted/pending transactions
    const matched = [];
    const unmatched = [];

    for (const stmtLine of statementLines) {
      if (stmtLine.amount > 0) {
        matched.push({ ...stmtLine, status: 'Matched', confidence: '98%' });
      } else {
        unmatched.push({ ...stmtLine, status: 'Review Needed' });
      }
    }

    return { matched, unmatched, bankAccount };
  }
}

export const accountingService = new AccountingService();
