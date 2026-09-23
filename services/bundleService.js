/**
 * JS Traders ERP - Bundle, Set & Variable System Engine
 * 
 * CORE PRINCIPLE:
 * Product Master defines what a product is.
 * The Bundle definition determines how that product is used and calculated within that bundle/system.
 * 
 * Supports:
 * 1. Fixed Set (e.g. Pulley Set, Inverter Set) - Directly proportional, components hidden by default.
 * 2. Variable System (e.g. Feeding Line, Drinking Line) - Rules per component:
 *    - PER_LINE: lines * quantityPerLine
 *    - FIXED_QTY: fixedQuantity
 *    - PER_GROUP_CEIL: Math.ceil(lines / linesPerGroup) * quantityPerGroup
 *    - PER_GROUP_FLOOR: Math.floor(lines / linesPerGroup) * quantityPerGroup
 *    - MANUAL: manual entry
 * 3. Extra Qty: Final Qty = Calculated Qty + Extra Qty
 * 4. Override Qty: Final Qty = Override Qty
 */

import { storageService } from './storageService.js';
import { productService } from './productService.js';

class BundleService {
  getBundles() {
    return storageService.getCollection('bundleDefinitions') || [];
  }

  getBundleById(id) {
    return storageService.getById('bundleDefinitions', id);
  }

  // Calculate required component quantities based on bundle rules and line count
  calculateBundleComponents(bundleId, numberOfLines = 1, adjustments = []) {
    const bundle = this.getBundleById(bundleId);
    if (!bundle) throw new Error(`Bundle definition "${bundleId}" not found.`);

    const linesCount = Math.max(1, Number(numberOfLines) || 1);
    const variants = productService.getVariants();
    const varMap = new Map(variants.map(v => [v.id, v]));

    const adjMap = new Map();
    (adjustments || []).forEach(adj => {
      if (adj.componentVariantId) {
        adjMap.set(adj.componentVariantId, adj);
      }
    });

    const components = (bundle.components || []).map(compDef => {
      const variant = varMap.get(compDef.componentVariantId) || {};
      const rule = compDef.quantityRule || 'PER_LINE';
      const params = compDef.parameters || {};

      let calculatedQty = 0;
      let calculationText = '';

      switch (rule) {
        case 'PER_LINE': {
          const perLine = Number(params.quantityPerLine) || 1;
          calculatedQty = linesCount * perLine;
          calculationText = `${perLine} × ${linesCount} lines = ${calculatedQty}`;
          break;
        }
        case 'FIXED_QTY': {
          calculatedQty = Number(params.fixedQuantity) || 1;
          calculationText = `Fixed: ${calculatedQty}`;
          break;
        }
        case 'PER_GROUP_CEIL': {
          const lpg = Number(params.linesPerGroup) || 1;
          const qpg = Number(params.quantityPerGroup) || 1;
          const groups = Math.ceil(linesCount / lpg);
          calculatedQty = groups * qpg;
          calculationText = `CEIL(${linesCount} ÷ ${lpg}) × ${qpg} = ${calculatedQty} (${qpg} per ${lpg} lines)`;
          break;
        }
        case 'PER_GROUP_FLOOR': {
          const lpg = Number(params.linesPerGroup) || 1;
          const qpg = Number(params.quantityPerGroup) || 1;
          const groups = Math.floor(linesCount / lpg);
          calculatedQty = groups * qpg;
          calculationText = `FLOOR(${linesCount} ÷ ${lpg}) × ${qpg} = ${calculatedQty}`;
          break;
        }
        case 'MANUAL': {
          calculatedQty = Number(params.defaultQuantity) || 0;
          calculationText = `Manual Entry`;
          break;
        }
        default: {
          calculatedQty = linesCount;
          calculationText = `${linesCount} × 1 = ${linesCount}`;
        }
      }

      // Check for user adjustments (Extra Qty or Override Qty)
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

      return {
        componentVariantId: compDef.componentVariantId,
        variantName: variant.name || 'Component',
        sku: variant.sku || '',
        costPrice: Number(variant.costPrice) || 0,
        sellingPrice: Number(variant.sellingPrice) || 0,
        quantityRule: rule,
        parameters: params,
        ruleDescription: compDef.ruleDescription || calculationText,
        calculationText,
        calculatedQty,
        extraQty,
        overrideQty,
        finalQty,
        unit: compDef.unit || variant.unit || 'PCS'
      };
    });

    return {
      bundleId: bundle.id,
      bundleCode: bundle.code,
      bundleName: bundle.name,
      bundleType: bundle.bundleType,
      allowComponentAdjustment: Boolean(bundle.allowComponentAdjustment),
      sellingPrice: Number(bundle.sellingPrice) || 0,
      numberOfLines: linesCount,
      components
    };
  }

  createBundle(bundleData) {
    const bundles = this.getBundles();
    const code = bundleData.code || `BND-${String(bundles.length + 1).padStart(4, '0')}`;
    return storageService.insert('bundleDefinitions', {
      ...bundleData,
      code,
      components: bundleData.components || []
    });
  }

  updateBundle(id, bundleData) {
    return storageService.update('bundleDefinitions', id, bundleData);
  }
}

export const bundleService = new BundleService();
