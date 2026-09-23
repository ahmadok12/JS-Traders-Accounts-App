/**
 * JS Traders ERP - Enterprise Settings View
 * Configuration center for company parameters, inventory rules, roles, and prototype database reset.
 */

import { APP_CONFIG } from '../../config/appConfig.js';
import { storageService } from '../../services/storageService.js';
import { authService } from '../../services/authService.js';
import { confirmAction } from '../../components/confirmation.js';
import { toast } from '../../components/toast.js';

export function renderSettingsView(activeTab = 'company') {
  const users = storageService.getCollection('users');
  const tags = storageService.getCollection('tags');
  const customFields = storageService.getCollection('customFields');

  return `
    <div id="settings-view-container" class="space-y-6 animate-in fade-in duration-150">
      <!-- Tabs -->
      <div class="bg-white p-3 rounded-2xl border border-slate-200 shadow-2xs flex items-center gap-2 overflow-x-auto">
        <button class="settings-tab-btn px-4 py-2 rounded-xl text-xs font-bold transition-colors cursor-pointer ${
          activeTab === 'company' ? 'bg-[#138FCB] text-white shadow-xs' : 'text-slate-600 hover:bg-slate-100'
        }" data-tab="company">
          Company Profile
        </button>
        <button class="settings-tab-btn px-4 py-2 rounded-xl text-xs font-bold transition-colors cursor-pointer ${
          activeTab === 'users' ? 'bg-[#138FCB] text-white shadow-xs' : 'text-slate-600 hover:bg-slate-100'
        }" data-tab="users">
          Users & Role Permissions
        </button>
        <button class="settings-tab-btn px-4 py-2 rounded-xl text-xs font-bold transition-colors cursor-pointer ${
          activeTab === 'inventory' ? 'bg-[#138FCB] text-white shadow-xs' : 'text-slate-600 hover:bg-slate-100'
        }" data-tab="inventory">
          Inventory & Document Rules
        </button>
        <button class="settings-tab-btn px-4 py-2 rounded-xl text-xs font-bold transition-colors cursor-pointer ${
          activeTab === 'custom' ? 'bg-[#138FCB] text-white shadow-xs' : 'text-slate-600 hover:bg-slate-100'
        }" data-tab="custom">
          Custom Fields & Tags
        </button>
      </div>

      <!-- Tab Content -->
      <div class="bg-white p-6 rounded-2xl border border-slate-200 shadow-[0_2px_4px_rgba(0,0,0,0.02)] space-y-5 text-xs">
        ${activeTab === 'company' ? `
          <div class="max-w-2xl space-y-4">
            <h3 class="text-sm font-bold text-slate-800">Company Business Identity</h3>
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label class="block font-bold text-slate-700 mb-1">Company Trading Name</label>
                <input type="text" value="${APP_CONFIG.company.name}" class="w-full border border-slate-200 rounded-xl px-3 py-2 text-slate-800 font-bold" disabled>
              </div>
              <div>
                <label class="block font-bold text-slate-700 mb-1">Legal Registered Name</label>
                <input type="text" value="${APP_CONFIG.company.legalName}" class="w-full border border-slate-200 rounded-xl px-3 py-2 text-slate-800" disabled>
              </div>
            </div>

            <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label class="block font-bold text-slate-700 mb-1">Base Currency</label>
                <input type="text" value="PKR (Pakistani Rupee)" class="w-full border border-slate-200 rounded-xl px-3 py-2 text-slate-800 font-bold" disabled>
              </div>
              <div>
                <label class="block font-bold text-slate-700 mb-1">Tax Registration (NTN / STRN)</label>
                <input type="text" value="${APP_CONFIG.company.taxNumber}" class="w-full border border-slate-200 rounded-xl px-3 py-2 text-slate-800" disabled>
              </div>
            </div>

            <div>
              <label class="block font-bold text-slate-700 mb-1">Head Office Address</label>
              <textarea rows="2" class="w-full border border-slate-200 rounded-xl px-3 py-2 text-slate-800" disabled>${APP_CONFIG.company.address}</textarea>
            </div>
          </div>
        ` : activeTab === 'users' ? `
          <div class="space-y-4">
            <div class="flex justify-between items-center">
              <div>
                <h3 class="text-sm font-bold text-slate-800">System Users & Roles</h3>
                <p class="text-[11px] text-slate-400">Switch roles using the top-right role switcher to test each portal</p>
              </div>
            </div>

            <div class="border border-slate-200 rounded-xl overflow-hidden divide-y divide-slate-100">
              ${users.map(u => `
                <div class="p-3 flex justify-between items-center text-xs hover:bg-slate-50">
                  <div class="flex items-center gap-3">
                    <div class="w-8 h-8 rounded-full bg-[#138FCB] text-white flex items-center justify-center font-bold text-xs">
                      ${u.fullName[0]}
                    </div>
                    <div>
                      <div class="font-bold text-slate-800">${u.fullName}</div>
                      <div class="text-[10px] text-slate-400">${u.email}</div>
                    </div>
                  </div>
                  <div class="flex items-center gap-3">
                    <span class="px-2.5 py-1 rounded-lg text-xs font-bold bg-blue-50 text-[#138FCB]">
                      ${authService.getRoleDisplayName(u.roleCode)}
                    </span>
                    <button class="switch-user-btn px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-semibold cursor-pointer" data-id="${u.id}">
                      Impersonate
                    </button>
                  </div>
                </div>
              `).join('')}
            </div>
          </div>
        ` : activeTab === 'inventory' ? `
          <div class="max-w-2xl space-y-4">
            <h3 class="text-sm font-bold text-slate-800">Global Inventory Engine Rules</h3>
            <div class="p-3.5 bg-slate-50 border border-slate-200 rounded-xl space-y-3">
              <label class="flex items-center justify-between cursor-pointer">
                <div>
                  <span class="font-bold text-slate-800 block">Strict Negative Stock Enforcement</span>
                  <span class="text-slate-500 text-[11px]">Rejects deliveries or dispatches exceeding available physical warehouse stock</span>
                </div>
                <input type="checkbox" checked disabled class="rounded text-[#138FCB] focus:ring-0">
              </label>

              <label class="flex items-center justify-between cursor-pointer">
                <div>
                  <span class="font-bold text-slate-800 block">Roll / Cut-to-Length Auto-Roll Picker</span>
                  <span class="text-slate-500 text-[11px]">Deducts lengths from existing loose rolls before breaking full sealed coils</span>
                </div>
                <input type="checkbox" checked disabled class="rounded text-[#138FCB] focus:ring-0">
              </label>
            </div>

            <!-- Danger Zone: Reset to seed data -->
            <div class="mt-8 pt-6 border-t border-rose-100">
              <h4 class="text-sm font-bold text-rose-700 mb-1">Prototype Database Reset</h4>
              <p class="text-slate-500 text-xs mb-3">Reset all local storage to the original pre-seeded poultry equipment enterprise dataset.</p>
              <button id="reset-db-btn" class="px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white rounded-xl font-bold shadow-xs transition-colors cursor-pointer">
                Reset Database to Clean Demo State
              </button>
            </div>
          </div>
        ` : `
          <div class="space-y-4">
            <h3 class="text-sm font-bold text-slate-800">Custom Tags & Field Definitions</h3>
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div class="p-3.5 bg-slate-50 rounded-xl border border-slate-200">
                <span class="font-bold text-slate-700 block mb-2">Configured Entity Tags</span>
                <div class="flex flex-wrap gap-2">
                  ${tags.map(t => `
                    <span class="px-2.5 py-1 rounded-full text-xs font-bold" style="background-color: ${t.color}20; color: ${t.color};">
                      ● ${t.name}
                    </span>
                  `).join('')}
                </div>
              </div>

              <div class="p-3.5 bg-slate-50 rounded-xl border border-slate-200">
                <span class="font-bold text-slate-700 block mb-2">Dynamic Custom Fields</span>
                <div class="space-y-1 text-xs">
                  ${customFields.map(cf => `
                    <div class="flex justify-between text-slate-700 py-1 border-b border-slate-200/50">
                      <span class="font-medium">${cf.label}</span>
                      <span class="text-slate-400 font-mono text-[10px]">Module: ${cf.module}</span>
                    </div>
                  `).join('')}
                </div>
              </div>
            </div>
          </div>
        `}
      </div>
    </div>
  `;
}

export function bindSettingsEvents(container, refreshCallback) {
  container.querySelectorAll('.settings-tab-btn').forEach(btn => {
    btn.onclick = () => {
      const tab = btn.getAttribute('data-tab');
      container.innerHTML = renderSettingsView(tab);
      bindSettingsEvents(container, refreshCallback);
    };
  });

  // Switch User Impersonate buttons
  container.querySelectorAll('.switch-user-btn').forEach(btn => {
    btn.onclick = () => {
      const id = btn.getAttribute('data-id');
      const users = storageService.getCollection('users');
      const targetUser = users.find(u => u.id === id);
      if (targetUser) {
        authService.switchRole(targetUser.roleCode);
        toast.show(`Now acting as ${targetUser.fullName} (${authService.getRoleDisplayName(targetUser.roleCode)})`, 'info');
        if (refreshCallback) refreshCallback();
      }
    };
  });

  // Reset database button
  const resetBtn = container.querySelector('#reset-db-btn');
  if (resetBtn) {
    resetBtn.onclick = () => {
      confirmAction({
        title: 'Reset ERP Database to Initial State',
        message: 'This will reset all stock transactions, deliveries, and orders back to the initial demo seed data. Continue?',
        confirmLabel: 'Yes, Reset Everything',
        isDestructive: true,
        onConfirm: () => {
          storageService.resetToDefaults();
          toast.show('Database successfully reset to clean demo seed state.', 'success');
          if (refreshCallback) refreshCallback();
        }
      });
    };
  }
}
