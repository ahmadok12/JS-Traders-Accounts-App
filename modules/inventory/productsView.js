/**
 * JS Traders ERP - Products Master View (Redesigned)
 * - Horizontal Category Tabs at top starting with "All"
 * - Small down arrow dropdown menu on right: "Add Category" & "Edit Categories"
 * - Unified Edit Categories Dialog allowing both editing details and rearranging order
 * - Categorized product listing under each category
 * - 3 Variant View Modes:
 *     i) Products without variants
 *    ii) All products + variants (with inline expandable SKU breakdown)
 *   iii) Only products that have variants
 * - Live search field (business, customer, Urdu name, SKU, code)
 * - Product type filtering & active status controls
 * - 3-Tier Product Naming (Business, Customer, Urdu)
 * - Cut-to-length / roll tracking multi-packaging support
 */

import { productService } from '../../services/productService.js';
import { storageService } from '../../services/storageService.js';
import { inventoryService } from '../../services/inventoryService.js';
import { cutToLengthService } from '../../services/cutToLengthService.js';
import { openCategoryModal } from './categoriesView.js';
import { openModal, closeModal } from '../../components/modal.js';
import { confirmAction } from '../../components/confirmation.js';
import { toast } from '../../components/toast.js';
import { renderCustomDropdown } from '../../components/filters.js';

// Module state for persistent tab & filter memory during session
let currentCategoryId = 'all';
let currentVariantFilter = 'all_with_variants'; // 'all_with_variants' | 'with_variants' | 'without_variant'
let currentSearchQuery = '';
let currentProductType = 'all';
let expandedProductIds = new Set();
let isAllExpanded = false;

export function renderProductsView() {
  const products = productService.getProducts();
  const categories = productService.getCategories();
  const allVariants = productService.getVariants();

  // Compute category product counts
  const categoryCounts = new Map();
  categories.forEach(c => categoryCounts.set(c.id, 0));
  products.forEach(p => {
    if (categoryCounts.has(p.categoryId)) {
      categoryCounts.set(p.categoryId, (categoryCounts.get(p.categoryId) || 0) + 1);
    }
  });

  // Compute variant mode counts
  const prodVariantMap = new Map();
  products.forEach(p => {
    const vars = allVariants.filter(v => v.productId === p.id);
    prodVariantMap.set(p.id, vars);
  });

  const totalProducts = products.length;
  const withVariantsCount = products.filter(p => (prodVariantMap.get(p.id) || []).length > 0).length;
  const withoutVariantsCount = totalProducts - withVariantsCount;

  return `
    <div id="products-view-container" class="space-y-4 animate-in fade-in duration-150">
      
      <!-- TOP: CATEGORY TABS & ACTION DROPDOWN BAR -->
      <div class="bg-white p-3 sm:p-4 rounded-2xl border border-[#EAECEF] shadow-[0_2px_4px_rgba(0,0,0,0.02)]">
        <div class="flex items-center justify-between gap-3">
          
          <!-- Category Tabs Horizontal Slider -->
          <div class="flex items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0 scrollbar-thin flex-1 min-w-0" id="category-tabs-container">
            <!-- "All" Tab -->
            <button
              type="button"
              data-cat-id="all"
              class="cat-tab-btn shrink-0 inline-flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs transition-all cursor-pointer ${
                currentCategoryId === 'all'
                  ? 'bg-[#138FCB] text-white font-bold shadow-xs'
                  : 'bg-slate-100 hover:bg-slate-200/80 text-slate-700 font-semibold'
              }">
              <span>All Products</span>
              <span class="inline-flex items-center justify-center px-1.5 py-0.5 text-[10px] rounded-full font-mono font-bold ${
                currentCategoryId === 'all' ? 'bg-white/25 text-white' : 'bg-slate-200 text-slate-700'
              }">${totalProducts}</span>
            </button>

            <!-- Dynamic Category Tabs -->
            ${categories.map(cat => {
              const count = categoryCounts.get(cat.id) || 0;
              const isActive = currentCategoryId === cat.id;
              return `
                <button
                  type="button"
                  data-cat-id="${cat.id}"
                  class="cat-tab-btn shrink-0 inline-flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs transition-all cursor-pointer ${
                    isActive
                      ? 'bg-[#138FCB] text-white font-bold shadow-xs'
                      : 'bg-slate-100 hover:bg-slate-200/80 text-slate-700 font-semibold'
                  }">
                  <span>${cat.name}</span>
                  <span class="inline-flex items-center justify-center px-1.5 py-0.5 text-[10px] rounded-full font-mono font-bold ${
                    isActive ? 'bg-white/25 text-white' : 'bg-slate-200 text-slate-700'
                  }">${count}</span>
                </button>
              `;
            }).join('')}
          </div>

          <!-- Small Down Arrow Dropdown Menu Trigger -->
          <div class="relative shrink-0" id="category-menu-wrapper">
            <button
              id="category-menu-toggle-btn"
              type="button"
              class="inline-flex items-center justify-center w-8 h-8 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 transition-colors shadow-2xs border border-slate-200 cursor-pointer"
              title="Category actions">
              <svg class="w-3.5 h-3.5 text-slate-600 transition-transform duration-150" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M19 9l-7 7-7-7" />
              </svg>
            </button>

            <!-- Dropdown Menu -->
            <div
              id="category-dropdown-menu"
              class="hidden absolute right-0 top-full mt-1.5 w-44 bg-white rounded-xl shadow-lg border border-slate-200 py-1.5 z-40 animate-in fade-in zoom-in-95 duration-100">
              <button
                id="menu-add-category-btn"
                type="button"
                class="w-full text-left px-3.5 py-2 text-xs font-semibold text-slate-700 hover:bg-blue-50 hover:text-[#138FCB] flex items-center gap-2 transition-colors cursor-pointer">
                <span class="text-sm font-extrabold text-[#138FCB] leading-none">+</span>
                <span>Add Category</span>
              </button>
              <button
                id="menu-edit-categories-btn"
                type="button"
                class="w-full text-left px-3.5 py-2 text-xs font-semibold text-slate-700 hover:bg-blue-50 hover:text-[#138FCB] flex items-center gap-2 transition-colors cursor-pointer border-t border-slate-100">
                <span class="text-xs">✏️</span>
                <span>Edit Categories</span>
              </button>
            </div>
          </div>

        </div>
      </div>

      <!-- FILTER CONTROLS & 3-WAY VARIANT VIEW BAR -->
      <div class="flex flex-col xl:flex-row xl:items-center justify-between gap-3 bg-white p-3 sm:p-4 rounded-2xl border border-[#EAECEF] shadow-[0_2px_4px_rgba(0,0,0,0.02)]">
        
        <!-- Left: Search & Product Type -->
        <div class="flex flex-wrap items-center gap-2.5 flex-1 min-w-0">
          <!-- Search Field -->
          <div class="relative flex-1 min-w-[220px] max-w-md">
            <svg class="w-3.5 h-3.5 text-gray-400 absolute left-3 top-3 pointer-events-none" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"></path>
            </svg>
            <input
              id="product-search-input"
              class="w-full pl-8 pr-4 py-2 text-xs bg-white border border-[#E2E5EA] rounded-xl focus:outline-none focus:border-[#138FCB] placeholder-gray-400 shadow-2xs transition-colors"
              placeholder="Search by Business, Customer, Urdu name, SKU or code..."
              value="${currentSearchQuery}"
              type="text">
          </div>

          <!-- Product Type Dropdown (Rounded Card Theme) -->
          <div class="flex items-center gap-1.5 shrink-0">
            <label class="text-[11px] font-bold text-slate-400 uppercase tracking-wider hidden sm:inline">Type:</label>
            ${renderCustomDropdown({
              id: 'product-type-filter',
              value: currentProductType,
              label: 'All Types',
              options: [
                { value: 'all', label: 'All Types' },
                { value: 'Stock', label: 'Stock Item' },
                { value: 'Non-Stock', label: 'Non-Stock Item' },
                { value: 'Service', label: 'Service' }
              ]
            })}
          </div>
        </div>

        <!-- Right: 3 Variant View Modes & + Add Product -->
        <div class="flex flex-wrap items-center gap-2.5 shrink-0">
          
          <!-- Option i, ii, iii: Variant Display Mode Segmented Switcher -->
          <div class="inline-flex p-1 bg-slate-100 rounded-xl border border-slate-200/70 text-xs font-semibold" id="variant-filter-mode-group">
            <button
              type="button"
              data-variant-mode="all_with_variants"
              class="variant-mode-btn inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition-all cursor-pointer ${
                currentVariantFilter === 'all_with_variants'
                  ? 'bg-white text-slate-900 font-bold shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }"
              title="Show all products and their associated variants">
              <span>All Products (+ Variants)</span>
              <span class="text-[10px] px-1.5 py-0.2 rounded-full font-mono ${
                currentVariantFilter === 'all_with_variants' ? 'bg-blue-50 text-[#138FCB] font-bold' : 'bg-slate-200 text-slate-600'
              }">${totalProducts}</span>
            </button>

            <button
              type="button"
              data-variant-mode="with_variants"
              class="variant-mode-btn inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition-all cursor-pointer ${
                currentVariantFilter === 'with_variants'
                  ? 'bg-white text-[#138FCB] font-bold shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }"
              title="Show only products that have at least 1 variant SKU defined">
              <span>With Variants</span>
              <span class="text-[10px] px-1.5 py-0.2 rounded-full font-mono ${
                currentVariantFilter === 'with_variants' ? 'bg-blue-100 text-[#138FCB] font-bold' : 'bg-slate-200 text-slate-600'
              }">${withVariantsCount}</span>
            </button>

            <button
              type="button"
              data-variant-mode="without_variant"
              class="variant-mode-btn inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition-all cursor-pointer ${
                currentVariantFilter === 'without_variant'
                  ? 'bg-white text-amber-700 font-bold shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }"
              title="Show only products without any variants">
              <span>Without Variant</span>
              <span class="text-[10px] px-1.5 py-0.2 rounded-full font-mono ${
                currentVariantFilter === 'without_variant' ? 'bg-amber-100 text-amber-800 font-bold' : 'bg-slate-200 text-slate-600'
              }">${withoutVariantsCount}</span>
            </button>
          </div>

          <!-- Expand / Collapse All Variants Toggle Button -->
          <button
            id="toggle-expand-all-btn"
            type="button"
            class="${currentVariantFilter === 'without_variant' ? 'hidden' : 'inline-flex'} items-center gap-1.5 px-3 py-2 text-xs font-semibold text-slate-700 bg-white hover:bg-slate-50 border border-slate-200 rounded-xl transition-all shadow-2xs cursor-pointer"
            title="Expand or collapse nested SKU breakdown for all products">
            <span id="expand-all-icon">${isAllExpanded ? '▲' : '▼'}</span>
            <span id="expand-all-text">${isAllExpanded ? 'Collapse All' : 'Expand SKUs'}</span>
          </button>

          <!-- Primary + Add Product Master Action -->
          <button
            id="add-product-primary-btn"
            type="button"
            class="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-bold bg-[#138FCB] text-white rounded-xl hover:bg-[#0E78AC] transition-colors shadow-xs cursor-pointer">
            <span class="text-sm font-extrabold leading-none">+</span>
            <span>Add Product</span>
          </button>
        </div>

      </div>

      <!-- PRODUCTS TABLE & NESTED VARIANTS CONTAINER -->
      <div id="products-table-container">
        <!-- Rendered reactively via renderProductsTableContent() -->
      </div>

    </div>
  `;
}

/**
 * Filter products based on current view state
 */
function getFilteredProducts() {
  const products = productService.getProducts();
  const allVariants = productService.getVariants();

  // Create variant map
  const varMap = new Map();
  allVariants.forEach(v => {
    if (!varMap.has(v.productId)) varMap.set(v.productId, []);
    varMap.get(v.productId).push(v);
  });

  return products.filter(product => {
    // 1. Category Filter
    if (currentCategoryId !== 'all' && product.categoryId !== currentCategoryId) {
      return false;
    }

    // 2. Product Type Filter
    if (currentProductType !== 'all' && (product.productType || 'Stock') !== currentProductType) {
      return false;
    }

    // 3. Variant Option Filter
    const productVariants = varMap.get(product.id) || [];
    if (currentVariantFilter === 'without_variant' && productVariants.length > 0) {
      return false;
    }
    if (currentVariantFilter === 'with_variants' && productVariants.length === 0) {
      return false;
    }

    // 4. Search Filter
    if (currentSearchQuery) {
      const q = currentSearchQuery.toLowerCase();
      const inBusiness = product.businessName?.toLowerCase().includes(q);
      const inCustomer = product.customerName?.toLowerCase().includes(q);
      const inUrdu = product.urduName && product.urduName.includes(q);
      const inCode = product.code?.toLowerCase().includes(q);
      
      // Match against variant details
      const inVariants = productVariants.some(v => 
        v.sku?.toLowerCase().includes(q) ||
        v.name?.toLowerCase().includes(q) ||
        Object.values(v.attributes || {}).some(val => String(val).toLowerCase().includes(q))
      );

      if (!inBusiness && !inCustomer && !inUrdu && !inCode && !inVariants) {
        return false;
      }
    }

    return true;
  });
}

/**
 * Renders the products table with interactive variant expandable sub-rows
 */
function renderProductsTableContent(filteredProducts, categories) {
  const catMap = new Map(categories.map(c => [c.id, c.name]));
  const allVariants = productService.getVariants();
  const varMap = new Map();
  allVariants.forEach(v => {
    if (!varMap.has(v.productId)) varMap.set(v.productId, []);
    varMap.get(v.productId).push(v);
  });

  if (!filteredProducts || filteredProducts.length === 0) {
    let emptyMsg = 'No products found matching your current filter criteria.';
    if (currentVariantFilter === 'without_variant') {
      emptyMsg = 'Great! All products currently have at least one variant SKU defined.';
    } else if (currentCategoryId !== 'all') {
      const cat = categories.find(c => c.id === currentCategoryId);
      emptyMsg = `No products assigned to category "${cat ? cat.name : 'Selected'}" yet. Click "+ Add Product" to add one.`;
    }

    return `
      <div class="bg-white rounded-2xl p-12 border border-[#EAECEF] text-center shadow-xs">
        <div class="w-12 h-12 rounded-full bg-slate-100 text-slate-400 mx-auto flex items-center justify-center text-xl mb-3">📦</div>
        <h4 class="text-sm font-bold text-slate-700">No Products Found</h4>
        <p class="text-xs text-slate-400 mt-1 max-w-md mx-auto">${emptyMsg}</p>
        <div class="mt-4 flex items-center justify-center gap-2">
          ${currentCategoryId !== 'all' ? `
            <button id="empty-clear-cat-btn" class="px-3 py-1.5 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-xl transition-colors cursor-pointer">
              Show All Categories
            </button>
          ` : ''}
          <button id="empty-add-prod-btn" class="px-3.5 py-1.5 text-xs font-bold text-white bg-[#138FCB] hover:bg-[#0E78AC] rounded-xl transition-colors shadow-xs cursor-pointer">
            + Add Product
          </button>
        </div>
      </div>
    `;
  }

  return `
    <div class="bg-white rounded-2xl border border-[#EAECEF] shadow-[0_2px_4px_rgba(0,0,0,0.02)] overflow-hidden">
      <div class="overflow-x-auto">
        <table class="w-full text-left text-xs text-[#6F767E]">
          <thead>
            <tr class="border-b border-[#ECEEF2] text-[11px] uppercase font-bold text-gray-400 tracking-wider bg-slate-50/60">
              <th class="py-3 px-3 w-10 text-center">#</th>
              <th class="py-3 px-4">Product ID</th>
              <th class="py-3 px-4">Business Name (Internal)</th>
              <th class="py-3 px-4">Customer Name / Urdu</th>
              <th class="py-3 px-4">Category</th>
              <th class="py-3 px-4">Type</th>
              <th class="py-3 px-4">Tracking Mode</th>
              <th class="py-3 px-4 text-center">SKUs / Variants</th>
              <th class="py-3 px-4 text-center">Status</th>
              <th class="py-3 px-4 text-right">Actions</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-[#F4F5F7]">
            ${filteredProducts.map((prod) => {
              const variants = varMap.get(prod.id) || [];
              const hasVariants = variants.length > 0;
              const isExpanded = isAllExpanded || expandedProductIds.has(prod.id);
              const isCutToLength = !!(prod.cut_to_length || prod.enableRollTracking);

              return `
                <!-- Main Product Master Row -->
                <tr class="hover:bg-blue-50/30 transition-colors ${isExpanded ? 'bg-blue-50/20' : ''}" data-prod-id="${prod.id}">
                  <!-- Expand/Collapse Chevron -->
                  <td class="py-3 px-3 text-center">
                    ${hasVariants ? `
                      <button
                        type="button"
                        class="toggle-single-prod-expand-btn w-6 h-6 inline-flex items-center justify-center rounded-lg text-slate-400 hover:text-[#138FCB] hover:bg-blue-50 transition-colors cursor-pointer"
                        data-prod-id="${prod.id}"
                        title="${isExpanded ? 'Collapse variant list' : 'Expand variant list'}">
                        <span class="text-[10px] transform ${isExpanded ? 'rotate-90 text-[#138FCB] font-bold' : ''} transition-transform">▶</span>
                      </button>
                    ` : `
                      <span class="text-slate-300 text-[10px]">•</span>
                    `}
                  </td>

                  <!-- Product ID -->
                  <td class="py-3 px-4 whitespace-nowrap">
                    <span class="font-bold text-[#138FCB] font-mono">${prod.code}</span>
                  </td>

                  <!-- Business Name -->
                  <td class="py-3 px-4 font-bold text-slate-800">
                    <span class="hover:text-[#138FCB] cursor-pointer prod-name-click" data-prod-id="${prod.id}">${prod.businessName}</span>
                  </td>

                  <!-- Customer Name & Urdu -->
                  <td class="py-3 px-4">
                    <div class="font-semibold text-slate-700">${prod.customerName}</div>
                    ${prod.urduName ? `
                      <div class="text-[11px] font-serif text-slate-500 font-bold" dir="rtl">${prod.urduName}</div>
                    ` : ''}
                  </td>

                  <!-- Category Badge -->
                  <td class="py-3 px-4 whitespace-nowrap">
                    <span class="px-2.5 py-1 rounded-lg bg-slate-100 text-slate-700 text-[10px] font-semibold">
                      ${catMap.get(prod.categoryId) || 'Unassigned'}
                    </span>
                  </td>

                  <!-- Product Type -->
                  <td class="py-3 px-4 whitespace-nowrap">
                    <span class="font-medium text-slate-600">${prod.productType || 'Stock'}</span>
                  </td>

                  <!-- Tracking Mode -->
                  <td class="py-3 px-4 whitespace-nowrap">
                    ${isCutToLength ? `
                      <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-50 text-blue-700 border border-blue-200">
                        <span>📏</span>
                        <span>Cut to Length</span>
                      </span>
                    ` : `
                      <span class="text-slate-400 text-[11px]">Standard Qty</span>
                    `}
                  </td>

                  <!-- Variants Count Badge (Clickable to toggle expand) -->
                  <td class="py-3 px-4 text-center whitespace-nowrap">
                    ${hasVariants ? `
                      <button
                        type="button"
                        class="toggle-single-prod-expand-btn px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-blue-50 hover:bg-blue-100 text-[#138FCB] border border-blue-200 transition-colors cursor-pointer inline-flex items-center gap-1"
                        data-prod-id="${prod.id}">
                        <span>${variants.length} SKU${variants.length !== 1 ? 's' : ''}</span>
                        <span class="text-[8px]">${isExpanded ? '▲' : '▼'}</span>
                      </button>
                    ` : `
                      <span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-50 text-amber-700 border border-amber-200">
                        0 SKUs
                      </span>
                    `}
                  </td>

                  <!-- Status -->
                  <td class="py-3 px-4 text-center whitespace-nowrap">
                    <span class="px-2.5 py-0.5 rounded-full text-[10px] font-bold ${
                      prod.isActive
                        ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                        : 'bg-rose-50 text-rose-700 border border-rose-200'
                    }">
                      ${prod.isActive ? 'Active' : 'Inactive'}
                    </span>
                  </td>

                  <!-- Actions -->
                  <td class="py-3 px-4 text-right whitespace-nowrap">
                    <div class="flex items-center justify-end gap-1.5">
                      <button
                        class="view-product-btn px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-slate-100 hover:bg-slate-200 text-slate-700 transition-colors cursor-pointer"
                        data-prod-id="${prod.id}"
                        title="View master specification card">
                        View
                      </button>
                      <button
                        class="add-variant-btn px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-blue-50 hover:bg-blue-100 text-[#138FCB] border border-blue-200/80 transition-colors cursor-pointer"
                        data-prod-id="${prod.id}"
                        title="Add a new SKU variant">
                        + Variant
                      </button>
                      <button
                        class="edit-product-btn px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 transition-colors cursor-pointer"
                        data-prod-id="${prod.id}"
                        title="Edit product master details">
                        Edit
                      </button>
                    </div>
                  </td>
                </tr>

                <!-- Nested Variants Accordion Sub-Row -->
                ${isExpanded ? `
                  <tr class="bg-slate-50/70 border-b border-slate-200/80">
                    <td colspan="10" class="p-3 sm:p-4">
                      <div class="bg-white rounded-xl p-3.5 border border-slate-200 shadow-2xs space-y-3">
                        <div class="flex items-center justify-between pb-2 border-b border-slate-100">
                          <div class="flex items-center gap-2">
                            <span class="text-xs font-bold text-slate-700 flex items-center gap-1.5">
                              <span>🏷️</span>
                              <span>Defined Variants &amp; Stock for "${prod.businessName}"</span>
                            </span>
                            <span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-50 text-[#138FCB] border border-blue-200 font-mono">
                              ${variants.length} SKU${variants.length !== 1 ? 's' : ''}
                            </span>
                          </div>
                          <button
                            type="button"
                            class="nested-add-var-btn inline-flex items-center gap-1 px-2.5 py-1 bg-blue-50 hover:bg-blue-100 text-[#138FCB] border border-blue-200 rounded-lg text-[11px] font-bold transition-colors cursor-pointer"
                            data-prod-id="${prod.id}">
                            <span class="text-xs font-black leading-none">+</span>
                            <span>Add Variant</span>
                          </button>
                        </div>

                        ${variants.length === 0 ? `
                          <div class="p-4 text-center bg-slate-50/50 rounded-xl border border-dashed border-slate-200 space-y-1.5">
                            <p class="text-xs font-bold text-slate-700">No SKU variants created yet for this product master.</p>
                            <p class="text-[11px] text-slate-400">Define cost, selling price, and stock attributes to enable sales and purchases.</p>
                            <button
                              type="button"
                              class="nested-add-var-btn mt-1 inline-flex items-center gap-1 px-3 py-1.5 bg-[#138FCB] hover:bg-[#0E78AC] text-white rounded-lg text-xs font-bold transition-all shadow-xs cursor-pointer"
                              data-prod-id="${prod.id}">
                              <span>+ Create First Variant</span>
                            </button>
                          </div>
                        ` : `
                          <div class="overflow-x-auto">
                            <table class="w-full text-left text-xs">
                              <thead>
                                <tr class="text-[10px] font-bold uppercase text-slate-400 border-b border-slate-100">
                                  <th class="py-1.5 px-3">SKU Code</th>
                                  <th class="py-1.5 px-3">Variant Model / Name</th>
                                  <th class="py-1.5 px-3 text-right">Cost Price</th>
                                  <th class="py-1.5 px-3 text-right">Selling Price</th>
                                  <th class="py-1.5 px-3 text-right">Live Stock (WH / Off / Total)</th>
                                  <th class="py-1.5 px-3 text-center">Status</th>
                                </tr>
                              </thead>
                              <tbody class="divide-y divide-slate-100">
                                ${variants.map(v => {
                                  const whStock = inventoryService.getBalance('wh-1', v.id);
                                  const offStock = inventoryService.getBalance('wh-2', v.id);
                                  const totalStock = whStock + offStock;
                                  const cost = Number(v.costPrice) || 0;
                                  const price = Number(v.sellingPrice) || 0;
                                  const margin = price > 0 ? Math.round(((price - cost) / price) * 100) : 0;

                                  return `
                                    <tr class="hover:bg-slate-50/60">
                                      <td class="py-2 px-3 whitespace-nowrap">
                                        <span class="font-mono font-bold text-[#138FCB] bg-blue-50 px-2 py-0.5 rounded border border-blue-100 text-[11px]">${v.sku}</span>
                                      </td>
                                      <td class="py-2 px-3 font-semibold text-slate-800">
                                        ${v.name}
                                      </td>
                                      <td class="py-2 px-3 text-right font-mono font-semibold text-slate-600">
                                        PKR ${cost.toLocaleString()}
                                      </td>
                                      <td class="py-2 px-3 text-right whitespace-nowrap">
                                        <span class="font-mono font-bold text-emerald-700">PKR ${price.toLocaleString()}</span>
                                        ${margin > 0 ? `
                                          <span class="text-[9px] font-bold text-emerald-600 bg-emerald-50 px-1 py-0.2 rounded border border-emerald-100 ml-1">+${margin}%</span>
                                        ` : ''}
                                      </td>
                                      <td class="py-2 px-3 text-right whitespace-nowrap">
                                        <span class="font-bold text-slate-800 font-mono">${totalStock.toLocaleString()}</span>
                                        <span class="text-[10px] text-slate-400 font-medium ml-1">(${whStock} WH / ${offStock} Off)</span>
                                      </td>
                                      <td class="py-2 px-3 text-center whitespace-nowrap">
                                        <span class="px-2 py-0.5 rounded-full text-[9px] font-bold ${v.isActive ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}">
                                          ${v.isActive ? 'Active' : 'Disabled'}
                                        </span>
                                      </td>
                                    </tr>
                                  `;
                                }).join('')}
                              </tbody>
                            </table>
                          </div>
                        `}
                      </div>
                    </td>
                  </tr>
                ` : ''}
              `;
            }).join('')}
          </tbody>
        </table>
      </div>

      <!-- Table Footer / Count -->
      <div class="px-5 py-3 border-t border-[#ECEEF2] flex items-center justify-between text-xs text-slate-400 bg-slate-50/40">
        <span>Showing <strong class="text-slate-700">${filteredProducts.length}</strong> product masters (${allVariants.length} total SKUs across all catalog items)</span>
        <div class="flex items-center gap-2">
          <span class="text-[11px] text-slate-500">View Mode:</span>
          <span class="font-semibold text-slate-700">
            ${currentVariantFilter === 'without_variant' ? 'Products without Variants' : currentVariantFilter === 'with_variants' ? 'Products with Variants Only' : 'All Products + Variants'}
          </span>
        </div>
      </div>
    </div>
  `;
}

/**
 * Event binding for products master view
 */
export function bindProductsEvents(container, refreshCallback) {
  const updateTable = () => {
    const filtered = getFilteredProducts();
    const categories = productService.getCategories();
    const tableContainer = container.querySelector('#products-table-container');
    if (tableContainer) {
      tableContainer.innerHTML = renderProductsTableContent(filtered, categories);
      bindTableInnerActions(tableContainer, refreshCallback);
    }
  };

  const updateCategoryTabs = () => {
    const categories = productService.getCategories();
    const products = productService.getProducts();
    const tabsContainer = container.querySelector('#category-tabs-container');
    if (!tabsContainer) return;

    const totalProducts = products.length;
    const categoryCounts = new Map();
    categories.forEach(c => categoryCounts.set(c.id, 0));
    products.forEach(p => {
      if (categoryCounts.has(p.categoryId)) {
        categoryCounts.set(p.categoryId, (categoryCounts.get(p.categoryId) || 0) + 1);
      }
    });

    let tabsHtml = `
      <button
        type="button"
        data-cat-id="all"
        class="cat-tab-btn shrink-0 inline-flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs transition-all cursor-pointer ${
          currentCategoryId === 'all'
            ? 'bg-[#138FCB] text-white font-bold shadow-xs'
            : 'bg-slate-100 hover:bg-slate-200/80 text-slate-700 font-semibold'
        }">
        <span>All Products</span>
        <span class="inline-flex items-center justify-center px-1.5 py-0.5 text-[10px] rounded-full font-mono font-bold ${
          currentCategoryId === 'all' ? 'bg-white/25 text-white' : 'bg-slate-200 text-slate-700'
        }">${totalProducts}</span>
      </button>
    `;

    categories.forEach(cat => {
      const count = categoryCounts.get(cat.id) || 0;
      const isActive = currentCategoryId === cat.id;
      tabsHtml += `
        <button
          type="button"
          data-cat-id="${cat.id}"
          class="cat-tab-btn shrink-0 inline-flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs transition-all cursor-pointer ${
            isActive
              ? 'bg-[#138FCB] text-white font-bold shadow-xs'
              : 'bg-slate-100 hover:bg-slate-200/80 text-slate-700 font-semibold'
          }">
          <span>${cat.name}</span>
          <span class="inline-flex items-center justify-center px-1.5 py-0.5 text-[10px] rounded-full font-mono font-bold ${
            isActive ? 'bg-white/25 text-white' : 'bg-slate-200 text-slate-700'
          }">${count}</span>
        </button>
      `;
    });

    tabsContainer.innerHTML = tabsHtml;

    // Rebind tabs click
    tabsContainer.querySelectorAll('.cat-tab-btn').forEach(btn => {
      btn.onclick = () => {
        currentCategoryId = btn.getAttribute('data-cat-id');
        updateCategoryTabs();
        updateTable();
      };
    });
  };

  // Initial table render
  updateTable();

  // Category Tabs Click
  container.querySelectorAll('.cat-tab-btn').forEach(btn => {
    btn.onclick = () => {
      currentCategoryId = btn.getAttribute('data-cat-id');
      updateCategoryTabs();
      updateTable();
    };
  });

  // Category Actions Dropdown
  const menuToggleBtn = container.querySelector('#category-menu-toggle-btn');
  const dropdownMenu = container.querySelector('#category-dropdown-menu');

  if (menuToggleBtn && dropdownMenu) {
    menuToggleBtn.onclick = (e) => {
      e.stopPropagation();
      dropdownMenu.classList.toggle('hidden');
    };

    // Close dropdown on outside click
    const handleOutsideClick = (e) => {
      if (!menuToggleBtn.contains(e.target) && !dropdownMenu.contains(e.target)) {
        dropdownMenu.classList.add('hidden');
      }
    };
    document.addEventListener('click', handleOutsideClick);

    // Menu Item: Add Category
    const menuAddBtn = container.querySelector('#menu-add-category-btn');
    if (menuAddBtn) {
      menuAddBtn.onclick = (e) => {
        e.stopPropagation();
        dropdownMenu.classList.add('hidden');
        openCategoryModal(null, (newCategory) => {
          if (newCategory) {
            currentCategoryId = newCategory.id;
          }
          updateCategoryTabs();
          updateTable();
          if (refreshCallback) refreshCallback();
        });
      };
    }

    // Menu Item: Edit Categories (opens unified edit & rearrange modal)
    const menuEditBtn = container.querySelector('#menu-edit-categories-btn');
    if (menuEditBtn) {
      menuEditBtn.onclick = (e) => {
        e.stopPropagation();
        dropdownMenu.classList.add('hidden');
        openEditAndRearrangeCategoriesModal(() => {
          updateCategoryTabs();
          updateTable();
          if (refreshCallback) refreshCallback();
        });
      };
    }
  }

  // Search input filter
  const searchInput = container.querySelector('#product-search-input');
  if (searchInput) {
    searchInput.oninput = (e) => {
      currentSearchQuery = e.target.value.trim();
      updateTable();
    };
  }

  // Product Type filter dropdown
  const typeFilter = container.querySelector('#product-type-filter');
  if (typeFilter) {
    typeFilter.onchange = (e) => {
      currentProductType = e.target.value;
      updateTable();
    };
  }

  // 3-Way Variant View Mode buttons
  container.querySelectorAll('.variant-mode-btn').forEach(btn => {
    btn.onclick = () => {
      const mode = btn.getAttribute('data-variant-mode');
      currentVariantFilter = mode;

      // Update button styles
      container.querySelectorAll('.variant-mode-btn').forEach(b => {
        const bMode = b.getAttribute('data-variant-mode');
        const isActive = bMode === mode;
        b.className = `variant-mode-btn inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition-all cursor-pointer ${
          isActive
            ? `bg-white ${mode === 'without_variant' ? 'text-amber-800' : 'text-[#138FCB]'} font-bold shadow-xs`
            : 'text-slate-600 hover:text-slate-900'
        }`;
      });

      // Show/hide Expand All button
      const expandAllBtn = container.querySelector('#toggle-expand-all-btn');
      if (expandAllBtn) {
        expandAllBtn.className = `${mode === 'without_variant' ? 'hidden' : 'inline-flex'} items-center gap-1.5 px-3 py-2 text-xs font-semibold text-slate-700 bg-white hover:bg-slate-50 border border-slate-200 rounded-xl transition-all shadow-2xs cursor-pointer`;
      }

      updateTable();
    };
  });

  // Expand / Collapse All SKUs toggle button
  const toggleExpandAllBtn = container.querySelector('#toggle-expand-all-btn');
  if (toggleExpandAllBtn) {
    toggleExpandAllBtn.onclick = () => {
      isAllExpanded = !isAllExpanded;
      if (!isAllExpanded) {
        expandedProductIds.clear();
      }
      const icon = toggleExpandAllBtn.querySelector('#expand-all-icon');
      const text = toggleExpandAllBtn.querySelector('#expand-all-text');
      if (icon) icon.textContent = isAllExpanded ? '▲' : '▼';
      if (text) text.textContent = isAllExpanded ? 'Collapse All' : 'Expand SKUs';
      updateTable();
    };
  }

  // Primary Add Product Button
  const addProdBtn = container.querySelector('#add-product-primary-btn');
  if (addProdBtn) {
    addProdBtn.onclick = () => {
      openProductModal(null, () => {
        updateCategoryTabs();
        updateTable();
        if (refreshCallback) refreshCallback();
      });
    };
  }
}

/**
 * Binds row-level events inside the products table
 */
function bindTableInnerActions(tableContainer, refreshCallback) {
  // Empty state buttons
  const emptyClearCat = tableContainer.querySelector('#empty-clear-cat-btn');
  if (emptyClearCat) {
    emptyClearCat.onclick = () => {
      currentCategoryId = 'all';
      const catTabs = document.querySelectorAll('.cat-tab-btn');
      catTabs.forEach(b => {
        const isAll = b.getAttribute('data-cat-id') === 'all';
        b.className = `cat-tab-btn shrink-0 inline-flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs transition-all cursor-pointer ${
          isAll ? 'bg-[#138FCB] text-white font-bold shadow-xs' : 'bg-slate-100 hover:bg-slate-200/80 text-slate-700 font-semibold'
        }`;
      });
      const filtered = getFilteredProducts();
      tableContainer.innerHTML = renderProductsTableContent(filtered, productService.getCategories());
      bindTableInnerActions(tableContainer, refreshCallback);
    };
  }

  const emptyAddProd = tableContainer.querySelector('#empty-add-prod-btn');
  if (emptyAddProd) {
    emptyAddProd.onclick = () => openProductModal(null, refreshCallback);
  }

  // Expand / Collapse single product
  tableContainer.querySelectorAll('.toggle-single-prod-expand-btn').forEach(btn => {
    btn.onclick = (e) => {
      e.stopPropagation();
      const prodId = btn.getAttribute('data-prod-id');
      if (expandedProductIds.has(prodId)) {
        expandedProductIds.delete(prodId);
      } else {
        expandedProductIds.add(prodId);
      }
      const filtered = getFilteredProducts();
      tableContainer.innerHTML = renderProductsTableContent(filtered, productService.getCategories());
      bindTableInnerActions(tableContainer, refreshCallback);
    };
  });

  // View Product buttons
  tableContainer.querySelectorAll('.view-product-btn, .prod-name-click').forEach(btn => {
    btn.onclick = () => {
      const prodId = btn.getAttribute('data-prod-id');
      const product = productService.getProductById(prodId);
      if (product) openProductDetailModal(product, refreshCallback);
    };
  });

  // Add Variant buttons
  tableContainer.querySelectorAll('.add-variant-btn, .nested-add-var-btn').forEach(btn => {
    btn.onclick = () => {
      const prodId = btn.getAttribute('data-prod-id');
      const product = productService.getProductById(prodId);
      if (product) {
        openAddVariantModal(product, () => {
          expandedProductIds.add(prodId);
          const filtered = getFilteredProducts();
          tableContainer.innerHTML = renderProductsTableContent(filtered, productService.getCategories());
          bindTableInnerActions(tableContainer, refreshCallback);
          if (refreshCallback) refreshCallback();
        });
      }
    };
  });

  // Edit Product buttons
  tableContainer.querySelectorAll('.edit-product-btn').forEach(btn => {
    btn.onclick = () => {
      const prodId = btn.getAttribute('data-prod-id');
      const product = productService.getProductById(prodId);
      if (product) openProductModal(product, refreshCallback);
    };
  });
}

/**
 * Unified Edit & Rearrange Categories Modal
 * Allows:
 * 1) Editing category details (Name, description, active status)
 * 2) Deleting category (if no products assigned)
 * 3) Rearranging order via Move Up / Move Down buttons or Drag & Drop
 * 4) Adding new categories on the fly
 */
export function openEditAndRearrangeCategoriesModal(onSaved) {
  let categories = [...productService.getCategories()];
  const products = productService.getProducts();
  let editingCatId = null;

  const renderCategoryListHtml = () => {
    return categories.map((cat, idx) => {
      const prodCount = products.filter(p => p.categoryId === cat.id).length;
      const isFirst = idx === 0;
      const isLast = idx === categories.length - 1;
      const isEditing = editingCatId === cat.id;

      if (isEditing) {
        return `
          <div class="p-3.5 bg-blue-50/50 rounded-xl border border-blue-300 shadow-2xs space-y-3" data-id="${cat.id}">
            <div class="flex items-center justify-between">
              <span class="font-bold text-blue-900 text-xs flex items-center gap-1.5">
                <span>✏️</span>
                <span>Editing: ${cat.name} (${cat.code})</span>
              </span>
              <span class="text-[10px] text-slate-500 font-mono">Position #${idx + 1}</span>
            </div>

            <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label class="block text-[11px] font-bold text-slate-700 mb-1">Category Name *</label>
                <input
                  type="text"
                  id="inline-cat-name-${cat.id}"
                  value="${cat.name}"
                  class="w-full text-xs font-bold rounded-lg border border-slate-200 bg-white py-1.5 px-2.5 text-slate-800 focus:border-[#138FCB] focus:outline-none">
              </div>
              <div class="flex items-end">
                <label class="inline-flex items-center gap-2 cursor-pointer pb-2">
                  <input
                    type="checkbox"
                    id="inline-cat-active-${cat.id}"
                    ${cat.isActive ? 'checked' : ''}
                    class="rounded border-slate-300 text-[#138FCB] focus:ring-0">
                  <span class="text-xs font-semibold text-slate-700">Active Category</span>
                </label>
              </div>
            </div>

            <div>
              <label class="block text-[11px] font-bold text-slate-700 mb-1">Description</label>
              <input
                type="text"
                id="inline-cat-desc-${cat.id}"
                value="${cat.description || ''}"
                placeholder="Category operational scope..."
                class="w-full text-xs rounded-lg border border-slate-200 bg-white py-1.5 px-2.5 text-slate-800 focus:border-[#138FCB] focus:outline-none">
            </div>

            <div class="flex items-center justify-end gap-2 pt-1">
              <button
                type="button"
                class="inline-cancel-btn px-3 py-1 text-xs font-semibold text-slate-600 bg-white hover:bg-slate-100 border border-slate-200 rounded-lg cursor-pointer">
                Cancel
              </button>
              <button
                type="button"
                class="inline-save-btn px-3.5 py-1 text-xs font-bold text-white bg-[#138FCB] hover:bg-[#0E78AC] rounded-lg shadow-2xs cursor-pointer"
                data-id="${cat.id}">
                Save Details
              </button>
            </div>
          </div>
        `;
      }

      return `
        <div
          class="reorder-cat-row flex items-center justify-between p-3 bg-white hover:bg-slate-50/70 rounded-xl border border-slate-200/90 shadow-2xs transition-all cursor-grab active:cursor-grabbing"
          draggable="true"
          data-index="${idx}"
          data-id="${cat.id}">
          
          <div class="flex items-center gap-3">
            <span class="text-slate-400 select-none text-base cursor-grab" title="Drag to reorder">⋮⋮</span>
            <span class="w-6 h-6 rounded-full bg-slate-100 text-slate-600 font-mono text-[11px] font-bold flex items-center justify-center border border-slate-200 shrink-0">
              ${idx + 1}
            </span>
            <div>
              <div class="flex items-center gap-2">
                <span class="font-bold text-slate-800 text-xs">${cat.name}</span>
                <span class="font-mono text-[10px] text-[#138FCB] bg-blue-50 px-1.5 py-0.5 rounded border border-blue-100 font-semibold">${cat.code}</span>
                <span class="text-[9px] px-1.5 py-0.2 rounded-full font-bold ${cat.isActive ? 'bg-emerald-50 text-emerald-700 border border-emerald-100' : 'bg-slate-100 text-slate-500'}">
                  ${cat.isActive ? 'Active' : 'Inactive'}
                </span>
              </div>
              <div class="flex items-center gap-2 mt-0.5">
                <span class="text-[11px] text-slate-400 font-medium">${prodCount} product${prodCount !== 1 ? 's' : ''}</span>
                ${cat.description ? `<span class="text-[10px] text-slate-400 line-clamp-1 max-w-[200px] sm:max-w-xs">• ${cat.description}</span>` : ''}
              </div>
            </div>
          </div>

          <div class="flex items-center gap-1 shrink-0">
            <!-- Move Up -->
            <button
              type="button"
              class="move-up-btn w-6 h-6 rounded-lg text-[10px] font-bold flex items-center justify-center border transition-colors ${
                isFirst
                  ? 'text-slate-300 border-slate-100 cursor-not-allowed'
                  : 'text-slate-700 border-slate-200 hover:bg-slate-100 cursor-pointer'
              }"
              data-index="${idx}"
              ${isFirst ? 'disabled' : ''}
              title="Move up">
              ▲
            </button>
            <!-- Move Down -->
            <button
              type="button"
              class="move-down-btn w-6 h-6 rounded-lg text-[10px] font-bold flex items-center justify-center border transition-colors ${
                isLast
                  ? 'text-slate-300 border-slate-100 cursor-not-allowed'
                  : 'text-slate-700 border-slate-200 hover:bg-slate-100 cursor-pointer'
              }"
              data-index="${idx}"
              ${isLast ? 'disabled' : ''}
              title="Move down">
              ▼
            </button>
            <!-- Edit Button -->
            <button
              type="button"
              class="edit-single-cat-btn px-2 py-1 rounded-lg text-[11px] font-semibold text-slate-700 bg-slate-50 hover:bg-slate-100 border border-slate-200 transition-colors cursor-pointer ml-1"
              data-id="${cat.id}"
              title="Edit category details">
              ✏️ Edit
            </button>
            <!-- Delete Button (if 0 products) -->
            <button
              type="button"
              class="delete-single-cat-btn p-1 rounded-lg text-slate-400 hover:text-rose-600 transition-colors cursor-pointer ${prodCount > 0 ? 'opacity-40' : ''}"
              data-id="${cat.id}"
              data-count="${prodCount}"
              title="${prodCount > 0 ? 'Cannot delete: products assigned' : 'Delete category'}">
              🗑
            </button>
          </div>
        </div>
      `;
    }).join('');
  };

  const contentHtml = `
    <div class="space-y-4 text-xs">
      <div class="flex items-center justify-between p-3 bg-blue-50/60 rounded-xl border border-blue-200/80">
        <div>
          <p class="font-bold text-blue-900">Manage, Edit &amp; Rearrange Categories</p>
          <p class="text-[11px] text-blue-700">Click ✏️ Edit to modify names or active status. Use ▲ / ▼ or drag rows to rearrange tab sequence.</p>
        </div>
        <div class="flex items-center gap-2">
          <button
            type="button"
            id="modal-add-cat-btn"
            class="inline-flex items-center gap-1 px-3 py-1.5 bg-[#138FCB] hover:bg-[#0E78AC] text-white rounded-xl text-xs font-bold transition-all shadow-xs cursor-pointer">
            <span>+ Add Category</span>
          </button>
        </div>
      </div>

      <div id="edit-reorder-categories-list" class="space-y-2 max-h-[380px] overflow-y-auto pr-1">
        ${renderCategoryListHtml()}
      </div>

      <div class="pt-2 flex items-center justify-between border-t border-slate-100 text-[11px] text-slate-400">
        <span>💡 Tip: Changes to order will immediately update the catalog category tabs.</span>
        <button
          type="button"
          id="reorder-sort-alpha-btn"
          class="text-[#138FCB] hover:underline font-semibold cursor-pointer">
          Sort A-Z Alphabetically
        </button>
      </div>
    </div>
  `;

  const footerHtml = `
    <div class="flex items-center space-x-2 text-xs text-slate-400">
      <span class="w-2 h-2 rounded-full bg-emerald-500"></span>
      <span>Instant catalog sync</span>
    </div>
    <div class="flex items-center space-x-2.5">
      <button
        type="button"
        id="edit-reorder-close-btn"
        class="px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100 rounded-xl transition-colors border border-slate-200 cursor-pointer">
        Close
      </button>
      <button
        type="button"
        id="edit-reorder-save-order-btn"
        class="px-5 py-2 text-xs font-bold text-white bg-[#138FCB] hover:bg-[#0E78AC] rounded-xl shadow-xs transition-all active:scale-[0.98] cursor-pointer">
        Save Category Order
      </button>
    </div>
  `;

  openModal({
    title: 'Edit & Rearrange Categories',
    subtitle: 'Manage category details, status, or reorder catalog tabs',
    size: 'max-w-2xl',
    contentHtml,
    footerHtml,
    onOpen: (modalEl) => {
      const listEl = modalEl.querySelector('#edit-reorder-categories-list');
      const closeBtn = modalEl.querySelector('#edit-reorder-close-btn');
      const saveOrderBtn = modalEl.querySelector('#edit-reorder-save-order-btn');
      const alphaBtn = modalEl.querySelector('#reorder-sort-alpha-btn');
      const modalAddCatBtn = modalEl.querySelector('#modal-add-cat-btn');

      if (closeBtn) closeBtn.onclick = () => closeModal();

      const refreshList = () => {
        if (listEl) {
          listEl.innerHTML = renderCategoryListHtml();
          bindListEvents();
        }
      };

      const bindListEvents = () => {
        // Move Up
        listEl.querySelectorAll('.move-up-btn').forEach(btn => {
          btn.onclick = () => {
            const idx = parseInt(btn.getAttribute('data-index'), 10);
            if (idx > 0) {
              const temp = categories[idx];
              categories[idx] = categories[idx - 1];
              categories[idx - 1] = temp;
              refreshList();
            }
          };
        });

        // Move Down
        listEl.querySelectorAll('.move-down-btn').forEach(btn => {
          btn.onclick = () => {
            const idx = parseInt(btn.getAttribute('data-index'), 10);
            if (idx < categories.length - 1) {
              const temp = categories[idx];
              categories[idx] = categories[idx + 1];
              categories[idx + 1] = temp;
              refreshList();
            }
          };
        });

        // HTML5 Drag and Drop Reordering
        let draggedIndex = null;
        listEl.querySelectorAll('.reorder-cat-row').forEach(row => {
          row.ondragstart = (e) => {
            draggedIndex = parseInt(row.getAttribute('data-index'), 10);
            row.classList.add('opacity-40', 'border-blue-400');
            e.dataTransfer.effectAllowed = 'move';
          };

          row.ondragend = () => {
            row.classList.remove('opacity-40', 'border-blue-400');
            listEl.querySelectorAll('.reorder-cat-row').forEach(r => r.classList.remove('bg-blue-50/70', 'border-blue-500'));
          };

          row.ondragover = (e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            row.classList.add('bg-blue-50/70', 'border-blue-500');
          };

          row.ondragleave = () => {
            row.classList.remove('bg-blue-50/70', 'border-blue-500');
          };

          row.ondrop = (e) => {
            e.preventDefault();
            row.classList.remove('bg-blue-50/70', 'border-blue-500');
            const targetIndex = parseInt(row.getAttribute('data-index'), 10);
            if (draggedIndex !== null && draggedIndex !== targetIndex) {
              const item = categories.splice(draggedIndex, 1)[0];
              categories.splice(targetIndex, 0, item);
              refreshList();
            }
          };
        });

        // Edit button click -> expand inline editor
        listEl.querySelectorAll('.edit-single-cat-btn').forEach(btn => {
          btn.onclick = () => {
            editingCatId = btn.getAttribute('data-id');
            refreshList();
          };
        });

        // Cancel inline editor
        listEl.querySelectorAll('.inline-cancel-btn').forEach(btn => {
          btn.onclick = () => {
            editingCatId = null;
            refreshList();
          };
        });

        // Save inline editor
        listEl.querySelectorAll('.inline-save-btn').forEach(btn => {
          btn.onclick = () => {
            const catId = btn.getAttribute('data-id');
            const name = modalEl.querySelector(`#inline-cat-name-${catId}`)?.value.trim();
            const desc = modalEl.querySelector(`#inline-cat-desc-${catId}`)?.value.trim();
            const isActive = modalEl.querySelector(`#inline-cat-active-${catId}`)?.checked ?? true;

            if (!name) {
              toast.show('Please provide a category name.', 'warning');
              return;
            }

            try {
              productService.updateCategory(catId, { name, description: desc, isActive });
              // Update local state
              const found = categories.find(c => c.id === catId);
              if (found) {
                found.name = name;
                found.description = desc;
                found.isActive = isActive;
              }
              editingCatId = null;
              toast.show('Category updated successfully.', 'success');
              refreshList();
              if (onSaved) onSaved();
            } catch (err) {
              toast.show(err.message, 'error');
            }
          };
        });

        // Delete button click
        listEl.querySelectorAll('.delete-single-cat-btn').forEach(btn => {
          btn.onclick = () => {
            const catId = btn.getAttribute('data-id');
            const count = parseInt(btn.getAttribute('data-count'), 10);

            if (count > 0) {
              toast.show(`Cannot delete category: ${count} product(s) are assigned to it.`, 'warning');
              return;
            }

            confirmAction({
              title: 'Delete Category',
              message: 'Are you sure you want to delete this category?',
              onConfirm: () => {
                try {
                  productService.deleteCategory(catId);
                  categories = categories.filter(c => c.id !== catId);
                  toast.show('Category deleted.', 'success');
                  refreshList();
                  if (onSaved) onSaved();
                } catch (err) {
                  toast.show(err.message, 'error');
                }
              }
            });
          };
        });
      };

      bindListEvents();

      // Alphabetical sort helper
      if (alphaBtn) {
        alphaBtn.onclick = () => {
          categories.sort((a, b) => a.name.localeCompare(b.name));
          refreshList();
        };
      }

      // Add Category from inside modal
      if (modalAddCatBtn) {
        modalAddCatBtn.onclick = () => {
          openCategoryModal(null, (newCat) => {
            if (newCat) {
              categories.push(newCat);
              refreshList();
              if (onSaved) onSaved();
            }
          });
        };
      }

      // Save new order
      if (saveOrderBtn) {
        saveOrderBtn.onclick = () => {
          const orderedIds = categories.map(c => c.id);
          try {
            productService.reorderCategories(orderedIds);
            toast.show('Category order saved successfully.', 'success');
            closeModal();
            if (onSaved) onSaved();
          } catch (err) {
            toast.show(err.message, 'error');
          }
        };
      }
    }
  });
}

/**
 * Detailed View Modal for a Product Master with associated Variant Cards
 */
export function openProductDetailModal(product, refreshCallback) {
  const categories = productService.getCategories();
  const category = categories.find(c => c.id === product.categoryId);
  const units = storageService.getCollection('units');
  const unitObj = units.find(u => u.id === product.baseUnitId);
  const variants = productService.getVariantsByProduct(product.id);

  const contentHtml = `
    <div class="space-y-6 text-xs">
      <!-- SECTION 1: Master Specification Card -->
      <section class="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-xs space-y-4">
        <div class="flex items-center justify-between border-b border-slate-100 pb-3">
          <h3 class="text-xs font-bold uppercase tracking-wider text-slate-700 flex items-center gap-2">
            <span>📋</span>
            <span>1. Product Master Profile</span>
          </h3>
          <span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-bold ${product.isActive ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-rose-50 text-rose-700 border border-rose-200'}">
            ${product.isActive ? 'Active Catalog Item' : 'Voided / Inactive'}
          </span>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div class="p-3 bg-slate-50/70 rounded-xl border border-slate-200/70 space-y-1">
            <span class="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Business Name (Internal)</span>
            <p class="text-sm font-black text-slate-900">${product.businessName}</p>
            <p class="text-[11px] font-mono text-[#138FCB] font-semibold">${product.code}</p>
          </div>

          <div class="p-3 bg-slate-50/70 rounded-xl border border-slate-200/70 space-y-1">
            <span class="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Customer Sales Name</span>
            <p class="text-sm font-bold text-slate-800">${product.customerName}</p>
            <p class="text-[11px] text-slate-500 font-medium">Shown on Invoices &amp; Orders</p>
          </div>

          <div class="p-3 bg-slate-50/70 rounded-xl border border-slate-200/70 space-y-1">
            <span class="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Urdu Name (اردو نام)</span>
            <p class="text-base font-bold text-slate-800 font-serif" dir="rtl">${product.urduName || '—'}</p>
            <p class="text-[10px] text-slate-400">Warehouse print &amp; dispatch display</p>
          </div>
        </div>

        <div class="grid grid-cols-2 md:grid-cols-4 gap-3 pt-1">
          <div class="p-2.5 bg-white rounded-xl border border-slate-200 shadow-2xs">
            <span class="text-[10px] text-slate-400 font-semibold block">Category</span>
            <span class="font-bold text-slate-700 text-xs">${category ? category.name : 'Unassigned'}</span>
          </div>
          <div class="p-2.5 bg-white rounded-xl border border-slate-200 shadow-2xs">
            <span class="text-[10px] text-slate-400 font-semibold block">Base Unit</span>
            <span class="font-bold text-slate-700 text-xs">${unitObj ? `${unitObj.name} (${unitObj.code})` : 'PCS'}</span>
          </div>
          <div class="p-2.5 bg-white rounded-xl border border-slate-200 shadow-2xs">
            <span class="text-[10px] text-slate-400 font-semibold block">Tracking Mode</span>
            <span class="font-bold text-slate-700 text-xs">${product.enableRollTracking ? 'Roll / Cut-to-length' : 'Standard Qty'}</span>
          </div>
          <div class="p-2.5 bg-white rounded-xl border border-slate-200 shadow-2xs">
            <span class="text-[10px] text-slate-400 font-semibold block">Low Stock Alert</span>
            <span class="font-bold text-amber-700 text-xs">${product.lowStockLevel || 10} Units</span>
          </div>
        </div>

        ${product.description ? `
          <div class="p-3 bg-slate-50/50 rounded-xl border border-slate-100 text-slate-600">
            <span class="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1">Specifications &amp; Notes</span>
            <p>${product.description}</p>
          </div>
        ` : ''}

        ${(product.cut_to_length || product.enableRollTracking) ? `
          <div class="p-3.5 bg-blue-50/50 rounded-xl border border-blue-200/80 space-y-2.5">
            <div class="flex items-center justify-between">
              <span class="text-xs font-bold text-blue-900 flex items-center gap-1.5">
                <span>📏</span>
                <span>Cut-to-Length Inventory Configuration</span>
              </span>
              <span class="text-[10px] font-bold text-blue-700 bg-white px-2 py-0.5 rounded border border-blue-200">
                Continuous Base Unit: ${product.base_unit || 'ft'}
              </span>
            </div>
            ${(product.packagingUnits && product.packagingUnits.length > 0) ? `
              <div>
                <span class="text-[10px] font-bold text-slate-500 uppercase tracking-wider block mb-1.5">Defined Full Roll Packaging Sizes:</span>
                <div class="flex flex-wrap gap-2">
                  ${product.packagingUnits.map(pkg => `
                    <span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-white border border-blue-200 text-xs font-semibold text-slate-800 shadow-2xs">
                      <span>📦</span>
                      <span><strong>${pkg.name}</strong> (${Number(pkg.factor).toLocaleString()} ${pkg.unit || product.base_unit || 'ft'})</span>
                    </span>
                  `).join('')}
                </div>
              </div>
            ` : ''}
          </div>
        ` : ''}
      </section>

      <!-- SECTION 2: Associated Variants & SKUs Cards -->
      <section class="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-xs space-y-4">
        <div class="flex items-center justify-between border-b border-slate-100 pb-3">
          <div class="flex items-center space-x-2">
            <h3 class="text-xs font-bold uppercase tracking-wider text-slate-700 flex items-center gap-2">
              <span>🏷️</span>
              <span>2. Associated Variants &amp; SKUs</span>
            </h3>
            <span class="px-2 py-0.5 text-[10px] font-bold rounded-full bg-blue-50 text-[#138FCB] border border-blue-200">
              ${variants.length} SKU Option${variants.length !== 1 ? 's' : ''}
            </span>
          </div>
          <button id="modal-add-variant-btn" type="button" class="inline-flex items-center space-x-1.5 px-3 py-1.5 bg-blue-50 hover:bg-blue-100 text-[#138FCB] rounded-xl text-xs font-bold border border-blue-200 shadow-2xs transition-all cursor-pointer">
            <span class="text-sm font-extrabold leading-none">+</span>
            <span>Add Variant</span>
          </button>
        </div>

        <div class="space-y-3">
          ${variants.length === 0 ? `
            <div class="p-8 text-center bg-slate-50/70 rounded-2xl border border-dashed border-slate-200 space-y-2">
              <span class="text-2xl block">📦</span>
              <p class="font-bold text-slate-700">No variants created for this product yet.</p>
              <p class="text-slate-400 text-xs max-w-sm mx-auto">Create a variant to specify pricing, SKU codes, and live inventory balances.</p>
              <button id="empty-state-add-var-btn" type="button" class="mt-2 inline-flex items-center space-x-1 px-4 py-2 bg-[#138FCB] hover:bg-[#0E78AC] text-white rounded-xl text-xs font-bold transition-all shadow-xs cursor-pointer">
                <span>+ Create First Variant</span>
              </button>
            </div>
          ` : `
            <div class="grid grid-cols-1 md:grid-cols-2 gap-3.5">
              ${variants.map(v => {
                const whStock = inventoryService.getBalance('wh-1', v.id);
                const offStock = inventoryService.getBalance('wh-2', v.id);
                const totalStock = whStock + offStock;
                const unit = v.unit || (unitObj?.code || 'PCS');

                return `
                  <div class="p-4 bg-white hover:bg-slate-50/60 rounded-xl border border-slate-200/90 shadow-2xs transition-all space-y-3">
                    <div class="flex items-start justify-between gap-2">
                      <div>
                        <h4 class="font-bold text-slate-800 text-xs">${v.name}</h4>
                        <span class="font-mono text-[10px] font-bold text-[#138FCB] bg-blue-50 px-2 py-0.5 rounded border border-blue-100 mt-1 inline-block">${v.sku}</span>
                      </div>
                      <span class="text-[10px] font-bold ${v.isActive ? 'text-emerald-700 bg-emerald-50 border border-emerald-200' : 'text-slate-500 bg-slate-100'} px-2 py-0.5 rounded-full">
                        ${v.isActive ? 'Active SKU' : 'Disabled'}
                      </span>
                    </div>

                    <!-- Prices & Stock -->
                    <div class="grid grid-cols-2 gap-2 pt-2 border-t border-slate-100">
                      <div>
                        <span class="text-[9px] font-bold text-slate-400 uppercase tracking-wider block">Cost / Selling</span>
                        <div class="text-xs font-bold text-slate-700 mt-0.5">
                          PKR ${v.costPrice?.toLocaleString() || 0} / <span class="text-emerald-700 font-extrabold">PKR ${v.sellingPrice?.toLocaleString() || 0}</span>
                        </div>
                      </div>
                      <div class="text-right">
                        <span class="text-[9px] font-bold text-slate-400 uppercase tracking-wider block">Live Balance</span>
                        <div class="text-xs font-black text-slate-900 mt-0.5">
                          ${totalStock.toLocaleString()} ${unit}
                        </div>
                        <div class="text-[9px] text-slate-400 mt-0.5">
                          WH: ${whStock} • Office: ${offStock}
                        </div>
                      </div>
                    </div>
                  </div>
                `;
              }).join('')}
            </div>
          `}
        </div>
      </section>
    </div>
  `;

  const footerHtml = `
    <div class="flex items-center space-x-2 text-xs text-slate-400">
      <span class="w-2 h-2 rounded-full bg-emerald-500"></span>
      <span>🛡️ Enterprise Master Product Record</span>
    </div>
    <div class="flex flex-col sm:flex-row items-center justify-between w-full sm:w-auto gap-3">
      <div>
        <button id="prod-detail-void-btn" type="button" class="inline-flex items-center space-x-1.5 px-3.5 py-2 text-xs font-bold ${product.isActive ? 'text-rose-600 hover:text-rose-700 bg-rose-50 hover:bg-rose-100 border-rose-200' : 'text-emerald-600 hover:text-emerald-700 bg-emerald-50 hover:bg-emerald-100 border-emerald-200'} rounded-xl transition-colors border cursor-pointer">
          <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636"></path>
          </svg>
          <span>${product.isActive ? 'Void / Deactivate Product' : 'Reactivate Product'}</span>
        </button>
      </div>
      <div class="flex items-center space-x-3">
        <button id="prod-detail-close-btn" type="button" class="px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100 rounded-xl transition-colors border border-slate-200 cursor-pointer">
          Close
        </button>
        <button id="prod-detail-edit-btn" type="button" class="inline-flex items-center space-x-1.5 px-4 py-2 text-xs font-bold text-slate-700 bg-white hover:bg-slate-50 border border-slate-200 rounded-xl transition-all cursor-pointer shadow-2xs">
          <svg class="w-3.5 h-3.5 text-[#138FCB]" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"></path>
          </svg>
          <span>Edit Product</span>
        </button>
        <button id="prod-detail-add-var-btn" type="button" class="inline-flex items-center space-x-1.5 px-4 py-2 text-xs font-bold text-white bg-[#138FCB] hover:bg-[#0E78AC] rounded-xl shadow-xs transition-all cursor-pointer">
          <span class="text-sm font-extrabold leading-none">+</span>
          <span>Add Variant</span>
        </button>
      </div>
    </div>
  `;

  openModal({
    title: `Product Master: ${product.businessName}`,
    subtitle: 'Central business product definition, catalog configuration & associated variant SKUs',
    badge: product.code,
    contentHtml,
    footerHtml,
    size: 'max-w-4xl',
    onOpen: (modalEl) => {
      const closeBtn = modalEl.querySelector('#prod-detail-close-btn');
      if (closeBtn) closeBtn.onclick = () => closeModal();

      // Edit product
      const editBtn = modalEl.querySelector('#prod-detail-edit-btn');
      if (editBtn) {
        editBtn.onclick = () => {
          closeModal();
          openProductModal(product, refreshCallback);
        };
      }

      // Add variant triggers
      const openAddVar = () => {
        closeModal();
        openAddVariantModal(product, () => {
          if (refreshCallback) refreshCallback();
          openProductDetailModal(productService.getProductById(product.id), refreshCallback);
        });
      };

      const topAddVarBtn = modalEl.querySelector('#modal-add-variant-btn');
      if (topAddVarBtn) topAddVarBtn.onclick = openAddVar;

      const footerAddVarBtn = modalEl.querySelector('#prod-detail-add-var-btn');
      if (footerAddVarBtn) footerAddVarBtn.onclick = openAddVar;

      const emptyAddVarBtn = modalEl.querySelector('#empty-state-add-var-btn');
      if (emptyAddVarBtn) emptyAddVarBtn.onclick = openAddVar;

      // Void / Deactivate toggle
      const voidBtn = modalEl.querySelector('#prod-detail-void-btn');
      if (voidBtn) {
        voidBtn.onclick = () => {
          const actionText = product.isActive ? 'Deactivate / Void' : 'Reactivate';
          confirmAction({
            title: `${actionText} Product Master: ${product.businessName}`,
            message: product.isActive
              ? 'Are you sure you want to deactivate this product? It will be marked inactive and hidden from active sales entries.'
              : 'Are you sure you want to reactivate this product for catalog operations?',
            onConfirm: () => {
              productService.updateProduct(product.id, { isActive: !product.isActive });
              toast.show(`Product ${product.businessName} successfully ${product.isActive ? 'deactivated / voided' : 'reactivated'}.`, 'success');
              closeModal();
              if (refreshCallback) refreshCallback();
            }
          });
        };
      }
    }
  });
}

/**
 * Add Variant for a Specific Product Modal
 */
export function openAddVariantModal(product, onSaved) {
  openProductModal(product, onSaved, { addVariant: true });
}

/**
 * Edit or Create Product Master Modal
 */
export function openProductModal(product = null, onSaved, options = {}) {
  const isEdit = !!product;
  const categories = productService.getCategories();
  const units = storageService.getCollection('units');

  const contentHtml = `
    <form id="product-master-form" class="space-y-5 text-xs">
      <!-- SECTION 1: Multi-Tier Product Naming -->
      <section class="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-xs space-y-4">
        <div class="flex items-center justify-between border-b border-slate-100 pb-3">
          <h3 class="text-xs font-bold uppercase tracking-wider text-slate-700 flex items-center gap-2">
            <span>🏷️</span>
            <span>1. Product Naming (3-Tier Master)</span>
          </h3>
          <span class="text-[10px] text-slate-400 font-medium">All fields marked with <span class="text-red-500 font-bold">*</span> are required</span>
        </div>

        <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div class="space-y-1.5">
            <label class="text-xs font-semibold text-slate-700" for="prod-biz-name">Business Name (Internal) <span class="text-red-500">*</span></label>
            <input type="text" id="prod-biz-name" required value="${product ? product.businessName : ''}" placeholder="e.g. FP-CN-150" class="w-full text-xs font-bold rounded-xl border border-slate-200 focus:border-[#138FCB] focus:ring focus:ring-blue-100 py-2.5 px-3 text-slate-800 bg-white shadow-2xs">
            <p class="text-[10px] text-slate-400">Internal warehouse identifier</p>
          </div>

          <div class="space-y-1.5">
            <label class="text-xs font-semibold text-slate-700" for="prod-cust-name">Customer Name (Sales) <span class="text-red-500">*</span></label>
            <input type="text" id="prod-cust-name" required value="${product ? product.customerName : ''}" placeholder="e.g. Feed Pan 16-inch" class="w-full text-xs font-semibold rounded-xl border border-slate-200 focus:border-[#138FCB] focus:ring focus:ring-blue-100 py-2.5 px-3 text-slate-800 bg-white shadow-2xs">
            <p class="text-[10px] text-slate-400">Appears on quotations &amp; invoices</p>
          </div>

          <div class="space-y-1.5">
            <label class="text-xs font-semibold text-slate-700" for="prod-urdu-name">Urdu Name (اردو نام)</label>
            <input type="text" id="prod-urdu-name" dir="rtl" value="${product ? (product.urduName || '') : ''}" placeholder="مثلاً فیڈ پین" class="w-full text-xs font-serif font-bold rounded-xl border border-slate-200 focus:border-[#138FCB] focus:ring focus:ring-blue-100 py-2.5 px-3 text-slate-800 bg-white shadow-2xs">
            <p class="text-[10px] text-slate-400">Local dispatch print name</p>
          </div>
        </div>
      </section>

      <!-- SECTION 2: Catalog Classification & Controls -->
      <section class="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-xs space-y-4">
        <div class="flex items-center justify-between border-b border-slate-100 pb-3">
          <h3 class="text-xs font-bold uppercase tracking-wider text-slate-700 flex items-center gap-2">
            <span>⚙️</span>
            <span>2. Classification &amp; Inventory Rules</span>
          </h3>
          <span class="text-[10px] text-slate-400 font-medium">Category, unit, and threshold settings</span>
        </div>

        <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div class="space-y-1.5">
            <label class="text-xs font-semibold text-slate-700" for="prod-category">Product Category <span class="text-red-500">*</span></label>
            <select id="prod-category" required class="w-full text-xs rounded-xl border border-slate-200 focus:border-[#138FCB] py-2.5 px-3 text-slate-800 bg-white shadow-2xs">
              ${categories.map(c => `<option value="${c.id}" ${(product ? product.categoryId : currentCategoryId) === c.id ? 'selected' : ''}>${c.name}</option>`).join('')}
            </select>
          </div>

          <div class="space-y-1.5">
            <label class="text-xs font-semibold text-slate-700" for="prod-base-unit">Base Inventory Unit <span class="text-red-500">*</span></label>
            <select id="prod-base-unit" required class="w-full text-xs rounded-xl border border-slate-200 focus:border-[#138FCB] py-2.5 px-3 text-slate-800 bg-white shadow-2xs">
              ${units.map(u => `<option value="${u.id}" ${product && product.baseUnitId === u.id ? 'selected' : ''}>${u.name} (${u.code})</option>`).join('')}
            </select>
          </div>

          <div class="space-y-1.5">
            <label class="text-xs font-semibold text-slate-700" for="prod-type">Product Type</label>
            <select id="prod-type" class="w-full text-xs rounded-xl border border-slate-200 focus:border-[#138FCB] py-2.5 px-3 text-slate-800 bg-white shadow-2xs">
              <option value="Stock" ${!product || product.productType === 'Stock' ? 'selected' : ''}>Stock Item</option>
              <option value="Non-Stock" ${product && product.productType === 'Non-Stock' ? 'selected' : ''}>Non-Stock Item</option>
              <option value="Service" ${product && product.productType === 'Service' ? 'selected' : ''}>Service</option>
            </select>
          </div>
        </div>

        <div class="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-1">
          <div class="space-y-1.5">
            <label class="text-xs font-semibold text-slate-700" for="prod-low-stock">Low Stock Alert Level</label>
            <input type="number" id="prod-low-stock" min="0" value="${product ? product.lowStockLevel : 10}" class="w-full text-xs rounded-xl border border-slate-200 focus:border-[#138FCB] py-2.5 px-3 text-slate-800 bg-white shadow-2xs">
          </div>

          <div class="space-y-1.5">
            <label class="text-xs font-semibold text-slate-700" for="prod-neg-stock">Negative Stock Setting</label>
            <select id="prod-neg-stock" class="w-full text-xs rounded-xl border border-slate-200 focus:border-[#138FCB] py-2.5 px-3 text-slate-800 bg-white shadow-2xs">
              <option value="system_default" ${!product || product.negativeStockAllowed === 'system_default' ? 'selected' : ''}>Use System Default (Disallow)</option>
              <option value="allow" ${product && product.negativeStockAllowed === 'allow' ? 'selected' : ''}>Allow Negative Stock</option>
              <option value="disallow" ${product && product.negativeStockAllowed === 'disallow' ? 'selected' : ''}>Strictly Disallow</option>
            </select>
          </div>

          <div class="flex flex-col justify-end">
            <div id="prod-ctl-wrapper" class="flex flex-col gap-1 p-2.5 bg-blue-50/70 border border-blue-100 rounded-xl transition-all">
              <div class="flex items-center gap-2">
                <input type="checkbox" id="prod-roll-tracking" ${product && (product.cut_to_length || product.enableRollTracking) ? 'checked' : ''} class="rounded border-slate-300 text-[#138FCB] focus:ring-0 cursor-pointer">
                <label id="prod-ctl-label" for="prod-roll-tracking" class="font-bold text-slate-800 cursor-pointer">☑ Cut to Length</label>
              </div>
              <div id="prod-ctl-disabled-notice" class="hidden text-[10px] text-amber-700 font-medium">
                Disabled: Configured per variant SKU below
              </div>
            </div>
          </div>
        </div>

        <!-- Cut-to-Length Multi-Packaging Sub-Card -->
        <div id="prod-ctl-config-box" class="${product && (product.cut_to_length || product.enableRollTracking) ? '' : 'hidden'} p-4 bg-blue-50/40 rounded-xl border border-blue-200/80 space-y-3">
          <div class="flex items-center justify-between pb-2 border-b border-blue-200/60">
            <div>
              <span class="text-xs font-bold text-blue-900 flex items-center gap-1.5">
                <span>📏</span>
                <span>Cut-to-Length &amp; Multi-Roll Packaging Setup</span>
              </span>
              <p class="text-[10px] text-blue-700 mt-0.5">Define continuous base unit and full roll packaging configurations (e.g. 5,000 ft roll, 3,280 ft roll, 450 ft roll).</p>
            </div>
            <button type="button" id="add-roll-size-btn" class="px-2.5 py-1 bg-white hover:bg-blue-100 text-[#138FCB] border border-blue-200 rounded-lg text-xs font-bold shadow-2xs transition-all cursor-pointer">
              + Add Roll Size
            </button>
          </div>

          <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div class="space-y-1">
              <label class="text-[11px] font-semibold text-slate-700" for="prod-ctl-base-unit">Continuous Base Length Unit</label>
              <input type="text" id="prod-ctl-base-unit" value="${product?.base_unit || 'ft'}" placeholder="ft" class="w-full text-xs font-bold rounded-lg border border-slate-200 bg-white py-1.5 px-2.5 text-slate-800 focus:border-[#138FCB]">
              <span class="text-[10px] text-slate-400">Base measurement unit (defaults to ft, customizable)</span>
            </div>
            <div class="space-y-1">
              <label class="text-[11px] font-semibold text-slate-700" for="prod-ctl-full-unit-name">Full Unit Packaging Type</label>
              <input type="text" id="prod-ctl-full-unit-name" value="${product?.full_unit || 'roll'}" placeholder="e.g. roll, spool, coil" class="w-full text-xs font-semibold rounded-lg border border-slate-200 bg-white py-1.5 px-2.5 text-slate-800 focus:border-[#138FCB]">
            </div>
          </div>

          <!-- Dynamic Roll Sizes List -->
          <div class="space-y-2 pt-1">
            <label class="text-[11px] font-bold text-slate-700 block">Defined Full Roll Sizes (Packaging Options)</label>
            <div id="roll-sizes-container" class="space-y-2">
              ${(product?.packagingUnits && product.packagingUnits.length > 0 ? product.packagingUnits : [
                { id: 'pkg-default-1', name: 'Roll (5,000 ft)', factor: 5000, unit: product?.base_unit || 'ft' },
                { id: 'pkg-default-2', name: 'Roll (3,280 ft)', factor: 3280, unit: product?.base_unit || 'ft' }
              ]).map((pkg) => `
                <div class="roll-size-row flex items-center gap-2 p-2 bg-white rounded-lg border border-slate-200 shadow-2xs">
                  <div class="flex-1">
                    <input type="text" value="${pkg.name}" placeholder="e.g. Roll (5,000 ft)" class="roll-size-name w-full text-xs font-bold text-slate-800 border-0 focus:ring-0 p-1">
                  </div>
                  <div class="w-32 flex items-center gap-1">
                    <input type="number" min="1" value="${pkg.factor}" placeholder="5000" class="roll-size-qty w-full text-xs font-mono font-bold text-blue-900 border border-slate-200 rounded px-2 py-1 text-right focus:border-[#138FCB]">
                    <span class="roll-size-unit-lbl text-[10px] text-slate-500 font-bold shrink-0">${pkg.unit || product?.base_unit || 'ft'}</span>
                  </div>
                  <button type="button" class="remove-roll-size-btn text-slate-400 hover:text-rose-600 p-1 transition-colors cursor-pointer" title="Remove roll size">
                    ✕
                  </button>
                </div>
              `).join('')}
            </div>
          </div>
        </div>

        <div class="space-y-1.5 pt-1">
          <label class="text-xs font-semibold text-slate-700" for="prod-desc">Description / Technical Specifications</label>
          <textarea id="prod-desc" rows="2" placeholder="Specifications, warranty terms, or storage requirements..." class="w-full text-xs rounded-xl border border-slate-200 focus:border-[#138FCB] p-3 text-slate-800 bg-white shadow-2xs resize-none">${product ? (product.description || '') : ''}</textarea>
        </div>

        <div class="flex items-center gap-2 pt-1">
          <input type="checkbox" id="prod-active" ${!product || product.isActive ? 'checked' : ''} class="rounded border-slate-300 text-[#138FCB] focus:ring-0">
          <label for="prod-active" class="font-semibold text-slate-700 cursor-pointer">Active Product in ERP Catalog</label>
        </div>
      </section>

      <!-- SECTION 3: Product Variants & SKUs (Direct Variant Definition) -->
      <section class="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-xs space-y-4" data-purpose="product-variants-section" id="modal-variants-section">
        <div class="flex items-center justify-between border-b border-slate-100 pb-3">
          <div>
            <h3 class="text-xs font-bold uppercase tracking-wider text-slate-700 flex items-center gap-2">
              <span>🏷️</span>
              <span>3. Product Variants &amp; SKUs</span>
            </h3>
            <p class="text-[10px] text-slate-400 mt-0.5">Define one or multiple variant models with separate SKUs, pricing &amp; roll lengths</p>
          </div>
          <button type="button" id="modal-add-variant-row-btn" class="inline-flex items-center gap-1.5 px-3 py-1.5 bg-blue-50 hover:bg-blue-100 text-[#138FCB] rounded-xl text-xs font-bold border border-blue-200 transition-all cursor-pointer shadow-2xs">
            <span class="text-sm font-extrabold leading-none">+</span>
            <span>Add Variant Row</span>
          </button>
        </div>

        <div id="no-variants-notice" class="p-4 text-center border border-dashed border-slate-200 rounded-xl bg-slate-50/60 text-slate-500 hidden">
          <p class="font-bold text-xs text-slate-700">Standard Product (No SKUs)</p>
          <p class="text-[11px] text-slate-400 mt-1">This product does not have separate SKUs. Cut-to-length is configured above at product level. Click "+ Add Variant Row" to define variants.</p>
        </div>

        <div id="modal-variants-list" class="space-y-3">
          <!-- Dynamic variant cards rendered in onOpen -->
        </div>
      </section>
    </form>
  `;

  const footerHtml = `
    <div class="flex items-center space-x-2 text-xs text-slate-400">
      <span class="w-2 h-2 rounded-full bg-emerald-500"></span>
      <span>🛡️ Enterprise Master Product Definition</span>
    </div>
    <div class="flex items-center space-x-3 w-full sm:w-auto justify-end">
      <button id="prod-cancel-btn" type="button" class="px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100 rounded-xl transition-colors border border-slate-200 cursor-pointer">
        Cancel
      </button>
      <button type="submit" form="product-master-form" class="inline-flex items-center space-x-2 px-5 py-2.5 text-xs font-bold text-white bg-[#138FCB] hover:bg-[#0E78AC] rounded-xl shadow-xs transition-all active:scale-[0.98] cursor-pointer">
        <span>${isEdit ? 'Save Changes' : 'Create Product Master'}</span>
      </button>
    </div>
  `;

  openModal({
    title: isEdit ? `Edit Product Master: ${product.businessName}` : 'Add New Product Master',
    subtitle: 'Central business product definition and warehouse catalog record',
    badge: isEdit ? product.code : 'PROD-NEW',
    contentHtml,
    footerHtml,
    size: 'max-w-4xl',
    onOpen: (modalEl) => {
      const cancelBtn = modalEl.querySelector('#prod-cancel-btn');
      if (cancelBtn) cancelBtn.onclick = () => closeModal();

      // Cut-to-Length toggle visibility
      const rollCheckbox = modalEl.querySelector('#prod-roll-tracking');
      const ctlBox = modalEl.querySelector('#prod-ctl-config-box');
      const ctlBaseUnitInput = modalEl.querySelector('#prod-ctl-base-unit');
      const rollContainer = modalEl.querySelector('#roll-sizes-container');

      if (rollCheckbox && ctlBox) {
        rollCheckbox.onchange = () => {
          const checked = rollCheckbox.checked;
          ctlBox.classList.toggle('hidden', !checked);
          const currentUnit = (ctlBaseUnitInput ? ctlBaseUnitInput.value.trim() : '') || 'ft';
          modalEl.querySelectorAll('.mvar-ctl-fields').forEach(f => {
            f.classList.toggle('hidden', !checked);
          });
          modalEl.querySelectorAll('.mvar-price-label').forEach(lbl => {
            lbl.textContent = checked ? `Rate (PKR/${currentUnit})` : 'Selling Price (PKR)';
          });
          modalEl.querySelectorAll('.mvar-unit').forEach(inp => {
            if (checked && (!inp.value || inp.value === 'PCS')) inp.value = currentUnit;
          });
          modalEl.querySelectorAll('.mvar-roll-unit').forEach(inp => {
            if (!inp.value) inp.value = currentUnit;
          });
        };
      }

      // Add & Remove Roll Sizes
      const addRollBtn = modalEl.querySelector('#add-roll-size-btn');

      const bindRemoveButtons = () => {
        if (!rollContainer) return;
        rollContainer.querySelectorAll('.remove-roll-size-btn').forEach(btn => {
          btn.onclick = () => {
            const rows = rollContainer.querySelectorAll('.roll-size-row');
            if (rows.length > 1) {
              btn.closest('.roll-size-row').remove();
            } else {
              toast.show('At least one full roll packaging size must be specified.', 'warning');
            }
          };
        });
      };
      bindRemoveButtons();

      if (ctlBaseUnitInput) {
        ctlBaseUnitInput.oninput = () => {
          const u = ctlBaseUnitInput.value.trim() || 'ft';
          if (rollContainer) {
            rollContainer.querySelectorAll('.roll-size-unit-lbl').forEach(lbl => lbl.textContent = u);
          }
          if (rollCheckbox && rollCheckbox.checked) {
            modalEl.querySelectorAll('.mvar-price-label').forEach(lbl => {
              lbl.textContent = `Rate (PKR/${u})`;
            });
            modalEl.querySelectorAll('.mvar-roll-unit').forEach(inp => {
              inp.value = u;
            });
          }
        };
      }

      if (addRollBtn && rollContainer) {
        addRollBtn.onclick = () => {
          const u = (ctlBaseUnitInput ? ctlBaseUnitInput.value.trim() : '') || 'ft';
          const newRow = document.createElement('div');
          newRow.className = 'roll-size-row flex items-center gap-2 p-2 bg-white rounded-lg border border-slate-200 shadow-2xs animate-in fade-in duration-100';
          newRow.innerHTML = `
            <div class="flex-1">
              <input type="text" value="Roll (1,000 ${u})" placeholder="e.g. Roll (1,000 ${u})" class="roll-size-name w-full text-xs font-bold text-slate-800 border-0 focus:ring-0 p-1">
            </div>
            <div class="w-32 flex items-center gap-1">
              <input type="number" min="1" value="1000" placeholder="1000" class="roll-size-qty w-full text-xs font-mono font-bold text-blue-900 border border-slate-200 rounded px-2 py-1 text-right focus:border-[#138FCB]">
              <span class="roll-size-unit-lbl text-[10px] text-slate-500 font-bold shrink-0">${u}</span>
            </div>
            <button type="button" class="remove-roll-size-btn text-slate-400 hover:text-rose-600 p-1 transition-colors cursor-pointer" title="Remove roll size">
              ✕
            </button>
          `;
          rollContainer.appendChild(newRow);
          bindRemoveButtons();
        };
      }

      // SECTION 3: Dynamic Variant Cards Lifecycle
      let variantCounter = 0;

      const renderVariantCard = (v = null, isExisting = false) => {
        variantCounter++;
        const card = document.createElement('div');
        const defaultRollLen = 5000;
        const currentRollUnit = v?.rollUnit || (ctlBaseUnitInput ? ctlBaseUnitInput.value.trim() : '') || product?.base_unit || 'ft';
        const isVarCtl = Boolean(v?.isCutToLength || v?.cut_to_length || v?.rollLength || (isEdit && product?.cut_to_length));

        card.className = 'modal-variant-card p-3.5 bg-slate-50/80 hover:bg-slate-50 rounded-xl border border-slate-200/90 shadow-2xs space-y-3 transition-all';
        card.setAttribute('data-is-existing', isExisting ? '1' : '0');
        if (isExisting && v?.id) {
          card.setAttribute('data-var-id', v.id);
        }

        const suggestedSku = isExisting
          ? (v?.sku || '')
          : ((product ? product.code : 'PROD') + `-V${String(variantCounter).padStart(2, '0')}`);

        card.innerHTML = `
          <div class="flex items-center justify-between pb-2 border-b border-slate-200/60">
            <div class="flex items-center gap-2">
              <span class="w-5 h-5 rounded-full bg-blue-100 text-[#138FCB] font-bold text-[10px] flex items-center justify-center font-mono">#${variantCounter}</span>
              <span class="font-bold text-slate-800 text-xs">${isExisting ? (v?.name || 'Existing SKU') : 'New Variant'}</span>
              ${isExisting ? '<span class="text-[9px] font-bold bg-slate-200 text-slate-700 px-1.5 py-0.5 rounded">Saved SKU</span>' : '<span class="text-[9px] font-bold bg-emerald-100 text-emerald-800 px-1.5 py-0.5 rounded">New Variant</span>'}
            </div>
            ${!isExisting ? `
              <button type="button" class="remove-variant-card-btn text-slate-400 hover:text-rose-600 text-xs font-bold p-1 cursor-pointer transition-colors" title="Remove this variant">
                ✕ Remove
              </button>
            ` : ''}
          </div>

          <div class="grid grid-cols-1 sm:grid-cols-12 gap-3">
            <div class="sm:col-span-5 space-y-1">
              <label class="text-[11px] font-semibold text-slate-700">Variant Name / Model <span class="text-red-500">*</span></label>
              <input type="text" class="mvar-name w-full text-xs font-bold rounded-lg border border-slate-200 bg-white py-1.5 px-2.5 text-slate-800 focus:border-[#138FCB]" value="${v?.name || ''}" placeholder="e.g. Standard Model, 450 ft Roll, Heavy Gauge">
            </div>

            <div class="sm:col-span-4 space-y-1">
              <label class="text-[11px] font-semibold text-slate-700">SKU Code <span class="text-red-500">*</span></label>
              <input type="text" class="mvar-sku w-full text-xs font-mono font-bold rounded-lg border border-slate-200 bg-white py-1.5 px-2.5 text-slate-800 focus:border-[#138FCB]" value="${suggestedSku}" placeholder="e.g. FP-CN-01">
            </div>

            <div class="sm:col-span-3 space-y-1">
              <label class="text-[11px] font-semibold text-slate-700">Packaging Unit</label>
              <input type="text" class="mvar-unit w-full text-xs font-bold rounded-lg border border-slate-200 bg-white py-1.5 px-2.5 text-slate-800 focus:border-[#138FCB]" value="${v?.unit || (isVarCtl ? currentRollUnit : 'PCS')}" placeholder="${isVarCtl ? currentRollUnit : 'PCS'}">
            </div>
          </div>

          <div class="grid grid-cols-1 sm:grid-cols-12 gap-3 items-center">
            <div class="sm:col-span-3 space-y-1">
              <label class="text-[11px] font-semibold text-slate-700">Cost Price (PKR)</label>
              <input type="number" min="0" step="any" class="mvar-cost w-full text-xs font-bold rounded-lg border border-slate-200 bg-white py-1.5 px-2.5 text-slate-800 focus:border-[#138FCB]" value="${v?.costPrice || 0}">
            </div>

            <div class="sm:col-span-3 space-y-1">
              <label class="text-[11px] font-semibold text-slate-700">
                <span class="mvar-price-label">${isVarCtl ? `Rate (PKR/${currentRollUnit})` : 'Selling Price (PKR)'}</span>
              </label>
              <input type="number" min="0" step="any" class="mvar-price w-full text-xs font-bold rounded-lg border border-slate-200 bg-white py-1.5 px-2.5 text-emerald-800 focus:border-[#138FCB]" value="${v?.sellingPrice || 0}">
            </div>

            <div class="sm:col-span-6 flex flex-col justify-end">
              <div class="flex items-center gap-2 p-2 bg-blue-50/70 border border-blue-100 rounded-lg">
                <input type="checkbox" class="mvar-ctl-checkbox rounded border-slate-300 text-[#138FCB] focus:ring-0 cursor-pointer" ${isVarCtl ? 'checked' : ''}>
                <label class="text-[11px] font-bold text-slate-800 cursor-pointer">☑ Cut to Length (Roll / Continuous)</label>
              </div>
            </div>
          </div>

          <div class="mvar-ctl-fields grid grid-cols-1 sm:grid-cols-2 gap-3 p-3 bg-blue-50/40 rounded-xl border border-blue-100 ${isVarCtl ? '' : 'hidden'}">
            <div class="space-y-1">
              <label class="text-[11px] font-semibold text-blue-900">Standard Roll Length</label>
              <input type="number" min="1" step="any" class="mvar-roll-len w-full text-xs font-bold rounded-lg border border-blue-200 bg-white py-1.5 px-2.5 text-blue-900 focus:border-[#138FCB]" value="${v?.rollLength || defaultRollLen}" placeholder="5000">
              <span class="text-[10px] text-blue-600">Full roll packaging size</span>
            </div>
            <div class="space-y-1">
              <label class="text-[11px] font-semibold text-blue-900">Base Length Unit (Customizable)</label>
              <input type="text" class="mvar-roll-unit w-full text-xs font-bold rounded-lg border border-blue-200 bg-white py-1.5 px-2.5 text-blue-900 focus:border-[#138FCB]" value="${currentRollUnit}" placeholder="ft">
              <span class="text-[10px] text-blue-600">e.g. ft, m</span>
            </div>
          </div>
        `;

        const ctlCheckbox = card.querySelector('.mvar-ctl-checkbox');
        const ctlFields = card.querySelector('.mvar-ctl-fields');
        const priceLabel = card.querySelector('.mvar-price-label');
        const unitInput = card.querySelector('.mvar-unit');
        const rollUnitInput = card.querySelector('.mvar-roll-unit');

        if (ctlCheckbox) {
          ctlCheckbox.onchange = () => {
            const isChecked = ctlCheckbox.checked;
            if (ctlFields) ctlFields.classList.toggle('hidden', !isChecked);
            const u = rollUnitInput?.value.trim() || 'ft';
            if (priceLabel) priceLabel.textContent = isChecked ? `Rate (PKR/${u})` : 'Selling Price (PKR)';
            if (unitInput) {
              if (isChecked && (!unitInput.value || unitInput.value === 'PCS')) {
                unitInput.value = u;
              } else if (!isChecked && unitInput.value === u) {
                unitInput.value = 'PCS';
              }
            }
          };
        }

        if (rollUnitInput) {
          rollUnitInput.oninput = () => {
            const u = rollUnitInput.value.trim() || 'ft';
            if (ctlCheckbox?.checked && priceLabel) {
              priceLabel.textContent = `Rate (PKR/${u})`;
            }
          };
        }

        const rmBtn = card.querySelector('.remove-variant-card-btn');
        if (rmBtn) {
          rmBtn.onclick = () => {
            card.remove();
            syncCutToLengthState();
          };
        }

        return card;
      };

      const variantsList = modalEl.querySelector('#modal-variants-list');
      const addVariantRowBtn = modalEl.querySelector('#modal-add-variant-row-btn');

      const syncCutToLengthState = () => {
        const cards = variantsList.querySelectorAll('.modal-variant-card');
        const count = cards.length;
        const noVarNotice = modalEl.querySelector('#no-variants-notice');
        if (noVarNotice) {
          noVarNotice.classList.toggle('hidden', count > 0);
        }

        const rollCheckbox = modalEl.querySelector('#prod-roll-tracking');
        const ctlBox = modalEl.querySelector('#prod-ctl-config-box');
        const ctlDisabledNotice = modalEl.querySelector('#prod-ctl-disabled-notice');
        const ctlWrapper = modalEl.querySelector('#prod-ctl-wrapper');

        if (count > 0) {
          // SKUs present: disable product-level CTL and manage per variant
          if (rollCheckbox) {
            rollCheckbox.disabled = true;
            rollCheckbox.classList.add('cursor-not-allowed', 'opacity-50');
          }
          if (ctlDisabledNotice) ctlDisabledNotice.classList.remove('hidden');
          if (ctlBox) ctlBox.classList.add('hidden');
          if (ctlWrapper) ctlWrapper.classList.add('bg-slate-50', 'border-slate-200');
        } else {
          // No SKUs: enable product-level CTL
          if (rollCheckbox) {
            rollCheckbox.disabled = false;
            rollCheckbox.classList.remove('cursor-not-allowed', 'opacity-50');
          }
          if (ctlDisabledNotice) ctlDisabledNotice.classList.add('hidden');
          if (ctlBox) {
            ctlBox.classList.toggle('hidden', !rollCheckbox?.checked);
          }
          if (ctlWrapper) ctlWrapper.classList.remove('bg-slate-50', 'border-slate-200');
        }
      };

      if (isEdit && product) {
        const existingVariants = productService.getVariantsByProduct(product.id);
        existingVariants.forEach(v => {
          variantsList.appendChild(renderVariantCard(v, true));
        });
      }

      if (options?.addVariant) {
        const newCard = renderVariantCard(null, false);
        variantsList.appendChild(newCard);
        setTimeout(() => {
          const varSec = modalEl.querySelector('#modal-variants-section');
          if (varSec) varSec.scrollIntoView({ behavior: 'smooth' });
          newCard.querySelector('.mvar-name')?.focus();
        }, 100);
      }

      syncCutToLengthState();

      if (addVariantRowBtn) {
        addVariantRowBtn.onclick = () => {
          variantsList.appendChild(renderVariantCard(null, false));
          syncCutToLengthState();
        };
      }

      modalEl.querySelector('#product-master-form').onsubmit = (e) => {
        e.preventDefault();
        const businessName = modalEl.querySelector('#prod-biz-name').value.trim();
        const customerName = modalEl.querySelector('#prod-cust-name').value.trim();
        const urduName = modalEl.querySelector('#prod-urdu-name').value.trim();
        const categoryId = modalEl.querySelector('#prod-category').value;
        const baseUnitId = modalEl.querySelector('#prod-base-unit').value;
        const productType = modalEl.querySelector('#prod-type').value;
        const lowStockLevel = Number(modalEl.querySelector('#prod-low-stock').value) || 10;
        const negativeStockAllowed = modalEl.querySelector('#prod-neg-stock').value;
        const enableRollTracking = modalEl.querySelector('#prod-roll-tracking').checked;
        const description = modalEl.querySelector('#prod-desc').value.trim();
        const isActive = modalEl.querySelector('#prod-active').checked;

        // Cut to length multi-packaging data
        const variantCards = modalEl.querySelectorAll('.modal-variant-card');
        const hasVariants = variantCards.length > 0;
        const base_unit = modalEl.querySelector('#prod-ctl-base-unit')?.value.trim() || 'ft';
        const full_unit = modalEl.querySelector('#prod-ctl-full-unit-name')?.value.trim() || 'roll';

        let cut_to_length = false;
        if (hasVariants) {
          cut_to_length = Array.from(variantCards).some(c => c.querySelector('.mvar-ctl-checkbox')?.checked);
        } else {
          cut_to_length = enableRollTracking;
        }

        const packagingUnits = [];
        if (enableRollTracking && rollContainer) {
          rollContainer.querySelectorAll('.roll-size-row').forEach((row, i) => {
            const name = row.querySelector('.roll-size-name')?.value.trim() || `Roll Size ${i + 1}`;
            const factor = Number(row.querySelector('.roll-size-qty')?.value) || 5000;
            packagingUnits.push({
              id: `pkg-${Date.now()}-${i}`,
              name,
              factor,
              unit: base_unit
            });
          });
        }
        const full_unit_quantity = packagingUnits.length > 0 ? packagingUnits[0].factor : 5000;

        const payload = {
          businessName,
          customerName,
          urduName,
          categoryId,
          baseUnitId,
          productType,
          lowStockLevel,
          negativeStockAllowed,
          enableRollTracking: cut_to_length,
          cut_to_length,
          base_unit,
          full_unit,
          full_unit_quantity,
          packagingUnits,
          description,
          isActive
        };

        let savedProduct = null;
        if (isEdit) {
          savedProduct = productService.updateProduct(product.id, payload);
          toast.show('Product updated successfully.', 'success');
        } else {
          savedProduct = productService.createProduct(payload);
          toast.show('Product created successfully.', 'success');
        }

        const targetProdId = savedProduct.id;
        const prodCode = savedProduct.code;

        variantCards.forEach((card, idx) => {
          const isExisting = card.getAttribute('data-is-existing') === '1';
          const name = card.querySelector('.mvar-name')?.value.trim() || `Model ${idx + 1}`;
          const sku = card.querySelector('.mvar-sku')?.value.trim() || `${prodCode}-V${String(idx + 1).padStart(2, '0')}`;
          const costPrice = Number(card.querySelector('.mvar-cost')?.value) || 0;
          const sellingPrice = Number(card.querySelector('.mvar-price')?.value) || 0;
          const isVarCtl = card.querySelector('.mvar-ctl-checkbox')?.checked ?? false;
          const rollLength = isVarCtl ? (Number(card.querySelector('.mvar-roll-len')?.value) || 5000) : null;
          const rollUnit = isVarCtl ? (card.querySelector('.mvar-roll-unit')?.value.trim() || base_unit) : null;
          const unit = card.querySelector('.mvar-unit')?.value.trim() || (isVarCtl ? rollUnit : 'PCS');

          if (isExisting) {
            const vId = card.getAttribute('data-var-id');
            if (vId) {
              productService.updateVariant(vId, {
                name,
                sku,
                costPrice,
                sellingPrice,
                unit,
                isCutToLength: isVarCtl,
                cut_to_length: isVarCtl,
                rollLength,
                rollUnit,
                base_unit: rollUnit
              });
              if (isVarCtl) {
                const stockRec = cutToLengthService.getVariantStock('wh-1', vId);
                cutToLengthService.saveVariantStock('wh-1', vId, {
                  fullRolls: stockRec?.fullRolls !== undefined ? stockRec.fullRolls : 5,
                  rollLength,
                  loosePieces: stockRec?.loosePieces || [],
                  unit: rollUnit
                });
              }
            }
          } else {
            const createdVar = productService.createVariant({
              productId: targetProdId,
              name,
              sku,
              costPrice,
              sellingPrice,
              unit,
              isCutToLength: isVarCtl,
              cut_to_length: isVarCtl,
              rollLength,
              rollUnit,
              base_unit: rollUnit
            });

            if (isVarCtl && createdVar?.id) {
              cutToLengthService.saveVariantStock('wh-1', createdVar.id, {
                fullRolls: 5,
                rollLength,
                loosePieces: [],
                unit: rollUnit
              });
            }
          }
        });

        closeModal();
        if (onSaved) onSaved();
      };
    }
  });
}
