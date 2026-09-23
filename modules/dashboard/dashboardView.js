/**
 * JS Traders ERP - Comprehensive Multi-Role Dashboard View
 * Faithfully styled to match Design/code 2.html.
 * Adapts widgets automatically based on active role (Executive, Warehouse Manager, Salesperson).
 */

import { authService } from '../../services/authService.js';
import { inventoryService } from '../../services/inventoryService.js';
import { storageService } from '../../services/storageService.js';
import { renderMetricCard } from '../../components/cards.js';

export function renderDashboardView() {
  const user = authService.getCurrentUser();
  const role = authService.getRole();
  const canViewCost = authService.canViewCostProfit();

  // Common metrics
  const balances = inventoryService.getAllBalances();
  const lowStockCount = balances.filter(b => b.isLowStock).length;
  const negativeStockCount = balances.filter(b => b.isNegative).length;
  const gatepasses = storageService.getCollection('gatepasses');
  const pendingGatepasses = gatepasses.filter(g => g.status === 'Draft' || g.status === 'Rates Pending');
  const deliveries = storageService.getCollection('deliveries');
  const pendingDeliveries = deliveries.filter(d => d.status === 'Draft');
  const shipments = storageService.getCollection('importShipments');
  const activeShipments = shipments.filter(s => s.status !== 'Delivered');

  return `
    <div class="space-y-6 animate-in fade-in duration-200">
      <!-- Welcome Banner Row with Action Buttons -->
      <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 class="text-2xl font-bold tracking-tight text-[#1A1D1F]">Welcome back, ${user.fullName}</h1>
          <p class="text-xs text-slate-500 mt-0.5">Role: <strong class="text-[#138FCB]">${authService.getRoleDisplayName(role)}</strong> | Active Warehouse: <span class="font-semibold text-slate-700">Main Warehouse Lahore</span></p>
        </div>
        <div class="flex items-center flex-wrap gap-2.5">
          <!-- Daily Filter -->
          <button class="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-white border border-[#E3E6EB] rounded-lg hover:border-gray-400 shadow-2xs transition-colors cursor-pointer">
            <span>Fiscal Year 2025-26</span>
          </button>
          <!-- Date Picker Button -->
          <button class="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-white border border-[#E3E6EB] rounded-lg hover:border-gray-400 shadow-2xs transition-colors">
            <svg class="w-3.5 h-3.5 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8"></path>
            </svg>
            <span class="font-medium text-headingText">Today: 22 Sep 2026</span>
          </button>
          <!-- Quick Role Switcher Pill -->
          <div class="flex items-center gap-1 bg-[#F5F6F8] p-1 rounded-xl border border-slate-200 text-xs">
            <span class="text-[10px] uppercase font-bold text-slate-400 px-2">Role:</span>
            <select id="dashboard-role-select" class="text-xs font-bold text-[#138FCB] bg-transparent focus:outline-none cursor-pointer">
              <option value="owner" ${role === 'owner' ? 'selected' : ''}>Owner</option>
              <option value="admin" ${role === 'admin' ? 'selected' : ''}>Admin</option>
              <option value="warehouse_manager" ${role === 'warehouse_manager' ? 'selected' : ''}>Warehouse Manager</option>
              <option value="warehouse_staff" ${role === 'warehouse_staff' ? 'selected' : ''}>Warehouse Staff</option>
              <option value="sales_person" ${role === 'sales_person' ? 'selected' : ''}>Sales Representative</option>
              <option value="accounts" ${role === 'accounts' ? 'selected' : ''}>Accounts</option>
            </select>
          </div>
        </div>
      </div>

      <!-- Warehouse Operations Quick Links Banner -->
      <div class="bg-gradient-to-r from-slate-900 to-slate-800 text-white p-4 rounded-2xl flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-xs">
        <div class="flex items-center gap-3">
          <div class="w-10 h-10 rounded-xl bg-blue-500/20 text-[#138FCB] flex items-center justify-center text-lg">
            📱
          </div>
          <div>
            <h3 class="text-xs font-bold text-white">Warehouse Staff & Mobile Access</h3>
            <p class="text-[11px] text-slate-300">Manage floor staff credentials, PIN codes, and mobile pick proof verification</p>
          </div>
        </div>
        <div class="flex items-center gap-2 flex-wrap">
          <button id="dash-staff-btn" class="px-3.5 py-1.5 rounded-xl text-xs font-bold bg-[#138FCB] hover:bg-[#0E78AC] text-white transition-colors cursor-pointer shadow-xs">
            👥 Manage Staff & PINs
          </button>
          <a href="mobile.html" target="_blank" class="px-3 py-1.5 rounded-xl text-xs font-bold bg-white/10 hover:bg-white/20 text-white transition-colors cursor-pointer">
            📱 Staff App ↗
          </a>
          <a href="mobile-reports.html" target="_blank" class="px-3 py-1.5 rounded-xl text-xs font-bold bg-emerald-600 hover:bg-emerald-500 text-white transition-colors cursor-pointer shadow-xs">
            📊 Reports App ↗
          </a>
        </div>
      </div>

      <!-- KPI Metrics Cards Grid -->
      <section class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        ${canViewCost ? renderMetricCard({
          title: 'Total Stock Valuation',
          value: 'Rs. ' + Math.round(balances.reduce((s, b) => s + (b.stockValue || 0), 0)).toLocaleString(),
          delta: '+12.4% vs last quarter',
          deltaPositive: true,
          bars: [3, 5, 7, 8, 10]
        }) : renderMetricCard({
          title: 'Total Stock Items',
          value: balances.length,
          unit: 'SKUs',
          delta: 'All warehouses active',
          deltaPositive: true,
          bars: [4, 6, 7, 5, 8]
        })}

        ${renderMetricCard({
          title: 'Pending Gatepasses',
          value: pendingGatepasses.length,
          unit: 'Awaiting Rates',
          delta: `${gatepasses.length} Total Issued`,
          deltaPositive: pendingGatepasses.length === 0,
          bars: [2, 3, 5, 4, 3]
        })}

        ${renderMetricCard({
          title: 'Low Stock Alerts',
          value: lowStockCount,
          unit: 'Items',
          delta: `${negativeStockCount} Negative Stock`,
          deltaPositive: lowStockCount === 0,
          bars: [6, 8, 4, 7, 9]
        })}

        ${renderMetricCard({
          title: 'Active Import Shipments',
          value: activeShipments.length,
          unit: 'Containers',
          delta: 'Tracktainer live tracking',
          deltaPositive: true,
          bars: [2, 4, 6, 8, 7]
        })}
      </section>

      <!-- Middle Analytics Row: Sales Trend Matrix & Revenue / Stock Breakdown -->
      <section class="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <!-- Left Column (8 Columns): Sales & Movement Trend -->
        <div class="lg:col-span-8 bg-white rounded-2xl p-5 sm:p-6 border border-[#EAECEF] shadow-[0_2px_4px_rgba(0,0,0,0.02)] flex flex-col justify-between">
          <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-[#F4F5F7]">
            <div class="flex items-center gap-1.5">
              <h3 class="text-xs font-bold uppercase tracking-wider text-gray-500">Inventory Throughput & Movements</h3>
              <div class="w-3.5 h-3.5 rounded-full border border-gray-300 flex items-center justify-center text-[9px] text-gray-400 font-serif">i</div>
            </div>
            <div class="flex items-center gap-1 bg-[#F5F6F8] p-1 rounded-xl text-xs font-semibold">
              <button class="px-3 py-1 rounded-lg text-neutralText hover:text-black">Weekly</button>
              <button class="px-3 py-1 rounded-lg bg-[#138FCB] text-white shadow-xs font-bold">Monthly</button>
              <button class="px-3 py-1 rounded-lg text-neutralText hover:text-black">Yearly</button>
            </div>
          </div>

          <!-- Total Revenue Legend Row -->
          <div class="flex flex-wrap items-center justify-between gap-3 mt-4">
            <div class="flex items-baseline gap-2">
              <span class="text-xs text-neutralText font-medium">Monthly Outward Deliveries:</span>
              <span class="text-xl font-extrabold text-[#138FCB]">4,820 Units</span>
            </div>
            <div class="flex items-center gap-5 text-xs font-medium">
              <div class="flex items-center gap-2">
                <span class="w-2.5 h-2.5 rounded-full bg-[#E0E2E7]"></span>
                <span class="text-neutralText text-[11px] font-bold tracking-tight">INWARD (IMPORTS)</span>
              </div>
              <div class="flex items-center gap-2">
                <span class="w-2.5 h-2.5 rounded-full bg-[#138FCB]"></span>
                <span class="text-headingText text-[11px] font-bold tracking-tight">OUTWARD (DELIVERIES)</span>
              </div>
            </div>
          </div>

          <!-- Graphic Columns -->
          <div class="relative mt-6 pt-2 h-44 flex items-end justify-between px-4 border-b border-slate-100">
            ${['APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP'].map((m, idx) => `
              <div class="flex flex-col items-center gap-2">
                <div class="flex items-end gap-1.5 h-28">
                  <div class="w-4 bg-slate-200 rounded-t" style="height: ${(idx + 2) * 15}px;"></div>
                  <div class="w-4 bg-[#138FCB] rounded-t" style="height: ${(idx + 3) * 18}px;"></div>
                </div>
                <span class="text-[11px] font-bold text-slate-400">${m}</span>
              </div>
            `).join('')}
          </div>
        </div>

        <!-- Right Column (4 Columns): Stock Category Breakdown -->
        <div class="lg:col-span-4 bg-white rounded-2xl p-5 sm:p-6 border border-[#EAECEF] shadow-[0_2px_4px_rgba(0,0,0,0.02)] flex flex-col justify-between">
          <div>
            <div class="flex items-center justify-between pb-2 border-b border-[#F4F5F7]">
              <div class="flex items-center gap-1.5">
                <h3 class="text-xs font-bold uppercase tracking-wider text-gray-500">Stock by Category</h3>
                <div class="w-3.5 h-3.5 rounded-full border border-gray-300 flex items-center justify-center text-[9px] text-gray-400 font-serif">i</div>
              </div>
              <span class="text-xs font-bold text-[#138FCB]">6 Categories</span>
            </div>

            <!-- Categories progress list -->
            <div class="mt-4 space-y-3">
              <div>
                <div class="flex justify-between text-xs font-semibold mb-1">
                  <span>Feeding Equipment</span>
                  <span class="text-slate-500">2,070 pcs</span>
                </div>
                <div class="w-full bg-slate-100 h-2 rounded-full overflow-hidden">
                  <div class="bg-[#138FCB] h-full rounded-full" style="width: 45%;"></div>
                </div>
              </div>

              <div>
                <div class="flex justify-between text-xs font-semibold mb-1">
                  <span>Drinking Equipment</span>
                  <span class="text-slate-500">14,500 pcs</span>
                </div>
                <div class="w-full bg-slate-100 h-2 rounded-full overflow-hidden">
                  <div class="bg-emerald-500 h-full rounded-full" style="width: 70%;"></div>
                </div>
              </div>

              <div>
                <div class="flex justify-between text-xs font-semibold mb-1">
                  <span>Pipes & Fittings (Rolls)</span>
                  <span class="text-slate-500">25,000 ft</span>
                </div>
                <div class="w-full bg-slate-100 h-2 rounded-full overflow-hidden">
                  <div class="bg-amber-500 h-full rounded-full" style="width: 80%;"></div>
                </div>
              </div>

              <div>
                <div class="flex justify-between text-xs font-semibold mb-1">
                  <span>Evaporative Cooling</span>
                  <span class="text-slate-500">48 units</span>
                </div>
                <div class="w-full bg-slate-100 h-2 rounded-full overflow-hidden">
                  <div class="bg-purple-500 h-full rounded-full" style="width: 30%;"></div>
                </div>
              </div>
            </div>
          </div>

          <!-- Quick Navigation Tip -->
          <div class="mt-4 p-3 bg-slate-50 rounded-xl border border-slate-200 text-xs text-slate-600 flex items-center justify-between">
            <span>Operational Mode: <strong>Local Enterprise Prototype</strong></span>
            <span class="w-2 h-2 rounded-full bg-emerald-500"></span>
          </div>
        </div>
      </section>

      <!-- Recent Operational Activity Section -->
      <section class="bg-white rounded-2xl p-5 sm:p-6 border border-[#EAECEF] shadow-[0_2px_4px_rgba(0,0,0,0.02)] space-y-4">
        <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-2 border-b border-slate-100">
          <div>
            <h3 class="text-xs font-bold uppercase tracking-wider text-gray-500">Recent Operational Transactions</h3>
            <p class="text-xs text-slate-400 mt-0.5">Real-time gatepasses, deliveries and confirmed stock movements</p>
          </div>
          <div class="flex items-center gap-2">
            <span class="inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-semibold bg-emerald-50 text-emerald-700">
              ● All Systems Normal
            </span>
          </div>
        </div>

        <div class="overflow-x-auto">
          <table class="w-full text-left text-xs text-[#6F767E]">
            <thead>
              <tr class="border-b border-[#ECEEF2] text-[11px] uppercase font-bold text-gray-400 tracking-wider">
                <th class="py-3 px-3">Doc #</th>
                <th class="py-3 px-3">Type</th>
                <th class="py-3 px-4">Customer / Partner</th>
                <th class="py-3 px-4">Warehouse</th>
                <th class="py-3 px-4">Status</th>
                <th class="py-3 px-4">Date</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-[#F4F5F7]">
              <tr class="hover:bg-slate-50/80">
                <td class="py-3 px-3 font-bold text-[#138FCB]">GP-00001</td>
                <td class="py-3 px-3"><span class="px-2 py-0.5 rounded bg-blue-50 text-blue-700 font-semibold text-[10px]">Gatepass</span></td>
                <td class="py-3 px-4 font-medium text-slate-800">Ali Poultry Group (Farm 1 Bhai Pheru)</td>
                <td class="py-3 px-4">Main Warehouse Lahore</td>
                <td class="py-3 px-4"><span class="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-amber-50 text-amber-700">Rates Pending</span></td>
                <td class="py-3 px-4">16 Sep 2025</td>
              </tr>
              <tr class="hover:bg-slate-50/80">
                <td class="py-3 px-3 font-bold text-[#138FCB]">DEL-00001</td>
                <td class="py-3 px-3"><span class="px-2 py-0.5 rounded bg-purple-50 text-purple-700 font-semibold text-[10px]">Delivery</span></td>
                <td class="py-3 px-4 font-medium text-slate-800">Ali Poultry Group (40 Feed Pans)</td>
                <td class="py-3 px-4">Main Warehouse Lahore</td>
                <td class="py-3 px-4"><span class="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700">Confirmed (Stock Deducted)</span></td>
                <td class="py-3 px-4">16 Sep 2025</td>
              </tr>
              <tr class="hover:bg-slate-50/80">
                <td class="py-3 px-3 font-bold text-[#138FCB]">ASM-00001</td>
                <td class="py-3 px-3"><span class="px-2 py-0.5 rounded bg-cyan-50 text-cyan-700 font-semibold text-[10px]">Assembly</span></td>
                <td class="py-3 px-4 font-medium text-slate-800">Air Cooler 1.5 kW Assembly (2 Units)</td>
                <td class="py-3 px-4">Main Warehouse Lahore</td>
                <td class="py-3 px-4"><span class="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700">Confirmed</span></td>
                <td class="py-3 px-4">12 Sep 2025</td>
              </tr>
              <tr class="hover:bg-slate-50/80">
                <td class="py-3 px-3 font-bold text-[#138FCB]">IMP-00001</td>
                <td class="py-3 px-3"><span class="px-2 py-0.5 rounded bg-amber-50 text-amber-700 font-semibold text-[10px]">Import Container</span></td>
                <td class="py-3 px-4 font-medium text-slate-800">Ningbo Agri-Tech (MSCU-8491024)</td>
                <td class="py-3 px-4">Transit Karachi QICT</td>
                <td class="py-3 px-4"><span class="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-blue-50 text-blue-700">In Transit (Indian Ocean)</span></td>
                <td class="py-3 px-4">02 Sep 2025</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </div>
  `;
}

export function bindDashboardEvents(container, onNavigate) {
  const roleSelect = container.querySelector('#dashboard-role-select');
  if (roleSelect) {
    roleSelect.onchange = (e) => {
      authService.switchRole(e.target.value);
    };
  }

  const staffBtn = container.querySelector('#dash-staff-btn');
  if (staffBtn) {
    staffBtn.onclick = () => {
      window.app?.navigateTo('warehouse-staff');
    };
  }
}
