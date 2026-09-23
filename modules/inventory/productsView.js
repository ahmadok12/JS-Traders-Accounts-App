/**
 * JS Traders ERP - Products Master View
 * Implements 3-tier product naming (Business, Customer, Urdu),
 * Cut-to-length / roll tracking toggles, and negative stock rules.
 */

import { productService } from '../../services/productService.js';
import { storageService } from '../../services/storageService.js';
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
    primaryAction: { label: 'Add Product' }
  });

  const columns = [
    {
      key: 'code',
      label: 'Product ID',
      render: row => `<span class="font-bold text-[#138FCB]">${row.code}</span>`
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
          ${row.urduName ? `<div class="text-[11px] font-serif text-slate-400" dir="rtl">${row.urduName}</div>` : ''}
        </div>
      `
    },
    {
      key: 'categoryId',
      label: 'Category',
      render: row => `<span class="px-2 py-0.5 rounded bg-slate-100 text-slate-700 text-[10px] font-semibold">${catMap.get(row.categoryId) || 'Unassigned'}</span>`
    },
    {
      key: 'productType',
      label: 'Type',
      render: row => `<span class="font-medium text-slate-600">${row.productType || 'Stock'}</span>`
    },
    {
      key: 'tracking',
      label: 'Roll Tracking',
      render: row => row.enableRollTracking
        ? `<span class="px-2 py-0.5 rounded-full bg-blue-50 text-[#138FCB] font-bold text-[10px]">Roll / Cut Enabled</span>`
        : `<span class="text-slate-400 text-[11px]">Normal Qty</span>`
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
    { label: 'Edit', variant: 'secondary', onClick: (row) => openProductModal(row) },
    { label: 'Delete', variant: 'danger', onClick: (row) => handleDeleteProduct(row) }
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
    { label: 'Edit', onClick: (row) => openProductModal(row, refreshCallback) },
    { label: 'Delete', onClick: (row) => handleDeleteProduct(row, refreshCallback) }
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
}

function updateProductsTable(container, filteredData, refreshCallback) {
  const tableContainer = container.querySelector('#products-table-container');
  if (!tableContainer) return;

  const categories = productService.getCategories();
  const catMap = new Map(categories.map(c => [c.id, c.name]));

  const columns = [
    { key: 'code', label: 'Product ID', render: row => `<span class="font-bold text-[#138FCB]">${row.code}</span>` },
    { key: 'businessName', label: 'Business Name', render: row => `<span class="font-bold text-slate-800">${row.businessName}</span>` },
    { key: 'customerName', label: 'Customer Name', render: row => `<div><div class="font-semibold text-slate-700">${row.customerName}</div>${row.urduName ? `<div class="text-[11px] font-serif text-slate-400" dir="rtl">${row.urduName}</div>` : ''}</div>` },
    { key: 'categoryId', label: 'Category', render: row => `<span class="px-2 py-0.5 rounded bg-slate-100 text-slate-700 text-[10px] font-semibold">${catMap.get(row.categoryId) || 'Unassigned'}</span>` },
    { key: 'productType', label: 'Type', render: row => `<span class="font-medium text-slate-600">${row.productType || 'Stock'}</span>` },
    { key: 'tracking', label: 'Roll Tracking', render: row => row.enableRollTracking ? `<span class="px-2 py-0.5 rounded-full bg-blue-50 text-[#138FCB] font-bold text-[10px]">Roll / Cut Enabled</span>` : `<span class="text-slate-400 text-[11px]">Normal Qty</span>` },
    { key: 'isActive', label: 'Status', render: row => `<span class="px-2 py-0.5 rounded-full text-[10px] font-bold ${row.isActive ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}">${row.isActive ? 'Active' : 'Inactive'}</span>` }
  ];

  const actions = [
    { label: 'Edit', onClick: (row) => openProductModal(row, refreshCallback) },
    { label: 'Delete', onClick: (row) => handleDeleteProduct(row, refreshCallback) }
  ];

  tableContainer.innerHTML = renderTable({ columns, data: filteredData, actions });
  bindTableActions(tableContainer, actions, filteredData);
}

function handleDeleteProduct(product, refreshCallback) {
  confirmAction({
    title: `Delete Product: ${product.businessName}`,
    message: 'This record may affect inventory, accounting or related transactions. Are you sure you want to continue?',
    onConfirm: () => {
      try {
        productService.deleteProduct(product.id);
        toast.show('Product deleted successfully.', 'success');
        if (refreshCallback) refreshCallback();
      } catch (err) {
        toast.show(err.message, 'error');
      }
    }
  });
}

function openProductModal(product = null, onSaved) {
  const isEdit = !!product;
  const categories = productService.getCategories();
  const units = storageService.getCollection('units');

  const contentHtml = `
    <form id="product-master-form" class="space-y-4 text-xs">
      <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div>
          <label class="block font-bold text-slate-700 mb-1">Business Name (Internal) *</label>
          <input type="text" id="prod-biz-name" required value="${product ? product.businessName : ''}" placeholder="e.g. FP-CN-150" class="w-full border border-slate-200 rounded-xl px-3 py-2 text-slate-800 font-bold focus:outline-none focus:border-[#138FCB]">
          <p class="text-[10px] text-slate-400 mt-0.5">Internal warehouse identifier</p>
        </div>

        <div>
          <label class="block font-bold text-slate-700 mb-1">Customer Name (Sales) *</label>
          <input type="text" id="prod-cust-name" required value="${product ? product.customerName : ''}" placeholder="e.g. Feed Pan 16-inch" class="w-full border border-slate-200 rounded-xl px-3 py-2 text-slate-800 focus:outline-none focus:border-[#138FCB]">
          <p class="text-[10px] text-slate-400 mt-0.5">Appears on quotations & invoices</p>
        </div>

        <div>
          <label class="block font-bold text-slate-700 mb-1">Urdu Name (اردو نام)</label>
          <input type="text" id="prod-urdu-name" dir="rtl" value="${product ? (product.urduName || '') : ''}" placeholder="مثلاً فیڈ پین" class="w-full border border-slate-200 rounded-xl px-3 py-2 text-slate-800 font-serif focus:outline-none focus:border-[#138FCB]">
          <p class="text-[10px] text-slate-400 mt-0.5">Local dispatch print name</p>
        </div>
      </div>

      <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div>
          <label class="block font-bold text-slate-700 mb-1">Product Category *</label>
          <select id="prod-category" required class="w-full border border-slate-200 rounded-xl px-3 py-2 text-slate-800 focus:outline-none focus:border-[#138FCB]">
            ${categories.map(c => `<option value="${c.id}" ${product && product.categoryId === c.id ? 'selected' : ''}>${c.name}</option>`).join('')}
          </select>
        </div>

        <div>
          <label class="block font-bold text-slate-700 mb-1">Base Inventory Unit *</label>
          <select id="prod-base-unit" required class="w-full border border-slate-200 rounded-xl px-3 py-2 text-slate-800 focus:outline-none focus:border-[#138FCB]">
            ${units.map(u => `<option value="${u.id}" ${product && product.baseUnitId === u.id ? 'selected' : ''}>${u.name} (${u.code})</option>`).join('')}
          </select>
        </div>

        <div>
          <label class="block font-bold text-slate-700 mb-1">Product Type</label>
          <select id="prod-type" class="w-full border border-slate-200 rounded-xl px-3 py-2 text-slate-800 focus:outline-none focus:border-[#138FCB]">
            <option value="Stock" ${!product || product.productType === 'Stock' ? 'selected' : ''}>Stock Item</option>
            <option value="Non-Stock" ${product && product.productType === 'Non-Stock' ? 'selected' : ''}>Non-Stock Item</option>
            <option value="Service" ${product && product.productType === 'Service' ? 'selected' : ''}>Service</option>
          </select>
        </div>
      </div>

      <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div>
          <label class="block font-bold text-slate-700 mb-1">Low Stock Alert Level</label>
          <input type="number" id="prod-low-stock" min="0" value="${product ? product.lowStockLevel : 10}" class="w-full border border-slate-200 rounded-xl px-3 py-2 text-slate-800 focus:outline-none focus:border-[#138FCB]">
        </div>

        <div>
          <label class="block font-bold text-slate-700 mb-1">Negative Stock Setting</label>
          <select id="prod-neg-stock" class="w-full border border-slate-200 rounded-xl px-3 py-2 text-slate-800 focus:outline-none focus:border-[#138FCB]">
            <option value="system_default" ${!product || product.negativeStockAllowed === 'system_default' ? 'selected' : ''}>Use System Default (Disallow)</option>
            <option value="allow" ${product && product.negativeStockAllowed === 'allow' ? 'selected' : ''}>Allow Negative Stock</option>
            <option value="disallow" ${product && product.negativeStockAllowed === 'disallow' ? 'selected' : ''}>Strictly Disallow</option>
          </select>
        </div>

        <div class="flex flex-col justify-end">
          <div class="flex items-center gap-2 p-2.5 bg-blue-50/70 border border-blue-100 rounded-xl">
            <input type="checkbox" id="prod-roll-tracking" ${product && product.enableRollTracking ? 'checked' : ''} class="rounded border-slate-300 text-[#138FCB] focus:ring-0">
            <label for="prod-roll-tracking" class="font-bold text-slate-800 cursor-pointer">Enable Roll / Cut-to-Length</label>
          </div>
        </div>
      </div>

      <div>
        <label class="block font-bold text-slate-700 mb-1">Description / Technical Notes</label>
        <textarea id="prod-desc" rows="2" placeholder="Product specifications, materials, warranty terms..." class="w-full border border-slate-200 rounded-xl px-3 py-2 text-slate-800 focus:outline-none focus:border-[#138FCB]">${product ? (product.description || '') : ''}</textarea>
      </div>

      <div class="flex items-center gap-2 pt-1">
        <input type="checkbox" id="prod-active" ${!product || product.isActive ? 'checked' : ''} class="rounded border-slate-300 text-[#138FCB] focus:ring-0">
        <label for="prod-active" class="font-medium text-slate-700">Active Product in Catalog</label>
      </div>

      <div class="flex justify-end gap-3 pt-4 border-t border-slate-100">
        <button type="button" id="prod-cancel-btn" class="px-4 py-2 text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-xl font-semibold transition-colors cursor-pointer">Cancel</button>
        <button type="submit" class="px-4 py-2 bg-[#138FCB] hover:bg-[#0E78AC] text-white rounded-xl font-semibold shadow-xs transition-colors cursor-pointer">${isEdit ? 'Save Product' : 'Create Product'}</button>
      </div>
    </form>
  `;

  openModal({
    title: isEdit ? `Edit Product Master: ${product.businessName}` : 'Add New Product Master',
    subtitle: 'Central business product definition',
    contentHtml,
    size: 'max-w-3xl',
    onOpen: (modalEl) => {
      modalEl.querySelector('#prod-cancel-btn').onclick = () => closeModal();
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

        if (isEdit) {
          productService.updateProduct(product.id, {
            businessName,
            customerName,
            urduName,
            categoryId,
            baseUnitId,
            productType,
            lowStockLevel,
            negativeStockAllowed,
            enableRollTracking,
            description,
            isActive
          });
          toast.show('Product updated successfully.', 'success');
        } else {
          productService.createProduct({
            businessName,
            customerName,
            urduName,
            categoryId,
            baseUnitId,
            productType,
            lowStockLevel,
            negativeStockAllowed,
            enableRollTracking,
            description,
            isActive
          });
          toast.show('Product created successfully.', 'success');
        }

        closeModal();
        if (onSaved) onSaved();
      };
    }
  });
}
