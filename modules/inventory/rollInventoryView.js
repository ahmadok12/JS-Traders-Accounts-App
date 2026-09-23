/**
 * JS Traders ERP - Cut-to-Length & Multi-Roll Packaging Inventory View
 * Tracks physical full rolls, individual loose pieces, and transaction audit trail.
 */

import { cutToLengthService } from '../../services/cutToLengthService.js';
import { productService } from '../../services/productService.js';
import { warehouseService } from '../../services/warehouseService.js';
import { authService } from '../../services/authService.js';
import { openModal, closeModal } from '../../components/modal.js';
import { toast } from '../../components/toast.js';

// State management for view
let currentSelectedProductId = null;
let currentWarehouseId = 'all';
let currentVariantId = 'all';
let currentActiveTab = 'physical'; // 'physical' | 'audit'

export function renderRollInventoryView() {
  const ctlProducts = productService.getProducts().filter(p => p.cut_to_length);
  const warehouses = warehouseService.getWarehouses();

  if (ctlProducts.length === 0) {
    return `
      <div class="bg-white p-8 rounded-2xl border border-slate-200 text-center space-y-3">
        <div class="text-4xl">📏</div>
        <h3 class="text-lg font-bold text-slate-800">No Cut-to-Length Products Configured</h3>
        <p class="text-xs text-slate-500 max-w-md mx-auto">
          Enable the <strong>☑ Cut to Length</strong> option in Product Master to manage full rolls and loose continuous pieces here.
        </p>
      </div>
    `;
  }

  if (!currentSelectedProductId || !ctlProducts.some(p => p.id === currentSelectedProductId)) {
    currentSelectedProductId = ctlProducts[0].id;
    currentVariantId = 'all';
  }

  const selectedProduct = productService.getProductById(currentSelectedProductId);
  const productVariants = productService.getVariantsByProduct(currentSelectedProductId) || [];
  const summary = cutToLengthService.getSummary(currentSelectedProductId, currentWarehouseId, currentVariantId);
  const transactions = cutToLengthService.getTransactions(currentSelectedProductId, 100);

  const baseUnit = selectedProduct?.base_unit || 'ft';

  return `
    <div id="ctl-inventory-container" class="space-y-6 animate-in fade-in duration-150">
      <!-- Top Header & Filter Controls -->
      <div class="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 bg-white p-4 rounded-2xl border border-slate-200 shadow-2xs">
        <div class="flex flex-wrap items-center gap-3 w-full md:w-auto">
          <!-- Product Selector -->
          <div>
            <label class="block text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">Product</label>
            <select id="ctl-product-select" class="border border-slate-200 rounded-xl px-3 py-1.5 text-xs font-bold text-slate-800 bg-slate-50 focus:outline-none focus:border-[#138FCB] cursor-pointer">
              ${ctlProducts.map(p => `
                <option value="${p.id}" ${p.id === currentSelectedProductId ? 'selected' : ''}>
                  ${p.businessName} ${p.customerName ? `(${p.customerName})` : ''}
                </option>
              `).join('')}
            </select>
          </div>

          <!-- Variation Selector (shown if product has multiple variants e.g. 400ft vs 450ft) -->
          ${productVariants.length > 1 ? `
            <div>
              <label class="block text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">Variation / Roll Size</label>
              <select id="ctl-variant-select" class="border border-slate-200 rounded-xl px-3 py-1.5 text-xs font-bold text-slate-800 bg-slate-50 focus:outline-none focus:border-[#138FCB] cursor-pointer">
                <option value="all" ${currentVariantId === 'all' ? 'selected' : ''}>All Variations</option>
                ${productVariants.map(v => `
                  <option value="${v.id}" ${v.id === currentVariantId ? 'selected' : ''}>
                    ${v.sku} (${v.rollSize ? `${v.rollSize} ft Roll` : v.name})
                  </option>
                `).join('')}
              </select>
            </div>
          ` : ''}

          <!-- Warehouse Selector -->
          <div>
            <label class="block text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">Warehouse</label>
            <select id="ctl-warehouse-select" class="border border-slate-200 rounded-xl px-3 py-1.5 text-xs font-semibold text-slate-800 bg-slate-50 focus:outline-none focus:border-[#138FCB] cursor-pointer">
              <option value="all" ${currentWarehouseId === 'all' ? 'selected' : ''}>All Warehouses</option>
              ${warehouses.map(w => `
                <option value="${w.id}" ${w.id === currentWarehouseId ? 'selected' : ''}>${w.name}</option>
              `).join('')}
            </select>
          </div>
        </div>

        <!-- Quick Action Buttons -->
        <div class="flex flex-wrap items-center gap-2">
          <button id="ctl-btn-receive" class="flex items-center gap-1.5 px-3 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-xl shadow-xs transition-colors cursor-pointer">
            <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"/></svg>
            Receive Full Rolls
          </button>
          <button id="ctl-btn-add-loose" class="flex items-center gap-1.5 px-3 py-2 bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold rounded-xl shadow-xs transition-colors cursor-pointer">
            <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"/></svg>
            Add Loose Piece
          </button>
          <button id="ctl-btn-cut" class="flex items-center gap-1.5 px-3 py-2 bg-[#138FCB] hover:bg-[#0E78AC] text-white text-xs font-bold rounded-xl shadow-xs transition-colors cursor-pointer">
            <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14.121 14.121L19 19m-7-7l7-7m-7 7l-2.879 2.879M12 12L9.121 9.121m0 5.758a3 3 0 10-4.243 4.243 3 3 0 004.243-4.243zm0-5.758a3 3 0 10-4.243-4.243 3 3 0 004.243 4.243z"/></svg>
            Cut Length
          </button>
        </div>
      </div>

      <!-- Live Metric Summary Banner -->
      <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <!-- Full Rolls Card -->
        <div class="bg-white p-5 rounded-2xl border border-slate-200 shadow-2xs">
          <div class="flex items-center justify-between">
            <span class="text-[10px] font-bold uppercase tracking-wider text-slate-400">Full Standard Rolls</span>
            <span class="px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-emerald-50 text-emerald-700">Sealed</span>
          </div>
          <p class="text-3xl font-extrabold text-emerald-600 mt-2">
            ${summary.fullRollsCount} <span class="text-xs font-semibold text-slate-500">rolls</span>
          </p>
          <div class="mt-2 text-xs text-slate-600 font-medium">
            ${summary.rollsBySize.map(s => `
              <span class="inline-block bg-slate-100 rounded-lg px-2 py-0.5 text-[11px] font-semibold text-slate-700 mr-1 mb-1">
                ${s.count}x ${s.packagingName}
              </span>
            `).join('') || '<span class="text-slate-400">0 rolls</span>'}
          </div>
          <p class="text-[11px] text-slate-400 mt-1">Total Full: <strong>${summary.fullRollsFootage.toLocaleString()} ${baseUnit}</strong></p>
        </div>

        <!-- Loose Pieces Card -->
        <div class="bg-white p-5 rounded-2xl border border-slate-200 shadow-2xs">
          <div class="flex items-center justify-between">
            <span class="text-[10px] font-bold uppercase tracking-wider text-slate-400">Loose / Off-Cut Pieces</span>
            <span class="px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-amber-50 text-amber-700">Cut Pieces</span>
          </div>
          <p class="text-3xl font-extrabold text-amber-600 mt-2">
            ${summary.loosePiecesCount} <span class="text-xs font-semibold text-slate-500">open pieces</span>
          </p>
          <p class="mt-2 text-xs text-slate-600 font-medium">
            Available Footage: <strong class="text-slate-900">${summary.loosePiecesFootage.toLocaleString()} ${baseUnit}</strong>
          </p>
          <p class="text-[11px] text-slate-400 mt-1">Never anonymous: each piece has continuous length tag</p>
        </div>

        <!-- Total Stock Card -->
        <div class="bg-white p-5 rounded-2xl border border-slate-200 shadow-2xs">
          <div class="flex items-center justify-between">
            <span class="text-[10px] font-bold uppercase tracking-wider text-slate-400">Total Continuous Stock</span>
            <span class="px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-blue-50 text-[#138FCB]">Authoritative</span>
          </div>
          <p class="text-3xl font-extrabold text-[#138FCB] mt-2">
            ${summary.totalFootage.toLocaleString()} <span class="text-xs font-semibold text-slate-500">${baseUnit}</span>
          </p>
          <div class="mt-2 text-xs text-slate-600 flex items-center gap-2">
            <span>Rolls: ${summary.fullRollsFootage.toLocaleString()} ${baseUnit}</span>
            <span>•</span>
            <span>Loose: ${summary.loosePiecesFootage.toLocaleString()} ${baseUnit}</span>
          </div>
          <p class="text-[11px] text-slate-400 mt-1">Synchronized with Warehouse Ledger</p>
        </div>
      </div>

      <!-- Navigation Tabs -->
      <div class="flex items-center gap-2 border-b border-slate-200 pb-2">
        <button id="ctl-tab-physical" class="px-4 py-2 text-xs font-bold rounded-xl transition-all cursor-pointer ${currentActiveTab === 'physical' ? 'bg-[#138FCB] text-white shadow-xs' : 'text-slate-600 hover:bg-slate-100'}">
          Physical Units (Full Rolls & Loose Pieces)
        </button>
        <button id="ctl-tab-audit" class="px-4 py-2 text-xs font-bold rounded-xl transition-all cursor-pointer ${currentActiveTab === 'audit' ? 'bg-[#138FCB] text-white shadow-xs' : 'text-slate-600 hover:bg-slate-100'}">
          Transactions Audit Trail (${transactions.length})
        </button>
      </div>

      <!-- Tab 1: Physical Stock Detail -->
      <div id="ctl-content-physical" class="${currentActiveTab === 'physical' ? 'space-y-6' : 'hidden'}">
        <!-- FULL ROLLS TABLE -->
        <div class="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-2xs">
          <div class="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
            <div>
              <h4 class="font-bold text-slate-800 text-sm">Full Sealed Rolls</h4>
              <p class="text-xs text-slate-400">Untouched factory rolls ready for whole-roll dispatch or cutting</p>
            </div>
            <span class="px-2.5 py-1 rounded-full text-xs font-extrabold bg-emerald-50 text-emerald-700">
              ${summary.fullRolls.length} Rolls Available
            </span>
          </div>

          <div class="overflow-x-auto">
            <table class="w-full text-left text-xs">
              <thead class="bg-slate-50/75 text-slate-500 font-bold uppercase tracking-wider text-[10px] border-b border-slate-100">
                <tr>
                  <th class="px-4 py-3">Tag / ID</th>
                  <th class="px-4 py-3">Packaging / Roll Size</th>
                  <th class="px-4 py-3">Warehouse</th>
                  <th class="px-4 py-3 text-right">Length</th>
                  <th class="px-4 py-3">Status</th>
                  <th class="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-slate-100 text-slate-700">
                ${summary.fullRolls.length === 0 ? `
                  <tr>
                    <td colspan="6" class="px-4 py-8 text-center text-slate-400">No full rolls in stock. Receive new rolls to replenish.</td>
                  </tr>
                ` : summary.fullRolls.map(roll => {
                  const wh = warehouses.find(w => w.id === roll.warehouseId);
                  return `
                    <tr class="hover:bg-slate-50/50 transition-colors">
                      <td class="px-4 py-3 font-extrabold text-[#138FCB]">${roll.code}</td>
                      <td class="px-4 py-3 font-semibold text-slate-800">${roll.packagingName || `${roll.initialQuantity} ${baseUnit}`}</td>
                      <td class="px-4 py-3 text-slate-600">${wh ? wh.name : 'Main Warehouse'}</td>
                      <td class="px-4 py-3 text-right font-extrabold text-slate-900">${Number(roll.quantity).toLocaleString()} ${baseUnit}</td>
                      <td class="px-4 py-3">
                        <span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700">Full Sealed</span>
                      </td>
                      <td class="px-4 py-3 text-right">
                        <button class="ctl-action-cut px-2.5 py-1 text-[11px] font-bold text-white bg-[#138FCB] hover:bg-[#0E78AC] rounded-lg transition-colors cursor-pointer" data-unit-id="${roll.id}">
                          Cut Length
                        </button>
                      </td>
                    </tr>
                  `;
                }).join('')}
              </tbody>
            </table>
          </div>
        </div>

        <!-- LOOSE PIECES TABLE -->
        <div class="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-2xs">
          <div class="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
            <div>
              <h4 class="font-bold text-slate-800 text-sm">Loose / Off-Cut Pieces</h4>
              <p class="text-xs text-slate-400">Continuous physical pieces resulting from previous cuts or manual adjustments</p>
            </div>
            <span class="px-2.5 py-1 rounded-full text-xs font-extrabold bg-amber-50 text-amber-700">
              ${summary.loosePieces.length} Loose Pieces
            </span>
          </div>

          <div class="overflow-x-auto">
            <table class="w-full text-left text-xs">
              <thead class="bg-slate-50/75 text-slate-500 font-bold uppercase tracking-wider text-[10px] border-b border-slate-100">
                <tr>
                  <th class="px-4 py-3">Tag / ID</th>
                  <th class="px-4 py-3 text-right">Current Length</th>
                  <th class="px-4 py-3 text-right">Original Full Length</th>
                  <th class="px-4 py-3">Origin / Parent Roll</th>
                  <th class="px-4 py-3">Warehouse</th>
                  <th class="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-slate-100 text-slate-700">
                ${summary.loosePieces.length === 0 ? `
                  <tr>
                    <td colspan="6" class="px-4 py-8 text-center text-slate-400">No loose pieces currently open.</td>
                  </tr>
                ` : summary.loosePieces.map(piece => {
                  const wh = warehouses.find(w => w.id === piece.warehouseId);
                  const parentRoll = piece.parentUnitId ? cutToLengthService.getUnitById(piece.parentUnitId) : null;
                  return `
                    <tr class="hover:bg-slate-50/50 transition-colors">
                      <td class="px-4 py-3 font-extrabold text-amber-600">${piece.code}</td>
                      <td class="px-4 py-3 text-right font-black text-slate-900 text-sm">${Number(piece.quantity).toLocaleString()} ${baseUnit}</td>
                      <td class="px-4 py-3 text-right text-slate-500">${Number(piece.initialQuantity || piece.quantity).toLocaleString()} ${baseUnit}</td>
                      <td class="px-4 py-3 text-slate-600 font-medium">
                        ${parentRoll ? `From Roll <span class="font-bold text-[#138FCB]">${parentRoll.code}</span>` : (piece.notes || 'Manual Entry')}
                      </td>
                      <td class="px-4 py-3 text-slate-600">${wh ? wh.name : 'Main Warehouse'}</td>
                      <td class="px-4 py-3 text-right space-x-1">
                        <button class="ctl-action-cut px-2.5 py-1 text-[11px] font-bold text-white bg-[#138FCB] hover:bg-[#0E78AC] rounded-lg transition-colors cursor-pointer" data-unit-id="${piece.id}">
                          Cut Length
                        </button>
                        <button class="ctl-action-adjust px-2.5 py-1 text-[11px] font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors cursor-pointer" data-unit-id="${piece.id}">
                          Adjust Length
                        </button>
                      </td>
                    </tr>
                  `;
                }).join('')}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <!-- Tab 2: Audit Trail -->
      <div id="ctl-content-audit" class="${currentActiveTab === 'audit' ? '' : 'hidden'}">
        <div class="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-2xs">
          <div class="px-5 py-4 border-b border-slate-100">
            <h4 class="font-bold text-slate-800 text-sm">Cut-to-Length Audit Trail</h4>
            <p class="text-xs text-slate-400">Immutable ledger of all roll receipts, opens, cuts, and manual adjustments</p>
          </div>

          <div class="overflow-x-auto">
            <table class="w-full text-left text-xs">
              <thead class="bg-slate-50/75 text-slate-500 font-bold uppercase tracking-wider text-[10px] border-b border-slate-100">
                <tr>
                  <th class="px-4 py-3">Date & Time</th>
                  <th class="px-4 py-3">Type</th>
                  <th class="px-4 py-3">Reference</th>
                  <th class="px-4 py-3">Source Tag</th>
                  <th class="px-4 py-3 text-right">Issued / Cut</th>
                  <th class="px-4 py-3 text-right">Remaining Balance</th>
                  <th class="px-4 py-3">Notes & Reason</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-slate-100 text-slate-700">
                ${transactions.length === 0 ? `
                  <tr>
                    <td colspan="7" class="px-4 py-8 text-center text-slate-400">No transactions recorded yet.</td>
                  </tr>
                ` : transactions.map(tx => {
                  let badgeClass = 'bg-slate-100 text-slate-700';
                  if (tx.transactionType === 'INITIAL_PURCHASE') badgeClass = 'bg-emerald-50 text-emerald-700';
                  if (tx.transactionType === 'SALE_FULL_ROLL') badgeClass = 'bg-blue-50 text-[#138FCB]';
                  if (tx.transactionType === 'SALE_CUT' || tx.transactionType === 'MANUAL_CUT') badgeClass = 'bg-amber-50 text-amber-700';
                  if (tx.transactionType === 'ROLL_OPEN') badgeClass = 'bg-purple-50 text-purple-700';
                  if (tx.transactionType === 'RETURN') badgeClass = 'bg-rose-50 text-rose-700';

                  const dateStr = tx.createdAt ? new Date(tx.createdAt).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' }) : '-';
                  return `
                    <tr class="hover:bg-slate-50/50 transition-colors">
                      <td class="px-4 py-3 text-slate-500 whitespace-nowrap">${dateStr}</td>
                      <td class="px-4 py-3">
                        <span class="px-2 py-0.5 rounded-full text-[10px] font-bold ${badgeClass}">
                          ${tx.transactionType}
                        </span>
                      </td>
                      <td class="px-4 py-3 font-semibold text-slate-800">${tx.referenceDocId || '-'}</td>
                      <td class="px-4 py-3 font-bold text-slate-900">${tx.sourceCode || '-'}</td>
                      <td class="px-4 py-3 text-right font-bold text-rose-600">${tx.issuedLength ? `-${Number(tx.issuedLength).toLocaleString()} ${baseUnit}` : '-'}</td>
                      <td class="px-4 py-3 text-right font-extrabold text-slate-900">${tx.remainingLength !== undefined ? `${Number(tx.remainingLength).toLocaleString()} ${baseUnit}` : '-'}</td>
                      <td class="px-4 py-3 text-slate-600 max-w-xs truncate">${tx.notes || '-'}</td>
                    </tr>
                  `;
                }).join('')}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  `;
}

export function bindRollInventoryEvents(container, refreshCallback) {
  // Product switch
  const prodSelect = container.querySelector('#ctl-product-select');
  if (prodSelect) {
    prodSelect.onchange = (e) => {
      currentSelectedProductId = e.target.value;
      currentVariantId = 'all';
      if (refreshCallback) refreshCallback();
    };
  }

  // Variant switch
  const varSelect = container.querySelector('#ctl-variant-select');
  if (varSelect) {
    varSelect.onchange = (e) => {
      currentVariantId = e.target.value;
      if (refreshCallback) refreshCallback();
    };
  }

  // Warehouse switch
  const whSelect = container.querySelector('#ctl-warehouse-select');
  if (whSelect) {
    whSelect.onchange = (e) => {
      currentWarehouseId = e.target.value;
      if (refreshCallback) refreshCallback();
    };
  }

  // Tab switching
  const tabPhysical = container.querySelector('#ctl-tab-physical');
  const tabAudit = container.querySelector('#ctl-tab-audit');
  const contentPhysical = container.querySelector('#ctl-content-physical');
  const contentAudit = container.querySelector('#ctl-content-audit');

  if (tabPhysical && tabAudit) {
    tabPhysical.onclick = () => {
      currentActiveTab = 'physical';
      tabPhysical.className = 'px-4 py-2 text-xs font-bold rounded-xl transition-all cursor-pointer bg-[#138FCB] text-white shadow-xs';
      tabAudit.className = 'px-4 py-2 text-xs font-bold rounded-xl transition-all cursor-pointer text-slate-600 hover:bg-slate-100';
      contentPhysical.classList.remove('hidden');
      contentAudit.classList.add('hidden');
    };

    tabAudit.onclick = () => {
      currentActiveTab = 'audit';
      tabAudit.className = 'px-4 py-2 text-xs font-bold rounded-xl transition-all cursor-pointer bg-[#138FCB] text-white shadow-xs';
      tabPhysical.className = 'px-4 py-2 text-xs font-bold rounded-xl transition-all cursor-pointer text-slate-600 hover:bg-slate-100';
      contentAudit.classList.remove('hidden');
      contentPhysical.classList.add('hidden');
    };
  }

  // Top action buttons
  const btnReceive = container.querySelector('#ctl-btn-receive');
  if (btnReceive) {
    btnReceive.onclick = () => openReceiveModal(currentSelectedProductId, refreshCallback);
  }

  const btnAddLoose = container.querySelector('#ctl-btn-add-loose');
  if (btnAddLoose) {
    btnAddLoose.onclick = () => openAddLooseModal(currentSelectedProductId, refreshCallback);
  }

  const btnCut = container.querySelector('#ctl-btn-cut');
  if (btnCut) {
    btnCut.onclick = () => openCutModal(currentSelectedProductId, null, refreshCallback);
  }

  // Table action buttons
  container.querySelectorAll('.ctl-action-cut').forEach(btn => {
    btn.onclick = () => {
      const unitId = btn.getAttribute('data-unit-id');
      openCutModal(currentSelectedProductId, unitId, refreshCallback);
    };
  });

  container.querySelectorAll('.ctl-action-adjust').forEach(btn => {
    btn.onclick = () => {
      const unitId = btn.getAttribute('data-unit-id');
      openAdjustModal(unitId, refreshCallback);
    };
  });
}

/**
 * Modal to receive incoming full rolls of a selected packaging size
 */
function openReceiveModal(productId, onSaved) {
  const product = productService.getProductById(productId);
  const productVariants = productService.getVariantsByProduct(productId) || [];
  const warehouses = warehouseService.getWarehouses();
  const packagingUnits = product.packagingUnits || [
    { factor: product.full_unit_quantity || 5000, name: `Roll (${product.full_unit_quantity || 5000} ${product.base_unit || 'ft'})` }
  ];

  const contentHtml = `
    <form id="ctl-receive-form" class="space-y-4 text-xs">
      <div>
        <label class="block font-bold text-slate-700 mb-1">Target Warehouse *</label>
        <select id="ctl-rec-warehouse" class="w-full border border-slate-200 rounded-xl px-3 py-2 text-slate-800 font-semibold focus:outline-none focus:border-[#138FCB]">
          ${warehouses.map(w => `<option value="${w.id}">${w.name}</option>`).join('')}
        </select>
      </div>

      ${productVariants.length > 1 ? `
        <div>
          <label class="block font-bold text-slate-700 mb-1">Product Variation *</label>
          <select id="ctl-rec-variant" class="w-full border border-slate-200 rounded-xl px-3 py-2 text-slate-800 font-semibold focus:outline-none focus:border-[#138FCB]">
            ${productVariants.map(v => `<option value="${v.id}">${v.sku} (${v.name})</option>`).join('')}
          </select>
        </div>
      ` : ''}

      <div>
        <label class="block font-bold text-slate-700 mb-1">Roll Packaging Size *</label>
        <select id="ctl-rec-packaging" class="w-full border border-slate-200 rounded-xl px-3 py-2 text-slate-800 font-bold focus:outline-none focus:border-[#138FCB]">
          ${packagingUnits.map((p, idx) => `
            <option value="${p.factor}" data-name="${p.name}">
              ${p.name} (${Number(p.factor).toLocaleString()} ${product.base_unit || 'ft'})
            </option>
          `).join('')}
        </select>
      </div>

      <div>
        <label class="block font-bold text-slate-700 mb-1">Number of Full Rolls *</label>
        <input type="number" id="ctl-rec-count" required min="1" value="1" class="w-full border border-slate-200 rounded-xl px-3 py-2 text-slate-800 font-extrabold text-sm focus:outline-none focus:border-[#138FCB]">
      </div>

      <div>
        <label class="block font-bold text-slate-700 mb-1">Purchase / GRN Reference</label>
        <input type="text" id="ctl-rec-ref" placeholder="e.g. PO-00104 or Mill Delivery Batch" class="w-full border border-slate-200 rounded-xl px-3 py-2 text-slate-800 focus:outline-none focus:border-[#138FCB]">
      </div>

      <div class="flex justify-end gap-3 pt-4 border-t border-slate-100">
        <button type="button" id="ctl-rec-cancel" class="px-4 py-2 text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-xl font-semibold transition-colors cursor-pointer">Cancel</button>
        <button type="submit" class="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-semibold shadow-xs transition-colors cursor-pointer">Receive & Register Rolls</button>
      </div>
    </form>
  `;

  openModal({
    title: 'Receive Full Rolls',
    subtitle: `Receive intact factory sealed rolls for ${product.businessName}`,
    contentHtml,
    size: 'max-w-md',
    onOpen: (modalEl) => {
      modalEl.querySelector('#ctl-rec-cancel').onclick = () => closeModal();
      modalEl.querySelector('#ctl-receive-form').onsubmit = (e) => {
        e.preventDefault();
        const warehouseId = modalEl.querySelector('#ctl-rec-warehouse').value;
        const varSelect = modalEl.querySelector('#ctl-rec-variant');
        const variantId = varSelect ? varSelect.value : null;
        const packSelect = modalEl.querySelector('#ctl-rec-packaging');
        const rollSize = Number(packSelect.value);
        const packagingName = packSelect.options[packSelect.selectedIndex].getAttribute('data-name');
        const count = Number(modalEl.querySelector('#ctl-rec-count').value);
        const ref = modalEl.querySelector('#ctl-rec-ref').value.trim() || 'RECEIVE-BATCH';

        try {
          cutToLengthService.receiveFullRolls({
            productId,
            variantId,
            warehouseId,
            count,
            rollSize,
            packagingName,
            unit: product.base_unit || 'ft',
            referenceDocId: ref,
            userId: authService.getCurrentUser().id
          });

          toast.show(`Successfully received ${count} rolls (${packagingName})!`, 'success');
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
 * Modal to add a physical loose piece (e.g. physical stocktake)
 */
function openAddLooseModal(productId, onSaved) {
  const product = productService.getProductById(productId);
  const productVariants = productService.getVariantsByProduct(productId) || [];
  const warehouses = warehouseService.getWarehouses();
  const baseUnit = product.base_unit || 'ft';

  const contentHtml = `
    <form id="ctl-loose-form" class="space-y-4 text-xs">
      <div>
        <label class="block font-bold text-slate-700 mb-1">Target Warehouse *</label>
        <select id="ctl-loose-warehouse" class="w-full border border-slate-200 rounded-xl px-3 py-2 text-slate-800 font-semibold focus:outline-none focus:border-[#138FCB]">
          ${warehouses.map(w => `<option value="${w.id}">${w.name}</option>`).join('')}
        </select>
      </div>

      ${productVariants.length > 1 ? `
        <div>
          <label class="block font-bold text-slate-700 mb-1">Product Variation *</label>
          <select id="ctl-loose-variant" class="w-full border border-slate-200 rounded-xl px-3 py-2 text-slate-800 font-semibold focus:outline-none focus:border-[#138FCB]">
            ${productVariants.map(v => `<option value="${v.id}">${v.sku} (${v.name})</option>`).join('')}
          </select>
        </div>
      ` : ''}

      <div>
        <label class="block font-bold text-slate-700 mb-1">Piece Length (${baseUnit}) *</label>
        <input type="number" id="ctl-loose-length" required min="1" placeholder="e.g. 850" class="w-full border border-slate-200 rounded-xl px-3 py-2 text-slate-800 font-extrabold text-sm focus:outline-none focus:border-[#138FCB]">
      </div>

      <div>
        <label class="block font-bold text-slate-700 mb-1">Reason / Note *</label>
        <input type="text" id="ctl-loose-reason" required placeholder="e.g. Physical inventory count / Found off-cut" class="w-full border border-slate-200 rounded-xl px-3 py-2 text-slate-800 focus:outline-none focus:border-[#138FCB]">
      </div>

      <div class="flex justify-end gap-3 pt-4 border-t border-slate-100">
        <button type="button" id="ctl-loose-cancel" class="px-4 py-2 text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-xl font-semibold transition-colors cursor-pointer">Cancel</button>
        <button type="submit" class="px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-xl font-semibold shadow-xs transition-colors cursor-pointer">Register Loose Piece</button>
      </div>
    </form>
  `;

  openModal({
    title: 'Register Loose Piece',
    subtitle: `Record individual continuous piece for ${product.businessName}`,
    contentHtml,
    size: 'max-w-md',
    onOpen: (modalEl) => {
      modalEl.querySelector('#ctl-loose-cancel').onclick = () => closeModal();
      modalEl.querySelector('#ctl-loose-form').onsubmit = (e) => {
        e.preventDefault();
        const warehouseId = modalEl.querySelector('#ctl-loose-warehouse').value;
        const varSelect = modalEl.querySelector('#ctl-loose-variant');
        const variantId = varSelect ? varSelect.value : null;
        const length = Number(modalEl.querySelector('#ctl-loose-length').value);
        const reason = modalEl.querySelector('#ctl-loose-reason').value.trim();

        try {
          cutToLengthService.addLoosePiece({
            productId,
            variantId,
            warehouseId,
            length,
            unit: baseUnit,
            reason,
            userId: authService.getCurrentUser().id
          });

          toast.show(`Registered loose piece (${length} ${baseUnit})!`, 'success');
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
 * Modal to execute a manual cut from a selected unit or best fit
 */
function openCutModal(productId, defaultUnitId = null, onSaved) {
  const product = productService.getProductById(productId);
  const units = cutToLengthService.getUnits(productId, null, false);
  const baseUnit = product.base_unit || 'ft';

  if (units.length === 0) {
    toast.show('No available rolls or pieces to cut from.', 'error');
    return;
  }

  const selectedUnit = defaultUnitId ? units.find(u => u.id === defaultUnitId) : units[0];

  const contentHtml = `
    <form id="ctl-cut-form" class="space-y-4 text-xs">
      <div>
        <label class="block font-bold text-slate-700 mb-1">Select Source Unit to Cut From *</label>
        <select id="ctl-cut-unit" class="w-full border border-slate-200 rounded-xl px-3 py-2 text-slate-800 font-bold focus:outline-none focus:border-[#138FCB]">
          ${units.map(u => `
            <option value="${u.id}" ${selectedUnit && selectedUnit.id === u.id ? 'selected' : ''}>
              [${u.classification}] Tag ${u.code} - ${Number(u.quantity).toLocaleString()} ${baseUnit} available ${u.packagingName ? `(${u.packagingName})` : ''}
            </option>
          `).join('')}
        </select>
      </div>

      <div>
        <label class="block font-bold text-slate-700 mb-1">Cut Length to Deduct (${baseUnit}) *</label>
        <input type="number" id="ctl-cut-qty" required min="1" max="${selectedUnit ? selectedUnit.quantity : 5000}" placeholder="e.g. 1000" class="w-full border border-slate-200 rounded-xl px-3 py-2 text-slate-800 font-extrabold text-sm focus:outline-none focus:border-[#138FCB]">
        <p id="ctl-cut-preview-hint" class="text-[11px] text-slate-500 mt-1.5 font-medium"></p>
      </div>

      <div>
        <label class="block font-bold text-slate-700 mb-1">Reference / Reason</label>
        <input type="text" id="ctl-cut-notes" placeholder="e.g. Manual dispatch / sample cutting / job order" class="w-full border border-slate-200 rounded-xl px-3 py-2 text-slate-800 focus:outline-none focus:border-[#138FCB]">
      </div>

      <div class="flex justify-end gap-3 pt-4 border-t border-slate-100">
        <button type="button" id="ctl-cut-cancel" class="px-4 py-2 text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-xl font-semibold transition-colors cursor-pointer">Cancel</button>
        <button type="submit" class="px-4 py-2 bg-[#138FCB] hover:bg-[#0E78AC] text-white rounded-xl font-semibold shadow-xs transition-colors cursor-pointer">Execute Cut & Deduct</button>
      </div>
    </form>
  `;

  openModal({
    title: 'Cut-to-Length Dispatch / Cutting',
    subtitle: `Continuous cut deduction from physical stock for ${product.businessName}`,
    contentHtml,
    size: 'max-w-md',
    onOpen: (modalEl) => {
      const unitSelect = modalEl.querySelector('#ctl-cut-unit');
      const qtyInput = modalEl.querySelector('#ctl-cut-qty');
      const hint = modalEl.querySelector('#ctl-cut-preview-hint');

      const updateHint = () => {
        const u = units.find(x => x.id === unitSelect.value);
        if (!u) return;
        qtyInput.max = u.quantity;
        const cut = Number(qtyInput.value) || 0;
        const rem = Number(u.quantity) - cut;
        if (cut > 0) {
          if (u.classification === 'FULL') {
            hint.innerHTML = `<span class="text-purple-600 font-bold">Opens full roll ${u.code}</span>: Leaves a new loose piece of <strong>${rem.toLocaleString()} ${baseUnit}</strong>.`;
          } else {
            hint.innerHTML = rem === 0 
              ? `<span class="text-rose-600 font-bold">Consumes loose piece ${u.code} completely.</span>`
              : `<span class="text-amber-600 font-bold">Updates loose piece ${u.code}</span>: Remaining continuous length will be <strong>${rem.toLocaleString()} ${baseUnit}</strong>.`;
          }
        } else {
          hint.innerText = `Available in ${u.code}: ${Number(u.quantity).toLocaleString()} ${baseUnit}`;
        }
      };

      unitSelect.onchange = updateHint;
      qtyInput.oninput = updateHint;
      updateHint();

      modalEl.querySelector('#ctl-cut-cancel').onclick = () => closeModal();
      modalEl.querySelector('#ctl-cut-form').onsubmit = (e) => {
        e.preventDefault();
        const unitId = unitSelect.value;
        const cutLength = Number(qtyInput.value);
        const notes = modalEl.querySelector('#ctl-cut-notes').value.trim();

        try {
          cutToLengthService.cutFromUnit({
            unitId,
            cutLength,
            reason: notes,
            userId: authService.getCurrentUser().id
          });

          toast.show(`Cut executed: Deducted ${cutLength} ${baseUnit}.`, 'success');
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
 * Modal to adjust the length of an individual loose piece
 */
function openAdjustModal(unitId, onSaved) {
  const unit = cutToLengthService.getUnitById(unitId);
  if (!unit) return;

  const contentHtml = `
    <form id="ctl-adjust-form" class="space-y-4 text-xs">
      <div class="bg-slate-50 p-3 rounded-xl border border-slate-200">
        <p class="font-bold text-slate-800">Piece Tag: <span class="text-amber-600">${unit.code}</span></p>
        <p class="text-slate-500">Current Length: <strong>${Number(unit.quantity).toLocaleString()} ${unit.unit || 'ft'}</strong></p>
      </div>

      <div>
        <label class="block font-bold text-slate-700 mb-1">New Physical Length (${unit.unit || 'ft'}) *</label>
        <input type="number" id="ctl-adj-length" required min="0" value="${unit.quantity}" class="w-full border border-slate-200 rounded-xl px-3 py-2 text-slate-800 font-extrabold text-sm focus:outline-none focus:border-[#138FCB]">
        <p class="text-[10px] text-slate-400 mt-1">Set to 0 if piece is completely consumed or discarded.</p>
      </div>

      <div>
        <label class="block font-bold text-slate-700 mb-1">Reason for Adjustment *</label>
        <input type="text" id="ctl-adj-reason" required placeholder="e.g. Physical measurement correction / damaged segment removed" class="w-full border border-slate-200 rounded-xl px-3 py-2 text-slate-800 focus:outline-none focus:border-[#138FCB]">
      </div>

      <div class="flex justify-end gap-3 pt-4 border-t border-slate-100">
        <button type="button" id="ctl-adj-cancel" class="px-4 py-2 text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-xl font-semibold transition-colors cursor-pointer">Cancel</button>
        <button type="submit" class="px-4 py-2 bg-[#138FCB] hover:bg-[#0E78AC] text-white rounded-xl font-semibold shadow-xs transition-colors cursor-pointer">Save Adjustment</button>
      </div>
    </form>
  `;

  openModal({
    title: 'Adjust Piece Length',
    subtitle: `Physical inventory correction for piece ${unit.code}`,
    contentHtml,
    size: 'max-w-md',
    onOpen: (modalEl) => {
      modalEl.querySelector('#ctl-adj-cancel').onclick = () => closeModal();
      modalEl.querySelector('#ctl-adjust-form').onsubmit = (e) => {
        e.preventDefault();
        const newLength = Number(modalEl.querySelector('#ctl-adj-length').value);
        const reason = modalEl.querySelector('#ctl-adj-reason').value.trim();

        try {
          cutToLengthService.adjustPieceLength({
            unitId,
            newLength,
            reason,
            userId: authService.getCurrentUser().id
          });

          toast.show(`Updated length for piece ${unit.code}.`, 'success');
          closeModal();
          if (onSaved) onSaved();
        } catch (err) {
          toast.show(err.message, 'error');
        }
      };
    }
  });
}
