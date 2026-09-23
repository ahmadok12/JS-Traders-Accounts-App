/**
 * JS Traders ERP - Warehouse Staff Mobile Application Controller
 * Dedicated mobile-only touch application for Warehouse and Office Inventory Staff.
 * Features:
 * - PIN-based staff login
 * - Role-based item filtering (Office Staff sees ONLY Office items; Warehouse Staff sees all)
 * - Live camera capture & client-side high-compression Canvas optimization (~95% size reduction)
 * - Instant proof photo submission to Warehouse Manager portal
 * - In-app notification alerts
 */

import { staffAuthService } from '../../services/staffAuthService.js';
import { gatepassService } from '../../services/gatepassService.js';
import { productService } from '../../services/productService.js';
import { storageService } from '../../services/storageService.js';
import { ImageCompressor } from '../../utils/imageCompressor.js';
import { soundAlert } from '../../utils/soundAlert.js';
import { openPortalSwitcherModal } from '../../components/portalSwitcherModal.js';

class MobileStaffApp {
  constructor() {
    this.currentStaff = null;
    this.activeTab = 'tasks'; // 'tasks' | 'notifications' | 'profile'
    this.selectedGatepassId = null;
    this.capturedPhotos = []; // Local photos staged for upload
    this.contentEl = null;
    this.navBarEl = null;
    this.staffNameEl = null;
    this.logoutBtn = null;
    this.notifBtn = null;
    this.notifBadge = null;
    this.soundTestBtn = null;
    this.alertBannerEl = null;
    this.alertChannel = null;
    this.lastKnownNotifIds = new Set();
    this.notifFilter = 'all'; // 'all' | 'unread' | 'urgent'
    this.wakeLock = null;
    this.wakeLockEnabled = true;
    this.swRegistration = null;
    this.wakeLockBtn = null;
  }

  init() {
    this.contentEl = document.getElementById('mobile-content');
    this.navBarEl = document.getElementById('mobile-nav-bar');
    this.staffNameEl = document.getElementById('app-staff-name');
    this.logoutBtn = document.getElementById('mobile-logout-btn');
    this.notifBtn = document.getElementById('mobile-notif-btn');
    this.notifBadge = document.getElementById('notif-badge');
    this.soundTestBtn = document.getElementById('mobile-sound-test-btn');
    this.wakeLockBtn = document.getElementById('mobile-wakelock-btn');
    this.alertBannerEl = document.getElementById('realtime-alert-banner');

    soundAlert.init();
    this.setupAudioUnlock();
    this.initServiceWorker();
    this.initWakeLock();
    this.bindGlobalEvents();
    this.setupRealtimeListeners();

    // Check staff session
    this.currentStaff = staffAuthService.getCurrentStaff();
    if (this.currentStaff && this.currentStaff.roleCode === 'warehouse_staff') {
      this.seedExistingNotificationIds();
      this.renderAppShell();
    } else {
      this.renderLoginScreen();
    }

    // Subscribe to storage changes for real-time reactivity within same tab
    storageService.subscribe('gatepasses', () => {
      if (this.currentStaff) this.renderCurrentTab();
    });
    storageService.subscribe('staffNotifications', () => {
      this.updateNotifBadge();
      if (this.currentStaff && this.activeTab === 'notifications') {
        this.renderNotificationsTab();
      }
    });
  }

  async initServiceWorker() {
    if ('serviceWorker' in navigator) {
      try {
        this.swRegistration = await navigator.serviceWorker.register('/sw.js');
        console.log('[SW] ServiceWorker registered');
      } catch (err) {
        console.warn('[SW] Registration note:', err.message);
      }
    }
  }

  async initWakeLock() {
    if ('wakeLock' in navigator) {
      try {
        if (this.wakeLockEnabled) {
          this.wakeLock = await navigator.wakeLock.request('screen');
          this.updateWakeLockUI(true);
        }
      } catch (e) {}

      document.addEventListener('visibilitychange', async () => {
        if (this.wakeLockEnabled && document.visibilityState === 'visible') {
          try {
            this.wakeLock = await navigator.wakeLock.request('screen');
            this.updateWakeLockUI(true);
          } catch (e) {}
        }
      });
    } else {
      if (this.wakeLockBtn) this.wakeLockBtn.classList.add('hidden');
    }
  }

  async toggleWakeLock() {
    if (!('wakeLock' in navigator)) {
      this.showToast('Screen Wake Lock not supported on this browser.', 'info');
      return;
    }

    if (this.wakeLock) {
      try {
        await this.wakeLock.release();
        this.wakeLock = null;
        this.wakeLockEnabled = false;
        this.updateWakeLockUI(false);
        this.showToast('🌙 Standard Battery Mode (Screen sleep allowed)', 'info');
      } catch (e) {}
    } else {
      try {
        this.wakeLock = await navigator.wakeLock.request('screen');
        this.wakeLockEnabled = true;
        this.updateWakeLockUI(true);
        this.showToast('☀️ Screen set to ALWAYS ON during shift!', 'success');
      } catch (err) {
        this.showToast('Could not enable screen lock: ' + err.message, 'warning');
      }
    }
  }

  updateWakeLockUI(active) {
    const textEl = document.getElementById('wakelock-text');
    const iconEl = document.getElementById('wakelock-icon');
    const btn = document.getElementById('mobile-wakelock-btn');
    if (!btn) return;

    if (active) {
      if (textEl) textEl.textContent = 'Awake ON';
      if (iconEl) iconEl.textContent = '☀️';
      btn.classList.add('bg-white/30', 'text-amber-200');
      btn.classList.remove('bg-white/15');
    } else {
      if (textEl) textEl.textContent = 'Awake OFF';
      if (iconEl) iconEl.textContent = '🌙';
      btn.classList.remove('bg-white/30', 'text-amber-200');
      btn.classList.add('bg-white/15');
    }
  }

  async requestSystemNotificationPermission() {
    if (!('Notification' in window)) {
      this.showToast('System Notifications are not supported on this browser.', 'warning');
      return false;
    }

    try {
      const permission = await Notification.requestPermission();
      if (permission === 'granted') {
        this.showToast('🔔 System Lockscreen Alerts Enabled!', 'success');
        soundAlert.unlock();
        soundAlert.playLoudAlert();
        this.showSystemNotification({
          title: '✅ JS Traders Staff Portal',
          message: 'System notifications active! You will receive lockscreen alerts for new dispatches.'
        });
        if (this.activeTab === 'notifications') this.renderNotificationsTab();
        return true;
      } else {
        this.showToast('Notification permission denied.', 'warning');
        return false;
      }
    } catch (e) {
      this.showToast('Error requesting notification permission: ' + e.message, 'error');
      return false;
    }
  }

  showSystemNotification(data) {
    if (!('Notification' in window) || Notification.permission !== 'granted') return;

    const title = data.title || '🚨 Urgent Gatepass Assignment';
    const body = data.message || 'You have new equipment cargo to fetch.';

    if (this.swRegistration && this.swRegistration.showNotification) {
      this.swRegistration.showNotification(title, {
        body,
        icon: '/assets/images/mobile-qr.png',
        badge: '/assets/images/mobile-qr.png',
        vibrate: [350, 150, 350, 150, 600],
        tag: data.gatepassNumber || 'gatepass-alert',
        renotify: true,
        data: { url: '/mobile.html', gatepassId: data.gatepassId }
      }).catch(() => {
        try { new Notification(title, { body, icon: '/assets/images/mobile-qr.png' }); } catch (e) {}
      });
    } else {
      try {
        new Notification(title, { body, icon: '/assets/images/mobile-qr.png' });
      } catch (e) {}
    }
  }

  setupAudioUnlock() {
    const unlock = () => {
      soundAlert.unlock();
      window.removeEventListener('click', unlock);
      window.removeEventListener('touchstart', unlock);
    };
    window.addEventListener('click', unlock, { passive: true });
    window.addEventListener('touchstart', unlock, { passive: true });
  }

  seedExistingNotificationIds() {
    if (!this.currentStaff) return;
    const notifs = storageService.getCollection('staffNotifications') || [];
    notifs
      .filter(n => n.staffId === this.currentStaff.id)
      .forEach(n => this.lastKnownNotifIds.add(n.id));
  }

  setupRealtimeListeners() {
    // 1. BroadcastChannel API for instant inter-tab communication
    if (typeof BroadcastChannel !== 'undefined') {
      try {
        this.alertChannel = new BroadcastChannel('js_traders_staff_alerts');
        this.alertChannel.onmessage = (event) => {
          this.handleIncomingAlert(event.data);
        };
      } catch (e) {
        console.warn('BroadcastChannel error:', e);
      }
    }

    // 2. Storage event listener (fires across tabs/windows on localStorage setItem)
    window.addEventListener('storage', (e) => {
      if (e.key === 'js_staff_realtime_alert' && e.newValue) {
        try {
          const payload = JSON.parse(e.newValue);
          this.handleIncomingAlert(payload);
        } catch (err) {}
      } else if (e.key === 'js_traders_erp_db_v1') {
        this.checkAndNotifyNewAssignments();
      }
    });

    // 3. Heartbeat continuous check (every 1.5s) to guarantee zero-refresh alert delivery
    setInterval(() => {
      if (this.currentStaff) {
        this.checkAndNotifyNewAssignments();
      }
    }, 1500);
  }

  handleIncomingAlert(data) {
    if (!this.currentStaff || !data) return;
    const staffIds = data.assignedStaffIds || [];
    const targetStaffId = data.staffId;

    if (staffIds.includes(this.currentStaff.id) || targetStaffId === this.currentStaff.id) {
      // Find latest notification details
      const notifs = storageService.getCollection('staffNotifications') || [];
      const latest = notifs
        .filter(n => n.staffId === this.currentStaff.id && n.gatepassId === data.gatepassId)
        .pop();

      this.triggerLoudAlert({
        gatepassId: data.gatepassId,
        gatepassNumber: data.gatepassNumber,
        title: latest ? latest.title : `Gatepass ${data.gatepassNumber} Assigned`,
        message: latest ? latest.message : 'New equipment cargo allocated for immediate fetch.'
      });
    }
  }

  checkAndNotifyNewAssignments() {
    if (!this.currentStaff) return;
    const notifs = storageService.getCollection('staffNotifications') || [];
    const myNotifs = notifs.filter(n => n.staffId === this.currentStaff.id);

    const newUnread = myNotifs.filter(n => !n.isRead && !this.lastKnownNotifIds.has(n.id));
    if (newUnread.length > 0) {
      newUnread.forEach(n => this.lastKnownNotifIds.add(n.id));
      const latest = newUnread[newUnread.length - 1];
      this.triggerLoudAlert({
        gatepassId: latest.gatepassId,
        gatepassNumber: latest.gatepassNumber,
        title: latest.title,
        message: latest.message
      });
    }
  }

  triggerLoudAlert(data) {
    // 1. Play loud acoustic warehouse alert and trigger mobile haptics
    soundAlert.playLoudAlert();
    this.showSystemNotification(data);

    // 2. Real-time dynamic UI refresh without reloading the page
    this.updateNotifBadge();
    if (!this.selectedGatepassId && this.activeTab === 'tasks') {
      this.renderTasksTab();
    } else if (this.activeTab === 'notifications') {
      this.renderNotificationsTab();
    }

    // 3. Dropdown urgent alert banner
    if (this.alertBannerEl) {
      const titleEl = document.getElementById('alert-banner-title');
      const descEl = document.getElementById('alert-banner-desc');
      const viewBtn = document.getElementById('alert-banner-view-btn');
      const closeBtn = document.getElementById('alert-banner-close');

      if (titleEl) titleEl.textContent = `🚨 ${data.gatepassNumber || 'New Gatepass'} Outward Assignment`;
      if (descEl) descEl.textContent = data.message || 'You have been assigned to fetch equipment cargo.';

      if (viewBtn) {
        viewBtn.onclick = () => {
          this.alertBannerEl.classList.add('hidden');
          if (data.gatepassId) {
            this.selectedGatepassId = data.gatepassId;
            this.capturedPhotos = [];
            this.renderGatepassDetail(data.gatepassId);
          } else {
            this.switchTab('tasks');
          }
        };
      }

      if (closeBtn) {
        closeBtn.onclick = () => {
          this.alertBannerEl.classList.add('hidden');
        };
      }

      this.alertBannerEl.classList.remove('hidden');
    }

    // 4. In-app floating toast
    this.showToast(`🚨 LOUD ALERT: ${data.gatepassNumber || 'New Gatepass'} assigned! Check task list.`, 'warning');
  }

  bindGlobalEvents() {
    // Portals Switcher Button
    const portalsBtn = document.getElementById('staff-portals-btn');
    if (portalsBtn) {
      portalsBtn.onclick = () => openPortalSwitcherModal('staff-app');
    }

    // WakeLock toggle button
    if (this.wakeLockBtn) {
      this.wakeLockBtn.onclick = () => this.toggleWakeLock();
    }

    // Sound Test Button
    if (this.soundTestBtn) {
      this.soundTestBtn.onclick = () => {
        soundAlert.unlock();
        soundAlert.playLoudAlert();
        this.showToast('🔊 Playing Loud Alarm Sound & Vibration Test', 'info');
      };
    }

    // Logout button
    if (this.logoutBtn) {
      this.logoutBtn.onclick = () => {
        staffAuthService.logout();
        this.currentStaff = null;
        this.alertBannerEl?.classList.add('hidden');
        this.renderLoginScreen();
      };
    }

    // Header notification bell
    if (this.notifBtn) {
      this.notifBtn.onclick = () => {
        if (this.currentStaff) {
          this.switchTab('notifications');
        }
      };
    }

    // Bottom Navigation Bar tabs
    document.querySelectorAll('.mobile-nav-item').forEach(item => {
      item.onclick = (e) => {
        const tab = e.currentTarget.getAttribute('data-tab');
        if (tab) this.switchTab(tab);
      };
    });
  }

  renderAppShell() {
    if (!this.currentStaff) return;

    this.staffNameEl.textContent = this.currentStaff.fullName;
    this.logoutBtn.classList.remove('hidden');
    this.navBarEl.classList.remove('hidden');
    this.updateNotifBadge();
    this.renderCurrentTab();
  }

  switchTab(tab) {
    this.activeTab = tab;
    this.selectedGatepassId = null;
    this.capturedPhotos = [];

    // Update bottom nav highlighting
    document.querySelectorAll('.mobile-nav-item').forEach(item => {
      const itemTab = item.getAttribute('data-tab');
      if (itemTab === tab) {
        item.classList.add('text-[#138FCB]');
        item.classList.remove('text-slate-400');
      } else {
        item.classList.remove('text-[#138FCB]');
        item.classList.add('text-slate-400');
      }
    });

    this.renderCurrentTab();
  }

  updateNotifBadge() {
    if (!this.currentStaff) return;
    const notifs = storageService.getCollection('staffNotifications');
    const unread = notifs.filter(n => n.staffId === this.currentStaff.id && !n.isRead);
    const navDot = document.getElementById('nav-notif-dot');

    if (unread.length > 0) {
      this.notifBadge?.classList.remove('hidden');
      navDot?.classList.remove('hidden');
    } else {
      this.notifBadge?.classList.add('hidden');
      navDot?.classList.add('hidden');
    }
  }

  renderCurrentTab() {
    if (this.selectedGatepassId) {
      this.renderGatepassDetail(this.selectedGatepassId);
      return;
    }

    switch (this.activeTab) {
      case 'tasks':
        this.renderTasksTab();
        break;
      case 'notifications':
        this.renderNotificationsTab();
        break;
      case 'profile':
        this.renderProfileTab();
        break;
    }
  }

  // ----------------------------------------------------------------------
  // LOGIN SCREEN
  // ----------------------------------------------------------------------
  renderLoginScreen() {
    this.logoutBtn.classList.add('hidden');
    this.navBarEl.classList.add('hidden');
    this.staffNameEl.textContent = 'Warehouse Staff App';

    this.contentEl.innerHTML = `
      <div class="h-full flex flex-col justify-between py-4 animate-in fade-in duration-200">
        <div class="space-y-6 pt-4">
          <!-- Logo & Title -->
          <div class="text-center space-y-2">
            <div class="w-16 h-16 rounded-3xl bg-[#138FCB] text-white flex items-center justify-center font-black text-2xl mx-auto shadow-lg shadow-blue-500/20 italic">
              JS
            </div>
            <h1 class="text-xl font-extrabold text-slate-900 tracking-tight">Staff Mobile Portal</h1>
            <p class="text-xs text-slate-500 max-w-xs mx-auto">
              Sign in with your credentials issued by the Warehouse Manager
            </p>
          </div>

          <!-- Login Form -->
          <form id="mobile-login-form" class="space-y-3 bg-white p-5 rounded-3xl border border-slate-200 shadow-sm">
            <div>
              <label class="block text-xs font-bold text-slate-700 mb-1">Username or Mobile Phone</label>
              <input type="text" id="login-username" required placeholder="e.g. ali_toor" value="ali_toor" class="w-full px-3.5 py-2.5 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:border-[#138FCB] outline-none font-medium">
            </div>

            <div>
              <label class="block text-xs font-bold text-slate-700 mb-1">4-Digit Security PIN</label>
              <input type="password" id="login-pin" required maxlength="6" placeholder="••••" value="1111" class="w-full px-3.5 py-2.5 text-sm font-bold bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:border-[#138FCB] outline-none font-mono tracking-widest text-center">
            </div>

            <button type="submit" class="w-full py-3 bg-[#138FCB] hover:bg-[#0E78AC] text-white rounded-xl text-xs font-bold shadow-md shadow-blue-500/20 transition-all cursor-pointer active:scale-98">
              Sign In to Fetch Tasks
            </button>
          </form>

          <!-- Quick Demo Logins for Instant Testing -->
          <div class="space-y-2 pt-2">
            <span class="text-[10px] font-bold text-slate-400 uppercase tracking-wider block text-center">Tap to Test Staff Accounts</span>
            
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <button class="quick-login-btn p-2.5 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded-xl flex items-center justify-between cursor-pointer transition-colors text-left" data-user="ali_toor" data-pin="1111">
                <div class="flex items-center gap-2">
                  <span class="text-sm">📦</span>
                  <div>
                    <strong class="text-xs text-blue-900 block font-bold">Ali Toor</strong>
                    <span class="text-[9px] text-blue-700 font-semibold">Warehouse Staff</span>
                  </div>
                </div>
                <span class="text-[10px] font-bold text-[#138FCB]">1111 →</span>
              </button>

              <button class="quick-login-btn p-2.5 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded-xl flex items-center justify-between cursor-pointer transition-colors text-left" data-user="ali_chhota" data-pin="2222">
                <div class="flex items-center gap-2">
                  <span class="text-sm">📦</span>
                  <div>
                    <strong class="text-xs text-blue-900 block font-bold">Ali Chhota</strong>
                    <span class="text-[9px] text-blue-700 font-semibold">Warehouse Staff</span>
                  </div>
                </div>
                <span class="text-[10px] font-bold text-[#138FCB]">2222 →</span>
              </button>

              <button class="quick-login-btn p-2.5 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded-xl flex items-center justify-between cursor-pointer transition-colors text-left" data-user="zain" data-pin="3333">
                <div class="flex items-center gap-2">
                  <span class="text-sm">📦</span>
                  <div>
                    <strong class="text-xs text-blue-900 block font-bold">Zain</strong>
                    <span class="text-[9px] text-blue-700 font-semibold">Warehouse Staff</span>
                  </div>
                </div>
                <span class="text-[10px] font-bold text-[#138FCB]">3333 →</span>
              </button>

              <button class="quick-login-btn p-2.5 bg-amber-50 hover:bg-amber-100 border border-amber-200 rounded-xl flex items-center justify-between cursor-pointer transition-colors text-left" data-user="mudassar_office" data-pin="5678">
                <div class="flex items-center gap-2">
                  <span class="text-sm">🏢</span>
                  <div>
                    <strong class="text-xs text-amber-900 block font-bold">Mudassar</strong>
                    <span class="text-[9px] text-amber-700 font-semibold">Office Staff</span>
                  </div>
                </div>
                <span class="text-[10px] font-bold text-amber-800">5678 →</span>
              </button>
            </div>
          </div>
        </div>

        <div class="text-center text-[10px] text-slate-400 pb-2">
          JS Traders ERP • Mobile Warehouse App v1.0
        </div>
      </div>
    `;

    // Form submission
    const form = document.getElementById('mobile-login-form');
    if (form) {
      form.onsubmit = (e) => {
        e.preventDefault();
        const username = document.getElementById('login-username').value;
        const pin = document.getElementById('login-pin').value;
        try {
          this.currentStaff = staffAuthService.login(username, pin);
          this.seedExistingNotificationIds();
          this.showToast(`Welcome back, ${this.currentStaff.fullName}!`, 'success');
          this.renderAppShell();
        } catch (err) {
          this.showToast(err.message, 'error');
        }
      };
    }

    // Quick demo buttons
    document.querySelectorAll('.quick-login-btn').forEach(btn => {
      btn.onclick = () => {
        const u = btn.getAttribute('data-user');
        const p = btn.getAttribute('data-pin');
        try {
          this.currentStaff = staffAuthService.login(u, p);
          this.seedExistingNotificationIds();
          this.showToast(`Logged in as ${this.currentStaff.fullName}`, 'success');
          this.renderAppShell();
        } catch (err) {
          this.showToast(err.message, 'error');
        }
      };
    });
  }

  // ----------------------------------------------------------------------
  // TASKS TAB (Pick List)
  // ----------------------------------------------------------------------
  renderTasksTab() {
    const isOffice = this.currentStaff.staffType === 'office_staff';
    const allAssigned = gatepassService.getGatepassesForStaff(this.currentStaff.id);

    // Filter relevant tasks: only show gatepasses where staff station has inventory > 0
    const tasks = allAssigned.filter(gp => {
      return (gp.lines || []).some(l => {
        const qty = isOffice ? (Number(l.officeQty) || 0) : (Number(l.warehouseQty) || 0);
        return qty > 0;
      });
    });

    this.contentEl.innerHTML = `
      <div class="space-y-4 animate-in fade-in duration-150">
        <!-- Staff Role Context Banner -->
        <div class="p-3.5 rounded-2xl ${isOffice ? 'bg-amber-500 text-white' : 'bg-slate-900 text-white'} flex items-center justify-between shadow-xs">
          <div class="flex items-center gap-2.5">
            <div class="w-8 h-8 rounded-xl ${isOffice ? 'bg-white/20' : 'bg-blue-500/20 text-[#138FCB]'} flex items-center justify-center font-bold text-sm">
              ${isOffice ? '🏢' : '📦'}
            </div>
            <div>
              <span class="text-[10px] uppercase font-bold tracking-wider opacity-80">Active Assignment Scope</span>
              <h3 class="text-xs font-black tracking-tight">${isOffice ? 'Office Inventory Fetch' : 'Warehouse Main Fetch'}</h3>
            </div>
          </div>
          <span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-white/20">
            ${tasks.length} Task(s)
          </span>
        </div>

        <!-- Tasks List -->
        <div class="space-y-3">
          <h3 class="text-xs font-bold text-slate-700 px-1">Assigned Gatepass Outward Dispatches</h3>

          ${tasks.length === 0 ? `
            <div class="p-8 bg-white border border-slate-200 rounded-3xl text-center space-y-2">
              <span class="text-3xl block">🎉</span>
              <strong class="text-xs font-bold text-slate-800 block">No Pending Fetch Tasks</strong>
              <p class="text-[11px] text-slate-400">
                You currently have no gatepasses assigned. New assignments from the Warehouse Manager will notify you automatically.
              </p>
            </div>
          ` : tasks.map(gp => {
            const hasSubmitted = (gp.staffProofs || []).some(p => p.staffId === this.currentStaff.id);
            const isApproved = gp.status === 'Approved - Ready to Deliver';

            // Calculate item counts to fetch
            let totalFetchQty = 0;
            let lineCount = 0;
            (gp.lines || []).forEach(l => {
              const qty = isOffice ? (Number(l.officeQty) || 0) : (Number(l.warehouseQty) || 0);
              if (qty > 0) {
                totalFetchQty += qty;
                lineCount++;
              }
            });

            return `
              <div class="gatepass-card p-4 bg-white border border-slate-200 rounded-2xl shadow-xs hover:border-[#138FCB] cursor-pointer transition-all active:scale-[0.99] space-y-3" data-id="${gp.id}">
                <div class="flex items-center justify-between">
                  <div>
                    <span class="font-bold text-xs text-slate-900">${gp.gatepassNumber}</span>
                    <span class="text-[10px] text-slate-400 block">${gp.date}</span>
                  </div>
                  <span class="px-2.5 py-0.5 rounded-full text-[10px] font-bold ${
                    isApproved ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' :
                    hasSubmitted ? 'bg-purple-50 text-purple-700 border border-purple-200' :
                    'bg-amber-50 text-amber-800 border border-amber-200'
                  }">
                    ${isApproved ? '✓ Ready to Deliver' : (hasSubmitted ? '✓ Photos Submitted' : 'Pending Pick')}
                  </span>
                </div>

                <!-- Scope Quota Highlight -->
                <div class="p-2.5 rounded-xl ${isOffice ? 'bg-amber-50 border border-amber-100' : 'bg-blue-50 border border-blue-100'} flex items-center justify-between text-xs">
                  <span class="font-semibold text-slate-700">
                    ${isOffice ? '🏢 Items to fetch from Office:' : '📦 Items to fetch from Warehouse:'}
                  </span>
                  <strong class="font-black ${isOffice ? 'text-amber-800' : 'text-blue-700'}">
                    ${totalFetchQty} PCS (${lineCount} items)
                  </strong>
                </div>

                <div class="flex items-center justify-between pt-1 border-t border-slate-100 text-[11px] text-slate-500">
                  <span>Carrier: <strong>${gp.vehicleNumber || 'Standard Delivery'}</strong></span>
                  <span class="font-bold text-[#138FCB] flex items-center gap-1">
                    Open & Verify →
                  </span>
                </div>
              </div>
            `;
          }).join('')}
        </div>
      </div>
    `;

    // Click card to open detail
    this.contentEl.querySelectorAll('.gatepass-card').forEach(card => {
      card.onclick = () => {
        const id = card.getAttribute('data-id');
        this.selectedGatepassId = id;
        this.capturedPhotos = [];
        this.renderGatepassDetail(id);
      };
    });
  }

  // ----------------------------------------------------------------------
  // GATEPASS DETAIL & PHOTO UPLOAD VIEW
  // ----------------------------------------------------------------------
  renderGatepassDetail(gatepassId) {
    const gp = gatepassService.getGatepassById(gatepassId);
    if (!gp) {
      this.selectedGatepassId = null;
      this.renderTasksTab();
      return;
    }

    const isOffice = this.currentStaff.staffType === 'office_staff';
    const variants = productService.getVariants();
    const varMap = new Map(variants.map(v => [v.id, v.name]));

    // Staff sees ONLY the products and quantity they need to arrange
    const relevantLines = (gp.lines || []).filter(l => {
      const q = isOffice ? (Number(l.officeQty) || 0) : (Number(l.warehouseQty) || 0);
      return q > 0;
    });

    const totalFetchQty = relevantLines.reduce((sum, l) => {
      const q = isOffice ? (Number(l.officeQty) || 0) : (Number(l.warehouseQty) || 0);
      return sum + q;
    }, 0);

    const existingProof = (gp.staffProofs || []).find(p => p.staffId === this.currentStaff.id);
    const hasSubmitted = !!existingProof;
    const isApproved = gp.status === 'Approved - Ready to Deliver';

    this.contentEl.innerHTML = `
      <div class="space-y-4 animate-in fade-in duration-150 pb-6">
        <!-- Back Navigation Button -->
        <button id="back-to-tasks-btn" class="flex items-center gap-1.5 text-xs font-bold text-slate-600 hover:text-slate-900 cursor-pointer">
          <span>←</span> Back to My Tasks
        </button>

        <!-- Top Header Card -->
        <div class="p-4 bg-white border border-slate-200 rounded-3xl shadow-xs space-y-2.5">
          <div class="flex items-center justify-between">
            <span class="font-black text-sm text-[#138FCB]">${gp.gatepassNumber}</span>
            <span class="px-2.5 py-0.5 rounded-full text-[10px] font-bold ${
              isApproved ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' :
              hasSubmitted ? 'bg-purple-50 text-purple-700 border border-purple-200' :
              'bg-amber-50 text-amber-700 border border-amber-200'
            }">
              ${isApproved ? '✓ Ready to Deliver' : (hasSubmitted ? '✓ Photos Submitted' : 'Pending Pick')}
            </span>
          </div>

          <div class="text-xs text-slate-600 space-y-1">
            <p>Vehicle: <strong>${gp.vehicleNumber || 'Standard Transport'}</strong></p>
            <p>Driver: ${gp.driverName || 'Rasheed'} (${gp.driverPhone || '0345-6789012'})</p>
          </div>

          <!-- Station Banner -->
          <div class="p-2.5 rounded-xl ${isOffice ? 'bg-amber-50 border border-amber-200 text-amber-900' : 'bg-blue-50 border border-blue-200 text-blue-900'} text-xs font-bold flex items-center justify-between">
            <span>${isOffice ? `🏢 Office Fetch (${relevantLines.length} item${relevantLines.length > 1 ? 's' : ''})` : `📦 Warehouse Fetch (${relevantLines.length} item${relevantLines.length > 1 ? 's' : ''})`}</span>
            <span class="text-[10px] bg-white/80 px-2 py-0.5 rounded-md font-extrabold shadow-2xs">${totalFetchQty} PCS to Arrange</span>
          </div>
        </div>

        <!-- Pick Items List -->
        <div class="space-y-2">
          ${relevantLines.length === 0 ? `
            <div class="p-6 bg-white border border-slate-200 rounded-2xl text-center text-xs text-slate-500">
              No items to arrange from your station for this gatepass.
            </div>
          ` : `
            <div class="flex items-center justify-between px-1">
              <h4 class="text-xs font-bold text-slate-800">Products to Arrange &amp; Inspect</h4>
              <span class="text-[10px] font-bold ${isOffice ? 'text-amber-800' : 'text-blue-700'}">
                ${relevantLines.length} product(s) • ${totalFetchQty} PCS
              </span>
            </div>

            <div class="space-y-2">
              ${relevantLines.map((line, idx) => {
                const fetchQty = isOffice ? Number(line.officeQty) : Number(line.warehouseQty);
                const name = varMap.get(line.variantId) || 'Poultry Equipment';

                return `
                  <div class="p-3.5 bg-white border border-slate-200 rounded-2xl flex items-center justify-between gap-3 shadow-2xs">
                    <div class="flex items-center gap-3">
                      <input type="checkbox" id="check-item-${idx}" class="w-5 h-5 rounded-lg text-[#138FCB] focus:ring-0 cursor-pointer">
                      <div>
                        <strong class="text-xs font-bold text-slate-900 block leading-snug">${name}</strong>
                        <span class="text-[10px] text-slate-500 font-medium">
                          Location: ${isOffice ? '🏢 Office Shelf' : '📦 Warehouse Yard / Racks'}
                        </span>
                      </div>
                    </div>
                    <div class="text-right">
                      <span class="text-xs font-black ${isOffice ? 'text-amber-800 bg-amber-50 border border-amber-200' : 'text-blue-700 bg-blue-50 border border-blue-200'} px-2.5 py-1 rounded-xl inline-block">
                        ${fetchQty} ${line.unit || 'PCS'}
                      </span>
                    </div>
                  </div>
                `;
              }).join('')}
            </div>
          `}
        </div>

        <!-- Proof Photos Section -->
        <div class="p-4 bg-white border border-slate-200 rounded-3xl shadow-xs space-y-3">
          <div class="flex items-center justify-between">
            <div>
              <h4 class="text-xs font-bold text-slate-900">Equipment Verification Photos</h4>
              <p class="text-[10px] text-slate-400">Capture or upload pictures before dispatch</p>
            </div>
            <span class="text-[10px] font-bold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full">
              Canvas Auto-Compressed
            </span>
          </div>

          <!-- Camera & Gallery Trigger Buttons -->
          <div class="grid grid-cols-2 gap-2 pt-1">
            <button id="trigger-camera-btn" class="py-2.5 px-3 bg-[#138FCB] hover:bg-[#0E78AC] text-white rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 cursor-pointer shadow-xs active:scale-98">
              <span>📸</span>
              <span>Take Photo</span>
            </button>
            <button id="trigger-gallery-btn" class="py-2.5 px-3 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 cursor-pointer active:scale-98">
              <span>🖼</span>
              <span>Choose Photos</span>
            </button>
          </div>

          <!-- Hidden Native File Inputs -->
          <input type="file" id="camera-native-input" accept="image/*" capture="environment" class="hidden">
          <input type="file" id="gallery-native-input" accept="image/*" multiple class="hidden">

          <!-- Compression In-Progress Spinner -->
          <div id="compression-spinner" class="hidden p-3 bg-blue-50 border border-blue-100 rounded-xl text-center text-xs text-blue-800 font-bold space-x-2">
            <span class="inline-block animate-spin">⚙</span>
            <span>Optimizing and compressing image...</span>
          </div>

          <!-- Photos Preview Grid -->
          <div id="photos-preview-grid" class="grid grid-cols-3 gap-2 pt-1">
            <!-- Dynamically rendered -->
          </div>

          <!-- Previous Submissions (if already submitted) -->
          ${hasSubmitted ? `
            <div class="p-3 bg-purple-50 border border-purple-200 rounded-2xl space-y-2 mt-2">
              <div class="flex items-center justify-between">
                <span class="text-[11px] font-bold text-purple-900">✓ Submitted to Warehouse Manager</span>
                <span class="text-[10px] text-purple-600 font-medium">
                  ${existingProof.submittedAt ? new Date(existingProof.submittedAt).toLocaleTimeString() : ''}
                </span>
              </div>
              <div class="grid grid-cols-3 gap-2">
                ${(existingProof.photos || []).map(p => `
                  <div class="rounded-xl overflow-hidden aspect-square border border-purple-200">
                    <img src="${p.dataUrl}" class="w-full h-full object-cover">
                  </div>
                `).join('')}
              </div>
            </div>
          ` : ''}

          <!-- Submit Button -->
          <button id="submit-proof-btn" class="w-full py-3 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold shadow-md shadow-emerald-600/20 transition-all cursor-pointer active:scale-98">
            ${hasSubmitted ? 'Upload Additional Photos' : 'Submit Verification & Photos'}
          </button>
        </div>
      </div>
    `;

    // Bind event listeners for this gatepass detail view
    document.getElementById('back-to-tasks-btn').onclick = () => {
      this.selectedGatepassId = null;
      this.renderTasksTab();
    };

    const cameraBtn = document.getElementById('trigger-camera-btn');
    const galleryBtn = document.getElementById('trigger-gallery-btn');
    const cameraInput = document.getElementById('camera-native-input');
    const galleryInput = document.getElementById('gallery-native-input');
    const submitBtn = document.getElementById('submit-proof-btn');

    cameraBtn.onclick = () => cameraInput.click();
    galleryBtn.onclick = () => galleryInput.click();

    cameraInput.onchange = (e) => this.handleImageSelect(e.target.files);
    galleryInput.onchange = (e) => this.handleImageSelect(e.target.files);

    submitBtn.onclick = () => this.handleProofSubmit(gp.id);
  }

  // Handle image files and apply client-side Canvas compression
  async handleImageSelect(fileList) {
    if (!fileList || fileList.length === 0) return;
    const spinner = document.getElementById('compression-spinner');
    if (spinner) spinner.classList.remove('hidden');

    try {
      for (const file of Array.from(fileList)) {
        if (file.type.startsWith('image/')) {
          // Compress on-device via HTML5 Canvas
          const compressed = await ImageCompressor.compress(file, {
            maxWidth: 1024,
            maxHeight: 1024,
            quality: 0.7
          });
          this.capturedPhotos.push(compressed);
        }
      }
      this.renderPhotoPreviews();
      this.showToast(`Photo compressed successfully!`, 'success');
    } catch (err) {
      console.error(err);
      this.showToast('Failed to compress image: ' + err.message, 'error');
    } finally {
      if (spinner) spinner.classList.add('hidden');
    }
  }

  renderPhotoPreviews() {
    const grid = document.getElementById('photos-preview-grid');
    if (!grid) return;

    if (this.capturedPhotos.length === 0) {
      grid.innerHTML = '';
      return;
    }

    grid.innerHTML = this.capturedPhotos.map((photo, idx) => `
      <div class="relative group rounded-xl overflow-hidden aspect-square border border-slate-200 bg-slate-100">
        <img src="${photo.dataUrl}" class="w-full h-full object-cover">
        <div class="absolute bottom-0 inset-x-0 bg-black/70 text-white text-[9px] font-bold px-1 py-0.5 text-center truncate">
          ${photo.sizeKb} KB
        </div>
        <button class="remove-photo-btn absolute top-1 right-1 w-5 h-5 bg-rose-600 text-white rounded-full flex items-center justify-center text-[10px] font-bold shadow-sm cursor-pointer" data-idx="${idx}">
          ✕
        </button>
      </div>
    `).join('');

    // Bind remove buttons
    grid.querySelectorAll('.remove-photo-btn').forEach(btn => {
      btn.onclick = (e) => {
        const idx = Number(e.currentTarget.getAttribute('data-idx'));
        this.capturedPhotos.splice(idx, 1);
        this.renderPhotoPreviews();
      };
    });
  }

  handleProofSubmit(gatepassId) {
    if (this.capturedPhotos.length === 0) {
      this.showToast('Please capture or upload at least one verification photo.', 'warning');
      return;
    }

    try {
      gatepassService.submitStaffProof(gatepassId, this.currentStaff.id, this.capturedPhotos);
      this.showToast('Proof submitted! Warehouse Manager has been notified.', 'success');
      this.capturedPhotos = [];
      this.renderGatepassDetail(gatepassId);
    } catch (err) {
      this.showToast('Error submitting proof: ' + err.message, 'error');
    }
  }

  // ----------------------------------------------------------------------
  // NOTIFICATIONS TAB
  // ----------------------------------------------------------------------
  renderNotificationsTab() {
    const allNotifs = storageService.getCollection('staffNotifications') || [];
    const myNotifs = allNotifs
      .filter(n => n.staffId === this.currentStaff.id)
      .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));

    const totalCount = myNotifs.length;
    const unreadCount = myNotifs.filter(n => !n.isRead).length;

    // Determine pending pick vs submitted
    const pendingNotifs = myNotifs.filter(n => {
      const gp = gatepassService.getGatepassById(n.gatepassId);
      if (!gp) return false;
      return !(gp.staffProofs || []).some(p => p.staffId === this.currentStaff.id);
    });
    const pendingCount = pendingNotifs.length;
    const verifiedCount = totalCount - pendingCount;

    // Apply active filter
    let displayedNotifs = myNotifs;
    if (this.notifFilter === 'unread') {
      displayedNotifs = myNotifs.filter(n => !n.isRead);
    } else if (this.notifFilter === 'urgent') {
      displayedNotifs = pendingNotifs;
    }

    this.contentEl.innerHTML = `
      <div class="space-y-4 animate-in fade-in duration-150 pb-6">
        <!-- Live Sync & Sound Bar -->
        <div class="bg-slate-900 text-white p-3.5 rounded-2xl flex items-center justify-between shadow-xs">
          <div class="flex items-center gap-2">
            <span class="relative flex h-2.5 w-2.5">
              <span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
              <span class="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500"></span>
            </span>
            <div>
              <span class="text-[10px] uppercase font-bold tracking-wider text-emerald-400 block leading-none">Live Connected</span>
              <span class="text-xs font-bold text-slate-200">Zero-Refresh Alerts Active</span>
            </div>
          </div>
          <button id="alert-sound-test-btn" class="px-3 py-1.5 bg-white/10 hover:bg-white/20 active:scale-95 text-white rounded-xl text-xs font-bold transition-all border border-white/15 flex items-center gap-1.5 cursor-pointer">
            <span>🔊</span>
            <span>Test Siren</span>
          </button>
        </div>

        <!-- System Notification Permission Banner -->
        ${('Notification' in window && Notification.permission !== 'granted') ? `
          <div class="bg-gradient-to-r from-blue-600 to-indigo-700 text-white p-3.5 rounded-2xl shadow-sm space-y-2">
            <div class="flex items-center justify-between">
              <div class="flex items-center gap-2 font-bold text-xs">
                <span class="text-base">🔔</span>
                <span>Enable Phone Lock-screen Alerts</span>
              </div>
              <span class="text-[10px] bg-white/20 px-2 py-0.5 rounded-full font-bold">Recommended</span>
            </div>
            <p class="text-[11px] leading-relaxed text-blue-100">
              Allows the app to ring and show alert banners even when minimized or when your phone is locked.
            </p>
            <button id="enable-sys-notifs-btn" class="w-full py-2 bg-white text-[#138FCB] rounded-xl text-xs font-bold hover:bg-blue-50 transition-colors shadow-xs cursor-pointer active:scale-98">
              🔔 Allow System Notifications
            </button>
          </div>
        ` : `
          <div class="bg-emerald-50 border border-emerald-200 text-emerald-800 px-3 py-2 rounded-xl text-xs font-semibold flex items-center justify-between">
            <span class="flex items-center gap-1.5">
              <span>🔔</span>
              <span>Lock-Screen Alerts: <strong>Active &amp; Sound Armed</strong></span>
            </span>
            <span class="text-[10px] font-bold bg-white text-emerald-700 px-2 py-0.5 rounded-md border border-emerald-200 shadow-2xs">
              System ON
            </span>
          </div>
        `}

        <!-- Metric Stat Strip -->
        <div class="grid grid-cols-3 gap-2">
          <div class="bg-white border border-slate-200 rounded-2xl p-3 text-center shadow-2xs">
            <span class="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Total</span>
            <strong class="text-base font-black text-slate-900">${totalCount}</strong>
          </div>
          <div class="bg-white border border-amber-200 bg-amber-50/40 rounded-2xl p-3 text-center shadow-2xs">
            <span class="text-[10px] font-bold text-amber-700 uppercase tracking-wider block">Pending</span>
            <strong class="text-base font-black text-amber-700">${pendingCount}</strong>
          </div>
          <div class="bg-white border border-emerald-200 bg-emerald-50/40 rounded-2xl p-3 text-center shadow-2xs">
            <span class="text-[10px] font-bold text-emerald-700 uppercase tracking-wider block">Verified</span>
            <strong class="text-base font-black text-emerald-700">${verifiedCount}</strong>
          </div>
        </div>

        <!-- Filter Pills Strip -->
        <div class="flex items-center gap-1.5 overflow-x-auto pb-1">
          <button class="notif-filter-btn px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${this.notifFilter === 'all' ? 'bg-[#138FCB] text-white shadow-xs' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}" data-filter="all">
            All Alerts (${totalCount})
          </button>
          <button class="notif-filter-btn px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${this.notifFilter === 'urgent' ? 'bg-amber-600 text-white shadow-xs' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}" data-filter="urgent">
            🚨 Action Required (${pendingCount})
          </button>
          <button class="notif-filter-btn px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${this.notifFilter === 'unread' ? 'bg-[#138FCB] text-white shadow-xs' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}" data-filter="unread">
            Unread (${unreadCount})
          </button>
        </div>

        <!-- Notifications List -->
        <div class="space-y-3">
          ${displayedNotifs.length === 0 ? `
            <div class="p-8 bg-white border border-slate-200 rounded-3xl text-center space-y-2.5 shadow-2xs">
              <span class="text-3xl block">🎉</span>
              <strong class="text-xs font-bold text-slate-800 block">No Alerts in this view</strong>
              <p class="text-[11px] text-slate-400 max-w-xs mx-auto">
                ${this.notifFilter === 'urgent' 
                  ? 'All assigned gatepasses have verified photos submitted!' 
                  : 'New dispatch assignments from the Warehouse Manager will notify you immediately with sound.'}
              </p>
            </div>
          ` : displayedNotifs.map(n => {
            const gp = gatepassService.getGatepassById(n.gatepassId);
            const isOffice = this.currentStaff.staffType === 'office_staff';
            const hasSubmitted = gp && (gp.staffProofs || []).some(p => p.staffId === this.currentStaff.id);
            const isApproved = gp && gp.status === 'Approved - Ready to Deliver';

            return `
              <div class="notif-item p-4 bg-white border border-slate-200 rounded-2xl shadow-2xs hover:border-[#138FCB] transition-all space-y-2.5 active:scale-[0.99]" data-gpid="${n.gatepassId}">
                <!-- Top Badge & Time -->
                <div class="flex items-center justify-between">
                  <div class="flex items-center gap-1.5">
                    <span class="px-2 py-0.5 rounded-md text-[10px] font-bold ${
                      isApproved ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' :
                      hasSubmitted ? 'bg-purple-50 text-purple-700 border border-purple-200' :
                      'bg-rose-50 text-rose-700 border border-rose-200 animate-pulse'
                    }">
                      ${isApproved ? '✓ Ready to Deliver' : (hasSubmitted ? '✓ Photo Submitted' : '🚨 Urgent Action Required')}
                    </span>
                    <span class="px-2 py-0.5 rounded-md text-[10px] font-bold bg-blue-50 text-[#138FCB] border border-blue-100">
                      ${n.gatepassNumber || 'GP'}
                    </span>
                  </div>
                  <span class="text-[10px] text-slate-400 font-medium">
                    ${n.createdAt ? new Date(n.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Now'}
                  </span>
                </div>

                <!-- Title & Body -->
                <div>
                  <strong class="text-xs font-bold text-slate-900 block">${n.title}</strong>
                  <p class="text-xs text-slate-600 mt-0.5 leading-relaxed">${n.message}</p>
                </div>

                <!-- Action Button -->
                <div class="pt-1 border-t border-slate-100 flex items-center justify-between">
                  <span class="text-[10px] text-slate-400">
                    Carrier: <strong>${gp?.vehicleNumber || 'Standard'}</strong>
                  </span>
                  <button class="open-task-btn px-3 py-1.5 bg-[#138FCB] hover:bg-[#0E78AC] text-white text-xs font-bold rounded-xl shadow-xs transition-colors flex items-center gap-1.5 cursor-pointer active:scale-95" data-gpid="${n.gatepassId}">
                    <span>📸</span>
                    <span>Open Task & Take Photo →</span>
                  </button>
                </div>
              </div>
            `;
          }).join('')}
        </div>

        <!-- Bottom Guidance Card -->
        <div class="p-3.5 bg-slate-50 border border-slate-200 rounded-2xl text-[11px] text-slate-500 space-y-1">
          <strong class="text-slate-700 block font-bold">💡 How Live Alerts Work</strong>
          <p>
            When the Warehouse Manager issues a Gatepass Outward on the computer, this phone rings a loud warehouse siren instantly without needing to refresh.
          </p>
        </div>
      </div>
    `;

    // Mark unread as read
    myNotifs.forEach(n => {
      if (!n.isRead) {
        storageService.update('staffNotifications', n.id, { isRead: true });
      }
    });
    this.updateNotifBadge();

    // Bind Filter Pills
    this.contentEl.querySelectorAll('.notif-filter-btn').forEach(btn => {
      btn.onclick = () => {
        this.notifFilter = btn.getAttribute('data-filter');
        this.renderNotificationsTab();
      };
    });

    // Bind Sound Test Button
    const sirenBtn = this.contentEl.querySelector('#alert-sound-test-btn');
    if (sirenBtn) {
      sirenBtn.onclick = (e) => {
        e.stopPropagation();
        soundAlert.unlock();
        soundAlert.playLoudAlert();
        if (navigator.vibrate) navigator.vibrate([200, 100, 200, 100, 400]);
        this.showToast('🔊 Playing Loud Warehouse Alarm & Vibration', 'info');
      };
    }

    // Bind System Notification Enable Button
    const enableNotifBtn = this.contentEl.querySelector('#enable-sys-notifs-btn');
    if (enableNotifBtn) {
      enableNotifBtn.onclick = async (e) => {
        e.stopPropagation();
        await this.requestSystemNotificationPermission();
      };
    }

    // Bind Task Click Handlers
    this.contentEl.querySelectorAll('.notif-item, .open-task-btn').forEach(el => {
      el.onclick = (e) => {
        if (e.target.closest('#alert-sound-test-btn')) return;
        const gpId = el.getAttribute('data-gpid');
        if (gpId) {
          soundAlert.unlock();
          this.activeTab = 'tasks';
          this.selectedGatepassId = gpId;
          this.capturedPhotos = [];
          this.renderGatepassDetail(gpId);
        }
      };
    });
  }

  // ----------------------------------------------------------------------
  // PROFILE TAB
  // ----------------------------------------------------------------------
  renderProfileTab() {
    const isOffice = this.currentStaff.staffType === 'office_staff';

    this.contentEl.innerHTML = `
      <div class="space-y-4 animate-in fade-in duration-150 py-2">
        <div class="p-5 bg-white border border-slate-200 rounded-3xl shadow-xs text-center space-y-3">
          <div class="w-16 h-16 rounded-full ${isOffice ? 'bg-amber-100 text-amber-800' : 'bg-blue-100 text-[#138FCB]'} flex items-center justify-center text-2xl mx-auto font-bold">
            ${isOffice ? '🏢' : '📦'}
          </div>

          <div>
            <h3 class="text-base font-extrabold text-slate-900">${this.currentStaff.fullName}</h3>
            <p class="text-xs text-slate-400 font-mono">@${this.currentStaff.username}</p>
          </div>

          <div class="inline-block px-3 py-1 rounded-full text-xs font-bold ${isOffice ? 'bg-amber-50 text-amber-800 border border-amber-200' : 'bg-blue-50 text-blue-800 border border-blue-200'}">
            ${isOffice ? '🏢 Office Inventory Staff' : '📦 Warehouse Staff'}
          </div>

          <div class="pt-3 border-t border-slate-100 text-left text-xs space-y-2 text-slate-600 font-medium">
            <div class="flex justify-between">
              <span class="text-slate-400">Phone:</span>
              <strong class="text-slate-800">${this.currentStaff.phone || 'Not provided'}</strong>
            </div>
            <div class="flex justify-between">
              <span class="text-slate-400">Primary Location:</span>
              <strong class="text-slate-800">${isOffice ? 'Commercial Office' : 'Main Warehouse'}</strong>
            </div>
            <div class="flex justify-between">
              <span class="text-slate-400">Scope:</span>
              <strong class="text-slate-800">${isOffice ? 'Office Items Only' : 'All Gatepass Cargo'}</strong>
            </div>
          </div>
        </div>

        <button id="profile-logout-btn" class="w-full py-3 bg-rose-50 hover:bg-rose-100 text-rose-600 border border-rose-200 rounded-2xl text-xs font-bold transition-colors cursor-pointer active:scale-98">
          Sign Out of Mobile App
        </button>
      </div>
    `;

    document.getElementById('profile-logout-btn').onclick = () => {
      staffAuthService.logout();
      this.currentStaff = null;
      this.renderLoginScreen();
    };
  }

  // ----------------------------------------------------------------------
  // TOAST NOTIFICATIONS
  // ----------------------------------------------------------------------
  showToast(message, type = 'info') {
    const container = document.getElementById('mobile-toast-container');
    if (!container) return;

    const toast = document.createElement('div');
    const color = type === 'success' ? 'bg-emerald-600 text-white' : (type === 'error' ? 'bg-rose-600 text-white' : 'bg-slate-900 text-white');
    toast.className = `${color} px-4 py-3 rounded-2xl text-xs font-bold shadow-xl flex items-center justify-between animate-in slide-in-from-top-2 duration-150`;
    toast.innerHTML = `
      <span>${message}</span>
      <button class="text-white/80 hover:text-white ml-2 text-sm font-bold cursor-pointer">✕</button>
    `;

    toast.querySelector('button').onclick = () => toast.remove();
    container.appendChild(toast);

    setTimeout(() => {
      toast.classList.add('opacity-0', 'transition-opacity', 'duration-300');
      setTimeout(() => toast.remove(), 300);
    }, 3000);
  }
}

// Initialize on DOM load
document.addEventListener('DOMContentLoaded', () => {
  const app = new MobileStaffApp();
  app.init();
});
