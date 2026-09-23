/**
 * JS Traders ERP - 2-Tier Searchable Card Dropdown Component
 * Enables fast search, card-based preview of products (English, Urdu, code, category),
 * followed by intelligent secondary variant selection (SKU, attributes, live stock).
 */

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

  const currentVariant = selectedVariantId
    ? variants.find(v => v.id === selectedVariantId)
    : (prodVariants[0] || variants[0] || null);

  const prodId = currentProduct ? currentProduct.id : '';
  const varId = currentVariant ? currentVariant.id : '';
  const currentUnit = (currentVariant && currentVariant.unit) ? currentVariant.unit : (currentProduct?.baseUnitId || 'PCS');

  return `
    <div class="pv-picker-container relative text-xs space-y-2" data-row-id="${rowId}">
      <!-- Hidden inputs for form extraction -->
      <input type="hidden" class="pv-selected-product-id" value="${prodId}">
      <input type="hidden" class="pv-selected-variant-id gp-item-var" value="${varId}" data-unit="${currentUnit}">
      <input type="hidden" class="pv-selected-unit" value="${currentUnit}">

      <!-- Tier 1: Product Selector Trigger Card -->
      <div class="relative">
        <div class="pv-product-trigger flex items-center justify-between p-2 rounded-xl bg-white border border-slate-200 hover:border-[#138FCB] shadow-2xs cursor-pointer transition-all">
          <div class="flex items-center gap-2.5 overflow-hidden">
            <div class="w-8 h-8 rounded-lg bg-blue-50 text-[#138FCB] flex items-center justify-center font-bold text-xs shrink-0">
              📦
            </div>
            <div class="truncate">
              <div class="flex items-center gap-1.5 flex-wrap">
                <span class="font-bold text-slate-800 text-xs pv-prod-display-name truncate">
                  ${currentProduct ? (currentProduct.customerName || currentProduct.businessName) : 'Select Product...'}
                </span>
                <span class="pv-prod-urdu text-[11px] font-medium text-slate-500 font-serif ${currentProduct?.urduName ? '' : 'hidden'}" dir="rtl">${currentProduct?.urduName || ''}</span>
              </div>
              <div class="flex items-center gap-1.5 text-[10px] text-slate-400 mt-0.5">
                <span class="pv-prod-code font-mono font-semibold text-[#138FCB]">${currentProduct?.code || ''}</span>
                <span>•</span>
                <span class="pv-prod-cat">${currentProduct?.businessName || ''}</span>
              </div>
            </div>
          </div>
          <svg class="w-4 h-4 text-slate-400 shrink-0 ml-1.5 transition-transform pv-arrow" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path d="M19 9l-7 7-7-7" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path>
          </svg>
        </div>

        <!-- Tier 1 Dropdown Menu (Searchable Product Card List) -->
        <div class="pv-product-menu hidden absolute top-full left-0 z-30 w-full sm:w-[380px] mt-1.5 bg-white rounded-2xl border border-slate-200 shadow-xl overflow-hidden animate-in fade-in duration-100">
          <div class="p-2.5 border-b border-slate-100 bg-slate-50/60 sticky top-0 z-10">
            <div class="relative">
              <input
                type="text"
                class="pv-product-search w-full pl-8 pr-3 py-1.5 text-xs bg-white border border-slate-200 rounded-xl focus:outline-none focus:border-[#138FCB] placeholder-slate-400 font-medium"
                placeholder="Search products by code, English or Urdu name...">
              <span class="absolute left-2.5 top-2 text-slate-400 text-xs">🔍</span>
            </div>
          </div>
          <div class="pv-product-list max-h-56 overflow-y-auto custom-scroll p-1.5 space-y-1">
            ${products.map(p => `
              <div
                class="pv-product-option p-2 rounded-xl hover:bg-blue-50/70 border border-transparent hover:border-blue-200 cursor-pointer transition-all ${p.id === prodId ? 'bg-blue-50/50 border-blue-200' : ''}"
                data-product-id="${p.id}"
                data-search="${(p.code + ' ' + p.businessName + ' ' + (p.customerName || '') + ' ' + (p.urduName || '')).toLowerCase()}">
                <div class="flex items-start justify-between gap-2">
                  <div class="truncate">
                    <div class="font-bold text-slate-800 text-xs truncate">${p.customerName || p.businessName}</div>
                    <div class="flex items-center gap-2 mt-0.5 text-[10px]">
                      <span class="font-mono font-semibold text-[#138FCB]">${p.code}</span>
                      <span class="text-slate-500 font-medium">(${p.businessName})</span>
                    </div>
                  </div>
                  ${p.urduName ? `
                    <span class="text-[11px] font-bold text-slate-600 shrink-0 font-serif" dir="rtl">${p.urduName}</span>
                  ` : ''}
                </div>
              </div>
            `).join('')}
          </div>
        </div>
      </div>

      <!-- Tier 2: Variant Selector (Visible if variants exist) -->
      <div class="pv-variant-section ${prodVariants.length > 0 ? '' : 'hidden'}">
        <div class="flex items-center gap-1.5 mb-1">
          <span class="text-[10px] font-bold uppercase tracking-wider text-slate-400">Variant / SKU:</span>
          <span class="pv-var-count-badge text-[10px] font-semibold text-[#138FCB] bg-blue-50 px-1.5 py-0.2 rounded">
            ${prodVariants.length > 1 ? `${prodVariants.length} options` : 'Single Standard SKU'}
          </span>
        </div>

        <div class="relative">
          <div class="pv-variant-trigger flex items-center justify-between p-2 rounded-xl bg-slate-50 border border-slate-200 hover:border-slate-300 shadow-2xs cursor-pointer transition-all">
            <div class="truncate">
              <div class="font-bold text-slate-900 text-xs pv-var-display-name truncate">
                ${currentVariant ? currentVariant.name : 'Select SKU Variant...'}
              </div>
              <div class="flex items-center gap-2 mt-0.5 text-[10px] text-slate-500">
                <span class="pv-var-sku font-mono text-[#138FCB] font-semibold">${currentVariant?.sku || ''}</span>
                <span class="pv-var-attrs flex items-center gap-1">
                  ${currentVariant?.attributes ? Object.entries(currentVariant.attributes).map(([k, v]) => `
                    <span class="bg-white border border-slate-200 px-1.5 py-0.5 rounded text-[9px] font-medium text-slate-600">${k}: ${v}</span>
                  `).join('') : ''}
                </span>
              </div>
            </div>
            <svg class="w-3.5 h-3.5 text-slate-400 shrink-0 ml-1.5 pv-var-arrow ${prodVariants.length > 1 ? '' : 'hidden'}" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path d="M19 9l-7 7-7-7" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path>
            </svg>
          </div>

          <!-- Tier 2 Dropdown (Searchable Variant Card List) -->
          <div class="pv-variant-menu hidden absolute top-full left-0 z-30 w-full sm:w-[360px] mt-1.5 bg-white rounded-2xl border border-slate-200 shadow-xl overflow-hidden animate-in fade-in duration-100">
            <div class="pv-variant-list max-h-52 overflow-y-auto custom-scroll p-1.5 space-y-1">
              ${prodVariants.map(v => `
                <div
                  class="pv-variant-option p-2 rounded-xl hover:bg-emerald-50/70 border border-transparent hover:border-emerald-200 cursor-pointer transition-all ${v.id === varId ? 'bg-emerald-50/50 border-emerald-200' : ''}"
                  data-variant-id="${v.id}">
                  <div class="font-bold text-slate-900 text-xs">${v.name}</div>
                  <div class="flex items-center gap-1.5 mt-1 flex-wrap">
                    <span class="font-mono text-[10px] font-semibold text-[#138FCB] bg-blue-50 px-1.5 py-0.5 rounded">${v.sku}</span>
                    ${v.attributes ? Object.entries(v.attributes).map(([k, val]) => `
                      <span class="text-[9px] bg-slate-100 text-slate-700 px-1.5 py-0.5 rounded font-medium">${val}</span>
                    `).join('') : ''}
                  </div>
                </div>
              `).join('')}
            </div>
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

  const varSection = container.querySelector('.pv-variant-section');
  const varTrigger = container.querySelector('.pv-variant-trigger');
  const varMenu = container.querySelector('.pv-variant-menu');
  const varArrow = container.querySelector('.pv-var-arrow');
  const varList = container.querySelector('.pv-variant-list');

  const hiddenProdId = container.querySelector('.pv-selected-product-id');
  const hiddenVarId = container.querySelector('.pv-selected-variant-id');
  const hiddenUnit = container.querySelector('.pv-selected-unit');

  const updateProductDisplay = (product) => {
    const nameEl = container.querySelector('.pv-prod-display-name');
    if (nameEl) nameEl.textContent = product.customerName || product.businessName || 'Select Product...';
    
    const urduEl = container.querySelector('.pv-prod-urdu');
    if (urduEl) {
      if (product.urduName) {
        urduEl.textContent = product.urduName;
        urduEl.classList.remove('hidden');
      } else {
        urduEl.classList.add('hidden');
      }
    }

    const codeEl = container.querySelector('.pv-prod-code');
    if (codeEl) codeEl.textContent = product.code || '';

    const catEl = container.querySelector('.pv-prod-cat');
    if (catEl) catEl.textContent = product.businessName || '';
  };

  const updateVariantDisplay = (variant, prodVariants) => {
    const nameEl = container.querySelector('.pv-var-display-name');
    if (nameEl) nameEl.textContent = variant ? variant.name : 'Select SKU Variant...';

    const skuEl = container.querySelector('.pv-var-sku');
    if (skuEl) skuEl.textContent = variant ? variant.sku : '';

    const attrsEl = container.querySelector('.pv-var-attrs');
    if (attrsEl) {
      attrsEl.innerHTML = variant?.attributes ? Object.entries(variant.attributes).map(([k, v]) => `
        <span class="bg-white border border-slate-200 px-1.5 py-0.5 rounded text-[9px] font-medium text-slate-600">${k}: ${v}</span>
      `).join('') : '';
    }

    const countBadge = container.querySelector('.pv-var-count-badge');
    if (countBadge) {
      if (prodVariants.length > 1) {
        countBadge.textContent = `${prodVariants.length} options`;
      } else {
        countBadge.textContent = 'Single Standard SKU';
      }
    }

    if (varArrow) {
      varArrow.classList.toggle('hidden', prodVariants.length <= 1);
    }

    if (varSection) {
      varSection.classList.toggle('hidden', prodVariants.length === 0);
    }
  };

  const bindVariantOptions = (prodVariants) => {
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
        if (varArrow) varArrow.classList.remove('rotate-180');

        updateVariantDisplay(selectedVar, prodVariants);

        // Highlight selected
        varList.querySelectorAll('.pv-variant-option').forEach(o => {
          o.classList.toggle('bg-emerald-50/50', o.getAttribute('data-variant-id') === vId);
          o.classList.toggle('border-emerald-200', o.getAttribute('data-variant-id') === vId);
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
      const chosenVariant = matchingVariants[0] || null;

      if (chosenVariant) {
        hiddenVarId.value = chosenVariant.id;
        const unitVal = chosenVariant.unit || 'PCS';
        hiddenVarId.setAttribute('data-unit', unitVal);
        if (hiddenUnit) hiddenUnit.value = unitVal;
      } else {
        hiddenVarId.value = '';
      }

      // Rebuild variant list
      if (varList) {
        varList.innerHTML = matchingVariants.map(v => `
          <div
            class="pv-variant-option p-2 rounded-xl hover:bg-emerald-50/70 border border-transparent hover:border-emerald-200 cursor-pointer transition-all ${v.id === chosenVariant?.id ? 'bg-emerald-50/50 border-emerald-200' : ''}"
            data-variant-id="${v.id}">
            <div class="font-bold text-slate-900 text-xs">${v.name}</div>
            <div class="flex items-center gap-1.5 mt-1 flex-wrap">
              <span class="font-mono text-[10px] font-semibold text-[#138FCB] bg-blue-50 px-1.5 py-0.5 rounded">${v.sku}</span>
              ${v.attributes ? Object.entries(v.attributes).map(([k, val]) => `
                <span class="text-[9px] bg-slate-100 text-slate-700 px-1.5 py-0.5 rounded font-medium">${val}</span>
              `).join('') : ''}
            </div>
          </div>
        `).join('');
        bindVariantOptions(matchingVariants);
      }

      updateVariantDisplay(chosenVariant, matchingVariants);

      if (onVariantChanged) {
        onVariantChanged({
          productId: pId,
          variantId: chosenVariant ? chosenVariant.id : null,
          product: selectedProd,
          variant: chosenVariant
        });
      }
    };
  });

  // Toggle Variant dropdown
  if (varTrigger && varMenu) {
    varTrigger.onclick = (e) => {
      e.stopPropagation();
      const currentPId = hiddenProdId.value;
      const currentMatching = variants.filter(v => v.productId === currentPId);
      if (currentMatching.length <= 1) return; // single variant, no dropdown needed

      document.querySelectorAll('.pv-product-menu, .pv-variant-menu').forEach(m => {
        if (m !== varMenu) m.classList.add('hidden');
      });
      varMenu.classList.toggle('hidden');
      if (varArrow) varArrow.classList.toggle('rotate-180', !varMenu.classList.contains('hidden'));
    };
  }

  // Initial variant options binding
  const initPId = hiddenProdId.value;
  const initMatching = variants.filter(v => v.productId === initPId);
  bindVariantOptions(initMatching);

  // Close when clicking outside
  document.addEventListener('click', () => {
    if (prodMenu) prodMenu.classList.add('hidden');
    if (prodArrow) prodArrow.classList.remove('rotate-180');
    if (varMenu) varMenu.classList.add('hidden');
    if (varArrow) varArrow.classList.remove('rotate-180');
  });
}
