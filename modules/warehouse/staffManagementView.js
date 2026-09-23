/**
 * JS Traders ERP - Warehouse Staff & Mobile Access Management View
 * Allows Warehouse Manager to add warehouse & office staff, generate and reset PIN credentials,
 * and review staff mobile authorization.
 */

import { staffAuthService } from '../../services/staffAuthService.js';
import { renderTable } from '../../components/table.js';
import { openModal, closeModal } from '../../components/modal.js';
import { openMobileConnectModal } from '../../components/mobileConnectModal.js';
import { toast } from '../../components/toast.js';

export function renderStaffManagementView() {
  const staffMembers = staffAuthService.getStaffMembers();

  const columns = [
    {
      key: 'fullName',
      label: 'Staff Member',
      render: row => `
        <div class="flex items-center gap-3">
          <div class="w-8 h-8 rounded-full ${row.staffType === 'office_staff' ? 'bg-amber-100 text-amber-800' : 'bg-blue-100 text-[#138FCB]'} flex items-center justify-center font-bold text-xs">
            ${row.staffType === 'office_staff' ? '🏢' : '📦'}
          </div>
          <div>
            <span class="font-bold text-slate-900 text-xs">${row.fullName || 'Staff'}</span>
            <span class="text-[10px] text-slate-400 block font-mono">@${row.username}</span>
          </div>
        </div>
      `
    },
    {
      key: 'staffType',
      label: 'Staff Scope & Role',
      render: row => {
        const isOffice = row.staffType === 'office_staff';
        return `
          <div class="space-y-0.5">
            <span class="inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-bold ${isOffice ? 'bg-amber-50 text-amber-800 border border-amber-200' : 'bg-blue-50 text-blue-800 border border-blue-200'}">
              ${isOffice ? '🏢 Office Inventory Staff' : '📦 Warehouse Staff'}
            </span>
            <span class="text-[10px] text-slate-400 block">
              ${isOffice ? 'Fetches strictly Office items' : 'Full warehouse dispatch scope'}
            </span>
          </div>
        `;
      }
    },
    {
      key: 'phone',
      label: 'Contact Phone',
      render: row => `<span class="text-slate-700 font-medium text-xs font-mono">${row.phone || 'N/A'}</span>`
    },
    {
      key: 'pin',
      label: 'Mobile Security PIN',
      render: row => `
        <div class="flex items-center gap-2">
          <span class="px-2 py-1 rounded bg-slate-100 text-slate-800 font-mono font-bold tracking-widest text-xs">
            ${row.pin || '••••'}
          </span>
          <button class="copy-creds-btn text-[10px] font-bold text-[#138FCB] hover:underline cursor-pointer" data-user="${row.username}" data-pin="${row.pin || '1234'}">
            Copy Login
          </button>
        </div>
      `
    },
    {
      key: 'status',
      label: 'Mobile Access',
      render: row => `
        <span class="inline-flex items-center gap-1 text-[11px] font-semibold ${row.isActive ? 'text-emerald-700' : 'text-slate-400'}">
          <span class="w-1.5 h-1.5 rounded-full ${row.isActive ? 'bg-emerald-500' : 'bg-slate-300'}"></span>
          ${row.isActive ? 'Active Authorization' : 'Suspended'}
        </span>
      `
    },
    {
      key: 'actions',
      label: 'Manage',
      align: 'right',
      render: row => `
        <div class="flex items-center justify-end gap-2">
          <button class="reset-pin-btn px-2.5 py-1 text-xs font-semibold bg-amber-50 text-amber-700 hover:bg-amber-100 rounded-lg transition-colors cursor-pointer" data-id="${row.id}" title="Reset PIN">
            🔑 Reset Credentials
          </button>
          <a href="mobile.html" target="_blank" class="test-mobile-btn px-2.5 py-1 text-xs font-semibold bg-slate-100 text-slate-700 hover:bg-slate-200 rounded-lg transition-colors cursor-pointer flex items-center gap-1">
            <span>📱</span> Launch
          </a>
        </div>
      `
    }
  ];

  const tableHtml = renderTable({
    id: 'staff-table',
    columns,
    data: staffMembers,
    selectable: false,
    emptyMessage: 'No warehouse staff accounts created yet.'
  });

  return `
    <div class="space-y-6 animate-in fade-in duration-150">
      <!-- Header -->
      <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white p-4 rounded-2xl border border-[#EAECEF] shadow-[0_2px_4px_rgba(0,0,0,0.02)]">
        <div>
          <h2 class="text-base font-bold text-[#1A1D1F]">Warehouse Staff & Mobile Access</h2>
          <p class="text-xs text-slate-400 mt-0.5">Manage staff mobile credentials, PIN generation, and Office vs. Warehouse fetch permissions</p>
        </div>
        <div class="flex items-center flex-wrap gap-2">
          <button id="show-mobile-qr-btn" class="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-bold bg-emerald-600 text-white rounded-xl hover:bg-emerald-700 transition-colors cursor-pointer shadow-xs">
            <span>📷</span>
            <span>Scan QR on Mobile</span>
          </button>
          <a href="mobile.html" target="_blank" class="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-bold bg-slate-800 text-white rounded-xl hover:bg-slate-900 transition-colors cursor-pointer shadow-xs">
            <span>📱</span>
            <span>Open Staff App</span>
          </a>
          <button id="add-staff-btn" class="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-bold bg-[#138FCB] text-white rounded-xl hover:bg-[#0E78AC] transition-colors shadow-xs cursor-pointer">
            <span>+</span>
            <span>Add Warehouse Staff</span>
          </button>
        </div>
      </div>

      <!-- Scope Explanation Banner -->
      <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div class="p-4 bg-blue-50/70 border border-blue-100 rounded-2xl">
          <div class="flex items-center gap-2 mb-1">
            <span class="text-base">📦</span>
            <h3 class="text-xs font-bold text-blue-950 uppercase tracking-wider">Warehouse Staff Role</h3>
          </div>
          <p class="text-xs text-blue-800 leading-relaxed">
            Staff members assigned to the main warehouse receive full gatepass overview. They fetch bulky stock from <strong>Warehouse</strong>, live-capture photo proof, and submit dispatch evidence.
          </p>
        </div>
        <div class="p-4 bg-amber-50/70 border border-amber-100 rounded-2xl">
          <div class="flex items-center gap-2 mb-1">
            <span class="text-base">🏢</span>
            <h3 class="text-xs font-bold text-amber-950 uppercase tracking-wider">Office Inventory Staff Role</h3>
          </div>
          <p class="text-xs text-amber-800 leading-relaxed">
            Specialized staff member at the city commercial office. When notified of an outward gatepass, the mobile app shows <strong>ONLY</strong> the items and quantities assigned to be fetched from the <strong>Office</strong>.
          </p>
        </div>
      </div>

      <!-- Staff Table -->
      <div id="staff-table-container">
        ${tableHtml}
      </div>
    </div>
  `;
}

export function bindStaffManagementEvents(container, refreshCallback) {
  // Scan QR Code Modal
  const qrBtn = container.querySelector('#show-mobile-qr-btn');
  if (qrBtn) {
    qrBtn.onclick = () => openMobileConnectModal('staff');
  }

  // Add Staff Button
  const addBtn = container.querySelector('#add-staff-btn');
  if (addBtn) {
    addBtn.onclick = () => {
      openAddStaffModal(() => {
        if (refreshCallback) refreshCallback();
      });
    };
  }

  // Reset PIN buttons
  container.querySelectorAll('.reset-pin-btn').forEach(btn => {
    btn.onclick = (e) => {
      const id = e.currentTarget.getAttribute('data-id');
      const staff = staffAuthService.getStaffById(id);
      if (staff) {
        openResetPinModal(staff, () => {
          if (refreshCallback) refreshCallback();
        });
      }
    };
  });
}

function openAddStaffModal(onSuccess) {
  const defaultPin = staffAuthService.generateRandomPin();
  const content = `
    <form id="add-staff-form" class="space-y-4">
      <div>
        <label class="block text-xs font-bold text-slate-700 mb-1">Staff Full Name *</label>
        <input type="text" id="staff-name" required placeholder="e.g. Asad Ali" class="w-full px-3 py-2 text-xs border border-slate-200 rounded-xl focus:border-[#138FCB] outline-none">
      </div>

      <div class="grid grid-cols-2 gap-3">
        <div>
          <label class="block text-xs font-bold text-slate-700 mb-1">Username *</label>
          <input type="text" id="staff-username" required placeholder="e.g. asad_staff" class="w-full px-3 py-2 text-xs border border-slate-200 rounded-xl focus:border-[#138FCB] outline-none font-mono">
        </div>
        <div>
          <label class="block text-xs font-bold text-slate-700 mb-1">Mobile Phone *</label>
          <input type="tel" id="staff-phone" required placeholder="+92 300 1234567" class="w-full px-3 py-2 text-xs border border-slate-200 rounded-xl focus:border-[#138FCB] outline-none">
        </div>
      </div>

      <div>
        <label class="block text-xs font-bold text-slate-700 mb-1">Staff Role & Location Scope *</label>
        <select id="staff-type" required class="w-full px-3 py-2 text-xs border border-slate-200 rounded-xl focus:border-[#138FCB] outline-none">
          <option value="warehouse_staff">📦 Warehouse Staff (Full Gatepass Scope)</option>
          <option value="office_staff">🏢 Office Inventory Staff (Office Items Only Scope)</option>
        </select>
        <p class="text-[11px] text-slate-400 mt-1">Office staff will only be shown items allocated to be fetched from the Office.</p>
      </div>

      <div>
        <label class="block text-xs font-bold text-slate-700 mb-1">Generated 4-Digit Login PIN *</label>
        <div class="flex items-center gap-2">
          <input type="text" id="staff-pin" required maxlength="6" value="${defaultPin}" class="w-36 px-3 py-2 text-sm font-bold text-center border border-slate-200 rounded-xl focus:border-[#138FCB] outline-none font-mono tracking-widest bg-slate-50">
          <button type="button" id="regen-pin-btn" class="px-3 py-2 text-xs font-semibold bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl transition-colors cursor-pointer">
            🔄 Generate New
          </button>
        </div>
        <p class="text-[11px] text-slate-400 mt-1">Staff uses this PIN to log into the mobile app.</p>
      </div>

      <div class="flex justify-end gap-2 pt-4 border-t border-slate-100">
        <button type="button" id="cancel-staff-btn" class="px-4 py-2 text-xs font-medium text-slate-600 hover:bg-slate-100 rounded-xl transition-colors cursor-pointer">
          Cancel
        </button>
        <button type="submit" class="px-4 py-2 text-xs font-bold bg-[#138FCB] text-white rounded-xl hover:bg-[#0E78AC] transition-colors shadow-xs cursor-pointer">
          Save & Issue Credentials
        </button>
      </div>
    </form>
  `;

  openModal({
    title: 'Add New Warehouse Staff Member',
    content,
    width: 'max-w-md'
  });

  const form = document.getElementById('add-staff-form');
  const cancelBtn = document.getElementById('cancel-staff-btn');
  const regenBtn = document.getElementById('regen-pin-btn');

  if (cancelBtn) cancelBtn.onclick = () => closeModal();
  if (regenBtn) {
    regenBtn.onclick = () => {
      document.getElementById('staff-pin').value = staffAuthService.generateRandomPin();
    };
  }

  if (form) {
    form.onsubmit = (e) => {
      e.preventDefault();
      const fullName = document.getElementById('staff-name').value.trim();
      const username = document.getElementById('staff-username').value.trim().toLowerCase();
      const phone = document.getElementById('staff-phone').value.trim();
      const staffType = document.getElementById('staff-type').value;
      const pin = document.getElementById('staff-pin').value.trim();

      try {
        const created = staffAuthService.createStaff({ fullName, username, phone, staffType, pin });
        closeModal();
        openCredentialSuccessModal(created);
        if (onSuccess) onSuccess();
      } catch (err) {
        toast.show(err.message, 'error');
      }
    };
  }
}

function openResetPinModal(staff, onSuccess) {
  const newPin = staffAuthService.generateRandomPin();
  const content = `
    <div class="space-y-4">
      <p class="text-xs text-slate-600">
        You are resetting the mobile login PIN for <strong>${staff.fullName}</strong> (@${staff.username}).
      </p>

      <div>
        <label class="block text-xs font-bold text-slate-700 mb-1">New Mobile PIN</label>
        <div class="flex items-center gap-2">
          <input type="text" id="reset-pin-val" maxlength="6" value="${newPin}" class="w-36 px-3 py-2 text-sm font-bold text-center border border-slate-200 rounded-xl focus:border-[#138FCB] outline-none font-mono tracking-widest bg-slate-50">
          <button type="button" id="regen-reset-pin" class="px-3 py-2 text-xs font-semibold bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl transition-colors cursor-pointer">
            🔄 Regenerate
          </button>
        </div>
      </div>

      <div class="flex justify-end gap-2 pt-4 border-t border-slate-100">
        <button type="button" id="cancel-reset-btn" class="px-4 py-2 text-xs font-medium text-slate-600 hover:bg-slate-100 rounded-xl transition-colors cursor-pointer">
          Cancel
        </button>
        <button type="button" id="confirm-reset-btn" class="px-4 py-2 text-xs font-bold bg-amber-600 text-white rounded-xl hover:bg-amber-700 transition-colors shadow-xs cursor-pointer">
          Confirm PIN Reset
        </button>
      </div>
    </div>
  `;

  openModal({
    title: 'Reset Staff Login Credentials',
    content,
    width: 'max-w-md'
  });

  const cancelBtn = document.getElementById('cancel-reset-btn');
  const confirmBtn = document.getElementById('confirm-reset-btn');
  const regenBtn = document.getElementById('regen-reset-pin');

  if (cancelBtn) cancelBtn.onclick = () => closeModal();
  if (regenBtn) {
    regenBtn.onclick = () => {
      document.getElementById('reset-pin-val').value = staffAuthService.generateRandomPin();
    };
  }

  if (confirmBtn) {
    confirmBtn.onclick = () => {
      const pinVal = document.getElementById('reset-pin-val').value.trim();
      const updated = staffAuthService.resetCredentials(staff.id, pinVal);
      closeModal();
      openCredentialSuccessModal(updated);
      if (onSuccess) onSuccess();
    };
  }
}

function openCredentialSuccessModal(staff) {
  const content = `
    <div class="space-y-4 text-center py-2">
      <div class="w-12 h-12 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center text-xl mx-auto">
        ✓
      </div>
      <h3 class="text-sm font-bold text-slate-900">Credentials Issued Successfully!</h3>
      <p class="text-xs text-slate-500">Provide these login credentials to <strong>${staff.fullName}</strong> for the mobile app:</p>

      <div class="p-4 bg-slate-50 border border-slate-200 rounded-xl font-mono text-left text-xs space-y-2">
        <div class="flex justify-between">
          <span class="text-slate-400">Username:</span>
          <strong class="text-slate-800">${staff.username}</strong>
        </div>
        <div class="flex justify-between">
          <span class="text-slate-400">Mobile PIN:</span>
          <strong class="text-[#138FCB] text-base">${staff.pin || staff.generatedPin || staff.newPin}</strong>
        </div>
        <div class="flex justify-between">
          <span class="text-slate-400">Scope:</span>
          <span class="font-bold text-slate-700">${staff.staffType === 'office_staff' ? 'Office Inventory Only' : 'Warehouse Full'}</span>
        </div>
      </div>

      <div class="pt-3 flex justify-center gap-2">
        <button id="copy-cred-btn" class="px-4 py-2 text-xs font-bold bg-[#138FCB] text-white rounded-xl hover:bg-[#0E78AC] transition-colors cursor-pointer">
          📋 Copy Login Info
        </button>
        <button id="close-cred-btn" class="px-4 py-2 text-xs font-medium text-slate-600 hover:bg-slate-100 rounded-xl transition-colors cursor-pointer">
          Done
        </button>
      </div>
    </div>
  `;

  openModal({
    title: 'Staff Login Credentials',
    content,
    width: 'max-w-md'
  });

  const closeBtn = document.getElementById('close-cred-btn');
  const copyBtn = document.getElementById('copy-cred-btn');

  if (closeBtn) closeBtn.onclick = () => closeModal();
  if (copyBtn) {
    copyBtn.onclick = () => {
      const pin = staff.pin || staff.generatedPin || staff.newPin;
      const text = `JS Traders Staff Mobile Login:\nUsername: ${staff.username}\nPIN: ${pin}\nApp: ${window.location.origin}/mobile.html`;
      navigator.clipboard?.writeText(text);
      toast.show('Credentials copied to clipboard!', 'success');
    };
  }
}
