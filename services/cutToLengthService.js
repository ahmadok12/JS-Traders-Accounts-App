/**
 * JS Traders ERP - Variant-Level Cut-to-Length & Roll Packaging Engine
 * 
 * CORE PRINCIPLES:
 * 1. Variant-Level Definition: Standard roll lengths (e.g. 5,000 ft, 450 ft, 400 ft) are configured
 *    directly at the Variant level (isCutToLength, rollLength, rollUnit).
 * 2. Variant Stock Model:
 *    - fullRolls: Count of full intact rolls in a warehouse (e.g. 5)
 *    - rollLength: Standard length of 1 roll (e.g. 5,000 ft)
 *    - loosePieces: Array of available cut lengths (e.g. [1,000, 3,500])
 *    - unit: 'ft', 'm', etc.
 * 3. 3 Order Allocation Modes:
 *    - 'rolls': Fulfill full intact rolls. Deducts count directly. Loose pieces untouched.
 *    - 'loose_continuous': Fulfill a single continuous cut length.
 *        - Step 1: Check existing loose pieces for piece >= requested. Pick smallest sufficient (best fit).
 *        - Step 2: If none sufficient, cut from 1 new roll. Remainder stays as loose piece.
 *    - 'loose_pcs': Fulfill total length, allowing multiple pieces combined together.
 *        - Step 1: If a single loose piece is >= requested, pick smallest sufficient piece.
 *        - Step 2: Otherwise, combine existing loose pieces. If deficit remains, open new roll(s)
 *          and add the remaining length to loose pieces.
 */

import { storageService } from './storageService.js';
import { productService } from './productService.js';

class CutToLengthService {
  constructor() {
    this.COLLECTION_VARIANT_STOCKS = 'variantRollStocks';
    this.COLLECTION_TXS = 'cutToLengthTransactions';
    this.COLLECTION_UNITS = 'cutToLengthUnits'; // For backward compatibility
  }

  // --- VARIANT-LEVEL STOCK MANAGEMENT ---

  /**
   * Retrieves or initializes the roll & loose inventory balance for a variant in a warehouse
   */
  getVariantStock(warehouseId = 'wh-1', variantId) {
    if (!variantId) return null;
    const stocks = storageService.getCollection(this.COLLECTION_VARIANT_STOCKS) || [];
    let record = stocks.find(s => s.warehouseId === warehouseId && s.variantId === variantId);

    if (record) {
      return {
        ...record,
        fullRolls: Number(record.fullRolls) || 0,
        rollLength: Number(record.rollLength) || 5000,
        loosePieces: Array.isArray(record.loosePieces) ? record.loosePieces.map(Number) : [],
        unit: record.unit || 'ft'
      };
    }

    // Auto-initialize from variant metadata & existing balances
    const variant = productService.getVariantById(variantId);
    if (!variant) return null;
    const product = productService.getProductById(variant.productId);

    const isCtl = Boolean(variant.isCutToLength || variant.rollLength || product?.cut_to_length || product?.enableRollTracking);
    const rollLength = Number(variant.rollLength || variant.rollSize || product?.packagingUnits?.[0]?.factor || 5000);
    const unit = variant.rollUnit || variant.unit || product?.base_unit || 'ft';

    // Check if legacy physical units exist for this variant in the warehouse
    const legacyUnits = (storageService.getCollection(this.COLLECTION_UNITS) || []).filter(
      u => u.variantId === variantId && u.warehouseId === warehouseId && u.status === 'AVAILABLE'
    );

    let fullRolls = 0;
    let loosePieces = [];

    if (legacyUnits.length > 0) {
      fullRolls = legacyUnits.filter(u => u.classification === 'FULL').length;
      loosePieces = legacyUnits.filter(u => u.classification === 'LOOSE').map(u => Number(u.quantity));
    } else {
      // Fallback defaults for standard seed products
      if (variantId === 'var-5' && warehouseId === 'wh-1') {
        fullRolls = 5;
        loosePieces = [];
      } else if (variantId === 'var-9-450' && warehouseId === 'wh-1') {
        fullRolls = 5;
        loosePieces = [];
      } else if (variantId === 'var-9-400' && warehouseId === 'wh-1') {
        fullRolls = 3;
        loosePieces = [];
      } else {
        const bal = storageService.getCollection('stockBalances')?.find(b => b.warehouseId === warehouseId && b.variantId === variantId);
        if (bal && Number(bal.quantity) > 0 && rollLength > 0) {
          fullRolls = Math.floor(Number(bal.quantity) / rollLength);
          const remainder = Number(bal.quantity) % rollLength;
          if (remainder > 0) loosePieces.push(remainder);
        }
      }
    }

    record = {
      id: `vrs-${warehouseId}-${variantId}`,
      warehouseId,
      variantId,
      productId: variant.productId,
      fullRolls,
      rollLength,
      loosePieces,
      unit,
      updatedAt: new Date().toISOString()
    };

    storageService.insert(this.COLLECTION_VARIANT_STOCKS, record);
    return record;
  }

  /**
   * Saves / updates variant roll and loose balances and synchronizes stockBalances
   */
  saveVariantStock(warehouseId, variantId, { fullRolls, rollLength, loosePieces, unit }) {
    const stocks = storageService.getCollection(this.COLLECTION_VARIANT_STOCKS) || [];
    const existing = stocks.find(s => s.warehouseId === warehouseId && s.variantId === variantId);

    const safeFullRolls = Math.max(0, Math.round(Number(fullRolls) || 0));
    const safeRollLength = Math.max(1, Number(rollLength) || 5000);
    const safeLoose = (loosePieces || []).map(Number).filter(n => !isNaN(n) && n > 0);
    const safeUnit = unit || 'ft';

    const variant = productService.getVariantById(variantId);
    const productId = variant?.productId || null;

    let updatedRecord = null;
    const timestamp = new Date().toISOString();

    if (existing) {
      updatedRecord = storageService.update(this.COLLECTION_VARIANT_STOCKS, existing.id, {
        fullRolls: safeFullRolls,
        rollLength: safeRollLength,
        loosePieces: safeLoose,
        unit: safeUnit,
        updatedAt: timestamp
      });
    } else {
      updatedRecord = storageService.insert(this.COLLECTION_VARIANT_STOCKS, {
        id: `vrs-${warehouseId}-${variantId}`,
        warehouseId,
        variantId,
        productId,
        fullRolls: safeFullRolls,
        rollLength: safeRollLength,
        loosePieces: safeLoose,
        unit: safeUnit,
        updatedAt: timestamp
      });
    }

    // Sync authoritative stockBalances (total footage = fullRolls * rollLength + loose)
    const totalFootage = (safeFullRolls * safeRollLength) + safeLoose.reduce((sum, p) => sum + p, 0);
    this.syncProductStockBalance(productId, warehouseId, variantId, totalFootage, safeUnit);

    return updatedRecord;
  }

  // --- ALLOCATION SIMULATION & COMMIT ENGINE ---

  /**
   * Simulates how an order request will be fulfilled according to the selected mode:
   * Mode 1: 'rolls'
   * Mode 2: 'loose_continuous'
   * Mode 3: 'loose_pcs'
   */
  simulateAllocation({ warehouseId = 'wh-1', variantId, mode = 'loose_continuous', quantity }) {
    const stock = this.getVariantStock(warehouseId, variantId);
    if (!stock) {
      return { canFulfill: false, error: 'Variant stock record not found.' };
    }

    const { fullRolls, rollLength, loosePieces, unit } = stock;

    // --- MODE 1: ROLLS ---
    if (mode === 'rolls' || mode === 'Rolls') {
      const reqRolls = Math.round(Number(quantity));
      if (reqRolls <= 0) {
        return { canFulfill: false, error: 'Please enter a valid roll count (> 0).' };
      }
      if (reqRolls > fullRolls) {
        return {
          canFulfill: false,
          error: `Insufficient full rolls in ${warehouseId === 'wh-1' ? 'Warehouse' : 'Office'}. Available: ${fullRolls} roll(s), Requested: ${reqRolls} roll(s).`,
          availableRolls: fullRolls,
          requestedRolls: reqRolls
        };
      }

      const fullRollsAfter = fullRolls - reqRolls;
      const loosePiecesAfter = [...loosePieces];
      const totalFootage = reqRolls * rollLength;

      return {
        canFulfill: true,
        mode: 'rolls',
        warehouseId,
        variantId,
        rollLength,
        unit,
        requestedQty: reqRolls,
        fullRollsBefore: fullRolls,
        fullRollsAfter,
        loosePiecesBefore: [...loosePieces],
        loosePiecesAfter,
        rollsDeducted: reqRolls,
        loosePiecesConsumed: [],
        newLoosePieceCreated: 0,
        totalFootage,
        summaryText: `📦 Fulfilling with ${reqRolls} full roll(s) (${totalFootage.toLocaleString()} ${unit}). Remaining: ${fullRollsAfter} roll(s)${loosePiecesAfter.length > 0 ? ' + ' + loosePiecesAfter.reduce((s, p) => s + p, 0).toLocaleString() + ' ' + unit + ' loose' : ''}.`
      };
    }

    // --- MODE 2: LOOSE - CONTINUOUS ---
    if (mode === 'loose_continuous' || mode === 'continuous') {
      const reqLen = Number(quantity);
      if (reqLen <= 0) {
        return { canFulfill: false, error: 'Please enter a valid continuous length (> 0).' };
      }

      // Step 1: Check existing loose pieces for piece >= reqLen
      const eligibleLoose = loosePieces
        .map((len, idx) => ({ len, idx }))
        .filter(item => item.len >= reqLen);

      if (eligibleLoose.length > 0) {
        // Pick the smallest sufficient loose piece (best-fit)
        eligibleLoose.sort((a, b) => a.len - b.len);
        const chosen = eligibleLoose[0];
        const rem = chosen.len - reqLen;

        const loosePiecesAfter = [...loosePieces];
        if (rem > 0) {
          loosePiecesAfter[chosen.idx] = rem;
        } else {
          loosePiecesAfter.splice(chosen.idx, 1);
        }

        const fullRollsAfter = fullRolls;
        return {
          canFulfill: true,
          mode: 'loose_continuous',
          warehouseId,
          variantId,
          rollLength,
          unit,
          requestedQty: reqLen,
          fullRollsBefore: fullRolls,
          fullRollsAfter,
          loosePiecesBefore: [...loosePieces],
          loosePiecesAfter,
          rollsDeducted: 0,
          loosePiecesConsumed: [{ original: chosen.len, cut: reqLen, remainder: rem }],
          newLoosePieceCreated: rem,
          totalFootage: reqLen,
          summaryText: `✂️ Cut ${reqLen.toLocaleString()} ${unit} continuous from existing loose piece of ${chosen.len.toLocaleString()} ${unit}. Remaining: ${fullRollsAfter} roll(s) + loose: [${loosePiecesAfter.map(n => n.toLocaleString()).join(', ') || '0'}] ${unit}.`
        };
      }

      // Step 2: No loose piece is >= reqLen. Cut from 1 new roll!
      if (reqLen > rollLength) {
        return {
          canFulfill: false,
          error: `Requested continuous length (${reqLen.toLocaleString()} ${unit}) exceeds standard roll length (${rollLength.toLocaleString()} ${unit}). Continuous cut cannot be fulfilled from a single roll.`
        };
      }

      if (fullRolls < 1) {
        return {
          canFulfill: false,
          error: `No full rolls available to cut from in ${warehouseId === 'wh-1' ? 'Warehouse' : 'Office'}. Available loose pieces are too short for ${reqLen.toLocaleString()} ${unit} continuous.`
        };
      }

      const fullRollsAfter = fullRolls - 1;
      const rem = rollLength - reqLen;
      const loosePiecesAfter = [...loosePieces];
      if (rem > 0) {
        loosePiecesAfter.push(rem);
      }

      return {
        canFulfill: true,
        mode: 'loose_continuous',
        warehouseId,
        variantId,
        rollLength,
        unit,
        requestedQty: reqLen,
        fullRollsBefore: fullRolls,
        fullRollsAfter,
        loosePiecesBefore: [...loosePieces],
        loosePiecesAfter,
        rollsDeducted: 1,
        loosePiecesConsumed: [],
        newLoosePieceCreated: rem,
        totalFootage: reqLen,
        summaryText: `✂️ No loose piece is >= ${reqLen.toLocaleString()} ${unit}. Cutting ${reqLen.toLocaleString()} ${unit} from 1 new roll (${rollLength.toLocaleString()} ${unit}). Remaining: ${fullRollsAfter} roll(s) + loose: [${loosePiecesAfter.map(n => n.toLocaleString()).join(', ') || '0'}] ${unit}.`
      };
    }

    // --- MODE 3: LOOSE - PCS (MULTIPLE PIECES JOINED TOGETHER) ---
    if (mode === 'loose_pcs' || mode === 'pcs' || mode === 'pieces') {
      const reqLen = Number(quantity);
      if (reqLen <= 0) {
        return { canFulfill: false, error: 'Please enter a valid length (> 0).' };
      }

      // Step 1: Can it be fulfilled by a single loose piece without cutting into another?
      const eligibleLoose = loosePieces
        .map((len, idx) => ({ len, idx }))
        .filter(item => item.len >= reqLen);

      if (eligibleLoose.length > 0) {
        eligibleLoose.sort((a, b) => a.len - b.len);
        const chosen = eligibleLoose[0];
        const rem = chosen.len - reqLen;

        const loosePiecesAfter = [...loosePieces];
        if (rem > 0) {
          loosePiecesAfter[chosen.idx] = rem;
        } else {
          loosePiecesAfter.splice(chosen.idx, 1);
        }

        const fullRollsAfter = fullRolls;
        return {
          canFulfill: true,
          mode: 'loose_pcs',
          warehouseId,
          variantId,
          rollLength,
          unit,
          requestedQty: reqLen,
          fullRollsBefore: fullRolls,
          fullRollsAfter,
          loosePiecesBefore: [...loosePieces],
          loosePiecesAfter,
          rollsDeducted: 0,
          loosePiecesConsumed: [{ original: chosen.len, cut: reqLen, remainder: rem }],
          newLoosePieceCreated: rem,
          totalFootage: reqLen,
          summaryText: `✂️ Cut ${reqLen.toLocaleString()} ${unit} from loose piece of ${chosen.len.toLocaleString()} ${unit}. Remaining: ${fullRollsAfter} roll(s) + loose: [${loosePiecesAfter.map(n => n.toLocaleString()).join(', ') || '0'}] ${unit}.`
        };
      }

      // Step 2: No single loose piece is >= reqLen. Combine loose pieces + open roll if needed!
      const totalLoose = loosePieces.reduce((sum, p) => sum + p, 0);
      const totalAvailable = (fullRolls * rollLength) + totalLoose;

      if (reqLen > totalAvailable) {
        return {
          canFulfill: false,
          error: `Insufficient total stock in facility. Available: ${totalAvailable.toLocaleString()} ${unit}, Requested: ${reqLen.toLocaleString()} ${unit}.`
        };
      }

      // If available loose pieces alone are enough to fulfill reqLen
      if (totalLoose >= reqLen) {
        let remainingNeeded = reqLen;
        const sorted = [...loosePieces].sort((a, b) => a - b);
        const consumedDetails = [];
        const loosePiecesAfter = [];

        for (let i = 0; i < sorted.length; i++) {
          const p = sorted[i];
          if (remainingNeeded <= 0) {
            loosePiecesAfter.push(p);
            continue;
          }
          if (p <= remainingNeeded) {
            consumedDetails.push(p);
            remainingNeeded -= p;
          } else {
            const cut = remainingNeeded;
            const rem = p - cut;
            consumedDetails.push(cut);
            loosePiecesAfter.push(rem);
            remainingNeeded = 0;
          }
        }

        return {
          canFulfill: true,
          mode: 'loose_pcs',
          warehouseId,
          variantId,
          rollLength,
          unit,
          requestedQty: reqLen,
          fullRollsBefore: fullRolls,
          fullRollsAfter: fullRolls,
          loosePiecesBefore: [...loosePieces],
          loosePiecesAfter,
          rollsDeducted: 0,
          loosePiecesConsumed: consumedDetails,
          newLoosePieceCreated: 0,
          totalFootage: reqLen,
          summaryText: `✂️ Combining available loose pieces (${consumedDetails.map(n => n.toLocaleString()).join(' + ')} ${unit}). Remaining: ${fullRolls} roll(s) + loose: [${loosePiecesAfter.map(n => n.toLocaleString()).join(', ') || '0'}] ${unit}.`
        };
      }

      // If total loose < reqLen: consume all loose pieces and cut the deficit from new roll(s)
      const deficit = reqLen - totalLoose;
      const rollsNeeded = Math.ceil(deficit / rollLength);

      if (fullRolls < rollsNeeded) {
        return {
          canFulfill: false,
          error: `Insufficient full rolls to cover remaining deficit of ${deficit.toLocaleString()} ${unit}. Needed: ${rollsNeeded} roll(s), Available: ${fullRolls} roll(s).`
        };
      }

      const fullRollsAfter = fullRolls - rollsNeeded;
      const remainder = (rollsNeeded * rollLength) - deficit;
      const loosePiecesAfter = [];
      if (remainder > 0) {
        loosePiecesAfter.push(remainder);
      }

      const looseContributionText = totalLoose > 0 ? `${totalLoose.toLocaleString()} ${unit} from loose + ` : '';
      return {
        canFulfill: true,
        mode: 'loose_pcs',
        warehouseId,
        variantId,
        rollLength,
        unit,
        requestedQty: reqLen,
        fullRollsBefore: fullRolls,
        fullRollsAfter,
        loosePiecesBefore: [...loosePieces],
        loosePiecesAfter,
        rollsDeducted: rollsNeeded,
        loosePiecesConsumed: [...loosePieces],
        newLoosePieceCreated: remainder,
        totalFootage: reqLen,
        summaryText: `✂️ Fulfilling using ${looseContributionText}${deficit.toLocaleString()} ${unit} cut from ${rollsNeeded} new roll(s). Remaining: ${fullRollsAfter} roll(s)${remainder > 0 ? ' and ' + remainder.toLocaleString() + ' ' + unit + ' loose' : ''}.`
      };
    }

    return { canFulfill: false, error: `Unsupported allocation mode: "${mode}".` };
  }

  /**
   * Commits the allocation plan atomically to the database
   */
  commitAllocation(plan, { referenceDocType = 'salesOrder', referenceDocId = 'SO', userId = 'user-admin', notes = '' } = {}) {
    if (!plan || !plan.canFulfill) {
      throw new Error(plan?.error || 'Cannot commit an unfulfillable allocation plan.');
    }

    const { warehouseId, variantId, fullRollsAfter, rollLength, loosePiecesAfter, unit } = plan;

    // Update variant roll stock balance
    this.saveVariantStock(warehouseId, variantId, {
      fullRolls: fullRollsAfter,
      rollLength,
      loosePieces: loosePiecesAfter,
      unit
    });

    // Record audit transaction
    const timestamp = new Date().toISOString();
    const tx = storageService.insert(this.COLLECTION_TXS, {
      transactionType: plan.mode === 'rolls' ? 'SALE_FULL_ROLL' : (plan.rollsDeducted > 0 ? 'ROLL_OPEN' : 'SALE_CUT'),
      referenceDocType,
      referenceDocId,
      variantId,
      warehouseId,
      mode: plan.mode,
      rollLength,
      unit,
      requestedQty: plan.requestedQty,
      totalFootage: plan.totalFootage,
      rollsDeducted: plan.rollsDeducted,
      fullRollsBefore: plan.fullRollsBefore,
      fullRollsAfter: plan.fullRollsAfter,
      loosePiecesBefore: plan.loosePiecesBefore,
      loosePiecesAfter: plan.loosePiecesAfter,
      userId,
      notes: notes || plan.summaryText,
      createdAt: timestamp
    });

    return {
      success: true,
      transaction: tx,
      plan
    };
  }

  /**
   * Legacy alias for planAllocation
   */
  planAllocation({ productId, variantId = null, warehouseId = 'wh-1', requestedQty, unit = 'ft', allowMultiPieces = false }) {
    // If variantId is not provided, look up matching variant by packaging / roll size
    let targetVariantId = variantId;
    if (!targetVariantId && productId) {
      const variants = productService.getVariantsByProduct(productId) || [];
      const cleanUnit = (unit || '').replace(/,/g, '');
      const match = variants.find(v => {
        if (!unit) return false;
        const size = String(v.rollLength || v.rollSize || '');
        return (size && cleanUnit.includes(size)) || (v.packagingName && (unit.includes(v.packagingName) || cleanUnit.includes(v.packagingName.replace(/,/g, ''))));
      });
      targetVariantId = match ? match.id : (variants[0]?.id || null);
    }

    const isRollMode = unit && (unit.toLowerCase().includes('roll') || unit.startsWith('Roll'));
    const mode = isRollMode ? 'rolls' : (allowMultiPieces ? 'loose_pcs' : 'loose_continuous');

    const result = this.simulateAllocation({
      warehouseId,
      variantId: targetVariantId,
      mode,
      quantity: requestedQty
    });

    if (!result.canFulfill) return result;

    // Map to legacy plan object format for backwards compatibility
    return {
      ...result,
      productId,
      variantId: targetVariantId,
      baseUnit: result.unit,
      targetLength: result.totalFootage,
      type: result.mode === 'rolls' ? 'FULL_ROLL_SALE' : (result.rollsDeducted > 0 ? 'OPEN_FULL_ROLL_CUT' : 'LOOSE_PIECE_CUT'),
      rollsToDeduct: result.rollsDeducted > 0 ? Array(result.rollsDeducted).fill({ length: result.rollLength, classification: 'FULL' }) : [],
      sourceUnit: {
        originalLength: result.loosePiecesConsumed?.[0]?.original || result.rollLength,
        cutLength: result.requestedQty,
        remainingLength: result.newLoosePieceCreated,
        becomesConsumed: true
      },
      newLoosePiece: result.newLoosePieceCreated > 0 ? {
        remainingLength: result.newLoosePieceCreated,
        initialQuantity: result.rollLength
      } : null
    };
  }

  /**
   * Reverses allocation if an order or invoice is cancelled
   */
  rollbackAllocation(referenceDocType, referenceDocId, userId = 'user-admin') {
    const txs = storageService.getCollection(this.COLLECTION_TXS) || [];
    const docTxs = txs.filter(t => t.referenceDocType === referenceDocType && t.referenceDocId === referenceDocId);
    if (!docTxs.length) return false;

    for (const tx of docTxs) {
      if (tx.variantId && tx.warehouseId && tx.fullRollsBefore !== undefined) {
        const curStock = this.getVariantStock(tx.warehouseId, tx.variantId);
        this.saveVariantStock(tx.warehouseId, tx.variantId, {
          fullRolls: tx.fullRollsBefore,
          rollLength: tx.rollLength || curStock?.rollLength || 5000,
          loosePieces: tx.loosePiecesBefore || [],
          unit: tx.unit || curStock?.unit || 'ft'
        });
      }
    }
    return true;
  }

  // --- QUERY & REPORTING HELPERS ---

  /**
   * Comprehensive inventory summary for a Cut-to-Length product, optionally isolated by variantId
   */
  getSummary(productId, warehouseId = null, variantId = null) {
    const product = productService.getProductById(productId);
    if (!product) return null;
    const variants = productService.getVariantsByProduct(productId) || [];

    const isCtl = Boolean(product.cut_to_length || product.enableRollTracking || variants.some(v => v.isCutToLength || v.rollLength));
    if (!isCtl) return null;

    const effectiveWarehouseId = (warehouseId && warehouseId !== 'all') ? warehouseId : 'wh-1';

    // If a specific variant is requested
    if (variantId && variantId !== 'all') {
      const stock = this.getVariantStock(effectiveWarehouseId, variantId);
      if (!stock) return null;

      const fullRollsFootage = stock.fullRolls * stock.rollLength;
      const loosePiecesFootage = stock.loosePieces.reduce((sum, p) => sum + p, 0);
      const totalFootage = fullRollsFootage + loosePiecesFootage;

      return {
        productId,
        variantId,
        warehouseId: effectiveWarehouseId,
        baseUnit: stock.unit || 'ft',
        unit: stock.unit || 'ft',
        fullRollsCount: stock.fullRolls,
        fullRollsFootage,
        loosePiecesCount: stock.loosePieces.length,
        loosePiecesFootage,
        totalFootage,
        loosePieces: stock.loosePieces.map((len, idx) => ({ id: `loose-${idx + 1}`, quantity: len, classification: 'LOOSE' })),
        fullRolls: Array(stock.fullRolls).fill({ quantity: stock.rollLength, classification: 'FULL' }),
        rollsBySize: [{
          rollSize: stock.rollLength,
          packagingName: `Roll (${stock.rollLength.toLocaleString()} ${stock.unit})`,
          count: stock.fullRolls,
          totalLength: fullRollsFootage
        }],
        variantsBreakdown: []
      };
    }

    // Overall product summary across all its variants
    let totalFullRolls = 0;
    let totalFullFootage = 0;
    let totalLooseCount = 0;
    let totalLooseFootage = 0;
    const allLoose = [];
    const allFull = [];
    const rollsBySizeMap = {};

    const variantsBreakdown = variants.map(v => {
      const stock = this.getVariantStock(effectiveWarehouseId, v.id);
      if (!stock) return null;

      const vFullFootage = stock.fullRolls * stock.rollLength;
      const vLooseFootage = stock.loosePieces.reduce((sum, p) => sum + p, 0);
      const vTotal = vFullFootage + vLooseFootage;

      totalFullRolls += stock.fullRolls;
      totalFullFootage += vFullFootage;
      totalLooseCount += stock.loosePieces.length;
      totalLooseFootage += vLooseFootage;

      stock.loosePieces.forEach((len, idx) => {
        allLoose.push({ id: `loose-${v.id}-${idx}`, quantity: len, classification: 'LOOSE', variantId: v.id });
      });

      for (let i = 0; i < stock.fullRolls; i++) {
        allFull.push({ id: `full-${v.id}-${i}`, quantity: stock.rollLength, classification: 'FULL', variantId: v.id });
      }

      const sizeKey = `${stock.rollLength} ${stock.unit}`;
      if (!rollsBySizeMap[sizeKey]) {
        rollsBySizeMap[sizeKey] = {
          rollSize: stock.rollLength,
          unit: stock.unit,
          packagingName: `Roll (${stock.rollLength.toLocaleString()} ${stock.unit})`,
          count: 0,
          totalLength: 0
        };
      }
      rollsBySizeMap[sizeKey].count += stock.fullRolls;
      rollsBySizeMap[sizeKey].totalLength += vFullFootage;

      return {
        variantId: v.id,
        variantName: v.name,
        sku: v.sku,
        rollSize: stock.rollLength,
        fullRollsCount: stock.fullRolls,
        fullRollsFootage: vFullFootage,
        loosePiecesCount: stock.loosePieces.length,
        loosePiecesFootage: vLooseFootage,
        totalFootage: vTotal,
        loosePieces: stock.loosePieces,
        fullRolls: stock.fullRolls
      };
    }).filter(Boolean);

    return {
      productId,
      variantId: null,
      warehouseId: effectiveWarehouseId,
      baseUnit: product?.base_unit || 'ft',
      unit: product?.base_unit || 'ft',
      fullRollsCount: totalFullRolls,
      fullRollsFootage: totalFullFootage,
      loosePiecesCount: totalLooseCount,
      loosePiecesFootage: totalLooseFootage,
      totalFootage: totalFullFootage + totalLooseFootage,
      rollsBySize: Object.values(rollsBySizeMap),
      variantsBreakdown,
      fullRolls: allFull,
      loosePieces: allLoose
    };
  }

  /**
   * Retrieves all physical units (for backward compatibility)
   */
  getUnits(productId = null, warehouseId = null, includeConsumed = false, variantId = null) {
    const summary = this.getSummary(productId, warehouseId, variantId);
    if (!summary) return [];
    return [...summary.fullRolls, ...summary.loosePieces];
  }

  /**
   * Transaction history
   */
  getTransactions(productId = null, limit = 100) {
    let txs = storageService.getCollection(this.COLLECTION_TXS) || [];
    txs.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    return txs.slice(0, limit);
  }

  /**
   * Receiving new full rolls
   */
  receiveFullRolls({ productId, variantId = null, warehouseId = 'wh-1', count = 1, rollSize = 5000, unit = 'ft' }) {
    let targetVariantId = variantId;
    if (!targetVariantId && productId) {
      let variants = productService.getVariantsByProduct(productId) || [];
      let match = variants.find(v => Number(v.rollLength || v.rollSize) === Number(rollSize));
      if (!match) {
        const product = productService.getProductById(productId);
        match = productService.createVariant({
          productId,
          name: `Roll (${Number(rollSize).toLocaleString()} ${unit})`,
          sku: `${product?.code || productId}-V${String(rollSize)}`,
          isCutToLength: true,
          rollLength: Number(rollSize),
          rollSize: Number(rollSize),
          rollUnit: unit
        });
      }
      targetVariantId = match.id;
    }

    if (!targetVariantId) return [];

    const stock = this.getVariantStock(warehouseId, targetVariantId);
    const newFullRolls = stock.fullRolls + Number(count);

    this.saveVariantStock(warehouseId, targetVariantId, {
      fullRolls: newFullRolls,
      rollLength: Number(rollSize) || stock.rollLength,
      loosePieces: stock.loosePieces,
      unit: unit || stock.unit
    });

    storageService.insert(this.COLLECTION_TXS, {
      transactionType: 'INITIAL_PURCHASE',
      variantId: targetVariantId,
      warehouseId,
      fullRollsBefore: stock.fullRolls,
      fullRollsAfter: newFullRolls,
      rollsDeducted: -count,
      createdAt: new Date().toISOString()
    });

    return Array(count).fill({ status: 'AVAILABLE', classification: 'FULL', quantity: rollSize });
  }

  /**
   * Receiving a continuous loose piece of cut-to-length stock
   */
  receiveLooseContinuous({ productId, variantId, warehouseId = 'wh-1', quantity, unit = 'ft' }) {
    if (!variantId) return null;
    const stock = this.getVariantStock(warehouseId, variantId);
    const pieceLength = Math.max(0, Number(quantity) || 0);
    if (pieceLength <= 0) return null;

    const newLoose = [...(stock.loosePieces || []), pieceLength];

    this.saveVariantStock(warehouseId, variantId, {
      fullRolls: stock.fullRolls,
      rollLength: stock.rollLength,
      loosePieces: newLoose,
      unit: unit || stock.unit
    });

    storageService.insert(this.COLLECTION_TXS, {
      transactionType: 'INWARD_LOOSE_RECEIPT',
      variantId,
      warehouseId,
      fullRollsBefore: stock.fullRolls,
      fullRollsAfter: stock.fullRolls,
      loosePiecesBefore: stock.loosePieces,
      loosePiecesAfter: newLoose,
      quantityAdded: pieceLength,
      createdAt: new Date().toISOString()
    });

    return { status: 'AVAILABLE', classification: 'LOOSE', quantity: pieceLength };
  }

  /**
   * Syncs the total footage of physical units back to stockBalances
   */
  syncProductStockBalance(productId, warehouseId, variantId, totalFootage, unit) {
    if (!variantId) return;
    const balances = storageService.getCollection('stockBalances') || [];
    const entry = balances.find(b => b.warehouseId === warehouseId && b.variantId === variantId);

    if (entry) {
      storageService.update('stockBalances', entry.id, {
        quantity: totalFootage,
        unit: (unit || 'ft').toUpperCase(),
        lastMovementAt: new Date().toISOString()
      });
    } else {
      const variant = productService.getVariantById(variantId);
      storageService.insert('stockBalances', {
        id: `bal-${warehouseId}-${variantId}`,
        warehouseId,
        variantId,
        quantity: totalFootage,
        averageCost: variant?.costPrice || 0,
        unit: (unit || 'ft').toUpperCase()
      });
    }
  }
}

export const cutToLengthService = new CutToLengthService();
