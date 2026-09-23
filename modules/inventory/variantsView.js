/**
 * JS Traders ERP - Product Variants & SKUs View
 * Two-level inventory structure (Product -> Variant / SKU).
 * Configurable dynamic attributes (Origin: China vs Pakistan, Material, Size).
 */

import { productService } from '../../services/productService.js';
import { inventoryService } from '../../services/inventoryService.js';
import { authService } from '../../services/authService.js';
import { renderTable, bindTableActions } from '../../components/table.js';
import { renderFilterBar } from '../../components/filters.js';
import { openModal, closeModal } from '../../components/modal.js';
import { confirmAction } from '../../components/confirmation.js';
import { toast } from '../../components/toast.js';

export function renderVariantsView() {
  const variants = productService.getVariants();
  const products = productService.getProducts();
  const prodMap = new Map(products.map(p => [p.id, p]));
  const canViewCost = authService.canViewCostProfit();

  const filterBarHtml = renderFilterBar({
    searchPlaceholder: 'Search variants by SKU, name, or attribute (e.g. China)...',
    dropdowns: [
      {
        id: 'variant-origin-filter',
        label: 'Origin',
        value: 'all',
        options: [
          { value: 'all', label: 'All Origins' },
          { value: 'China', label: 'Imported (China)' },
          { value: 'Local', label: 'Local (Pakistan)' }
        ]
      }
    ],
    primaryAction: { label: '+ Add Variant' }
  });

  const columns = [
    {
      key: 'sku',
      label: 'SKU / Code',
      render: row => `
        <div>
          <div class="font-bold text-[#138FCB] font-mono">${row.sku}</div>
          <div class="text-[10px] text-slate-400 font-mono">${row.code}</div>
        </div>
      `
    },
    {
      key: 'name',
      label: 'Variant Name',
      render: row => `<span class="font-bold text-slate-800">${row.name}</span>`
    },
    {
      key: 'product',
      label: 'Parent Product',
      render: row => {
        const prod = prodMap.get(row.productId);
        return prod ? `<span class="font-medium text-slate-700">${prod.businessName}</span>` : '-';
      }
    },
    {
      key: 'attributes',
      label: 'Attributes',
      render: row => {
        const attrs = Object.entries(row.attributes || {});
        if (attrs.length === 0) return '<span class="text-slate-400 text-[10px]">None</span>';
        return `
          <div class="flex flex-wrap gap-1">
            ${attrs.map(([k, v]) => `
              <span class="px-2 py-0.5 rounded text-[10px] font-semibold ${k === 'Origin' && v === 'China' ? 'bg-red-50 text-red-700 border border-red-100' : 'bg-slate-100 text-slate-700'}">
                ${k}: ${v}
              </span>
            `).join('')}
          </div>
        `;
      }
    },
    ...(canViewCost ? [
      {
        key: 'costPrice',
        label: 'Standard Cost',
        align: 'right',
        render: row => `<span class="font-semibold text-slate-600 font-mono">Rs. ${Number(row.costPrice || 0).toLocaleString()}</span>`
      }
    ] : []),
    {
      key: 'sellingPrice',
      label: 'Selling Price',
      align: 'right',
      render: row => `<span class="font-bold text-[#138FCB] font-mono">Rs. ${Number(row.sellingPrice || 0).toLocaleString()}</span>`
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
    { label: 'Edit', variant: 'secondary' }
  ];

  const tableHtml = renderTable({
    columns,
    data: variants,
    actions,
    emptyMessage: 'No variants created yet. Click "+ Add Variant" to configure product SKUs.'
  });

  return `
    <div id="variants-view-container" class="space-y-5 animate-in fade-in duration-150">
      ${filterBarHtml}
      <div id="variants-table-container">
        ${tableHtml}
      </div>
    </div>
  `;
}

export function bindVariantsEvents(container, refreshCallback) {
  const addBtn = container.querySelector('#filter-primary-btn');
  if (addBtn) {
    addBtn.onclick = () => openVariantModal(null, refreshCallback);
  }

  const variants = productService.getVariants();
  const actions = [
    { label: 'View', variant: 'secondary', onClick: (row) => openVariantDetailModal(row, refreshCallback) },
    { label: 'Edit', variant: 'secondary', onClick: (row) => openVariantModal(row, refreshCallback) }
  ];
  bindTableActions(container, actions, variants);

  const searchInput = container.querySelector('#filter-search-input');
  if (searchInput) {
    searchInput.oninput = (e) => {
      const q = e.target.value;
      const filtered = productService.searchVariants(q);
      updateVariantsTable(container, filtered, refreshCallback);
    };
  }

  const originFilter = container.querySelector('#variant-origin-filter');
  if (originFilter) {
    originFilter.onchange = (e) => {
      const val = e.target.value;
      const filtered = val === 'all'
        ? variants
        : variants.filter(v => v.attributes && v.attributes.Origin === val);
      updateVariantsTable(container, filtered, refreshCallback);
    };
  }
}

function updateVariantsTable(container, filteredData, refreshCallback) {
  const tableContainer = container.querySelector('#variants-table-container');
  if (!tableContainer) return;

  const products = productService.getProducts();
  const prodMap = new Map(products.map(p => [p.id, p]));
  const canViewCost = authService.canViewCostProfit();

  const columns = [
    { key: 'sku', label: 'SKU / Code', render: row => `<div><div class="font-bold text-[#138FCB] font-mono">${row.sku}</div><div class="text-[10px] text-slate-400 font-mono">${row.code}</div></div>` },
    { key: 'name', label: 'Variant Name', render: row => `<span class="font-bold text-slate-800">${row.name}</span>` },
    { key: 'product', label: 'Parent Product', render: row => { const prod = prodMap.get(row.productId); return prod ? `<span class="font-medium text-slate-700">${prod.businessName}</span>` : '-'; } },
    { key: 'attributes', label: 'Attributes', render: row => {
      const attrs = Object.entries(row.attributes || {});
      return attrs.length === 0 ? '<span class="text-slate-400 text-[10px]">None</span>' : `<div class="flex flex-wrap gap-1">${attrs.map(([k, v]) => `<span class="px-2 py-0.5 rounded text-[10px] font-semibold ${k === 'Origin' && v === 'China' ? 'bg-red-50 text-red-700 border border-red-100' : 'bg-slate-100 text-slate-700'}">${k}: ${v}</span>`).join('')}</div>`;
    }},
    ...(canViewCost ? [{ key: 'costPrice', label: 'Standard Cost', align: 'right', render: row => `<span class="font-semibold text-slate-600 font-mono">Rs. ${Number(row.costPrice || 0).toLocaleString()}</span>` }] : []),
    { key: 'sellingPrice', label: 'Selling Price', align: 'right', render: row => `<span class="font-bold text-[#138FCB] font-mono">Rs. ${Number(row.sellingPrice || 0).toLocaleString()}</span>` },
    { key: 'isActive', label: 'Status', render: row => `<span class="px-2.5 py-0.5 rounded-full text-[10px] font-bold ${row.isActive ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-rose-50 text-rose-700 border border-rose-200'}">${row.isActive ? 'Active' : 'Inactive / Void'}</span>` }
  ];

  const actions = [
    { label: 'View', variant: 'secondary', onClick: (row) => openVariantDetailModal(row, refreshCallback) },
    { label: 'Edit', variant: 'secondary', onClick: (row) => openVariantModal(row, refreshCallback) }
  ];

  tableContainer.innerHTML = renderTable({ columns, data: filteredData, actions });
  bindTableActions(tableContainer, actions, filteredData);
}

export function openVariantDetailModal(variant, refreshCallback) {
  const prod = productService.getProductById(variant.productId);
  const canViewCost = authService.canViewCostProfit();
  const whStock = inventoryService.getBalance('wh-1', variant.id);
  const offStock = inventoryService.getBalance('wh-2', variant.id);
  const totalStock = whStock + offStock;
  const unit = variant.unit || 'PCS';

  const contentHtml = `
    <div class="space-y-6 text-xs">
      <!-- Section 1: Variant Overview -->
      <section class="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-xs space-y-4">
        <div class="flex items-center justify-between border-b border-slate-100 pb-3">
          <h3 class="text-xs font-bold uppercase tracking-wider text-slate-700 flex items-center gap-2">
            <span>🏷️</span>
            <span>1. SKU Specification</span>
          </h3>
          <span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-bold ${variant.isActive ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-rose-50 text-rose-700 border border-rose-200'}">
            ${variant.isActive ? 'Active SKU' : 'Voided / Inactive'}
          </span>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div class="p-3 bg-slate-50/70 rounded-xl border border-slate-200/70 space-y-1">
            <span class="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Variant Name</span>
            <p class="text-sm font-bold text-slate-900">${variant.name}</p>
            <p class="text-[11px] font-mono text-[#138FCB] font-semibold">${variant.sku}</p>
          </div>

          <div class="p-3 bg-slate-50/70 rounded-xl border border-slate-200/70 space-y-1">
            <span class="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Parent Product</span>
            <p class="text-sm font-bold text-slate-800">${prod ? prod.businessName : 'Product'}</p>
            <p class="text-[11px] text-slate-500">${prod ? prod.customerName : ''}</p>
          </div>

          <div class="p-3 bg-slate-50/70 rounded-xl border border-slate-200/70 space-y-1">
            <span class="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Pricing Profile</span>
            <p class="text-sm font-bold text-slate-900 font-mono">PKR ${Number(variant.sellingPrice || 0).toLocaleString()}</p>
            ${canViewCost ? `<p class="text-[11px] text-slate-500 font-mono">Cost: PKR ${Number(variant.costPrice || 0).toLocaleString()}</p>` : ''}
          </div>
        </div>

        <!-- Dynamic attributes -->
        ${variant.attributes && Object.keys(variant.attributes).length > 0 ? `
          <div class="p-3 bg-slate-50/50 rounded-xl border border-slate-100 space-y-1.5">
            <span class="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">SKU Attributes</span>
            <div class="flex flex-wrap gap-2">
              ${Object.entries(variant.attributes).map(([k, v]) => `
                <span class="px-2.5 py-1 rounded-lg text-xs font-semibold bg-white border border-slate-200 text-slate-700 shadow-2xs">
                  <strong>${k}:</strong> ${v}
                </span>
              `).join('')}
            </div>
          </div>
        ` : ''}
      </section>

      <!-- Section 2: Live Stock Breakdown -->
      <section class="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-xs space-y-4">
        <div class="flex items-center justify-between border-b border-slate-100 pb-3">
          <h3 class="text-xs font-bold uppercase tracking-wider text-slate-700 flex items-center gap-2">
            <span>📦</span>
            <span>2. Live Facility Inventory Balances</span>
          </h3>
          <span class="font-bold text-slate-900 text-xs font-mono">Total: ${totalStock.toLocaleString()} ${unit}</span>
        </div>

        <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div class="p-4 rounded-xl bg-blue-50/50 border border-blue-200/70 space-y-1">
            <span class="text-[10px] font-bold text-blue-700 uppercase tracking-wider block">Main Warehouse (wh-1)</span>
            <p class="text-xl font-black text-slate-900 font-mono">${whStock.toLocaleString()} <span class="text-xs font-bold text-slate-500">${unit}</span></p>
          </div>

          <div class="p-4 rounded-xl bg-amber-50/50 border border-amber-200/70 space-y-1">
            <span class="text-[10px] font-bold text-amber-800 uppercase tracking-wider block">Office Hub (wh-2)</span>
            <p class="text-xl font-black text-slate-900 font-mono">${offStock.toLocaleString()} <span class="text-xs font-bold text-slate-500">${unit}</span></p>
          </div>
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
        <button id="var-detail-void-btn" type="button" class="inline-flex items-center space-x-1.5 px-3.5 py-2 text-xs font-bold ${variant.isActive ? 'text-rose-600 hover:text-rose-700 bg-rose-50 hover:bg-rose-100 border-rose-200' : 'text-emerald-600 hover:text-emerald-700 bg-emerald-50 hover:bg-emerald-100 border-emerald-200'} rounded-xl transition-colors border cursor-pointer">
          <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636"></path>
          </svg>
          <span>${variant.isActive ? 'Void / Deactivate SKU' : 'Reactivate SKU'}</span>
        </button>
      </div>
      <div class="flex items-center space-x-3">
        <button id="var-detail-close-btn" type="button" class="px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100 rounded-xl transition-colors border border-slate-200 cursor-pointer">
          Close
        </button>
        <button id="var-detail-edit-btn" type="button" class="inline-flex items-center space-x-1.5 px-4 py-2 text-xs font-bold text-white bg-[#138FCB] hover:bg-[#0E78AC] rounded-xl shadow-xs transition-all cursor-pointer">
          <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"></path>
          </svg>
          <span>Edit SKU</span>
        </button>
      </div>
    </div>
  `;

  openModal({
    title: `Variant SKU: ${variant.sku}`,
    subtitle: 'Physical attributes, pricing model, and warehouse balances',
    badge: variant.sku,
    contentHtml,
    footerHtml,
    size: 'max-w-3xl',
    onOpen: (modalEl) => {
      const closeBtn = modalEl.querySelector('#var-detail-close-btn');
      if (closeBtn) closeBtn.onclick = () => closeModal();

      const editBtn = modalEl.querySelector('#var-detail-edit-btn');
      if (editBtn) {
        editBtn.onclick = () => {
          closeModal();
          openVariantModal(variant, refreshCallback);
        };
      }

      const voidBtn = modalEl.querySelector('#var-detail-void-btn');
      if (voidBtn) {
        voidBtn.onclick = () => {
          const actionText = variant.isActive ? 'Deactivate / Void' : 'Reactivate';
          confirmAction({
            title: `${actionText} SKU: ${variant.sku}`,
            message: variant.isActive
              ? 'Are you sure you want to deactivate this SKU? It will be disabled from dropdown selections.'
              : 'Are you sure you want to reactivate this SKU for active inventory use?',
            onConfirm: () => {
              productService.updateVariant(variant.id, { isActive: !variant.isActive });
              toast.show(`SKU ${variant.sku} ${variant.isActive ? 'deactivated' : 'reactivated'}.`, 'success');
              closeModal();
              if (refreshCallback) refreshCallback();
            }
          });
        };
      }
    }
  });
}

function openVariantModal(variant = null, onSaved) {
  const isEdit = !!variant;
  const products = productService.getProducts();
  const canViewCost = authService.canViewCostProfit();

  const contentHtml = `
    <form id="variant-form" class="space-y-5 text-xs">
      <section class="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-xs space-y-4">
        <div class="flex items-center justify-between border-b border-slate-100 pb-3">
          <h3 class="text-xs font-bold uppercase tracking-wider text-slate-700 flex items-center gap-2">
            <span>🏷️</span>
            <span>1. Parent Product &amp; SKU Identity</span>
          </h3>
          <span class="text-[10px] text-slate-400 font-medium">All fields marked with <span class="text-red-500 font-bold">*</span> are required</span>
        </div>

        <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div class="space-y-1.5">
            <label class="text-xs font-semibold text-slate-700" for="var-product">Parent Product <span class="text-red-500">*</span></label>
            <select id="var-product" required class="w-full text-xs rounded-xl border border-slate-200 focus:border-[#138FCB] py-2.5 px-3 text-slate-800 bg-white shadow-2xs">
              ${products.map(p => `<option value="${p.id}" ${variant && variant.productId === p.id ? 'selected' : ''}>${p.businessName} - ${p.customerName}</option>`).join('')}
            </select>
          </div>

          <div class="space-y-1.5">
            <label class="text-xs font-semibold text-slate-700" for="var-name">Variant Name <span class="text-red-500">*</span></label>
            <input type="text" id="var-name" required value="${variant ? variant.name : ''}" placeholder="e.g. 16-inch Galvanized China" class="w-full text-xs rounded-xl border border-slate-200 focus:border-[#138FCB] py-2.5 px-3 text-slate-800 bg-white shadow-2xs">
          </div>
        </div>

        <div class="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-1">
          <div class="space-y-1.5">
            <label class="text-xs font-semibold text-slate-700" for="var-sku">SKU Code <span class="text-red-500">*</span></label>
            <input type="text" id="var-sku" required value="${variant ? variant.sku : ''}" placeholder="e.g. FP-CN-16" class="w-full text-xs font-mono font-bold rounded-xl border border-slate-200 focus:border-[#138FCB] py-2.5 px-3 text-slate-800 bg-white shadow-2xs">
          </div>

          <div class="space-y-1.5">
            <label class="text-xs font-semibold text-slate-700" for="var-barcode">Barcode / EAN</label>
            <input type="text" id="var-barcode" value="${variant ? (variant.barcode || '') : ''}" placeholder="Scan barcode..." class="w-full text-xs rounded-xl border border-slate-200 focus:border-[#138FCB] py-2.5 px-3 text-slate-800 bg-white shadow-2xs">
          </div>

          <div class="space-y-1.5">
            <label class="text-xs font-semibold text-slate-700" for="var-unit">Packaging Unit</label>
            <input type="text" id="var-unit" value="${variant ? (variant.unit || 'PCS') : 'PCS'}" placeholder="PCS" class="w-full text-xs font-bold rounded-xl border border-slate-200 focus:border-[#138FCB] py-2.5 px-3 text-slate-800 bg-white shadow-2xs">
          </div>
        </div>
      </section>

      <!-- Section 2: Attributes & Pricing -->
      <section class="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-xs space-y-4">
        <div class="flex items-center justify-between border-b border-slate-100 pb-3">
          <h3 class="text-xs font-bold uppercase tracking-wider text-slate-700 flex items-center gap-2">
            <span>⚙️</span>
            <span>2. Dynamic Attributes &amp; Pricing</span>
          </h3>
        </div>

        <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div class="space-y-1.5">
            <label class="text-xs font-semibold text-slate-700" for="var-origin">Origin Country</label>
            <select id="var-origin" class="w-full text-xs rounded-xl border border-slate-200 focus:border-[#138FCB] py-2.5 px-3 text-slate-800 bg-white shadow-2xs">
              <option value="China" ${variant && variant.attributes?.Origin === 'China' ? 'selected' : ''}>China (Imported)</option>
              <option value="Local" ${variant && variant.attributes?.Origin === 'Local' ? 'selected' : ''}>Local (Pakistan)</option>
              <option value="Turkey" ${variant && variant.attributes?.Origin === 'Turkey' ? 'selected' : ''}>Turkey</option>
              <option value="Other" ${variant && variant.attributes?.Origin === 'Other' ? 'selected' : ''}>Other</option>
            </select>
          </div>

          <div class="space-y-1.5">
            <label class="text-xs font-semibold text-slate-700" for="var-material">Material / Quality</label>
            <input type="text" id="var-material" value="${variant && variant.attributes?.Material ? variant.attributes.Material : ''}" placeholder="e.g. Galvanized Steel, Polypropylene" class="w-full text-xs rounded-xl border border-slate-200 focus:border-[#138FCB] py-2.5 px-3 text-slate-800 bg-white shadow-2xs">
          </div>
        </div>

        <div class="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-1">
          ${canViewCost ? `
            <div class="space-y-1.5">
              <label class="text-xs font-semibold text-slate-700" for="var-cost">Standard Cost (Rs.)</label>
              <input type="number" id="var-cost" min="0" step="any" value="${variant ? variant.costPrice : 0}" class="w-full text-xs font-mono font-bold rounded-xl border border-slate-200 focus:border-[#138FCB] py-2.5 px-3 text-slate-800 bg-white shadow-2xs">
            </div>
          ` : ''}

          <div class="space-y-1.5">
            <label class="text-xs font-semibold text-slate-700" for="var-selling">Selling Price (Rs.) <span class="text-red-500">*</span></label>
            <input type="number" id="var-selling" required min="0" step="any" value="${variant ? variant.sellingPrice : 0}" class="w-full text-xs font-mono font-bold rounded-xl border border-slate-200 focus:border-[#138FCB] py-2.5 px-3 text-emerald-800 bg-white shadow-2xs">
          </div>
        </div>

        <div class="flex items-center gap-2 pt-1">
          <input type="checkbox" id="var-active" ${!variant || variant.isActive ? 'checked' : ''} class="rounded border-slate-300 text-[#138FCB] focus:ring-0">
          <label for="var-active" class="font-semibold text-slate-700 cursor-pointer">Active SKU for Sales &amp; Dispatch</label>
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
      <button id="var-cancel-btn" type="button" class="px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100 rounded-xl transition-colors border border-slate-200 cursor-pointer">
        Cancel
      </button>
      <button type="submit" form="variant-form" class="inline-flex items-center space-x-2 px-5 py-2.5 text-xs font-bold text-white bg-[#138FCB] hover:bg-[#0E78AC] rounded-xl shadow-xs transition-all active:scale-[0.98] cursor-pointer">
        <span>${isEdit ? 'Save Changes' : 'Create Variant SKU'}</span>
      </button>
    </div>
  `;

  openModal({
    title: isEdit ? `Edit Variant SKU: ${variant.sku}` : 'Add New Variant SKU',
    subtitle: 'Configure product attributes, SKU barcode, and selling price',
    badge: isEdit ? variant.sku : 'VAR-NEW',
    contentHtml,
    footerHtml,
    size: 'max-w-3xl',
    onOpen: (modalEl) => {
      const cancelBtn = modalEl.querySelector('#var-cancel-btn');
      if (cancelBtn) cancelBtn.onclick = () => closeModal();

      modalEl.querySelector('#variant-form').onsubmit = (e) => {
        e.preventDefault();
        const productId = modalEl.querySelector('#var-product').value;
        const name = modalEl.querySelector('#var-name').value.trim();
        const sku = modalEl.querySelector('#var-sku').value.trim();
        const barcode = modalEl.querySelector('#var-barcode').value.trim();
        const unit = modalEl.querySelector('#var-unit').value.trim() || 'PCS';
        const origin = modalEl.querySelector('#var-origin').value;
        const material = modalEl.querySelector('#var-material').value.trim();
        const sellingPrice = Number(modalEl.querySelector('#var-selling').value) || 0;
        const costPrice = canViewCost ? (Number(modalEl.querySelector('#var-cost')?.value) || 0) : (variant?.costPrice || 0);
        const isActive = modalEl.querySelector('#var-active').checked;

        const attributes = { ...(variant?.attributes || {}) };
        if (origin) attributes.Origin = origin;
        if (material) attributes.Material = material;

        if (isEdit) {
          productService.updateVariant(variant.id, {
            productId,
            name,
            sku,
            barcode,
            unit,
            attributes,
            sellingPrice,
            costPrice,
            isActive
          });
          toast.show('Variant updated successfully.', 'success');
        } else {
          productService.createVariant({
            productId,
            name,
            sku,
            barcode,
            unit,
            attributes,
            sellingPrice,
            costPrice,
            isActive
          });
          toast.show('Variant created successfully.', 'success');
        }

        closeModal();
        if (onSaved) onSaved();
      };
    }
  });
}
