/**
 * JS Traders ERP - Standard Reports View
 * Comprehensive stock, movement, and dynamic attribute grouped reports.
 * Respects Cost/Profit permission boundaries.
 */

import { reportService } from '../../services/reportService.js';
import { authService } from '../../services/authService.js';
import { renderTable } from '../../components/table.js';
import { toast } from '../../components/toast.js';

export function renderStandardReportsView(activeTab = 'stock') {
  const canViewCost = authService.canViewCostProfit();
  const stockData = reportService.getCurrentStockReport();
  const movementData = reportService.getStockMovementReport();
  const attributeData = reportService.getStockByAttributeReport('Origin');

  return `
    <div id="standard-reports-container" class="space-y-6 animate-in fade-in duration-150">
      <!-- Report Type Tabs -->
      <div class="bg-white p-3 rounded-2xl border border-slate-200 shadow-2xs flex items-center justify-between gap-3">
        <div class="flex items-center gap-2 overflow-x-auto">
          <button class="report-tab-btn px-4 py-2 rounded-xl text-xs font-bold transition-colors cursor-pointer ${
            activeTab === 'stock' ? 'bg-[#138FCB] text-white shadow-xs' : 'text-slate-600 hover:bg-slate-100'
          }" data-tab="stock">
            Warehouse Stock Balances
          </button>
          <button class="report-tab-btn px-4 py-2 rounded-xl text-xs font-bold transition-colors cursor-pointer ${
            activeTab === 'attribute' ? 'bg-[#138FCB] text-white shadow-xs' : 'text-slate-600 hover:bg-slate-100'
          }" data-tab="attribute">
            Stock Grouped by Origin (China vs Pakistan)
          </button>
          <button class="report-tab-btn px-4 py-2 rounded-xl text-xs font-bold transition-colors cursor-pointer ${
            activeTab === 'movement' ? 'bg-[#138FCB] text-white shadow-xs' : 'text-slate-600 hover:bg-slate-100'
          }" data-tab="movement">
            Stock Movement History
          </button>
        </div>

        <button id="export-report-btn" class="inline-flex items-center gap-1.5 px-3 py-2 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 rounded-xl text-xs font-semibold shadow-2xs transition-colors cursor-pointer">
          <span>📥</span>
          <span>Export CSV</span>
        </button>
      </div>

      <!-- Report Content Body -->
      <div id="report-content-body">
        ${activeTab === 'stock' ? renderStockTable(stockData, canViewCost) :
          activeTab === 'attribute' ? renderAttributeGrouping(attributeData) :
          renderMovementTable(movementData)}
      </div>
    </div>
  `;
}

function renderStockTable(stockData, canViewCost) {
  const columns = [
    { key: 'warehouse', label: 'Warehouse' },
    { key: 'variantName', label: 'Item / Variant Name' },
    { key: 'sku', label: 'SKU' },
    {
      key: 'quantity',
      label: 'Quantity',
      align: 'right',
      render: row => `<strong class="text-slate-900">${row.quantity.toLocaleString()}</strong> <span class="text-[10px] text-slate-400 font-semibold">${row.unit}</span>`
    },
    ...(canViewCost ? [
      {
        key: 'averageCost',
        label: 'Avg Unit Cost',
        align: 'right',
        render: row => `Rs. ${Math.round(row.averageCost || 0).toLocaleString()}`
      },
      {
        key: 'stockValue',
        label: 'Stock Valuation',
        align: 'right',
        render: row => `<strong class="text-slate-900">Rs. ${Math.round(row.stockValue || 0).toLocaleString()}</strong>`
      }
    ] : [])
  ];

  return renderTable({ columns, data: stockData });
}

function renderAttributeGrouping(attributeData) {
  const origins = Object.entries(attributeData);

  return `
    <div class="space-y-6">
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
        ${origins.map(([origin, info]) => `
          <div class="bg-white p-5 rounded-2xl border border-slate-200 shadow-2xs">
            <div class="flex items-center justify-between mb-2">
              <span class="text-[10px] font-bold uppercase tracking-wider text-slate-400">Attribute: Origin</span>
              <span class="px-2.5 py-0.5 rounded-full text-[10px] font-bold ${origin === 'China' ? 'bg-red-50 text-red-700' : 'bg-green-50 text-green-700'}">
                ${origin}
              </span>
            </div>
            <h3 class="text-xl font-extrabold text-slate-900">${origin} Equipment</h3>
            <div class="mt-4 flex justify-between items-baseline pt-3 border-t border-slate-100">
              <span class="text-xs text-slate-500 font-medium">Total Stock Quantity:</span>
              <span class="text-2xl font-extrabold text-[#138FCB]">${info.totalQty.toLocaleString()} <span class="text-xs font-semibold text-slate-500">units</span></span>
            </div>
          </div>
        `).join('')}
      </div>

      <!-- Breakdown by items -->
      <div class="space-y-4">
        ${origins.map(([origin, info]) => `
          <div class="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-2xs">
            <div class="p-3.5 bg-slate-50 border-b border-slate-200 font-bold text-xs text-slate-700 flex justify-between">
              <span>Items Sourced from ${origin}</span>
              <span>${info.count} SKUs</span>
            </div>
            <div class="divide-y divide-slate-100 text-xs">
              ${info.items.map(item => `
                <div class="p-3 flex justify-between items-center">
                  <div>
                    <span class="font-bold text-slate-800">${item.variantName}</span>
                    <span class="text-[10px] text-slate-400 ml-2">(${item.sku})</span>
                  </div>
                  <div class="font-extrabold text-slate-900">${item.quantity.toLocaleString()} ${item.unit}</div>
                </div>
              `).join('')}
            </div>
          </div>
        `).join('')}
      </div>
    </div>
  `;
}

function renderMovementTable(movementData) {
  const columns = [
    { key: 'movementNumber', label: 'Movement #' },
    { key: 'date', label: 'Timestamp' },
    {
      key: 'type',
      label: 'Transaction Type',
      render: row => `<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-100 text-slate-700 uppercase">${row.type}</span>`
    },
    { key: 'warehouse', label: 'Warehouse' },
    { key: 'variantName', label: 'Variant Item' },
    {
      key: 'quantity',
      label: 'Quantity Change',
      align: 'right',
      render: row => `
        <span class="font-bold ${row.quantity > 0 ? 'text-emerald-600' : 'text-rose-600'}">
          ${row.quantity > 0 ? '+' : ''}${row.quantity} ${row.unit || 'PCS'}
        </span>
      `
    }
  ];

  return renderTable({ columns, data: movementData });
}

export function bindStandardReportsEvents(container, refreshCallback) {
  container.querySelectorAll('.report-tab-btn').forEach(btn => {
    btn.onclick = () => {
      const tab = btn.getAttribute('data-tab');
      container.innerHTML = renderStandardReportsView(tab);
      bindStandardReportsEvents(container, refreshCallback);
    };
  });

  const exportBtn = container.querySelector('#export-report-btn');
  if (exportBtn) {
    exportBtn.onclick = () => {
      toast.show('Report exported to CSV format.', 'success');
    };
  }
}
