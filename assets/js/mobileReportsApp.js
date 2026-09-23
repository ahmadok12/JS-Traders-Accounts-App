/**
 * JS Traders ERP - Standalone Mobile Reporting App Controller
 * Strictly View-Only Mobile Insights & Stock Reporting Application.
 * 
 * Features:
 * 1. Demo Stock Quantity View:
 *    - Level 1: Large square cards of product categories with aggregated quantities.
 *    - Level 2: Tapping category displays respective items in a responsive grid of small square cards.
 *    - Small square cards show product name, SKU, and available quantity.
 *    - Detail drawer sheet on tapping any item card.
 * 2. Location Filtering (All / Warehouse / Office) dynamically recalculated.
 * 3. Role-Based Views (Owner sees valuations, Floor Staff has costs redacted).
 * 4. Multi-Tab Reports:
 *    - Stock Explorer (Category & Small Square Item Cards)
 *    - By Location (Comparative WH vs Office breakdown)
 *    - Low Stock (Deficit & safety threshold alerts)
 *    - Movements (Stock in/out audit trail)
 */

import { storageService } from '../../services/storageService.js';
import { productService } from '../../services/productService.js';
import { inventoryService } from '../../services/inventoryService.js';
import { salesService } from '../../services/salesService.js';
import { purchasingService } from '../../services/purchasingService.js';
import { openPortalSwitcherModal } from '../../components/portalSwitcherModal.js';
import { openTrackingGraphicsModal } from '../../components/trackingGraphicsModal.js';

class MobileReportsApp {
  constructor() {
    this.currentLocation = 'all'; // 'all' | 'wh-1' | 'wh-2'
    this.currentRole = 'owner';   // 'owner' | 'warehouse_manager' | 'sales_person' | 'warehouse_staff'
    this.activeTab = 'stock-explorer'; // 'stock-explorer' | 'by-location' | 'low-stock' | 'movements'
    this.selectedCategoryId = null; // When null: show Level 1 (Categories). When set: Level 2 (Small Square Item Grid).
    this.searchQuery = '';
    this.selectedItemDetail = null; // For modal drawer
    this.favoriteItemIds = new Set(this.loadFavorites());

    // Category visual themes (icon + gradient/accent colors)
    this.categoryMeta = {
      'cat-1': { icon: '🌾', color: 'from-amber-500/10 to-orange-500/10', border: 'border-amber-200', text: 'text-amber-700', badge: 'bg-amber-100 text-amber-800' },
      'cat-2': { icon: '💧', color: 'from-blue-500/10 to-cyan-500/10', border: 'border-blue-200', text: 'text-blue-700', badge: 'bg-blue-100 text-blue-800' },
      'cat-3': { icon: '🌀', color: 'from-teal-500/10 to-emerald-500/10', border: 'border-teal-200', text: 'text-teal-700', badge: 'bg-teal-100 text-teal-800' },
      'cat-4': { icon: '❄️', color: 'from-sky-500/10 to-indigo-500/10', border: 'border-sky-200', text: 'text-sky-700', badge: 'bg-sky-100 text-sky-800' },
      'cat-5': { icon: '🌡️', color: 'from-violet-500/10 to-purple-500/10', border: 'border-violet-200', text: 'text-violet-700', badge: 'bg-violet-100 text-violet-800' },
      'cat-6': { icon: '🔩', color: 'from-slate-500/10 to-zinc-500/10', border: 'border-slate-300', text: 'text-slate-700', badge: 'bg-slate-200 text-slate-800' }
    };

    this.defaultMeta = { icon: '📦', color: 'from-blue-50 to-indigo-50', border: 'border-blue-200', text: 'text-blue-700', badge: 'bg-blue-100 text-blue-800' };

    this.init();
  }

  loadFavorites() {
    try {
      if (typeof localStorage !== 'undefined') {
        const saved = localStorage.getItem('js_reports_favourite_items');
        if (saved) {
          const parsed = JSON.parse(saved);
          if (Array.isArray(parsed) && parsed.length > 0) return parsed;
        }
      }
    } catch (e) {}
    // Seed initial favorites for demo experience (Feed Pan 16" and 50" Cone Fan)
    const defaults = ['var-1', 'var-4'];
    this.saveFavorites(defaults);
    return defaults;
  }

  saveFavorites(ids) {
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem('js_reports_favourite_items', JSON.stringify(Array.from(ids)));
      }
    } catch (e) {}
  }

  toggleFavorite(itemId) {
    if (this.favoriteItemIds.has(itemId)) {
      this.favoriteItemIds.delete(itemId);
    } else {
      this.favoriteItemIds.add(itemId);
    }
    this.saveFavorites(this.favoriteItemIds);
    this.render();
  }

  isFavorite(itemId) {
    return this.favoriteItemIds.has(itemId);
  }

  init() {
    this.contentEl = document.getElementById('mobile-report-content');
    this.roleSelectEl = document.getElementById('report-role-switcher');

    this.setupEventListeners();
    this.render();
  }

  setupEventListeners() {
    // Portals Switcher Button
    const portalsBtn = document.getElementById('report-portals-btn');
    if (portalsBtn) {
      portalsBtn.addEventListener('click', () => openPortalSwitcherModal('management-report'));
    }

    // Role switcher
    if (this.roleSelectEl) {
      this.roleSelectEl.addEventListener('change', (e) => {
        this.currentRole = e.target.value;
        this.render();
      });
    }

    // Location filter bar
    document.querySelectorAll('.loc-filter-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const targetBtn = e.currentTarget;
        const loc = targetBtn.dataset.loc;
        this.currentLocation = loc;

        // Update button visual states
        document.querySelectorAll('.loc-filter-btn').forEach(b => {
          b.className = 'loc-filter-btn flex-1 py-1 rounded-lg text-center cursor-pointer transition-all text-white/80 hover:text-white';
        });
        targetBtn.className = 'loc-filter-btn flex-1 py-1 rounded-lg text-center cursor-pointer transition-all bg-white text-[#138FCB] font-bold shadow-2xs';

        this.render();
      });
    });

    // Bottom navigation tabs
    document.querySelectorAll('.report-nav-item').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const tab = e.currentTarget.dataset.tab;
        this.activeTab = tab;
        this.selectedCategoryId = null; // Reset category view on tab change
        this.searchQuery = '';

        // Update bottom nav visual state
        document.querySelectorAll('.report-nav-item').forEach(b => {
          b.className = 'report-nav-item flex flex-col items-center gap-1 text-slate-400 hover:text-slate-600 cursor-pointer';
        });
        e.currentTarget.className = 'report-nav-item flex flex-col items-center gap-1 text-[#138FCB] font-bold cursor-pointer';

        this.render();
      });
    });
  }

  // --- DATA AGGREGATION HELPERS ---

  /**
   * Get all products with stock balances attached
   */
  getInventoryItems() {
    const products = productService.getProducts();
    const variants = productService.getVariants();
    const stockBalances = storageService.getCollection('stockBalances') || [];

    const items = [];

    variants.forEach(variant => {
      const prod = products.find(p => p.id === variant.productId) || {
        customerName: variant.name,
        businessName: variant.sku,
        categoryId: 'cat-1',
        lowStockLevel: 10
      };

      // Balances for this variant
      const wh1Balance = stockBalances.find(b => b.variantId === variant.id && b.warehouseId === 'wh-1');
      const wh2Balance = stockBalances.find(b => b.variantId === variant.id && b.warehouseId === 'wh-2');

      const qtyWH = wh1Balance ? Number(wh1Balance.quantity) : 0;
      const qtyOffice = wh2Balance ? Number(wh2Balance.quantity) : 0;
      const totalQty = qtyWH + qtyOffice;

      // Filtered available quantity based on current selected location
      let availableQty = totalQty;
      if (this.currentLocation === 'wh-1') availableQty = qtyWH;
      if (this.currentLocation === 'wh-2') availableQty = qtyOffice;

      const unit = variant.unit || wh1Balance?.unit || wh2Balance?.unit || 'PCS';
      const costPrice = variant.costPrice || wh1Balance?.averageCost || 0;
      const sellingPrice = variant.sellingPrice || (costPrice * 1.3);

      const isLowStock = availableQty <= (prod.lowStockLevel || 15);

      items.push({
        id: variant.id,
        productId: prod.id,
        categoryId: prod.categoryId,
        name: prod.customerName || prod.businessName || variant.name,
        variantName: variant.name,
        sku: variant.sku,
        businessCode: prod.businessName,
        urduName: prod.urduName || '',
        unit,
        qtyWH,
        qtyOffice,
        totalQty,
        availableQty,
        costPrice,
        sellingPrice,
        stockValue: availableQty * costPrice,
        lowStockLevel: prod.lowStockLevel || 15,
        isLowStock,
        attributes: variant.attributes || {}
      });
    });

    return items;
  }

  /**
   * Aggregate categories with item counts and total stock quantities
   */
  getCategoriesWithStats() {
    const categories = productService.getCategories();
    const items = this.getInventoryItems();

    return categories.map(cat => {
      const catItems = items.filter(it => it.categoryId === cat.id);
      const totalQty = catItems.reduce((sum, it) => sum + it.availableQty, 0);
      const totalValue = catItems.reduce((sum, it) => sum + it.stockValue, 0);
      const lowStockCount = catItems.filter(it => it.isLowStock).length;

      // Group distinct units (e.g. PCS, FT)
      const units = [...new Set(catItems.map(it => it.unit))].join(' / ') || 'PCS';

      return {
        ...cat,
        itemCount: catItems.length,
        totalQty,
        totalValue,
        lowStockCount,
        units,
        meta: this.categoryMeta[cat.id] || this.defaultMeta
      };
    });
  }

  // --- RENDER DISPATCHER ---

  render() {
    if (!this.contentEl) return;

    switch (this.activeTab) {
      case 'stock-explorer':
        if (this.selectedCategoryId) {
          this.renderCategoryItemsGrid();
        } else {
          this.renderCategoriesView();
        }
        break;
      case 'customer-ledgers':
        this.renderCustomerLedgersView();
        break;
      case 'shipments-tracking':
        this.renderShipmentsTrackingView();
        break;
      case 'favourites':
        this.renderFavouritesView();
        break;
      case 'by-location':
        this.renderByLocationView();
        break;
      case 'low-stock':
        this.renderLowStockView();
        break;
      case 'movements':
        this.renderMovementsView();
        break;
      default:
        this.renderCategoriesView();
    }
  }

  // --- 1. DEMO STOCK QUANTITY VIEW: LEVEL 1 (LARGE SQUARE CATEGORY CARDS) ---

  renderCategoriesView() {
    const categories = this.getCategoriesWithStats();
    const items = this.getInventoryItems();
    const overallTotalQty = items.reduce((sum, it) => sum + it.availableQty, 0);
    const overallTotalValue = items.reduce((sum, it) => sum + it.stockValue, 0);

    const locationLabel = this.currentLocation === 'wh-1' 
      ? 'Warehouse Only' 
      : this.currentLocation === 'wh-2' 
      ? 'Office Only' 
      : 'All Facilities Combined';

    this.contentEl.innerHTML = `
      <!-- Location & High-level Metric Pill -->
      <div class="bg-white rounded-2xl p-3.5 border border-slate-200/90 shadow-2xs space-y-2">
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-2">
            <span class="w-2.5 h-2.5 rounded-full ${this.currentLocation === 'wh-1' ? 'bg-amber-500' : this.currentLocation === 'wh-2' ? 'bg-blue-500' : 'bg-emerald-500'} animate-pulse"></span>
            <span class="text-xs font-bold text-slate-700 tracking-tight">${locationLabel}</span>
          </div>
          <span class="text-[10px] font-extrabold uppercase px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">
            ${categories.length} Categories
          </span>
        </div>

        <div class="grid grid-cols-2 gap-2 pt-1 border-t border-slate-100">
          <div>
            <span class="text-[10px] font-semibold text-slate-400 block uppercase">Total Stock</span>
            <span class="text-lg font-black text-slate-900 tracking-tight">${overallTotalQty.toLocaleString()}</span>
            <span class="text-[10px] font-bold text-slate-400 ml-0.5">Units</span>
          </div>
          ${this.currentRole === 'owner' ? `
            <div>
              <span class="text-[10px] font-semibold text-slate-400 block uppercase">Est. Stock Value</span>
              <span class="text-lg font-black text-emerald-600 tracking-tight">Rs. ${(overallTotalValue / 1000000).toFixed(2)}M</span>
            </div>
          ` : `
            <div>
              <span class="text-[10px] font-semibold text-slate-400 block uppercase">Role Visibility</span>
              <span class="text-xs font-bold text-slate-600 block mt-1">Quantities Only</span>
            </div>
          `}
        </div>
      </div>

      <!-- Section Title -->
      <div class="flex items-center justify-between px-0.5">
        <div>
          <h2 class="text-xs font-extrabold text-slate-800 uppercase tracking-wider">Product Categories</h2>
          <p class="text-[11px] text-slate-400 font-medium">Tap any square card to explore stock</p>
        </div>
        <span class="text-[11px] font-bold text-[#138FCB] flex items-center gap-1">
          <span>Square View</span>
          <span>📐</span>
        </span>
      </div>

      <!-- LARGE SQUARE CARDS GRID (Product Categories) -->
      <div class="grid grid-cols-2 gap-3">
        ${categories.map(cat => `
          <button 
            type="button"
            class="category-card aspect-square bg-white rounded-3xl p-3.5 border ${cat.meta.border} shadow-2xs hover:shadow-md active:scale-95 transition-all text-left flex flex-col justify-between cursor-pointer relative overflow-hidden group bg-gradient-to-br ${cat.meta.color}"
            data-cat-id="${cat.id}">
            
            <!-- Top Row: Category Icon & Item Count -->
            <div class="flex items-center justify-between w-full">
              <div class="w-10 h-10 rounded-2xl bg-white shadow-2xs border border-slate-100 flex items-center justify-center text-xl group-hover:scale-110 transition-transform">
                ${cat.meta.icon}
              </div>
              <span class="text-[10px] font-black px-2 py-0.5 rounded-full ${cat.meta.badge}">
                ${cat.itemCount} SKUs
              </span>
            </div>

            <!-- Middle: Category Title -->
            <div class="my-auto py-1">
              <h3 class="font-extrabold text-sm text-slate-900 leading-snug line-clamp-2">
                ${cat.name}
              </h3>
              ${cat.lowStockCount > 0 ? `
                <div class="flex items-center gap-1 mt-0.5">
                  <span class="w-1.5 h-1.5 rounded-full bg-rose-500"></span>
                  <span class="text-[10px] font-bold text-rose-600">${cat.lowStockCount} low stock</span>
                </div>
              ` : `
                <span class="text-[10px] text-slate-400 font-medium">Stock Healthy</span>
              `}
            </div>

            <!-- Bottom: Large Available Quantity & Arrow -->
            <div class="pt-2 border-t border-slate-200/60 flex items-end justify-between w-full">
              <div>
                <span class="text-[9px] uppercase font-black text-slate-400 block tracking-wider leading-none">Available</span>
                <div class="flex items-baseline gap-1 mt-1">
                  <span class="text-base font-black text-slate-950 tracking-tight leading-none">
                    ${cat.totalQty.toLocaleString()}
                  </span>
                  <span class="text-[9px] font-bold text-slate-500">
                    ${cat.units.split('/')[0] || 'PCS'}
                  </span>
                </div>
              </div>
              <div class="w-6 h-6 rounded-full bg-white/80 border border-slate-200 flex items-center justify-center text-slate-400 group-hover:text-[#138FCB] group-hover:bg-white text-xs transition-colors shrink-0">
                →
              </div>
            </div>
          </button>
        `).join('')}
      </div>

      <!-- Quick Guidance Banner -->
      <div class="bg-blue-50/70 border border-blue-100 rounded-2xl p-3 flex items-start gap-2.5">
        <span class="text-base shrink-0">💡</span>
        <div class="text-[11px] text-blue-900/80 leading-relaxed font-medium">
          <strong>Tip:</strong> Toggle between <em>Warehouse</em>, <em>Office</em>, or <em>All Facilities</em> at the top to see immediate real-time quantities per storage point.
        </div>
      </div>
    `;

    // Bind category card click events
    this.contentEl.querySelectorAll('.category-card').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const catId = e.currentTarget.dataset.catId;
        this.selectedCategoryId = catId;
        this.searchQuery = '';
        this.renderCategoryItemsGrid();
      });
    });
  }

  // --- 2. DEMO STOCK QUANTITY VIEW: LEVEL 2 (SMALL SQUARE CARDS GRID) ---

  renderCategoryItemsGrid() {
    const category = productService.getCategoryById(this.selectedCategoryId);
    if (!category) {
      this.selectedCategoryId = null;
      this.renderCategoriesView();
      return;
    }

    const meta = this.categoryMeta[category.id] || this.defaultMeta;
    let items = this.getInventoryItems().filter(it => it.categoryId === category.id);

    // Apply internal search filter
    if (this.searchQuery.trim()) {
      const q = this.searchQuery.toLowerCase().trim();
      items = items.filter(it => 
        it.name.toLowerCase().includes(q) || 
        it.sku.toLowerCase().includes(q) ||
        (it.businessCode && it.businessCode.toLowerCase().includes(q))
      );
    }

    const totalCategoryQty = items.reduce((sum, it) => sum + it.availableQty, 0);

    this.contentEl.innerHTML = `
      <!-- Level 2 Navigation Bar & Breadcrumb -->
      <div class="flex items-center justify-between gap-2">
        <button id="back-to-categories-btn" class="flex items-center gap-1.5 px-3 py-1.5 bg-white border border-slate-200 rounded-xl text-xs font-extrabold text-slate-700 hover:bg-slate-50 active:scale-95 shadow-2xs transition-all cursor-pointer">
          <span>←</span>
          <span>Categories</span>
        </button>

        <div class="flex items-center gap-1.5 bg-white border border-slate-200 px-2.5 py-1 rounded-xl shadow-2xs">
          <span class="text-sm">${meta.icon}</span>
          <span class="text-xs font-black text-slate-900 truncate max-w-[140px]">${category.name}</span>
        </div>
      </div>

      <!-- Category Summary Banner -->
      <div class="bg-gradient-to-r ${meta.color} border ${meta.border} rounded-2xl p-3 flex items-center justify-between">
        <div>
          <span class="text-[10px] uppercase font-black tracking-wider text-slate-500 block">Total In Category</span>
          <div class="flex items-baseline gap-1 mt-0.5">
            <span class="text-xl font-black text-slate-950">${totalCategoryQty.toLocaleString()}</span>
            <span class="text-[11px] font-bold text-slate-600">Available</span>
          </div>
        </div>
        <span class="text-xs font-black px-2.5 py-1 rounded-xl bg-white shadow-2xs text-slate-700 border border-slate-200">
          ${items.length} Items Found
        </span>
      </div>

      <!-- Quick Item Search Input -->
      <div class="relative">
        <span class="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 text-xs">🔍</span>
        <input 
          id="item-search-input"
          type="text" 
          value="${this.searchQuery}"
          placeholder="Filter ${category.name}..."
          class="w-full pl-9 pr-8 py-2.5 bg-white border border-slate-200 rounded-xl text-xs font-semibold text-slate-800 placeholder-slate-400 focus:outline-none focus:border-[#138FCB] shadow-2xs transition-colors"
        />
        ${this.searchQuery ? `
          <button id="clear-search-btn" class="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 text-xs font-bold p-0.5">✕</button>
        ` : ''}
      </div>

      <!-- SMALL SQUARE CARDS GRID (Product Items) -->
      ${items.length === 0 ? `
        <div class="bg-white rounded-2xl p-8 text-center border border-slate-200 space-y-2">
          <span class="text-3xl block">🔍</span>
          <h4 class="text-xs font-bold text-slate-700">No items match your search</h4>
          <p class="text-[11px] text-slate-400">Try searching with another product keyword or clear the filter.</p>
        </div>
      ` : `
        <div class="grid grid-cols-2 gap-2.5">
          ${items.map(item => this.renderSmallSquareItemCard(item)).join('')}
        </div>
      `}
    `;

    // Back to categories button
    const backBtn = document.getElementById('back-to-categories-btn');
    if (backBtn) {
      backBtn.addEventListener('click', () => {
        this.selectedCategoryId = null;
        this.searchQuery = '';
        this.renderCategoriesView();
      });
    }

    // Search filter input
    const searchInput = document.getElementById('item-search-input');
    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        this.searchQuery = e.target.value;
        this.renderCategoryItemsGrid();
        const reInput = document.getElementById('item-search-input');
        if (reInput) {
          reInput.focus();
          reInput.setSelectionRange(reInput.value.length, reInput.value.length);
        }
      });
    }

    // Clear search button
    const clearBtn = document.getElementById('clear-search-btn');
    if (clearBtn) {
      clearBtn.addEventListener('click', () => {
        this.searchQuery = '';
        this.renderCategoryItemsGrid();
      });
    }

    this.bindItemCardEvents();
  }

  // --- REUSABLE SMALL SQUARE ITEM CARD & EVENT BINDING ---

  renderSmallSquareItemCard(item) {
    const isFav = this.isFavorite(item.id);

    return `
      <div 
        class="item-square-card aspect-square bg-white rounded-2xl p-3 border ${item.isLowStock ? 'border-amber-300 ring-1 ring-amber-200' : 'border-slate-200'} shadow-2xs hover:shadow-md active:scale-95 transition-all text-left flex flex-col justify-between cursor-pointer relative overflow-hidden group"
        data-item-id="${item.id}">
        
        <!-- Top Row: SKU badge, Status Indicator, and Star Button -->
        <div class="flex items-center justify-between w-full">
          <span class="font-mono text-[9px] font-bold text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded truncate max-w-[70px]">
            ${item.sku}
          </span>
          <div class="flex items-center gap-1.5">
            <span class="w-2 h-2 rounded-full ${item.availableQty <= 0 ? 'bg-rose-500' : item.isLowStock ? 'bg-amber-400' : 'bg-emerald-500'} shrink-0"></span>
            <button 
              type="button" 
              class="fav-star-btn w-6 h-6 rounded-full flex items-center justify-center transition-all cursor-pointer ${isFav ? 'text-amber-400 hover:text-amber-500 bg-amber-50' : 'text-slate-300 hover:text-amber-400 hover:bg-slate-100'}" 
              data-item-id="${item.id}" 
              title="${isFav ? 'Remove from Favourites' : 'Add to Favourites'}">
              <span class="text-xs leading-none">${isFav ? '★' : '☆'}</span>
            </button>
          </div>
        </div>

        <!-- Middle: Product Name (prominent and readable) -->
        <div class="my-auto py-1">
          <h4 class="font-bold text-xs text-slate-900 leading-snug line-clamp-2 group-hover:text-[#138FCB] transition-colors">
            ${item.name}
          </h4>
          ${item.attributes?.Origin ? `
            <span class="text-[9px] font-semibold text-slate-400 block mt-0.5">${item.attributes.Origin}</span>
          ` : ''}
        </div>

        <!-- Bottom Row: Available Quantity & Unit Badge -->
        <div class="pt-1.5 border-t border-slate-100 w-full">
          <span class="text-[8px] uppercase font-extrabold text-slate-400 block leading-none">Available Qty</span>
          <div class="flex items-baseline justify-between mt-1">
            <div class="flex items-baseline gap-0.5">
              <span class="text-base font-black ${item.availableQty <= 0 ? 'text-rose-600' : item.isLowStock ? 'text-amber-600' : 'text-slate-950'} tracking-tight leading-none">
                ${item.availableQty.toLocaleString()}
              </span>
              <span class="text-[9px] font-bold text-slate-500">${item.unit}</span>
            </div>
            
            <!-- Location Indicator Chip -->
            <span class="text-[8px] font-bold px-1.5 py-0.5 rounded bg-slate-50 text-slate-500 border border-slate-100">
              ${this.currentLocation === 'wh-1' ? 'WH' : this.currentLocation === 'wh-2' ? 'Off' : 'Total'}
            </span>
          </div>
        </div>
      </div>
    `;
  }

  bindItemCardEvents(container = this.contentEl) {
    if (!container) return;

    // Bind card click to open detail (ignore if star clicked)
    container.querySelectorAll('.item-square-card').forEach(card => {
      card.addEventListener('click', (e) => {
        if (e.target.closest('.fav-star-btn')) return;
        const itemId = card.dataset.itemId;
        this.openItemDetailModal(itemId);
      });
    });

    // Bind star button click
    container.querySelectorAll('.fav-star-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const itemId = btn.dataset.itemId;
        this.toggleFavorite(itemId);
      });
    });
  }

  // --- 2B. FAVOURITES TAB VIEW ---

  renderFavouritesView() {
    const allItems = this.getInventoryItems();
    let favItems = allItems.filter(it => this.isFavorite(it.id));

    // Apply search filter if active
    if (this.searchQuery.trim()) {
      const q = this.searchQuery.toLowerCase().trim();
      favItems = favItems.filter(it => 
        it.name.toLowerCase().includes(q) || 
        it.sku.toLowerCase().includes(q) ||
        (it.businessCode && it.businessCode.toLowerCase().includes(q))
      );
    }

    const totalFavQty = favItems.reduce((sum, it) => sum + it.availableQty, 0);

    const locationLabel = this.currentLocation === 'wh-1' 
      ? 'Warehouse' 
      : this.currentLocation === 'wh-2' 
      ? 'Office' 
      : 'All Facilities';

    this.contentEl.innerHTML = `
      <!-- Header Banner -->
      <div class="bg-gradient-to-r from-amber-500/15 via-orange-500/10 to-amber-500/5 border border-amber-200/80 rounded-2xl p-3.5 flex items-center justify-between shadow-2xs">
        <div class="flex items-center gap-2.5">
          <div class="w-10 h-10 rounded-2xl bg-amber-400 text-white flex items-center justify-center text-xl shadow-xs">
            ⭐
          </div>
          <div>
            <span class="text-[9px] uppercase font-black text-amber-700 tracking-wider block">Quick Watchlist</span>
            <h2 class="text-sm font-black text-slate-900 leading-tight">Favourite Products</h2>
          </div>
        </div>
        <div class="text-right">
          <span class="text-xs font-black text-amber-900 px-2.5 py-0.5 rounded-full bg-white border border-amber-200 shadow-2xs">
            ${favItems.length} Marked
          </span>
        </div>
      </div>

      <!-- Quick Metrics Summary -->
      <div class="bg-white rounded-2xl p-3 border border-slate-200/90 shadow-2xs flex items-center justify-between">
        <div>
          <span class="text-[9px] uppercase font-bold text-slate-400 block">Total Pinned Stock</span>
          <div class="flex items-baseline gap-1 mt-0.5">
            <span class="text-lg font-black text-slate-900">${totalFavQty.toLocaleString()}</span>
            <span class="text-[10px] font-bold text-slate-500">Units in ${locationLabel}</span>
          </div>
        </div>
        <span class="text-[10px] font-bold text-amber-700 bg-amber-50 border border-amber-200 px-2 py-1 rounded-xl">
          Pinned Cards
        </span>
      </div>

      ${favItems.length > 0 ? `
        <!-- Search Input -->
        <div class="relative">
          <span class="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 text-xs">🔍</span>
          <input 
            id="fav-search-input"
            type="text" 
            value="${this.searchQuery}"
            placeholder="Search within favourites..."
            class="w-full pl-9 pr-8 py-2.5 bg-white border border-slate-200 rounded-xl text-xs font-semibold text-slate-800 placeholder-slate-400 focus:outline-none focus:border-[#138FCB] shadow-2xs transition-colors"
          />
          ${this.searchQuery ? `
            <button id="clear-fav-search-btn" class="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 text-xs font-bold p-0.5 cursor-pointer">✕</button>
          ` : ''}
        </div>

        <!-- SMALL SQUARE CARDS GRID (Favourite Items) -->
        <div class="grid grid-cols-2 gap-2.5">
          ${favItems.map(item => this.renderSmallSquareItemCard(item)).join('')}
        </div>
      ` : `
        <!-- Empty State -->
        <div class="bg-white rounded-3xl p-8 text-center border border-slate-200 shadow-2xs space-y-3 my-2">
          <div class="w-14 h-14 rounded-2xl bg-amber-50 text-amber-500 flex items-center justify-center text-3xl mx-auto shadow-2xs border border-amber-100">
            ⭐
          </div>
          <div class="space-y-1">
            <h3 class="text-sm font-extrabold text-slate-900">No Favourites Added Yet</h3>
            <p class="text-xs text-slate-400 max-w-xs mx-auto leading-relaxed">
              Tap the star icon (☆) on any product card in the <strong>Stock Explorer</strong> to pin your key equipment here for instant monitoring.
            </p>
          </div>
          <button id="go-to-explorer-btn" class="inline-flex items-center gap-1.5 px-4 py-2.5 bg-[#138FCB] text-white rounded-xl text-xs font-bold hover:bg-[#0f7cb3] transition-colors cursor-pointer shadow-xs active:scale-98">
            <span>📦</span>
            <span>Browse Stock Explorer</span>
          </button>
        </div>
      `}
    `;

    // Search input event
    const searchInput = document.getElementById('fav-search-input');
    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        this.searchQuery = e.target.value;
        this.renderFavouritesView();
        const reInput = document.getElementById('fav-search-input');
        if (reInput) {
          reInput.focus();
          reInput.setSelectionRange(reInput.value.length, reInput.value.length);
        }
      });
    }

    const clearBtn = document.getElementById('clear-fav-search-btn');
    if (clearBtn) {
      clearBtn.addEventListener('click', () => {
        this.searchQuery = '';
        this.renderFavouritesView();
      });
    }

    // Go to explorer button from empty state
    const goExplorerBtn = document.getElementById('go-to-explorer-btn');
    if (goExplorerBtn) {
      goExplorerBtn.addEventListener('click', () => {
        this.activeTab = 'stock-explorer';
        this.selectedCategoryId = null;
        this.searchQuery = '';

        document.querySelectorAll('.report-nav-item').forEach(b => {
          if (b.dataset.tab === 'stock-explorer') {
            b.className = 'report-nav-item flex flex-col items-center gap-1 text-[#138FCB] font-bold cursor-pointer';
          } else {
            b.className = 'report-nav-item flex flex-col items-center gap-1 text-slate-400 hover:text-slate-600 cursor-pointer';
          }
        });

        this.render();
      });
    }

    this.bindItemCardEvents();
  }

  // --- ITEM DETAIL BOTTOM SHEET MODAL ---

  openItemDetailModal(itemId) {
    const items = this.getInventoryItems();
    const item = items.find(it => it.id === itemId);
    if (!item) return;

    // Remove any existing modal
    const existingModal = document.getElementById('mobile-item-modal');
    if (existingModal) existingModal.remove();

    const isCostVisible = this.currentRole === 'owner' || this.currentRole === 'warehouse_manager';

    const modalHtml = `
      <div id="mobile-item-modal" class="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-xs transition-opacity animate-in fade-in duration-200">
        <div class="bg-white w-full sm:max-w-[390px] rounded-t-3xl sm:rounded-3xl p-4 sm:p-5 max-h-[85vh] overflow-y-auto space-y-4 shadow-2xl animate-in slide-in-from-bottom-5 duration-200">
          
          <!-- Header Bar with Close Button -->
          <div class="flex items-start justify-between gap-3 border-b border-slate-100 pb-3">
            <div>
              <span class="font-mono text-[10px] font-bold text-[#138FCB] uppercase tracking-wider block">${item.sku}</span>
              <h3 class="font-black text-base text-slate-900 leading-tight mt-0.5">${item.name}</h3>
              ${item.urduName ? `<span class="text-xs font-bold text-slate-500 font-urdu block mt-0.5">${item.urduName}</span>` : ''}
            </div>
            <button id="close-item-modal-btn" class="w-8 h-8 rounded-full bg-slate-100 text-slate-500 hover:bg-slate-200 flex items-center justify-center text-sm font-black cursor-pointer shrink-0">
              ✕
            </button>
          </div>

          <!-- Stock Distribution (Warehouse vs Office) -->
          <div class="space-y-2">
            <span class="text-[10px] uppercase font-black text-slate-400 tracking-wider block">Location Breakdown</span>
            
            <div class="grid grid-cols-2 gap-2">
              <div class="bg-amber-50/70 border border-amber-200/80 rounded-2xl p-3">
                <span class="text-[10px] font-bold text-amber-700 block">Warehouse (wh-1)</span>
                <div class="flex items-baseline gap-1 mt-1">
                  <span class="text-lg font-black text-amber-950">${item.qtyWH.toLocaleString()}</span>
                  <span class="text-[10px] font-bold text-amber-700">${item.unit}</span>
                </div>
              </div>

              <div class="bg-blue-50/70 border border-blue-200/80 rounded-2xl p-3">
                <span class="text-[10px] font-bold text-blue-700 block">Office (wh-2)</span>
                <div class="flex items-baseline gap-1 mt-1">
                  <span class="text-lg font-black text-blue-950">${item.qtyOffice.toLocaleString()}</span>
                  <span class="text-[10px] font-bold text-blue-700">${item.unit}</span>
                </div>
              </div>
            </div>

            <!-- Total Combined Pill -->
            <div class="bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 flex items-center justify-between">
              <span class="text-xs font-bold text-slate-600">Total Available Combined</span>
              <div class="flex items-baseline gap-1">
                <span class="text-sm font-black text-slate-900">${item.totalQty.toLocaleString()}</span>
                <span class="text-[10px] font-bold text-slate-500">${item.unit}</span>
              </div>
            </div>
          </div>

          <!-- Financial Valuations (Role Protected) -->
          <div class="bg-slate-50 rounded-2xl p-3 border border-slate-200 space-y-2">
            <span class="text-[10px] uppercase font-black text-slate-400 tracking-wider block">Financial Profile</span>
            
            ${isCostVisible ? `
              <div class="grid grid-cols-2 gap-2">
                <div>
                  <span class="text-[10px] text-slate-500 font-semibold block">Average Cost</span>
                  <span class="text-xs font-black text-slate-800">Rs. ${item.costPrice.toLocaleString()}</span>
                </div>
                <div>
                  <span class="text-[10px] text-slate-500 font-semibold block">Inventory Value</span>
                  <span class="text-xs font-black text-emerald-600">Rs. ${Math.round(item.stockValue).toLocaleString()}</span>
                </div>
              </div>
            ` : `
              <div class="py-1 flex items-center gap-2 text-slate-400">
                <span class="text-xs">🔒</span>
                <span class="text-[11px] font-bold italic">Cost & Valuation Redacted for ${this.currentRole}</span>
              </div>
            `}
          </div>

          <!-- Product Attributes -->
          ${Object.keys(item.attributes).length > 0 ? `
            <div class="space-y-1.5">
              <span class="text-[10px] uppercase font-black text-slate-400 tracking-wider block">Specifications</span>
              <div class="flex flex-wrap gap-1.5">
                ${Object.entries(item.attributes).map(([key, val]) => `
                  <span class="text-[10px] font-bold px-2 py-1 bg-slate-100 text-slate-700 rounded-lg">
                    ${key}: <span class="text-slate-900">${val}</span>
                  </span>
                `).join('')}
              </div>
            </div>
          ` : ''}

          <!-- Favorite Toggle Button in Modal -->
          <button id="modal-fav-toggle-btn" class="w-full py-2.5 px-3 rounded-xl border text-xs font-bold flex items-center justify-center gap-2 transition-colors cursor-pointer ${this.isFavorite(item.id) ? 'bg-amber-50 text-amber-800 border-amber-300 hover:bg-amber-100' : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'}">
            <span>${this.isFavorite(item.id) ? '★' : '☆'}</span>
            <span id="modal-fav-text">${this.isFavorite(item.id) ? 'Marked as Favourite (Tap to Remove)' : 'Mark as Favourite Product'}</span>
          </button>

          <!-- Close Action Button -->
          <button id="modal-dismiss-btn" class="w-full py-3 bg-[#138FCB] text-white rounded-xl text-xs font-extrabold hover:bg-[#0f7cb3] transition-colors cursor-pointer shadow-xs">
            Done
          </button>
        </div>
      </div>
    `;

    document.body.insertAdjacentHTML('beforeend', modalHtml);

    const closeBtn = document.getElementById('close-item-modal-btn');
    const dismissBtn = document.getElementById('modal-dismiss-btn');
    const favToggleBtn = document.getElementById('modal-fav-toggle-btn');
    const favText = document.getElementById('modal-fav-text');
    const modalBackdrop = document.getElementById('mobile-item-modal');

    const closeModal = () => {
      if (modalBackdrop) modalBackdrop.remove();
    };

    if (closeBtn) closeBtn.addEventListener('click', closeModal);
    if (dismissBtn) dismissBtn.addEventListener('click', closeModal);
    if (modalBackdrop) {
      modalBackdrop.addEventListener('click', (e) => {
        if (e.target === modalBackdrop) closeModal();
      });
    }

    if (favToggleBtn) {
      favToggleBtn.addEventListener('click', () => {
        this.toggleFavorite(item.id);
        const isFav = this.isFavorite(item.id);
        favToggleBtn.className = `w-full py-2.5 px-3 rounded-xl border text-xs font-bold flex items-center justify-center gap-2 transition-colors cursor-pointer ${isFav ? 'bg-amber-50 text-amber-800 border-amber-300 hover:bg-amber-100' : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'}`;
        favToggleBtn.innerHTML = `
          <span>${isFav ? '★' : '☆'}</span>
          <span>${isFav ? 'Marked as Favourite (Tap to Remove)' : 'Mark as Favourite Product'}</span>
        `;
      });
    }
  }

  // --- 3. BY LOCATION REPORT VIEW ---

  renderByLocationView() {
    const items = this.getInventoryItems();
    const totalWH = items.reduce((sum, it) => sum + it.qtyWH, 0);
    const totalOffice = items.reduce((sum, it) => sum + it.qtyOffice, 0);
    const totalAll = totalWH + totalOffice;

    this.contentEl.innerHTML = `
      <!-- Location Comparison Card -->
      <div class="bg-white rounded-2xl p-4 border border-slate-200 shadow-2xs space-y-3">
        <div class="flex items-center justify-between">
          <h3 class="text-xs font-extrabold text-slate-800 uppercase tracking-wider">Facility Allocation</h3>
          <span class="text-[10px] font-bold text-slate-400">2 Physical Hubs</span>
        </div>

        <!-- Comparative Progress Bar -->
        <div class="space-y-1">
          <div class="w-full h-3 bg-slate-100 rounded-full overflow-hidden flex">
            <div class="bg-amber-500 h-full transition-all" style="width: ${(totalWH / (totalAll || 1) * 100).toFixed(0)}%"></div>
            <div class="bg-blue-500 h-full transition-all" style="width: ${(totalOffice / (totalAll || 1) * 100).toFixed(0)}%"></div>
          </div>
          <div class="flex items-center justify-between text-[10px] font-bold pt-0.5">
            <span class="text-amber-700 flex items-center gap-1">
              <span class="w-2 h-2 rounded-full bg-amber-500"></span>
              Warehouse: ${totalWH.toLocaleString()} (${(totalWH / (totalAll || 1) * 100).toFixed(0)}%)
            </span>
            <span class="text-blue-700 flex items-center gap-1">
              <span class="w-2 h-2 rounded-full bg-blue-500"></span>
              Office: ${totalOffice.toLocaleString()} (${(totalOffice / (totalAll || 1) * 100).toFixed(0)}%)
            </span>
          </div>
        </div>
      </div>

      <!-- Itemized Distribution List -->
      <div class="space-y-2">
        <div class="flex items-center justify-between px-0.5">
          <h4 class="text-xs font-black text-slate-700 uppercase tracking-wider">SKU Multi-Facility Balance</h4>
          <span class="text-[10px] font-bold text-slate-400">${items.length} SKUs</span>
        </div>

        ${items.map(item => {
          const whPercent = item.totalQty > 0 ? (item.qtyWH / item.totalQty * 100).toFixed(0) : 0;
          return `
            <div class="bg-white rounded-2xl p-3 border border-slate-200 shadow-2xs space-y-2">
              <div class="flex items-center justify-between">
                <div>
                  <span class="font-mono text-[9px] font-bold text-slate-400 block">${item.sku}</span>
                  <h5 class="text-xs font-bold text-slate-900 leading-tight">${item.name}</h5>
                </div>
                <div class="text-right">
                  <span class="text-xs font-black text-slate-900">${item.totalQty.toLocaleString()}</span>
                  <span class="text-[9px] font-bold text-slate-400 block">${item.unit}</span>
                </div>
              </div>

              <!-- Location Split Row -->
              <div class="grid grid-cols-2 gap-2 text-[11px] pt-1.5 border-t border-slate-100">
                <div class="flex items-center justify-between bg-amber-50/50 px-2.5 py-1 rounded-lg border border-amber-100">
                  <span class="font-semibold text-amber-800 text-[10px]">Warehouse:</span>
                  <span class="font-black text-amber-950">${item.qtyWH}</span>
                </div>
                <div class="flex items-center justify-between bg-blue-50/50 px-2.5 py-1 rounded-lg border border-blue-100">
                  <span class="font-semibold text-blue-800 text-[10px]">Office:</span>
                  <span class="font-black text-blue-950">${item.qtyOffice}</span>
                </div>
              </div>
            </div>
          `;
        }).join('')}
      </div>
    `;
  }

  // --- 4. LOW STOCK REPORT VIEW ---

  renderLowStockView() {
    const items = this.getInventoryItems().filter(it => it.isLowStock);

    this.contentEl.innerHTML = `
      <!-- Low Stock Summary Banner -->
      <div class="bg-amber-50 border border-amber-200 rounded-2xl p-3.5 flex items-center justify-between">
        <div class="flex items-center gap-2.5">
          <div class="w-9 h-9 rounded-xl bg-amber-500 text-white flex items-center justify-center text-lg shadow-2xs">
            ⚠️
          </div>
          <div>
            <h3 class="text-xs font-extrabold text-amber-950">Safety Threshold Alerts</h3>
            <p class="text-[11px] text-amber-800/80 font-medium">${items.length} items require replenishment</p>
          </div>
        </div>
      </div>

      <!-- Low Stock Items List -->
      ${items.length === 0 ? `
        <div class="bg-white rounded-2xl p-8 text-center border border-slate-200 space-y-2">
          <span class="text-3xl block">✅</span>
          <h4 class="text-xs font-bold text-slate-700">All Stock Levels Optimal</h4>
          <p class="text-[11px] text-slate-400">No items currently violate safe minimum buffer thresholds.</p>
        </div>
      ` : `
        <div class="space-y-2">
          ${items.map(item => `
            <div class="bg-white rounded-2xl p-3 border border-amber-200 shadow-2xs space-y-2">
              <div class="flex items-start justify-between">
                <div>
                  <span class="font-mono text-[9px] font-bold text-amber-700 uppercase bg-amber-50 px-1.5 py-0.5 rounded">${item.sku}</span>
                  <h4 class="text-xs font-bold text-slate-900 mt-1">${item.name}</h4>
                </div>
                <span class="text-[10px] font-black px-2 py-0.5 rounded-full bg-rose-100 text-rose-800">
                  Critical
                </span>
              </div>

              <div class="grid grid-cols-2 gap-2 bg-slate-50 p-2 rounded-xl text-[10px]">
                <div>
                  <span class="text-slate-400 font-semibold block">Available Stock</span>
                  <span class="font-black text-rose-600 text-xs">${item.availableQty} ${item.unit}</span>
                </div>
                <div>
                  <span class="text-slate-400 font-semibold block">Minimum Buffer</span>
                  <span class="font-black text-slate-800 text-xs">${item.lowStockLevel} ${item.unit}</span>
                </div>
              </div>
            </div>
          `).join('')}
        </div>
      `}
    `;
  }

  // --- 5. MOVEMENTS AUDIT LOG VIEW ---

  renderMovementsView() {
    const movements = storageService.getCollection('stockMovements') || [];
    const warehouses = storageService.getCollection('warehouses') || [];
    const whMap = new Map(warehouses.map(w => [w.id, w.name]));

    this.contentEl.innerHTML = `
      <!-- Header Summary -->
      <div class="flex items-center justify-between px-0.5">
        <div>
          <h3 class="text-xs font-extrabold text-slate-800 uppercase tracking-wider">Movement Timeline</h3>
          <p class="text-[11px] text-slate-400 font-medium">Audited physical stock transactions</p>
        </div>
        <span class="text-[10px] font-bold text-slate-500 bg-slate-100 px-2 py-0.5 rounded-full">
          ${movements.length} Records
        </span>
      </div>

      <!-- Movement Records Feed -->
      <div class="space-y-2.5">
        ${movements.slice().reverse().map(m => {
          const typeBadge = m.movementType.includes('inward') || m.movementType.includes('opening')
            ? 'bg-emerald-100 text-emerald-800'
            : 'bg-blue-100 text-blue-800';

          return `
            <div class="bg-white rounded-2xl p-3.5 border border-slate-200 shadow-2xs space-y-2">
              <div class="flex items-center justify-between">
                <div class="flex items-center gap-1.5">
                  <span class="font-mono text-[10px] font-black text-slate-700">${m.movementNumber}</span>
                  <span class="text-[9px] font-extrabold uppercase px-1.5 py-0.5 rounded-md ${typeBadge}">
                    ${m.movementType.replace('_', ' ')}
                  </span>
                </div>
                <span class="text-[10px] font-semibold text-slate-400">
                  ${m.date ? new Date(m.date).toLocaleDateString() : 'Recent'}
                </span>
              </div>

              <div class="text-[11px] text-slate-600 font-medium flex items-center gap-2">
                <span>🏢 Hub: <strong>${whMap.get(m.warehouseId) || 'Warehouse'}</strong></span>
                ${m.referenceDocId ? `<span>• Ref: ${m.referenceDocId}</span>` : ''}
              </div>

              <!-- Lines Summary -->
              ${(m.lines || []).length > 0 ? `
                <div class="pt-1.5 border-t border-slate-100 space-y-1">
                  ${m.lines.slice(0, 3).map(l => `
                    <div class="flex items-center justify-between text-[10px] text-slate-500">
                      <span class="truncate max-w-[190px] font-medium">• ${l.variantId || 'Stock Item'}</span>
                      <span class="font-bold text-slate-800">${l.quantity > 0 ? '+' : ''}${l.quantity} ${l.unit || 'PCS'}</span>
                    </div>
                  `).join('')}
                </div>
              ` : ''}
            </div>
          `;
        }).join('')}
      </div>
    `;
  }

  // --- 6. EXECUTIVE: ALL CUSTOMER LEDGERS & AGING RECEIVABLES ---

  renderCustomerLedgersView() {
    const customers = salesService.getParties(true);
    const totalReceivables = customers.reduce((sum, c) => sum + (c.currentBalance || 35000), 0);

    this.contentEl.innerHTML = `
      <div class="space-y-4">
        <!-- Executive Debtor Summary -->
        <div class="bg-gradient-to-r from-blue-900 to-indigo-950 p-4 rounded-2xl text-white shadow-md space-y-3">
          <div class="flex items-center justify-between">
            <span class="text-[10px] font-extrabold uppercase tracking-widest text-blue-300">Executive Receivables</span>
            <span class="px-2 py-0.5 rounded-full text-[9px] font-black bg-blue-500/20 text-blue-200">Total Portfolio</span>
          </div>
          <div>
            <div class="text-2xl font-black tracking-tight">PKR ${totalReceivables.toLocaleString()}</div>
            <div class="text-xs text-blue-200 font-medium mt-0.5">Across ${customers.length} commercial poultry accounts</div>
          </div>
          
          <!-- Aging Analysis Breakdown Bar -->
          <div class="pt-2 border-t border-white/10 grid grid-cols-3 gap-2 text-center">
            <div class="bg-white/10 p-2 rounded-xl">
              <span class="text-[9px] uppercase font-bold text-emerald-300 block">0-30 Days</span>
              <span class="text-xs font-black">65%</span>
            </div>
            <div class="bg-white/10 p-2 rounded-xl">
              <span class="text-[9px] uppercase font-bold text-amber-300 block">31-60 Days</span>
              <span class="text-xs font-black">25%</span>
            </div>
            <div class="bg-white/10 p-2 rounded-xl">
              <span class="text-[9px] uppercase font-bold text-rose-300 block">60+ Days</span>
              <span class="text-xs font-black">10%</span>
            </div>
          </div>
        </div>

        <!-- Customer Accounts List -->
        <div class="space-y-2">
          <div class="text-xs font-extrabold text-slate-800 px-1">Customer Accounts (${customers.length})</div>
          ${customers.map(c => {
            const bal = c.currentBalance || 35000;
            return `
              <div class="bg-white p-3.5 rounded-2xl border border-slate-200 shadow-2xs flex items-center justify-between gap-3">
                <div class="space-y-0.5">
                  <div class="font-bold text-xs text-slate-900">${c.name}</div>
                  <div class="text-[10px] text-slate-400 font-medium">📍 ${c.city || 'Punjab'} • ${c.phone || '+92 300 0000000'}</div>
                  <div class="text-[10px] text-slate-500">Credit Limit: PKR ${(c.creditLimit || 500000).toLocaleString()}</div>
                </div>
                <div class="text-right">
                  <div class="text-xs font-black ${bal > 0 ? 'text-rose-600' : 'text-emerald-600'}">
                    PKR ${bal.toLocaleString()}
                  </div>
                  <span class="px-2 py-0.5 rounded text-[9px] font-bold ${bal > 0 ? 'bg-rose-50 text-rose-700' : 'bg-emerald-50 text-emerald-700'}">
                    ${bal > 0 ? 'Due' : 'Clear'}
                  </span>
                </div>
              </div>
            `;
          }).join('')}
        </div>
      </div>
    `;
  }

  // --- 7. EXECUTIVE: IMPORT SHIPMENTS & CONTAINER TRACKING ---

  renderShipmentsTrackingView() {
    const shipments = purchasingService.getImportShipments();

    this.contentEl.innerHTML = `
      <div class="space-y-4">
        <!-- Shipments Summary Card -->
        <div class="bg-gradient-to-r from-slate-900 via-blue-950 to-indigo-950 p-4 rounded-2xl text-white shadow-md space-y-2.5">
          <div class="flex items-center justify-between">
            <span class="text-[10px] font-extrabold uppercase tracking-widest text-blue-300 flex items-center gap-1.5">
              <span>📡</span>
              <span>Tracktainer Telemetry</span>
            </span>
            <span class="px-2 py-0.5 rounded-full text-[9px] font-black bg-blue-500/20 text-blue-200 border border-blue-400/30">
              API CONNECTED
            </span>
          </div>
          <div class="flex items-center justify-between">
            <div>
              <div class="text-2xl font-black tracking-tight">${shipments.filter(s => s.status !== 'Cancelled').length} In-Transit Cargo</div>
              <div class="text-[11px] text-blue-200/80 font-medium mt-0.5">Maritime vessel tracking &amp; automated milestone updates</div>
            </div>
            <button id="refresh-tracktainer-btn" class="w-8 h-8 rounded-xl bg-white/10 hover:bg-white/20 active:scale-95 text-white flex items-center justify-center text-sm font-bold transition-all cursor-pointer" title="Sync with Tracktainer API">
              🔄
            </button>
          </div>
        </div>

        <!-- Shipments Cards -->
        <div class="space-y-3">
          ${shipments.length === 0 ? `
            <div class="bg-white rounded-3xl p-8 text-center border border-slate-200 shadow-2xs space-y-2">
              <span class="text-3xl block">🚢</span>
              <h4 class="text-sm font-extrabold text-slate-800">No Active Ocean Shipments</h4>
              <p class="text-xs text-slate-400">Register import containers in Main ERP to view automated tracking.</p>
            </div>
          ` : shipments.map(s => {
            const daysLeft = s.transitTime || 33;
            const etaFormatted = s.eta ? new Date(s.eta).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : 'Oct 3, 2026';
            const isDelayed = s.delayDays > 0;

            return `
              <div class="shipment-card bg-white p-4 rounded-3xl border border-slate-200/90 shadow-2xs space-y-3 hover:border-[#138FCB] hover:shadow-md transition-all cursor-pointer active:scale-[0.99]" data-id="${s.id}">
                <!-- Top Line: Container # & Status -->
                <div class="flex items-center justify-between">
                  <div class="flex items-center gap-2.5">
                    <div class="w-10 h-10 rounded-2xl bg-blue-50 text-[#138FCB] flex items-center justify-center text-xl font-bold border border-blue-100/70 shadow-2xs">
                      🚢
                    </div>
                    <div>
                      <div class="flex items-center gap-1.5">
                        <h4 class="text-sm font-black text-slate-900 font-mono tracking-tight">${s.containerNumber}</h4>
                        <span class="px-1.5 py-0.5 rounded text-[8px] font-black bg-blue-50 text-blue-700">TRACKTAINER</span>
                      </div>
                      <span class="text-[11px] text-slate-400 font-medium">${s.carrierName || 'TS Lines'} • BL: ${s.blNumber || 'BL-TXZJ'}</span>
                    </div>
                  </div>
                  <div class="text-right">
                    <span class="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-black ${s.status === 'Cancelled' ? 'bg-rose-50 text-rose-700 border border-rose-200' : 'bg-emerald-50 text-emerald-700 border border-emerald-200'}">
                      <span class="w-1.5 h-1.5 rounded-full ${s.status === 'Cancelled' ? 'bg-rose-500' : 'bg-emerald-500'} animate-pulse"></span>
                      <span>${s.status === 'Cancelled' ? 'Cancelled' : '● IN TRANSIT'}</span>
                    </span>
                  </div>
                </div>

                <!-- Port Route Flow -->
                <div class="bg-slate-50/80 p-3 rounded-2xl border border-slate-100 space-y-2">
                  <div class="flex items-center justify-between text-xs font-bold text-slate-800">
                    <div class="space-y-0.5">
                      <span class="text-[9px] font-bold uppercase text-slate-400 block tracking-wider">POL</span>
                      <span>${s.originPort || 'Qingdao'}</span>
                    </div>
                    <div class="flex flex-col items-center">
                      <span class="text-[9px] font-extrabold text-blue-600 bg-blue-50 px-2 py-0.5 rounded-full border border-blue-100">${daysLeft} days direct</span>
                      <span class="text-slate-400 text-xs mt-0.5">➔</span>
                    </div>
                    <div class="space-y-0.5 text-right">
                      <span class="text-[9px] font-bold uppercase text-slate-400 block tracking-wider">POD</span>
                      <span>${s.destinationPort || 'Karachi'}</span>
                    </div>
                  </div>

                  <!-- Live Waypoint Ping -->
                  <div class="pt-2 border-t border-slate-200/60 flex items-center justify-between text-[11px]">
                    <div class="flex items-center gap-1.5 text-blue-700 font-semibold truncate max-w-[240px]">
                      <span>📍</span>
                      <span class="truncate">${s.currentLocation || 'Malacca Strait / Southbound'}</span>
                    </div>
                    <span class="text-[10px] font-bold ${isDelayed ? 'text-amber-600' : 'text-emerald-700'}">
                      ${isDelayed ? `Delayed ${s.delayDays}d` : '● On Time'}
                    </span>
                  </div>
                </div>

                <!-- Footer: ETA & Tap Prompt -->
                <div class="flex items-center justify-between pt-1 text-[11px] font-medium text-slate-500">
                  <span>ETA: <strong class="text-slate-800 font-bold">${etaFormatted}</strong></span>
                  <span class="text-[#138FCB] font-extrabold flex items-center gap-1 text-[10px] hover:translate-x-0.5 transition-transform">
                    <span>Inspect Ocean Route Map</span>
                    <span>➔</span>
                  </span>
                </div>
              </div>
            `;
          }).join('')}
        </div>
      </div>
    `;

    // Bind card tap events
    this.contentEl.querySelectorAll('.shipment-card').forEach(card => {
      card.addEventListener('click', (e) => {
        const id = card.dataset.id;
        const targetShipment = shipments.find(s => s.id === id);
        if (targetShipment) {
          this.openShipmentTrackingGraphicsModal(targetShipment);
        }
      });
    });

    // Refresh button event
    const refreshBtn = document.getElementById('refresh-tracktainer-btn');
    if (refreshBtn) {
      refreshBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        refreshBtn.classList.add('animate-spin');
        try {
          const res = await fetch('/api/tracking/sync', { method: 'POST' });
          if (res.ok) {
            const data = await res.json();
            if (data.shipments) {
              data.shipments.forEach(s => storageService.update('importShipments', s.id, s));
            }
          }
        } catch (err) {
          console.warn('Sync failed:', err);
        }
        setTimeout(() => {
          refreshBtn.classList.remove('animate-spin');
          this.render();
        }, 800);
      });
    }
  }

  // --- 8. GRAPHICAL LIVE OCEAN TRACKING MODAL (MATCHES USER SCREENSHOT 1:1) ---

  openShipmentTrackingGraphicsModal(shipment) {
    openTrackingGraphicsModal(shipment);
  }
}

// Instantiate and expose globally
document.addEventListener('DOMContentLoaded', () => {
  window.mobileReportsApp = new MobileReportsApp();
});
