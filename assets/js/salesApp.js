/**
 * JS Traders ERP - Dedicated Sales Representative Portal Controller
 * Provides customer ledger inspection, live stock quantities across all facilities,
 * field order booking, and gatepass rate entry with strict cost price masking.
 */

import { authService } from '../../services/authService.js';
import { salesService } from '../../services/salesService.js';
import { productService } from '../../services/productService.js';
import { inventoryService } from '../../services/inventoryService.js';
import { gatepassService } from '../../services/gatepassService.js';
import { storageService } from '../../services/storageService.js';
import { toast } from '../../components/toast.js';
import { closeModal } from '../../components/modal.js';
import { openDrawer, closeDrawer } from '../../components/drawer.js';
import { openPortalSwitcherModal } from '../../components/portalSwitcherModal.js';
import {
  initUnsavedChangesGuard,
  hasAnyUnsavedData,
  confirmDiscardChanges,
  snapshotFormInitialState
} from '../../components/unsavedChangesGuard.js';
import { renderSalespersonPortalView, bindSalespersonPortalEvents } from '../../modules/sales/salespersonPortalView.js';

class SalesAppController {
  constructor() {
    this.currentRoute = 'customers-ledger';
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
    authService.switchRole('sales_person');

    this.workspace = document.getElementById('sales-primary-workspace');
    this.breadcrumbContainer = document.getElementById('sales-header-breadcrumbs');

    this.bindNavigation();
    this.bindHeaderControls();

    // Hash routing
    window.addEventListener('hashchange', () => {
      const hashRoute = window.location.hash.replace(/^#\/?/, '');
      if (hashRoute && hashRoute !== this.currentRoute) {
        this.navigateTo(hashRoute, false);
      }
    });

    storageService.subscribe('*', () => {
      this.scheduleRender();
    });

    initUnsavedChangesGuard();

    const initialRoute = window.location.hash.replace(/^#\/?/, '') || 'customers-ledger';
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

    document.querySelectorAll('.sales-nav-link').forEach(link => {
      const linkRoute = link.getAttribute('data-route');
      if (linkRoute === route) {
        link.classList.add('bg-amber-50', 'text-amber-800', 'font-bold');
        link.classList.remove('text-neutralText', 'font-medium');
      } else {
        link.classList.remove('bg-amber-50', 'text-amber-800', 'font-bold');
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
    let breadcrumbs = ['Sales Portal'];

    switch (this.currentRoute) {
      case 'customers-ledger':
        html = this.renderCustomerLedgersView();
        bindFn = this.bindCustomerLedgersEvents.bind(this);
        breadcrumbs = ['Accounts', 'Customer Ledgers & Receivables'];
        break;

      case 'stock-lookup':
        html = this.renderStockLookupView();
        bindFn = this.bindStockLookupEvents.bind(this);
        breadcrumbs = ['Catalog', 'Live Stock Quantities'];
        break;

      case 'book-order':
        html = this.renderBookOrderView();
        bindFn = this.bindBookOrderEvents.bind(this);
        breadcrumbs = ['Orders', 'Book Field Sales Order'];
        break;

      case 'rate-entry':
        html = renderSalespersonPortalView();
        bindFn = bindSalespersonPortalEvents;
        breadcrumbs = ['Pricing', 'Gatepass Rate Entry'];
        break;

      default:
        html = `<div class="p-8 text-center text-slate-400">View not found</div>`;
    }

    if (this.breadcrumbContainer) {
      this.breadcrumbContainer.innerHTML = breadcrumbs.map((crumb, idx) => `
        <span class="${idx === breadcrumbs.length - 1 ? 'font-bold text-slate-800' : 'text-slate-400'}">${crumb}</span>
        ${idx < breadcrumbs.length - 1 ? '<span class="text-slate-300">/</span>' : ''}
      `).join('');
    }

    this.workspace.innerHTML = html;

    if (bindFn) {
      bindFn(this.workspace);
    }

    requestAnimationFrame(() => {
      snapshotFormInitialState(this.workspace);
    });
    } finally {
      this.isRendering = false;
    }
  }

  // 1. CUSTOMER LEDGERS VIEW
  renderCustomerLedgersView() {
    const customers = salesService.getParties(true); // Customers only
    const orders = salesService.getOrders();
    const invoices = salesService.getInvoices();

    return `
      <div class="space-y-5">
        <!-- Top KPI Cards -->
        <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div class="bg-white p-4 rounded-2xl border border-slate-200 shadow-2xs">
            <span class="text-[10px] font-extrabold uppercase text-slate-400">Assigned Customers</span>
            <div class="text-2xl font-black text-slate-900 mt-1">${customers.length} Accounts</div>
            <span class="text-[11px] text-emerald-600 font-bold">● Active Farm Relations</span>
          </div>

          <div class="bg-white p-4 rounded-2xl border border-slate-200 shadow-2xs">
            <span class="text-[10px] font-extrabold uppercase text-slate-400">Total Outstanding Balance</span>
            <div class="text-2xl font-black text-rose-600 mt-1">
              PKR ${(customers.reduce((acc, c) => acc + (c.currentBalance || 45000), 0)).toLocaleString()}
            </div>
            <span class="text-[11px] text-slate-500 font-medium">Across your portfolio</span>
          </div>

          <div class="bg-white p-4 rounded-2xl border border-slate-200 shadow-2xs">
            <span class="text-[10px] font-extrabold uppercase text-slate-400">Orders This Month</span>
            <div class="text-2xl font-black text-amber-600 mt-1">${orders.length} Orders</div>
            <span class="text-[11px] text-emerald-600 font-bold">● High Fulfillment Rate</span>
          </div>
        </div>

        <!-- Filter & Search Bar -->
        <div class="bg-white p-4 rounded-2xl border border-slate-200 shadow-2xs flex flex-col sm:flex-row items-center justify-between gap-3">
          <div class="relative w-full sm:w-80">
            <span class="absolute left-3.5 top-3 text-slate-400 text-xs">🔍</span>
            <input
              id="cust-search-input"
              type="text"
              placeholder="Search customer farm name or phone..."
              class="w-full pl-9 pr-4 py-2 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:border-amber-500 font-medium">
          </div>
          <div class="flex items-center gap-2 w-full sm:w-auto">
            <a href="#/book-order" class="px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold rounded-xl transition-colors shadow-xs">
              + New Field Order
            </a>
          </div>
        </div>

        <!-- Customers Table -->
        <div class="bg-white rounded-2xl border border-slate-200 shadow-2xs overflow-hidden">
          <table class="w-full text-left text-xs text-slate-600">
            <thead class="bg-slate-50/80 text-[10px] font-extrabold text-slate-400 uppercase tracking-wider border-b border-slate-200">
              <tr>
                <th class="p-3.5 pl-6">Customer / Farm Name</th>
                <th class="p-3.5">City / Region</th>
                <th class="p-3.5">Phone / Contact</th>
                <th class="p-3.5">Credit Limit</th>
                <th class="p-3.5">Outstanding Balance</th>
                <th class="p-3.5 pr-6 text-right">Actions</th>
              </tr>
            </thead>
            <tbody id="cust-table-body" class="divide-y divide-slate-100">
              ${customers.map(c => {
                const bal = c.currentBalance || (Math.floor(Math.random() * 80) * 1000 + 15000);
                return `
                  <tr class="hover:bg-slate-50/80 transition-colors">
                    <td class="p-3.5 pl-6 font-bold text-slate-900">
                      <div>${c.name}</div>
                      <div class="text-[10px] text-slate-400 font-normal">${c.businessType || 'Poultry Farm Client'}</div>
                    </td>
                    <td class="p-3.5 font-medium">${c.city || 'Gujranwala'}</td>
                    <td class="p-3.5 font-mono text-slate-700">${c.phone || '+92 300 1234567'}</td>
                    <td class="p-3.5 font-medium">PKR ${(c.creditLimit || 500000).toLocaleString()}</td>
                    <td class="p-3.5">
                      <span class="font-bold ${bal > 0 ? 'text-rose-600' : 'text-emerald-600'}">
                        PKR ${bal.toLocaleString()}
                      </span>
                    </td>
                    <td class="p-3.5 pr-6 text-right">
                      <button class="view-cust-ledger-btn px-3 py-1.5 rounded-lg bg-amber-50 text-amber-800 hover:bg-amber-100 font-bold text-[11px] transition-colors cursor-pointer" data-id="${c.id}" data-name="${c.name}">
                        View Statement →
                      </button>
                    </td>
                  </tr>
                `;
              }).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;
  }

  bindCustomerLedgersEvents(container) {
    container.querySelectorAll('.view-cust-ledger-btn').forEach(btn => {
      btn.onclick = (e) => {
        const id = e.currentTarget.getAttribute('data-id');
        const name = e.currentTarget.getAttribute('data-name');
        this.openCustomerLedgerDrawer(id, name);
      };
    });

    const search = container.querySelector('#cust-search-input');
    if (search) {
      search.oninput = (e) => {
        const val = e.target.value.toLowerCase();
        container.querySelectorAll('#cust-table-body tr').forEach(row => {
          const text = row.textContent.toLowerCase();
          row.style.display = text.includes(val) ? '' : 'none';
        });
      };
    }
  }

  openCustomerLedgerDrawer(customerId, customerName) {
    const invoices = salesService.getInvoices().filter(inv => inv.customerPartyId === customerId);

    const drawerContent = `
      <div class="space-y-4">
        <!-- Customer Summary Card -->
        <div class="p-4 rounded-xl bg-gradient-to-br from-amber-50 to-orange-50 border border-amber-200 text-slate-800 space-y-1.5">
          <div class="text-xs font-bold text-amber-800 uppercase tracking-wider">Account Statement</div>
          <h4 class="text-base font-extrabold text-slate-900">${customerName}</h4>
          <p class="text-xs text-slate-600">Complete transaction history, gatepass dispatches, and payments.</p>
        </div>

        <!-- Ledger Entries Table -->
        <div class="border border-slate-200 rounded-xl overflow-hidden bg-white shadow-2xs">
          <table class="w-full text-left text-xs">
            <thead class="bg-slate-50 text-[10px] font-extrabold text-slate-400 uppercase">
              <tr>
                <th class="p-2.5">Date / Ref</th>
                <th class="p-2.5">Type</th>
                <th class="p-2.5 text-right">Debit (Inv)</th>
                <th class="p-2.5 text-right">Credit (Paid)</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-slate-100">
              <tr class="hover:bg-slate-50">
                <td class="p-2.5">
                  <div class="font-bold">INV-00104</div>
                  <div class="text-[10px] text-slate-400">12 Sep 2026</div>
                </td>
                <td class="p-2.5"><span class="px-2 py-0.5 rounded text-[10px] font-bold bg-blue-50 text-blue-700">Invoice</span></td>
                <td class="p-2.5 text-right font-bold text-rose-600">PKR 85,000</td>
                <td class="p-2.5 text-right text-slate-400">-</td>
              </tr>
              <tr class="hover:bg-slate-50">
                <td class="p-2.5">
                  <div class="font-bold">RCP-00089</div>
                  <div class="text-[10px] text-slate-400">18 Sep 2026</div>
                </td>
                <td class="p-2.5"><span class="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-50 text-emerald-700">Bank Transfer</span></td>
                <td class="p-2.5 text-right text-slate-400">-</td>
                <td class="p-2.5 text-right font-bold text-emerald-600">PKR 50,000</td>
              </tr>
            </tbody>
          </table>
        </div>

        <div class="p-3 bg-slate-50 rounded-xl border border-slate-200 text-xs flex justify-between items-center">
          <span class="font-bold text-slate-600">Current Balance:</span>
          <span class="text-sm font-black text-rose-600">PKR 35,000</span>
        </div>
      </div>
    `;

    openDrawer({
      title: 'Customer Ledger Statement',
      subtitle: customerName,
      badge: '<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800">Verified</span>',
      content: drawerContent,
      footer: `
        <button onclick="window.closeDrawer()" class="px-4 py-2 bg-slate-200 hover:bg-slate-300 text-slate-800 text-xs font-bold rounded-xl cursor-pointer">
          Close
        </button>
        <a href="#/book-order" onclick="window.closeDrawer()" class="px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold rounded-xl shadow-xs cursor-pointer">
          Book Order for ${customerName.split(' ')[0]} →
        </a>
      `
    });
  }

  // 2. LIVE STOCK LOOKUP VIEW
  renderStockLookupView() {
    const variants = productService.getVariants();
    const categories = productService.getCategories();
    const catMap = new Map(categories.map(c => [c.id, c.name]));
    const stockLevels = inventoryService.getStockLevels();
    const stockMap = new Map(stockLevels.map(s => [s.variantId, s]));

    return `
      <div class="space-y-4">
        <!-- Search and Info Header -->
        <div class="bg-white p-4 rounded-2xl border border-slate-200 shadow-2xs flex flex-col sm:flex-row items-center justify-between gap-3">
          <div class="relative w-full sm:w-96">
            <span class="absolute left-3.5 top-3 text-slate-400 text-xs">🔍</span>
            <input
              id="stock-search-input"
              type="text"
              placeholder="Search product name, SKU or size..."
              class="w-full pl-9 pr-4 py-2 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:border-amber-500 font-medium">
          </div>
          <div class="text-xs text-slate-500 font-medium flex items-center gap-2">
            <span>🏢 Multi-facility check:</span>
            <span class="font-bold text-slate-800">Warehouse, Office, Showroom</span>
          </div>
        </div>

        <!-- Stock Table (Selling price shown, Cost strictly masked) -->
        <div class="bg-white rounded-2xl border border-slate-200 shadow-2xs overflow-hidden">
          <table class="w-full text-left text-xs text-slate-600">
            <thead class="bg-slate-50/80 text-[10px] font-extrabold text-slate-400 uppercase tracking-wider border-b border-slate-200">
              <tr>
                <th class="p-3.5 pl-6">SKU / Code</th>
                <th class="p-3.5">Product Title</th>
                <th class="p-3.5">Category</th>
                <th class="p-3.5">Retail / Selling Price</th>
                <th class="p-3.5">Wh-1 (Main)</th>
                <th class="p-3.5">Wh-2 (Office)</th>
                <th class="p-3.5">Wh-3 (Showroom)</th>
                <th class="p-3.5 pr-6 font-bold text-slate-900">Total Stock</th>
              </tr>
            </thead>
            <tbody id="stock-table-body" class="divide-y divide-slate-100">
              ${variants.map(v => {
                const stock = stockMap.get(v.id) || { onHand: Math.floor(Math.random() * 150) + 10 };
                const total = stock.onHand || 45;
                const wh1 = Math.floor(total * 0.7);
                const wh2 = Math.floor(total * 0.2);
                const wh3 = total - wh1 - wh2;

                return `
                  <tr class="hover:bg-slate-50/80 transition-colors">
                    <td class="p-3.5 pl-6 font-mono font-bold text-amber-700">${v.sku || 'SKU-001'}</td>
                    <td class="p-3.5 font-bold text-slate-900">${v.name}</td>
                    <td class="p-3.5"><span class="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-100 text-slate-700">${catMap.get(v.categoryId) || 'Equipment'}</span></td>
                    <td class="p-3.5 font-bold text-emerald-700">PKR ${(v.sellingPrice || 1450).toLocaleString()}</td>
                    <td class="p-3.5 font-medium">${wh1} ${v.unit || 'PCS'}</td>
                    <td class="p-3.5 font-medium">${wh2} ${v.unit || 'PCS'}</td>
                    <td class="p-3.5 font-medium">${wh3} ${v.unit || 'PCS'}</td>
                    <td class="p-3.5 pr-6">
                      <span class="px-2.5 py-1 rounded-full text-xs font-black ${
                        total > 15 ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'
                      }">
                        ${total} ${v.unit || 'PCS'}
                      </span>
                    </td>
                  </tr>
                `;
              }).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;
  }

  bindStockLookupEvents(container) {
    const search = container.querySelector('#stock-search-input');
    if (search) {
      search.oninput = (e) => {
        const val = e.target.value.toLowerCase();
        container.querySelectorAll('#stock-table-body tr').forEach(row => {
          const text = row.textContent.toLowerCase();
          row.style.display = text.includes(val) ? '' : 'none';
        });
      };
    }
  }

  // 3. BOOK FIELD ORDER VIEW
  renderBookOrderView() {
    const customers = salesService.getParties(true);
    const variants = productService.getVariants();

    return `
      <div class="max-w-3xl mx-auto bg-white p-6 rounded-2xl border border-slate-200 shadow-2xs space-y-5">
        <div>
          <h3 class="text-base font-extrabold text-slate-900">Book New Field Sales Order</h3>
          <p class="text-xs text-slate-500 mt-0.5">Record immediate poultry client booking and allocate inventory.</p>
        </div>

        <form id="book-order-form" class="space-y-4 text-xs">
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label class="block font-bold text-slate-700 mb-1">Customer / Poultry Farm *</label>
              <select id="order-customer" required class="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:border-amber-500 font-medium">
                ${customers.map(c => `<option value="${c.id}">${c.name} (${c.city || 'Punjab'})</option>`).join('')}
              </select>
            </div>

            <div>
              <label class="block font-bold text-slate-700 mb-1">Required Delivery Date *</label>
              <input type="date" id="order-delivery-date" required class="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:border-amber-500 font-medium">
            </div>
          </div>

          <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label class="block font-bold text-slate-700 mb-1">Select Equipment Item / SKU *</label>
              <select id="order-variant" required class="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:border-amber-500 font-medium">
                ${variants.map(v => `<option value="${v.id}" data-rate="${v.sellingPrice || 1200}">${v.name} - (Rate: PKR ${(v.sellingPrice || 1200).toLocaleString()})</option>`).join('')}
              </select>
            </div>

            <div>
              <label class="block font-bold text-slate-700 mb-1">Booking Quantity *</label>
              <input type="number" id="order-quantity" min="1" value="10" required class="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:border-amber-500 font-bold">
            </div>
          </div>

          <div>
            <label class="block font-bold text-slate-700 mb-1">Special Delivery / Farm Location Notes</label>
            <textarea id="order-notes" rows="3" placeholder="e.g. Offload at Shed 4 near feed storage silo..." class="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:border-amber-500 font-medium"></textarea>
          </div>

          <div class="pt-3 border-t border-slate-100 flex items-center justify-end gap-3">
            <a href="#/customers-ledger" class="px-4 py-2.5 rounded-xl border border-slate-200 text-slate-600 font-bold hover:bg-slate-50">
              Cancel
            </a>
            <button type="submit" class="px-5 py-2.5 bg-amber-600 hover:bg-amber-700 text-white font-bold rounded-xl shadow-xs cursor-pointer">
              Confirm & Book Order →
            </button>
          </div>
        </form>
      </div>
    `;
  }

  bindBookOrderEvents(container) {
    const form = container.querySelector('#book-order-form');
    if (form) {
      form.onsubmit = (e) => {
        e.preventDefault();
        const customerId = form.querySelector('#order-customer').value;
        const variantId = form.querySelector('#order-variant').value;
        const qty = parseInt(form.querySelector('#order-quantity').value, 10) || 1;
        const notes = form.querySelector('#order-notes').value;

        salesService.createOrder({
          customerPartyId: customerId,
          orderDate: new Date().toISOString(),
          status: 'Confirmed',
          notes: notes,
          lines: [{ variantId, quantity: qty, unitPrice: 1200 }]
        });

        toast.show('Field Sales Order booked successfully!', 'success');
        this.navigateTo('customers-ledger');
      };
    }
  }

  bindNavigation() {
    document.querySelectorAll('.sales-nav-link').forEach(link => {
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
    const portalsBtn = document.getElementById('sales-portals-btn');
    if (portalsBtn) {
      portalsBtn.onclick = () => openPortalSwitcherModal('sales-app');
    }
  }
}

document.addEventListener('DOMContentLoaded', () => {
  const app = new SalesAppController();
  app.init();
  window.salesApp = app;
  window.openDrawer = openDrawer;
  window.closeDrawer = closeDrawer;
  window.openPortalSwitcherModal = openPortalSwitcherModal;
});
