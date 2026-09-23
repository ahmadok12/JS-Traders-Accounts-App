/**
 * JS Traders ERP - Mobile Phone Connection & QR Code Modal
 * Enables warehouse staff and managers to quickly connect their smartphones
 * by scanning a local QR code with their mobile camera.
 */

import { openModal, closeModal } from './modal.js';

export function openMobileConnectModal(defaultTab = 'staff') {
  const localIp = '192.168.1.13';
  const staffUrl = `http://${localIp}:8080/Staff.html`;
  const reportsUrl = `http://${localIp}:8080/management-report.html`;

  const contentHtml = `
    <div class="space-y-6 text-xs">
      <!-- Steps Banner -->
      <div class="p-4 bg-emerald-50/80 border border-emerald-200 rounded-xl flex items-start gap-3">
        <span class="text-xl">📱</span>
        <div class="space-y-1">
          <h4 class="font-bold text-emerald-950 text-xs">Scan &amp; Open on Any Smartphone</h4>
          <p class="text-emerald-800 leading-relaxed text-[11px]">
            1. Ensure your phone is connected to Wi-Fi <strong>StormFiber-4890</strong> (same network as this PC).<br>
            2. Open your phone's native <strong>Camera app</strong> and point it at the QR code below.<br>
            3. Tap the yellow/blue link prompt on your phone screen to launch the app!
          </p>
        </div>
      </div>

      <!-- App Tabs (Staff vs Reports) -->
      <div class="flex border-b border-slate-200 gap-4">
        <button id="tab-staff-app" class="pb-2.5 text-xs font-bold ${defaultTab === 'staff' ? 'text-[#138FCB] border-b-2 border-[#138FCB]' : 'text-slate-400 hover:text-slate-700'} cursor-pointer">
          📦 Warehouse Staff App
        </button>
        <button id="tab-reports-app" class="pb-2.5 text-xs font-bold ${defaultTab === 'reports' ? 'text-[#138FCB] border-b-2 border-[#138FCB]' : 'text-slate-400 hover:text-slate-700'} cursor-pointer">
          📊 Mobile Reports App
        </button>
      </div>

      <!-- Staff App View -->
      <div id="staff-qr-view" class="${defaultTab === 'staff' ? '' : 'hidden'} space-y-4">
        <div class="grid grid-cols-1 md:grid-cols-12 gap-6 items-center bg-white p-5 rounded-xl border border-slate-200 shadow-xs">
          <!-- QR Code Box -->
          <div class="md:col-span-5 flex flex-col items-center justify-center p-3 bg-slate-50 border border-slate-200 rounded-2xl">
            <img src="assets/images/mobile-qr.png" alt="Staff App QR" class="w-48 h-48 rounded-xl object-contain bg-white p-2 border border-slate-200 shadow-xs">
            <span class="mt-2 text-[10px] font-bold text-slate-500 uppercase tracking-wider">Point Camera Here</span>
          </div>

          <!-- URL and Details -->
          <div class="md:col-span-7 space-y-3">
            <div>
              <span class="text-[10px] font-bold uppercase tracking-wider text-slate-400">Direct Phone URL</span>
              <div class="mt-1 flex items-center gap-2">
                <input type="text" readonly value="${staffUrl}" class="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 font-mono text-xs font-bold text-slate-800 select-all">
                <button id="copy-staff-url-btn" type="button" class="px-3 py-2 bg-blue-50 text-[#138FCB] hover:bg-blue-100 rounded-lg font-bold text-xs border border-blue-200 transition-colors shrink-0 cursor-pointer">
                  Copy
                </button>
              </div>
            </div>

            <!-- Pre-configured Test PINs -->
            <div class="space-y-1.5 pt-1">
              <span class="text-[10px] font-bold uppercase tracking-wider text-slate-400">Quick Demo Staff Accounts &amp; PINs</span>
              <div class="grid grid-cols-2 gap-2">
                <div class="p-2 bg-blue-50/60 border border-blue-200 rounded-xl">
                  <span class="text-xs font-bold text-blue-950 block">📦 Ali Toor</span>
                  <span class="text-[10px] text-blue-700">Role: Warehouse Staff</span>
                  <strong class="text-xs font-mono text-blue-900 block mt-0.5">PIN: 1111</strong>
                </div>
                <div class="p-2 bg-blue-50/60 border border-blue-200 rounded-xl">
                  <span class="text-xs font-bold text-blue-950 block">📦 Ali Chhota</span>
                  <span class="text-[10px] text-blue-700">Role: Warehouse Staff</span>
                  <strong class="text-xs font-mono text-blue-900 block mt-0.5">PIN: 2222</strong>
                </div>
                <div class="p-2 bg-blue-50/60 border border-blue-200 rounded-xl">
                  <span class="text-xs font-bold text-blue-950 block">📦 Zain</span>
                  <span class="text-[10px] text-blue-700">Role: Warehouse Staff</span>
                  <strong class="text-xs font-mono text-blue-900 block mt-0.5">PIN: 3333</strong>
                </div>
                <div class="p-2 bg-amber-50/60 border border-amber-200 rounded-xl">
                  <span class="text-xs font-bold text-amber-950 block">🏢 Mudassar</span>
                  <span class="text-[10px] text-amber-700">Role: Office Staff</span>
                  <strong class="text-xs font-mono text-amber-900 block mt-0.5">PIN: 5678</strong>
                </div>
              </div>
            </div>

            <!-- Features to test on phone -->
            <div class="pt-1 text-[11px] text-slate-500 space-y-1">
              <span class="font-bold text-slate-700 block">✨ Features ready on mobile:</span>
              <p>• <strong>Loud Alarm:</strong> Tap "🔊 Sound ON" in header to test volume &amp; vibration.</p>
              <p>• <strong>Live Camera:</strong> Snap photos of physical cargo; auto-compresses 95%.</p>
              <p>• <strong>Multi-Item Tasks:</strong> Check off items one by one on the warehouse floor.</p>
            </div>
          </div>
        </div>
      </div>

      <!-- Reports App View -->
      <div id="reports-qr-view" class="${defaultTab === 'reports' ? '' : 'hidden'} space-y-4">
        <div class="grid grid-cols-1 md:grid-cols-12 gap-6 items-center bg-white p-5 rounded-xl border border-slate-200 shadow-xs">
          <!-- QR Code Box -->
          <div class="md:col-span-5 flex flex-col items-center justify-center p-3 bg-slate-50 border border-slate-200 rounded-2xl">
            <img src="assets/images/reports-qr.png" alt="Reports App QR" class="w-48 h-48 rounded-xl object-contain bg-white p-2 border border-slate-200 shadow-xs">
            <span class="mt-2 text-[10px] font-bold text-slate-500 uppercase tracking-wider">Point Camera Here</span>
          </div>

          <!-- URL and Details -->
          <div class="md:col-span-7 space-y-3">
            <div>
              <span class="text-[10px] font-bold uppercase tracking-wider text-slate-400">Direct Phone URL</span>
              <div class="mt-1 flex items-center gap-2">
                <input type="text" readonly value="${reportsUrl}" class="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 font-mono text-xs font-bold text-slate-800 select-all">
                <button id="copy-reports-url-btn" type="button" class="px-3 py-2 bg-blue-50 text-[#138FCB] hover:bg-blue-100 rounded-lg font-bold text-xs border border-blue-200 transition-colors shrink-0 cursor-pointer">
                  Copy
                </button>
              </div>
            </div>

            <div class="space-y-1.5 pt-1">
              <span class="text-[10px] font-bold uppercase tracking-wider text-slate-400">Demo Features</span>
              <p class="text-[11px] text-slate-600 leading-relaxed">
                • Large square category cards and 2-column small square item cards grid.<br>
                • Real-time stock breakdown between Warehouse and Office.<br>
                • Role switcher with financial valuation redaction for floor staff.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;

  const footerHtml = `
    <div class="flex items-center space-x-2 text-xs text-slate-400">
      <span>Wi-Fi Network: <strong class="text-slate-700">StormFiber-4890</strong></span>
    </div>
    <div class="flex items-center space-x-3 w-full sm:w-auto justify-end">
      <a href="Staff.html" target="_blank" class="px-4 py-2 text-xs font-bold text-slate-700 hover:bg-slate-100 rounded-lg transition-colors border border-slate-300">
        Open in Desktop Tab
      </a>
      <button id="close-qr-modal-btn" type="button" class="px-5 py-2 text-xs font-bold text-white bg-[#138FCB] hover:bg-[#0E78AC] rounded-lg shadow-sm cursor-pointer">
        Done
      </button>
    </div>
  `;

  openModal({
    title: 'Scan to Open on Mobile Phone',
    subtitle: 'Point your smartphone camera at the QR code to open the web app instantly',
    badge: 'MOBILE ACCESS',
    contentHtml,
    footerHtml,
    size: 'max-w-3xl',
    onOpen: (modalEl) => {
      const closeBtn = modalEl.querySelector('#close-qr-modal-btn');
      if (closeBtn) closeBtn.onclick = () => closeModal();

      const tabStaff = modalEl.querySelector('#tab-staff-app');
      const tabReports = modalEl.querySelector('#tab-reports-app');
      const viewStaff = modalEl.querySelector('#staff-qr-view');
      const viewReports = modalEl.querySelector('#reports-qr-view');

      if (tabStaff && tabReports) {
        tabStaff.onclick = () => {
          tabStaff.className = 'pb-2.5 text-xs font-bold text-[#138FCB] border-b-2 border-[#138FCB] cursor-pointer';
          tabReports.className = 'pb-2.5 text-xs font-bold text-slate-400 hover:text-slate-700 cursor-pointer';
          viewStaff.classList.remove('hidden');
          viewReports.classList.add('hidden');
        };
        tabReports.onclick = () => {
          tabReports.className = 'pb-2.5 text-xs font-bold text-[#138FCB] border-b-2 border-[#138FCB] cursor-pointer';
          tabStaff.className = 'pb-2.5 text-xs font-bold text-slate-400 hover:text-slate-700 cursor-pointer';
          viewReports.classList.remove('hidden');
          viewStaff.classList.add('hidden');
        };
      }

      const copyStaffBtn = modalEl.querySelector('#copy-staff-url-btn');
      if (copyStaffBtn) {
        copyStaffBtn.onclick = () => {
          navigator.clipboard.writeText(staffUrl);
          copyStaffBtn.textContent = 'Copied!';
          setTimeout(() => { copyStaffBtn.textContent = 'Copy'; }, 2000);
        };
      }

      const copyReportsBtn = modalEl.querySelector('#copy-reports-url-btn');
      if (copyReportsBtn) {
        copyReportsBtn.onclick = () => {
          navigator.clipboard.writeText(reportsUrl);
          copyReportsBtn.textContent = 'Copied!';
          setTimeout(() => { copyReportsBtn.textContent = 'Copy'; }, 2000);
        };
      }
    }
  });
}
