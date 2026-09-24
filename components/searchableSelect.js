/**
 * JS Traders ERP - 2-Tier Searchable Card Dropdown Component
 * Side-by-Side Product and Variant Layout.
 * - Product selector on the left.
 * - Variant selector on the right (next to product).
 * - Empty by default on multi-variant products to prevent mistakes.
 * - In single-variant products, displayed in a distinct faded color.
 */

function renderAttributePills(attributes, isFaded = false) {
  return '';
}

function renderVariantOptionsHtml(prodVariants, selectedVarId) {
  return prodVariants.map(v => {
    const isSelected = v.id === selectedVarId;
    const attrHtml = renderAttributePills(v.attributes);
    return `
      <div
        class="pv-variant-option p-2 rounded-xl hover:bg-emerald-50/70 border border-transparent hover:border-emerald-200 cursor-pointer transition-all ${isSelected ? 'bg-emerald-50/60 border-emerald-200' : ''}"
        data-variant-id="${v.id}">
        <div class="flex items-center justify-between gap-1">
          <div class="font-bold text-slate-900 text-xs">${v.name}</div>
          <span class="font-mono text-[9px] font-semibold text-[#138FCB] bg-blue-50 px-1.5 py-0.5 rounded">${v.sku}</span>
        </div>
        ${attrHtml ? `<div class="flex items-center gap-1 mt-1 flex-wrap">${attrHtml}</div>` : ''}
      </div>
    `;
  }).join('');
}

export function renderProductVariantPicker({
  rowId,
  selectedProductId = null,
  selectedVariantId = null,
  products = [],
  variants = [],
  whStock = 0,
  officeStock = 0,
  unit = 'PCS'
}) {
  const currentProduct = selectedProductId
    ? products.find(p => p.id === selectedProductId)
    : (selectedVariantId ? products.find(p => variants.find(v => v.id === selectedVariantId)?.productId === p.id) : null) || products[0] || null;

  const prodVariants = currentProduct
    ? variants.filter(v => v.productId === currentProduct.id)
    : [];

  // Determine current variant:
  // 1. If explicit selectedVariantId is given, use it.
  // 2. If single variant exists, auto-bind it.
  // 3. If multiple variants exist, keep EMPTY by default to avoid accidental wrong SKU dispatch!
  let currentVariant = null;
  if (selectedVariantId) {
    currentVariant = variants.find(v => v.id === selectedVariantId) || null;
  } else if (prodVariants.length === 1) {
    currentVariant = prodVariants[0];
  } else {
    currentVariant = null; // empty by default for multi-variant
  }

  const prodId = currentProduct ? currentProduct.id : '';
  const varId = currentVariant ? currentVariant.id : '';
  const currentUnit = (currentVariant && currentVariant.unit) ? currentVariant.unit : (currentProduct?.baseUnitId || 'PCS');

  const isSingle = prodVariants.length === 1;
  const isMulti = prodVariants.length > 1;

  // Render variant card inner HTML
  let variantInnerHtml = '';
  let variantTriggerClass = '';

  if (isSingle) {
    variantTriggerClass = 'bg-slate-100/70 border border-slate-200/90 text-slate-500 cursor-default opacity-85';
    const attrPills = renderAttributePills(currentVariant.attributes, true);
    variantInnerHtml = `
      <div class="truncate w-full pr-1">
        <div class="flex items-center justify-between gap-1">
          <span class="font-semibold text-slate-700 text-xs pv-var-display-name truncate">${currentVariant.name}</span>
          <span class="text-[9px] font-bold text-slate-500 bg-slate-200/70 px-1.5 py-0.2 rounded uppercase tracking-wider shrink-0">Single SKU</span>
        </div>
        <div class="flex items-center gap-1.5 mt-0.5 text-[10px] text-slate-400">
          <span class="pv-var-sku font-mono font-semibold text-slate-500">${currentVariant.sku}</span>
          ${attrPills ? `<span class="pv-var-attrs flex items-center gap-1">${attrPills}</span>` : ''}
        </div>
      </div>
    `;
  } else if (currentVariant) {
    variantTriggerClass = 'bg-white border border-slate-200 hover:border-[#138FCB] cursor-pointer';
    const attrPills = renderAttributePills(currentVariant.attributes, false);
    variantInnerHtml = `
      <div class="truncate w-full pr-1">
        <div class="flex items-center justify-between gap-1">
          <span class="font-bold text-slate-900 text-xs pv-var-display-name truncate">${currentVariant.name}</span>
          <span class="text-[9px] font-bold text-[#138FCB] bg-blue-50 px-1.5 py-0.2 rounded shrink-0">Selected</span>
        </div>
        <div class="flex items-center gap-1.5 mt-0.5 text-[10px] text-slate-500">
          <span class="pv-var-sku font-mono font-semibold text-[#138FCB]">${currentVariant.sku}</span>
          ${attrPills ? `<span class="pv-var-attrs flex items-center gap-1">${attrPills}</span>` : ''}
        </div>
      </div>
    `;
  } else if (isMulti) {
    variantTriggerClass = 'bg-amber-50/60 border border-dashed border-amber-300 hover:border-amber-400 cursor-pointer';
    variantInnerHtml = `
      <div class="truncate w-full pr-1">
        <div class="flex items-center justify-between gap-1">
          <div class="flex items-center gap-1.5">
            <span class="w-2 h-2 rounded-full bg-amber-400 animate-pulse shrink-0"></span>
            <span class="font-bold text-amber-900 text-xs pv-var-display-name truncate">Select Variant SKU...</span>
          </div>
          <span class="text-[9px] font-bold text-amber-700 bg-amber-100/80 px-1.5 py-0.2 rounded shrink-0">${prodVariants.length} Options</span>
        </div>
        <div class="text-[10px] text-amber-600 mt-0.5 font-medium">Click to choose size / model</div>
      </div>
    `;
  } else {
    variantTriggerClass = 'hidden';
    variantInnerHtml = '';
  }

  const hasVariants = prodVariants.length > 0;
  const variantOptionsHtml = renderVariantOptionsHtml(prodVariants, varId);

  return `
    <div class="pv-picker-container relative text-xs grid grid-cols-1 ${hasVariants ? 'sm:grid-cols-2' : ''} gap-2 items-start" data-row-id="${rowId}">
      <!-- Hidden inputs for form extraction -->
      <input type="hidden" class="pv-selected-product-id" value="${prodId}">
      <input type="hidden" class="pv-selected-variant-id gp-item-var" value="${varId}" data-unit="${currentUnit}">
      <input type="hidden" class="pv-selected-unit" value="${currentUnit}">

      <!-- Tier 1: Product Selector Card (Left Side) -->
      <div class="relative">
        <div class="pv-product-trigger flex items-center justify-between p-2 rounded-xl bg-white border border-slate-200 hover:border-[#138FCB] shadow-2xs cursor-pointer transition-all min-h-[58px]">
          <div class="flex items-center gap-2 overflow-hidden">
            <div class="w-8 h-8 rounded-lg bg-blue-50 text-[#138FCB] flex items-center justify-center font-bold text-xs shrink-0">
              📦
            </div>
            <div class="truncate">
              <div class="flex items-center gap-1 flex-wrap">
                <span class="font-bold text-slate-800 text-xs pv-prod-display-name truncate">
                  ${currentProduct ? (currentProduct.businessName || currentProduct.customerName) : 'Select Product...'}
                </span>
              </div>
              <div class="flex items-center gap-1.5 text-[10px] text-slate-400 mt-0.5">
                <span class="pv-prod-code font-mono font-semibold text-[#138FCB]">${currentProduct?.code || ''}</span>
                ${currentProduct?.customerName ? `<span>•</span><span class="pv-prod-cust text-slate-500 font-medium truncate">${currentProduct.customerName}</span>` : '<span class="pv-prod-cust text-slate-500 font-medium truncate"></span>'}
              </div>
            </div>
          </div>
          <svg class="w-3.5 h-3.5 text-slate-400 shrink-0 ml-1 transition-transform pv-arrow" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path d="M19 9l-7 7-7-7" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path>
          </svg>
        </div>

        <!-- Tier 1 Dropdown Menu (Searchable Product Card List) -->
        <div class="pv-product-menu hidden absolute top-full left-0 z-30 w-full sm:w-[360px] mt-1 bg-white rounded-2xl border border-slate-200 shadow-xl overflow-hidden animate-in fade-in duration-100">
          <div class="p-2 border-b border-slate-100 bg-slate-50/70 sticky top-0 z-10">
            <div class="relative">
              <input
                type="text"
                class="pv-product-search w-full pl-7 pr-3 py-1.5 text-xs bg-white border border-slate-200 rounded-xl focus:outline-none focus:border-[#138FCB] placeholder-slate-400 font-medium"
                placeholder="Search products by code or name...">
              <span class="absolute left-2 top-2 text-slate-400 text-xs">🔍</span>
            </div>
          </div>
          <div class="pv-product-list max-h-52 overflow-y-auto custom-scroll p-1.5 space-y-1">
            ${products.map(p => `
              <div
                class="pv-product-option p-2 rounded-xl hover:bg-blue-50/70 border border-transparent hover:border-blue-200 cursor-pointer transition-all ${p.id === prodId ? 'bg-blue-50/50 border-blue-200' : ''}"
                data-product-id="${p.id}"
                data-search="${(p.code + ' ' + p.businessName + ' ' + (p.customerName || '')).toLowerCase()}">
                <div class="truncate">
                  <div class="font-bold text-slate-800 text-xs truncate">${p.businessName || p.customerName}</div>
                  <div class="flex items-center gap-1.5 mt-0.5 text-[10px]">
                    <span class="font-mono font-semibold text-[#138FCB]">${p.code}</span>
                    ${p.customerName ? `<span>•</span><span class="text-slate-500 font-medium truncate">${p.customerName}</span>` : ''}
                  </div>
                </div>
              </div>
            `).join('')}
          </div>
        </div>
      </div>

      <!-- Tier 2: Variant Selector Card (Right Side, Next to Product) -->
      <div class="pv-variant-container relative ${hasVariants ? '' : 'hidden'}">
        <div class="pv-variant-trigger flex items-center justify-between p-2 rounded-xl shadow-2xs transition-all min-h-[58px] ${variantTriggerClass}">
          ${variantInnerHtml}
          <svg class="w-3.5 h-3.5 text-slate-400 shrink-0 ml-1 pv-var-arrow transition-transform ${isMulti ? '' : 'hidden'}" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path d="M19 9l-7 7-7-7" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path>
          </svg>
        </div>

        <!-- Tier 2 Dropdown (Only for multi-variant selection) -->
        <div class="pv-variant-menu hidden absolute top-full left-0 z-30 w-full sm:w-[340px] mt-1 bg-white rounded-2xl border border-slate-200 shadow-xl overflow-hidden animate-in fade-in duration-100">
          <div class="p-2 border-b border-slate-100 bg-slate-50/70 text-[10px] font-bold text-slate-500 uppercase tracking-wider">
            Available SKU Options (${prodVariants.length})
          </div>
          <div class="pv-variant-list max-h-52 overflow-y-auto custom-scroll p-1.5 space-y-1">
            ${variantOptionsHtml}
          </div>
        </div>
      </div>
    </div>
  `;
}

/**
 * Binds interactivity to a product-variant picker container
 */
export function bindProductVariantPicker(container, { products, variants, onVariantChanged }) {
  const prodTrigger = container.querySelector('.pv-product-trigger');
  const prodMenu = container.querySelector('.pv-product-menu');
  const prodSearch = container.querySelector('.pv-product-search');
  const prodArrow = container.querySelector('.pv-arrow');

  const varContainer = container.querySelector('.pv-variant-container');
  const varTrigger = container.querySelector('.pv-variant-trigger');
  const varMenu = container.querySelector('.pv-variant-menu');
  const varArrow = container.querySelector('.pv-var-arrow');
  const varList = container.querySelector('.pv-variant-list');

  const hiddenProdId = container.querySelector('.pv-selected-product-id');
  const hiddenVarId = container.querySelector('.pv-selected-variant-id');
  const hiddenUnit = container.querySelector('.pv-selected-unit');

  const updateProductDisplay = (product) => {
    const nameEl = container.querySelector('.pv-prod-display-name');
    if (nameEl) nameEl.textContent = product.businessName || product.customerName || 'Select Product...';

    const codeEl = container.querySelector('.pv-prod-code');
    if (codeEl) codeEl.textContent = product.code || '';

    const custEl = container.querySelector('.pv-prod-cust');
    if (custEl) custEl.textContent = product.customerName || '';
  };

  const renderSingleVariantTrigger = (variant) => {
    if (varContainer) varContainer.classList.remove('hidden');
    container.classList.add('sm:grid-cols-2');
    if (!varTrigger) return;
    varTrigger.className = 'pv-variant-trigger flex items-center justify-between p-2 rounded-xl bg-slate-100/70 border border-slate-200/90 text-slate-500 shadow-2xs cursor-default transition-all opacity-85 min-h-[58px]';
    varTrigger.innerHTML = `
      <div class="truncate w-full pr-1">
        <div class="flex items-center justify-between gap-1">
          <span class="font-semibold text-slate-700 text-xs pv-var-display-name truncate">${variant.name}</span>
          <span class="text-[9px] font-bold text-slate-500 bg-slate-200/70 px-1.5 py-0.2 rounded uppercase tracking-wider shrink-0">Single SKU</span>
        </div>
        <div class="flex items-center gap-1.5 mt-0.5 text-[10px] text-slate-400">
          <span class="pv-var-sku font-mono font-semibold text-slate-500">${variant.sku}</span>
        </div>
      </div>
    `;
    if (varArrow) varArrow.classList.add('hidden');
  };

  const renderEmptyMultiVariantTrigger = (matchingVariants) => {
    if (varContainer) varContainer.classList.remove('hidden');
    container.classList.add('sm:grid-cols-2');
    if (!varTrigger) return;
    varTrigger.className = 'pv-variant-trigger flex items-center justify-between p-2 rounded-xl bg-amber-50/60 border border-dashed border-amber-300 hover:border-amber-400 shadow-2xs cursor-pointer transition-all min-h-[58px]';
    varTrigger.innerHTML = `
      <div class="truncate w-full pr-1">
        <div class="flex items-center justify-between gap-1">
          <div class="flex items-center gap-1.5">
            <span class="w-2 h-2 rounded-full bg-amber-400 animate-pulse shrink-0"></span>
            <span class="font-bold text-amber-900 text-xs pv-var-display-name truncate">Select Variant SKU...</span>
          </div>
          <span class="text-[9px] font-bold text-amber-700 bg-amber-100/80 px-1.5 py-0.2 rounded shrink-0">${matchingVariants.length} Options</span>
        </div>
        <div class="text-[10px] text-amber-600 mt-0.5 font-medium">Click to choose size / model</div>
      </div>
      <svg class="w-3.5 h-3.5 text-slate-400 shrink-0 ml-1 pv-var-arrow transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path d="M19 9l-7 7-7-7" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path>
      </svg>
    `;
    if (varArrow) varArrow.classList.remove('hidden');
  };

  const renderSelectedVariantTrigger = (variant) => {
    if (varContainer) varContainer.classList.remove('hidden');
    container.classList.add('sm:grid-cols-2');
    if (!varTrigger) return;
    varTrigger.className = 'pv-variant-trigger flex items-center justify-between p-2 rounded-xl bg-white border border-[#138FCB] shadow-2xs cursor-pointer transition-all hover:border-[#0E78AC] min-h-[58px]';
    varTrigger.innerHTML = `
      <div class="truncate w-full pr-1">
        <div class="flex items-center justify-between gap-1">
          <span class="font-bold text-slate-900 text-xs pv-var-display-name truncate">${variant.name}</span>
          <span class="text-[9px] font-bold text-[#138FCB] bg-blue-50 px-1.5 py-0.2 rounded shrink-0">Selected</span>
        </div>
        <div class="flex items-center gap-1.5 mt-0.5 text-[10px] text-slate-500">
          <span class="pv-var-sku font-mono font-semibold text-[#138FCB]">${variant.sku}</span>
        </div>
      </div>
      <svg class="w-3.5 h-3.5 text-slate-400 shrink-0 ml-1 pv-var-arrow transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path d="M19 9l-7 7-7-7" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path>
      </svg>
    `;
    if (varArrow) varArrow.classList.remove('hidden');
  };

  const renderZeroVariantTrigger = () => {
    if (varContainer) varContainer.classList.add('hidden');
    container.classList.remove('sm:grid-cols-2');
  };

  const bindVariantOptions = (matchingVariants) => {
    if (!varList) return;
    varList.querySelectorAll('.pv-variant-option').forEach(opt => {
      opt.onclick = (e) => {
        e.stopPropagation();
        const vId = opt.getAttribute('data-variant-id');
        const selectedVar = variants.find(v => v.id === vId);
        if (!selectedVar) return;

        hiddenVarId.value = vId;
        const unitVal = selectedVar.unit || 'PCS';
        hiddenVarId.setAttribute('data-unit', unitVal);
        if (hiddenUnit) hiddenUnit.value = unitVal;

        if (varMenu) varMenu.classList.add('hidden');

        renderSelectedVariantTrigger(selectedVar);

        // Highlight selected
        varList.querySelectorAll('.pv-variant-option').forEach(o => {
          const isMatch = o.getAttribute('data-variant-id') === vId;
          o.classList.toggle('bg-emerald-50/60', isMatch);
          o.classList.toggle('border-emerald-200', isMatch);
        });

        if (onVariantChanged) {
          onVariantChanged({
            productId: hiddenProdId.value,
            variantId: vId,
            product: products.find(p => p.id === hiddenProdId.value),
            variant: selectedVar
          });
        }
      };
    });
  };

  // Toggle Product dropdown
  if (prodTrigger && prodMenu) {
    prodTrigger.onclick = (e) => {
      e.stopPropagation();
      document.querySelectorAll('.pv-product-menu, .pv-variant-menu').forEach(m => {
        if (m !== prodMenu) m.classList.add('hidden');
      });
      prodMenu.classList.toggle('hidden');
      if (!prodMenu.classList.contains('hidden') && prodSearch) {
        prodSearch.focus();
      }
      if (prodArrow) prodArrow.classList.toggle('rotate-180', !prodMenu.classList.contains('hidden'));
    };
  }

  // Filter products by text search
  if (prodSearch) {
    prodSearch.onclick = (e) => e.stopPropagation();
    prodSearch.oninput = (e) => {
      const q = e.target.value.toLowerCase().trim();
      container.querySelectorAll('.pv-product-option').forEach(opt => {
        const searchTerms = opt.getAttribute('data-search') || '';
        opt.style.display = searchTerms.includes(q) ? 'block' : 'none';
      });
    };
  }

  // Select Product
  container.querySelectorAll('.pv-product-option').forEach(opt => {
    opt.onclick = (e) => {
      e.stopPropagation();
      const pId = opt.getAttribute('data-product-id');
      const selectedProd = products.find(p => p.id === pId);
      if (!selectedProd) return;

      hiddenProdId.value = pId;
      updateProductDisplay(selectedProd);

      if (prodMenu) prodMenu.classList.add('hidden');
      if (prodArrow) prodArrow.classList.remove('rotate-180');

      // Highlight selected product option
      container.querySelectorAll('.pv-product-option').forEach(o => {
        const isMatch = o.getAttribute('data-product-id') === pId;
        o.classList.toggle('bg-blue-50/50', isMatch);
        o.classList.toggle('border-blue-200', isMatch);
      });

      // Find variants of this product
      const matchingVariants = variants.filter(v => v.productId === pId);

      if (matchingVariants.length === 1) {
        // Single Variant: Auto-select and display with FADED color styling
        const single = matchingVariants[0];
        hiddenVarId.value = single.id;
        const unitVal = single.unit || 'PCS';
        hiddenVarId.setAttribute('data-unit', unitVal);
        if (hiddenUnit) hiddenUnit.value = unitVal;

        renderSingleVariantTrigger(single);

        if (onVariantChanged) {
          onVariantChanged({
            productId: pId,
            variantId: single.id,
            product: selectedProd,
            variant: single
          });
        }
      } else if (matchingVariants.length > 1) {
        // Multiple Variants: KEEP EMPTY BY DEFAULT TO PREVENT MISTAKES!
        hiddenVarId.value = '';
        const unitVal = selectedProd.baseUnitId || 'PCS';
        hiddenVarId.setAttribute('data-unit', unitVal);
        if (hiddenUnit) hiddenUnit.value = unitVal;

        renderEmptyMultiVariantTrigger(matchingVariants);

        // Rebuild variant dropdown list
        if (varList) {
          varList.innerHTML = renderVariantOptionsHtml(matchingVariants, '');
          bindVariantOptions(matchingVariants);
        }

        if (onVariantChanged) {
          onVariantChanged({
            productId: pId,
            variantId: '',
            product: selectedProd,
            variant: null
          });
        }
      } else {
        // Zero Variants
        hiddenVarId.value = '';
        hiddenVarId.removeAttribute('data-unit');
        if (hiddenUnit) hiddenUnit.value = selectedProd.baseUnit || 'PCS';
        renderZeroVariantTrigger();

        if (onVariantChanged) {
          onVariantChanged({
            productId: pId,
            variantId: '',
            product: selectedProd,
            variant: null
          });
        }
      }
    };
  });

  // Toggle Variant dropdown
  const bindVariantTriggerClick = () => {
    const curVarTrigger = container.querySelector('.pv-variant-trigger');
    if (!curVarTrigger) return;
    curVarTrigger.onclick = (e) => {
      e.stopPropagation();
      const currentPId = hiddenProdId.value;
      const currentMatching = variants.filter(v => v.productId === currentPId);
      if (currentMatching.length <= 1) return; // single variant or zero, no dropdown

      document.querySelectorAll('.pv-product-menu, .pv-variant-menu').forEach(m => {
        if (m !== varMenu) m.classList.add('hidden');
      });
      if (varMenu) varMenu.classList.toggle('hidden');
    };
  };

  bindVariantTriggerClick();

  // Initial variant options binding
  const initPId = hiddenProdId.value;
  const initMatching = variants.filter(v => v.productId === initPId);
  bindVariantOptions(initMatching);

  // Close when clicking outside
  document.addEventListener('click', () => {
    if (prodMenu) prodMenu.classList.add('hidden');
    if (prodArrow) prodArrow.classList.remove('rotate-180');
    if (varMenu) varMenu.classList.add('hidden');
  });
}

/**
 * ============================================================================
 * GENERIC SEARCHABLE CARD DROPDOWN COMPONENT
 * Rounded card design theme matching ERP specifications.
 * Supports integrated real-time search, item badges, and keyboard/click selection.
 * ============================================================================
 */

export function renderSearchableDropdown({
  id = '',
  name = '',
  placeholder = 'Select option...',
  value = '',
  options = [], // [{ value, label, subtext, badge }]
  required = false,
  containerClass = '',
  buttonClass = '',
  menuWidth = 'w-full min-w-[280px]'
}) {
  const selectedOpt = options.find(o => String(o.value) === String(value));
  const displayText = selectedOpt ? selectedOpt.label : placeholder;
  const isSelected = Boolean(selectedOpt && selectedOpt.value !== '');

  return `
    <div class="searchable-card-dropdown relative ${containerClass}" data-dropdown-id="${id}" data-placeholder="${placeholder.replace(/"/g, '&quot;')}">
      <input type="hidden" id="${id}" name="${name || id}" value="${value || ''}" class="scd-hidden-input" ${required ? 'required' : ''}>
      
      <button
        type="button"
        class="scd-trigger w-full flex items-center justify-between gap-2 p-2.5 rounded-xl border border-slate-200 hover:border-[#138FCB] bg-white text-xs shadow-2xs cursor-pointer transition-all focus:outline-none focus:border-[#138FCB] ${buttonClass}">
        <span class="scd-label truncate ${isSelected ? 'text-slate-800 font-bold' : 'text-slate-400 font-normal'}">
          ${displayText}
        </span>
        <svg class="scd-arrow w-3.5 h-3.5 text-slate-400 shrink-0 ml-1 transition-transform duration-150" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path d="M19 9l-7 7-7-7" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path>
        </svg>
      </button>

      <div class="scd-menu hidden absolute top-full left-0 z-50 ${menuWidth} mt-1.5 bg-white rounded-2xl border border-slate-200/90 shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-100">
        <div class="p-2 border-b border-slate-100 bg-slate-50/80 sticky top-0 z-10">
          <div class="relative">
            <input
              type="text"
              class="scd-search w-full pl-7 pr-3 py-1.5 text-xs bg-white border border-slate-200 rounded-xl focus:outline-none focus:border-[#138FCB] placeholder-slate-400 font-medium"
              placeholder="Search options...">
            <span class="absolute left-2 top-2 text-slate-400 text-xs">🔍</span>
          </div>
        </div>
        <div class="scd-options-list max-h-56 overflow-y-auto custom-scroll p-1.5 space-y-1">
          ${options.map(opt => {
            const optVal = String(opt.value ?? '');
            const optLabel = String(opt.label ?? optVal);
            const optSub = String(opt.subtext ?? '');
            const optBadge = String(opt.badge ?? '');
            const isMatch = String(value) === optVal && optVal !== '';
            return `
              <div
                class="scd-option p-2 rounded-xl hover:bg-blue-50/70 border border-transparent hover:border-blue-200 cursor-pointer transition-all flex items-center justify-between gap-2 ${isMatch ? 'bg-blue-50/70 border-blue-200' : ''}"
                data-value="${optVal}"
                data-label="${optLabel.replace(/"/g, '&quot;')}"
                data-search="${(optLabel + ' ' + optSub + ' ' + optVal).toLowerCase()}">
                <div class="truncate">
                  <div class="font-bold text-slate-800 text-xs truncate">${optLabel}</div>
                  ${optSub ? `<div class="text-[10px] text-slate-400 font-mono font-medium">${optSub}</div>` : ''}
                </div>
                <div class="flex items-center gap-1.5 shrink-0">
                  ${optBadge ? `<span class="text-[9px] font-bold text-[#138FCB] bg-blue-50 px-1.5 py-0.5 rounded">${optBadge}</span>` : ''}
                  <span class="scd-check text-xs font-bold text-[#138FCB] ${isMatch ? '' : 'hidden'}">✓</span>
                </div>
              </div>
            `;
          }).join('')}
        </div>
      </div>
    </div>
  `;
}

export function bindSearchableDropdown(container, { onChange } = {}) {
  const trigger = container.querySelector('.scd-trigger');
  const menu = container.querySelector('.scd-menu');
  const searchInput = container.querySelector('.scd-search');
  const arrow = container.querySelector('.scd-arrow');
  const hiddenInput = container.querySelector('.scd-hidden-input');
  const labelEl = container.querySelector('.scd-label');

  if (!trigger || !menu) return;

  const parentRow = container.closest('tr');
  const parentSection = container.closest('section');

  const closeMenu = () => {
    menu.classList.add('hidden');
    if (arrow) arrow.classList.remove('rotate-180');
    container.style.zIndex = '';
    if (parentRow) {
      parentRow.style.zIndex = '';
      parentRow.style.position = '';
    }
    if (parentSection) {
      parentSection.style.zIndex = '';
      parentSection.style.position = '';
    }
  };

  trigger.onclick = (e) => {
    e.stopPropagation();
    const isHidden = menu.classList.contains('hidden');
    // Close other open menus
    document.querySelectorAll('.scd-menu, .pv-product-menu, .pv-variant-menu, .custom-filter-dropdown-card').forEach(m => {
      if (m !== menu) {
        m.classList.add('hidden');
        const c = m.closest('.searchable-card-dropdown');
        if (c) c.style.zIndex = '';
        const r = m.closest('tr');
        if (r) {
          r.style.zIndex = '';
          r.style.position = '';
        }
        const s = m.closest('section');
        if (s) {
          s.style.zIndex = '';
          s.style.position = '';
        }
      }
    });
    document.querySelectorAll('.scd-arrow').forEach(a => {
      if (a !== arrow) a.classList.remove('rotate-180');
    });

    if (isHidden) {
      menu.classList.remove('hidden');
      if (arrow) arrow.classList.add('rotate-180');
      container.style.zIndex = '500';
      if (parentRow) {
        parentRow.style.zIndex = '500';
        parentRow.style.position = 'relative';
      }
      if (parentSection) {
        parentSection.style.zIndex = '40';
        parentSection.style.position = 'relative';
      }

      // Smart Positioning: If near bottom of viewport or modal, open upwards (dropup)
      const rect = trigger.getBoundingClientRect();
      let spaceBelow = (window.innerHeight || document.documentElement.clientHeight) - rect.bottom;
      let spaceAbove = rect.top;

      const scrollParent = container.closest('#modal-body-container, .overflow-y-auto');
      if (scrollParent) {
        const parentRect = scrollParent.getBoundingClientRect();
        const spaceBelowInParent = parentRect.bottom - rect.bottom;
        const spaceAboveInParent = rect.top - parentRect.top;
        if (spaceBelowInParent < spaceBelow) spaceBelow = spaceBelowInParent;
        if (spaceAboveInParent < spaceAbove) spaceAbove = spaceAboveInParent;
      }

      if (spaceBelow < 260 && spaceAbove > 220) {
        menu.classList.remove('top-full', 'mt-1.5');
        menu.classList.add('bottom-full', 'mb-1.5');
      } else {
        menu.classList.remove('bottom-full', 'mb-1.5');
        menu.classList.add('top-full', 'mt-1.5');
      }

      if (searchInput) {
        searchInput.value = '';
        container.querySelectorAll('.scd-option').forEach(opt => { opt.style.display = 'flex'; });
        setTimeout(() => searchInput.focus(), 50);
      }
    } else {
      closeMenu();
    }
  };

  // Close when clicking outside
  if (!window._scdGlobalDocBound) {
    window._scdGlobalDocBound = true;
    document.addEventListener('click', (e) => {
      if (!e.target.closest('.searchable-card-dropdown')) {
        document.querySelectorAll('.scd-menu').forEach(m => {
          m.classList.add('hidden');
          const c = m.closest('.searchable-card-dropdown');
          if (c) c.style.zIndex = '';
          const r = m.closest('tr');
          if (r) {
            r.style.zIndex = '';
            r.style.position = '';
          }
          const s = m.closest('section');
          if (s) {
            s.style.zIndex = '';
            s.style.position = '';
          }
        });
        document.querySelectorAll('.scd-arrow').forEach(a => a.classList.remove('rotate-180'));
      }
    });
  }

  if (searchInput) {
    searchInput.onclick = (e) => e.stopPropagation();
    searchInput.oninput = (e) => {
      const q = e.target.value.toLowerCase().trim();
      container.querySelectorAll('.scd-option').forEach(opt => {
        const searchTerms = opt.getAttribute('data-search') || '';
        opt.style.display = searchTerms.includes(q) ? 'flex' : 'none';
      });
    };
  }

  // Bind option selection
  container.querySelectorAll('.scd-option').forEach(opt => {
    opt.onclick = (e) => {
      e.stopPropagation();
      const val = opt.getAttribute('data-value');
      const text = opt.getAttribute('data-label') || opt.querySelector('.font-bold')?.textContent?.trim() || val;

      if (hiddenInput) {
        hiddenInput.value = val;
        hiddenInput.dispatchEvent(new Event('change', { bubbles: true }));
      }

      if (labelEl) {
        if (val !== '') {
          labelEl.textContent = text;
          labelEl.classList.remove('text-slate-400', 'font-normal');
          labelEl.classList.add('text-slate-800', 'font-bold');
        } else {
          const placeholder = container.getAttribute('data-placeholder') || 'Select option...';
          labelEl.textContent = placeholder;
          labelEl.classList.add('text-slate-400', 'font-normal');
          labelEl.classList.remove('text-slate-800', 'font-bold');
        }
      }

      container.querySelectorAll('.scd-option').forEach(o => {
        const isMatch = o.getAttribute('data-value') === val;
        o.classList.toggle('bg-blue-50/70', isMatch);
        o.classList.toggle('border-blue-200', isMatch);
        const check = o.querySelector('.scd-check');
        if (check) check.classList.toggle('hidden', !isMatch);
      });

      closeMenu();

      if (onChange) onChange(val, opt);
    };
  });
}

export function initAllSearchableDropdowns(container, { onChange } = {}) {
  if (!container) return;
  container.querySelectorAll('.searchable-card-dropdown').forEach(dd => {
    if (!dd._scdBound) {
      dd._scdBound = true;
      bindSearchableDropdown(dd, { onChange });
    }
  });
}

export function setSearchableDropdownValue(container, dropdownIdOrEl, value, displayLabel = '') {
  const dd = typeof dropdownIdOrEl === 'string'
    ? container.querySelector(`[data-dropdown-id="${dropdownIdOrEl}"]`)
    : dropdownIdOrEl;
  if (!dd) return;

  const hiddenInput = dd.querySelector('.scd-hidden-input');
  const labelEl = dd.querySelector('.scd-label');

  if (hiddenInput) {
    hiddenInput.value = value;
  }

  let text = displayLabel;
  if (!text && value !== '') {
    const matchingOpt = dd.querySelector(`.scd-option[data-value="${value}"]`);
    if (matchingOpt) {
      text = matchingOpt.getAttribute('data-label') || matchingOpt.querySelector('.font-bold')?.textContent?.trim() || value;
    }
  }

  if (labelEl) {
    if (value !== '') {
      labelEl.textContent = text || value;
      labelEl.classList.remove('text-slate-400', 'font-normal');
      labelEl.classList.add('text-slate-800', 'font-bold');
    } else {
      const placeholder = dd.getAttribute('data-placeholder') || 'Select option...';
      labelEl.textContent = placeholder;
      labelEl.classList.add('text-slate-400', 'font-normal');
      labelEl.classList.remove('text-slate-800', 'font-bold');
    }
  }

  dd.querySelectorAll('.scd-option').forEach(o => {
    const isMatch = o.getAttribute('data-value') === String(value);
    o.classList.toggle('bg-blue-50/70', isMatch);
    o.classList.toggle('border-blue-200', isMatch);
    const check = o.querySelector('.scd-check');
    if (check) check.classList.toggle('hidden', !isMatch);
  });
}

if (typeof document !== 'undefined') {
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.searchable-card-dropdown')) {
      document.querySelectorAll('.scd-menu').forEach(m => m.classList.add('hidden'));
      document.querySelectorAll('.scd-arrow').forEach(a => a.classList.remove('rotate-180'));
    }
  });
}

