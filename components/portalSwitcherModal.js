/**
 * JS Traders ERP - Unified Portal Switcher Modal
 * Provides a universal switcher between all 5 ecosystem portals:
 * 1. Main ERP (Accountant / Owner)
 * 2. Warehouse Portal (Warehouse Manager - Costs redacted)
 * 3. Staff Mobile App (Warehouse & Office staff)
 * 4. Sales Person App (Sales Rep - Customer Ledgers & Stock)
 * 5. Management Reporting App (Executive insights & shipments)
 */

import { openModal, closeModal } from './modal.js';

export function openPortalSwitcherModal(currentPortalId = 'main-erp') {
  const portals = [
    {
      id: 'main-erp',
      title: '1. Main ERP Platform',
      role: 'Accountant / Owner / Admin',
      url: 'index.html',
      badge: 'Full Suite',
      badgeClass: 'bg-blue-100 text-blue-800',
      icon: '🏢',
      description: 'Complete accounts, sales orders, purchase bills, banking reconciliation, user controls & profit margins.'
    },
    {
      id: 'warehouse-portal',
      title: '2. Warehouse Portal',
      role: 'Warehouse Manager / Supervisor',
      url: 'warehouse.html',
      badge: 'Costs Redacted',
      badgeClass: 'bg-emerald-100 text-emerald-800',
      icon: '🏬',
      description: 'Inventory levels, locations, gatepass issuance, assemblies, disassemblies & stock adjustments without pricing.'
    },
    {
      id: 'staff-app',
      title: '3. Staff Mobile App',
      role: 'Warehouse & Office Staff',
      url: 'Staff.html',
      badge: 'PWA Mobile',
      badgeClass: 'bg-purple-100 text-purple-800',
      icon: '📱',
      description: 'Floor staff terminal for order picking, barcode/QR scanning, gatepass checks, and real-time audio alerts.'
    },
    {
      id: 'sales-app',
      title: '4. Sales Person App',
      role: 'Field Sales Representative',
      url: 'sales.html',
      badge: 'Field Sales',
      badgeClass: 'bg-amber-100 text-amber-800',
      icon: '💼',
      description: 'Assigned customer ledgers & balances, multi-warehouse stock quantity lookup, and quick field order booking.'
    },
    {
      id: 'management-report',
      title: '5. Management Reports',
      role: 'Executive / Company Owner',
      url: 'management-report.html',
      badge: 'Executive KPIs',
      badgeClass: 'bg-rose-100 text-rose-800',
      icon: '📈',
      description: 'All customer ledgers & aging, complete inventory valuations, import container tracking & business analytics.'
    }
  ];

  const contentHtml = `
    <div class="space-y-4">
      <div class="bg-gradient-to-r from-slate-900 to-slate-800 p-4 rounded-2xl text-white">
        <div class="flex items-center justify-between">
          <div>
            <span class="text-[10px] font-extrabold uppercase tracking-widest text-[#138FCB]">JS Traders Ecosystem</span>
            <h3 class="text-sm font-extrabold">Switch Between The 5 Dedicated Portals</h3>
          </div>
          <span class="px-2.5 py-1 rounded-full text-[10px] font-black bg-white/20">5 Portals Live</span>
        </div>
        <p class="text-xs text-slate-300 mt-1">Each portal is tailored for a specific role with strict security and dedicated screen workflows.</p>
      </div>

      <div class="grid grid-cols-1 gap-2.5">
        ${portals.map(p => {
          const isCurrent = p.id === currentPortalId;
          return `
            <a href="${p.url}" class="group block p-3.5 rounded-xl border ${
              isCurrent ? 'border-[#138FCB] bg-blue-50/60 ring-2 ring-[#138FCB]/20' : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50'
            } transition-all">
              <div class="flex items-start justify-between gap-3">
                <div class="flex items-start gap-3">
                  <div class="w-10 h-10 rounded-xl ${isCurrent ? 'bg-[#138FCB] text-white' : 'bg-slate-100 text-slate-700 group-hover:bg-[#138FCB] group-hover:text-white'} flex items-center justify-center text-lg font-bold transition-colors shrink-0 shadow-xs">
                    ${p.icon}
                  </div>
                  <div>
                    <div class="flex items-center gap-2">
                      <h4 class="text-xs font-extrabold text-slate-900">${p.title}</h4>
                      <span class="px-2 py-0.5 rounded-full text-[9px] font-bold ${p.badgeClass}">${p.badge}</span>
                      ${isCurrent ? '<span class="text-[10px] font-black text-[#138FCB]">● Current</span>' : ''}
                    </div>
                    <p class="text-[11px] text-slate-500 font-medium mt-0.5">${p.description}</p>
                    <div class="text-[10px] font-bold text-slate-400 mt-1">Role: <span class="text-slate-700">${p.role}</span></div>
                  </div>
                </div>
                <div class="text-slate-400 group-hover:text-[#138FCB] transition-colors font-bold text-sm shrink-0 mt-2">
                  →
                </div>
              </div>
            </a>
          `;
        }).join('')}
      </div>
    </div>
  `;

  openModal({
    title: '🌐 JS Traders Portal Switcher',
    content: contentHtml,
    width: 'max-w-xl'
  });
}
