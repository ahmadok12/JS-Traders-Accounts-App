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
import { authService } from '../../services/authService.js';
import { renderTable, bindTableActions } from '../../components/table.js';
import { renderFilterBar } from '../../components/filters.js';
import { openModal, closeModal } from '../../components/modal.js';
import { confirmAction } from '../../components/confirmation.js';
import { toast } from '../../components/toast.js';

let activeTab = 'assembly'; // 'assembly' | 'disassembly' | 'boms' | 'payables' | 'reports'
let activeReportSubTab = 'register'; // 'register' | 'costing' | 'labor' | 'consumption' | 'disassembly_reg'
let assemblyStatusFilter = 'ALL';

export function renderAssemblyView() {
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
                <span>Labor Rate: <strong class="text-slate-800">Rs. ${r.defaultLaborRate || 0}</strong></span>
                <span>${partyMap.get(r.defaultLaborPartyId) || 'Standard Workshop'}</span>
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
                  <td class="p-2.5 text-center font-bold">${r.finishedQuantity}</td>
                  <td class="p-2.5 text-right">Rs. ${r.totalMaterialCost.toLocaleString()}</td>
                  <td class="p-2.5 text-right">Rs. ${r.totalLaborCost.toLocaleString()}</td>
                  <td class="p-2.5 text-right font-bold text-slate-900">Rs. ${r.totalCost.toLocaleString()}</td>
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
                  <td class="p-2.5 text-center font-bold text-emerald-600">${c.totalUnitsProduced}</td>
                  <td class="p-2.5 text-right">Rs. ${c.averageMaterialCost.toLocaleString()}</td>
                  <td class="p-2.5 text-right">Rs. ${c.averageLaborCost.toLocaleString()}</td>
                  <td class="p-2.5 text-right font-extrabold text-slate-900">Rs. ${c.averageUnitCost.toLocaleString()}</td>
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
                  <td class="p-2.5 text-center font-bold">${l.assembliesCount}</td>
                  <td class="p-2.5 text-right">Rs. ${l.totalPayable.toLocaleString()}</td>
                  <td class="p-2.5 text-right font-bold text-emerald-600">Rs. ${l.totalPaid.toLocaleString()}</td>
                  <td class="p-2.5 text-right font-extrabold text-rose-600">Rs. ${l.outstandingBalance.toLocaleString()}</td>
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
                  <td class="p-2.5 text-center font-extrabold text-rose-600">${c.totalQuantityConsumed.toLocaleString()} ${c.unit || 'PCS'}</td>
                  <td class="p-2.5 text-right font-extrabold text-slate-900">Rs. ${c.totalCostConsumed.toLocaleString()}</td>
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
                  <td class="p-2.5 text-center font-bold">${d.disassembledQuantity}</td>
                  <td class="p-2.5 text-right">Rs. ${d.totalSourceCost.toLocaleString()}</td>
                  <td class="p-2.5 text-right font-bold text-emerald-600">Rs. ${d.totalRecoveredValue.toLocaleString()}</td>
                  <td class="p-2.5 text-right font-bold ${d.varianceAmount < 0 ? 'text-rose-600' : 'text-blue-600'}">
                    Rs. ${d.varianceAmount.toLocaleString()}
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
      refreshView(container, refreshCallback);
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
        openNewDisassemblyModal(() => refreshView(container, refreshCallback));
      } else {
        openNewAssemblyModal(() => refreshView(container, refreshCallback));
      }
    };
  }

  // BOM tab buttons
  const newRecBtn = container.querySelector('#btn-new-recipe');
  if (newRecBtn) {
    newRecBtn.onclick = () => openNewRecipeModal(() => refreshView(container, refreshCallback));
  }

  const newTplBtn = container.querySelector('#btn-new-template');
  if (newTplBtn) {
    newTplBtn.onclick = () => openNewDisassemblyTemplateModal(() => refreshView(container, refreshCallback));
  }

  // Labor Payables buttons
  const recordPayBtn = container.querySelector('#btn-record-labor-payment');
  if (recordPayBtn) {
    recordPayBtn.onclick = () => openRecordLaborPaymentModal(null, () => refreshView(container, refreshCallback));
  }

  container.querySelectorAll('.btn-pay-specific-party').forEach(btn => {
    btn.onclick = () => {
      const partyId = btn.getAttribute('data-party-id');
      openRecordLaborPaymentModal(partyId, () => refreshView(container, refreshCallback));
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
        onClick: (row) => handleCompleteAssemblyClick(row, () => refreshView(container, refreshCallback))
      },
      {
        label: 'Reverse',
        variant: 'danger',
        condition: row => row.status === 'Completed',
        onClick: (row) => handleReverseAssemblyClick(row, () => refreshView(container, refreshCallback))
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
        onClick: (row) => handleReverseDisassemblyClick(row, () => refreshView(container, refreshCallback))
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
  if (refreshCallback) refreshCallback();
}

// ============================================================================
// MODAL: NEW ASSEMBLY ORDER (WITH BOM SELECTION, SHORTFALL CHECK, DUAL WH)
// ============================================================================

function openNewAssemblyModal(onSaved) {
  const recipes = assemblyService.getRecipes();
  const warehouses = warehouseService.getWarehouses();
  const variants = productService.getVariants();
  const laborParties = assemblyService.getLaborParties();

  const contentHtml = `
    <form id="new-assembly-order-form" class="space-y-4 text-xs">
      <div class="grid grid-cols-1 sm:grid-cols-3 gap-3 bg-blue-50/50 p-3.5 rounded-xl border border-blue-100">
        <div class="sm:col-span-2">
          <label class="block font-bold text-slate-700 mb-1">Predefined BOM Recipe (Optional)</label>
          <select id="asm-recipe-select" class="w-full border border-slate-300 rounded-xl px-3 py-2 text-slate-800 bg-white font-semibold">
            <option value="">-- Custom Assembly / Finishing (No Recipe) --</option>
            ${recipes.map(r => `<option value="${r.id}">${r.name} (${r.assemblyType})</option>`).join('')}
          </select>
        </div>
        <div>
          <label class="block font-bold text-slate-700 mb-1">Assembly Type *</label>
          <select id="asm-type" required class="w-full border border-slate-300 rounded-xl px-3 py-2 text-slate-800 bg-white font-semibold">
            <option value="MANUFACTURING">Multi-Component Assembly</option>
            <option value="FINISHING">Single-Product Finishing</option>
          </select>
        </div>
      </div>

      <div class="grid grid-cols-1 sm:grid-cols-4 gap-3">
        <div class="sm:col-span-2">
          <label class="block font-bold text-slate-700 mb-1">Target Finished Product Variant *</label>
          <select id="asm-target-variant" required class="w-full border border-slate-300 rounded-xl px-3 py-2 text-slate-800 bg-white font-bold">
            ${variants.map(v => `<option value="${v.id}">${v.name} (${v.sku})</option>`).join('')}
          </select>
        </div>
        <div>
          <label class="block font-bold text-slate-700 mb-1">Output Qty to Produce *</label>
          <input type="number" id="asm-output-qty" required min="1" value="1" class="w-full border border-slate-300 rounded-xl px-3 py-2 text-slate-800 font-bold">
        </div>
        <div>
          <label class="block font-bold text-slate-700 mb-1">Assembly Date *</label>
          <input type="date" id="asm-date" required value="${new Date().toISOString().split('T')[0]}" class="w-full border border-slate-300 rounded-xl px-3 py-2 text-slate-800">
        </div>
      </div>

      <!-- Dual Warehouse Configuration -->
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-3 p-3 bg-slate-50 rounded-xl border border-slate-200">
        <div>
          <label class="block font-bold text-slate-700 mb-1">Source Warehouse (Components Deducted From) *</label>
          <select id="asm-src-warehouse" required class="w-full border border-slate-300 rounded-xl px-3 py-2 text-slate-800 bg-white">
            ${warehouses.map(w => `<option value="${w.id}">${w.name}</option>`).join('')}
          </select>
        </div>
        <div>
          <label class="block font-bold text-slate-700 mb-1">Output Warehouse (Finished Product Added To) *</label>
          <select id="asm-out-warehouse" required class="w-full border border-slate-300 rounded-xl px-3 py-2 text-slate-800 bg-white">
            ${warehouses.map(w => `<option value="${w.id}">${w.name}</option>`).join('')}
          </select>
        </div>
      </div>

      <!-- Assembly Labor Configuration -->
      <div class="grid grid-cols-1 sm:grid-cols-3 gap-3 p-3 bg-slate-50 rounded-xl border border-slate-200">
        <div class="sm:col-span-2">
          <label class="block font-bold text-slate-700 mb-1">Assembly Labor Party / Workshop *</label>
          <select id="asm-labor-party" required class="w-full border border-slate-300 rounded-xl px-3 py-2 text-slate-800 bg-white font-semibold">
            ${laborParties.map(p => `<option value="${p.id}">${p.name} (Outstanding: Rs. ${(p.currentBalance || 0).toLocaleString()})</option>`).join('')}
          </select>
        </div>
        <div>
          <label class="block font-bold text-slate-700 mb-1">Labor Rate (PKR / Unit) *</label>
          <input type="number" id="asm-labor-rate" required min="0" value="500" class="w-full border border-slate-300 rounded-xl px-3 py-2 text-slate-800 font-bold">
        </div>
      </div>

      <!-- Bill of Materials (BOM) Lines Table -->
      <div class="space-y-2">
        <div class="flex items-center justify-between">
          <span class="text-xs font-bold text-slate-700 uppercase tracking-wider">Required Inventory Components</span>
          <button type="button" id="btn-add-bom-row" class="px-2.5 py-1 text-[11px] font-bold text-[#138FCB] bg-blue-50 hover:bg-blue-100 rounded-lg transition-colors cursor-pointer">
            + Add Component
          </button>
        </div>

        <div id="bom-items-table" class="space-y-2 max-h-56 overflow-y-auto pr-1">
          <!-- Dynamic Component Rows -->
        </div>

        <!-- Stock Availability Banner -->
        <div id="asm-stock-banner" class="p-2.5 rounded-xl border text-[11px] flex items-center justify-between">
          <span id="asm-stock-msg" class="font-bold">Checking component availability...</span>
          <span id="asm-stock-badge" class="px-2 py-0.5 rounded font-extrabold text-[10px]"></span>
        </div>
      </div>

      <!-- Valuation Summary -->
      <div class="p-3 bg-slate-900 text-white rounded-xl flex items-center justify-between">
        <div>
          <span class="text-[10px] text-slate-400 uppercase tracking-wider block">Estimated Finished Unit Cost</span>
          <span id="asm-preview-unit-cost" class="text-lg font-black text-emerald-400">Rs. 0</span>
        </div>
        <div class="text-right">
          <span class="text-[10px] text-slate-400 uppercase tracking-wider block">Total Production Cost (Material + Labor)</span>
          <span id="asm-preview-total-cost" class="text-lg font-black text-white">Rs. 0</span>
        </div>
      </div>

      <div>
        <label class="block font-bold text-slate-700 mb-1">Production Notes / Batch Reference</label>
        <input type="text" id="asm-notes" placeholder="e.g. Assembled for Faisalabad commercial farm order" class="w-full border border-slate-300 rounded-xl px-3 py-2 text-slate-800">
      </div>

      <div class="flex items-center justify-between pt-3 border-t border-slate-200">
        <button type="button" id="asm-modal-cancel" class="px-4 py-2 text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-xl font-bold cursor-pointer">Cancel</button>
        <div class="flex gap-2">
          <button type="button" id="asm-save-draft-btn" class="px-4 py-2 bg-amber-500 hover:bg-amber-600 text-white rounded-xl font-bold shadow-xs cursor-pointer">
            Save as Draft
          </button>
          <button type="submit" id="asm-complete-now-btn" class="px-5 py-2 bg-[#138FCB] hover:bg-[#0E78AC] text-white rounded-xl font-bold shadow-xs cursor-pointer">
            Complete Production Now
          </button>
        </div>
      </div>
    </form>
  `;

  openModal({
    title: 'New Assembly Build',
    subtitle: 'Converts raw inventory components into finished products with labor payable valuation',
    badge: 'Production Engine',
    contentHtml,
    size: 'max-w-3xl',
    onOpen: (modalEl) => {
      modalEl.querySelector('#asm-modal-cancel').onclick = () => closeModal();

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
      const previewUnitCost = modalEl.querySelector('#asm-preview-unit-cost');
      const previewTotalCost = modalEl.querySelector('#asm-preview-total-cost');

      const addComponentRow = (varId = '', qtyPerUnit = 1, cost = 0) => {
        const row = document.createElement('div');
        row.className = 'bom-input-row grid grid-cols-12 gap-2 items-center bg-slate-50 p-2 rounded-lg border border-slate-200';
        row.innerHTML = `
          <div class="col-span-6">
            <select class="bom-var w-full border border-slate-300 rounded px-2 py-1 text-slate-800 bg-white">
              ${variants.map(v => `<option value="${v.id}" ${v.id === varId ? 'selected' : ''}>${v.name} (${v.sku})</option>`).join('')}
            </select>
          </div>
          <div class="col-span-2">
            <input type="number" min="0.01" step="any" value="${qtyPerUnit}" placeholder="Qty/unit" class="bom-qty w-full border border-slate-300 rounded px-2 py-1 text-slate-800 font-bold text-center">
          </div>
          <div class="col-span-3">
            <input type="number" min="0" value="${cost || 0}" placeholder="Cost" class="bom-cost w-full border border-slate-300 rounded px-2 py-1 text-slate-800 text-right">
          </div>
          <div class="col-span-1 text-center">
            <button type="button" class="btn-remove-row text-rose-500 hover:text-rose-700 font-bold text-base cursor-pointer">×</button>
          </div>
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
      };

      addRowBtn.onclick = () => {
        addComponentRow(variants[0]?.id, 1, variants[0]?.costPrice || 0);
        recalculate();
      };

      const recalculate = () => {
        const outQty = Number(outputQtyInput.value) || 1;
        const laborRate = Number(laborRateInput.value) || 0;
        const srcWhId = srcWhSelect.value;

        let totalMatCost = 0;
        const componentsToCheck = [];

        tableContainer.querySelectorAll('.bom-input-row').forEach(r => {
          const compVarId = r.querySelector('.bom-var').value;
          const qtyPerUnit = Number(r.querySelector('.bom-qty').value) || 0;
          const unitCost = Number(r.querySelector('.bom-cost').value) || 0;
          const totalQtyNeeded = qtyPerUnit * outQty;
          totalMatCost += totalQtyNeeded * unitCost;

          componentsToCheck.push({
            componentVariantId: compVarId,
            quantityConsumed: totalQtyNeeded
          });
        });

        const totalLabor = outQty * laborRate;
        const grandTotal = totalMatCost + totalLabor;
        const unitFinished = outQty > 0 ? (grandTotal / outQty) : 0;

        previewUnitCost.textContent = `Rs. ${Math.round(unitFinished).toLocaleString()}`;
        previewTotalCost.textContent = `Rs. ${Math.round(grandTotal).toLocaleString()}`;

        // Stock check
        const check = assemblyService.checkStockAvailability(componentsToCheck, srcWhId);
        if (check.available) {
          stockBanner.className = 'p-2.5 rounded-xl border border-emerald-200 bg-emerald-50 text-[11px] flex items-center justify-between text-emerald-900';
          stockMsg.textContent = '✅ All components are available in source warehouse stock.';
          stockBadge.className = 'px-2 py-0.5 rounded font-extrabold text-[10px] bg-emerald-600 text-white';
          stockBadge.textContent = 'READY TO PRODUCE';
        } else {
          stockBanner.className = 'p-2.5 rounded-xl border border-rose-200 bg-rose-50 text-[11px] flex items-center justify-between text-rose-900';
          const shortfallSummary = check.shortfalls.map(s => `${s.variantName || 'Component'}: -${s.shortfallQty}`).join(', ');
          stockMsg.textContent = `⚠️ Insufficient Stock: ${shortfallSummary}`;
          stockBadge.className = 'px-2 py-0.5 rounded font-extrabold text-[10px] bg-rose-600 text-white';
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
        recalculate();
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
      modalEl.querySelector('#asm-save-draft-btn').onclick = () => {
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
// MODAL: NEW DISASSEMBLY / BREAKDOWN (ANY ITEM)
// ============================================================================

function openNewDisassemblyModal(onSaved) {
  const warehouses = warehouseService.getWarehouses();
  const variants = productService.getVariants();
  const templates = assemblyService.getDisassemblyTemplates();

  const contentHtml = `
    <form id="new-disassembly-form" class="space-y-4 text-xs">
      <div class="grid grid-cols-1 sm:grid-cols-3 gap-3 bg-rose-50/50 p-3.5 rounded-xl border border-rose-100">
        <div class="sm:col-span-2">
          <label class="block font-bold text-slate-700 mb-1">Load Disassembly Template (Optional)</label>
          <select id="dis-template-select" class="w-full border border-slate-300 rounded-xl px-3 py-2 text-slate-800 bg-white font-semibold">
            <option value="">-- Manual Teardown / Any Inventory Item --</option>
            ${templates.map(t => `<option value="${t.id}">${t.name}</option>`).join('')}
          </select>
        </div>
        <div>
          <label class="block font-bold text-slate-700 mb-1">Disassembly Date *</label>
          <input type="date" id="dis-date" required value="${new Date().toISOString().split('T')[0]}" class="w-full border border-slate-300 rounded-xl px-3 py-2 text-slate-800">
        </div>
      </div>

      <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div>
          <label class="block font-bold text-slate-700 mb-1">Warehouse *</label>
          <select id="dis-warehouse" required class="w-full border border-slate-300 rounded-xl px-3 py-2 text-slate-800 bg-white">
            ${warehouses.map(w => `<option value="${w.id}">${w.name}</option>`).join('')}
          </select>
        </div>
        <div>
          <label class="block font-bold text-slate-700 mb-1">Item to Disassemble (Any Item) *</label>
          <select id="dis-source-var" required class="w-full border border-slate-300 rounded-xl px-3 py-2 text-slate-800 bg-white font-bold">
            ${variants.map(v => `<option value="${v.id}" data-cost="${v.costPrice || 0}">${v.name} (${v.sku})</option>`).join('')}
          </select>
        </div>
        <div>
          <label class="block font-bold text-slate-700 mb-1">Quantity to Dismantle *</label>
          <input type="number" id="dis-qty" required min="1" value="1" class="w-full border border-slate-300 rounded-xl px-3 py-2 text-slate-800 font-bold">
        </div>
      </div>

      <!-- Live Available Stock of Source Item -->
      <div id="dis-source-stock-pill" class="p-2.5 rounded-xl border border-slate-200 bg-slate-50 text-[11px] font-semibold text-slate-700 flex justify-between items-center">
        <span>Available in chosen warehouse: <strong id="dis-stock-count" class="text-slate-900">0</strong> units</span>
        <span>Item Unit Cost: <strong id="dis-item-cost" class="text-slate-900">Rs. 0</strong></span>
      </div>

      <!-- Recovered Components Section -->
      <div class="space-y-2">
        <div class="flex items-center justify-between">
          <span class="text-xs font-bold text-slate-700 uppercase tracking-wider">Recovered Components (Partial Teardown Supported)</span>
          <button type="button" id="btn-add-recovered-row" class="px-2.5 py-1 text-[11px] font-bold text-rose-600 bg-rose-50 hover:bg-rose-100 rounded-lg transition-colors cursor-pointer">
            + Add Recovered Component
          </button>
        </div>

        <div id="recovered-items-table" class="space-y-2 max-h-56 overflow-y-auto pr-1">
          <!-- Dynamic Recovered Rows -->
        </div>
      </div>

      <!-- Valuation & Variance Box -->
      <div class="p-3 bg-slate-900 text-white rounded-xl flex items-center justify-between">
        <div>
          <span class="text-[10px] text-slate-400 uppercase tracking-wider block">Source Item Total Cost</span>
          <span id="dis-preview-source-cost" class="text-base font-bold text-rose-400">Rs. 0</span>
        </div>
        <div class="text-center">
          <span class="text-[10px] text-slate-400 uppercase tracking-wider block">Total Recovered Value</span>
          <span id="dis-preview-recovered-value" class="text-base font-bold text-emerald-400">Rs. 0</span>
        </div>
        <div class="text-right">
          <span class="text-[10px] text-slate-400 uppercase tracking-wider block">Variance / Scrap Loss/Gain</span>
          <span id="dis-preview-variance" class="text-base font-bold text-white">Rs. 0</span>
        </div>
      </div>

      <div>
        <label class="block font-bold text-slate-700 mb-1">Reason for Breakdown / Notes</label>
        <input type="text" id="dis-notes" placeholder="e.g. Scrapped defective fan housing to recover copper motor and blades" class="w-full border border-slate-300 rounded-xl px-3 py-2 text-slate-800">
      </div>

      <div class="flex items-center justify-between pt-3 border-t border-slate-200">
        <button type="button" id="dis-modal-cancel" class="px-4 py-2 text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-xl font-bold cursor-pointer">Cancel</button>
        <button type="submit" class="px-5 py-2 bg-rose-600 hover:bg-rose-700 text-white rounded-xl font-bold shadow-xs cursor-pointer">
          Confirm Disassembly &amp; Recover Components
        </button>
      </div>
    </form>
  `;

  openModal({
    title: 'Disassembly / Breakdown',
    subtitle: 'Teardown any product to recover reusable components into inventory with scrap variance calculation',
    badge: 'Inventory Recovery',
    contentHtml,
    size: 'max-w-3xl',
    onOpen: (modalEl) => {
      modalEl.querySelector('#dis-modal-cancel').onclick = () => closeModal();

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

      const addRecoveredRow = (varId = '', qty = 1, cost = 0, isChecked = true) => {
        const row = document.createElement('div');
        row.className = 'rec-input-row grid grid-cols-12 gap-2 items-center bg-slate-50 p-2 rounded-lg border border-slate-200';
        row.innerHTML = `
          <div class="col-span-1 text-center">
            <input type="checkbox" ${isChecked ? 'checked' : ''} class="rec-check rounded text-rose-600 focus:ring-rose-500">
          </div>
          <div class="col-span-5">
            <select class="rec-var w-full border border-slate-300 rounded px-2 py-1 text-slate-800 bg-white">
              ${variants.map(v => `<option value="${v.id}" ${v.id === varId ? 'selected' : ''}>${v.name} (${v.sku})</option>`).join('')}
            </select>
          </div>
          <div class="col-span-2">
            <input type="number" min="1" value="${qty}" placeholder="Qty" class="rec-qty w-full border border-slate-300 rounded px-2 py-1 text-slate-800 font-bold text-center">
          </div>
          <div class="col-span-3">
            <input type="number" min="0" value="${cost || 0}" placeholder="Cost" class="rec-cost w-full border border-slate-300 rounded px-2 py-1 text-slate-800 text-right">
          </div>
          <div class="col-span-1 text-center">
            <button type="button" class="btn-remove-rec-row text-rose-500 hover:text-rose-700 font-bold text-base cursor-pointer">×</button>
          </div>
        `;

        row.querySelector('.btn-remove-rec-row').onclick = () => {
          row.remove();
          recalculate();
        };

        const compVar = row.querySelector('.rec-var');
        compVar.onchange = () => {
          const v = variants.find(x => x.id === compVar.value);
          if (v && (!row.querySelector('.rec-cost').value || Number(row.querySelector('.rec-cost').value) === 0)) {
            row.querySelector('.rec-cost').value = v.costPrice || 0;
          }
          recalculate();
        };

        row.querySelector('.rec-check').onchange = recalculate;
        row.querySelector('.rec-qty').oninput = recalculate;
        row.querySelector('.rec-cost').oninput = recalculate;

        tableContainer.appendChild(row);
      };

      addRowBtn.onclick = () => {
        addRecoveredRow(variants[0]?.id, 1, variants[0]?.costPrice || 0, true);
        recalculate();
      };

      const recalculate = () => {
        const disQty = Number(qtyInput.value) || 1;
        const srcVarId = sourceVarSelect.value;
        const whId = whSelect.value;
        const v = variants.find(x => x.id === srcVarId);
        const unitCost = v?.costPrice || 0;
        const totalSrcCost = disQty * unitCost;

        const currentStock = inventoryService.getStockLevel(srcVarId, whId);
        stockCountEl.textContent = currentStock.toLocaleString();
        itemCostEl.textContent = `Rs. ${unitCost.toLocaleString()}`;

        let totalRecVal = 0;
        tableContainer.querySelectorAll('.rec-input-row').forEach(r => {
          const isChecked = r.querySelector('.rec-check').checked;
          if (isChecked) {
            const qty = Number(r.querySelector('.rec-qty').value) || 0;
            const cost = Number(r.querySelector('.rec-cost').value) || 0;
            totalRecVal += qty * cost;
          }
        });

        const variance = totalRecVal - totalSrcCost;
        previewSourceCost.textContent = `Rs. ${totalSrcCost.toLocaleString()}`;
        previewRecoveredVal.textContent = `Rs. ${totalRecVal.toLocaleString()}`;
        previewVariance.textContent = `${variance >= 0 ? '+' : ''}Rs. ${variance.toLocaleString()}`;
      };

      // Template selection
      templateSelect.onchange = () => {
        const tplId = templateSelect.value;
        if (!tplId) return;
        const tpl = templates.find(t => t.id === tplId);
        if (!tpl) return;

        sourceVarSelect.value = tpl.sourceVariantId;
        tableContainer.innerHTML = '';
        (tpl.expectedComponents || []).forEach(c => {
          const v = variants.find(x => x.id === c.componentVariantId);
          addRecoveredRow(c.componentVariantId, c.defaultRecoveryRatio * (Number(qtyInput.value) || 1), v?.costPrice || 0, true);
        });
        recalculate();
      };

      sourceVarSelect.onchange = recalculate;
      whSelect.onchange = recalculate;
      qtyInput.oninput = recalculate;

      // Default row
      addRecoveredRow(variants[0]?.id, 1, variants[0]?.costPrice || 0, true);
      recalculate();

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
// MODAL: RECORD LABOR PAYMENT (SPECIFIC ASSEMBLIES VS FIFO LUMP-SUM)
// ============================================================================

function openRecordLaborPaymentModal(selectedPartyId = null, onSaved) {
  const laborParties = assemblyService.getLaborParties();
  const accounts = accountingService.getChartOfAccounts();
  const paymentAccounts = accounts.filter(a => a.accountType === 'Asset' && (a.accountSubType === 'Cash' || a.accountSubType === 'Bank' || a.name.includes('Cash') || a.name.includes('Bank')));

  const contentHtml = `
    <form id="labor-payment-form" class="space-y-4 text-xs">
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label class="block font-bold text-slate-700 mb-1">Labor Workshop / Party *</label>
          <select id="pay-party-select" required class="w-full border border-slate-300 rounded-xl px-3 py-2 text-slate-800 bg-white font-bold">
            ${laborParties.map(p => {
              const bal = assemblyService.getLaborPartyBalance(p.id);
              return `<option value="${p.id}" ${p.id === selectedPartyId ? 'selected' : ''}>${p.name} (Balance: Rs. ${bal.outstandingBalance.toLocaleString()})</option>`;
            }).join('')}
          </select>
        </div>
        <div>
          <label class="block font-bold text-slate-700 mb-1">Payment Method / Mode *</label>
          <select id="pay-mode-select" required class="w-full border border-slate-300 rounded-xl px-3 py-2 text-slate-800 bg-white font-semibold">
            <option value="FIFO_BALANCE">Option B: FIFO Lump-Sum Balance Settlement</option>
            <option value="SPECIFIC_ASSEMBLIES">Option A: Allocate to Specific Assemblies</option>
          </select>
        </div>
      </div>

      <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div>
          <label class="block font-bold text-slate-700 mb-1">Payment Date *</label>
          <input type="date" id="pay-date" required value="${new Date().toISOString().split('T')[0]}" class="w-full border border-slate-300 rounded-xl px-3 py-2 text-slate-800">
        </div>
        <div>
          <label class="block font-bold text-slate-700 mb-1">Payment Account *</label>
          <select id="pay-account" required class="w-full border border-slate-300 rounded-xl px-3 py-2 text-slate-800 bg-white font-semibold">
            ${paymentAccounts.map(a => `<option value="${a.id}">${a.name} (${a.code || a.id})</option>`).join('')}
          </select>
        </div>
        <div>
          <label class="block font-bold text-slate-700 mb-1">Total Payment Amount (PKR) *</label>
          <input type="number" id="pay-amount" required min="1" value="0" class="w-full border border-slate-300 rounded-xl px-3 py-2 text-slate-800 font-extrabold text-right">
        </div>
      </div>

      <!-- Specific Assemblies Table (Shown if Option A chosen) -->
      <div id="specific-payables-container" class="hidden space-y-2">
        <span class="text-xs font-bold text-slate-700 uppercase tracking-wider block">Unpaid Assembly Payables for this Party</span>
        <div id="specific-payables-list" class="space-y-2 max-h-48 overflow-y-auto pr-1">
          <!-- Dynamic Unpaid Assemblies -->
        </div>
      </div>

      <div>
        <label class="block font-bold text-slate-700 mb-1">Payment Notes / Cheque / Reference</label>
        <input type="text" id="pay-notes" placeholder="e.g. Cheque #49281 / Online transfer for weekly cooler assembly" class="w-full border border-slate-300 rounded-xl px-3 py-2 text-slate-800">
      </div>

      <div class="flex items-center justify-between pt-3 border-t border-slate-200">
        <button type="button" id="pay-modal-cancel" class="px-4 py-2 text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-xl font-bold cursor-pointer">Cancel</button>
        <button type="submit" class="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-bold shadow-xs cursor-pointer">
          Post Labor Payment
        </button>
      </div>
    </form>
  `;

  openModal({
    title: 'Record Assembly Labor Payment',
    subtitle: 'Settle outstanding labor liabilities via specific assembly allocations or FIFO balance payment',
    badge: 'Labor Settlement',
    contentHtml,
    size: 'max-w-2xl',
    onOpen: (modalEl) => {
      modalEl.querySelector('#pay-modal-cancel').onclick = () => closeModal();

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
          item.className = 'flex items-center justify-between p-2.5 bg-slate-50 border border-slate-200 rounded-lg text-xs';
          item.innerHTML = `
            <div>
              <span class="font-bold text-[#138FCB]">${p.payableNumber}</span>
              <span class="text-slate-500 font-medium ml-2">Order: ${p.assemblyNumber || p.assemblyId}</span>
              <span class="text-rose-600 font-bold ml-2">Due: Rs. ${p.remainingBalance.toLocaleString()}</span>
            </div>
            <div class="flex items-center gap-2">
              <span class="text-[11px] text-slate-500">Pay:</span>
              <input type="number" min="0" max="${p.remainingBalance}" value="${p.remainingBalance}" data-payable-id="${p.id}" class="specific-pay-val w-28 text-right font-bold border border-slate-300 rounded px-2 py-1">
            </div>
          `;
          specificList.appendChild(item);
        });

        // Sum specific inputs
        const sumSpecific = () => {
          let s = 0;
          specificList.querySelectorAll('.specific-pay-val').forEach(inp => {
            s += Number(inp.value) || 0;
          });
          amountInput.value = s;
        };

        specificList.querySelectorAll('.specific-pay-val').forEach(inp => {
          inp.oninput = sumSpecific;
        });

        if (modeSelect.value === 'SPECIFIC_ASSEMBLIES') {
          sumSpecific();
        }
      };

      modeSelect.onchange = () => {
        if (modeSelect.value === 'SPECIFIC_ASSEMBLIES') {
          specificContainer.classList.remove('hidden');
          updatePartyPayables();
        } else {
          specificContainer.classList.add('hidden');
          const bal = assemblyService.getLaborPartyBalance(partySelect.value);
          amountInput.value = bal.outstandingBalance || 0;
        }
      };

      partySelect.onchange = () => {
        if (modeSelect.value === 'SPECIFIC_ASSEMBLIES') {
          updatePartyPayables();
        } else {
          const bal = assemblyService.getLaborPartyBalance(partySelect.value);
          amountInput.value = bal.outstandingBalance || 0;
        }
      };

      // Initial trigger
      modeSelect.dispatchEvent(new Event('change'));

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
          specificList.querySelectorAll('.specific-pay-val').forEach(inp => {
            const amt = Number(inp.value) || 0;
            if (amt > 0) {
              allocations.push({
                payableId: inp.getAttribute('data-payable-id'),
                amount: amt
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
// MODAL: NEW RECIPE & NEW TEMPLATE
// ============================================================================

function openNewRecipeModal(onSaved) {
  const variants = productService.getVariants();
  const laborParties = assemblyService.getLaborParties();
  const warehouses = warehouseService.getWarehouses();

  const contentHtml = `
    <form id="new-recipe-form" class="space-y-4 text-xs">
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label class="block font-bold text-slate-700 mb-1">Recipe Name *</label>
          <input type="text" id="rec-name" required placeholder="e.g. Air Cooler 18-Inch Standard Build" class="w-full border border-slate-300 rounded-xl px-3 py-2 text-slate-800 font-bold">
        </div>
        <div>
          <label class="block font-bold text-slate-700 mb-1">Assembly Type *</label>
          <select id="rec-type" class="w-full border border-slate-300 rounded-xl px-3 py-2 text-slate-800 bg-white font-semibold">
            <option value="MANUFACTURING">Multi-Component Manufacturing</option>
            <option value="FINISHING">Single-Product Finishing</option>
          </select>
        </div>
      </div>

      <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div class="sm:col-span-2">
          <label class="block font-bold text-slate-700 mb-1">Target Finished Product Variant *</label>
          <select id="rec-target-var" class="w-full border border-slate-300 rounded-xl px-3 py-2 text-slate-800 bg-white font-bold">
            ${variants.map(v => `<option value="${v.id}">${v.name} (${v.sku})</option>`).join('')}
          </select>
        </div>
        <div>
          <label class="block font-bold text-slate-700 mb-1">Default Labor Rate (PKR) *</label>
          <input type="number" id="rec-labor-rate" required min="0" value="500" class="w-full border border-slate-300 rounded-xl px-3 py-2 text-slate-800 font-bold">
        </div>
      </div>

      <div class="space-y-2">
        <div class="flex items-center justify-between">
          <span class="text-xs font-bold text-slate-700 uppercase tracking-wider">Recipe Components (Per 1 Finished Good)</span>
          <button type="button" id="btn-add-rec-item" class="px-2.5 py-1 text-[11px] font-bold text-[#138FCB] bg-blue-50 hover:bg-blue-100 rounded-lg cursor-pointer">
            + Add Component
          </button>
        </div>
        <div id="recipe-items-container" class="space-y-2 max-h-48 overflow-y-auto">
          <!-- Dynamic Items -->
        </div>
      </div>

      <div class="flex items-center justify-between pt-3 border-t border-slate-200">
        <button type="button" id="rec-modal-cancel" class="px-4 py-2 text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-xl font-bold cursor-pointer">Cancel</button>
        <button type="submit" class="px-5 py-2 bg-[#138FCB] hover:bg-[#0E78AC] text-white rounded-xl font-bold shadow-xs cursor-pointer">
          Save Recipe
        </button>
      </div>
    </form>
  `;

  openModal({
    title: 'Create Assembly BOM Recipe',
    subtitle: 'Defines formula of required components and standard assembly labor for reuse',
    contentHtml,
    size: 'max-w-2xl',
    onOpen: (modalEl) => {
      modalEl.querySelector('#rec-modal-cancel').onclick = () => closeModal();
      const container = modalEl.querySelector('#recipe-items-container');
      const addBtn = modalEl.querySelector('#btn-add-rec-item');

      const addItem = (varId = '', qty = 1) => {
        const item = document.createElement('div');
        item.className = 'grid grid-cols-12 gap-2 items-center bg-slate-50 p-2 rounded-lg border border-slate-200';
        item.innerHTML = `
          <div class="col-span-8">
            <select class="rec-comp-var w-full border border-slate-300 rounded px-2 py-1 text-slate-800 bg-white">
              ${variants.map(v => `<option value="${v.id}" ${v.id === varId ? 'selected' : ''}>${v.name} (${v.sku})</option>`).join('')}
            </select>
          </div>
          <div class="col-span-3">
            <input type="number" min="0.01" step="any" value="${qty}" placeholder="Qty/unit" class="rec-comp-qty w-full border border-slate-300 rounded px-2 py-1 text-slate-800 font-bold text-center">
          </div>
          <div class="col-span-1 text-center">
            <button type="button" class="btn-del-rec-item text-rose-500 hover:text-rose-700 font-bold text-base cursor-pointer">×</button>
          </div>
        `;
        item.querySelector('.btn-del-rec-item').onclick = () => item.remove();
        container.appendChild(item);
      };

      addBtn.onclick = () => addItem(variants[0]?.id, 1);
      addItem(variants[0]?.id, 1);

      modalEl.querySelector('#new-recipe-form').onsubmit = (e) => {
        e.preventDefault();
        const name = modalEl.querySelector('#rec-name').value.trim();
        const assemblyType = modalEl.querySelector('#rec-type').value;
        const finishedVariantId = modalEl.querySelector('#rec-target-var').value;
        const defaultLaborRate = Number(modalEl.querySelector('#rec-labor-rate').value) || 0;

        const components = [];
        container.querySelectorAll('.grid').forEach(r => {
          const componentVariantId = r.querySelector('.rec-comp-var').value;
          const quantityPerUnit = Number(r.querySelector('.rec-comp-qty').value) || 1;
          components.push({
            componentVariantId,
            quantityPerUnit,
            unit: 'PCS'
          });
        });

        try {
          assemblyService.createRecipe({
            name,
            assemblyType,
            finishedVariantId,
            defaultLaborRate,
            components
          });

          toast.show(`Recipe "${name}" created successfully.`, 'success');
          closeModal();
          if (onSaved) onSaved();
        } catch (err) {
          toast.show(err.message, 'error');
        }
      };
    }
  });
}

function openNewDisassemblyTemplateModal(onSaved) {
  const variants = productService.getVariants();

  const contentHtml = `
    <form id="new-template-form" class="space-y-4 text-xs">
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label class="block font-bold text-slate-700 mb-1">Template Name *</label>
          <input type="text" id="tpl-name" required placeholder="e.g. Fan Teardown (Motor &amp; Blades)" class="w-full border border-slate-300 rounded-xl px-3 py-2 text-slate-800 font-bold">
        </div>
        <div>
          <label class="block font-bold text-slate-700 mb-1">Source Item to Dismantle *</label>
          <select id="tpl-source-var" class="w-full border border-slate-300 rounded-xl px-3 py-2 text-slate-800 bg-white font-bold">
            ${variants.map(v => `<option value="${v.id}">${v.name} (${v.sku})</option>`).join('')}
          </select>
        </div>
      </div>

      <div class="space-y-2">
        <div class="flex items-center justify-between">
          <span class="text-xs font-bold text-slate-700 uppercase tracking-wider">Default Recoverable Components</span>
          <button type="button" id="btn-add-tpl-item" class="px-2.5 py-1 text-[11px] font-bold text-rose-600 bg-rose-50 hover:bg-rose-100 rounded-lg cursor-pointer">
            + Add Recoverable Item
          </button>
        </div>
        <div id="tpl-items-container" class="space-y-2 max-h-48 overflow-y-auto">
          <!-- Dynamic Items -->
        </div>
      </div>

      <div class="flex items-center justify-between pt-3 border-t border-slate-200">
        <button type="button" id="tpl-modal-cancel" class="px-4 py-2 text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-xl font-bold cursor-pointer">Cancel</button>
        <button type="submit" class="px-5 py-2 bg-slate-800 hover:bg-slate-900 text-white rounded-xl font-bold shadow-xs cursor-pointer">
          Save Template
        </button>
      </div>
    </form>
  `;

  openModal({
    title: 'Create Disassembly Template',
    subtitle: 'Predefine standard recoverable parts and cost allocation percentages',
    contentHtml,
    size: 'max-w-2xl',
    onOpen: (modalEl) => {
      modalEl.querySelector('#tpl-modal-cancel').onclick = () => closeModal();
      const container = modalEl.querySelector('#tpl-items-container');
      const addBtn = modalEl.querySelector('#btn-add-tpl-item');

      const addItem = (varId = '', ratio = 1, costPct = 50) => {
        const item = document.createElement('div');
        item.className = 'grid grid-cols-12 gap-2 items-center bg-slate-50 p-2 rounded-lg border border-slate-200';
        item.innerHTML = `
          <div class="col-span-6">
            <select class="tpl-comp-var w-full border border-slate-300 rounded px-2 py-1 text-slate-800 bg-white">
              ${variants.map(v => `<option value="${v.id}" ${v.id === varId ? 'selected' : ''}>${v.name} (${v.sku})</option>`).join('')}
            </select>
          </div>
          <div class="col-span-3">
            <input type="number" min="0.01" step="any" value="${ratio}" placeholder="Recovery Qty" class="tpl-comp-ratio w-full border border-slate-300 rounded px-2 py-1 text-slate-800 font-bold text-center">
          </div>
          <div class="col-span-2">
            <input type="number" min="0" max="100" value="${costPct}" placeholder="Cost %" class="tpl-comp-pct w-full border border-slate-300 rounded px-2 py-1 text-slate-800 text-right">
          </div>
          <div class="col-span-1 text-center">
            <button type="button" class="btn-del-tpl-item text-rose-500 hover:text-rose-700 font-bold text-base cursor-pointer">×</button>
          </div>
        `;
        item.querySelector('.btn-del-tpl-item').onclick = () => item.remove();
        container.appendChild(item);
      };

      addBtn.onclick = () => addItem(variants[0]?.id, 1, 50);
      addItem(variants[0]?.id, 1, 50);

      modalEl.querySelector('#new-template-form').onsubmit = (e) => {
        e.preventDefault();
        const name = modalEl.querySelector('#tpl-name').value.trim();
        const sourceVariantId = modalEl.querySelector('#tpl-source-var').value;

        const expectedComponents = [];
        container.querySelectorAll('.grid').forEach(r => {
          const componentVariantId = r.querySelector('.tpl-comp-var').value;
          const defaultRecoveryRatio = Number(r.querySelector('.tpl-comp-ratio').value) || 1;
          const costAllocationPercentage = Number(r.querySelector('.tpl-comp-pct').value) || 0;
          expectedComponents.push({
            componentVariantId,
            defaultRecoveryRatio,
            costAllocationPercentage,
            unit: 'PCS'
          });
        });

        try {
          assemblyService.createDisassemblyTemplate({
            name,
            sourceVariantId,
            expectedComponents
          });

          toast.show(`Template "${name}" saved successfully.`, 'success');
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
// VOUCHER PRINTING (PRINTABLE HTML)
// ============================================================================

function handlePrintAssemblyVoucher(assembly, varMap, whMap, laborPartyMap) {
  const contentHtml = `
    <div class="p-6 bg-white space-y-5 text-slate-800" id="assembly-voucher-print-area">
      <!-- Header -->
      <div class="flex items-center justify-between border-b-2 border-slate-900 pb-4">
        <div>
          <h1 class="text-xl font-black tracking-tight text-slate-900 uppercase">JS TRADERS ERP</h1>
          <p class="text-xs text-slate-500 font-medium">Production &amp; Equipment Assembly Voucher</p>
        </div>
        <div class="text-right">
          <div class="text-lg font-black text-[#138FCB]">${assembly.assemblyNumber}</div>
          <div class="text-xs text-slate-500 font-semibold">Date: ${assembly.assemblyDate}</div>
        </div>
      </div>

      <!-- Overview Grid -->
      <div class="grid grid-cols-2 gap-4 bg-slate-50 p-4 rounded-xl text-xs">
        <div>
          <span class="text-slate-400 block font-bold uppercase text-[10px]">Produced Product</span>
          <span class="font-extrabold text-sm text-slate-900">${varMap.get(assembly.finishedVariantId) || 'Finished Good'}</span>
          <span class="block text-emerald-600 font-bold text-xs mt-0.5">+ ${assembly.finishedQuantity} Units Produced</span>
        </div>
        <div>
          <span class="text-slate-400 block font-bold uppercase text-[10px]">Production Type &amp; Status</span>
          <span class="font-bold text-slate-800 text-xs">${assembly.assemblyType || 'MANUFACTURING'}</span>
          <span class="block font-bold text-xs ${assembly.status === 'Completed' ? 'text-emerald-700' : 'text-amber-700'}">${assembly.status}</span>
        </div>
        <div>
          <span class="text-slate-400 block font-bold uppercase text-[10px]">Source Warehouse</span>
          <span class="font-semibold text-slate-700">${whMap.get(assembly.sourceWarehouseId || assembly.warehouseId) || 'Main'}</span>
        </div>
        <div>
          <span class="text-slate-400 block font-bold uppercase text-[10px]">Output Warehouse</span>
          <span class="font-semibold text-slate-700">${whMap.get(assembly.outputWarehouseId || assembly.warehouseId) || 'Main'}</span>
        </div>
      </div>

      <!-- Consumed Raw Materials Table -->
      <div class="space-y-2">
        <h3 class="text-xs font-bold uppercase tracking-wider text-slate-500">Consumed Components &amp; Raw Materials</h3>
        <table class="w-full text-left text-xs border border-slate-200">
          <thead class="bg-slate-100 text-slate-600 uppercase text-[10px]">
            <tr>
              <th class="p-2 border-b">Component Description</th>
              <th class="p-2 border-b text-center">Qty Consumed</th>
              <th class="p-2 border-b text-right">Unit Cost</th>
              <th class="p-2 border-b text-right">Total Material Cost</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-slate-100">
            ${(assembly.lines || []).map(l => `
              <tr>
                <td class="p-2 font-medium">${varMap.get(l.componentVariantId) || 'Component'}</td>
                <td class="p-2 text-center font-bold text-rose-600">-${l.quantityConsumed} ${l.unit || 'PCS'}</td>
                <td class="p-2 text-right">Rs. ${Number(l.unitCost || 0).toLocaleString()}</td>
                <td class="p-2 text-right font-bold">Rs. ${(l.quantityConsumed * (l.unitCost || 0)).toLocaleString()}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>

      <!-- Valuation Summary -->
      <div class="border-t border-slate-200 pt-3 flex justify-between items-start text-xs">
        <div class="space-y-1">
          <div class="text-slate-500 font-medium">Labor Party: <strong class="text-slate-800">${laborPartyMap.get(assembly.laborPartyId) || 'Internal'}</strong></div>
          <div class="text-slate-500 font-medium">Labor Payable Status: <strong class="text-amber-700">Unpaid Liability Recorded</strong></div>
          ${assembly.journalEntryId ? `<div class="text-slate-500 font-medium">GL Journal Entry: <strong class="text-[#138FCB]">${assembly.journalEntryId}</strong></div>` : ''}
        </div>
        <div class="w-64 space-y-1.5 text-right">
          <div class="flex justify-between text-slate-600">
            <span>Material Cost:</span>
            <span class="font-bold">Rs. ${Number(assembly.totalMaterialCost || 0).toLocaleString()}</span>
          </div>
          <div class="flex justify-between text-slate-600">
            <span>Assembly Labor:</span>
            <span class="font-bold">Rs. ${Number(assembly.totalLaborCost || 0).toLocaleString()}</span>
          </div>
          <div class="flex justify-between text-slate-900 font-black text-sm pt-1 border-t border-slate-300">
            <span>Total Cost:</span>
            <span>Rs. ${Number(assembly.totalAssemblyCost || 0).toLocaleString()}</span>
          </div>
          <div class="flex justify-between text-emerald-700 font-extrabold text-xs">
            <span>Unit Cost:</span>
            <span>Rs. ${Number(assembly.unitFinishedCost || 0).toLocaleString()} / unit</span>
          </div>
        </div>
      </div>
    </div>
  `;

  openModal({
    title: `Assembly Voucher: ${assembly.assemblyNumber}`,
    subtitle: 'Official production record and cost valuation voucher',
    badge: assembly.assemblyNumber,
    contentHtml,
    size: 'max-w-3xl',
    footerHtml: `
      <div class="flex items-center justify-between w-full">
        <button id="voucher-close-btn" class="px-4 py-2 text-xs font-semibold text-slate-600 bg-slate-100 rounded-xl cursor-pointer">Close</button>
        <button onclick="window.print()" class="px-5 py-2 text-xs font-bold text-white bg-[#138FCB] rounded-xl shadow-xs cursor-pointer">
          🖨 Print / Save PDF
        </button>
      </div>
    `,
    onOpen: (modalEl) => {
      modalEl.querySelector('#voucher-close-btn').onclick = () => closeModal();
    }
  });
}

function handlePrintDisassemblyVoucher(disassembly, varMap, whMap) {
  const contentHtml = `
    <div class="p-6 bg-white space-y-5 text-slate-800">
      <div class="flex items-center justify-between border-b-2 border-slate-900 pb-4">
        <div>
          <h1 class="text-xl font-black tracking-tight text-slate-900 uppercase">JS TRADERS ERP</h1>
          <p class="text-xs text-slate-500 font-medium">Standalone Disassembly &amp; Teardown Voucher</p>
        </div>
        <div class="text-right">
          <div class="text-lg font-black text-rose-600">${disassembly.disassemblyNumber}</div>
          <div class="text-xs text-slate-500 font-semibold">Date: ${disassembly.disassemblyDate}</div>
        </div>
      </div>

      <div class="grid grid-cols-2 gap-4 bg-slate-50 p-4 rounded-xl text-xs">
        <div>
          <span class="text-slate-400 block font-bold uppercase text-[10px]">Dismantled Product</span>
          <span class="font-extrabold text-sm text-slate-900">${varMap.get(disassembly.sourceVariantId) || 'Source Item'}</span>
          <span class="block text-rose-600 font-bold text-xs mt-0.5">- ${disassembly.disassembledQuantity} Units Dismantled</span>
        </div>
        <div>
          <span class="text-slate-400 block font-bold uppercase text-[10px]">Warehouse</span>
          <span class="font-bold text-slate-800 text-xs">${whMap.get(disassembly.warehouseId) || 'Main Warehouse'}</span>
        </div>
      </div>

      <div class="space-y-2">
        <h3 class="text-xs font-bold uppercase tracking-wider text-slate-500">Recovered Reusable Components</h3>
        <table class="w-full text-left text-xs border border-slate-200">
          <thead class="bg-slate-100 text-slate-600 uppercase text-[10px]">
            <tr>
              <th class="p-2 border-b">Recovered Component</th>
              <th class="p-2 border-b text-center">Qty Recovered</th>
              <th class="p-2 border-b text-right">Unit Value</th>
              <th class="p-2 border-b text-right">Total Recovered Value</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-slate-100">
            ${(disassembly.recoveredComponents || []).map(r => `
              <tr>
                <td class="p-2 font-medium">${varMap.get(r.componentVariantId) || 'Component'}</td>
                <td class="p-2 text-center font-bold text-emerald-600">+${r.quantityRecovered} ${r.unit || 'PCS'}</td>
                <td class="p-2 text-right">Rs. ${Number(r.unitCost || 0).toLocaleString()}</td>
                <td class="p-2 text-right font-bold">Rs. ${(r.quantityRecovered * (r.unitCost || 0)).toLocaleString()}</td>
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
