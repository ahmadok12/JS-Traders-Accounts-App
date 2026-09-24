/**
 * JS Traders ERP - Main Application Controller & Router
 * Connects ES modules, left sidebar navigation, top header actions,
 * global keyboard shortcuts, and reactive view rendering.
 */

import { authService } from '../../services/authService.js';
import { storageService } from '../../services/storageService.js';
import { toast } from '../../components/toast.js';
import { openModal, closeModal } from '../../components/modal.js';
import { openDrawer, closeDrawer } from '../../components/drawer.js';
import { openPortalSwitcherModal } from '../../components/portalSwitcherModal.js';
import { openMobileConnectModal } from '../../components/mobileConnectModal.js';
import {
  initUnsavedChangesGuard,
  hasAnyUnsavedData,
  confirmDiscardChanges,
  snapshotFormInitialState
} from '../../components/unsavedChangesGuard.js';

// Module View Imports
import { renderDashboardView, bindDashboardEvents } from '../../modules/dashboard/dashboardView.js';
import { renderCategoriesView, bindCategoriesEvents } from '../../modules/inventory/categoriesView.js';
import { renderProductsView, bindProductsEvents } from '../../modules/inventory/productsView.js';
import { renderVariantsView, bindVariantsEvents } from '../../modules/inventory/variantsView.js';
import { renderStockView, bindStockEvents } from '../../modules/inventory/stockView.js';
import { renderStockAdjustmentsView, bindStockAdjustmentsEvents } from '../../modules/inventory/stockAdjustmentsView.js';
import { renderStockMovementsView, bindStockMovementsEvents } from '../../modules/inventory/stockMovementsView.js';
import { renderAssemblyView, bindAssemblyEvents } from '../../modules/inventory/assemblyView.js';
import { renderRollInventoryView, bindRollInventoryEvents } from '../../modules/inventory/rollInventoryView.js';

import { renderGatepassView, bindGatepassEvents } from '../../modules/warehouse/gatepassView.js';
import { renderDeliveryView, bindDeliveryEvents } from '../../modules/warehouse/deliveryView.js';
import { renderWarehousesView, bindWarehousesEvents } from '../../modules/warehouse/warehousesView.js';
import { renderLocationsView, bindLocationsEvents } from '../../modules/warehouse/locationsView.js';
import { renderStockByWarehouseView, bindStockByWarehouseEvents } from '../../modules/warehouse/stockByWarehouseView.js';
import { renderStaffManagementView, bindStaffManagementEvents } from '../../modules/warehouse/staffManagementView.js';
import { renderInwardOrdersView, bindInwardOrdersEvents } from '../../modules/warehouse/inwardOrdersView.js';

import { renderCustomersView, bindCustomersEvents } from '../../modules/sales/customersView.js';
import { renderSalesOrdersView, bindSalesOrdersEvents } from '../../modules/sales/salesOrdersView.js';
import { renderSalespersonPortalView, bindSalespersonPortalEvents } from '../../modules/sales/salespersonPortalView.js';
import { renderInvoicesView, bindInvoicesEvents } from '../../modules/sales/invoicesView.js';

import { renderImportShipmentsView, bindImportShipmentsEvents } from '../../modules/purchasing/importShipmentsView.js';
import { renderLandedCostView, bindLandedCostEvents } from '../../modules/purchasing/landedCostView.js';
import { renderPurchaseBillsView, bindPurchaseBillsEvents } from '../../modules/purchasing/purchaseBillsView.js';
import { renderSuppliersView, bindSuppliersEvents } from '../../modules/purchasing/suppliersView.js';

import { renderChartOfAccountsView, bindChartOfAccountsEvents } from '../../modules/accounting/chartOfAccountsView.js';
import { renderJournalEntriesView, bindJournalEntriesEvents } from '../../modules/accounting/journalEntriesView.js';
import { renderBankingView, bindBankingEvents } from '../../modules/accounting/bankingView.js';

import { renderStandardReportsView, bindStandardReportsEvents } from '../../modules/reports/standardReportsView.js';
import { renderReportBuilderView, bindReportBuilderEvents } from '../../modules/reports/reportBuilderView.js';
import { renderTemplateCustomizerView, bindTemplateCustomizerEvents } from '../../modules/invoice-templates/templateCustomizerView.js';
import { renderSettingsView, bindSettingsEvents } from '../../modules/settings/settingsView.js';

class AppController {
  constructor() {
    this.currentRoute = 'dashboard';
    this.mainWorkspace = null;
    this.breadcrumbContainer = null;
    this.isRendering = false;
    this.renderScheduled = false;
  }

  scheduleRender() {
    if (this.renderScheduled) return;
    this.renderScheduled = true;
    const raf = typeof requestAnimationFrame !== 'undefined' ? requestAnimationFrame : setTimeout;
    raf(() => {
      this.renderScheduled = false;
      this.renderCurrentRoute();
    }, 16);
  }

  init() {
    this.mainWorkspace = document.getElementById('primary-workspace');
    this.breadcrumbContainer = document.getElementById('header-breadcrumbs');

    this.bindGlobalNavigation();
    this.bindHeaderControls();
    this.bindKeyboardShortcuts();

    // Listen to session & storage changes safely debounced
    authService.onSessionChange(() => {
      this.updateHeaderProfile();
      this.scheduleRender();
    });

    storageService.subscribe('*', () => {
      this.scheduleRender();
    });

    // Hash routing for deep linking and back/forward browser history
    window.addEventListener('hashchange', () => {
      const hashRoute = window.location.hash.replace(/^#\/?/, '');
      if (hashRoute && hashRoute !== this.currentRoute) {
        this.navigateTo(hashRoute, false);
      }
    });

    this.updateHeaderProfile();
    initUnsavedChangesGuard();

    const initialRoute = window.location.hash.replace(/^#\/?/, '') || 'dashboard';
    this.proceedNavigation(initialRoute, false);
  }

  navigateTo(route, updateHash = true) {
    if (this.currentRoute && this.currentRoute !== route && hasAnyUnsavedData()) {
      confirmDiscardChanges({
        title: 'Discard Unsaved Changes?',
        message: 'You have entered data into a form or dialog on this screen. If you leave now, all your unsaved changes will be lost.',
        confirmLabel: 'Discard & Leave',
        cancelLabel: 'Stay on Page',
        onDiscard: () => {
          closeModal(null, true);
          closeDrawer(true);
          this.proceedNavigation(route, updateHash);
        },
        onCancel: () => {
          if (window.location.hash !== `#/${this.currentRoute}`) {
            history.replaceState(null, '', `#/${this.currentRoute}`);
          }
        }
      });
      return;
    }

    this.proceedNavigation(route, updateHash);
  }

  proceedNavigation(route, updateHash = true) {
    this.currentRoute = route;

    if (updateHash && window.location.hash !== `#/${route}`) {
      window.location.hash = `#/${route}`;
    }

    // Update active state in sidebar navigation
    document.querySelectorAll('.nav-link').forEach(link => {
      const linkRoute = link.getAttribute('data-route');
      if (linkRoute === route) {
        link.classList.add('bg-blue-50/80', 'text-[#138FCB]', 'font-bold');
        link.classList.remove('text-[#6F767E]', 'font-medium');
      } else {
        link.classList.remove('bg-blue-50/80', 'text-[#138FCB]', 'font-bold');
        link.classList.add('text-[#6F767E]', 'font-medium');
      }
    });

    this.renderCurrentRoute();
  }

  renderCurrentRoute() {
    if (this.isRendering || !this.mainWorkspace) return;
    this.isRendering = true;

    try {
      let html = '';
      let bindFn = null;
      let breadcrumbs = ['ERP', 'Overview'];

    switch (this.currentRoute) {
      case 'dashboard':
        html = renderDashboardView();
        bindFn = bindDashboardEvents;
        breadcrumbs = ['Dashboard', 'Overview'];
        break;

      // Inventory
      case 'inventory-categories':
        html = renderCategoriesView();
        bindFn = bindCategoriesEvents;
        breadcrumbs = ['Inventory', 'Product Categories'];
        break;
      case 'inventory-products':
        html = renderProductsView();
        bindFn = bindProductsEvents;
        breadcrumbs = ['Inventory', 'Product Master'];
        break;
      case 'inventory-variants':
        html = renderVariantsView();
        bindFn = bindVariantsEvents;
        breadcrumbs = ['Inventory', 'Variants / SKUs'];
        break;
      case 'inventory-stock':
        html = renderStockView();
        bindFn = bindStockEvents;
        breadcrumbs = ['Inventory', 'Current Stock'];
        break;
      case 'inventory-movements':
        html = renderStockMovementsView();
        bindFn = bindStockMovementsEvents;
        breadcrumbs = ['Inventory', 'Stock Movements Ledger'];
        break;
      case 'inventory-adjustments':
        html = renderStockAdjustmentsView();
        bindFn = bindStockAdjustmentsEvents;
        breadcrumbs = ['Inventory', 'Stock Adjustments'];
        break;
      case 'inventory-assembly':
        html = renderAssemblyView('assembly');
        bindFn = bindAssemblyEvents;
        breadcrumbs = ['Manufacturing', 'Assembly Orders'];
        break;
      case 'inventory-disassembly':
        html = renderAssemblyView('disassembly');
        bindFn = bindAssemblyEvents;
        breadcrumbs = ['Manufacturing', 'Disassembly & Breakdown'];
        break;
      case 'inventory-boms':
        html = renderAssemblyView('boms');
        bindFn = bindAssemblyEvents;
        breadcrumbs = ['Manufacturing', 'BOMs & Templates'];
        break;
      case 'inventory-bundles':
        html = renderAssemblyView('bundles');
        bindFn = bindAssemblyEvents;
        breadcrumbs = ['Manufacturing', 'Bundles & Systems'];
        break;
      case 'inventory-rolls':
        window.location.hash = '#/inventory-stock';
        return;

      // Warehouse & Operations Flow
      case 'warehouse-gdn':
        html = renderGatepassView('outward');
        bindFn = (container, cb) => bindGatepassEvents(container, cb, 'outward');
        breadcrumbs = ['Operations', 'GDN (Goods Dispatch Note)'];
        break;
      case 'stock-inwards':
      case 'inward-orders':
        html = renderInwardOrdersView();
        bindFn = bindInwardOrdersEvents;
        breadcrumbs = ['Operations', 'Stock Inwards'];
        break;
      case 'warehouse-grn':
        html = renderGatepassView('inward');
        bindFn = (container, cb) => bindGatepassEvents(container, cb, 'inward');
        breadcrumbs = ['Operations', 'GRN (Good Received Note)'];
        break;
      case 'warehouse-gatepasses':
        html = renderGatepassView();
        bindFn = bindGatepassEvents;
        breadcrumbs = ['Warehouse', 'Gatepasses'];
        break;
      case 'warehouse-deliveries':
        html = renderGatepassView('outward');
        bindFn = (container, cb) => bindGatepassEvents(container, cb, 'outward');
        breadcrumbs = ['Operations', 'GDN (Goods Dispatch Note)'];
        break;
      case 'warehouse-warehouses':
        html = renderWarehousesView();
        bindFn = bindWarehousesEvents;
        breadcrumbs = ['Warehouses', 'Warehouse Facilities'];
        break;
      case 'warehouse-locations':
        html = renderLocationsView();
        bindFn = bindLocationsEvents;
        breadcrumbs = ['Warehouses', 'Storage Locations & Racks'];
        break;
      case 'warehouse-stock-by-wh':
        html = renderStockByWarehouseView();
        bindFn = bindStockByWarehouseEvents;
        breadcrumbs = ['Warehouses', 'Stock by Warehouse'];
        break;
      case 'warehouse-staff':
        html = renderStaffManagementView();
        bindFn = bindStaffManagementEvents;
        breadcrumbs = ['Warehouses', 'Staff & Mobile Access'];
        break;
      case 'inward-orders':
        html = renderInwardOrdersView();
        bindFn = bindInwardOrdersEvents;
        breadcrumbs = ['Operations', 'Stock Inward Orders'];
        break;

      // Sales
      case 'sales-customers':
        html = renderCustomersView();
        bindFn = bindCustomersEvents;
        breadcrumbs = ['Customers', 'Hierarchy & Farms'];
        break;
      case 'sales-orders':
        html = renderSalesOrdersView();
        bindFn = bindSalesOrdersEvents;
        breadcrumbs = ['Sales', 'Sales Orders'];
        break;
      case 'sales-invoices':
        html = renderInvoicesView();
        bindFn = bindInvoicesEvents;
        breadcrumbs = ['Sales', 'Sales Invoices'];
        break;
      case 'salesperson-portal':
        html = renderSalespersonPortalView();
        bindFn = bindSalespersonPortalEvents;
        breadcrumbs = ['Sales Portal', 'Rate Entry'];
        break;

      // Purchasing
      case 'purchasing-shipments':
        html = renderImportShipmentsView();
        bindFn = bindImportShipmentsEvents;
        breadcrumbs = ['Purchasing', 'Import Shipments'];
        break;
      case 'purchasing-landed-cost':
        html = renderLandedCostView();
        bindFn = bindLandedCostEvents;
        breadcrumbs = ['Purchasing', 'Landed Cost Engine'];
        break;
      case 'purchasing-bills':
        html = renderPurchaseBillsView();
        bindFn = bindPurchaseBillsEvents;
        breadcrumbs = ['Purchasing', 'Purchase Bills'];
        break;
      case 'purchasing-suppliers':
        html = renderSuppliersView();
        bindFn = bindSuppliersEvents;
        breadcrumbs = ['Purchasing', 'Suppliers'];
        break;

      // Accounting
      case 'accounting-coa':
        html = renderChartOfAccountsView();
        bindFn = bindChartOfAccountsEvents;
        breadcrumbs = ['Accounting', 'Chart of Accounts'];
        break;
      case 'accounting-journal':
        html = renderJournalEntriesView();
        bindFn = bindJournalEntriesEvents;
        breadcrumbs = ['Accounting', 'Journal Entries'];
        break;
      case 'accounting-banking':
        html = renderBankingView();
        bindFn = bindBankingEvents;
        breadcrumbs = ['Banking', 'Reconciliation'];
        break;

      // Reports
      case 'reports-standard':
        html = renderStandardReportsView();
        bindFn = bindStandardReportsEvents;
        breadcrumbs = ['Reports', 'Standard Reports'];
        break;
      case 'reports-builder':
        html = renderReportBuilderView();
        bindFn = bindReportBuilderEvents;
        breadcrumbs = ['Reports', 'Report Builder'];
        break;

      // Templates & Settings
      case 'invoice-templates':
        html = renderTemplateCustomizerView();
        bindFn = bindTemplateCustomizerEvents;
        breadcrumbs = ['Customizer', 'Invoice Templates'];
        break;
      case 'settings':
        html = renderSettingsView();
        bindFn = bindSettingsEvents;
        breadcrumbs = ['System', 'Settings'];
        break;

      default:
        html = `<div class="p-8 text-center text-slate-400">View not found</div>`;
    }

    this.updateBreadcrumbs(breadcrumbs);
    this.mainWorkspace.innerHTML = html;

    if (bindFn) {
      bindFn(this.mainWorkspace, () => this.scheduleRender());
    }

    requestAnimationFrame(() => {
      snapshotFormInitialState(this.mainWorkspace);
    });
    } finally {
      this.isRendering = false;
    }
  }

  updateBreadcrumbs(crumbs) {
    if (!this.breadcrumbContainer) return;
    this.breadcrumbContainer.innerHTML = crumbs.map((crumb, idx) => `
      <span class="${idx === crumbs.length - 1 ? 'font-semibold text-slate-800' : 'text-slate-400 hover:text-slate-700 cursor-pointer'}">${crumb}</span>
      ${idx < crumbs.length - 1 ? '<span class="text-slate-300">&gt;</span>' : ''}
    `).join('');
  }

  bindGlobalNavigation() {
    document.querySelectorAll('.nav-link').forEach(link => {
      link.onclick = (e) => {
        e.preventDefault();
        const route = link.getAttribute('data-route');
        if (route) {
          this.navigateTo(route);
        }
      };
    });

    // Expandable Menu Groups
    document.querySelectorAll('.nav-group-toggle').forEach(toggle => {
      toggle.onclick = (e) => {
        e.preventDefault();
        const targetId = toggle.getAttribute('data-target');
        const content = document.getElementById(targetId);
        const arrow = toggle.querySelector('.toggle-arrow');
        if (content) {
          content.classList.toggle('hidden');
          if (arrow) {
            arrow.classList.toggle('rotate-180');
          }
        }
      };
    });
  }

  bindHeaderControls() {
    // Role switcher in header
    const roleSelect = document.getElementById('header-role-switcher');
    if (roleSelect) {
      roleSelect.onchange = (e) => {
        authService.switchRole(e.target.value);
        toast.show(`Switched active role to: ${authService.getRoleDisplayName(e.target.value)}`, 'info');
      };
    }

    // Warehouse switcher in header
    const whSelect = document.getElementById('header-wh-switcher');
    if (whSelect) {
      whSelect.onchange = (e) => {
        authService.switchWarehouse(e.target.value);
        toast.show('Switched active warehouse context.', 'info');
      };
    }

    // Notification bell
    const notifBtn = document.getElementById('header-notif-btn');
    if (notifBtn) {
      notifBtn.onclick = () => this.openNotificationDrawer();
    }

    // QR Code modal trigger
    const qrBtn = document.getElementById('header-qr-btn');
    if (qrBtn) {
      qrBtn.onclick = () => openMobileConnectModal('staff');
    }

    // Search input click triggers Command Palette (⌘K)
    const searchBar = document.getElementById('header-search-input');
    if (searchBar) {
      searchBar.onclick = () => this.openGlobalSearchModal();
    }

    // Portals Switcher Modal Trigger
    const portalsBtn = document.getElementById('header-portals-btn');
    if (portalsBtn) {
      portalsBtn.onclick = () => openPortalSwitcherModal('main-erp');
    }
  }

  updateHeaderProfile() {
    const user = authService.getCurrentUser();
    const role = authService.getRole();

    const nameEl = document.getElementById('header-user-name');
    const roleEl = document.getElementById('header-user-role');
    const roleSelect = document.getElementById('header-role-switcher');

    if (nameEl) nameEl.textContent = user.fullName;
    if (roleEl) roleEl.textContent = authService.getRoleDisplayName(role);
    if (roleSelect) roleSelect.value = role;

    // Sidebar bottom badge
    const sbName = document.getElementById('sidebar-user-name');
    const sbRole = document.getElementById('sidebar-user-role');
    if (sbName) sbName.textContent = user.fullName;
    if (sbRole) sbRole.textContent = authService.getRoleDisplayName(role);
  }

  bindKeyboardShortcuts() {
    document.addEventListener('keydown', (e) => {
      // ⌘K or Ctrl+K for Global Search
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        this.openGlobalSearchModal();
      }
    });
  }

  openGlobalSearchModal() {
    const contentHtml = `
      <div class="space-y-4 text-xs">
        <div class="relative">
          <input
            id="global-search-query"
            type="text"
            autofocus
            placeholder="Search products, SKUs, gatepasses, customers, invoices..."
            class="w-full pl-9 pr-4 py-3 text-sm bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:border-[#138FCB] font-medium text-slate-800">
          <span class="absolute left-3 top-3.5 text-slate-400">🔍</span>
        </div>

        <div class="space-y-2">
          <span class="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">Quick Navigation & Shortcuts</span>
          <div class="space-y-1">
            <button class="quick-nav-btn w-full p-2.5 rounded-xl hover:bg-slate-100 flex items-center justify-between text-left text-xs font-semibold text-slate-700 cursor-pointer" data-route="inventory-stock">
              <div class="flex items-center gap-2">
                <span>📦</span>
                <span>Current Warehouse Stock Balances</span>
              </div>
              <span class="text-[10px] bg-slate-200 px-1.5 py-0.5 rounded text-slate-600">Stock</span>
            </button>

            <button class="quick-nav-btn w-full p-2.5 rounded-xl hover:bg-slate-100 flex items-center justify-between text-left text-xs font-semibold text-slate-700 cursor-pointer" data-route="warehouse-gatepasses">
              <div class="flex items-center gap-2">
                <span>🚚</span>
                <span>Warehouse Gatepasses & Dispatch</span>
              </div>
              <span class="text-[10px] bg-slate-200 px-1.5 py-0.5 rounded text-slate-600">Gatepass</span>
            </button>

            <button class="quick-nav-btn w-full p-2.5 rounded-xl hover:bg-slate-100 flex items-center justify-between text-left text-xs font-semibold text-slate-700 cursor-pointer" data-route="salesperson-portal">
              <div class="flex items-center gap-2">
                <span>💼</span>
                <span>Salesperson Rate Entry Portal</span>
              </div>
              <span class="text-[10px] bg-slate-200 px-1.5 py-0.5 rounded text-slate-600">Rates Pending</span>
            </button>

            <button class="quick-nav-btn w-full p-2.5 rounded-xl hover:bg-slate-100 flex items-center justify-between text-left text-xs font-semibold text-slate-700 cursor-pointer" data-route="purchasing-shipments">
              <div class="flex items-center gap-2">
                <span>🚢</span>
                <span>Import Shipments & Tracktainer Container Tracking</span>
              </div>
              <span class="text-[10px] bg-slate-200 px-1.5 py-0.5 rounded text-slate-600">Landed Cost</span>
            </button>
          </div>
        </div>
      </div>
    `;

    openModal({
      title: 'Global Search & Command Palette',
      subtitle: 'Jump to any document or module in JS Traders ERP',
      contentHtml,
      size: 'max-w-lg',
      onOpen: (modalEl) => {
        modalEl.querySelectorAll('.quick-nav-btn').forEach(btn => {
          btn.onclick = () => {
            const route = btn.getAttribute('data-route');
            closeModal();
            this.navigateTo(route);
          };
        });
      }
    });
  }

  openNotificationDrawer() {
    const notifications = notificationService.getNotifications();

    const contentHtml = `
      <div class="space-y-4 text-xs">
        <div class="flex justify-between items-center pb-2 border-b border-slate-100">
          <span class="font-bold text-slate-700">${notifications.length} Alerts & Notifications</span>
          <button id="mark-all-read-btn" class="text-xs font-semibold text-[#138FCB] hover:underline cursor-pointer">Mark all read</button>
        </div>

        <div class="space-y-2">
          ${notifications.map(n => `
            <div class="p-3 bg-slate-50 rounded-xl border border-slate-200 flex items-start gap-3">
              <span class="text-base">${n.type === 'warning' ? '⚠' : 'ℹ'}</span>
              <div class="flex-1">
                <div class="font-bold text-slate-800">${n.title}</div>
                <div class="text-slate-500 mt-0.5">${n.message}</div>
                <div class="text-[10px] text-slate-400 mt-1">${new Date(n.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
              </div>
            </div>
          `).join('')}
        </div>
      </div>
    `;

    openDrawer({
      title: 'Notification Center',
      subtitle: 'System alerts, container tracking, and workflows',
      badge: `<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-100 text-blue-700">${notifications.length} New</span>`,
      content: contentHtml,
      width: 'max-w-md'
    });

    setTimeout(() => {
      const markBtn = document.getElementById('mark-all-read-btn');
      if (markBtn) {
        markBtn.onclick = () => {
          notificationService.markAllAsRead();
          toast.show('All notifications marked as read.', 'info');
          closeDrawer();
        };
      }
    }, 50);
  }
}

function startMainApp() {
  const app = new AppController();
  app.init();
  window.app = app;
  window.openDrawer = openDrawer;
  window.closeDrawer = closeDrawer;
  window.openPortalSwitcherModal = openPortalSwitcherModal;
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', startMainApp);
} else {
  startMainApp();
}
