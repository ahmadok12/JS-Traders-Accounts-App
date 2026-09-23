/**
 * JS Traders ERP - Dedicated Warehouse Management Portal Controller
 * Designed specifically for Warehouse Managers & Floor Supervisors.
 * Strictly masks all cost prices, purchase bills, accounting ledgers, and profit margins.
 */

import { authService } from '../../services/authService.js';
import { storageService } from '../../services/storageService.js';
import { toast } from '../../components/toast.js';
import { openDrawer, closeDrawer } from '../../components/drawer.js';
import { openPortalSwitcherModal } from '../../components/portalSwitcherModal.js';

// Warehouse & Inventory Views
import { renderStockView, bindStockEvents } from '../../modules/inventory/stockView.js';
import { renderProductsView, bindProductsEvents } from '../../modules/inventory/productsView.js';
import { renderVariantsView, bindVariantsEvents } from '../../modules/inventory/variantsView.js';
import { renderCategoriesView, bindCategoriesEvents } from '../../modules/inventory/categoriesView.js';
import { renderStockMovementsView, bindStockMovementsEvents } from '../../modules/inventory/stockMovementsView.js';
import { renderStockAdjustmentsView, bindStockAdjustmentsEvents } from '../../modules/inventory/stockAdjustmentsView.js';
import { renderRollInventoryView, bindRollInventoryEvents } from '../../modules/inventory/rollInventoryView.js';
import { renderAssemblyView, bindAssemblyEvents } from '../../modules/inventory/assemblyView.js';

import { renderGatepassView, bindGatepassEvents } from '../../modules/warehouse/gatepassView.js';
import { renderDeliveryView, bindDeliveryEvents } from '../../modules/warehouse/deliveryView.js';
import { renderWarehousesView, bindWarehousesEvents } from '../../modules/warehouse/warehousesView.js';
import { renderLocationsView, bindLocationsEvents } from '../../modules/warehouse/locationsView.js';
import { renderStockByWarehouseView, bindStockByWarehouseEvents } from '../../modules/warehouse/stockByWarehouseView.js';
import { renderStaffManagementView, bindStaffManagementEvents } from '../../modules/warehouse/staffManagementView.js';

class WarehouseAppController {
  constructor() {
    this.currentRoute = 'warehouse-gatepasses';
    this.workspace = null;
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
    // Ensure active role is locked to warehouse_manager (Cost Masking Guaranteed)
    authService.switchRole('warehouse_manager');

    this.workspace = document.getElementById('wh-primary-workspace');
    this.breadcrumbContainer = document.getElementById('wh-header-breadcrumbs');

    this.bindNavigation();
    this.bindHeaderControls();

    // Hash routing for deep linking and back/forward browser history
    window.addEventListener('hashchange', () => {
      const hashRoute = window.location.hash.replace(/^#\/?/, '');
      if (hashRoute && hashRoute !== this.currentRoute) {
        this.navigateTo(hashRoute, false);
      }
    });

    storageService.subscribe('*', () => {
      this.scheduleRender();
    });

    const initialRoute = window.location.hash.replace(/^#\/?/, '') || 'warehouse-gatepasses';
    this.navigateTo(initialRoute, false);
  }

  navigateTo(route, updateHash = true) {
    this.currentRoute = route;

    if (updateHash && window.location.hash !== `#/${route}`) {
      window.location.hash = `#/${route}`;
    }

    document.querySelectorAll('.wh-nav-link').forEach(link => {
      const linkRoute = link.getAttribute('data-route');
      if (linkRoute === route) {
        link.classList.add('bg-emerald-50', 'text-emerald-700', 'font-bold');
        link.classList.remove('text-neutralText', 'font-medium');
      } else {
        link.classList.remove('bg-emerald-50', 'text-emerald-700', 'font-bold');
        link.classList.add('text-neutralText', 'font-medium');
      }
    });

    this.renderCurrentRoute();
  }

  renderCurrentRoute() {
    if (this.isRendering || !this.workspace) return;
    this.isRendering = true;

    try {
      let html = '';
      let bindFn = null;
      let breadcrumbs = ['Warehouse Portal'];

    switch (this.currentRoute) {
      case 'warehouse-gatepasses':
        html = renderGatepassView();
        bindFn = bindGatepassEvents;
        breadcrumbs = ['Operations', 'Gatepasses & Loading'];
        break;

      case 'warehouse-deliveries':
        html = renderDeliveryView();
        bindFn = bindDeliveryEvents;
        breadcrumbs = ['Operations', 'Deliveries & Dispatch'];
        break;

      case 'inventory-stock':
        html = renderStockView();
        bindFn = bindStockEvents;
        breadcrumbs = ['Inventory', 'Current Stock Balances'];
        break;

      case 'inventory-products':
        html = renderProductsView();
        bindFn = bindProductsEvents;
        breadcrumbs = ['Inventory', 'Products Master (Costs Masked)'];
        break;

      case 'inventory-variants':
        html = renderVariantsView();
        bindFn = bindVariantsEvents;
        breadcrumbs = ['Inventory', 'Variants & SKUs'];
        break;

      case 'inventory-categories':
        html = renderCategoriesView();
        bindFn = bindCategoriesEvents;
        breadcrumbs = ['Inventory', 'Categories'];
        break;

      case 'inventory-movements':
        html = renderStockMovementsView();
        bindFn = bindStockMovementsEvents;
        breadcrumbs = ['Inventory', 'Stock Movements Log'];
        break;

      case 'inventory-adjustments':
        html = renderStockAdjustmentsView();
        bindFn = bindStockAdjustmentsEvents;
        breadcrumbs = ['Inventory', 'Stock Adjustments'];
        break;

      case 'inventory-rolls':
        html = renderRollInventoryView();
        bindFn = bindRollInventoryEvents;
        breadcrumbs = ['Inventory', 'Roll & Cut-to-Length'];
        break;

      case 'inventory-assembly':
        html = renderAssemblyView();
        bindFn = bindAssemblyEvents;
        breadcrumbs = ['Production', 'Assembly Orders'];
        break;

      case 'inventory-disassembly':
        html = renderAssemblyView();
        bindFn = bindAssemblyEvents;
        breadcrumbs = ['Production', 'Disassembly Orders'];
        break;

      case 'warehouse-warehouses':
        html = renderWarehousesView();
        bindFn = bindWarehousesEvents;
        breadcrumbs = ['Facilities', 'Warehouses'];
        break;

      case 'warehouse-locations':
        html = renderLocationsView();
        bindFn = bindLocationsEvents;
        breadcrumbs = ['Facilities', 'Locations & Bins'];
        break;

      case 'warehouse-stock-by-wh':
        html = renderStockByWarehouseView();
        bindFn = bindStockByWarehouseEvents;
        breadcrumbs = ['Facilities', 'Stock by Warehouse'];
        break;

      case 'warehouse-staff':
        html = renderStaffManagementView();
        bindFn = bindStaffManagementEvents;
        breadcrumbs = ['Management', 'Staff & Mobile Access'];
        break;

      default:
        html = `<div class="p-8 text-center text-slate-400">Warehouse view not found</div>`;
    }

    if (this.breadcrumbContainer) {
      this.breadcrumbContainer.innerHTML = breadcrumbs.map((crumb, idx) => `
        <span class="${idx === breadcrumbs.length - 1 ? 'font-bold text-slate-800' : 'text-slate-400'}">${crumb}</span>
        ${idx < breadcrumbs.length - 1 ? '<span class="text-slate-300">/</span>' : ''}
      `).join('');
    }

    this.workspace.innerHTML = html;

    // Apply strict cost masking on rendered DOM as an extra security layer
    this.maskSensitiveCosts(this.workspace);

    if (bindFn) {
      bindFn(this.workspace, () => this.scheduleRender());
    }
    } finally {
      this.isRendering = false;
    }
  }

  maskSensitiveCosts(container) {
    // Redact any cost/profit columns that might inadvertently exist
    const costElements = container.querySelectorAll('.cost-price, [data-field="costPrice"], [data-field="margin"]');
    costElements.forEach(el => {
      el.textContent = '🔒 Redacted';
      el.classList.add('text-slate-400', 'italic');
    });
  }

  bindNavigation() {
    document.querySelectorAll('.wh-nav-link').forEach(link => {
      link.onclick = (e) => {
        e.preventDefault();
        const route = link.getAttribute('data-route');
        if (route) {
          this.navigateTo(route);
        }
      };
    });
  }

  bindHeaderControls() {
    const portalsBtn = document.getElementById('wh-portals-btn');
    if (portalsBtn) {
      portalsBtn.onclick = () => openPortalSwitcherModal('warehouse-portal');
    }

    const whSwitcher = document.getElementById('wh-switcher');
    if (whSwitcher) {
      whSwitcher.value = authService.getActiveWarehouseId();
      whSwitcher.onchange = (e) => {
        authService.switchWarehouse(e.target.value);
        toast.show('Switched active warehouse facility.', 'info');
      };
    }
  }
}

document.addEventListener('DOMContentLoaded', () => {
  const app = new WarehouseAppController();
  app.init();
  window.warehouseApp = app;
  window.openDrawer = openDrawer;
  window.closeDrawer = closeDrawer;
  window.openPortalSwitcherModal = openPortalSwitcherModal;
});
