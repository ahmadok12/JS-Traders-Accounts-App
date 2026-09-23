/**
 * JS Traders ERP - Salesperson Dedicated Portal View
 * Enables sales representatives to view assigned gatepasses, enter contracted customer rates,
 * utilize the Last Applied Customer Rate helper, and submit gatepasses for sales invoicing.
 */

import { gatepassService } from '../../services/gatepassService.js';
import { salesService } from '../../services/salesService.js';
import { productService } from '../../services/productService.js';
import { authService } from '../../services/authService.js';
import { renderTable, bindTableActions } from '../../components/table.js';
import { openModal, closeModal } from '../../components/modal.js';
import { toast } from '../../components/toast.js';

export function renderSalespersonPortalView() {
  const allGatepasses = gatepassService.getGatepasses();
  const parties = salesService.getParties(true);
  const partyMap = new Map(parties.map(p => [p.id, p.name]));
  const variants = productService.getVariants();
  const varMap = new Map(variants.map(v => [v.id, v.name]));

  // Filter gatepasses requiring salesperson pricing
  const pendingRateGPs = allGatepasses.filter(g => g.status === 'Rates Pending');
  const readyForInvoiceGPs = allGatepasses.filter(g => g.status === 'Ready for Invoice');

  const columns = [
    {
      key: 'gatepassNumber',
      label: 'Gatepass #',
      render: row => `<span class="font-bold text-[#138FCB]">${row.gatepassNumber}</span>`
    },
    {
      key: 'customerPartyId',
      label: 'Customer / Farm',
      render: row => `
        <div>
          <div class="font-bold text-slate-800">${partyMap.get(row.customerPartyId) || 'Customer'}</div>
          <div class="text-[10px] text-slate-400">Truck: ${row.vehicleNumber || 'N/A'}</div>
        </div>
      `
    },
    {
      key: 'items',
      label: 'Loaded Items',
      render: row => `
        <div class="space-y-0.5">
          ${(row.lines || []).map(l => `
            <div class="text-xs text-slate-700">
              ● ${varMap.get(l.variantId) || 'Item'}: <strong>${l.quantity} ${l.unit || 'PCS'}</strong>
            </div>
          `).join('')}
        </div>
      `
    },
    {
      key: 'status',
      label: 'Action Status',
      render: row => `
        <span class="px-2.5 py-0.5 rounded-full text-[10px] font-bold ${
          row.status === 'Rates Pending' ? 'bg-amber-50 text-amber-700' : 'bg-purple-50 text-purple-700'
        }">
          ${row.status === 'Rates Pending' ? '● Needs Rate Entry' : '● Ready for Invoicing'}
        </span>
      `
    }
  ];

  const actions = [
    {
      label: 'Enter Rates',
      variant: 'primary',
      onClick: (row) => openRateEntryModal(row)
    }
  ];

  const tableHtml = renderTable({
    columns,
    data: pendingRateGPs,
    actions,
    emptyMessage: 'No gatepasses currently waiting for pricing. Great job!'
  });

  return `
    <div id="sp-portal-container" class="space-y-6 animate-in fade-in duration-150">
      <!-- Top Metrics Row -->
      <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div class="bg-white p-4 rounded-2xl border border-slate-200 shadow-2xs">
          <span class="text-[10px] font-bold uppercase tracking-wider text-slate-400">Rates Pending</span>
          <p class="text-2xl font-extrabold text-amber-600 mt-1">${pendingRateGPs.length} <span class="text-xs font-semibold text-slate-500">Gatepasses</span></p>
        </div>
        <div class="bg-white p-4 rounded-2xl border border-slate-200 shadow-2xs">
          <span class="text-[10px] font-bold uppercase tracking-wider text-slate-400">Ready for Accounts Invoicing</span>
          <p class="text-2xl font-extrabold text-[#138FCB] mt-1">${readyForInvoiceGPs.length} <span class="text-xs font-semibold text-slate-500">Gatepasses</span></p>
        </div>
        <div class="bg-white p-4 rounded-2xl border border-slate-200 shadow-2xs">
          <span class="text-[10px] font-bold uppercase tracking-wider text-slate-400">Active Sales Operator</span>
          <p class="text-lg font-bold text-slate-800 mt-1">${authService.getCurrentUser().fullName}</p>
        </div>
      </div>

      <!-- Action Panel Header -->
      <div class="bg-white p-4 rounded-2xl border border-slate-200 shadow-[0_2px_4px_rgba(0,0,0,0.02)]">
        <h3 class="text-sm font-bold text-slate-800">Assigned Gatepasses Awaiting Rate Entry</h3>
        <p class="text-xs text-slate-400 mt-0.5">Warehouse dispatch has verified cargo. Enter negotiated customer rate or apply customer last-used rate to authorize invoice creation.</p>
      </div>

      <div id="sp-table-container">
        ${tableHtml}
      </div>
    </div>
  `;
}

export function bindSalespersonPortalEvents(container, refreshCallback) {
  const pendingRateGPs = gatepassService.getGatepasses().filter(g => g.status === 'Rates Pending');
  const actions = [
    { label: 'Enter Rates', onClick: (row) => openRateEntryModal(row, refreshCallback) }
  ];
  bindTableActions(container, actions, pendingRateGPs);
}

function openRateEntryModal(gatepass, onSaved) {
  const variants = productService.getVariants();
  const varMap = new Map(variants.map(v => [v.id, v.name]));
  const customer = salesService.getPartyById(gatepass.customerPartyId) || {};

  const contentHtml = `
    <form id="rate-entry-form" class="space-y-4 text-xs">
      <div class="p-3.5 bg-slate-50 rounded-xl border border-slate-200">
        <div class="flex justify-between">
          <div>
            <span class="text-[10px] font-bold uppercase tracking-wider text-slate-400">Gatepass #</span>
            <h3 class="text-base font-bold text-slate-900">${gatepass.gatepassNumber}</h3>
            <p class="text-slate-600 mt-0.5">Customer: <strong>${customer.name || 'Ali Poultry Group'}</strong></p>
          </div>
          <div class="text-right">
            <span class="text-[10px] font-bold uppercase tracking-wider text-slate-400">Vehicle</span>
            <p class="font-bold text-slate-800">${gatepass.vehicleNumber || 'Hino Truck'}</p>
          </div>
        </div>
      </div>

      <!-- Line items with rate fields -->
      <div class="space-y-3">
        ${(gatepass.lines || []).map((line, idx) => {
          const lastRate = salesService.getLastCustomerRate(gatepass.customerPartyId, line.variantId);
          return `
            <div class="p-3 bg-white rounded-xl border border-slate-200 space-y-2 rate-line-box" data-index="${idx}">
              <div class="flex justify-between items-center">
                <div>
                  <span class="font-bold text-slate-800">${varMap.get(line.variantId) || 'Item'}</span>
                  ${line.isRoll ? `<span class="block text-[10px] font-bold text-[#138FCB]">📦 Roll Packaging: ${line.packagingName}</span>` : (line.unit === 'ft' ? `<span class="block text-[10px] font-bold text-amber-700">✂️ Loose Continuous Cut</span>` : '')}
                </div>
                <span class="text-slate-500 font-semibold text-right">Qty: <strong class="text-slate-900">${line.quantity} ${line.packagingName || line.unit || 'PCS'}</strong>${line.isRoll ? `<span class="block text-[10px] text-slate-400">(${(Number(line.quantity) * Number(line.rollSize)).toLocaleString()} ft)</span>` : ''}</span>
              </div>

              <div class="grid grid-cols-12 gap-3 items-center pt-1">
                <div class="col-span-8">
                  <label class="block text-[10px] font-bold text-slate-600 mb-0.5">Negotiated Rate (PKR) *</label>
                  <input type="number" required min="1" value="${line.negotiatedRate || (lastRate ? lastRate.rate : 1400)}" class="rate-input w-full border border-slate-200 rounded-lg px-3 py-1.5 font-extrabold text-sm text-[#138FCB] focus:outline-none focus:border-[#138FCB]">
                </div>

                <div class="col-span-4 flex flex-col justify-end">
                  ${lastRate ? `
                    <button type="button" class="apply-last-btn px-2 py-1.5 bg-blue-50 hover:bg-blue-100 text-[#138FCB] rounded-lg font-bold text-[10px] transition-colors cursor-pointer" data-rate="${lastRate.rate}">
                      Use Last (Rs. ${lastRate.rate.toLocaleString()})
                    </button>
                  ` : ''}
                </div>
              </div>
            </div>
          `;
        }).join('')}
      </div>

      <div class="p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-[11px] text-emerald-900">
        ✔ <strong>Workflow Transition:</strong> Submitting rates transitions this Gatepass to <strong>Ready for Invoice</strong> so Accounts can finalize the commercial invoice.
      </div>

      <div class="flex justify-end gap-3 pt-4 border-t border-slate-100">
        <button type="button" id="rate-cancel-btn" class="px-4 py-2 text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-xl font-semibold transition-colors cursor-pointer">Cancel</button>
        <button type="submit" class="px-4 py-2 bg-[#138FCB] hover:bg-[#0E78AC] text-white rounded-xl font-semibold shadow-xs transition-colors cursor-pointer">Submit Rates for Invoicing</button>
      </div>
    </form>
  `;

  openModal({
    title: `Sales Rate Entry: ${gatepass.gatepassNumber}`,
    subtitle: 'Price gatepass items to prepare customer invoice',
    contentHtml,
    size: 'max-w-lg',
    onOpen: (modalEl) => {
      modalEl.querySelector('#rate-cancel-btn').onclick = () => closeModal();

      // Bind apply last rate buttons
      modalEl.querySelectorAll('.apply-last-btn').forEach(btn => {
        btn.onclick = () => {
          const rate = btn.getAttribute('data-rate');
          const box = btn.closest('.rate-line-box');
          box.querySelector('.rate-input').value = rate;
          toast.show(`Applied last customer rate: Rs. ${Number(rate).toLocaleString()}`, 'info');
        };
      });

      modalEl.querySelector('#rate-entry-form').onsubmit = (e) => {
        e.preventDefault();
        const lineRates = [];
        modalEl.querySelectorAll('.rate-input').forEach(input => {
          lineRates.push(Number(input.value) || 0);
        });

        gatepassService.updateRates(gatepass.id, lineRates, authService.getCurrentUser().id);
        toast.show('Rates updated successfully. Gatepass is now Ready for Invoice!', 'success');
        closeModal();
        if (onSaved) onSaved();
      };
    }
  });
}
