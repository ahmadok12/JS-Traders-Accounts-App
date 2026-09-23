/**
 * JS Traders ERP - Products Master View
 * Implements 3-tier product naming (Business, Customer, Urdu),
 * Cut-to-length / roll tracking toggles, negative stock rules,
 * View modal with associated variant cards, and direct variant creation.
 */

import { productService } from '../../services/productService.js';
import { storageService } from '../../services/storageService.js';
import { inventoryService } from '../../services/inventoryService.js';
import { renderTable, bindTableActions } from '../../components/table.js';
import { renderFilterBar } from '../../components/filters.js';
import { openModal, closeModal } from '../../components/modal.js';
import { confirmAction } from '../../components/confirmation.js';
import { toast } from '../../components/toast.js';

export function renderProductsView() {
  const products = productService.getProducts();
  const categories = productService.getCategories();
  const catMap = new Map(categories.map(c => [c.id, c.name]));

  const filterBarHtml = renderFilterBar({
    searchPlaceholder: 'Search by Business, Customer, Urdu name or code...',
    dropdowns: [
      {
        id: 'product-category-filter',
        label: 'Category',
        value: 'all',
        options: [{ value: 'all', label: 'All Categories' }, ...categories.map(c => ({ value: c.id, label: c.name }))]
      },
      {
        id: 'product-type-filter',
        label: 'Type',
        value: 'all',
        options: [
          { value: 'all', label: 'All Types' },
          { value: 'Stock', label: 'Stock Item' },
          { value: 'Non-Stock', label: 'Non-Stock Item' },
          { value: 'Service', label: 'Service' }
        ]
      }
    ],
    primaryAction: { label: '+ Add Product' }
  });

  const columns = [
    {
      key: 'code',
      label: 'Product ID',
      render: row => `<span class="font-bold text-[#138FCB] font-mono">${row.code}</span>`
    },
    {
      key: 'businessName',
      label: 'Business Name',
      render: row => `<span class="font-bold text-slate-800">${row.businessName}</span>`
    },
    {
      key: 'customerName',
      label: 'Customer Name',
      render: row => `
        <div>
          <div class="font-semibold text-slate-700">${row.customerName}</div>
          ${row.urduName ? `<div class="text-[11px] font-serif text-slate-500 font-bold" dir="rtl">${row.urduName}</div>` : ''}
        </div>
      `
    },
    {
      key: 'categoryId',
      label: 'Category',
      render: row => `<span class="px-2 py-0.5 rounded-lg bg-slate-100 text-slate-700 text-[10px] font-semibold">${catMap.get(row.categoryId) || 'Unassigned'}</span>`
    },
    {
      key: 'productType',
      label: 'Type',
      render: row => `<span class="font-medium text-slate-600">${row.productType || 'Stock'}</span>`
    },
    {
      key: 'variantsCount',
      label: 'Variants',
      render: row => {
        const count = productService.getVariantsByProduct(row.id).length;
        return `<span class="px-2 py-0.5 rounded-full text-[10px] font-bold ${count > 0 ? 'bg-blue-50 text-[#138FCB] border border-blue-200' : 'bg-slate-100 text-slate-500'}">${count} SKU${count !== 1 ? 's' : ''}</span>`;
      }
    },
    {
      key: 'isActive',
      label: 'Status',
      render: row => `
        <span class="px-2.5 py-0.5 rounded-full text-[10px] font-bold ${row.isActive ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-rose-50 text-rose-700 border border-rose-200'}">
          ${row.isActive ? 'Active' : 'Inactive / Void'}
        </span>
      `
    }
  ];

  const actions = [
    { label: 'View', variant: 'secondary' },
    { label: '+ Add Variant', variant: 'secondary' },
    { label: 'Edit', variant: 'secondary' }
  ];

  const tableHtml = renderTable({
    columns,
    data: products,
    actions,
    emptyMessage: 'No products defined yet. Click "+ Add Product" to create your first item.'
  });

  return `
    <div id="products-view-container" class="space-y-5 animate-in fade-in duration-150">
      ${filterBarHtml}
      <div id="products-table-container">
        ${tableHtml}
      </div>
    </div>
  `;
}

export function bindProductsEvents(container, refreshCallback) {
  // Add product button
  const addBtn = container.querySelector('#filter-primary-btn');
  if (addBtn) {
    addBtn.onclick = () => openProductModal(null, refreshCallback);
  }

  // Bind table actions
  const products = productService.getProducts();
  const actions = [
    { label: 'View', variant: 'secondary', onClick: (row) => openProductDetailModal(row, refreshCallback) },
    { label: '+ Add Variant', variant: 'secondary', onClick: (row) => openAddVariantModal(row, refreshCallback) },
    { label: 'Edit', variant: 'secondary', onClick: (row) => openProductModal(row, refreshCallback) }
  ];
  bindTableActions(container, actions, products);

  // Search input filter
  const searchInput = container.querySelector('#filter-search-input');
  if (searchInput) {
    searchInput.oninput = (e) => {
      const q = e.target.value.toLowerCase().trim();
      const filtered = products.filter(p =>
        p.businessName.toLowerCase().includes(q) ||
        p.customerName.toLowerCase().includes(q) ||
        (p.urduName && p.urduName.includes(q)) ||
        p.code.toLowerCase().includes(q)
      );
      updateProductsTable(container, filtered, refreshCallback);
    };
  }

  // Category filter
  const catFilter = container.querySelector('#product-category-filter');
  if (catFilter) {
    catFilter.onchange = (e) => {
      const val = e.target.value;
      const filtered = val === 'all' ? products : products.filter(p => p.categoryId === val);
      updateProductsTable(container, filtered, refreshCallback);
    };
  }

  // Type filter
  const typeFilter = container.querySelector('#product-type-filter');
  if (typeFilter) {
    typeFilter.onchange = (e) => {
      const val = e.target.value;
      const filtered = val === 'all' ? products : products.filter(p => (p.productType || 'Stock') === val);
      updateProductsTable(container, filtered, refreshCallback);
    };
  }
}

function updateProductsTable(container, filteredData, refreshCallback) {
  const tableContainer = container.querySelector('#products-table-container');
  if (!tableContainer) return;

  const categories = productService.getCategories();
  const catMap = new Map(categories.map(c => [c.id, c.name]));

  const columns = [
    { key: 'code', label: 'Product ID', render: row => `<span class="font-bold text-[#138FCB] font-mono">${row.code}</span>` },
    { key: 'businessName', label: 'Business Name', render: row => `<span class="font-bold text-slate-800">${row.businessName}</span>` },
    { key: 'customerName', label: 'Customer Name', render: row => `<div><div class="font-semibold text-slate-700">${row.customerName}</div>${row.urduName ? `<div class="text-[11px] font-serif text-slate-500 font-bold" dir="rtl">${row.urduName}</div>` : ''}</div>` },
    { key: 'categoryId', label: 'Category', render: row => `<span class="px-2 py-0.5 rounded-lg bg-slate-100 text-slate-700 text-[10px] font-semibold">${catMap.get(row.categoryId) || 'Unassigned'}</span>` },
    { key: 'productType', label: 'Type', render: row => `<span class="font-medium text-slate-600">${row.productType || 'Stock'}</span>` },
    {
      key: 'variantsCount',
      label: 'Variants',
      render: row => {
        const count = productService.getVariantsByProduct(row.id).length;
        return `<span class="px-2 py-0.5 rounded-full text-[10px] font-bold ${count > 0 ? 'bg-blue-50 text-[#138FCB] border border-blue-200' : 'bg-slate-100 text-slate-500'}">${count} SKU${count !== 1 ? 's' : ''}</span>`;
      }
    },
    { key: 'isActive', label: 'Status', render: row => `<span class="px-2.5 py-0.5 rounded-full text-[10px] font-bold ${row.isActive ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-rose-50 text-rose-700 border border-rose-200'}">${row.isActive ? 'Active' : 'Inactive / Void'}</span>` }
  ];

  const actions = [
    { label: 'View', variant: 'secondary', onClick: (row) => openProductDetailModal(row, refreshCallback) },
    { label: '+ Add Variant', variant: 'secondary', onClick: (row) => openAddVariantModal(row, refreshCallback) },
    { label: 'Edit', variant: 'secondary', onClick: (row) => openProductModal(row, refreshCallback) }
  ];

  tableContainer.innerHTML = renderTable({ columns, data: filteredData, actions });
  bindTableActions(tableContainer, actions, filteredData);
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

                    <!-- Attributes -->
                    ${v.attributes && Object.keys(v.attributes).length > 0 ? `
                      <div class="flex flex-wrap gap-1.5 pt-0.5">
                        ${Object.entries(v.attributes).map(([k, val]) => `
                          <span class="text-[10px] bg-slate-100 text-slate-600 px-2 py-0.5 rounded-md font-medium border border-slate-200/60">
                            <strong>${k}:</strong> ${val}
                          </span>
                        `).join('')}
                      </div>
                    ` : ''}

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
      <span>🛡️ SSL 256-bit encrypted ERP transaction</span>
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
  const units = storageService.getCollection('units');
  const baseUnit = units.find(u => u.id === product.baseUnitId);
  const existingVariants = productService.getVariantsByProduct(product.id);
  const nextSkuIndex = String(existingVariants.length + 1).padStart(2, '0');
  const suggestedSku = `${product.code}-V${nextSkuIndex}`;

  const contentHtml = `
    <form id="add-variant-form" class="space-y-5 text-xs">
      <!-- Parent Product Context Card -->
      <section class="bg-blue-50/50 p-4 rounded-xl border border-blue-200/70 flex items-center justify-between">
        <div>
          <span class="text-[10px] font-bold text-blue-600 uppercase tracking-wider block">Parent Product Master</span>
          <h4 class="font-bold text-slate-800 text-sm">${product.businessName} (${product.customerName})</h4>
          <span class="text-[11px] font-mono text-slate-500 font-semibold">${product.code}</span>
        </div>
        <div class="text-right">
          <span class="text-[10px] text-slate-400 font-semibold block">Base Unit</span>
          <span class="font-bold text-slate-700 bg-white px-2 py-0.5 rounded border border-blue-200 text-xs">${baseUnit ? baseUnit.code : 'PCS'}</span>
        </div>
      </section>

      <!-- Variant Information Section -->
      <section class="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-xs space-y-4">
        <div class="flex items-center justify-between border-b border-slate-100 pb-3">
          <h3 class="text-xs font-bold uppercase tracking-wider text-slate-700 flex items-center gap-2">
            <span>🏷️</span>
            <span>Variant Specification &amp; Pricing</span>
          </h3>
          <span class="text-[10px] text-slate-400 font-medium">All fields marked with <span class="text-red-500 font-bold">*</span> are required</span>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div class="space-y-1.5">
            <label class="text-xs font-semibold text-slate-700" for="var-name">Variant Name / Model <span class="text-red-500">*</span></label>
            <input type="text" id="var-name" required placeholder="e.g. 16-inch Galvanized China Heavy" class="w-full text-xs font-medium rounded-xl border border-slate-200 focus:border-[#138FCB] focus:ring focus:ring-blue-100 py-2.5 px-3 text-slate-800 bg-white shadow-2xs">
          </div>

          <div class="space-y-1.5">
            <label class="text-xs font-semibold text-slate-700" for="var-sku">SKU Code <span class="text-red-500">*</span></label>
            <input type="text" id="var-sku" required value="${suggestedSku}" placeholder="e.g. FP-CN-16-HG" class="w-full text-xs font-mono font-bold rounded-xl border border-slate-200 focus:border-[#138FCB] focus:ring focus:ring-blue-100 py-2.5 px-3 text-slate-800 bg-white shadow-2xs">
          </div>
        </div>

        <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div class="space-y-1.5">
            <label class="text-xs font-semibold text-slate-700" for="var-cost">Base Cost Price (PKR) <span class="text-red-500">*</span></label>
            <input type="number" id="var-cost" required min="0" step="any" placeholder="0" class="w-full text-xs font-bold rounded-xl border border-slate-200 focus:border-[#138FCB] focus:ring focus:ring-blue-100 py-2.5 px-3 text-slate-800 bg-white shadow-2xs">
          </div>

          <div class="space-y-1.5">
            <label class="text-xs font-semibold text-slate-700" for="var-price">Selling Price (PKR) <span class="text-red-500">*</span></label>
            <input type="number" id="var-price" required min="0" step="any" placeholder="0" class="w-full text-xs font-bold rounded-xl border border-slate-200 focus:border-[#138FCB] focus:ring focus:ring-blue-100 py-2.5 px-3 text-emerald-800 bg-white shadow-2xs">
          </div>

          <div class="space-y-1.5">
            <label class="text-xs font-semibold text-slate-700" for="var-unit">Packaging Unit</label>
            <input type="text" id="var-unit" value="${baseUnit ? baseUnit.code : 'PCS'}" placeholder="PCS" class="w-full text-xs font-bold rounded-xl border border-slate-200 focus:border-[#138FCB] focus:ring focus:ring-blue-100 py-2.5 px-3 text-slate-800 bg-white shadow-2xs">
          </div>
        </div>
      </section>

      <!-- Attributes (Dynamic Specs) -->
      <section class="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-xs space-y-4">
        <div class="flex items-center justify-between border-b border-slate-100 pb-3">
          <h3 class="text-xs font-bold uppercase tracking-wider text-slate-700 flex items-center gap-2">
            <span>⚙️</span>
            <span>Variant Attributes (Optional)</span>
          </h3>
          <span class="text-[10px] text-slate-400 font-medium">Origin, Material, Gauge &amp; Sizing</span>
        </div>

        <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div class="space-y-1.5">
            <label class="text-xs font-semibold text-slate-700" for="var-attr-origin">Origin Country</label>
            <input type="text" id="var-attr-origin" placeholder="e.g. China, Local, Turkey" class="w-full text-xs rounded-xl border border-slate-200 focus:border-[#138FCB] py-2 px-3 text-slate-800 bg-white shadow-2xs">
          </div>

          <div class="space-y-1.5">
            <label class="text-xs font-semibold text-slate-700" for="var-attr-material">Material / Quality</label>
            <input type="text" id="var-attr-material" placeholder="e.g. Galvanized Steel, Polypropylene" class="w-full text-xs rounded-xl border border-slate-200 focus:border-[#138FCB] py-2 px-3 text-slate-800 bg-white shadow-2xs">
          </div>

          <div class="space-y-1.5">
            <label class="text-xs font-semibold text-slate-700" for="var-attr-size">Size / Gauge</label>
            <input type="text" id="var-attr-size" placeholder="e.g. 16-inch, 2mm, 150m" class="w-full text-xs rounded-xl border border-slate-200 focus:border-[#138FCB] py-2 px-3 text-slate-800 bg-white shadow-2xs">
          </div>
        </div>
      </section>
    </form>
  `;

  const footerHtml = `
    <div class="flex items-center space-x-2 text-xs text-slate-400">
      <span class="w-2 h-2 rounded-full bg-emerald-500"></span>
      <span>🛡️ SSL 256-bit encrypted ERP transaction</span>
    </div>
    <div class="flex items-center space-x-3 w-full sm:w-auto justify-end">
      <button id="add-var-cancel-btn" type="button" class="px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100 rounded-xl transition-colors border border-slate-200 cursor-pointer">
        Cancel
      </button>
      <button type="submit" form="add-variant-form" class="inline-flex items-center space-x-2 px-5 py-2.5 text-xs font-bold text-white bg-[#138FCB] hover:bg-[#0E78AC] rounded-xl shadow-xs transition-all active:scale-[0.98] cursor-pointer">
        <span class="text-sm font-extrabold leading-none">+</span>
        <span>Save &amp; Add Variant</span>
      </button>
    </div>
  `;

  openModal({
    title: `Add Variant to ${product.businessName}`,
    subtitle: 'Create a new SKU with custom pricing, packaging unit, and physical attributes',
    badge: product.code,
    contentHtml,
    footerHtml,
    size: 'max-w-2xl',
    onOpen: (modalEl) => {
      const cancelBtn = modalEl.querySelector('#add-var-cancel-btn');
      if (cancelBtn) cancelBtn.onclick = () => closeModal();

      modalEl.querySelector('#add-variant-form').onsubmit = (e) => {
        e.preventDefault();
        const name = modalEl.querySelector('#var-name').value.trim();
        const sku = modalEl.querySelector('#var-sku').value.trim();
        const costPrice = Number(modalEl.querySelector('#var-cost').value) || 0;
        const sellingPrice = Number(modalEl.querySelector('#var-price').value) || 0;
        const unit = modalEl.querySelector('#var-unit').value.trim() || 'PCS';

        const origin = modalEl.querySelector('#var-attr-origin').value.trim();
        const material = modalEl.querySelector('#var-attr-material').value.trim();
        const size = modalEl.querySelector('#var-attr-size').value.trim();

        const attributes = {};
        if (origin) attributes.Origin = origin;
        if (material) attributes.Material = material;
        if (size) attributes.Size = size;

        try {
          productService.createVariant({
            productId: product.id,
            name,
            sku,
            costPrice,
            sellingPrice,
            unit,
            attributes,
            isActive: true
          });

          toast.show(`Variant SKU "${sku}" added successfully to ${product.businessName}.`, 'success');
          closeModal();
          if (onSaved) onSaved();
        } catch (err) {
          toast.show(err.message, 'error');
        }
      };
    }
  });
}

/**
 * Edit or Create Product Master Modal
 */
export function openProductModal(product = null, onSaved) {
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
              ${categories.map(c => `<option value="${c.id}" ${product && product.categoryId === c.id ? 'selected' : ''}>${c.name}</option>`).join('')}
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
            <div class="flex items-center gap-2 p-2.5 bg-blue-50/70 border border-blue-100 rounded-xl">
              <input type="checkbox" id="prod-roll-tracking" ${product && (product.cut_to_length || product.enableRollTracking) ? 'checked' : ''} class="rounded border-slate-300 text-[#138FCB] focus:ring-0">
              <label for="prod-roll-tracking" class="font-bold text-slate-800 cursor-pointer">☑ Cut to Length</label>
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
              <select id="prod-ctl-base-unit" class="w-full text-xs font-bold rounded-lg border border-slate-200 bg-white py-1.5 px-2.5 text-slate-800 focus:border-[#138FCB]">
                <option value="ft" ${!product || product.base_unit === 'ft' ? 'selected' : ''}>Feet (ft)</option>
                <option value="m" ${product && product.base_unit === 'm' ? 'selected' : ''}>Meters (m)</option>
              </select>
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
                { id: 'pkg-default-1', name: 'Roll (5,000 ft)', factor: 5000, unit: 'ft' },
                { id: 'pkg-default-2', name: 'Roll (3,280 ft)', factor: 3280, unit: 'ft' }
              ]).map((pkg, idx) => `
                <div class="roll-size-row flex items-center gap-2 p-2 bg-white rounded-lg border border-slate-200 shadow-2xs">
                  <div class="flex-1">
                    <input type="text" value="${pkg.name}" placeholder="e.g. Roll (5,000 ft)" class="roll-size-name w-full text-xs font-bold text-slate-800 border-0 focus:ring-0 p-1">
                  </div>
                  <div class="w-32 flex items-center gap-1">
                    <input type="number" min="1" value="${pkg.factor}" placeholder="5000" class="roll-size-qty w-full text-xs font-mono font-bold text-blue-900 border border-slate-200 rounded px-2 py-1 text-right focus:border-[#138FCB]">
                    <span class="roll-size-unit-lbl text-[10px] text-slate-500 font-bold shrink-0">ft</span>
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
    </form>
  `;

  const footerHtml = `
    <div class="flex items-center space-x-2 text-xs text-slate-400">
      <span class="w-2 h-2 rounded-full bg-emerald-500"></span>
      <span>🛡️ SSL 256-bit encrypted ERP transaction</span>
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
    size: 'max-w-3xl',
    onOpen: (modalEl) => {
      const cancelBtn = modalEl.querySelector('#prod-cancel-btn');
      if (cancelBtn) cancelBtn.onclick = () => closeModal();

      // Cut-to-Length toggle visibility
      const rollCheckbox = modalEl.querySelector('#prod-roll-tracking');
      const ctlBox = modalEl.querySelector('#prod-ctl-config-box');
      if (rollCheckbox && ctlBox) {
        rollCheckbox.onchange = () => {
          ctlBox.classList.toggle('hidden', !rollCheckbox.checked);
        };
      }

      // Add & Remove Roll Sizes
      const addRollBtn = modalEl.querySelector('#add-roll-size-btn');
      const rollContainer = modalEl.querySelector('#roll-sizes-container');
      const baseUnitSelect = modalEl.querySelector('#prod-ctl-base-unit');

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

      if (baseUnitSelect) {
        baseUnitSelect.onchange = () => {
          const u = baseUnitSelect.value;
          if (rollContainer) {
            rollContainer.querySelectorAll('.roll-size-unit-lbl').forEach(lbl => lbl.textContent = u);
          }
        };
      }

      if (addRollBtn && rollContainer) {
        addRollBtn.onclick = () => {
          const u = baseUnitSelect ? baseUnitSelect.value : 'ft';
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
        const cut_to_length = enableRollTracking;
        const base_unit = modalEl.querySelector('#prod-ctl-base-unit')?.value || 'ft';
        const full_unit = modalEl.querySelector('#prod-ctl-full-unit-name')?.value.trim() || 'roll';

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
          enableRollTracking,
          cut_to_length,
          base_unit,
          full_unit,
          full_unit_quantity,
          packagingUnits,
          description,
          isActive
        };

        if (isEdit) {
          productService.updateProduct(product.id, payload);
          toast.show('Product updated successfully.', 'success');
        } else {
          productService.createProduct(payload);
          toast.show('Product created successfully.', 'success');
        }

        closeModal();
        if (onSaved) onSaved();
      };
    }
  });
}
