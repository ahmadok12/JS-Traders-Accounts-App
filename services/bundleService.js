/**
 * JS Traders ERP - Simplified Bundle & Set Engine
 * 
 * CORE PRINCIPLE:
 * Bundle has:
 * - Bundle Name
 * - Quantity of Finished Bundle (usually 1)
 * - Selling Price (PKR)
 * - Components: [ { componentVariantId, productId, name, quantity, unit, unitPrice } ]
 * 
 * In Sales Order / Invoice:
 * - Selecting a bundle displays a collapse/expand toggle button.
 * - Multiplying bundle quantity automatically multiplies each component quantity proportionally:
 *   component.calculatedQty = component.baseQuantity * (bundleQty / baseBundleQty).
 * - Component quantities can be manually overridden.
 * - Changing quantity or price of component products recalculates bundle price dynamically.
 * - On Gatepass or Invoice print, only the single bundle line is shown:
 *   [Bundle Name] [Qty] x [Price]
 */

import { storageService } from './storageService.js';
import { productService } from './productService.js';

class BundleService {
  getBundles() {
    return storageService.getCollection('bundleDefinitions') || [];
  }

  getBundleDefinitions() {
    return this.getBundles();
  }

  getBundleById(id) {
    return storageService.getById('bundleDefinitions', id);
  }

  calculateBundleComponents(bundleId, bundleQty = 1, adjustments = {}) {
    const bundle = this.getBundleById(bundleId);
    if (!bundle) throw new Error(`Bundle definition "${bundleId}" not found.`);

    const targetBundleQty = Math.max(1, Number(bundleQty) || 1);
    const baseBundleQty = Math.max(1, Number(bundle.bundleQty) || 1);
    const multiplier = targetBundleQty / baseBundleQty;

    const variants = productService.getVariants();
    const varMap = new Map(variants.map(v => [v.id, v]));

    const adjMap = new Map();
    if (Array.isArray(adjustments)) {
      adjustments.forEach(adj => {
        if (adj.componentVariantId) adjMap.set(adj.componentVariantId, adj);
      });
    } else if (adjustments && typeof adjustments === 'object') {
      const extras = adjustments.extraQuantities || {};
      const overrides = adjustments.overrideQuantities || {};
      const prices = adjustments.prices || {};
      const allKeys = new Set([...Object.keys(extras), ...Object.keys(overrides), ...Object.keys(prices)]);
      allKeys.forEach(k => {
        adjMap.set(k, {
          componentVariantId: k,
          extraQty: extras[k],
          overrideQty: overrides[k],
          unitPrice: prices[k]
        });
      });
    }

    let calculatedTotalBundlePrice = 0;

    const components = (bundle.components || []).map(compDef => {
      const variant = varMap.get(compDef.componentVariantId) || {};
      const baseQty = Number(compDef.quantity) || Number(compDef.parameters?.quantityPerLine) || Number(compDef.parameters?.fixedQuantity) || 1;
      const calculatedQty = baseQty * multiplier;

      const userAdj = adjMap.get(compDef.componentVariantId);
      const extraQty = userAdj ? (Number(userAdj.extraQty) || 0) : 0;
      const overrideQty = (userAdj && userAdj.overrideQty !== undefined && userAdj.overrideQty !== null && userAdj.overrideQty !== '')
        ? Number(userAdj.overrideQty)
        : null;

      let finalQty = calculatedQty;
      if (overrideQty !== null && !isNaN(overrideQty)) {
        finalQty = Math.max(0, overrideQty);
      } else {
        finalQty = Math.max(0, calculatedQty + extraQty);
      }

      const defaultPrice = compDef.unitPrice !== undefined && compDef.unitPrice !== null
        ? Number(compDef.unitPrice)
        : (Number(variant.sellingPrice) || 0);
      const sellingPrice = (userAdj && userAdj.unitPrice !== undefined) ? Number(userAdj.unitPrice) : defaultPrice;
      const lineTotal = finalQty * sellingPrice;
      calculatedTotalBundlePrice += lineTotal;

      return {
        componentVariantId: compDef.componentVariantId,
        productId: compDef.productId || variant.productId,
        name: compDef.name || variant.name || 'Component',
        variantName: compDef.name || variant.name || 'Component',
        sku: variant.sku || '',
        costPrice: Number(variant.costPrice) || 0,
        sellingPrice,
        unitPrice: sellingPrice,
        baseQty,
        calculatedQty,
        extraQty,
        overrideQty,
        finalQty,
        lineTotal,
        unit: compDef.unit || variant.unit || 'PCS'
      };
    });

    const bundleUnitPrice = targetBundleQty > 0 ? (calculatedTotalBundlePrice / targetBundleQty) : (bundle.sellingPrice || 0);

    return {
      bundleId: bundle.id,
      bundleCode: bundle.code,
      bundleName: bundle.name,
      bundleType: bundle.bundleType || 'BUNDLE',
      bundleQty: targetBundleQty,
      baseBundleQty,
      sellingPrice: (bundle.sellingPrice !== undefined && bundle.sellingPrice !== null && Number(bundle.sellingPrice) > 0)
        ? Number(bundle.sellingPrice)
        : bundleUnitPrice,
      calculatedTotalBundlePrice,
      numberOfLines: targetBundleQty,
      components
    };
  }

  createBundle(bundleData) {
    const bundles = this.getBundles();
    const code = bundleData.code || `BND-${String(bundles.length + 1).padStart(4, '0')}`;
    return storageService.insert('bundleDefinitions', {
      ...bundleData,
      code,
      bundleQty: Number(bundleData.bundleQty) || 1,
      sellingPrice: Number(bundleData.sellingPrice) || 0,
      components: (bundleData.components || []).map((c, idx) => ({
        id: c.id || `bc-${Date.now()}-${idx}`,
        componentVariantId: c.componentVariantId,
        productId: c.productId || null,
        name: c.name || '',
        quantity: Number(c.quantity) || 1,
        unit: c.unit || 'PCS',
        unitPrice: Number(c.unitPrice) || 0
      }))
    });
  }

  updateBundle(id, bundleData) {
    return storageService.update('bundleDefinitions', id, {
      ...bundleData,
      bundleQty: Number(bundleData.bundleQty) || 1,
      sellingPrice: Number(bundleData.sellingPrice) || 0,
      components: (bundleData.components || []).map((c, idx) => ({
        id: c.id || `bc-${Date.now()}-${idx}`,
        componentVariantId: c.componentVariantId,
        productId: c.productId || null,
        name: c.name || '',
        quantity: Number(c.quantity) || 1,
        unit: c.unit || 'PCS',
        unitPrice: Number(c.unitPrice) || 0
      }))
    });
  }
}

export const bundleService = new BundleService();
