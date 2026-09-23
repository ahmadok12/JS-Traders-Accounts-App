/**
 * JS Traders ERP - Comprehensive Assembly, Manufacturing & Disassembly View
 * 
 * 5 Modular Workspaces:
 * 1. Assembly Orders (Draft, Multi-Warehouse Production, Completion, Reversal, Printing)
 * 2. Disassembly / Breakdown (Any Item Teardown, Partial Recovery, Variance Tracking, Reversal)
 * 3. BOM Recipes & Templates (Assembly Recipes & Disassembly Templates)
 * 4. Labor Payables & Settlement (Specific Assemblies vs FIFO Lump-Sum Settlement)
 * 5. Production Reports (Assembly Register, Product Costing, Labor Payables, Component Consumption, Disassembly History)
 */

import { assemblyService } from '../../services/assemblyService.js';
import { productService } from '../../services/productService.js';
import { warehouseService } from '../../services/warehouseService.js';
import { inventoryService } from '../../services/inventoryService.js';
import { accountingService } from '../../services/accountingService.js';
import { bundleService } from '../../services/bundleService.js';
import { authService } from '../../services/authService.js';
import { renderTable, bindTableActions } from '../../components/table.js';
import { renderFilterBar } from '../../components/filters.js';
import { openModal, closeModal } from '../../components/modal.js';
import { confirmAction } from '../../components/confirmation.js';
import { toast } from '../../components/toast.js';

let activeTab = 'assembly'; // 'assembly' | 'disassembly' | 'boms' | 'bundles' | 'payables' | 'reports'
let activeReportSubTab = 'register'; // 'register' | 'costing' | 'labor' | 'consumption' | 'disassembly_reg'
let assemblyStatusFilter = 'ALL';

export function renderAssemblyView(initialTab = null) {
  if (initialTab) {
    activeTab = initialTab;
  }
  const warehouses = warehouseService.getWarehouses();
  const variants = productService.getVariants();
  const whMap = new Map(warehouses.map(w => [w.id, w.name]));
  const varMap = new Map(variants.map(v => [v.id, v.name]));
  const canViewCost = authService.canViewCostProfit();

  // Header & Subsystem Navigation Tabs
  const navTabsHtml = `
    <div class="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-3">
      <div class="flex items-center space-x-2">
        <div class="w-9 h-9 rounded-xl bg-blue-50 text-[#138FCB] flex items-center justify-center font-bold text-lg shadow-xs">
          🏭
        </div>
        <div>
          <h2 class="text-base font-extrabold text-slate-800 tracking-tight">Manufacturing &amp; Equipment Assembly</h2>
          <p class="text-[11px] text-slate-400">BOM Production, Finishing, Standalone Disassembly &amp; Labor Payables</p>
        </div>
      </div>

      <div class="flex items-center bg-slate-100 p-1 rounded-xl border border-slate-200 text-xs font-semibold">
        <button id="tab-btn-assembly" class="tab-switch-btn px-3 py-1.5 rounded-lg transition-all cursor-pointer ${activeTab === 'assembly' ? 'bg-white text-[#138FCB] shadow-xs font-bold' : 'text-slate-600 hover:text-slate-900'}">
          🔨 Assembly Orders
        </button>
        <button id="tab-btn-disassembly" class="tab-switch-btn px-3 py-1.5 rounded-lg transition-all cursor-pointer ${activeTab === 'disassembly' ? 'bg-white text-[#138FCB] shadow-xs font-bold' : 'text-slate-600 hover:text-slate-900'}">
          🔄 Disassembly / Breakdown
        </button>
        <button id="tab-btn-boms" class="tab-switch-btn px-3 py-1.5 rounded-lg transition-all cursor-pointer ${activeTab === 'boms' ? 'bg-white text-[#138FCB] shadow-xs font-bold' : 'text-slate-600 hover:text-slate-900'}">
          📋 BOMs &amp; Templates
        </button>
        <button id="tab-btn-bundles" class="tab-switch-btn px-3 py-1.5 rounded-lg transition-all cursor-pointer ${activeTab === 'bundles' ? 'bg-white text-[#138FCB] shadow-xs font-bold' : 'text-slate-600 hover:text-slate-900'}">
          🧩 Bundles &amp; Systems
        </button>
        <button id="tab-btn-payables" class="tab-switch-btn px-3 py-1.5 rounded-lg transition-all cursor-pointer ${activeTab === 'payables' ? 'bg-white text-[#138FCB] shadow-xs font-bold' : 'text-slate-600 hover:text-slate-900'}">
          💰 Labor Payables
        </button>
        <button id="tab-btn-reports" class="tab-switch-btn px-3 py-1.5 rounded-lg transition-all cursor-pointer ${activeTab === 'reports' ? 'bg-white text-[#138FCB] shadow-xs font-bold' : 'text-slate-600 hover:text-slate-900'}">
          📊 Reports
        </button>
      </div>
    </div>
  `;

  let contentHtml = '';
  if (activeTab === 'assembly') {
    contentHtml = renderAssemblyOrdersTab(whMap, varMap, canViewCost);
  } else if (activeTab === 'disassembly') {
    contentHtml = renderDisassemblyTab(whMap, varMap, canViewCost);
  } else if (activeTab === 'boms') {
    contentHtml = renderBomsTab(whMap, varMap);
  } else if (activeTab === 'bundles') {
    contentHtml = renderBundlesTab(whMap, varMap);
  } else if (activeTab === 'payables') {
    contentHtml = renderLaborPayablesTab();
  } else if (activeTab === 'reports') {
    contentHtml = renderReportsTab(whMap, varMap, canViewCost);
  }

  return `
    <div id="assembly-module-container" class="space-y-5 animate-in fade-in duration-150">
      ${navTabsHtml}
      <div id="assembly-tab-content">
        ${contentHtml}
      </div>
    </div>
  `;
}

// ============================================================================
// TAB 1: ASSEMBLY ORDERS
// ============================================================================

function renderAssemblyOrdersTab(whMap, varMap, canViewCost) {
  let assemblies = assemblyService.getAssemblies();
  if (assemblyStatusFilter !== 'ALL') {
    assemblies = assemblies.filter(a => a.status === assemblyStatusFilter);
  }

  const laborParties = assemblyService.getLaborParties();
  const laborPartyMap = new Map(laborParties.map(p => [p.id, p.name]));

  const filterBarHtml = renderFilterBar({
    searchPlaceholder: 'Search assemblies by doc number or notes...',
    primaryAction: { label: 'New Assembly Build' }
  });

  const columns = [
    {
      key: 'assemblyNumber',
      label: 'Assembly #',
      render: row => `
        <div>
          <span class="font-bold text-[#138FCB]">${row.assemblyNumber}</span>
          <span class="block text-[10px] uppercase font-bold tracking-wider ${row.assemblyType === 'FINISHING' ? 'text-purple-600' : 'text-blue-600'}">
            ${row.assemblyType || 'MANUFACTURING'}
          </span>
        </div>
      `
    },
    {
      key: 'assemblyDate',
      label: 'Date',
      render: row => `<span class="text-slate-600 font-medium">${row.assemblyDate}</span>`
    },
    {
      key: 'finishedGood',
      label: 'Target / Produced Product',
      render: row => `
        <div>
          <div class="font-bold text-slate-800">${varMap.get(row.finishedVariantId) || 'Finished Good'}</div>
          <div class="text-[11px] font-bold ${row.status === 'Completed' ? 'text-emerald-600' : 'text-slate-500'}">
            + ${row.finishedQuantity} Units ${row.status === 'Completed' ? 'Created' : 'Planned'}
          </div>
        </div>
      `
    },
    {
      key: 'warehouses',
      label: 'Warehouses (Source → Output)',
      render: row => {
        const src = whMap.get(row.sourceWarehouseId || row.warehouseId) || 'Source Wh';
        const out = whMap.get(row.outputWarehouseId || row.warehouseId) || 'Output Wh';
        return `
          <div class="text-xs">
            <span class="text-slate-700 font-medium">${src}</span>
            <span class="text-slate-400 font-bold mx-1">→</span>
            <span class="text-emerald-700 font-semibold">${out}</span>
          </div>
        `;
      }
    },
    {
      key: 'components',
      label: 'Consumed Components',
      render: row => `
        <div class="space-y-0.5 text-[11px] max-w-xs">
          ${(row.lines || []).map(l => `
            <div class="text-slate-600 truncate">
              ● ${varMap.get(l.componentVariantId) || 'Component'}: <strong class="text-rose-600">-${l.quantityConsumed} ${l.unit || 'PCS'}</strong>
            </div>
          `).join('')}
        </div>
      `
    },
    ...(canViewCost ? [
      {
        key: 'costs',
        label: 'Cost Valuation (Unit / Total)',
        align: 'right',
        render: row => `
          <div class="text-right">
            <div class="font-bold text-slate-900">Rs. ${Number(row.unitFinishedCost || 0).toLocaleString()} <span class="text-[10px] text-slate-400 font-normal">/ unit</span></div>
            <div class="text-[10px] text-slate-500 font-medium">Total: Rs. ${Number(row.totalAssemblyCost || 0).toLocaleString()}</div>
          </div>
        `
      }
    ] : []),
    {
      key: 'labor',
      label: 'Assembly Labor',
      render: row => {
        const pName = laborPartyMap.get(row.laborPartyId) || 'Internal';
        return `
          <div>
            <div class="font-medium text-slate-800 text-xs">${pName}</div>
            <div class="text-[11px] text-slate-500 font-semibold">Rs. ${Number(row.totalLaborCost || 0).toLocaleString()}</div>
          </div>
        `;
      }
    },
    {
      key: 'status',
      label: 'Status',
      render: row => `
        <span class="px-2.5 py-0.5 rounded-full text-[10px] font-bold ${
          row.status === 'Completed' ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' :
          row.status === 'Draft' ? 'bg-amber-50 text-amber-700 border border-amber-200' :
          row.status === 'Reversed' ? 'bg-rose-50 text-rose-700 border border-rose-200' :
          'bg-slate-100 text-slate-700'
        }">
          ${row.status}
        </span>
      `
    }
  ];

  const actions = [
    {
      label: 'Complete',
      variant: 'primary',
      condition: row => row.status === 'Draft',
      onClick: (row) => handleCompleteAssemblyClick(row)
    },
    {
      label: 'Reverse',
      variant: 'danger',
      condition: row => row.status === 'Completed',
      onClick: (row) => handleReverseAssemblyClick(row)
    },
    {
      label: 'Voucher',
      variant: 'secondary',
      onClick: (row) => handlePrintAssemblyVoucher(row, varMap, whMap, laborPartyMap)
    }
  ];

  const tableHtml = renderTable({
    columns,
    data: assemblies,
    actions,
    emptyMessage: 'No assembly orders recorded yet.'
  });

  return `
    <div class="space-y-4">
      <div class="flex items-center justify-between gap-4">
        ${filterBarHtml}
        <div class="flex items-center gap-1.5 text-xs font-semibold text-slate-600 bg-white border border-slate-200 p-1 rounded-xl shrink-0">
          <button class="asm-status-pill px-2.5 py-1 rounded-lg ${assemblyStatusFilter === 'ALL' ? 'bg-[#138FCB] text-white' : 'hover:bg-slate-100'}" data-status="ALL">All</button>
          <button class="asm-status-pill px-2.5 py-1 rounded-lg ${assemblyStatusFilter === 'Draft' ? 'bg-[#138FCB] text-white' : 'hover:bg-slate-100'}" data-status="Draft">Drafts</button>
          <button class="asm-status-pill px-2.5 py-1 rounded-lg ${assemblyStatusFilter === 'Completed' ? 'bg-[#138FCB] text-white' : 'hover:bg-slate-100'}" data-status="Completed">Completed</button>
          <button class="asm-status-pill px-2.5 py-1 rounded-lg ${assemblyStatusFilter === 'Reversed' ? 'bg-[#138FCB] text-white' : 'hover:bg-slate-100'}" data-status="Reversed">Reversed</button>
        </div>
      </div>
      <div id="assembly-table-container">
        ${tableHtml}
      </div>
    </div>
  `;
}

// ============================================================================
// TAB 2: DISASSEMBLY / BREAKDOWN (ANY ITEM)
// ============================================================================

function renderDisassemblyTab(whMap, varMap, canViewCost) {
  const disassemblies = assemblyService.getDisassemblies();

  const filterBarHtml = renderFilterBar({
    searchPlaceholder: 'Search disassemblies by doc number...',
    primaryAction: { label: 'New Disassembly / Breakdown' }
  });

  const columns = [
    {
      key: 'disassemblyNumber',
      label: 'Disassembly #',
      render: row => `<span class="font-bold text-rose-600">${row.disassemblyNumber}</span>`
    },
    {
      key: 'disassemblyDate',
      label: 'Date',
      render: row => `<span class="text-slate-600 font-medium">${row.disassemblyDate}</span>`
    },
    {
      key: 'sourceProduct',
      label: 'Disassembled Item',
      render: row => `
        <div>
          <div class="font-bold text-slate-800">${varMap.get(row.sourceVariantId) || 'Source Item'}</div>
          <div class="text-[11px] font-bold text-rose-600">- ${row.disassembledQuantity} Units Dismantled</div>
        </div>
      `
    },
    {
      key: 'warehouse',
      label: 'Warehouse',
      render: row => `<span class="font-medium text-slate-700">${whMap.get(row.warehouseId) || 'Main Warehouse'}</span>`
    },
    {
      key: 'recovered',
      label: 'Recovered Components',
      render: row => `
        <div class="space-y-0.5 text-[11px] max-w-xs">
          ${(row.recoveredComponents || []).map(r => `
            <div class="text-slate-700 font-medium">
              ● ${varMap.get(r.componentVariantId) || 'Component'}: <strong class="text-emerald-600">+${r.quantityRecovered} ${r.unit || 'PCS'}</strong>
            </div>
          `).join('')}
        </div>
      `
    },
    ...(canViewCost ? [
      {
        key: 'valuation',
        label: 'Cost / Variance',
        align: 'right',
        render: row => `
          <div class="text-right">
            <div class="text-xs font-bold text-slate-800">Source: Rs. ${Number(row.totalSourceCost || 0).toLocaleString()}</div>
            <div class="text-[11px] font-semibold text-emerald-600">Recovered: Rs. ${Number(row.totalRecoveredValue || 0).toLocaleString()}</div>
            ${Math.abs(row.varianceAmount || 0) > 0.01 ? `
              <div class="text-[10px] font-bold ${row.varianceAmount < 0 ? 'text-rose-600' : 'text-blue-600'}">
                Variance: Rs. ${Number(row.varianceAmount || 0).toLocaleString()}
              </div>
            ` : ''}
          </div>
        `
      }
    ] : []),
    {
      key: 'status',
      label: 'Status',
      render: row => `
        <span class="px-2.5 py-0.5 rounded-full text-[10px] font-bold ${
          row.status === 'Completed' ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' :
          row.status === 'Reversed' ? 'bg-rose-50 text-rose-700 border border-rose-200' :
          'bg-slate-100 text-slate-700'
        }">
          ${row.status}
        </span>
      `
    }
  ];

  const actions = [
    {
      label: 'Reverse',
      variant: 'danger',
      condition: row => row.status === 'Completed',
      onClick: (row) => handleReverseDisassemblyClick(row)
    },
    {
      label: 'View Voucher',
      variant: 'secondary',
      onClick: (row) => handlePrintDisassemblyVoucher(row, varMap, whMap)
    }
  ];

  const tableHtml = renderTable({
    columns,
    data: disassemblies,
    actions,
    emptyMessage: 'No disassembly / breakdown transactions recorded yet.'
  });

  return `
    <div class="space-y-4">
      <div class="p-3 bg-amber-50/70 border border-amber-200 rounded-xl text-xs text-amber-900 flex items-center gap-2">
        <span>🔄</span>
        <span><strong>Standalone Disassembly Engine:</strong> Dismantle <em>any</em> inventory item into component parts, including partial extraction (e.g. recovering motor only) with automatic scrap/variance valuation.</span>
      </div>
      ${filterBarHtml}
      <div id="disassembly-table-container">
        ${tableHtml}
      </div>
    </div>
  `;
}

// ============================================================================
// TAB 3: BOM RECIPES & TEMPLATES
// ============================================================================

function renderBomsTab(whMap, varMap) {
  const recipes = assemblyService.getRecipes();
  const templates = assemblyService.getDisassemblyTemplates();
  const laborParties = assemblyService.getLaborParties();
  const partyMap = new Map(laborParties.map(p => [p.id, p.name]));

  return `
    <div class="space-y-6">
      <!-- Section A: Assembly Recipes -->
      <div class="bg-white rounded-2xl border border-slate-200/80 p-5 shadow-xs space-y-4">
        <div class="flex items-center justify-between border-b border-slate-100 pb-3">
          <div>
            <h3 class="text-sm font-bold text-slate-800">Assembly Recipes (BOM Master)</h3>
            <p class="text-xs text-slate-400">Predefined assembly formulas with required raw components and standard labor rates</p>
          </div>
          <button id="btn-new-recipe" class="px-3.5 py-1.5 bg-[#138FCB] hover:bg-[#0E78AC] text-white text-xs font-bold rounded-xl shadow-xs transition-colors cursor-pointer">
            + New Assembly Recipe
          </button>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          ${recipes.map(r => `
            <div class="bg-slate-50/70 border border-slate-200 rounded-xl p-4 space-y-3">
              <div class="flex items-center justify-between">
                <span class="text-xs font-bold text-[#138FCB]">${r.recipeNumber || 'REC'}</span>
                <span class="px-2 py-0.5 rounded text-[10px] font-bold ${r.assemblyType === 'FINISHING' ? 'bg-purple-100 text-purple-700' : 'bg-blue-100 text-blue-700'}">
                  ${r.assemblyType || 'MANUFACTURING'}
                </span>
              </div>
              <div>
                <h4 class="text-sm font-extrabold text-slate-800">${r.name}</h4>
                <div class="text-xs text-slate-500 font-medium">Produces: ${varMap.get(r.finishedVariantId) || 'Finished Good'}</div>
              </div>
              <div class="border-t border-slate-200/70 pt-2 text-[11px] space-y-1">
                <div class="font-bold text-slate-600">Bill of Materials:</div>
                ${(r.components || []).map(c => `
                  <div class="text-slate-600 flex justify-between">
                    <span>• ${varMap.get(c.componentVariantId) || 'Component'}</span>
                    <strong class="text-slate-800">${c.quantityPerUnit} ${c.unit || 'PCS'}</strong>
                  </div>
                `).join('')}
              </div>
              <div class="border-t border-slate-200/70 pt-2 flex items-center justify-between text-xs text-slate-500 font-medium">
                <div>
                  <span>Labor Rate: <strong class="text-slate-800">Rs. ${r.defaultLaborRate || 0}</strong></span>
                  <span class="block text-[10px] text-slate-400">${partyMap.get(r.defaultLaborPartyId) || 'Standard Workshop'}</span>
                </div>
                <button class="btn-view-recipe px-2.5 py-1 text-xs font-bold text-[#138FCB] bg-blue-50 hover:bg-blue-100 rounded-lg transition-colors cursor-pointer" data-recipe-id="${r.id}">
                  🔍 View BOM
                </button>
              </div>
            </div>
          `).join('')}
        </div>
      </div>

      <!-- Section B: Disassembly Templates -->
      <div class="bg-white rounded-2xl border border-slate-200/80 p-5 shadow-xs space-y-4">
        <div class="flex items-center justify-between border-b border-slate-100 pb-3">
          <div>
            <h3 class="text-sm font-bold text-slate-800">Disassembly &amp; Teardown Templates</h3>
            <p class="text-xs text-slate-400">Optional default templates for breaking down items and allocating component costs</p>
          </div>
          <button id="btn-new-template" class="px-3.5 py-1.5 bg-slate-800 hover:bg-slate-900 text-white text-xs font-bold rounded-xl shadow-xs transition-colors cursor-pointer">
            + New Disassembly Template
          </button>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          ${templates.map(t => `
            <div class="bg-slate-50/70 border border-slate-200 rounded-xl p-4 space-y-3">
              <div>
                <h4 class="text-sm font-extrabold text-slate-800">${t.name}</h4>
                <div class="text-xs text-slate-500 font-medium">Dismantles: ${varMap.get(t.sourceVariantId) || 'Source Item'}</div>
              </div>
              <div class="border-t border-slate-200/70 pt-2 text-[11px] space-y-1">
                <div class="font-bold text-slate-600">Recoverable Components:</div>
                ${(t.expectedComponents || []).map(c => `
                  <div class="text-slate-600 flex justify-between">
                    <span>• ${varMap.get(c.componentVariantId) || 'Component'}</span>
                    <strong class="text-slate-800">${c.defaultRecoveryRatio}x (${c.costAllocationPercentage || 0}%)</strong>
                  </div>
                `).join('')}
              </div>
              <div class="border-t border-slate-200/70 pt-2 flex items-center justify-between text-xs text-slate-500 font-medium">
                <span class="text-slate-500">${(t.expectedComponents || []).length} Components configured</span>
                <button class="btn-view-template px-2.5 py-1 text-xs font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors cursor-pointer" data-template-id="${t.id}">
                  🔍 View Template
                </button>
              </div>
            </div>
          `).join('')}
        </div>
      </div>
    </div>
  `;
}

// ============================================================================
// TAB: BUNDLES & SYSTEMS MASTER
// ============================================================================

function renderBundlesTab(whMap, varMap) {
  const bundles = bundleService.getBundles();

  return `
    <div class="space-y-6">
      <div class="p-3.5 bg-blue-50/70 border border-blue-200 rounded-2xl text-xs text-blue-900 flex items-center gap-2.5">
        <span class="text-lg">🧩</span>
        <div>
          <strong class="font-bold text-slate-900">Decoupled Bundle &amp; Poultry Systems Architecture:</strong> 
          <span class="text-slate-700">Product Master defines what a product is. Bundle definitions determine how that product is used and calculated within that particular bundle/system (e.g. 1 handle per 5 lines via group ceil).</span>
        </div>
      </div>

      <div class="bg-white rounded-2xl border border-slate-200/80 p-5 shadow-xs space-y-4">
        <div class="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-3">
          <div>
            <h3 class="text-sm font-bold text-slate-800">Predefined Bundles &amp; Complete Poultry Systems</h3>
            <p class="text-xs text-slate-400">Fixed sets and variable proportional rule-based packages</p>
          </div>
          <div class="flex items-center gap-2">
            <button id="btn-new-bundle" class="px-3.5 py-1.5 bg-[#138FCB] hover:bg-[#0E78AC] text-white text-xs font-bold rounded-xl shadow-xs transition-colors cursor-pointer flex items-center gap-1.5">
              <span>+ New Bundle / System</span>
            </button>
            <span class="text-xs font-bold px-3 py-1 rounded-full bg-blue-50 text-[#138FCB] border border-blue-200">
              ${bundles.length} Configured Systems
            </span>
          </div>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
          ${bundles.map(b => `
            <div class="bg-white border border-slate-200/90 rounded-2xl p-5 shadow-2xs space-y-3.5 hover:border-blue-200 transition-all">
              <div class="flex items-start justify-between gap-2">
                <div>
                  <span class="text-[11px] font-bold text-[#138FCB] font-mono">${b.bundleCode || b.code || b.id}</span>
                  <h4 class="text-sm font-extrabold text-slate-800">${b.name}</h4>
                  <p class="text-xs text-slate-500 mt-0.5">${b.description || 'Predefined commercial bundle system'}</p>
                </div>
                <span class="px-2.5 py-1 rounded-full text-[10px] font-bold shrink-0 ${b.bundleType === 'VARIABLE_SYSTEM' ? 'bg-purple-50 text-purple-700 border border-purple-200' : 'bg-blue-50 text-blue-700 border border-blue-200'}">
                  ${b.bundleType === 'VARIABLE_SYSTEM' ? 'VARIABLE SYSTEM' : 'FIXED SET'}
                </span>
              </div>

              <div class="border-t border-slate-100 pt-3 space-y-1.5">
                <span class="text-[11px] font-bold uppercase tracking-wider text-slate-500 block mb-1">Component Calculation Formulas:</span>
                ${(b.components || []).map(c => `
                  <div class="text-xs flex items-center justify-between p-2.5 bg-slate-50 rounded-xl border border-slate-200/60">
                    <span class="font-medium text-slate-800">• ${varMap.get(c.componentVariantId) || c.variantName || c.componentVariantId}</span>
                    <span class="text-[11px] font-mono text-purple-700 bg-purple-50 border border-purple-200/50 px-2.5 py-0.5 rounded-lg font-bold">
                      ${c.ruleType === 'PER_LINE' || c.quantityRule === 'PER_LINE' ? `${c.baseFactor || c.parameters?.quantityPerLine || 1} / line` :
                        c.ruleType === 'PER_GROUP_CEIL' || c.quantityRule === 'PER_GROUP_CEIL' ? `1 per ${c.groupSize || c.parameters?.linesPerGroup || 5} lines (ceil)` :
                        c.ruleType === 'FIXED_QTY' || c.quantityRule === 'FIXED_QTY' ? `Fixed ${c.baseFactor || c.parameters?.fixedQuantity || 1}` : (c.ruleType || c.quantityRule || 'Custom')}
                    </span>
                  </div>
                `).join('')}
              </div>

              <div class="border-t border-slate-100 pt-3 flex items-center justify-between gap-2 text-xs">
                <div class="text-slate-500 font-medium">
                  <span>Unit: <strong class="text-slate-800">${b.baseUnit || 'Line'}</strong></span> • 
                  <span>Price: <strong class="text-slate-800">Rs. ${(b.sellingPrice || 0).toLocaleString()}</strong></span>
                </div>
                <div class="flex items-center gap-2">
                  <button class="btn-simulate-bundle px-3 py-1.5 text-xs font-bold text-[#138FCB] bg-blue-50 hover:bg-blue-100 rounded-xl transition-colors cursor-pointer flex items-center gap-1 shadow-2xs" data-bundle-id="${b.id}">
                    <span>⚡ Simulate</span>
                  </button>
                  <button class="btn-view-bundle px-3 py-1.5 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-xl transition-colors cursor-pointer shadow-2xs" data-bundle-id="${b.id}">
                    <span>🔍 Details</span>
                  </button>
                </div>
              </div>
            </div>
          `).join('')}
        </div>
      </div>
    </div>
  `;
}

// ============================================================================
// TAB 4: LABOR PAYABLES & SETTLEMENT
// ============================================================================

function renderLaborPayablesTab() {
  const payables = assemblyService.getLaborPayables();
  const laborParties = assemblyService.getLaborParties();
  const payments = assemblyService.getLaborPayments();

  let totalPayable = 0;
  let totalPaid = 0;
  payables.forEach(p => {
    if (p.status !== 'Reversed') {
      totalPayable += (p.payableAmount || 0);
      totalPaid += (p.paidAmount || 0);
    }
  });
  const totalOutstanding = totalPayable - totalPaid;

  const partyBalances = laborParties.map(p => {
    const bal = assemblyService.getLaborPartyBalance(p.id);
    return { ...p, ...bal };
  });

  return `
    <div class="space-y-6">
      <!-- Summary Cards -->
      <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div class="bg-white p-4 rounded-xl border border-slate-200/80 shadow-xs">
          <span class="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Total Labor Payable Incurred</span>
          <div class="text-xl font-extrabold text-slate-900 mt-1">Rs. ${totalPayable.toLocaleString()}</div>
        </div>
        <div class="bg-white p-4 rounded-xl border border-slate-200/80 shadow-xs">
          <span class="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Total Labor Paid</span>
          <div class="text-xl font-extrabold text-emerald-600 mt-1">Rs. ${totalPaid.toLocaleString()}</div>
        </div>
        <div class="bg-white p-4 rounded-xl border border-slate-200/80 shadow-xs">
          <span class="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Current Outstanding Liability</span>
          <div class="text-xl font-extrabold text-rose-600 mt-1">Rs. ${totalOutstanding.toLocaleString()}</div>
        </div>
      </div>

      <!-- Section: Labor Parties Balances & Quick Pay -->
      <div class="bg-white rounded-2xl border border-slate-200/80 p-5 shadow-xs space-y-4">
        <div class="flex items-center justify-between border-b border-slate-100 pb-3">
          <div>
            <h3 class="text-sm font-bold text-slate-800">Assembly Labor Workshops / Parties</h3>
            <p class="text-xs text-slate-400">Manage labor liabilities and record settlements (Specific assemblies or FIFO lump-sum)</p>
          </div>
          <button id="btn-record-labor-payment" class="px-4 py-2 bg-[#138FCB] hover:bg-[#0E78AC] text-white text-xs font-bold rounded-xl shadow-xs transition-colors cursor-pointer">
            + Record Labor Payment
          </button>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
          ${partyBalances.map(pb => `
            <div class="bg-slate-50 border border-slate-200 rounded-xl p-4 flex flex-col justify-between space-y-3">
              <div>
                <div class="flex items-center justify-between">
                  <h4 class="font-extrabold text-slate-900 text-sm">${pb.name}</h4>
                  <span class="px-2 py-0.5 rounded text-[10px] font-bold ${pb.outstandingBalance > 0 ? 'bg-rose-50 text-rose-700 border border-rose-200' : 'bg-emerald-50 text-emerald-700'}">
                    ${pb.outstandingBalance > 0 ? 'Due' : 'Settled'}
                  </span>
                </div>
                <div class="text-xs text-slate-500 mt-1">Contact: ${pb.phone || 'N/A'}</div>
              </div>

              <div class="border-t border-slate-200/70 pt-2 space-y-1 text-xs">
                <div class="flex justify-between text-slate-600">
                  <span>Earned:</span>
                  <span class="font-bold text-slate-800">Rs. ${(pb.totalPayables || 0).toLocaleString()}</span>
                </div>
                <div class="flex justify-between text-slate-600">
                  <span>Paid:</span>
                  <span class="font-bold text-emerald-600">Rs. ${(pb.totalPaid || 0).toLocaleString()}</span>
                </div>
                <div class="flex justify-between text-slate-800 font-extrabold pt-1 border-t border-slate-200">
                  <span>Net Balance:</span>
                  <span class="text-rose-600">Rs. ${(pb.outstandingBalance || 0).toLocaleString()}</span>
                </div>
              </div>

              <button class="btn-pay-specific-party w-full py-1.5 px-3 bg-white hover:bg-slate-100 border border-slate-300 rounded-lg text-xs font-bold text-slate-700 shadow-2xs transition-colors cursor-pointer" data-party-id="${pb.id}">
                Settle / Pay Workshop
              </button>
            </div>
          `).join('')}
        </div>
      </div>

      <!-- Section: Outstanding Payables Register -->
      <div class="bg-white rounded-2xl border border-slate-200/80 p-5 shadow-xs space-y-3">
        <h3 class="text-sm font-bold text-slate-800">Assembly Payables Register</h3>
        <div class="overflow-x-auto border border-slate-200 rounded-xl">
          <table class="w-full text-left text-xs">
            <thead class="bg-slate-50 text-slate-500 uppercase text-[10px] tracking-wider border-b border-slate-200">
              <tr>
                <th class="py-2.5 px-3">Payable #</th>
                <th class="py-2.5 px-3">Date</th>
                <th class="py-2.5 px-3">Assembly Order</th>
                <th class="py-2.5 px-3">Labor Workshop</th>
                <th class="py-2.5 px-3 text-right">Payable Amount</th>
                <th class="py-2.5 px-3 text-right">Paid</th>
                <th class="py-2.5 px-3 text-right">Balance Due</th>
                <th class="py-2.5 px-3 text-center">Status</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-slate-100 text-slate-700">
              ${payables.map(p => `
                <tr class="hover:bg-slate-50/70">
                  <td class="p-3 font-bold text-[#138FCB]">${p.payableNumber}</td>
                  <td class="p-3 text-slate-600">${p.date}</td>
                  <td class="p-3 font-semibold text-slate-800">${p.assemblyNumber || p.assemblyId}</td>
                  <td class="p-3 font-medium">${p.laborPartyName || 'Workshop'}</td>
                  <td class="p-3 text-right font-bold text-slate-900">Rs. ${Number(p.payableAmount || 0).toLocaleString()}</td>
                  <td class="p-3 text-right font-bold text-emerald-600">Rs. ${Number(p.paidAmount || 0).toLocaleString()}</td>
                  <td class="p-3 text-right font-extrabold text-rose-600">Rs. ${Number(p.remainingBalance || 0).toLocaleString()}</td>
                  <td class="p-3 text-center">
                    <span class="px-2 py-0.5 rounded text-[10px] font-bold ${
                      p.status === 'Paid' ? 'bg-emerald-50 text-emerald-700' :
                      p.status === 'Partially Paid' ? 'bg-amber-50 text-amber-700' :
                      p.status === 'Reversed' ? 'bg-slate-100 text-slate-500' :
                      'bg-rose-50 text-rose-700'
                    }">
                      ${p.status}
                    </span>
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `;
}

// ============================================================================
// TAB 5: PRODUCTION & CONSUMPTION REPORTS
// ============================================================================

function renderReportsTab(whMap, varMap, canViewCost) {
  const subTabsHtml = `
    <div class="flex items-center gap-2 border-b border-slate-200 pb-3 text-xs font-semibold">
      <button class="rep-subtab-btn px-3 py-1.5 rounded-lg ${activeReportSubTab === 'register' ? 'bg-[#138FCB] text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}" data-subtab="register">
        1. Assembly Register
      </button>
      <button class="rep-subtab-btn px-3 py-1.5 rounded-lg ${activeReportSubTab === 'costing' ? 'bg-[#138FCB] text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}" data-subtab="costing">
        2. Product Assembly Costing
      </button>
      <button class="rep-subtab-btn px-3 py-1.5 rounded-lg ${activeReportSubTab === 'labor' ? 'bg-[#138FCB] text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}" data-subtab="labor">
        3. Labor Payables Summary
      </button>
      <button class="rep-subtab-btn px-3 py-1.5 rounded-lg ${activeReportSubTab === 'consumption' ? 'bg-[#138FCB] text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}" data-subtab="consumption">
        4. Component Consumption
      </button>
      <button class="rep-subtab-btn px-3 py-1.5 rounded-lg ${activeReportSubTab === 'disassembly_reg' ? 'bg-[#138FCB] text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}" data-subtab="disassembly_reg">
        5. Disassembly Register
      </button>
    </div>
  `;

  let reportContentHtml = '';

  if (activeReportSubTab === 'register') {
    const reg = assemblyService.getAssemblyRegisterReport();
    reportContentHtml = `
      <div class="bg-white rounded-xl border border-slate-200 p-4 space-y-3">
        <h4 class="font-bold text-slate-800 text-sm">Assembly Register Report</h4>
        <div class="overflow-x-auto border border-slate-200 rounded-lg">
          <table class="w-full text-left text-xs">
            <thead class="bg-slate-50 text-slate-500 uppercase text-[10px] border-b border-slate-200">
              <tr>
                <th class="p-2.5">Assembly #</th>
                <th class="p-2.5">Date</th>
                <th class="p-2.5">Type</th>
                <th class="p-2.5">Product</th>
                <th class="p-2.5 text-center">Qty</th>
                <th class="p-2.5 text-right">Material Cost</th>
                <th class="p-2.5 text-right">Labor Cost</th>
                <th class="p-2.5 text-right">Total Cost</th>
                <th class="p-2.5 text-center">Status</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-slate-100">
              ${reg.map(r => `
                <tr class="hover:bg-slate-50">
                  <td class="p-2.5 font-bold text-[#138FCB]">${r.assemblyNumber}</td>
                  <td class="p-2.5">${r.date}</td>
                  <td class="p-2.5 font-semibold text-purple-600">${r.assemblyType}</td>
                  <td class="p-2.5 font-medium">${r.finishedVariantName}</td>
                  <td class="p-2.5 text-center font-bold">${r.finishedQuantity || 0}</td>
                  <td class="p-2.5 text-right">Rs. ${(r.totalMaterialCost || 0).toLocaleString()}</td>
                  <td class="p-2.5 text-right">Rs. ${(r.totalLaborCost || 0).toLocaleString()}</td>
                  <td class="p-2.5 text-right font-bold text-slate-900">Rs. ${(r.totalCost || 0).toLocaleString()}</td>
                  <td class="p-2.5 text-center">
                    <span class="px-2 py-0.5 rounded text-[10px] font-bold ${r.status === 'Completed' ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-600'}">
                      ${r.status}
                    </span>
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;
  } else if (activeReportSubTab === 'costing') {
    const costRep = assemblyService.getProductAssemblyCostReport();
    reportContentHtml = `
      <div class="bg-white rounded-xl border border-slate-200 p-4 space-y-3">
        <h4 class="font-bold text-slate-800 text-sm">Product Assembly Costing Report</h4>
        <div class="overflow-x-auto border border-slate-200 rounded-lg">
          <table class="w-full text-left text-xs">
            <thead class="bg-slate-50 text-slate-500 uppercase text-[10px] border-b border-slate-200">
              <tr>
                <th class="p-2.5">Product Name</th>
                <th class="p-2.5">SKU</th>
                <th class="p-2.5 text-center">Units Produced</th>
                <th class="p-2.5 text-right">Avg Material Cost / Unit</th>
                <th class="p-2.5 text-right">Avg Labor Cost / Unit</th>
                <th class="p-2.5 text-right font-bold">Avg Total Cost / Unit</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-slate-100">
              ${costRep.map(c => `
                <tr class="hover:bg-slate-50">
                  <td class="p-2.5 font-bold text-slate-800">${c.variantName}</td>
                  <td class="p-2.5 text-slate-500">${c.sku}</td>
                  <td class="p-2.5 text-center font-bold text-emerald-600">${c.totalUnitsProduced || 0}</td>
                  <td class="p-2.5 text-right">Rs. ${(c.averageMaterialCost || 0).toLocaleString()}</td>
                  <td class="p-2.5 text-right">Rs. ${(c.averageLaborCost || 0).toLocaleString()}</td>
                  <td class="p-2.5 text-right font-extrabold text-slate-900">Rs. ${(c.averageUnitCost || 0).toLocaleString()}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;
  } else if (activeReportSubTab === 'labor') {
    const labRep = assemblyService.getLaborPayableReport();
    reportContentHtml = `
      <div class="bg-white rounded-xl border border-slate-200 p-4 space-y-3">
        <h4 class="font-bold text-slate-800 text-sm">Labor Payables Summary Report</h4>
        <div class="overflow-x-auto border border-slate-200 rounded-lg">
          <table class="w-full text-left text-xs">
            <thead class="bg-slate-50 text-slate-500 uppercase text-[10px] border-b border-slate-200">
              <tr>
                <th class="p-2.5">Workshop / Labor Party</th>
                <th class="p-2.5">Phone</th>
                <th class="p-2.5 text-center">Completed Assemblies</th>
                <th class="p-2.5 text-right">Total Incurred</th>
                <th class="p-2.5 text-right">Total Paid</th>
                <th class="p-2.5 text-right font-bold">Outstanding Balance</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-slate-100">
              ${labRep.map(l => `
                <tr class="hover:bg-slate-50">
                  <td class="p-2.5 font-bold text-slate-800">${l.partyName}</td>
                  <td class="p-2.5 text-slate-500">${l.phone || 'N/A'}</td>
                  <td class="p-2.5 text-center font-bold">${l.assembliesCount || 0}</td>
                  <td class="p-2.5 text-right">Rs. ${(l.totalPayable || 0).toLocaleString()}</td>
                  <td class="p-2.5 text-right font-bold text-emerald-600">Rs. ${(l.totalPaid || 0).toLocaleString()}</td>
                  <td class="p-2.5 text-right font-extrabold text-rose-600">Rs. ${(l.outstandingBalance || 0).toLocaleString()}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;
  } else if (activeReportSubTab === 'consumption') {
    const consRep = assemblyService.getComponentConsumptionReport();
    reportContentHtml = `
      <div class="bg-white rounded-xl border border-slate-200 p-4 space-y-3">
        <h4 class="font-bold text-slate-800 text-sm">Component Raw Material Consumption Report</h4>
        <div class="overflow-x-auto border border-slate-200 rounded-lg">
          <table class="w-full text-left text-xs">
            <thead class="bg-slate-50 text-slate-500 uppercase text-[10px] border-b border-slate-200">
              <tr>
                <th class="p-2.5">Component Variant</th>
                <th class="p-2.5">SKU</th>
                <th class="p-2.5 text-center font-bold">Total Consumed Qty</th>
                <th class="p-2.5 text-right font-bold">Total Material Value (PKR)</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-slate-100">
              ${consRep.map(c => `
                <tr class="hover:bg-slate-50">
                  <td class="p-2.5 font-bold text-slate-800">${c.variantName}</td>
                  <td class="p-2.5 text-slate-500">${c.sku}</td>
                  <td class="p-2.5 text-center font-extrabold text-rose-600">${(c.totalQuantityConsumed || 0).toLocaleString()} ${c.unit || 'PCS'}</td>
                  <td class="p-2.5 text-right font-extrabold text-slate-900">Rs. ${(c.totalCostConsumed || 0).toLocaleString()}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;
  } else if (activeReportSubTab === 'disassembly_reg') {
    const disRep = assemblyService.getDisassemblyRegisterReport();
    reportContentHtml = `
      <div class="bg-white rounded-xl border border-slate-200 p-4 space-y-3">
        <h4 class="font-bold text-slate-800 text-sm">Disassembly / Breakdown Register Report</h4>
        <div class="overflow-x-auto border border-slate-200 rounded-lg">
          <table class="w-full text-left text-xs">
            <thead class="bg-slate-50 text-slate-500 uppercase text-[10px] border-b border-slate-200">
              <tr>
                <th class="p-2.5">Disassembly #</th>
                <th class="p-2.5">Date</th>
                <th class="p-2.5">Dismantled Item</th>
                <th class="p-2.5 text-center">Qty</th>
                <th class="p-2.5 text-right">Source Cost</th>
                <th class="p-2.5 text-right">Recovered Value</th>
                <th class="p-2.5 text-right">Variance</th>
                <th class="p-2.5 text-center">Status</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-slate-100">
              ${disRep.map(d => `
                <tr class="hover:bg-slate-50">
                  <td class="p-2.5 font-bold text-rose-600">${d.disassemblyNumber}</td>
                  <td class="p-2.5">${d.date}</td>
                  <td class="p-2.5 font-medium">${d.sourceVariantName}</td>
                  <td class="p-2.5 text-center font-bold">${d.disassembledQuantity || 0}</td>
                  <td class="p-2.5 text-right">Rs. ${(d.totalSourceCost || 0).toLocaleString()}</td>
                  <td class="p-2.5 text-right font-bold text-emerald-600">Rs. ${(d.totalRecoveredValue || 0).toLocaleString()}</td>
                  <td class="p-2.5 text-right font-bold ${(d.varianceAmount || 0) < 0 ? 'text-rose-600' : 'text-blue-600'}">
                    Rs. ${(d.varianceAmount || 0).toLocaleString()}
                  </td>
                  <td class="p-2.5 text-center font-bold">${d.status}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;
  }

  return `
    <div class="space-y-4">
      ${subTabsHtml}
      ${reportContentHtml}
    </div>
  `;
}

// ============================================================================
// EVENT BINDINGS
// ============================================================================

export function bindAssemblyEvents(container, refreshCallback) {
  // Navigation tabs
  container.querySelectorAll('.tab-switch-btn').forEach(btn => {
    btn.onclick = () => {
      const tabId = btn.id.replace('tab-btn-', '');
      activeTab = tabId;
      if (['assembly', 'disassembly', 'boms', 'bundles'].includes(tabId)) {
        window.location.hash = `#/inventory-${tabId}`;
      } else {
        const newHtml = renderAssemblyView(tabId);
        container.innerHTML = newHtml;
        bindAssemblyEvents(container, refreshCallback);
      }
    };
  });

  // Report sub-tabs
  container.querySelectorAll('.rep-subtab-btn').forEach(btn => {
    btn.onclick = () => {
      activeReportSubTab = btn.getAttribute('data-subtab');
      refreshView(container, refreshCallback);
    };
  });

  // Status pills in Assembly tab
  container.querySelectorAll('.asm-status-pill').forEach(btn => {
    btn.onclick = () => {
      assemblyStatusFilter = btn.getAttribute('data-status');
      refreshView(container, refreshCallback);
    };
  });

  // Primary Action in FilterBar
  const primaryBtn = container.querySelector('#filter-primary-btn');
  if (primaryBtn) {
    primaryBtn.onclick = () => {
      if (activeTab === 'disassembly') {
        openNewDisassemblyModal(() => {
          refreshView(container, refreshCallback);
          if (refreshCallback) refreshCallback();
        });
      } else {
        openNewAssemblyModal(() => {
          refreshView(container, refreshCallback);
          if (refreshCallback) refreshCallback();
        });
      }
    };
  }

  // BOM tab buttons
  const newRecBtn = container.querySelector('#btn-new-recipe');
  if (newRecBtn) {
    newRecBtn.onclick = () => openNewRecipeModal(() => {
      refreshView(container, refreshCallback);
      if (refreshCallback) refreshCallback();
    });
  }

  const newTplBtn = container.querySelector('#btn-new-template');
  if (newTplBtn) {
    newTplBtn.onclick = () => openNewDisassemblyTemplateModal(() => {
      refreshView(container, refreshCallback);
      if (refreshCallback) refreshCallback();
    });
  }

  // Bundles & Systems tab buttons
  const newBundleBtn = container.querySelector('#btn-new-bundle');
  if (newBundleBtn) {
    newBundleBtn.onclick = () => openNewBundleModal(() => {
      refreshView(container, refreshCallback);
      if (refreshCallback) refreshCallback();
    });
  }

  container.querySelectorAll('.btn-simulate-bundle').forEach(btn => {
    btn.onclick = () => {
      const bId = btn.getAttribute('data-bundle-id');
      openSimulateBundleModal(bId);
    };
  });

  container.querySelectorAll('.btn-view-bundle').forEach(btn => {
    btn.onclick = () => {
      const bId = btn.getAttribute('data-bundle-id');
      openBundleDetailModal(bId);
    };
  });

  // BOM View actions
  container.querySelectorAll('.btn-view-recipe').forEach(btn => {
    btn.onclick = () => {
      const rId = btn.getAttribute('data-recipe-id');
      openRecipeDetailModal(rId);
    };
  });

  container.querySelectorAll('.btn-view-template').forEach(btn => {
    btn.onclick = () => {
      const tId = btn.getAttribute('data-template-id');
      openDisassemblyTemplateDetailModal(tId);
    };
  });

  // Labor Payables buttons
  const recordPayBtn = container.querySelector('#btn-record-labor-payment');
  if (recordPayBtn) {
    recordPayBtn.onclick = () => openRecordLaborPaymentModal(null, () => {
      refreshView(container, refreshCallback);
      if (refreshCallback) refreshCallback();
    });
  }

  container.querySelectorAll('.btn-pay-specific-party').forEach(btn => {
    btn.onclick = () => {
      const partyId = btn.getAttribute('data-party-id');
      openRecordLaborPaymentModal(partyId, () => {
        refreshView(container, refreshCallback);
        if (refreshCallback) refreshCallback();
      });
    };
  });

  // Table actions binding
  if (activeTab === 'assembly') {
    const assemblies = assemblyService.getAssemblies();
    const actions = [
      {
        label: 'Complete',
        variant: 'primary',
        condition: row => row.status === 'Draft',
        onClick: (row) => handleCompleteAssemblyClick(row, () => {
          refreshView(container, refreshCallback);
          if (refreshCallback) refreshCallback();
        })
      },
      {
        label: 'Reverse',
        variant: 'danger',
        condition: row => row.status === 'Completed',
        onClick: (row) => handleReverseAssemblyClick(row, () => {
          refreshView(container, refreshCallback);
          if (refreshCallback) refreshCallback();
        })
      },
      {
        label: 'Voucher',
        variant: 'secondary',
        onClick: (row) => {
          const variants = productService.getVariants();
          const warehouses = warehouseService.getWarehouses();
          const laborParties = assemblyService.getLaborParties();
          handlePrintAssemblyVoucher(
            row,
            new Map(variants.map(v => [v.id, v.name])),
            new Map(warehouses.map(w => [w.id, w.name])),
            new Map(laborParties.map(p => [p.id, p.name]))
          );
        }
      }
    ];
    bindTableActions(container, actions, assemblies);
  } else if (activeTab === 'disassembly') {
    const disassemblies = assemblyService.getDisassemblies();
    const actions = [
      {
        label: 'Reverse',
        variant: 'danger',
        condition: row => row.status === 'Completed',
        onClick: (row) => handleReverseDisassemblyClick(row, () => {
          refreshView(container, refreshCallback);
          if (refreshCallback) refreshCallback();
        })
      },
      {
        label: 'View Voucher',
        variant: 'secondary',
        onClick: (row) => {
          const variants = productService.getVariants();
          const warehouses = warehouseService.getWarehouses();
          handlePrintDisassemblyVoucher(
            row,
            new Map(variants.map(v => [v.id, v.name])),
            new Map(warehouses.map(w => [w.id, w.name]))
          );
        }
      }
    ];
    bindTableActions(container, actions, disassemblies);
  }
}

function refreshView(container, refreshCallback) {
  const newHtml = renderAssemblyView();
  container.innerHTML = newHtml;
  bindAssemblyEvents(container, refreshCallback);
}

// ============================================================================
// MODAL 1: NEW ASSEMBLY BUILD (WITH BOM RECIPE, DUAL WH & LABOR VALUATION)
// Strictly follows Design/code 1.html layout
// ============================================================================

function openNewAssemblyModal(onSaved) {
  const recipes = assemblyService.getRecipes();
  const warehouses = warehouseService.getWarehouses();
  const variants = productService.getVariants();
  const laborParties = assemblyService.getLaborParties();
  const canViewCost = authService.canViewCostProfit();

  const contentHtml = `
    <form id="new-assembly-order-form" class="space-y-6 text-xs">
      <!-- SECTION 1: Production Plan & Recipe -->
      <section class="bg-white p-5 rounded-2xl border border-slate-200/90 shadow-2xs space-y-4">
        <div class="flex items-center justify-between border-b border-slate-100 pb-3">
          <h3 class="text-xs font-bold uppercase tracking-wider text-slate-500 flex items-center space-x-2">
            <svg class="w-3.5 h-3.5 text-[#138FCB]" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"></path>
            </svg>
            <span>Production Plan &amp; Recipe</span>
          </h3>
          <span class="text-[11px] text-slate-400">All fields marked with <span class="text-red-500">*</span> are required</span>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-12 gap-4">
          <div class="md:col-span-6 space-y-1.5">
            <label class="text-xs font-semibold text-slate-700" for="asm-recipe-select">Predefined BOM Recipe (Optional)</label>
            <select id="asm-recipe-select" class="w-full text-xs font-medium rounded-xl border border-slate-200 focus:border-[#138FCB] focus:ring focus:ring-blue-100 py-2.5 px-3 text-slate-800 bg-white shadow-2xs">
              <option value="">-- Custom Assembly / Finishing (No Recipe) --</option>
              ${recipes.map(r => `<option value="${r.id}">${r.name} (${r.assemblyType})</option>`).join('')}
            </select>
          </div>
          <div class="md:col-span-3 space-y-1.5">
            <label class="text-xs font-semibold text-slate-700" for="asm-type">Assembly Type <span class="text-red-500">*</span></label>
            <select id="asm-type" required class="w-full text-xs font-medium rounded-xl border border-slate-200 focus:border-[#138FCB] focus:ring focus:ring-blue-100 py-2.5 px-3 text-slate-800 bg-white shadow-2xs">
              <option value="MANUFACTURING">Multi-Component Assembly</option>
              <option value="FINISHING">Single-Product Finishing</option>
            </select>
          </div>
          <div class="md:col-span-3 space-y-1.5">
            <label class="text-xs font-semibold text-slate-700" for="asm-date">Assembly Date <span class="text-red-500">*</span></label>
            <input id="asm-date" type="date" required value="${new Date().toISOString().split('T')[0]}" class="w-full text-xs font-medium rounded-xl border border-slate-200 focus:border-[#138FCB] focus:ring focus:ring-blue-100 py-2.5 px-3 text-slate-800 bg-white shadow-2xs">
          </div>

          <div class="md:col-span-8 space-y-1.5">
            <label class="text-xs font-semibold text-slate-700" for="asm-target-variant">Target Finished Product Variant <span class="text-red-500">*</span></label>
            <select id="asm-target-variant" required class="w-full text-xs font-bold rounded-xl border border-slate-200 focus:border-[#138FCB] focus:ring focus:ring-blue-100 py-2.5 px-3 text-slate-800 bg-white shadow-2xs">
              ${variants.map(v => `<option value="${v.id}">${v.name} (${v.sku})</option>`).join('')}
            </select>
          </div>
          <div class="md:col-span-4 space-y-1.5">
            <label class="text-xs font-semibold text-slate-700" for="asm-output-qty">Output Quantity to Produce <span class="text-red-500">*</span></label>
            <input type="number" id="asm-output-qty" required min="1" value="1" class="w-full text-xs font-bold rounded-xl border border-slate-200 focus:border-[#138FCB] focus:ring focus:ring-blue-100 py-2.5 px-3 text-slate-800 bg-white shadow-2xs">
          </div>
        </div>
      </section>

      <!-- SECTION 2: Warehouse Routing & Labor Workshop -->
      <section class="bg-white p-5 rounded-2xl border border-slate-200/90 shadow-2xs space-y-4">
        <div class="flex items-center justify-between border-b border-slate-100 pb-3">
          <h3 class="text-xs font-bold uppercase tracking-wider text-slate-500 flex items-center space-x-2">
            <svg class="w-3.5 h-3.5 text-[#138FCB]" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4"></path>
            </svg>
            <span>Warehouse Routing &amp; Assembly Labor</span>
          </h3>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div class="space-y-1.5">
            <label class="text-xs font-semibold text-slate-700" for="asm-src-warehouse">Source Warehouse (Components Deducted From) <span class="text-red-500">*</span></label>
            <select id="asm-src-warehouse" required class="w-full text-xs font-medium rounded-xl border border-slate-200 focus:border-[#138FCB] py-2.5 px-3 text-slate-800 bg-white shadow-2xs">
              ${warehouses.map(w => `<option value="${w.id}">${w.name}</option>`).join('')}
            </select>
          </div>
          <div class="space-y-1.5">
            <label class="text-xs font-semibold text-slate-700" for="asm-out-warehouse">Output Warehouse (Finished Product Added To) <span class="text-red-500">*</span></label>
            <select id="asm-out-warehouse" required class="w-full text-xs font-medium rounded-xl border border-slate-200 focus:border-[#138FCB] py-2.5 px-3 text-slate-800 bg-white shadow-2xs">
              ${warehouses.map(w => `<option value="${w.id}">${w.name}</option>`).join('')}
            </select>
          </div>

          <div class="space-y-1.5">
            <label class="text-xs font-semibold text-slate-700" for="asm-labor-party">Assembly Labor Party / Workshop <span class="text-red-500">*</span></label>
            <select id="asm-labor-party" required class="w-full text-xs font-semibold rounded-xl border border-slate-200 focus:border-[#138FCB] py-2.5 px-3 text-slate-800 bg-white shadow-2xs">
              ${laborParties.map(p => `<option value="${p.id}">${p.name} (Outstanding: Rs. ${(p.currentBalance || 0).toLocaleString()})</option>`).join('')}
            </select>
          </div>
          <div class="space-y-1.5">
            <label class="text-xs font-semibold text-slate-700" for="asm-labor-rate">Labor Rate (PKR / Finished Unit) <span class="text-red-500">*</span></label>
            <input type="number" id="asm-labor-rate" required min="0" value="500" class="w-full text-xs font-bold rounded-xl border border-slate-200 focus:border-[#138FCB] py-2.5 px-3 text-slate-800 bg-white shadow-2xs">
          </div>
        </div>
      </section>

      <!-- SECTION 3: Bill of Materials (BOM) Component Breakdown Table -->
      <section class="bg-white p-5 rounded-2xl border border-slate-200/90 shadow-2xs space-y-4">
        <div class="flex items-center justify-between border-b border-slate-100 pb-3">
          <div class="flex items-center space-x-2">
            <h3 class="text-xs font-bold uppercase tracking-wider text-slate-500 flex items-center space-x-2">
              <svg class="w-3.5 h-3.5 text-[#138FCB]" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4"></path>
              </svg>
              <span>Required Inventory Components (BOM)</span>
            </h3>
            <span id="bom-items-count-badge" class="px-2 py-0.5 text-[10px] font-semibold rounded-full bg-slate-100 text-slate-600">0 Components</span>
          </div>
          <button type="button" id="btn-add-bom-row" class="inline-flex items-center space-x-1.5 px-3.5 py-1.5 border border-dashed border-[#138FCB]/40 hover:border-[#138FCB] bg-blue-50/50 hover:bg-blue-50 text-[#138FCB] rounded-xl text-xs font-bold transition-all cursor-pointer">
            <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" d="M12 4v16m8-8H4"></path>
            </svg>
            <span>+ Add Component</span>
          </button>
        </div>

        <div class="overflow-x-auto border border-slate-200 rounded-xl">
          <table class="w-full text-left text-xs">
            <thead class="bg-slate-50 text-slate-500 uppercase text-[10px] tracking-wider border-b border-slate-200">
              <tr>
                <th class="py-3 px-3 w-6/12 font-semibold">Component Item</th>
                <th class="py-3 px-2 w-2/12 font-semibold text-center">Qty / Unit</th>
                <th class="py-3 px-3 w-2/12 font-semibold text-right">Unit Cost</th>
                <th class="py-3 px-3 w-2/12 font-semibold text-right">Subtotal</th>
                <th class="py-3 px-2 w-8 text-center font-semibold"></th>
              </tr>
            </thead>
            <tbody id="bom-items-table" class="divide-y divide-slate-100 text-slate-700">
              <!-- Dynamic Rows -->
            </tbody>
          </table>
        </div>

        <!-- Stock Availability Banner -->
        <div id="asm-stock-banner" class="p-3 rounded-xl border text-xs flex items-center justify-between transition-all">
          <span id="asm-stock-msg" class="font-bold">Checking component availability...</span>
          <span id="asm-stock-badge" class="px-2.5 py-1 rounded-full font-extrabold text-[10px]"></span>
        </div>
      </section>

      <!-- SECTION 4: Dual Columns: Notes vs Cost Breakdown -->
      <div class="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
        <div class="lg:col-span-7 bg-white p-5 rounded-2xl border border-slate-200/90 shadow-2xs space-y-4">
          <h3 class="text-xs font-bold uppercase tracking-wider text-slate-500">Notes &amp; Production Batch Reference</h3>
          <div class="space-y-1.5">
            <label class="text-xs font-medium text-slate-700" for="asm-notes">Batch Memo / Farm Order Reference</label>
            <textarea id="asm-notes" class="w-full text-xs rounded-xl border border-slate-200 focus:border-[#138FCB] text-slate-700 p-2.5 resize-none" rows="3" placeholder="e.g. Assembled for commercial broiler shed installation; QA tested on floor."></textarea>
          </div>
        </div>

        <div class="lg:col-span-5 bg-white p-5 rounded-2xl border border-slate-200/90 shadow-2xs space-y-3">
          <h3 class="text-xs font-bold uppercase tracking-wider text-slate-500 pb-1 border-b border-slate-100">Production Cost Summary</h3>
          <div class="space-y-2 text-xs">
            <div class="flex justify-between text-slate-600">
              <span>Raw Materials Cost</span>
              <span id="asm-preview-mat-cost" class="font-medium text-slate-900">${canViewCost ? 'Rs. 0' : '🔒 Redacted'}</span>
            </div>
            <div class="flex justify-between text-slate-600">
              <span>Assembly Labor Cost</span>
              <span id="asm-preview-labor-cost" class="font-medium text-slate-900">${canViewCost ? 'Rs. 0' : '🔒 Redacted'}</span>
            </div>
            <div class="flex justify-between text-slate-600">
              <span>Finished Unit Cost</span>
              <span id="asm-preview-unit-cost" class="font-bold text-emerald-600">${canViewCost ? 'Rs. 0 / unit' : '🔒 Redacted'}</span>
            </div>
          </div>

          <div class="mt-4 pt-3 bg-blue-50/50 -mx-5 -mb-5 p-5 rounded-b-2xl border-t border-blue-100 flex items-center justify-between">
            <div>
              <p class="text-[11px] font-bold uppercase tracking-wider text-[#138FCB]">Total Production Cost</p>
              <p class="text-[10px] text-slate-400">Capitalized into Finished Stock</p>
            </div>
            <div class="text-right">
              <span id="asm-preview-total-cost" class="text-2xl font-extrabold text-slate-900 tracking-tight">${canViewCost ? 'Rs. 0' : '🔒 Redacted'}</span>
            </div>
          </div>
        </div>
      </div>
    </form>
  `;

  const footerHtml = `
    <div class="flex items-center space-x-2 text-xs text-slate-400 font-medium">
      <svg class="w-4 h-4 text-emerald-500 shrink-0" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
        <path d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" stroke-linecap="round" stroke-linejoin="round"></path>
      </svg>
      <span>SSL 256-bit encrypted ERP transaction</span>
    </div>
    <div class="flex items-center space-x-3 w-full sm:w-auto justify-end">
      <button id="asm-modal-cancel" type="button" class="px-4 py-2 text-xs font-semibold text-slate-700 bg-white hover:bg-slate-50 border border-slate-300 rounded-xl transition-colors cursor-pointer shadow-2xs">
        Cancel
      </button>
      <button id="asm-save-draft-btn" type="button" class="px-4 py-2 text-xs font-semibold text-amber-700 bg-amber-50 hover:bg-amber-100 border border-amber-200 rounded-xl transition-colors cursor-pointer shadow-2xs">
        Save as Draft
      </button>
      <button id="asm-complete-now-btn" type="submit" form="new-assembly-order-form" class="inline-flex items-center space-x-2 px-5 py-2.5 text-xs font-bold text-white bg-[#138FCB] hover:bg-[#0E78AC] rounded-xl shadow-sm transition-all active:scale-[0.98] cursor-pointer">
        <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"></path>
        </svg>
        <span>Complete Production Now</span>
      </button>
    </div>
  `;

  openModal({
    title: 'New Assembly Build',
    subtitle: 'Converts raw inventory components into finished products with labor payable valuation',
    badge: 'Production Engine',
    icon: '🔨',
    contentHtml,
    footerHtml,
    size: 'max-w-4xl',
    onOpen: (modalEl) => {
      const cancelBtn = modalEl.querySelector('#asm-modal-cancel');
      if (cancelBtn) cancelBtn.onclick = () => closeModal();

      const recipeSelect = modalEl.querySelector('#asm-recipe-select');
      const typeSelect = modalEl.querySelector('#asm-type');
      const targetVarSelect = modalEl.querySelector('#asm-target-variant');
      const outputQtyInput = modalEl.querySelector('#asm-output-qty');
      const srcWhSelect = modalEl.querySelector('#asm-src-warehouse');
      const laborRateInput = modalEl.querySelector('#asm-labor-rate');
      const laborPartySelect = modalEl.querySelector('#asm-labor-party');
      const tableContainer = modalEl.querySelector('#bom-items-table');
      const addRowBtn = modalEl.querySelector('#btn-add-bom-row');
      const stockBanner = modalEl.querySelector('#asm-stock-banner');
      const stockMsg = modalEl.querySelector('#asm-stock-msg');
      const stockBadge = modalEl.querySelector('#asm-stock-badge');
      const previewMatCost = modalEl.querySelector('#asm-preview-mat-cost');
      const previewLaborCost = modalEl.querySelector('#asm-preview-labor-cost');
      const previewUnitCost = modalEl.querySelector('#asm-preview-unit-cost');
      const previewTotalCost = modalEl.querySelector('#asm-preview-total-cost');
      const countBadge = modalEl.querySelector('#bom-items-count-badge');

      const addComponentRow = (varId = '', qtyPerUnit = 1, cost = 0) => {
        const row = document.createElement('tr');
        row.className = 'bom-input-row hover:bg-slate-50/70 transition-colors group';
        row.innerHTML = `
          <td class="p-3">
            <select class="bom-var w-full text-xs font-semibold rounded-xl border border-slate-200 focus:border-[#138FCB] py-1.5 px-2 bg-white">
              ${variants.map(v => `<option value="${v.id}" ${v.id === varId ? 'selected' : ''}>${v.name} (${v.sku})</option>`).join('')}
            </select>
          </td>
          <td class="p-3 text-center">
            <input type="number" min="0.01" step="any" value="${qtyPerUnit}" class="bom-qty w-20 text-center text-xs font-bold rounded-xl border border-slate-200 focus:border-[#138FCB] py-1.5 px-2 bg-white">
          </td>
          <td class="p-3 text-right">
            <input type="number" min="0" value="${cost || 0}" class="bom-cost w-24 text-right text-xs font-medium rounded-xl border border-slate-200 focus:border-[#138FCB] py-1.5 px-2 bg-white">
          </td>
          <td class="p-3 text-right font-bold text-slate-800 bom-row-amount">
            Rs. ${(qtyPerUnit * (cost || 0)).toLocaleString()}
          </td>
          <td class="p-3 text-center">
            <button type="button" class="btn-remove-row text-slate-300 hover:text-red-500 p-1 rounded-lg transition-colors cursor-pointer">
              <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                <path d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" stroke-linecap="round" stroke-linejoin="round"></path>
              </svg>
            </button>
          </td>
        `;

        row.querySelector('.btn-remove-row').onclick = () => {
          row.remove();
          recalculate();
        };

        const compVar = row.querySelector('.bom-var');
        compVar.onchange = () => {
          const v = variants.find(x => x.id === compVar.value);
          if (v && (!row.querySelector('.bom-cost').value || Number(row.querySelector('.bom-cost').value) === 0)) {
            row.querySelector('.bom-cost').value = v.costPrice || 0;
          }
          recalculate();
        };

        row.querySelector('.bom-qty').oninput = recalculate;
        row.querySelector('.bom-cost').oninput = recalculate;

        tableContainer.appendChild(row);
        recalculate();
      };

      addRowBtn.onclick = () => {
        addComponentRow(variants[0]?.id, 1, variants[0]?.costPrice || 0);
      };

      const recalculate = () => {
        const outQty = Number(outputQtyInput.value) || 1;
        const laborRate = Number(laborRateInput.value) || 0;
        const srcWhId = srcWhSelect.value;

        let totalMatCost = 0;
        const componentsToCheck = [];
        const rows = tableContainer.querySelectorAll('.bom-input-row');
        if (countBadge) countBadge.textContent = `${rows.length} Components`;

        rows.forEach(r => {
          const compVarId = r.querySelector('.bom-var').value;
          const qtyPerUnit = Number(r.querySelector('.bom-qty').value) || 0;
          const unitCost = Number(r.querySelector('.bom-cost').value) || 0;
          const totalQtyNeeded = qtyPerUnit * outQty;
          const lineCost = totalQtyNeeded * unitCost;
          totalMatCost += lineCost;

          const amountCell = r.querySelector('.bom-row-amount');
          if (amountCell) amountCell.textContent = canViewCost ? `Rs. ${Math.round(lineCost).toLocaleString()}` : '🔒 Redacted';

          componentsToCheck.push({
            componentVariantId: compVarId,
            quantityConsumed: totalQtyNeeded,
            unitCost
          });
        });

        const totalLabor = outQty * laborRate;
        const grandTotal = totalMatCost + totalLabor;
        const unitFinished = outQty > 0 ? (grandTotal / outQty) : 0;

        if (canViewCost) {
          if (previewMatCost) previewMatCost.textContent = `Rs. ${Math.round(totalMatCost).toLocaleString()}`;
          if (previewLaborCost) previewLaborCost.textContent = `Rs. ${Math.round(totalLabor).toLocaleString()}`;
          if (previewUnitCost) previewUnitCost.textContent = `Rs. ${Math.round(unitFinished).toLocaleString()} / unit`;
          if (previewTotalCost) previewTotalCost.textContent = `Rs. ${Math.round(grandTotal).toLocaleString()}`;
        }

        // Stock check
        const check = assemblyService.checkStockAvailability(componentsToCheck, srcWhId);
        if (check.available) {
          stockBanner.className = 'p-3 rounded-xl border border-emerald-200 bg-emerald-50 text-xs flex items-center justify-between text-emerald-900';
          stockMsg.textContent = '✅ All components are available in source warehouse stock.';
          stockBadge.className = 'px-2.5 py-1 rounded-full font-extrabold text-[10px] bg-emerald-600 text-white';
          stockBadge.textContent = 'READY TO PRODUCE';
        } else {
          stockBanner.className = 'p-3 rounded-xl border border-rose-200 bg-rose-50 text-xs flex items-center justify-between text-rose-900';
          const shortfallSummary = check.shortfalls.map(s => `${s.variantName || 'Component'}: -${s.shortfallQty}`).join(', ');
          stockMsg.textContent = `⚠️ Insufficient Stock: ${shortfallSummary}`;
          stockBadge.className = 'px-2.5 py-1 rounded-full font-extrabold text-[10px] bg-rose-600 text-white';
          stockBadge.textContent = 'SHORTFALL DETECTED';
        }
      };

      // Load recipe components if chosen
      recipeSelect.onchange = () => {
        const recipeId = recipeSelect.value;
        if (!recipeId) return;
        const rec = recipes.find(r => r.id === recipeId);
        if (!rec) return;

        typeSelect.value = rec.assemblyType || 'MANUFACTURING';
        targetVarSelect.value = rec.finishedVariantId;
        laborRateInput.value = rec.defaultLaborRate || 0;
        if (rec.defaultLaborPartyId) laborPartySelect.value = rec.defaultLaborPartyId;
        if (rec.defaultSourceWarehouseId) srcWhSelect.value = rec.defaultSourceWarehouseId;

        tableContainer.innerHTML = '';
        (rec.components || []).forEach(c => {
          const v = variants.find(x => x.id === c.componentVariantId);
          addComponentRow(c.componentVariantId, c.quantityPerUnit, v?.costPrice || 0);
        });

        recalculate();
      };

      // Initial defaults
      if (recipes.length > 0) {
        recipeSelect.value = recipes[0].id;
        recipeSelect.dispatchEvent(new Event('change'));
      } else {
        addComponentRow(variants[0]?.id, 1, variants[0]?.costPrice || 0);
      }

      outputQtyInput.oninput = recalculate;
      laborRateInput.oninput = recalculate;
      srcWhSelect.onchange = recalculate;

      const gatherFormData = () => {
        const recipeId = recipeSelect.value || null;
        const assemblyType = typeSelect.value;
        const finishedVariantId = targetVarSelect.value;
        const finishedQuantity = Number(outputQtyInput.value) || 1;
        const sourceWarehouseId = srcWhSelect.value;
        const outputWarehouseId = modalEl.querySelector('#asm-out-warehouse').value;
        const laborPartyId = laborPartySelect.value;
        const laborRate = Number(laborRateInput.value) || 0;
        const assemblyDate = modalEl.querySelector('#asm-date').value;
        const notes = modalEl.querySelector('#asm-notes').value.trim();

        const lines = [];
        tableContainer.querySelectorAll('.bom-input-row').forEach(r => {
          const compVarId = r.querySelector('.bom-var').value;
          const qtyPerUnit = Number(r.querySelector('.bom-qty').value) || 0;
          const unitCost = Number(r.querySelector('.bom-cost').value) || 0;
          lines.push({
            componentVariantId: compVarId,
            quantityConsumed: qtyPerUnit * finishedQuantity,
            unitCost,
            unit: 'PCS'
          });
        });

        return {
          recipeId,
          assemblyType,
          finishedVariantId,
          finishedQuantity,
          sourceWarehouseId,
          outputWarehouseId,
          laborPartyId,
          laborRate,
          assemblyDate,
          lines,
          notes,
          userId: authService.getCurrentUser()?.id || 'user-admin'
        };
      };

      // Save as Draft
      const saveDraftBtn = modalEl.querySelector('#asm-save-draft-btn');
      if (saveDraftBtn) {
        saveDraftBtn.onclick = () => {
          const payload = gatherFormData();
          try {
            const order = assemblyService.createAssemblyOrder(payload);
            toast.show(`Assembly Order ${order.assemblyNumber} saved as Draft. Inventory untouched.`, 'success');
            closeModal();
            if (onSaved) onSaved();
          } catch (err) {
            toast.show(err.message, 'error');
          }
        };
      }

      // Complete Immediately
      modalEl.querySelector('#new-assembly-order-form').onsubmit = (e) => {
        e.preventDefault();
        const payload = gatherFormData();

        // Verify stock check
        const check = assemblyService.checkStockAvailability(payload.lines, payload.sourceWarehouseId);
        if (!check.available) {
          toast.show(`Cannot complete: Shortfall in ${check.shortfalls[0]?.variantName || 'components'}`, 'error');
          return;
        }

        try {
          const order = assemblyService.createAssemblyOrder(payload);
          assemblyService.completeAssembly(order.id, payload.userId);
          toast.show(`Assembly ${order.assemblyNumber} completed! Finished products produced & labor payable created.`, 'success');
          closeModal();
          if (onSaved) onSaved();
        } catch (err) {
          toast.show(err.message, 'error');
        }
      };
    }
  });
}

// Complete Draft Order
function handleCompleteAssemblyClick(row, onSaved) {
  confirmAction({
    title: `Complete Assembly Order: ${row.assemblyNumber}`,
    message: `Are you sure you want to finalize this build? Consumed components will be deducted from inventory, ${row.finishedQuantity} finished units will be produced, and Rs. ${(row.totalLaborCost || 0).toLocaleString()} will be recorded as an unpaid labor payable.`,
    confirmLabel: 'Yes, Complete Build',
    isDestructive: false,
    onConfirm: () => {
      try {
        assemblyService.completeAssembly(row.id, authService.getCurrentUser()?.id || 'user-admin');
        toast.show(`Assembly ${row.assemblyNumber} successfully completed.`, 'success');
        if (onSaved) onSaved();
      } catch (err) {
        toast.show(err.message, 'error');
      }
    }
  });
}

// Reverse Completed Assembly Order
function handleReverseAssemblyClick(row, onSaved) {
  confirmAction({
    title: `Reverse Assembly Order: ${row.assemblyNumber}`,
    message: `Are you sure you want to reverse this completed assembly? It will restore all consumed components back to stock, deduct ${row.finishedQuantity} finished units, cancel the unpaid labor payable, and post reversing journal entries.`,
    confirmLabel: 'Yes, Reverse Assembly',
    isDestructive: true,
    onConfirm: () => {
      try {
        assemblyService.reverseAssembly(row.id, authService.getCurrentUser()?.id || 'user-admin');
        toast.show(`Assembly ${row.assemblyNumber} successfully reversed. Stock and payables restored.`, 'success');
        if (onSaved) onSaved();
      } catch (err) {
        toast.show(err.message, 'error');
      }
    }
  });
}

// ============================================================================
// MODAL 2: NEW DISASSEMBLY / BREAKDOWN (ANY ITEM)
// ============================================================================

function openNewDisassemblyModal(onSaved) {
  const warehouses = warehouseService.getWarehouses();
  const variants = productService.getVariants();
  const templates = assemblyService.getDisassemblyTemplates();
  const canViewCost = authService.canViewCostProfit();

  const contentHtml = `
    <form id="new-disassembly-form" class="space-y-6 text-xs">
      <!-- SECTION 1: Source Item & Warehouse -->
      <section class="bg-white p-5 rounded-2xl border border-slate-200/90 shadow-2xs space-y-4">
        <div class="flex items-center justify-between border-b border-slate-100 pb-3">
          <h3 class="text-xs font-bold uppercase tracking-wider text-slate-500 flex items-center space-x-2">
            <svg class="w-3.5 h-3.5 text-rose-600" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"></path>
            </svg>
            <span>Disassembly Item &amp; Warehouse Location</span>
          </h3>
          <span class="text-[11px] text-slate-400">All fields marked with <span class="text-red-500">*</span> are required</span>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-12 gap-4">
          <div class="md:col-span-6 space-y-1.5">
            <label class="text-xs font-semibold text-slate-700" for="dis-template-select">Load Disassembly Template (Optional)</label>
            <select id="dis-template-select" class="w-full text-xs font-medium rounded-xl border border-slate-200 focus:border-rose-500 py-2.5 px-3 text-slate-800 bg-white shadow-2xs">
              <option value="">-- Manual Teardown / Any Inventory Item --</option>
              ${templates.map(t => `<option value="${t.id}">${t.name}</option>`).join('')}
            </select>
          </div>
          <div class="md:col-span-3 space-y-1.5">
            <label class="text-xs font-semibold text-slate-700" for="dis-warehouse">Warehouse Location <span class="text-red-500">*</span></label>
            <select id="dis-warehouse" required class="w-full text-xs font-medium rounded-xl border border-slate-200 focus:border-rose-500 py-2.5 px-3 text-slate-800 bg-white shadow-2xs">
              ${warehouses.map(w => `<option value="${w.id}">${w.name}</option>`).join('')}
            </select>
          </div>
          <div class="md:col-span-3 space-y-1.5">
            <label class="text-xs font-semibold text-slate-700" for="dis-date">Disassembly Date <span class="text-red-500">*</span></label>
            <input id="dis-date" type="date" required value="${new Date().toISOString().split('T')[0]}" class="w-full text-xs font-medium rounded-xl border border-slate-200 focus:border-rose-500 py-2.5 px-3 text-slate-800 bg-white shadow-2xs">
          </div>

          <div class="md:col-span-8 space-y-1.5">
            <label class="text-xs font-semibold text-slate-700" for="dis-source-var">Item to Disassemble (Any Item In Stock) <span class="text-red-500">*</span></label>
            <select id="dis-source-var" required class="w-full text-xs font-bold rounded-xl border border-slate-200 focus:border-rose-500 py-2.5 px-3 text-slate-800 bg-white shadow-2xs">
              ${variants.map(v => `<option value="${v.id}" data-cost="${v.costPrice || 0}">${v.name} (${v.sku})</option>`).join('')}
            </select>
          </div>
          <div class="md:col-span-4 space-y-1.5">
            <label class="text-xs font-semibold text-slate-700" for="dis-qty">Quantity to Dismantle <span class="text-red-500">*</span></label>
            <input type="number" id="dis-qty" required min="1" value="1" class="w-full text-xs font-bold rounded-xl border border-slate-200 focus:border-rose-500 py-2.5 px-3 text-slate-800 bg-white shadow-2xs">
          </div>
        </div>

        <!-- Live Available Stock of Source Item -->
        <div id="dis-source-stock-pill" class="p-3 rounded-xl border border-slate-200 bg-slate-50 text-xs font-semibold text-slate-700 flex justify-between items-center">
          <div class="flex items-center space-x-2">
            <span class="w-2 h-2 rounded-full bg-blue-500"></span>
            <span>Available in warehouse stock: <strong id="dis-stock-count" class="text-slate-900 font-bold">0</strong> units</span>
          </div>
          <span>Item Unit Cost: <strong id="dis-item-cost" class="text-slate-900">${canViewCost ? 'Rs. 0' : '🔒 Redacted'}</strong></span>
        </div>
      </section>

      <!-- SECTION 2: Recovered Components Table -->
      <section class="bg-white p-5 rounded-2xl border border-slate-200/90 shadow-2xs space-y-4">
        <div class="flex items-center justify-between border-b border-slate-100 pb-3">
          <div class="flex items-center space-x-2">
            <h3 class="text-xs font-bold uppercase tracking-wider text-slate-500 flex items-center space-x-2">
              <svg class="w-3.5 h-3.5 text-rose-600" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"></path>
              </svg>
              <span>Recoverable Components (Partial Teardown Supported)</span>
            </h3>
            <span id="rec-items-count-badge" class="px-2 py-0.5 text-[10px] font-semibold rounded-full bg-slate-100 text-slate-600">0 Items</span>
          </div>
          <button type="button" id="btn-add-recovered-row" class="inline-flex items-center space-x-1.5 px-3.5 py-1.5 border border-dashed border-rose-300 hover:border-rose-500 bg-rose-50/50 hover:bg-rose-50 text-rose-600 rounded-xl text-xs font-bold transition-all cursor-pointer">
            <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" d="M12 4v16m8-8H4"></path>
            </svg>
            <span>+ Add Component</span>
          </button>
        </div>

        <div class="overflow-x-auto border border-slate-200 rounded-xl">
          <table class="w-full text-left text-xs">
            <thead class="bg-slate-50 text-slate-500 uppercase text-[10px] tracking-wider border-b border-slate-200">
              <tr>
                <th class="py-3 px-2 w-8 text-center font-semibold">Recover?</th>
                <th class="py-3 px-3 w-5/12 font-semibold">Component Item</th>
                <th class="py-3 px-2 w-2/12 font-semibold text-center">Recover Qty</th>
                <th class="py-3 px-3 w-2/12 font-semibold text-right">Unit Value</th>
                <th class="py-3 px-3 w-2/12 font-semibold text-right">Total Recovered</th>
                <th class="py-3 px-2 w-8 text-center font-semibold"></th>
              </tr>
            </thead>
            <tbody id="recovered-items-table" class="divide-y divide-slate-100 text-slate-700">
              <!-- Dynamic Rows -->
            </tbody>
          </table>
        </div>
      </section>

      <!-- SECTION 3: Dual Columns: Notes vs Valuation Breakdown -->
      <div class="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
        <div class="lg:col-span-7 bg-white p-5 rounded-2xl border border-slate-200/90 shadow-2xs space-y-4">
          <h3 class="text-xs font-bold uppercase tracking-wider text-slate-500">Reason for Breakdown &amp; Memo</h3>
          <div class="space-y-1.5">
            <label class="text-xs font-medium text-slate-700" for="dis-notes">Teardown Notes / Scrap Reason</label>
            <textarea id="dis-notes" class="w-full text-xs rounded-xl border border-slate-200 focus:border-rose-500 text-slate-700 p-2.5 resize-none" rows="3" placeholder="e.g. Scrapped defective fan housing to recover copper motor, capacitor and blades into spare parts."></textarea>
          </div>
        </div>

        <div class="lg:col-span-5 bg-white p-5 rounded-2xl border border-slate-200/90 shadow-2xs space-y-3">
          <h3 class="text-xs font-bold uppercase tracking-wider text-slate-500 pb-1 border-b border-slate-100">Variance &amp; Cost Valuation</h3>
          <div class="space-y-2 text-xs">
            <div class="flex justify-between text-slate-600">
              <span>Source Item Total Cost</span>
              <span id="dis-preview-source-cost" class="font-medium text-slate-900">${canViewCost ? 'Rs. 0' : '🔒 Redacted'}</span>
            </div>
            <div class="flex justify-between text-slate-600">
              <span>Total Recovered Value</span>
              <span id="dis-preview-recovered-value" class="font-medium text-emerald-600">${canViewCost ? 'Rs. 0' : '🔒 Redacted'}</span>
            </div>
          </div>

          <div class="mt-4 pt-3 bg-rose-50/50 -mx-5 -mb-5 p-5 rounded-b-2xl border-t border-rose-100 flex items-center justify-between">
            <div>
              <p class="text-[11px] font-bold uppercase tracking-wider text-rose-700">Variance / Scrap Loss</p>
              <p class="text-[10px] text-slate-400">Tracked in Disassembly Variance COA</p>
            </div>
            <div class="text-right">
              <span id="dis-preview-variance" class="text-2xl font-extrabold text-slate-900 tracking-tight">${canViewCost ? 'Rs. 0' : '🔒 Redacted'}</span>
            </div>
          </div>
        </div>
      </div>
    </form>
  `;

  const footerHtml = `
    <div class="flex items-center space-x-2 text-xs text-slate-400 font-medium">
      <svg class="w-4 h-4 text-emerald-500 shrink-0" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
        <path d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" stroke-linecap="round" stroke-linejoin="round"></path>
      </svg>
      <span>SSL 256-bit encrypted ERP transaction</span>
    </div>
    <div class="flex items-center space-x-3 w-full sm:w-auto justify-end">
      <button id="dis-modal-cancel" type="button" class="px-4 py-2 text-xs font-semibold text-slate-700 bg-white hover:bg-slate-50 border border-slate-300 rounded-xl transition-colors cursor-pointer shadow-2xs">
        Cancel
      </button>
      <button type="submit" form="new-disassembly-form" class="inline-flex items-center space-x-2 px-5 py-2.5 text-xs font-bold text-white bg-rose-600 hover:bg-rose-700 rounded-xl shadow-sm transition-all active:scale-[0.98] cursor-pointer">
        <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path>
        </svg>
        <span>Confirm Disassembly &amp; Recover Components</span>
      </button>
    </div>
  `;

  openModal({
    title: 'Disassembly / Breakdown',
    subtitle: 'Teardown any product to recover reusable components into inventory with scrap variance calculation',
    badge: 'Stock Recovery',
    icon: '🔄',
    contentHtml,
    footerHtml,
    size: 'max-w-4xl',
    onOpen: (modalEl) => {
      const cancelBtn = modalEl.querySelector('#dis-modal-cancel');
      if (cancelBtn) cancelBtn.onclick = () => closeModal();

      const templateSelect = modalEl.querySelector('#dis-template-select');
      const whSelect = modalEl.querySelector('#dis-warehouse');
      const sourceVarSelect = modalEl.querySelector('#dis-source-var');
      const qtyInput = modalEl.querySelector('#dis-qty');
      const stockCountEl = modalEl.querySelector('#dis-stock-count');
      const itemCostEl = modalEl.querySelector('#dis-item-cost');
      const tableContainer = modalEl.querySelector('#recovered-items-table');
      const addRowBtn = modalEl.querySelector('#btn-add-recovered-row');
      const previewSourceCost = modalEl.querySelector('#dis-preview-source-cost');
      const previewRecoveredVal = modalEl.querySelector('#dis-preview-recovered-value');
      const previewVariance = modalEl.querySelector('#dis-preview-variance');
      const countBadge = modalEl.querySelector('#rec-items-count-badge');

      const addRecoveredRow = (varId = '', qty = 1, cost = 0, isChecked = true) => {
        const row = document.createElement('tr');
        row.className = 'rec-input-row hover:bg-slate-50/70 transition-colors group';
        row.innerHTML = `
          <td class="p-3 text-center">
            <input type="checkbox" ${isChecked ? 'checked' : ''} class="rec-check rounded text-rose-600 focus:ring-rose-500 cursor-pointer">
          </td>
          <td class="p-3">
            <select class="rec-var w-full text-xs font-semibold rounded-xl border border-slate-200 focus:border-rose-500 py-1.5 px-2 bg-white">
              ${variants.map(v => `<option value="${v.id}" ${v.id === varId ? 'selected' : ''}>${v.name} (${v.sku})</option>`).join('')}
            </select>
          </td>
          <td class="p-3 text-center">
            <input type="number" min="1" value="${qty}" class="rec-qty w-20 text-center text-xs font-bold rounded-xl border border-slate-200 focus:border-rose-500 py-1.5 px-2 bg-white">
          </td>
          <td class="p-3 text-right">
            <input type="number" min="0" value="${cost || 0}" class="rec-cost w-24 text-right text-xs font-medium rounded-xl border border-slate-200 focus:border-rose-500 py-1.5 px-2 bg-white">
          </td>
          <td class="p-3 text-right font-bold text-slate-800 rec-row-amount">
            Rs. ${(qty * (cost || 0)).toLocaleString()}
          </td>
          <td class="p-3 text-center">
            <button type="button" class="btn-remove-rec-row text-slate-300 hover:text-red-500 p-1 rounded-lg transition-colors cursor-pointer">
              <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                <path d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" stroke-linecap="round" stroke-linejoin="round"></path>
              </svg>
            </button>
          </td>
        `;

        row.querySelector('.btn-remove-rec-row').onclick = () => {
          row.remove();
          recalculate();
        };

        row.querySelector('.rec-check').onchange = recalculate;
        row.querySelector('.rec-qty').oninput = recalculate;
        row.querySelector('.rec-cost').oninput = recalculate;

        const sel = row.querySelector('.rec-var');
        sel.onchange = () => {
          const v = variants.find(x => x.id === sel.value);
          if (v && (!row.querySelector('.rec-cost').value || Number(row.querySelector('.rec-cost').value) === 0)) {
            row.querySelector('.rec-cost').value = v.costPrice || 0;
          }
          recalculate();
        };

        tableContainer.appendChild(row);
        recalculate();
      };

      addRowBtn.onclick = () => {
        addRecoveredRow(variants[0]?.id, 1, variants[0]?.costPrice || 0, true);
      };

      const recalculate = () => {
        const whId = whSelect.value;
        const srcVarId = sourceVarSelect.value;
        const disQty = Number(qtyInput.value) || 1;

        // Current stock of source item
        const avail = inventoryService.getBalance(whId, srcVarId);
        if (stockCountEl) stockCountEl.textContent = avail;

        const srcVar = variants.find(v => v.id === srcVarId);
        const unitCost = srcVar?.costPrice || 0;
        if (itemCostEl) itemCostEl.textContent = canViewCost ? `Rs. ${unitCost.toLocaleString()}` : '🔒 Redacted';

        const totalSourceCost = disQty * unitCost;
        if (previewSourceCost) previewSourceCost.textContent = canViewCost ? `Rs. ${Math.round(totalSourceCost).toLocaleString()}` : '🔒 Redacted';

        let totalRecVal = 0;
        const rows = tableContainer.querySelectorAll('.rec-input-row');
        if (countBadge) countBadge.textContent = `${rows.length} Items`;

        rows.forEach(r => {
          const isChecked = r.querySelector('.rec-check').checked;
          const q = Number(r.querySelector('.rec-qty').value) || 0;
          const c = Number(r.querySelector('.rec-cost').value) || 0;
          const sub = q * c;

          const amountCell = r.querySelector('.rec-row-amount');
          if (amountCell) amountCell.textContent = canViewCost ? `Rs. ${Math.round(sub).toLocaleString()}` : '🔒 Redacted';

          if (isChecked) {
            totalRecVal += sub;
          }
        });

        if (previewRecoveredVal) previewRecoveredVal.textContent = canViewCost ? `Rs. ${Math.round(totalRecVal).toLocaleString()}` : '🔒 Redacted';

        const variance = totalRecVal - totalSourceCost;
        if (previewVariance) {
          if (canViewCost) {
            previewVariance.textContent = `Rs. ${Math.round(variance).toLocaleString()}`;
            previewVariance.className = `text-2xl font-extrabold tracking-tight ${variance < 0 ? 'text-rose-600' : 'text-emerald-600'}`;
          } else {
            previewVariance.textContent = '🔒 Redacted';
          }
        }
      };

      // Template selection
      templateSelect.onchange = () => {
        const tId = templateSelect.value;
        if (!tId) return;
        const t = templates.find(x => x.id === tId);
        if (!t) return;

        sourceVarSelect.value = t.sourceVariantId;
        tableContainer.innerHTML = '';
        const srcVar = variants.find(v => v.id === t.sourceVariantId);
        const srcCost = srcVar?.costPrice || 0;

        (t.expectedComponents || []).forEach(c => {
          const compVar = variants.find(x => x.id === c.componentVariantId);
          const compCost = compVar?.costPrice || (srcCost * ((c.costAllocationPercentage || 0) / 100));
          addRecoveredRow(c.componentVariantId, c.defaultRecoveryRatio || 1, Math.round(compCost), true);
        });

        recalculate();
      };

      // Initial defaults
      if (templates.length > 0) {
        templateSelect.value = templates[0].id;
        templateSelect.dispatchEvent(new Event('change'));
      } else {
        addRecoveredRow(variants[0]?.id, 1, variants[0]?.costPrice || 0, true);
        recalculate();
      }

      whSelect.onchange = recalculate;
      sourceVarSelect.onchange = recalculate;
      qtyInput.oninput = recalculate;

      // Submit
      modalEl.querySelector('#new-disassembly-form').onsubmit = (e) => {
        e.preventDefault();
        const warehouseId = whSelect.value;
        const sourceVariantId = sourceVarSelect.value;
        const disassembledQuantity = Number(qtyInput.value) || 1;
        const disassemblyDate = modalEl.querySelector('#dis-date').value;
        const notes = modalEl.querySelector('#dis-notes').value.trim();

        const recoveredComponents = [];
        tableContainer.querySelectorAll('.rec-input-row').forEach(r => {
          const isChecked = r.querySelector('.rec-check').checked;
          if (isChecked) {
            const compVarId = r.querySelector('.rec-var').value;
            const quantityRecovered = Number(r.querySelector('.rec-qty').value) || 1;
            const unitCost = Number(r.querySelector('.rec-cost').value) || 0;
            recoveredComponents.push({
              componentVariantId: compVarId,
              quantityRecovered,
              unitCost,
              unit: 'PCS'
            });
          }
        });

        if (recoveredComponents.length === 0) {
          toast.show('Select at least one component to recover.', 'error');
          return;
        }

        try {
          const dis = assemblyService.createDisassemblyOrder({
            sourceVariantId,
            warehouseId,
            disassembledQuantity,
            disassemblyDate,
            recoveredComponents,
            notes,
            userId: authService.getCurrentUser()?.id || 'user-admin'
          });

          assemblyService.completeDisassembly(dis.id, authService.getCurrentUser()?.id || 'user-admin');
          toast.show(`Disassembly ${dis.disassemblyNumber} confirmed. Components recovered into stock.`, 'success');
          closeModal();
          if (onSaved) onSaved();
        } catch (err) {
          toast.show(err.message, 'error');
        }
      };
    }
  });
}

function handleReverseDisassemblyClick(row, onSaved) {
  confirmAction({
    title: `Reverse Disassembly: ${row.disassemblyNumber}`,
    message: `Are you sure you want to reverse this teardown? The disassembled item (${row.disassembledQuantity} units) will be returned to inventory, and all recovered components will be deducted.`,
    confirmLabel: 'Yes, Reverse Breakdown',
    isDestructive: true,
    onConfirm: () => {
      try {
        assemblyService.reverseDisassembly(row.id, authService.getCurrentUser()?.id || 'user-admin');
        toast.show(`Disassembly ${row.disassemblyNumber} reversed. Stock movements restored.`, 'success');
        if (onSaved) onSaved();
      } catch (err) {
        toast.show(err.message, 'error');
      }
    }
  });
}

// ============================================================================
// MODAL 3: RECORD LABOR PAYMENT
// ============================================================================

function openRecordLaborPaymentModal(selectedPartyId = null, onSaved) {
  const laborParties = assemblyService.getLaborParties();
  const accounts = accountingService.getChartOfAccounts();
  const paymentAccounts = accounts.filter(a => a.accountType === 'Asset' && (a.accountSubType === 'Cash' || a.accountSubType === 'Bank' || a.name.includes('Cash') || a.name.includes('Bank')));

  const contentHtml = `
    <form id="labor-payment-form" class="space-y-6 text-xs">
      <!-- SECTION 1: Workshop & Settlement Mode -->
      <section class="bg-white p-5 rounded-2xl border border-slate-200/90 shadow-2xs space-y-4">
        <div class="flex items-center justify-between border-b border-slate-100 pb-3">
          <h3 class="text-xs font-bold uppercase tracking-wider text-slate-500 flex items-center space-x-2">
            <svg class="w-3.5 h-3.5 text-emerald-600" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z"></path>
            </svg>
            <span>Workshop &amp; Settlement Strategy</span>
          </h3>
          <span class="text-[11px] text-slate-400">All fields marked with <span class="text-red-500">*</span> are required</span>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div class="space-y-1.5">
            <label class="text-xs font-semibold text-slate-700" for="pay-party-select">Assembly Labor Workshop / Party <span class="text-red-500">*</span></label>
            <select id="pay-party-select" required class="w-full text-xs font-bold rounded-xl border border-slate-200 focus:border-emerald-500 py-2.5 px-3 text-slate-800 bg-white shadow-2xs">
              ${laborParties.map(p => {
                const bal = assemblyService.getLaborPartyBalance(p.id);
                return `<option value="${p.id}" ${p.id === selectedPartyId ? 'selected' : ''}>${p.name} (Balance: Rs. ${bal.outstandingBalance.toLocaleString()})</option>`;
              }).join('')}
            </select>
          </div>
          <div class="space-y-1.5">
            <label class="text-xs font-semibold text-slate-700" for="pay-mode-select">Settlement Mode <span class="text-red-500">*</span></label>
            <select id="pay-mode-select" required class="w-full text-xs font-semibold rounded-xl border border-slate-200 focus:border-emerald-500 py-2.5 px-3 text-slate-800 bg-white shadow-2xs">
              <option value="FIFO_BALANCE">Option B: FIFO Lump-Sum Balance Settlement</option>
              <option value="SPECIFIC_ASSEMBLIES">Option A: Allocate to Specific Assemblies</option>
            </select>
          </div>
        </div>
      </section>

      <!-- SECTION 2: Financial Account & Payment Amount -->
      <section class="bg-white p-5 rounded-2xl border border-slate-200/90 shadow-2xs space-y-4">
        <div class="flex items-center justify-between border-b border-slate-100 pb-3">
          <h3 class="text-xs font-bold uppercase tracking-wider text-slate-500 flex items-center space-x-2">
            <svg class="w-3.5 h-3.5 text-emerald-600" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path>
            </svg>
            <span>Payment &amp; Financial Account Details</span>
          </h3>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div class="space-y-1.5">
            <label class="text-xs font-semibold text-slate-700" for="pay-date">Payment Date <span class="text-red-500">*</span></label>
            <input type="date" id="pay-date" required value="${new Date().toISOString().split('T')[0]}" class="w-full text-xs font-medium rounded-xl border border-slate-200 focus:border-emerald-500 py-2.5 px-3 text-slate-800 bg-white shadow-2xs">
          </div>
          <div class="space-y-1.5">
            <label class="text-xs font-semibold text-slate-700" for="pay-account">Paying Bank / Cash Account <span class="text-red-500">*</span></label>
            <select id="pay-account" required class="w-full text-xs font-semibold rounded-xl border border-slate-200 focus:border-emerald-500 py-2.5 px-3 text-slate-800 bg-white shadow-2xs">
              ${paymentAccounts.map(a => `<option value="${a.id}">${a.name} (${a.code || a.id})</option>`).join('')}
            </select>
          </div>
          <div class="space-y-1.5">
            <label class="text-xs font-semibold text-slate-700" for="pay-amount">Total Payment Amount (PKR) <span class="text-red-500">*</span></label>
            <input type="number" id="pay-amount" required min="1" value="0" class="w-full text-xs font-extrabold text-right rounded-xl border border-slate-200 focus:border-emerald-500 py-2.5 px-3 text-slate-900 bg-white shadow-2xs">
          </div>
        </div>
      </section>

      <!-- SECTION 3: Specific Assemblies Allocation -->
      <section id="specific-payables-container" class="hidden bg-white p-5 rounded-2xl border border-slate-200/90 shadow-2xs space-y-3">
        <h3 class="text-xs font-bold uppercase tracking-wider text-slate-500 pb-1 border-b border-slate-100">Unpaid Assembly Payables for this Workshop</h3>
        <div id="specific-payables-list" class="space-y-2 max-h-48 overflow-y-auto pr-1">
          <!-- Dynamic Unpaid Assemblies -->
        </div>
      </section>

      <!-- SECTION 4: Notes & Memo -->
      <section class="bg-white p-5 rounded-2xl border border-slate-200/90 shadow-2xs space-y-2">
        <label class="text-xs font-semibold text-slate-700" for="pay-notes">Payment Notes / Cheque # / Online Reference</label>
        <input type="text" id="pay-notes" placeholder="e.g. Cheque #49281 / Online IBFT transfer for weekly air cooler build" class="w-full text-xs rounded-xl border border-slate-200 focus:border-emerald-500 py-2.5 px-3 text-slate-800 bg-white shadow-2xs">
      </section>
    </form>
  `;

  const footerHtml = `
    <div class="flex items-center space-x-2 text-xs text-slate-400 font-medium">
      <svg class="w-4 h-4 text-emerald-500 shrink-0" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
        <path d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" stroke-linecap="round" stroke-linejoin="round"></path>
      </svg>
      <span>SSL 256-bit encrypted ERP transaction</span>
    </div>
    <div class="flex items-center space-x-3 w-full sm:w-auto justify-end">
      <button id="pay-modal-cancel" type="button" class="px-4 py-2 text-xs font-semibold text-slate-700 bg-white hover:bg-slate-50 border border-slate-300 rounded-xl transition-colors cursor-pointer shadow-2xs">
        Cancel
      </button>
      <button type="submit" form="labor-payment-form" class="inline-flex items-center space-x-2 px-5 py-2.5 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 rounded-xl shadow-sm transition-all active:scale-[0.98] cursor-pointer">
        <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"></path>
        </svg>
        <span>Post Labor Payment</span>
      </button>
    </div>
  `;

  openModal({
    title: 'Record Assembly Labor Payment',
    subtitle: 'Settle outstanding labor liabilities via specific assembly allocations or FIFO balance payment',
    badge: 'Labor Settlement',
    icon: '💰',
    contentHtml,
    footerHtml,
    size: 'max-w-3xl',
    onOpen: (modalEl) => {
      const cancelBtn = modalEl.querySelector('#pay-modal-cancel');
      if (cancelBtn) cancelBtn.onclick = () => closeModal();

      const partySelect = modalEl.querySelector('#pay-party-select');
      const modeSelect = modalEl.querySelector('#pay-mode-select');
      const amountInput = modalEl.querySelector('#pay-amount');
      const specificContainer = modalEl.querySelector('#specific-payables-container');
      const specificList = modalEl.querySelector('#specific-payables-list');

      const updatePartyPayables = () => {
        const partyId = partySelect.value;
        const payables = assemblyService.getLaborPayables().filter(p => p.laborPartyId === partyId && p.status !== 'Paid' && p.status !== 'Reversed');

        specificList.innerHTML = '';
        if (payables.length === 0) {
          specificList.innerHTML = '<div class="text-slate-400 p-2 text-center">No outstanding unpaid payables found for this workshop.</div>';
          return;
        }

        payables.forEach(p => {
          const item = document.createElement('div');
          item.className = 'flex items-center justify-between p-3 bg-slate-50 border border-slate-200 rounded-xl text-xs';
          item.innerHTML = `
            <div>
              <span class="font-bold text-[#138FCB]">${p.payableNumber}</span>
              <span class="text-slate-500 block text-[11px]">${p.assemblyNumber} • Date: ${p.date}</span>
            </div>
            <div class="flex items-center space-x-3">
              <span class="font-semibold text-slate-700">Due: Rs. ${(p.remainingBalance !== undefined ? p.remainingBalance : p.amount).toLocaleString()}</span>
              <input type="number" min="0" max="${p.remainingBalance || p.amount}" value="0" class="pay-alloc-input w-24 text-right border border-slate-300 rounded-lg px-2 py-1 font-bold" data-payable-id="${p.id}">
            </div>
          `;
          specificList.appendChild(item);
        });

        specificList.querySelectorAll('.pay-alloc-input').forEach(inp => {
          inp.oninput = () => {
            let sum = 0;
            specificList.querySelectorAll('.pay-alloc-input').forEach(i => sum += (Number(i.value) || 0));
            amountInput.value = sum;
          };
        });
      };

      modeSelect.onchange = () => {
        if (modeSelect.value === 'SPECIFIC_ASSEMBLIES') {
          specificContainer.classList.remove('hidden');
          updatePartyPayables();
        } else {
          specificContainer.classList.add('hidden');
        }
      };

      partySelect.onchange = () => {
        if (modeSelect.value === 'SPECIFIC_ASSEMBLIES') {
          updatePartyPayables();
        }
      };

      // Submit
      modalEl.querySelector('#labor-payment-form').onsubmit = (e) => {
        e.preventDefault();
        const laborPartyId = partySelect.value;
        const paymentMode = modeSelect.value;
        const totalAmount = Number(amountInput.value) || 0;
        const paymentDate = modalEl.querySelector('#pay-date').value;
        const paymentAccountId = modalEl.querySelector('#pay-account').value;
        const notes = modalEl.querySelector('#pay-notes').value.trim();

        if (totalAmount <= 0) {
          toast.show('Payment amount must be greater than zero.', 'error');
          return;
        }

        const allocations = [];
        if (paymentMode === 'SPECIFIC_ASSEMBLIES') {
          specificList.querySelectorAll('.pay-alloc-input').forEach(inp => {
            const allocAmt = Number(inp.value) || 0;
            if (allocAmt > 0) {
              allocations.push({
                payableId: inp.getAttribute('data-payable-id'),
                amount: allocAmt
              });
            }
          });
        }

        try {
          assemblyService.recordLaborPayment({
            laborPartyId,
            paymentMode,
            totalAmount,
            paymentDate,
            paymentAccountId,
            allocations,
            notes,
            userId: authService.getCurrentUser()?.id || 'user-admin'
          });

          toast.show(`Labor payment of Rs. ${totalAmount.toLocaleString()} recorded successfully.`, 'success');
          closeModal();
          if (onSaved) onSaved();
        } catch (err) {
          toast.show(err.message, 'error');
        }
      };
    }
  });
}

// ============================================================================
// MODAL 4: CREATE BOM RECIPE
// ============================================================================

function openNewRecipeModal(onSaved) {
  const variants = productService.getVariants();
  const laborParties = assemblyService.getLaborParties();
  const warehouses = warehouseService.getWarehouses();

  const contentHtml = `
    <form id="new-recipe-form" class="space-y-6 text-xs">
      <!-- SECTION 1: Recipe Identity & Finished Good -->
      <section class="bg-white p-5 rounded-2xl border border-slate-200/90 shadow-2xs space-y-4">
        <div class="flex items-center justify-between border-b border-slate-100 pb-3">
          <h3 class="text-xs font-bold uppercase tracking-wider text-slate-500 flex items-center space-x-2">
            <svg class="w-3.5 h-3.5 text-[#138FCB]" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"></path>
            </svg>
            <span>Recipe Details &amp; Target Product</span>
          </h3>
          <span class="text-[11px] text-slate-400">All fields marked with <span class="text-red-500">*</span> are required</span>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-12 gap-4">
          <div class="md:col-span-8 space-y-1.5">
            <label class="text-xs font-semibold text-slate-700" for="rec-name">Recipe Name <span class="text-red-500">*</span></label>
            <input type="text" id="rec-name" required placeholder="e.g. Air Cooler 18-Inch Standard Build" class="w-full text-xs font-bold rounded-xl border border-slate-200 focus:border-[#138FCB] py-2.5 px-3 text-slate-800 bg-white shadow-2xs">
          </div>
          <div class="md:col-span-4 space-y-1.5">
            <label class="text-xs font-semibold text-slate-700" for="rec-type">Assembly Type <span class="text-red-500">*</span></label>
            <select id="rec-type" class="w-full text-xs font-semibold rounded-xl border border-slate-200 focus:border-[#138FCB] py-2.5 px-3 text-slate-800 bg-white shadow-2xs">
              <option value="MANUFACTURING">Multi-Component Manufacturing</option>
              <option value="FINISHING">Single-Product Finishing</option>
            </select>
          </div>

          <div class="md:col-span-6 space-y-1.5">
            <label class="text-xs font-semibold text-slate-700" for="rec-target-var">Target Finished Product Variant <span class="text-red-500">*</span></label>
            <select id="rec-target-var" class="w-full text-xs font-bold rounded-xl border border-slate-200 focus:border-[#138FCB] py-2.5 px-3 text-slate-800 bg-white shadow-2xs">
              ${variants.map(v => `<option value="${v.id}">${v.name} (${v.sku})</option>`).join('')}
            </select>
          </div>
          <div class="md:col-span-3 space-y-1.5">
            <label class="text-xs font-semibold text-slate-700" for="rec-labor-rate">Default Labor Rate (PKR) <span class="text-red-500">*</span></label>
            <input type="number" id="rec-labor-rate" required min="0" value="500" class="w-full text-xs font-bold rounded-xl border border-slate-200 focus:border-[#138FCB] py-2.5 px-3 text-slate-800 bg-white shadow-2xs">
          </div>
          <div class="md:col-span-3 space-y-1.5">
            <label class="text-xs font-semibold text-slate-700" for="rec-labor-party">Default Workshop</label>
            <select id="rec-labor-party" class="w-full text-xs font-medium rounded-xl border border-slate-200 focus:border-[#138FCB] py-2.5 px-3 text-slate-800 bg-white shadow-2xs">
              ${laborParties.map(p => `<option value="${p.id}">${p.name}</option>`).join('')}
            </select>
          </div>
        </div>
      </section>

      <!-- SECTION 2: Bill of Materials Components -->
      <section class="bg-white p-5 rounded-2xl border border-slate-200/90 shadow-2xs space-y-4">
        <div class="flex items-center justify-between border-b border-slate-100 pb-3">
          <h3 class="text-xs font-bold uppercase tracking-wider text-slate-500">Recipe Raw Materials (Per 1 Output Unit)</h3>
          <button type="button" id="btn-add-rec-item" class="inline-flex items-center space-x-1.5 px-3.5 py-1.5 border border-dashed border-[#138FCB]/40 hover:border-[#138FCB] bg-blue-50/50 hover:bg-blue-50 text-[#138FCB] rounded-xl text-xs font-bold transition-all cursor-pointer">
            <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" d="M12 4v16m8-8H4"></path>
            </svg>
            <span>+ Add Component</span>
          </button>
        </div>

        <div class="overflow-x-auto border border-slate-200 rounded-xl">
          <table class="w-full text-left text-xs">
            <thead class="bg-slate-50 text-slate-500 uppercase text-[10px] tracking-wider border-b border-slate-200">
              <tr>
                <th class="py-3 px-3 w-8/12 font-semibold">Component Variant</th>
                <th class="py-3 px-3 w-3/12 font-semibold text-center">Quantity Per Unit</th>
                <th class="py-3 px-2 w-8 text-center font-semibold"></th>
              </tr>
            </thead>
            <tbody id="recipe-items-container" class="divide-y divide-slate-100 text-slate-700">
              <!-- Dynamic Rows -->
            </tbody>
          </table>
        </div>
      </section>
    </form>
  `;

  const footerHtml = `
    <div class="flex items-center space-x-2 text-xs text-slate-400 font-medium">
      <svg class="w-4 h-4 text-emerald-500 shrink-0" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
        <path d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" stroke-linecap="round" stroke-linejoin="round"></path>
      </svg>
      <span>SSL 256-bit encrypted ERP transaction</span>
    </div>
    <div class="flex items-center space-x-3 w-full sm:w-auto justify-end">
      <button id="rec-modal-cancel" type="button" class="px-4 py-2 text-xs font-semibold text-slate-700 bg-white hover:bg-slate-50 border border-slate-300 rounded-xl transition-colors cursor-pointer shadow-2xs">
        Cancel
      </button>
      <button type="submit" form="new-recipe-form" class="inline-flex items-center space-x-2 px-5 py-2.5 text-xs font-bold text-white bg-[#138FCB] hover:bg-[#0E78AC] rounded-xl shadow-sm transition-all active:scale-[0.98] cursor-pointer">
        <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"></path>
        </svg>
        <span>Save Assembly Recipe</span>
      </button>
    </div>
  `;

  openModal({
    title: 'Create Assembly BOM Recipe',
    subtitle: 'Defines formula of required components and standard assembly labor for reuse',
    badge: 'BOM Master',
    icon: '📋',
    contentHtml,
    footerHtml,
    size: 'max-w-3xl',
    onOpen: (modalEl) => {
      const cancelBtn = modalEl.querySelector('#rec-modal-cancel');
      if (cancelBtn) cancelBtn.onclick = () => closeModal();

      const container = modalEl.querySelector('#recipe-items-container');
      const addBtn = modalEl.querySelector('#btn-add-rec-item');

      const addItem = (varId = '', qty = 1) => {
        const item = document.createElement('tr');
        item.className = 'hover:bg-slate-50/70 transition-colors group';
        item.innerHTML = `
          <td class="p-3">
            <select class="rec-comp-var w-full text-xs font-semibold rounded-xl border border-slate-200 focus:border-[#138FCB] py-1.5 px-2 bg-white">
              ${variants.map(v => `<option value="${v.id}" ${v.id === varId ? 'selected' : ''}>${v.name} (${v.sku})</option>`).join('')}
            </select>
          </td>
          <td class="p-3 text-center">
            <input type="number" min="0.01" step="any" value="${qty}" class="rec-comp-qty w-24 text-center text-xs font-bold rounded-xl border border-slate-200 focus:border-[#138FCB] py-1.5 px-2 bg-white">
          </td>
          <td class="p-3 text-center">
            <button type="button" class="btn-remove-rec-item text-slate-300 hover:text-red-500 p-1 rounded-lg transition-colors cursor-pointer">
              <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                <path d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" stroke-linecap="round" stroke-linejoin="round"></path>
              </svg>
            </button>
          </td>
        `;
        item.querySelector('.btn-remove-rec-item').onclick = () => item.remove();
        container.appendChild(item);
      };

      addBtn.onclick = () => addItem(variants[0]?.id, 1);
      addItem(variants[0]?.id, 1);

      // Submit
      modalEl.querySelector('#new-recipe-form').onsubmit = (e) => {
        e.preventDefault();
        const name = modalEl.querySelector('#rec-name').value.trim();
        const assemblyType = modalEl.querySelector('#rec-type').value;
        const finishedVariantId = modalEl.querySelector('#rec-target-var').value;
        const defaultLaborRate = Number(modalEl.querySelector('#rec-labor-rate').value) || 0;
        const defaultLaborPartyId = modalEl.querySelector('#rec-labor-party')?.value || null;

        const components = [];
        container.querySelectorAll('tr').forEach(r => {
          const vId = r.querySelector('.rec-comp-var').value;
          const q = Number(r.querySelector('.rec-comp-qty').value) || 1;
          components.push({
            componentVariantId: vId,
            quantityPerUnit: q,
            unit: 'PCS'
          });
        });

        if (components.length === 0) {
          toast.show('Add at least one component to the recipe.', 'error');
          return;
        }

        try {
          assemblyService.createRecipe({
            name,
            assemblyType,
            finishedVariantId,
            defaultLaborRate,
            defaultLaborPartyId,
            components
          });

          toast.show(`Recipe "${name}" saved successfully.`, 'success');
          closeModal();
          if (onSaved) onSaved();
        } catch (err) {
          toast.show(err.message, 'error');
        }
      };
    }
  });
}

// ============================================================================
// MODAL 5: CREATE DISASSEMBLY TEMPLATE
// ============================================================================

function openNewDisassemblyTemplateModal(onSaved) {
  const variants = productService.getVariants();

  const contentHtml = `
    <form id="new-template-form" class="space-y-6 text-xs">
      <!-- SECTION 1: Template Info -->
      <section class="bg-white p-5 rounded-2xl border border-slate-200/90 shadow-2xs space-y-4">
        <div class="flex items-center justify-between border-b border-slate-100 pb-3">
          <h3 class="text-xs font-bold uppercase tracking-wider text-slate-500 flex items-center space-x-2">
            <svg class="w-3.5 h-3.5 text-slate-700" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"></path>
            </svg>
            <span>Teardown Template &amp; Source Good</span>
          </h3>
          <span class="text-[11px] text-slate-400">All fields marked with <span class="text-red-500">*</span> are required</span>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div class="space-y-1.5">
            <label class="text-xs font-semibold text-slate-700" for="tpl-name">Template Name <span class="text-red-500">*</span></label>
            <input type="text" id="tpl-name" required placeholder="e.g. Complete Fan Teardown Formula" class="w-full text-xs font-bold rounded-xl border border-slate-200 focus:border-slate-800 py-2.5 px-3 text-slate-800 bg-white shadow-2xs">
          </div>
          <div class="space-y-1.5">
            <label class="text-xs font-semibold text-slate-700" for="tpl-source-var">Source Item to Dismantle <span class="text-red-500">*</span></label>
            <select id="tpl-source-var" class="w-full text-xs font-bold rounded-xl border border-slate-200 focus:border-slate-800 py-2.5 px-3 text-slate-800 bg-white shadow-2xs">
              ${variants.map(v => `<option value="${v.id}">${v.name} (${v.sku})</option>`).join('')}
            </select>
          </div>
        </div>
      </section>

      <!-- SECTION 2: Expected Recoverable Components -->
      <section class="bg-white p-5 rounded-2xl border border-slate-200/90 shadow-2xs space-y-4">
        <div class="flex items-center justify-between border-b border-slate-100 pb-3">
          <h3 class="text-xs font-bold uppercase tracking-wider text-slate-500">Expected Recoverable Components</h3>
          <button type="button" id="btn-add-tpl-item" class="inline-flex items-center space-x-1.5 px-3.5 py-1.5 border border-dashed border-slate-300 hover:border-slate-600 bg-slate-50 text-slate-700 rounded-xl text-xs font-bold transition-all cursor-pointer">
            <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" d="M12 4v16m8-8H4"></path>
            </svg>
            <span>+ Add Component</span>
          </button>
        </div>

        <div class="overflow-x-auto border border-slate-200 rounded-xl">
          <table class="w-full text-left text-xs">
            <thead class="bg-slate-50 text-slate-500 uppercase text-[10px] tracking-wider border-b border-slate-200">
              <tr>
                <th class="py-3 px-3 w-6/12 font-semibold">Component Variant</th>
                <th class="py-3 px-2 w-3/12 font-semibold text-center">Recovery Ratio</th>
                <th class="py-3 px-3 w-3/12 font-semibold text-center">Cost Allocation %</th>
                <th class="py-3 px-2 w-8 text-center font-semibold"></th>
              </tr>
            </thead>
            <tbody id="tpl-items-container" class="divide-y divide-slate-100 text-slate-700">
              <!-- Dynamic Rows -->
            </tbody>
          </table>
        </div>
      </section>
    </form>
  `;

  const footerHtml = `
    <div class="flex items-center space-x-2 text-xs text-slate-400 font-medium">
      <svg class="w-4 h-4 text-emerald-500 shrink-0" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
        <path d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" stroke-linecap="round" stroke-linejoin="round"></path>
      </svg>
      <span>SSL 256-bit encrypted ERP transaction</span>
    </div>
    <div class="flex items-center space-x-3 w-full sm:w-auto justify-end">
      <button id="tpl-modal-cancel" type="button" class="px-4 py-2 text-xs font-semibold text-slate-700 bg-white hover:bg-slate-50 border border-slate-300 rounded-xl transition-colors cursor-pointer shadow-2xs">
        Cancel
      </button>
      <button type="submit" form="new-template-form" class="inline-flex items-center space-x-2 px-5 py-2.5 text-xs font-bold text-white bg-slate-800 hover:bg-slate-900 rounded-xl shadow-sm transition-all active:scale-[0.98] cursor-pointer">
        <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"></path>
        </svg>
        <span>Save Disassembly Template</span>
      </button>
    </div>
  `;

  openModal({
    title: 'Create Disassembly Template',
    subtitle: 'Standard teardown formula for breaking down items and distributing component cost allocations',
    badge: 'Teardown Master',
    icon: '🔄',
    contentHtml,
    footerHtml,
    size: 'max-w-3xl',
    onOpen: (modalEl) => {
      const cancelBtn = modalEl.querySelector('#tpl-modal-cancel');
      if (cancelBtn) cancelBtn.onclick = () => closeModal();

      const container = modalEl.querySelector('#tpl-items-container');
      const addBtn = modalEl.querySelector('#btn-add-tpl-item');

      const addItem = (varId = '', ratio = 1, alloc = 0) => {
        const item = document.createElement('tr');
        item.className = 'hover:bg-slate-50/70 transition-colors group';
        item.innerHTML = `
          <td class="p-3">
            <select class="tpl-comp-var w-full text-xs font-semibold rounded-xl border border-slate-200 focus:border-slate-800 py-1.5 px-2 bg-white">
              ${variants.map(v => `<option value="${v.id}" ${v.id === varId ? 'selected' : ''}>${v.name} (${v.sku})</option>`).join('')}
            </select>
          </td>
          <td class="p-3 text-center">
            <input type="number" min="0.01" step="any" value="${ratio}" class="tpl-comp-ratio w-24 text-center text-xs font-bold rounded-xl border border-slate-200 focus:border-slate-800 py-1.5 px-2 bg-white">
          </td>
          <td class="p-3 text-center">
            <input type="number" min="0" max="100" value="${alloc}" class="tpl-comp-alloc w-24 text-center text-xs font-bold rounded-xl border border-slate-200 focus:border-slate-800 py-1.5 px-2 bg-white">
          </td>
          <td class="p-3 text-center">
            <button type="button" class="btn-remove-tpl-item text-slate-300 hover:text-red-500 p-1 rounded-lg transition-colors cursor-pointer">
              <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                <path d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" stroke-linecap="round" stroke-linejoin="round"></path>
              </svg>
            </button>
          </td>
        `;
        item.querySelector('.btn-remove-tpl-item').onclick = () => item.remove();
        container.appendChild(item);
      };

      addBtn.onclick = () => addItem(variants[0]?.id, 1, 0);
      addItem(variants[0]?.id, 1, 50);

      modalEl.querySelector('#new-template-form').onsubmit = (e) => {
        e.preventDefault();
        const name = modalEl.querySelector('#tpl-name').value.trim();
        const sourceVariantId = modalEl.querySelector('#tpl-source-var').value;

        const expectedComponents = [];
        container.querySelectorAll('tr').forEach(r => {
          const vId = r.querySelector('.tpl-comp-var').value;
          const ratio = Number(r.querySelector('.tpl-comp-ratio').value) || 1;
          const alloc = Number(r.querySelector('.tpl-comp-alloc').value) || 0;
          expectedComponents.push({
            componentVariantId: vId,
            defaultRecoveryRatio: ratio,
            costAllocationPercentage: alloc
          });
        });

        if (expectedComponents.length === 0) {
          toast.show('Add at least one recoverable component.', 'error');
          return;
        }

        try {
          assemblyService.createDisassemblyTemplate({
            name,
            sourceVariantId,
            expectedComponents
          });

          toast.show(`Disassembly Template "${name}" saved.`, 'success');
          closeModal();
          if (onSaved) onSaved();
        } catch (err) {
          toast.show(err.message, 'error');
        }
      };
    }
  });
}

// ============================================================================
// MODAL 6: CREATE NEW BUNDLE / POULTRY SYSTEM
// ============================================================================

function openNewBundleModal(onSaved) {
  const variants = productService.getVariants();

  const contentHtml = `
    <form id="new-bundle-form" class="space-y-6 text-xs">
      <!-- SECTION 1: Identity & Type -->
      <section class="bg-white p-5 rounded-2xl border border-slate-200/90 shadow-2xs space-y-4">
        <div class="flex items-center justify-between border-b border-slate-100 pb-3">
          <h3 class="text-xs font-bold uppercase tracking-wider text-slate-500 flex items-center space-x-2">
            <svg class="w-3.5 h-3.5 text-purple-600" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" d="M11 4a2 2 0 114 0v1a1 1 0 001 1h3a1 1 0 011 1v3a1 1 0 01-1 1h-1a2 2 0 100 4h1a1 1 0 011 1v3a1 1 0 01-1 1h-3a1 1 0 01-1-1v-1a2 2 0 10-4 0v1a1 1 0 01-1 1H7a1 1 0 01-1-1v-3a1 1 0 00-1-1H4a2 2 0 110-4h1a1 1 0 001-1V7a1 1 0 011-1h3a1 1 0 001-1V4z"></path>
            </svg>
            <span>Bundle / System Configuration</span>
          </h3>
          <span class="text-[11px] text-slate-400">All fields marked with <span class="text-red-500">*</span> are required</span>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-12 gap-4">
          <div class="md:col-span-6 space-y-1.5">
            <label class="text-xs font-semibold text-slate-700" for="bnd-name">Bundle / System Name <span class="text-red-500">*</span></label>
            <input type="text" id="bnd-name" required placeholder="e.g. Automatic Broiler Feeding Line System" class="w-full text-xs font-bold rounded-xl border border-slate-200 focus:border-purple-600 py-2.5 px-3 text-slate-800 bg-white shadow-2xs">
          </div>
          <div class="md:col-span-3 space-y-1.5">
            <label class="text-xs font-semibold text-slate-700" for="bnd-type">Bundle Type <span class="text-red-500">*</span></label>
            <select id="bnd-type" class="w-full text-xs font-bold rounded-xl border border-slate-200 focus:border-purple-600 py-2.5 px-3 text-slate-800 bg-white shadow-2xs">
              <option value="VARIABLE_SYSTEM">Variable Proportional System</option>
              <option value="FIXED_SET">Fixed Direct Set</option>
            </select>
          </div>
          <div class="md:col-span-3 space-y-1.5">
            <label class="text-xs font-semibold text-slate-700" for="bnd-code">System Code</label>
            <input type="text" id="bnd-code" placeholder="e.g. SYS-FEED" class="w-full text-xs font-semibold rounded-xl border border-slate-200 focus:border-purple-600 py-2.5 px-3 text-slate-800 bg-white shadow-2xs">
          </div>

          <div class="md:col-span-6 space-y-1.5">
            <label class="text-xs font-semibold text-slate-700" for="bnd-unit">Commercial Order Unit <span class="text-red-500">*</span></label>
            <input type="text" id="bnd-unit" value="Line" placeholder="e.g. Line, Shed, Set, System" class="w-full text-xs font-semibold rounded-xl border border-slate-200 focus:border-purple-600 py-2.5 px-3 text-slate-800 bg-white shadow-2xs">
          </div>
          <div class="md:col-span-6 space-y-1.5">
            <label class="text-xs font-semibold text-slate-700" for="bnd-price">Standard Unit Price (PKR)</label>
            <input type="number" id="bnd-price" min="0" value="75000" class="w-full text-xs font-bold rounded-xl border border-slate-200 focus:border-purple-600 py-2.5 px-3 text-slate-800 bg-white shadow-2xs">
          </div>
        </div>
      </section>

      <!-- SECTION 2: Formulas & Components -->
      <section class="bg-white p-5 rounded-2xl border border-slate-200/90 shadow-2xs space-y-4">
        <div class="flex items-center justify-between border-b border-slate-100 pb-3">
          <div class="flex items-center space-x-2">
            <h3 class="text-xs font-bold uppercase tracking-wider text-slate-500">Component Formulas &amp; Expansion Rules</h3>
            <span class="text-[11px] text-slate-400">Decoupled from Product Master</span>
          </div>
          <button type="button" id="btn-add-bnd-item" class="inline-flex items-center space-x-1.5 px-3.5 py-1.5 border border-dashed border-purple-300 hover:border-purple-600 bg-purple-50 text-purple-700 rounded-xl text-xs font-bold transition-all cursor-pointer">
            <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" d="M12 4v16m8-8H4"></path>
            </svg>
            <span>+ Add Component Rule</span>
          </button>
        </div>

        <div class="overflow-x-auto border border-slate-200 rounded-xl">
          <table class="w-full text-left text-xs">
            <thead class="bg-slate-50 text-slate-500 uppercase text-[10px] tracking-wider border-b border-slate-200">
              <tr>
                <th class="py-3 px-3 w-5/12 font-semibold">Physical Component Item</th>
                <th class="py-3 px-3 w-3/12 font-semibold">Rule Type</th>
                <th class="py-3 px-2 w-2/12 font-semibold text-center">Multiplier / Factor</th>
                <th class="py-3 px-2 w-2/12 font-semibold text-center">Group Size</th>
                <th class="py-3 px-2 w-8 text-center font-semibold"></th>
              </tr>
            </thead>
            <tbody id="bundle-items-container" class="divide-y divide-slate-100 text-slate-700">
              <!-- Dynamic Rows -->
            </tbody>
          </table>
        </div>
      </section>

      <!-- SECTION 3: Memo -->
      <section class="bg-white p-5 rounded-2xl border border-slate-200/90 shadow-2xs space-y-2">
        <label class="text-xs font-semibold text-slate-700" for="bnd-desc">System Description / Application</label>
        <textarea id="bnd-desc" class="w-full text-xs rounded-xl border border-slate-200 focus:border-purple-600 text-slate-700 p-2.5 resize-none" rows="2" placeholder="e.g. Complete commercial feeding system package for poultry sheds with automated suspension."></textarea>
      </section>
    </form>
  `;

  const footerHtml = `
    <div class="flex items-center space-x-2 text-xs text-slate-400 font-medium">
      <svg class="w-4 h-4 text-emerald-500 shrink-0" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
        <path d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" stroke-linecap="round" stroke-linejoin="round"></path>
      </svg>
      <span>SSL 256-bit encrypted ERP transaction</span>
    </div>
    <div class="flex items-center space-x-3 w-full sm:w-auto justify-end">
      <button id="bnd-modal-cancel" type="button" class="px-4 py-2 text-xs font-semibold text-slate-700 bg-white hover:bg-slate-50 border border-slate-300 rounded-xl transition-colors cursor-pointer shadow-2xs">
        Cancel
      </button>
      <button type="submit" form="new-bundle-form" class="inline-flex items-center space-x-2 px-5 py-2.5 text-xs font-bold text-white bg-purple-600 hover:bg-purple-700 rounded-xl shadow-sm transition-all active:scale-[0.98] cursor-pointer">
        <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"></path>
        </svg>
        <span>Save Bundle / System</span>
      </button>
    </div>
  `;

  openModal({
    title: 'Create Predefined Bundle / Poultry System',
    subtitle: 'Decoupled system architecture: Configure proportional and group math formulas without altering Product Master',
    badge: 'System Builder',
    icon: '🧩',
    contentHtml,
    footerHtml,
    size: 'max-w-4xl',
    onOpen: (modalEl) => {
      const cancelBtn = modalEl.querySelector('#bnd-modal-cancel');
      if (cancelBtn) cancelBtn.onclick = () => closeModal();

      const container = modalEl.querySelector('#bundle-items-container');
      const addBtn = modalEl.querySelector('#btn-add-bnd-item');

      const addItem = (varId = '', rule = 'PER_LINE', factor = 1, group = 5) => {
        const item = document.createElement('tr');
        item.className = 'hover:bg-slate-50/70 transition-colors group';
        item.innerHTML = `
          <td class="p-3">
            <select class="bnd-comp-var w-full text-xs font-semibold rounded-xl border border-slate-200 focus:border-purple-600 py-1.5 px-2 bg-white">
              ${variants.map(v => `<option value="${v.id}" ${v.id === varId ? 'selected' : ''}>${v.name} (${v.sku})</option>`).join('')}
            </select>
          </td>
          <td class="p-3">
            <select class="bnd-comp-rule w-full text-xs font-semibold rounded-xl border border-slate-200 focus:border-purple-600 py-1.5 px-2 bg-white">
              <option value="PER_LINE" ${rule === 'PER_LINE' ? 'selected' : ''}>PER_LINE (Proportional)</option>
              <option value="PER_GROUP_CEIL" ${rule === 'PER_GROUP_CEIL' ? 'selected' : ''}>PER_GROUP_CEIL (Ceiling)</option>
              <option value="FIXED_QTY" ${rule === 'FIXED_QTY' ? 'selected' : ''}>FIXED_QTY (Constant)</option>
            </select>
          </td>
          <td class="p-3 text-center">
            <input type="number" min="0.01" step="any" value="${factor}" class="bnd-comp-factor w-20 text-center text-xs font-bold rounded-xl border border-slate-200 focus:border-purple-600 py-1.5 px-2 bg-white">
          </td>
          <td class="p-3 text-center">
            <input type="number" min="1" value="${group}" class="bnd-comp-group w-20 text-center text-xs font-bold rounded-xl border border-slate-200 focus:border-purple-600 py-1.5 px-2 bg-white">
          </td>
          <td class="p-3 text-center">
            <button type="button" class="btn-remove-bnd-item text-slate-300 hover:text-red-500 p-1 rounded-lg transition-colors cursor-pointer">
              <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                <path d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" stroke-linecap="round" stroke-linejoin="round"></path>
              </svg>
            </button>
          </td>
        `;
        item.querySelector('.btn-remove-bnd-item').onclick = () => item.remove();
        container.appendChild(item);
      };

      addBtn.onclick = () => addItem(variants[0]?.id, 'PER_LINE', 1, 5);
      addItem(variants[0]?.id, 'PER_LINE', 40, 5);

      modalEl.querySelector('#new-bundle-form').onsubmit = (e) => {
        e.preventDefault();
        const name = modalEl.querySelector('#bnd-name').value.trim();
        const code = modalEl.querySelector('#bnd-code').value.trim();
        const bundleType = modalEl.querySelector('#bnd-type').value;
        const baseUnit = modalEl.querySelector('#bnd-unit').value.trim() || 'Line';
        const sellingPrice = Number(modalEl.querySelector('#bnd-price').value) || 0;
        const description = modalEl.querySelector('#bnd-desc').value.trim();

        const components = [];
        container.querySelectorAll('tr').forEach(r => {
          const vId = r.querySelector('.bnd-comp-var').value;
          const rule = r.querySelector('.bnd-comp-rule').value;
          const factor = Number(r.querySelector('.bnd-comp-factor').value) || 1;
          const group = Number(r.querySelector('.bnd-comp-group').value) || 5;

          const params = {};
          if (rule === 'PER_LINE') params.quantityPerLine = factor;
          else if (rule === 'FIXED_QTY') params.fixedQuantity = factor;
          else if (rule === 'PER_GROUP_CEIL') {
            params.quantityPerGroup = factor;
            params.linesPerGroup = group;
          }

          components.push({
            componentVariantId: vId,
            quantityRule: rule,
            ruleType: rule,
            baseFactor: factor,
            groupSize: group,
            parameters: params,
            unit: 'PCS'
          });
        });

        if (components.length === 0) {
          toast.show('Add at least one component rule to the system.', 'error');
          return;
        }

        try {
          bundleService.createBundle({
            name,
            code,
            bundleType,
            baseUnit,
            sellingPrice,
            description,
            components
          });

          toast.show(`Bundle / System "${name}" created.`, 'success');
          closeModal();
          if (onSaved) onSaved();
        } catch (err) {
          toast.show(err.message, 'error');
        }
      };
    }
  });
}

// ============================================================================
// MODAL 7: SIMULATE BUNDLE / LIVE FORMULA TESTER
// ============================================================================

function openSimulateBundleModal(bundleId) {
  const bundle = bundleService.getBundleById(bundleId);
  if (!bundle) {
    toast.show('Bundle definition not found.', 'error');
    return;
  }
  const variants = productService.getVariants();
  const varMap = new Map(variants.map(v => [v.id, v]));
  const warehouses = warehouseService.getWarehouses();
  const activeWh = warehouses[0]?.id || 'wh-1';

  const contentHtml = `
    <div class="space-y-6 text-xs">
      <!-- SECTION 1: System Parameters -->
      <section class="bg-white p-5 rounded-2xl border border-slate-200/90 shadow-2xs space-y-4">
        <div class="flex items-center justify-between border-b border-slate-100 pb-3">
          <h3 class="text-xs font-bold uppercase tracking-wider text-slate-500 flex items-center space-x-2">
            <svg class="w-3.5 h-3.5 text-[#138FCB]" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z"></path>
            </svg>
            <span>System Parameters &amp; Quantity Input</span>
          </h3>
          <span class="px-2.5 py-0.5 rounded-full text-[10px] font-bold ${bundle.bundleType === 'VARIABLE_SYSTEM' ? 'bg-purple-100 text-purple-700' : 'bg-blue-100 text-blue-700'}">
            ${bundle.bundleType}
          </span>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-12 gap-4 items-center">
          <div class="md:col-span-6 space-y-1">
            <span class="text-slate-400 text-[11px] block">Selected System</span>
            <h4 class="text-sm font-extrabold text-slate-900">${bundle.name}</h4>
            <p class="text-slate-500 text-xs">${bundle.description || 'Predefined system package'}</p>
          </div>
          <div class="md:col-span-3 space-y-1.5">
            <label class="text-xs font-semibold text-slate-700 block" for="sim-input-qty">Order Qty (${bundle.baseUnit || 'Lines'})</label>
            <input type="number" id="sim-input-qty" min="1" value="10" class="w-full text-sm font-bold text-center rounded-xl border border-slate-300 focus:border-[#138FCB] py-2 px-3 text-slate-900 bg-white shadow-2xs">
          </div>
          <div class="md:col-span-3 space-y-1.5">
            <label class="text-xs font-semibold text-slate-700 block" for="sim-wh-select">Warehouse Stock Check</label>
            <select id="sim-wh-select" class="w-full text-xs font-semibold rounded-xl border border-slate-300 focus:border-[#138FCB] py-2 px-3 text-slate-800 bg-white shadow-2xs">
              ${warehouses.map(w => `<option value="${w.id}">${w.name}</option>`).join('')}
            </select>
          </div>
        </div>
      </section>

      <!-- SECTION 2: Dynamic Calculated Components -->
      <section class="bg-white p-5 rounded-2xl border border-slate-200/90 shadow-2xs space-y-4">
        <div class="flex items-center justify-between border-b border-slate-100 pb-3">
          <div class="flex items-center space-x-2">
            <h3 class="text-xs font-bold uppercase tracking-wider text-slate-500">Calculated Physical Pick &amp; Gatepass List</h3>
            <span id="sim-components-count" class="px-2 py-0.5 text-[10px] font-semibold rounded-full bg-slate-100 text-slate-600">Components</span>
          </div>
          <span class="text-[11px] text-slate-400">Formula math evaluated in real-time</span>
        </div>

        <div class="overflow-x-auto border border-slate-200 rounded-xl">
          <table class="w-full text-left text-xs">
            <thead class="bg-slate-50 text-slate-500 uppercase text-[10px] tracking-wider border-b border-slate-200">
              <tr>
                <th class="py-3 px-3 w-5/12 font-semibold">Physical Component Item</th>
                <th class="py-3 px-3 w-3/12 font-semibold">Formula / Math Rule</th>
                <th class="py-3 px-2 w-2/12 font-semibold text-center">Calculated Qty</th>
                <th class="py-3 px-2 w-2/12 font-semibold text-center">Warehouse Stock</th>
              </tr>
            </thead>
            <tbody id="sim-results-table" class="divide-y divide-slate-100 text-slate-700">
              <!-- Rendered dynamically -->
            </tbody>
          </table>
        </div>
      </section>
    </div>
  `;

  const footerHtml = `
    <div class="flex items-center space-x-2 text-xs text-slate-400 font-medium">
      <svg class="w-4 h-4 text-emerald-500 shrink-0" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
        <path d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" stroke-linecap="round" stroke-linejoin="round"></path>
      </svg>
      <span>Live decoupled formula calculation</span>
    </div>
    <div class="flex items-center space-x-3 w-full sm:w-auto justify-end">
      <button id="sim-close-btn" type="button" class="px-4 py-2 text-xs font-semibold text-slate-700 bg-white hover:bg-slate-50 border border-slate-300 rounded-xl transition-colors cursor-pointer shadow-2xs">
        Close Simulator
      </button>
    </div>
  `;

  openModal({
    title: `Simulate System: ${bundle.name}`,
    subtitle: 'Interactive test calculator: Enter commercial system units or lines to view dynamic physical item expansion',
    badge: bundle.bundleCode || bundle.code || 'Simulator',
    icon: '⚡',
    contentHtml,
    footerHtml,
    size: 'max-w-4xl',
    onOpen: (modalEl) => {
      const closeBtn = modalEl.querySelector('#sim-close-btn');
      if (closeBtn) closeBtn.onclick = () => closeModal();

      const qtyInput = modalEl.querySelector('#sim-input-qty');
      const whSelect = modalEl.querySelector('#sim-wh-select');
      const tbody = modalEl.querySelector('#sim-results-table');
      const countEl = modalEl.querySelector('#sim-components-count');

      const recompute = () => {
        const lines = Number(qtyInput.value) || 1;
        const whId = whSelect.value;
        const calc = bundleService.calculateBundleComponents(bundle.id, lines);

        countEl.textContent = `${calc.components.length} Physical Components`;
        tbody.innerHTML = calc.components.map(c => {
          const avail = inventoryService.getBalance(whId, c.componentVariantId);
          const hasEnough = avail >= c.finalQty;

          return `
            <tr class="hover:bg-slate-50/70 transition-colors">
              <td class="p-3">
                <div class="font-bold text-slate-800">${c.variantName}</div>
                <div class="text-[10px] text-slate-400 font-mono">${c.sku}</div>
              </td>
              <td class="p-3">
                <span class="text-[11px] font-mono text-purple-700 bg-purple-50 border border-purple-200/50 px-2 py-0.5 rounded font-bold">
                  ${c.calculationText || c.quantityRule}
                </span>
              </td>
              <td class="p-3 text-center font-extrabold text-slate-900 text-sm">
                ${c.finalQty} ${c.unit}
              </td>
              <td class="p-3 text-center">
                <span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-bold ${hasEnough ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-rose-50 text-rose-700 border border-rose-200'}">
                  ${avail} in stock ${hasEnough ? '✅' : '⚠️ Shortfall'}
                </span>
              </td>
            </tr>
          `;
        }).join('');
      };

      qtyInput.oninput = recompute;
      whSelect.onchange = recompute;
      recompute();
    }
  });
}

// ============================================================================
// MODAL 8, 9, 10: DETAIL VIEW MODALS (BUNDLE, RECIPE, TEMPLATE)
// ============================================================================

function openBundleDetailModal(bundleId) {
  const bundle = bundleService.getBundleById(bundleId);
  if (!bundle) return;
  const variants = productService.getVariants();
  const varMap = new Map(variants.map(v => [v.id, v]));

  const contentHtml = `
    <div class="space-y-6 text-xs">
      <section class="bg-white p-5 rounded-2xl border border-slate-200/90 shadow-2xs space-y-3">
        <div class="flex items-center justify-between border-b border-slate-100 pb-3">
          <div>
            <span class="text-[11px] font-bold text-[#138FCB] font-mono">${bundle.bundleCode || bundle.code}</span>
            <h4 class="text-base font-extrabold text-slate-900">${bundle.name}</h4>
          </div>
          <span class="px-2.5 py-1 rounded-full text-xs font-bold ${bundle.bundleType === 'VARIABLE_SYSTEM' ? 'bg-purple-50 text-purple-700 border border-purple-200' : 'bg-blue-50 text-blue-700 border border-blue-200'}">
            ${bundle.bundleType}
          </span>
        </div>
        <p class="text-slate-600">${bundle.description || 'No description provided'}</p>
        <div class="flex items-center gap-4 text-slate-500 pt-2 border-t border-slate-100">
          <span>Base Unit: <strong class="text-slate-800">${bundle.baseUnit || 'Line'}</strong></span>
          <span>Selling Price: <strong class="text-slate-800">Rs. ${(bundle.sellingPrice || 0).toLocaleString()}</strong></span>
        </div>
      </section>

      <section class="bg-white p-5 rounded-2xl border border-slate-200/90 shadow-2xs space-y-3">
        <h4 class="text-xs font-bold uppercase tracking-wider text-slate-500 pb-1 border-b border-slate-100">Component Formulas</h4>
        <div class="space-y-2">
          ${(bundle.components || []).map(c => `
            <div class="p-3 bg-slate-50 rounded-xl border border-slate-200/60 flex items-center justify-between">
              <div>
                <span class="font-bold text-slate-800">• ${varMap.get(c.componentVariantId)?.name || c.componentVariantId}</span>
                <span class="text-slate-400 block text-[10px]">Rule: ${c.ruleType || c.quantityRule}</span>
              </div>
              <span class="text-xs font-mono font-bold text-purple-700 bg-purple-50 border border-purple-200 px-2.5 py-1 rounded-lg">
                ${c.ruleType === 'PER_LINE' || c.quantityRule === 'PER_LINE' ? `${c.baseFactor || c.parameters?.quantityPerLine || 1} / line` :
                  c.ruleType === 'PER_GROUP_CEIL' || c.quantityRule === 'PER_GROUP_CEIL' ? `1 per ${c.groupSize || c.parameters?.linesPerGroup || 5} lines (ceil)` :
                  c.ruleType === 'FIXED_QTY' || c.quantityRule === 'FIXED_QTY' ? `Fixed ${c.baseFactor || c.parameters?.fixedQuantity || 1}` : 'Custom'}
              </span>
            </div>
          `).join('')}
        </div>
      </section>
    </div>
  `;

  openModal({
    title: `System Specs: ${bundle.name}`,
    subtitle: 'Component calculation rules and packaging metadata',
    badge: bundle.bundleCode || bundle.code,
    icon: '🧩',
    contentHtml,
    size: 'max-w-2xl'
  });
}

function openRecipeDetailModal(recipeId) {
  const recipe = assemblyService.getRecipeById(recipeId);
  if (!recipe) return;
  const variants = productService.getVariants();
  const varMap = new Map(variants.map(v => [v.id, v]));

  const contentHtml = `
    <div class="space-y-6 text-xs">
      <section class="bg-white p-5 rounded-2xl border border-slate-200/90 shadow-2xs space-y-3">
        <div class="flex items-center justify-between border-b border-slate-100 pb-3">
          <div>
            <span class="text-[11px] font-bold text-[#138FCB] font-mono">${recipe.recipeNumber || 'REC'}</span>
            <h4 class="text-base font-extrabold text-slate-900">${recipe.name}</h4>
          </div>
          <span class="px-2.5 py-1 rounded-full text-xs font-bold ${recipe.assemblyType === 'FINISHING' ? 'bg-purple-50 text-purple-700 border border-purple-200' : 'bg-blue-50 text-blue-700 border border-blue-200'}">
            ${recipe.assemblyType}
          </span>
        </div>
        <div class="text-slate-600">Produces: <strong class="text-slate-900">${varMap.get(recipe.finishedVariantId)?.name || 'Finished Product'}</strong></div>
        <div class="text-slate-600">Standard Labor Rate: <strong class="text-slate-900">Rs. ${(recipe.defaultLaborRate || 0).toLocaleString()}</strong></div>
      </section>

      <section class="bg-white p-5 rounded-2xl border border-slate-200/90 shadow-2xs space-y-3">
        <h4 class="text-xs font-bold uppercase tracking-wider text-slate-500 pb-1 border-b border-slate-100">Bill of Materials</h4>
        <div class="space-y-2">
          ${(recipe.components || []).map(c => `
            <div class="p-3 bg-slate-50 rounded-xl border border-slate-200/60 flex items-center justify-between">
              <span class="font-bold text-slate-800">• ${varMap.get(c.componentVariantId)?.name || c.componentVariantId}</span>
              <span class="font-bold text-slate-900">${c.quantityPerUnit} ${c.unit || 'PCS'}</span>
            </div>
          `).join('')}
        </div>
      </section>
    </div>
  `;

  openModal({
    title: `BOM Recipe: ${recipe.name}`,
    subtitle: 'Standard bill of materials and component formula',
    badge: recipe.recipeNumber || 'BOM',
    icon: '📋',
    contentHtml,
    size: 'max-w-2xl'
  });
}

function openDisassemblyTemplateDetailModal(templateId) {
  const t = assemblyService.getDisassemblyTemplateById(templateId);
  if (!t) return;
  const variants = productService.getVariants();
  const varMap = new Map(variants.map(v => [v.id, v]));

  const contentHtml = `
    <div class="space-y-6 text-xs">
      <section class="bg-white p-5 rounded-2xl border border-slate-200/90 shadow-2xs space-y-3">
        <h4 class="text-base font-extrabold text-slate-900">${t.name}</h4>
        <div class="text-slate-600">Dismantles: <strong class="text-slate-900">${varMap.get(t.sourceVariantId)?.name || 'Source Item'}</strong></div>
      </section>

      <section class="bg-white p-5 rounded-2xl border border-slate-200/90 shadow-2xs space-y-3">
        <h4 class="text-xs font-bold uppercase tracking-wider text-slate-500 pb-1 border-b border-slate-100">Expected Recoverable Components</h4>
        <div class="space-y-2">
          ${(t.expectedComponents || []).map(c => `
            <div class="p-3 bg-slate-50 rounded-xl border border-slate-200/60 flex items-center justify-between">
              <span class="font-bold text-slate-800">• ${varMap.get(c.componentVariantId)?.name || c.componentVariantId}</span>
              <span class="font-bold text-slate-900">${c.defaultRecoveryRatio}x (Cost Split: ${c.costAllocationPercentage || 0}%)</span>
            </div>
          `).join('')}
        </div>
      </section>
    </div>
  `;

  openModal({
    title: `Teardown Template: ${t.name}`,
    subtitle: 'Default component recovery ratios and cost allocation splits',
    badge: 'Template',
    icon: '🔄',
    contentHtml,
    size: 'max-w-2xl'
  });
}

// ============================================================================
// PRINT / PDF VOUCHER MODALS
// ============================================================================

function handlePrintAssemblyVoucher(assembly, varMap, whMap, partyMap) {
  const contentHtml = `
    <div class="p-6 bg-white border border-slate-200 rounded-2xl space-y-5 text-xs text-slate-800">
      <div class="flex justify-between items-start border-b border-slate-200 pb-4">
        <div>
          <h2 class="text-lg font-black text-slate-900">JS TRADERS — PRODUCTION VOUCHER</h2>
          <p class="text-slate-500 text-xs">BOM Manufacturing &amp; Labor Payable Completion Slip</p>
        </div>
        <div class="text-right">
          <span class="text-base font-extrabold text-[#138FCB] block">${assembly.assemblyNumber}</span>
          <span class="text-slate-500 text-xs">Date: ${assembly.date}</span>
        </div>
      </div>

      <div class="grid grid-cols-2 gap-4 bg-slate-50 p-3.5 rounded-xl border border-slate-200">
        <div>
          <span class="text-slate-500 block">Target Finished Product:</span>
          <strong class="text-sm text-slate-900">${varMap.get(assembly.finishedVariantId) || 'Finished Good'}</strong>
        </div>
        <div class="text-right">
          <span class="text-slate-500 block">Quantity Produced:</span>
          <strong class="text-sm text-emerald-600">${assembly.finishedQuantity} Units</strong>
        </div>
        <div>
          <span class="text-slate-500 block">Source Warehouse:</span>
          <strong>${whMap.get(assembly.sourceWarehouseId) || assembly.sourceWarehouseId}</strong>
        </div>
        <div class="text-right">
          <span class="text-slate-500 block">Output Warehouse:</span>
          <strong>${whMap.get(assembly.outputWarehouseId) || assembly.outputWarehouseId}</strong>
        </div>
      </div>

      <div class="space-y-2">
        <span class="font-bold text-slate-700 uppercase tracking-wider block">Raw Materials Consumed</span>
        <table class="w-full border-collapse border border-slate-200">
          <thead class="bg-slate-100 font-bold text-slate-700">
            <tr>
              <th class="border border-slate-200 p-2 text-left">Component</th>
              <th class="border border-slate-200 p-2 text-center">Qty Consumed</th>
              <th class="border border-slate-200 p-2 text-right">Unit Cost</th>
              <th class="border border-slate-200 p-2 text-right">Amount</th>
            </tr>
          </thead>
          <tbody>
            ${(assembly.lines || []).map(l => `
              <tr>
                <td class="border border-slate-200 p-2">${varMap.get(l.componentVariantId) || 'Component'}</td>
                <td class="border border-slate-200 p-2 text-center font-bold">${l.quantityConsumed} ${l.unit || 'PCS'}</td>
                <td class="border border-slate-200 p-2 text-right">Rs. ${(l.unitCost || 0).toLocaleString()}</td>
                <td class="border border-slate-200 p-2 text-right font-bold">Rs. ${((l.quantityConsumed || 0) * (l.unitCost || 0)).toLocaleString()}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>

      <div class="border-t border-slate-200 pt-3 flex justify-end">
        <div class="w-64 space-y-1.5 text-right">
          <div class="flex justify-between text-slate-600">
            <span>Material Cost:</span>
            <span class="font-bold">Rs. ${Number(assembly.totalMaterialCost || 0).toLocaleString()}</span>
          </div>
          <div class="flex justify-between text-slate-600">
            <span>Assembly Labor:</span>
            <span class="font-bold">Rs. ${Number(assembly.totalLaborCost || 0).toLocaleString()}</span>
          </div>
          <div class="flex justify-between font-black text-sm pt-1 border-t border-slate-300">
            <span>Total Production Cost:</span>
            <span class="text-[#138FCB]">Rs. ${Number(assembly.totalCost || 0).toLocaleString()}</span>
          </div>
          <div class="flex justify-between font-black text-sm text-emerald-600">
            <span>Finished Unit Cost:</span>
            <span>Rs. ${Math.round(assembly.unitCost || 0).toLocaleString()}</span>
          </div>
        </div>
      </div>
    </div>
  `;

  openModal({
    title: `Assembly Voucher: ${assembly.assemblyNumber}`,
    subtitle: 'Official production authorization and stock movement document',
    badge: assembly.assemblyNumber,
    icon: '🖨️',
    contentHtml,
    size: 'max-w-3xl',
    footerHtml: `
      <div class="flex items-center justify-between w-full">
        <button id="asm-close-btn" class="px-4 py-2 text-xs font-semibold text-slate-600 bg-slate-100 rounded-xl cursor-pointer">Close</button>
        <button onclick="window.print()" class="px-5 py-2 text-xs font-bold text-white bg-[#138FCB] rounded-xl shadow-xs cursor-pointer">
          🖨 Print / Save PDF
        </button>
      </div>
    `,
    onOpen: (modalEl) => {
      modalEl.querySelector('#asm-close-btn').onclick = () => closeModal();
    }
  });
}

function handlePrintDisassemblyVoucher(disassembly, varMap, whMap) {
  const contentHtml = `
    <div class="p-6 bg-white border border-slate-200 rounded-2xl space-y-5 text-xs text-slate-800">
      <div class="flex justify-between items-start border-b border-slate-200 pb-4">
        <div>
          <h2 class="text-lg font-black text-slate-900">JS TRADERS — DISASSEMBLY VOUCHER</h2>
          <p class="text-slate-500 text-xs">Teardown &amp; Component Inventory Recovery Slip</p>
        </div>
        <div class="text-right">
          <span class="text-base font-extrabold text-rose-600 block">${disassembly.disassemblyNumber}</span>
          <span class="text-slate-500 text-xs">Date: ${disassembly.date || disassembly.disassemblyDate}</span>
        </div>
      </div>

      <div class="grid grid-cols-2 gap-4 bg-slate-50 p-3.5 rounded-xl border border-slate-200">
        <div>
          <span class="text-slate-500 block">Dismantled Product:</span>
          <strong class="text-sm text-slate-900">${varMap.get(disassembly.sourceVariantId) || 'Source Item'}</strong>
        </div>
        <div class="text-right">
          <span class="text-slate-500 block">Quantity Dismantled:</span>
          <strong class="text-sm text-rose-600">-${disassembly.disassembledQuantity} Units</strong>
        </div>
        <div>
          <span class="text-slate-500 block">Warehouse Location:</span>
          <strong>${whMap.get(disassembly.warehouseId) || disassembly.warehouseId}</strong>
        </div>
        <div class="text-right">
          <span class="text-slate-500 block">Status:</span>
          <strong class="text-emerald-600">${disassembly.status}</strong>
        </div>
      </div>

      <div class="space-y-2">
        <span class="font-bold text-slate-700 uppercase tracking-wider block">Recovered Reusable Components</span>
        <table class="w-full border-collapse border border-slate-200">
          <thead class="bg-slate-100 font-bold text-slate-700">
            <tr>
              <th class="border border-slate-200 p-2 text-left">Component Item</th>
              <th class="border border-slate-200 p-2 text-center">Qty Recovered</th>
              <th class="border border-slate-200 p-2 text-right">Unit Value</th>
              <th class="border border-slate-200 p-2 text-right">Amount</th>
            </tr>
          </thead>
          <tbody>
            ${(disassembly.lines || []).map(r => `
              <tr>
                <td class="border border-slate-200 p-2 font-medium">${varMap.get(r.componentVariantId) || 'Component'}</td>
                <td class="border border-slate-200 p-2 text-center font-bold text-emerald-600">+${r.actualQuantity !== undefined ? r.actualQuantity : (r.quantityRecovered || r.quantityRestored)} ${r.unit || 'PCS'}</td>
                <td class="border border-slate-200 p-2 text-right">Rs. ${Number(r.unitCost || 0).toLocaleString()}</td>
                <td class="border border-slate-200 p-2 text-right font-bold">Rs. ${((r.actualQuantity !== undefined ? r.actualQuantity : (r.quantityRecovered || r.quantityRestored)) * (r.unitCost || 0)).toLocaleString()}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>

      <div class="border-t border-slate-200 pt-3 flex justify-end text-xs">
        <div class="w-64 space-y-1.5 text-right">
          <div class="flex justify-between text-slate-600">
            <span>Dismantled Item Cost:</span>
            <span class="font-bold">Rs. ${Number(disassembly.totalSourceCost || 0).toLocaleString()}</span>
          </div>
          <div class="flex justify-between text-slate-600">
            <span>Recovered Components:</span>
            <span class="font-bold text-emerald-600">Rs. ${Number(disassembly.totalRecoveredValue || 0).toLocaleString()}</span>
          </div>
          <div class="flex justify-between font-black text-sm pt-1 border-t border-slate-300">
            <span>Variance / Scrap:</span>
            <span class="${disassembly.varianceAmount < 0 ? 'text-rose-600' : 'text-blue-600'}">
              Rs. ${Number(disassembly.varianceAmount || 0).toLocaleString()}
            </span>
          </div>
        </div>
      </div>
    </div>
  `;

  openModal({
    title: `Disassembly Voucher: ${disassembly.disassemblyNumber}`,
    subtitle: 'Teardown confirmation and component inventory recovery document',
    badge: disassembly.disassemblyNumber,
    icon: '🖨️',
    contentHtml,
    size: 'max-w-3xl',
    footerHtml: `
      <div class="flex items-center justify-between w-full">
        <button id="dis-close-btn" class="px-4 py-2 text-xs font-semibold text-slate-600 bg-slate-100 rounded-xl cursor-pointer">Close</button>
        <button onclick="window.print()" class="px-5 py-2 text-xs font-bold text-white bg-rose-600 rounded-xl shadow-xs cursor-pointer">
          🖨 Print / Save PDF
        </button>
      </div>
    `,
    onOpen: (modalEl) => {
      modalEl.querySelector('#dis-close-btn').onclick = () => closeModal();
    }
  });
}
