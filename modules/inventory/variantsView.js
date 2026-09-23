/**
 * JS Traders ERP - Product Variants & SKUs View
 * Two-level inventory structure (Product -> Variant / SKU).
 * Configurable dynamic attributes (Origin: China vs Pakistan, Material, Size).
 */

import { productService } from '../../services/productService.js';
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
          { value: 'China', label: 'China' },
          { value: 'Pakistan', label: 'Pakistan' }
        ]
      }
    ],
    primaryAction: { label: 'Add Variant / SKU' }
  });

  const columns = [
    {
      key: 'sku',
      label: 'SKU / Code',
      render: row => `
        <div>
          <div class="font-bold text-[#138FCB]">${row.sku}</div>
          <div class="text-[10px] text-slate-400">${row.code}</div>
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
        return prod ? `<span class="font-medium text-slate-700">${prod.businessName} (${prod.customerName})</span>` : '-';
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
        render: row => `<span class="font-semibold text-slate-600">Rs. ${Number(row.costPrice || 0).toLocaleString()}</span>`
      }
    ] : []),
    {
      key: 'sellingPrice',
      label: 'Selling Price',
      align: 'right',
      render: row => `<span class="font-bold text-[#138FCB]">Rs. ${Number(row.sellingPrice || 0).toLocaleString()}</span>`
    },
    {
      key: 'isActive',
      label: 'Status',
      render: row => `
        <span class="px-2 py-0.5 rounded-full text-[10px] font-bold ${row.isActive ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}">
          ${row.isActive ? 'Active' : 'Inactive'}
        </span>
      `
    }
  ];

  const actions = [
    { label: 'Edit', onClick: (row) => openVariantModal(row) },
    { label: 'Delete', variant: 'danger', onClick: (row) => handleDeleteVariant(row) }
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
    { label: 'Edit', onClick: (row) => openVariantModal(row, refreshCallback) },
    { label: 'Delete', onClick: (row) => handleDeleteVariant(row, refreshCallback) }
  ];
  bindTableActions(container, actions, variants);

  // Search input
  const searchInput = container.querySelector('#filter-search-input');
  if (searchInput) {
    searchInput.oninput = (e) => {
      const q = e.target.value;
      const filtered = productService.searchVariants(q);
      updateVariantsTable(container, filtered, refreshCallback);
    };
  }

  // Origin filter
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
    { key: 'sku', label: 'SKU / Code', render: row => `<div><div class="font-bold text-[#138FCB]">${row.sku}</div><div class="text-[10px] text-slate-400">${row.code}</div></div>` },
    { key: 'name', label: 'Variant Name', render: row => `<span class="font-bold text-slate-800">${row.name}</span>` },
    { key: 'product', label: 'Parent Product', render: row => { const prod = prodMap.get(row.productId); return prod ? `<span class="font-medium text-slate-700">${prod.businessName}</span>` : '-'; } },
    { key: 'attributes', label: 'Attributes', render: row => {
      const attrs = Object.entries(row.attributes || {});
      return attrs.length === 0 ? '<span class="text-slate-400 text-[10px]">None</span>' : `<div class="flex flex-wrap gap-1">${attrs.map(([k, v]) => `<span class="px-2 py-0.5 rounded text-[10px] font-semibold ${k === 'Origin' && v === 'China' ? 'bg-red-50 text-red-700' : 'bg-slate-100 text-slate-700'}">${k}: ${v}</span>`).join('')}</div>`;
    }},
    ...(canViewCost ? [{ key: 'costPrice', label: 'Standard Cost', align: 'right', render: row => `<span class="font-semibold text-slate-600">Rs. ${Number(row.costPrice || 0).toLocaleString()}</span>` }] : []),
    { key: 'sellingPrice', label: 'Selling Price', align: 'right', render: row => `<span class="font-bold text-[#138FCB]">Rs. ${Number(row.sellingPrice || 0).toLocaleString()}</span>` },
    { key: 'isActive', label: 'Status', render: row => `<span class="px-2 py-0.5 rounded-full text-[10px] font-bold ${row.isActive ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}">${row.isActive ? 'Active' : 'Inactive'}</span>` }
  ];

  const actions = [
    { label: 'Edit', onClick: (row) => openVariantModal(row, refreshCallback) },
    { label: 'Delete', onClick: (row) => handleDeleteVariant(row, refreshCallback) }
  ];

  tableContainer.innerHTML = renderTable({ columns, data: filteredData, actions });
  bindTableActions(tableContainer, actions, filteredData);
}

function handleDeleteVariant(variant, refreshCallback) {
  confirmAction({
    title: `Delete Variant: ${variant.sku}`,
    message: 'This record may affect inventory, accounting or related transactions. Are you sure you want to continue?',
    onConfirm: () => {
      try {
        productService.deleteVariant(variant.id);
        toast.show('Variant deleted successfully.', 'success');
        if (refreshCallback) refreshCallback();
      } catch (err) {
        toast.show(err.message, 'error');
      }
    }
  });
}

function openVariantModal(variant = null, onSaved) {
  const isEdit = !!variant;
  const products = productService.getProducts();
  const canViewCost = authService.canViewCostProfit();

  const contentHtml = `
    <form id="variant-form" class="space-y-4 text-xs">
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label class="block font-bold text-slate-700 mb-1">Parent Product *</label>
          <select id="var-product" required class="w-full border border-slate-200 rounded-xl px-3 py-2 text-slate-800 focus:outline-none focus:border-[#138FCB]">
            ${products.map(p => `<option value="${p.id}" ${variant && variant.productId === p.id ? 'selected' : ''}>${p.businessName} - ${p.customerName}</option>`).join('')}
          </select>
        </div>

        <div>
          <label class="block font-bold text-slate-700 mb-1">SKU (Stock Keeping Unit) *</label>
          <input type="text" id="var-sku" required value="${variant ? variant.sku : ''}" placeholder="e.g. FP-CN-16-CHN" class="w-full border border-slate-200 rounded-xl px-3 py-2 text-slate-800 font-bold focus:outline-none focus:border-[#138FCB]">
        </div>
      </div>

      <div>
        <label class="block font-bold text-slate-700 mb-1">Variant Name *</label>
        <input type="text" id="var-name" required value="${variant ? variant.name : ''}" placeholder="e.g. Feed Pan 16-inch - Made in China" class="w-full border border-slate-200 rounded-xl px-3 py-2 text-slate-800 focus:outline-none focus:border-[#138FCB]">
      </div>

      <!-- Configurable Dynamic Attributes -->
      <div class="p-3.5 bg-slate-50 rounded-xl border border-slate-200 space-y-3">
        <span class="text-[11px] font-bold text-slate-700 uppercase tracking-wider block">Configurable Attributes</span>
        <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <label class="block text-slate-600 font-medium mb-1">Origin</label>
            <select id="attr-origin" class="w-full bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 text-slate-800 focus:outline-none focus:border-[#138FCB]">
              <option value="China" ${variant && variant.attributes?.Origin === 'China' ? 'selected' : ''}>China</option>
              <option value="Pakistan" ${variant && variant.attributes?.Origin === 'Pakistan' ? 'selected' : ''}>Pakistan</option>
              <option value="Turkey" ${variant && variant.attributes?.Origin === 'Turkey' ? 'selected' : ''}>Turkey</option>
            </select>
          </div>

          <div>
            <label class="block text-slate-600 font-medium mb-1">Material</label>
            <input type="text" id="attr-material" value="${variant ? (variant.attributes?.Material || '') : ''}" placeholder="e.g. Virgin Polypropylene" class="w-full bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 text-slate-800 focus:outline-none focus:border-[#138FCB]">
          </div>

          <div>
            <label class="block text-slate-600 font-medium mb-1">Size / Dimension</label>
            <input type="text" id="attr-size" value="${variant ? (variant.attributes?.Size || '') : ''}" placeholder="e.g. 16-inch" class="w-full bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 text-slate-800 focus:outline-none focus:border-[#138FCB]">
          </div>
        </div>
      </div>

      <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
        ${canViewCost ? `
        <div>
          <label class="block font-bold text-slate-700 mb-1">Standard Cost (PKR)</label>
          <input type="number" id="var-cost" min="0" value="${variant ? variant.costPrice : 0}" class="w-full border border-slate-200 rounded-xl px-3 py-2 text-slate-800 focus:outline-none focus:border-[#138FCB]">
          <p class="text-[10px] text-slate-400 mt-0.5">Sensitive: Only visible with View Cost/Profit permission</p>
        </div>` : ''}

        <div>
          <label class="block font-bold text-slate-700 mb-1">Selling Price (PKR) *</label>
          <input type="number" id="var-price" required min="0" value="${variant ? variant.sellingPrice : 0}" class="w-full border border-slate-200 rounded-xl px-3 py-2 text-slate-800 font-bold focus:outline-none focus:border-[#138FCB]">
        </div>
      </div>

      <div class="flex items-center gap-2 pt-1">
        <input type="checkbox" id="var-active" ${!variant || variant.isActive ? 'checked' : ''} class="rounded border-slate-300 text-[#138FCB] focus:ring-0">
        <label for="var-active" class="font-medium text-slate-700">Active Variant</label>
      </div>

      <div class="flex justify-end gap-3 pt-4 border-t border-slate-100">
        <button type="button" id="var-cancel-btn" class="px-4 py-2 text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-xl font-semibold transition-colors cursor-pointer">Cancel</button>
        <button type="submit" class="px-4 py-2 bg-[#138FCB] hover:bg-[#0E78AC] text-white rounded-xl font-semibold shadow-xs transition-colors cursor-pointer">${isEdit ? 'Save Variant' : 'Create Variant'}</button>
      </div>
    </form>
  `;

  openModal({
    title: isEdit ? `Edit Variant: ${variant.sku}` : 'Add Product Variant / SKU',
    subtitle: 'Define customer-facing configuration and attributes',
    contentHtml,
    size: 'max-w-2xl',
    onOpen: (modalEl) => {
      modalEl.querySelector('#var-cancel-btn').onclick = () => closeModal();
      modalEl.querySelector('#variant-form').onsubmit = (e) => {
        e.preventDefault();
        const productId = modalEl.querySelector('#var-product').value;
        const sku = modalEl.querySelector('#var-sku').value.trim();
        const name = modalEl.querySelector('#var-name').value.trim();
        const sellingPrice = Number(modalEl.querySelector('#var-price').value) || 0;
        const costPriceInput = modalEl.querySelector('#var-cost');
        const costPrice = costPriceInput ? (Number(costPriceInput.value) || 0) : (variant?.costPrice || 0);

        const attributes = {
          Origin: modalEl.querySelector('#attr-origin').value,
          Material: modalEl.querySelector('#attr-material').value.trim(),
          Size: modalEl.querySelector('#attr-size').value.trim()
        };

        const isActive = modalEl.querySelector('#var-active').checked;

        if (isEdit) {
          productService.updateVariant(variant.id, { productId, sku, name, sellingPrice, costPrice, attributes, isActive });
          toast.show('Variant updated successfully.', 'success');
        } else {
          productService.createVariant({ productId, sku, name, sellingPrice, costPrice, attributes, isActive });
          toast.show('Variant created successfully.', 'success');
        }

        closeModal();
        if (onSaved) onSaved();
      };
    }
  });
}
