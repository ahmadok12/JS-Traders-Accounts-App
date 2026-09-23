/**
 * JS Traders ERP - Stock by Warehouse Comparison Matrix
 * Multi-warehouse distribution view showing stock levels of every SKU across all storage facilities.
 */

import { inventoryService } from '../../services/inventoryService.js';
import { productService } from '../../services/productService.js';
import { warehouseService } from '../../services/warehouseService.js';
import { authService } from '../../services/authService.js';
import { renderTable } from '../../components/table.js';
import { renderFilterBar } from '../../components/filters.js';

export function renderStockByWarehouseView() {
  const warehouses = warehouseService.getWarehouses();
  const variants = productService.getVariants();
  const products = productService.getProducts();
  const categories = productService.getCategories();
  const canViewCost = authService.canViewCostProfit();

  const prodMap = new Map(products.map(p => [p.id, p]));
  const catMap = new Map(categories.map(c => [c.id, c.name]));

  // Build matrix rows: one per variant
  const rows = variants.map(v => {
    const prod = prodMap.get(v.productId) || {};
    const categoryName = catMap.get(prod.categoryId) || 'General';

    // Get stock in each warehouse
    const whStock = {};
    let totalQty = 0;
    for (const wh of warehouses) {
      const qty = inventoryService.getBalance(wh.id, v.id);
      whStock[wh.id] = qty;
      totalQty += qty;
    }

    const isLowStock = prod.lowStockLevel && totalQty <= prod.lowStockLevel;
    const isNegative = totalQty < 0;

    return {
      id: v.id,
      sku: v.sku || '-',
      name: v.name,
      productName: prod.businessName || prod.customerName || '-',
      category: categoryName,
      unit: v.unit || prod.baseUnit || 'PCS',
      whStock,
      totalQty,
      costPrice: v.costPrice || 0,
      totalValue: totalQty > 0 ? totalQty * (v.costPrice || 0) : 0,
      isLowStock,
      isNegative
    };
  });

  // Calculate totals
  const totalSkuCount = rows.length;
  const totalUnits = rows.reduce((acc, r) => acc + (r.totalQty > 0 ? r.totalQty : 0), 0);
  const totalValuation = rows.reduce((acc, r) => acc + (r.totalValue > 0 ? r.totalValue : 0), 0);

  const catOptions = [
    { value: 'all', label: 'All Categories' },
    ...categories.map(c => ({ value: c.id, label: c.name }))
  ];

  const filterBarHtml = renderFilterBar({
    searchPlaceholder: 'Search by SKU, item name, or category...',
    dropdowns: [
      {
        id: 'wh-stock-category-filter',
        label: 'Category',
        value: 'all',
        options: catOptions
      },
      {
        id: 'wh-stock-status-filter',
        label: 'Stock Status',
        value: 'all',
        options: [
          { value: 'all', label: 'All Stock Levels' },
          { value: 'in_stock', label: 'In Stock (> 0)' },
          { value: 'low_stock', label: 'Low Stock Alerts' },
          { value: 'negative', label: 'Negative / Discrepancy' }
        ]
      }
    ]
  });

  // Dynamic table columns: Item info, then 1 column per warehouse, then Total, then (optional) Valuation
  const columns = [
    {
      key: 'sku',
      header: 'SKU / Code',
      sortable: true,
      render: (sku, r) => `
        <div>
          <span class="font-bold text-slate-900 text-xs font-mono">${sku}</span>
          <p class="text-[10px] text-slate-400">${r.category}</p>
        </div>
      `
    },
    {
      key: 'name',
      header: 'Equipment Name / Variant',
      sortable: true,
      render: (name, r) => `
        <div>
          <span class="font-bold text-slate-900 text-xs">${name}</span>
          <p class="text-[11px] text-slate-500 font-normal">Master: ${r.productName}</p>
        </div>
      `
    },
    // Warehouse specific columns
    ...warehouses.map(wh => ({
      key: `wh_${wh.id}`,
      header: `${wh.name} (${wh.code})`,
      align: 'right',
      render: (_, r) => {
        const qty = r.whStock[wh.id] || 0;
        let colorClass = 'text-slate-800 font-bold';
        if (qty < 0) colorClass = 'text-rose-600 font-extrabold';
        else if (qty === 0) colorClass = 'text-slate-300 font-medium';
        return `
          <span class="text-xs ${colorClass}">
            ${qty.toLocaleString()} <span class="text-[10px] text-slate-400 font-normal">${r.unit}</span>
          </span>
        `;
      }
    })),
    {
      key: 'totalQty',
      header: 'Total Stock',
      align: 'right',
      sortable: true,
      render: (total, r) => {
        let badgeClass = 'bg-blue-50 text-[#138FCB]';
        if (r.isNegative) badgeClass = 'bg-rose-50 text-rose-700';
        else if (r.isLowStock) badgeClass = 'bg-amber-50 text-amber-700';

        return `
          <div class="flex items-center justify-end gap-1.5">
            <span class="px-2.5 py-1 rounded-lg text-xs font-black ${badgeClass}">
              ${total.toLocaleString()} ${r.unit}
            </span>
          </div>
        `;
      }
    }
  ];

  if (canViewCost) {
    columns.push({
      key: 'totalValue',
      header: 'Total Valuation',
      align: 'right',
      sortable: true,
      render: (val) => `
        <span class="text-xs font-bold text-slate-900">
          Rs. ${Math.round(val).toLocaleString()}
        </span>
      `
    });
  }

  const tableHtml = renderTable({
    id: 'stock-by-wh-table',
    columns,
    data: rows,
    selectable: false,
    emptyMessage: 'No stock data found across warehouses.'
  });

  return `
    <div class="space-y-6 animate-in fade-in duration-150">
      <!-- Header -->
      <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white p-4 rounded-2xl border border-[#EAECEF] shadow-[0_2px_4px_rgba(0,0,0,0.02)]">
        <div>
          <h2 class="text-base font-bold text-[#1A1D1F]">Stock by Warehouse Comparison</h2>
          <p class="text-xs text-slate-400 mt-0.5">Real-time inventory distribution matrix across all storage locations</p>
        </div>
        <div class="flex items-center gap-2">
          <button onclick="window.print()" class="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold bg-slate-100 text-slate-700 hover:bg-slate-200 rounded-xl transition-colors cursor-pointer">
            <span>🖨</span>
            <span>Print Report</span>
          </button>
        </div>
      </div>

      <!-- Overview Metric Cards -->
      <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div class="bg-white p-4 rounded-2xl border border-[#EAECEF] shadow-[0_2px_4px_rgba(0,0,0,0.02)]">
          <span class="text-xs text-slate-400 font-medium">Tracked SKUs</span>
          <p class="text-xl font-black text-slate-900 mt-1">${totalSkuCount}</p>
        </div>
        <div class="bg-white p-4 rounded-2xl border border-[#EAECEF] shadow-[0_2px_4px_rgba(0,0,0,0.02)]">
          <span class="text-xs text-slate-400 font-medium">Active Warehouses</span>
          <p class="text-xl font-black text-[#138FCB] mt-1">${warehouses.length} Facilities</p>
        </div>
        <div class="bg-white p-4 rounded-2xl border border-[#EAECEF] shadow-[0_2px_4px_rgba(0,0,0,0.02)]">
          <span class="text-xs text-slate-400 font-medium">Total Physical Units</span>
          <p class="text-xl font-black text-emerald-600 mt-1">${Math.round(totalUnits).toLocaleString()}</p>
        </div>
        ${canViewCost ? `
          <div class="bg-white p-4 rounded-2xl border border-[#EAECEF] shadow-[0_2px_4px_rgba(0,0,0,0.02)]">
            <span class="text-xs text-slate-400 font-medium">Total Stock Valuation</span>
            <p class="text-xl font-black text-slate-900 mt-1">Rs. ${Math.round(totalValuation).toLocaleString()}</p>
          </div>
        ` : `
          <div class="bg-white p-4 rounded-2xl border border-[#EAECEF] shadow-[0_2px_4px_rgba(0,0,0,0.02)]">
            <span class="text-xs text-slate-400 font-medium">Stock Security Guard</span>
            <p class="text-xs font-bold text-slate-500 mt-2">Valuation hidden per role permissions</p>
          </div>
        `}
      </div>

      <!-- Filter Controls -->
      <div class="bg-white p-4 rounded-2xl border border-[#EAECEF] shadow-[0_2px_4px_rgba(0,0,0,0.02)]">
        ${filterBarHtml}
      </div>

      <!-- Matrix Table -->
      <div id="stock-by-wh-table-container">
        ${tableHtml}
      </div>
    </div>
  `;
}

export function bindStockByWarehouseEvents(container, refreshCallback) {
  const catFilter = container.querySelector('#wh-stock-category-filter');
  const statusFilter = container.querySelector('#wh-stock-status-filter');
  const searchInput = container.querySelector('#filter-search-input');

  const applyFilters = () => {
    const catVal = catFilter ? catFilter.value : 'all';
    const statusVal = statusFilter ? statusFilter.value : 'all';
    const query = searchInput ? searchInput.value.toLowerCase().trim() : '';
    const tableContainer = container.querySelector('#stock-by-wh-table-container');
    if (!tableContainer) return;

    const warehouses = warehouseService.getWarehouses();
    const variants = productService.getVariants();
    const products = productService.getProducts();
    const categories = productService.getCategories();
    const canViewCost = authService.canViewCostProfit();

    const prodMap = new Map(products.map(p => [p.id, p]));
    const catMap = new Map(categories.map(c => [c.id, c.name]));

    let filteredRows = variants.map(v => {
      const prod = prodMap.get(v.productId) || {};
      const categoryName = catMap.get(prod.categoryId) || 'General';

      const whStock = {};
      let totalQty = 0;
      for (const wh of warehouses) {
        const qty = inventoryService.getBalance(wh.id, v.id);
        whStock[wh.id] = qty;
        totalQty += qty;
      }

      const isLowStock = prod.lowStockLevel && totalQty <= prod.lowStockLevel;
      const isNegative = totalQty < 0;

      return {
        id: v.id,
        sku: v.sku || '-',
        name: v.name,
        categoryId: prod.categoryId,
        productName: prod.businessName || prod.customerName || '-',
        category: categoryName,
        unit: v.unit || prod.baseUnit || 'PCS',
        whStock,
        totalQty,
        costPrice: v.costPrice || 0,
        totalValue: totalQty > 0 ? totalQty * (v.costPrice || 0) : 0,
        isLowStock,
        isNegative
      };
    });

    if (catVal !== 'all') {
      filteredRows = filteredRows.filter(r => r.categoryId === catVal);
    }

    if (statusVal === 'in_stock') {
      filteredRows = filteredRows.filter(r => r.totalQty > 0);
    } else if (statusVal === 'low_stock') {
      filteredRows = filteredRows.filter(r => r.isLowStock);
    } else if (statusVal === 'negative') {
      filteredRows = filteredRows.filter(r => r.isNegative);
    }

    if (query) {
      filteredRows = filteredRows.filter(r =>
        (r.sku && r.sku.toLowerCase().includes(query)) ||
        (r.name && r.name.toLowerCase().includes(query)) ||
        (r.productName && r.productName.toLowerCase().includes(query)) ||
        (r.category && r.category.toLowerCase().includes(query))
      );
    }

    const columns = [
      {
        key: 'sku',
        header: 'SKU / Code',
        sortable: true,
        render: (sku, r) => `
          <div>
            <span class="font-bold text-slate-900 text-xs font-mono">${sku}</span>
            <p class="text-[10px] text-slate-400">${r.category}</p>
          </div>
        `
      },
      {
        key: 'name',
        header: 'Equipment Name / Variant',
        sortable: true,
        render: (name, r) => `
          <div>
            <span class="font-bold text-slate-900 text-xs">${name}</span>
            <p class="text-[11px] text-slate-500 font-normal">Master: ${r.productName}</p>
          </div>
        `
      },
      ...warehouses.map(wh => ({
        key: `wh_${wh.id}`,
        header: `${wh.name} (${wh.code})`,
        align: 'right',
        render: (_, r) => {
          const qty = r.whStock[wh.id] || 0;
          let colorClass = 'text-slate-800 font-bold';
          if (qty < 0) colorClass = 'text-rose-600 font-extrabold';
          else if (qty === 0) colorClass = 'text-slate-300 font-medium';
          return `
            <span class="text-xs ${colorClass}">
              ${qty.toLocaleString()} <span class="text-[10px] text-slate-400 font-normal">${r.unit}</span>
            </span>
          `;
        }
      })),
      {
        key: 'totalQty',
        header: 'Total Stock',
        align: 'right',
        sortable: true,
        render: (total, r) => {
          let badgeClass = 'bg-blue-50 text-[#138FCB]';
          if (r.isNegative) badgeClass = 'bg-rose-50 text-rose-700';
          else if (r.isLowStock) badgeClass = 'bg-amber-50 text-amber-700';

          return `
            <div class="flex items-center justify-end gap-1.5">
              <span class="px-2.5 py-1 rounded-lg text-xs font-black ${badgeClass}">
                ${total.toLocaleString()} ${r.unit}
              </span>
            </div>
          `;
        }
      }
    ];

    if (canViewCost) {
      columns.push({
        key: 'totalValue',
        header: 'Total Valuation',
        align: 'right',
        sortable: true,
        render: (val) => `
          <span class="text-xs font-bold text-slate-900">
            Rs. ${Math.round(val).toLocaleString()}
          </span>
        `
      });
    }

    tableContainer.innerHTML = renderTable({
      id: 'stock-by-wh-table',
      columns,
      data: filteredRows,
      selectable: false,
      emptyMessage: 'No stock data matches your filter criteria.'
    });
  };

  if (catFilter) catFilter.onchange = applyFilters;
  if (statusFilter) statusFilter.onchange = applyFilters;
  if (searchInput) searchInput.oninput = applyFilters;
}
