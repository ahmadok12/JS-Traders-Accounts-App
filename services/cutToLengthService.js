/**
 * JS Traders ERP - Cut-to-Length & Multi-Roll Packaging Inventory Engine
 * 
 * CORE ARCHITECTURAL PRINCIPLES:
 * 1. Physical Unit Separation: Full untouched rolls ('FULL') and partially used loose pieces ('LOOSE')
 *    are tracked as separate physical database entities with unique IDs (e.g. R001, L001).
 *    Loose pieces are NEVER aggregated into a single anonymous stock record.
 * 2. Multi-Roll Packaging: A product can define multiple full packaging sizes (e.g. 5,000 ft roll,
 *    3,280 ft roll, 450 ft roll, 400 ft roll) under one continuous product/material definition.
 * 3. Continuous Cut Allocation:
 *    - Rule 1: Prefer an existing loose piece that is large enough (best-fit).
 *    - Rule 2: Never automatically combine loose pieces without explicit user consent.
 *    - Rule 3: If no loose piece is large enough, open a full roll and create a remainder loose piece.
 *    - Rule 4: If no single piece is large enough, provide explicit options: [Open New Roll], [Use Multiple Pieces], [Cancel].
 * 4. Complete Roll Sale: Selling a full roll deducts an intact full roll directly without cutting.
 * 5. Isolation: Products with cut_to_length = false remain completely untouched.
 */

import { storageService } from './storageService.js';
import { productService } from './productService.js';

class CutToLengthService {
  constructor() {
    this.COLLECTION_UNITS = 'cutToLengthUnits';
    this.COLLECTION_TXS = 'cutToLengthTransactions';
  }

  // --- QUERIES ---

  /**
   * Retrieves all physical units (Full rolls and loose pieces)
   */
  getUnits(productId = null, warehouseId = null, includeConsumed = false) {
    let units = storageService.getCollection(this.COLLECTION_UNITS) || [];
    if (productId) units = units.filter(u => u.productId === productId);
    if (warehouseId && warehouseId !== 'all') units = units.filter(u => u.warehouseId === warehouseId);
    if (!includeConsumed) units = units.filter(u => u.status === 'AVAILABLE' && u.quantity > 0);
    return units;
  }

  /**
   * Retrieves unit by ID
   */
  getUnitById(id) {
    return storageService.getById(this.COLLECTION_UNITS, id);
  }

  /**
   * Comprehensive inventory summary for a Cut-to-Length product
   */
  getSummary(productId, warehouseId = null) {
    const product = productService.getProductById(productId);
    if (!product) return null;

    const units = this.getUnits(productId, warehouseId, false);
    const fullRolls = units.filter(u => u.classification === 'FULL');
    const loosePieces = units.filter(u => u.classification === 'LOOSE');

    const fullRollsFootage = fullRolls.reduce((sum, u) => sum + Number(u.quantity || 0), 0);
    const loosePiecesFootage = loosePieces.reduce((sum, u) => sum + Number(u.quantity || 0), 0);
    const totalFootage = fullRollsFootage + loosePiecesFootage;

    // Breakdown of full rolls by packaging size (e.g. 5000 ft vs 3280 ft)
    const rollsBySize = {};
    fullRolls.forEach(r => {
      const sizeKey = `${r.initialQuantity} ${r.unit || 'ft'}`;
      if (!rollsBySize[sizeKey]) {
        rollsBySize[sizeKey] = {
          rollSize: r.initialQuantity,
          unit: r.unit || 'ft',
          packagingName: r.packagingName || `Roll (${Number(r.initialQuantity).toLocaleString()} ${r.unit || 'ft'})`,
          count: 0,
          totalLength: 0
        };
      }
      rollsBySize[sizeKey].count += 1;
      rollsBySize[sizeKey].totalLength += Number(r.quantity || 0);
    });

    return {
      productId,
      warehouseId,
      baseUnit: product.base_unit || 'ft',
      fullRollsCount: fullRolls.length,
      fullRollsFootage,
      loosePiecesCount: loosePieces.length,
      loosePiecesFootage,
      totalFootage,
      rollsBySize: Object.values(rollsBySize),
      fullRolls,
      loosePieces
    };
  }

  /**
   * Audit trail of all transactions
   */
  getTransactions(productId = null, limit = 100) {
    let txs = storageService.getCollection(this.COLLECTION_TXS) || [];
    if (productId) txs = txs.filter(t => t.productId === productId);
    txs.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    return txs.slice(0, limit);
  }

  // --- ALLOCATION ENGINE ---

  /**
   * Evaluates how to fulfill a customer request:
   * @param {Object} params
   * @param {string} params.productId
   * @param {string} params.warehouseId
   * @param {number} params.requestedQty
   * @param {string} params.unit - 'ft', 'Roll (5,000 ft)', 'Roll (3,280 ft)', etc.
   * @param {boolean} params.allowMultiPieces - User explicitly approved multiple pieces
   * @param {string} params.preferredRollSize - Optional preferred roll size to open
   * @returns {Object} Allocation plan or decision request
   */
  planAllocation({
    productId,
    warehouseId = 'wh-1',
    requestedQty,
    unit = 'ft',
    allowMultiPieces = false,
    preferredRollSize = null
  }) {
    const product = productService.getProductById(productId);
    if (!product) throw new Error('Product not found.');

    const availableUnits = this.getUnits(productId, warehouseId, false);
    const packagingUnits = product.packagingUnits || [];
    const matchedPackaging = packagingUnits.find(p => p.name === unit || p.id === unit);

    // CASE 1: SELLING COMPLETE FULL ROLL(S)
    if (matchedPackaging) {
      const rollSize = Number(matchedPackaging.factor);
      const neededRolls = Math.round(Number(requestedQty));

      const matchingFullRolls = availableUnits.filter(
        u => u.classification === 'FULL' && Number(u.initialQuantity) === rollSize
      );

      if (matchingFullRolls.length < neededRolls) {
        return {
          canFulfill: false,
          error: `Insufficient full rolls of size ${matchedPackaging.name}. Available: ${matchingFullRolls.length} rolls, Requested: ${neededRolls} rolls.`,
          availableCount: matchingFullRolls.length,
          neededCount: neededRolls
        };
      }

      // Allocate N intact full rolls
      const allocatedRolls = matchingFullRolls.slice(0, neededRolls);
      return {
        canFulfill: true,
        type: 'FULL_ROLL_SALE',
        productId,
        warehouseId,
        packagingName: matchedPackaging.name,
        rollSize,
        rollsToDeduct: allocatedRolls.map(r => ({
          unitId: r.id,
          code: r.code || r.id,
          length: Number(r.quantity),
          classification: 'FULL'
        })),
        totalLengthDeducted: neededRolls * rollSize,
        baseUnit: product.base_unit || 'ft'
      };
    }

    // CASE 2: SELLING CONTINUOUS LENGTH (ft / m)
    const targetLength = Number(requestedQty);
    if (targetLength <= 0) throw new Error('Requested length must be greater than zero.');

    const loosePieces = availableUnits
      .filter(u => u.classification === 'LOOSE')
      .sort((a, b) => Number(a.quantity) - Number(b.quantity)); // ascending order for best-fit

    const fullRolls = availableUnits
      .filter(u => u.classification === 'FULL')
      .sort((a, b) => Number(a.initialQuantity) - Number(b.initialQuantity)); // smallest roll size first

    // RULE 1: Prefer an existing single loose piece large enough (Best Fit)
    const sufficientLoosePiece = loosePieces.find(p => Number(p.quantity) >= targetLength);
    if (sufficientLoosePiece) {
      const currentQty = Number(sufficientLoosePiece.quantity);
      const remaining = currentQty - targetLength;
      return {
        canFulfill: true,
        type: 'LOOSE_PIECE_CUT',
        productId,
        warehouseId,
        targetLength,
        baseUnit: product.base_unit || 'ft',
        sourceUnit: {
          unitId: sufficientLoosePiece.id,
          code: sufficientLoosePiece.code || sufficientLoosePiece.id,
          originalLength: currentQty,
          cutLength: targetLength,
          remainingLength: remaining,
          becomesConsumed: remaining === 0
        },
        newLoosePiece: null
      };
    }

    // RULE 2 & 3: No single loose piece is large enough. Check if a Full Roll is available to open.
    // If user has a preferred roll size, check for it; otherwise choose the smallest sufficient full roll
    let rollToOpen = null;
    if (preferredRollSize) {
      rollToOpen = fullRolls.find(r => Number(r.initialQuantity) === Number(preferredRollSize) && Number(r.quantity) >= targetLength);
    }
    if (!rollToOpen) {
      rollToOpen = fullRolls.find(r => Number(r.quantity) >= targetLength);
    }

    if (rollToOpen) {
      const rollCapacity = Number(rollToOpen.quantity);
      const remaining = rollCapacity - targetLength;
      return {
        canFulfill: true,
        type: 'OPEN_FULL_ROLL_CUT',
        productId,
        warehouseId,
        targetLength,
        baseUnit: product.base_unit || 'ft',
        sourceUnit: {
          unitId: rollToOpen.id,
          code: rollToOpen.code || rollToOpen.id,
          originalLength: rollCapacity,
          cutLength: targetLength,
          packagingName: rollToOpen.packagingName,
          remainingLength: 0,
          becomesConsumed: true // the full roll entity is consumed and converted
        },
        newLoosePiece: remaining > 0 ? {
          initialQuantity: rollCapacity,
          remainingLength: remaining,
          parentUnitId: rollToOpen.id,
          unit: product.base_unit || 'ft'
        } : null
      };
    }

    // RULE 4 & EXPLICIT OPTION: No single piece (neither loose nor single full roll) can fulfill targetLength continuously.
    // Or customer requires multi-piece allocation.
    const totalLooseAvailable = loosePieces.reduce((s, p) => s + Number(p.quantity), 0);
    const totalFullAvailable = fullRolls.reduce((s, r) => s + Number(r.quantity), 0);
    const grandTotalStock = totalLooseAvailable + totalFullAvailable;

    if (grandTotalStock < targetLength) {
      return {
        canFulfill: false,
        error: `Insufficient total stock. Available: ${grandTotalStock.toLocaleString()} ${product.base_unit || 'ft'}, Requested: ${targetLength.toLocaleString()} ${product.base_unit || 'ft'}.`
      };
    }

    // Multi-piece allocation plan if user authorized it
    if (allowMultiPieces) {
      const allocations = [];
      let remainingNeeded = targetLength;

      // Allocate from largest available loose pieces first
      const looseDesc = [...loosePieces].sort((a, b) => Number(b.quantity) - Number(a.quantity));
      for (const piece of looseDesc) {
        if (remainingNeeded <= 0) break;
        const pQty = Number(piece.quantity);
        const cut = Math.min(remainingNeeded, pQty);
        allocations.push({
          unitId: piece.id,
          code: piece.code || piece.id,
          classification: 'LOOSE',
          originalLength: pQty,
          cutLength: cut,
          remainingLength: pQty - cut
        });
        remainingNeeded -= cut;
      }

      // If still needed, open a full roll
      let newLooseFromRoll = null;
      if (remainingNeeded > 0 && fullRolls.length > 0) {
        const roll = fullRolls[0];
        const rQty = Number(roll.quantity);
        const cut = Math.min(remainingNeeded, rQty);
        allocations.push({
          unitId: roll.id,
          code: roll.code || roll.id,
          classification: 'FULL',
          originalLength: rQty,
          cutLength: cut,
          remainingLength: 0,
          becomesConsumed: true
        });
        remainingNeeded -= cut;
        if (rQty - cut > 0) {
          newLooseFromRoll = {
            initialQuantity: rQty,
            remainingLength: rQty - cut,
            parentUnitId: roll.id,
            unit: product.base_unit || 'ft'
          };
        }
      }

      if (remainingNeeded > 0) {
        return {
          canFulfill: false,
          error: `Cannot fulfill even across multiple pieces. Missing: ${remainingNeeded.toLocaleString()} ${product.base_unit || 'ft'}.`
        };
      }

      return {
        canFulfill: true,
        type: 'MULTI_PIECE_ALLOCATION',
        productId,
        warehouseId,
        targetLength,
        baseUnit: product.base_unit || 'ft',
        multiAllocations: allocations,
        newLoosePiece: newLooseFromRoll
      };
    }

    // If allowMultiPieces is false, trigger explicit user decision!
    return {
      canFulfill: false,
      requiresDecision: true,
      targetLength,
      baseUnit: product.base_unit || 'ft',
      availableLoosePieces: loosePieces.map(p => ({ id: p.id, code: p.code, length: Number(p.quantity) })),
      availableFullRolls: fullRolls.map(r => ({ id: r.id, code: r.code, length: Number(r.quantity), packagingName: r.packagingName })),
      totalLooseAvailable,
      totalFullAvailable,
      message: `Requested continuous length of ${targetLength.toLocaleString()} ${product.base_unit || 'ft'} cannot be fulfilled from a single loose piece.`
    };
  }

  // --- ATOMIC TRANSACTION EXECUTION ---

  /**
   * Commits an allocation plan atomically to the database.
   */
  commitAllocation(plan, { referenceDocType, referenceDocId, userId = 'user-admin', notes = '' }) {
    if (!plan || !plan.canFulfill) {
      throw new Error(plan?.error || 'Cannot commit an unfulfillable allocation plan.');
    }

    const timestamp = new Date().toISOString();
    const product = productService.getProductById(plan.productId);
    const txRecords = [];

    // Helper to generate codes
    const generateLooseCode = () => {
      const allUnits = storageService.getCollection(this.COLLECTION_UNITS) || [];
      const looseCount = allUnits.filter(u => u.classification === 'LOOSE').length + 1;
      return `L${String(looseCount).padStart(3, '0')}`;
    };

    if (plan.type === 'FULL_ROLL_SALE') {
      for (const roll of plan.rollsToDeduct) {
        storageService.update(this.COLLECTION_UNITS, roll.unitId, {
          quantity: 0,
          status: 'CONSUMED',
          consumedAt: timestamp,
          consumedByDocType: referenceDocType,
          consumedByDocId: referenceDocId
        });

        const tx = storageService.insert(this.COLLECTION_TXS, {
          transactionType: 'SALE_FULL_ROLL',
          referenceDocType,
          referenceDocId,
          productId: plan.productId,
          warehouseId: plan.warehouseId,
          sourceUnitId: roll.unitId,
          sourceCode: roll.code,
          originalLength: roll.length,
          issuedLength: roll.length,
          remainingLength: 0,
          resultingUnitId: null,
          newClassification: 'CONSUMED',
          userId,
          notes: notes || `Sold intact full roll (${plan.packagingName}) on ${referenceDocType} ${referenceDocId}`,
          createdAt: timestamp
        });
        txRecords.push(tx);
      }
    } else if (plan.type === 'LOOSE_PIECE_CUT') {
      const src = plan.sourceUnit;
      storageService.update(this.COLLECTION_UNITS, src.unitId, {
        quantity: src.remainingLength,
        status: src.becomesConsumed ? 'CONSUMED' : 'AVAILABLE',
        updatedAt: timestamp
      });

      const tx = storageService.insert(this.COLLECTION_TXS, {
        transactionType: 'SALE_CUT',
        referenceDocType,
        referenceDocId,
        productId: plan.productId,
        warehouseId: plan.warehouseId,
        sourceUnitId: src.unitId,
        sourceCode: src.code,
        originalLength: src.originalLength,
        issuedLength: src.cutLength,
        remainingLength: src.remainingLength,
        resultingUnitId: src.unitId,
        newClassification: src.becomesConsumed ? 'CONSUMED' : 'LOOSE',
        userId,
        notes: notes || `Cut ${src.cutLength} ${plan.baseUnit} from piece ${src.code} on ${referenceDocType} ${referenceDocId}`,
        createdAt: timestamp
      });
      txRecords.push(tx);
    } else if (plan.type === 'OPEN_FULL_ROLL_CUT') {
      const src = plan.sourceUnit;
      // Mark full roll as consumed
      storageService.update(this.COLLECTION_UNITS, src.unitId, {
        quantity: 0,
        status: 'CONSUMED',
        consumedAt: timestamp,
        consumedByDocType: referenceDocType,
        consumedByDocId: referenceDocId
      });

      let newLooseUnit = null;
      if (plan.newLoosePiece) {
        const looseCode = generateLooseCode();
        newLooseUnit = storageService.insert(this.COLLECTION_UNITS, {
          code: looseCode,
          productId: plan.productId,
          warehouseId: plan.warehouseId,
          classification: 'LOOSE',
          quantity: plan.newLoosePiece.remainingLength,
          initialQuantity: plan.newLoosePiece.initialQuantity,
          unit: plan.baseUnit,
          parentUnitId: src.unitId,
          status: 'AVAILABLE',
          createdAt: timestamp,
          notes: `Created from opening full roll ${src.code}`
        });
      }

      const tx = storageService.insert(this.COLLECTION_TXS, {
        transactionType: 'ROLL_OPEN',
        referenceDocType,
        referenceDocId,
        productId: plan.productId,
        warehouseId: plan.warehouseId,
        sourceUnitId: src.unitId,
        sourceCode: src.code,
        originalLength: src.originalLength,
        issuedLength: src.cutLength,
        remainingLength: plan.newLoosePiece ? plan.newLoosePiece.remainingLength : 0,
        resultingUnitId: newLooseUnit ? newLooseUnit.id : null,
        resultingCode: newLooseUnit ? newLooseUnit.code : null,
        newClassification: 'LOOSE',
        userId,
        notes: notes || `Opened full roll ${src.code} (${src.originalLength} ${plan.baseUnit}), cut ${src.cutLength} ${plan.baseUnit}, remainder piece ${newLooseUnit?.code || 'none'}`,
        createdAt: timestamp
      });
      txRecords.push(tx);
    } else if (plan.type === 'MULTI_PIECE_ALLOCATION') {
      let createdLoose = null;
      if (plan.newLoosePiece) {
        const looseCode = generateLooseCode();
        createdLoose = storageService.insert(this.COLLECTION_UNITS, {
          code: looseCode,
          productId: plan.productId,
          warehouseId: plan.warehouseId,
          classification: 'LOOSE',
          quantity: plan.newLoosePiece.remainingLength,
          initialQuantity: plan.newLoosePiece.initialQuantity,
          unit: plan.baseUnit,
          parentUnitId: plan.newLoosePiece.parentUnitId,
          status: 'AVAILABLE',
          createdAt: timestamp,
          notes: `Created from opening full roll in multi-piece allocation`
        });
      }

      for (const item of plan.multiAllocations) {
        const isConsumed = item.remainingLength === 0 || item.classification === 'FULL';
        storageService.update(this.COLLECTION_UNITS, item.unitId, {
          quantity: item.remainingLength,
          status: isConsumed ? 'CONSUMED' : 'AVAILABLE',
          updatedAt: timestamp
        });

        const tx = storageService.insert(this.COLLECTION_TXS, {
          transactionType: item.classification === 'FULL' ? 'ROLL_OPEN' : 'SALE_CUT',
          referenceDocType,
          referenceDocId,
          productId: plan.productId,
          warehouseId: plan.warehouseId,
          sourceUnitId: item.unitId,
          sourceCode: item.code,
          originalLength: item.originalLength,
          issuedLength: item.cutLength,
          remainingLength: item.remainingLength,
          resultingUnitId: item.classification === 'FULL' ? (createdLoose?.id || null) : item.unitId,
          newClassification: isConsumed ? 'CONSUMED' : 'LOOSE',
          userId,
          notes: notes || `Multi-piece cut ${item.cutLength} ${plan.baseUnit} from ${item.code} on ${referenceDocType} ${referenceDocId}`,
          createdAt: timestamp
        });
        txRecords.push(tx);
      }
    }

    // Sync cached stock balance for this product / variant in the warehouse
    this.syncProductStockBalance(plan.productId, plan.warehouseId);

    return {
      success: true,
      planType: plan.type,
      transactions: txRecords
    };
  }

  /**
   * Reverses an allocation if an invoice is voided or cancelled
   */
  rollbackAllocation(referenceDocType, referenceDocId, userId = 'user-admin') {
    const txs = storageService.getCollection(this.COLLECTION_TXS) || [];
    const docTxs = txs.filter(t => t.referenceDocType === referenceDocType && t.referenceDocId === referenceDocId);
    if (!docTxs.length) return false;

    const timestamp = new Date().toISOString();

    for (const tx of docTxs) {
      if (tx.transactionType === 'SALE_FULL_ROLL') {
        // Restore full roll to available
        storageService.update(this.COLLECTION_UNITS, tx.sourceUnitId, {
          quantity: tx.originalLength,
          status: 'AVAILABLE',
          consumedAt: null,
          consumedByDocType: null,
          consumedByDocId: null
        });
      } else if (tx.transactionType === 'SALE_CUT') {
        // Restore cut length to source loose piece
        const unit = storageService.getById(this.COLLECTION_UNITS, tx.sourceUnitId);
        if (unit) {
          storageService.update(this.COLLECTION_UNITS, unit.id, {
            quantity: unit.quantity + tx.issuedLength,
            status: 'AVAILABLE'
          });
        }
      } else if (tx.transactionType === 'ROLL_OPEN') {
        // If a resulting loose piece was created and has not been further cut, remove it and restore roll
        if (tx.resultingUnitId) {
          const loosePiece = storageService.getById(this.COLLECTION_UNITS, tx.resultingUnitId);
          if (loosePiece && loosePiece.quantity === tx.remainingLength) {
            storageService.delete(this.COLLECTION_UNITS, tx.resultingUnitId);
            // Restore full roll
            storageService.update(this.COLLECTION_UNITS, tx.sourceUnitId, {
              quantity: tx.originalLength,
              status: 'AVAILABLE',
              consumedAt: null,
              consumedByDocType: null,
              consumedByDocId: null
            });
          } else {
            // Loose piece was already partially used, create a returned piece
            this.addLoosePiece({
              productId: tx.productId,
              warehouseId: tx.warehouseId,
              length: tx.issuedLength,
              unit: 'ft',
              reason: `Return from voided ${referenceDocType} ${referenceDocId}`,
              userId
            });
          }
        }
      }

      // Record rollback log
      storageService.insert(this.COLLECTION_TXS, {
        transactionType: 'RETURN',
        referenceDocType,
        referenceDocId,
        productId: tx.productId,
        warehouseId: tx.warehouseId,
        sourceUnitId: tx.sourceUnitId,
        issuedLength: -tx.issuedLength,
        remainingLength: tx.originalLength,
        userId,
        notes: `Reversed allocation due to voided ${referenceDocType} ${referenceDocId}`,
        createdAt: timestamp
      });

      this.syncProductStockBalance(tx.productId, tx.warehouseId);
    }

    return true;
  }

  // --- RECEIVING & INVENTORY ADJUSTMENTS ---

  /**
   * Receives initial purchase or incoming batch of full rolls
   */
  receiveFullRolls({
    productId,
    warehouseId = 'wh-1',
    count = 1,
    rollSize,
    packagingName = null,
    unit = 'ft',
    referenceDocId = 'INITIAL_RECEIVE',
    userId = 'user-admin',
    notes = ''
  }) {
    const timestamp = new Date().toISOString();
    const product = productService.getProductById(productId);
    const existing = storageService.getCollection(this.COLLECTION_UNITS) || [];
    const rollCountStart = existing.filter(u => u.classification === 'FULL').length;

    const created = [];
    for (let i = 0; i < count; i++) {
      const code = `R${String(rollCountStart + i + 1).padStart(3, '0')}`;
      const roll = storageService.insert(this.COLLECTION_UNITS, {
        code,
        productId,
        warehouseId,
        classification: 'FULL',
        quantity: Number(rollSize),
        initialQuantity: Number(rollSize),
        packagingName: packagingName || `Roll (${Number(rollSize).toLocaleString()} ${unit})`,
        unit,
        parentUnitId: null,
        status: 'AVAILABLE',
        createdAt: timestamp,
        notes: notes || 'Received full roll'
      });
      created.push(roll);

      storageService.insert(this.COLLECTION_TXS, {
        transactionType: 'INITIAL_PURCHASE',
        referenceDocType: 'purchase',
        referenceDocId,
        productId,
        warehouseId,
        sourceUnitId: roll.id,
        sourceCode: code,
        originalLength: 0,
        issuedLength: 0,
        remainingLength: Number(rollSize),
        resultingUnitId: roll.id,
        newClassification: 'FULL',
        userId,
        notes: `Received full roll ${code} (${Number(rollSize).toLocaleString()} ${unit})`,
        createdAt: timestamp
      });
    }

    this.syncProductStockBalance(productId, warehouseId);
    return created;
  }

  /**
   * Adds an individual physical loose piece (e.g. from physical stock take)
   */
  addLoosePiece({
    productId,
    warehouseId = 'wh-1',
    length,
    unit = 'ft',
    reason = 'Physical stock adjustment',
    userId = 'user-admin'
  }) {
    const timestamp = new Date().toISOString();
    const existing = storageService.getCollection(this.COLLECTION_UNITS) || [];
    const looseCount = existing.filter(u => u.classification === 'LOOSE').length + 1;
    const code = `L${String(looseCount).padStart(3, '0')}`;

    const piece = storageService.insert(this.COLLECTION_UNITS, {
      code,
      productId,
      warehouseId,
      classification: 'LOOSE',
      quantity: Number(length),
      initialQuantity: Number(length),
      unit,
      parentUnitId: null,
      status: 'AVAILABLE',
      createdAt: timestamp,
      notes: reason
    });

    storageService.insert(this.COLLECTION_TXS, {
      transactionType: 'ADJUSTMENT_ADD',
      referenceDocType: 'stock_adjustment',
      referenceDocId: 'MANUAL-ADJ',
      productId,
      warehouseId,
      sourceUnitId: piece.id,
      sourceCode: code,
      originalLength: 0,
      issuedLength: 0,
      remainingLength: Number(length),
      resultingUnitId: piece.id,
      newClassification: 'LOOSE',
      userId,
      notes: `Added physical loose piece ${code} (${Number(length).toLocaleString()} ${unit}): ${reason}`,
      createdAt: timestamp
    });

    this.syncProductStockBalance(productId, warehouseId);
    return piece;
  }

  /**
   * Adjusts the length of an existing piece
   */
  adjustPieceLength({ unitId, newLength, reason = '', userId = 'user-admin' }) {
    const unit = storageService.getById(this.COLLECTION_UNITS, unitId);
    if (!unit) throw new Error('Unit not found');

    const oldLength = Number(unit.quantity);
    const updatedLength = Number(newLength);
    const timestamp = new Date().toISOString();

    storageService.update(this.COLLECTION_UNITS, unitId, {
      quantity: updatedLength,
      status: updatedLength > 0 ? 'AVAILABLE' : 'CONSUMED',
      updatedAt: timestamp
    });

    storageService.insert(this.COLLECTION_TXS, {
      transactionType: 'ADJUSTMENT_EDIT',
      referenceDocType: 'stock_adjustment',
      referenceDocId: 'MANUAL-ADJ',
      productId: unit.productId,
      warehouseId: unit.warehouseId,
      sourceUnitId: unit.id,
      sourceCode: unit.code,
      originalLength: oldLength,
      issuedLength: oldLength - updatedLength,
      remainingLength: updatedLength,
      resultingUnitId: unit.id,
      newClassification: unit.classification,
      userId,
      notes: `Adjusted piece ${unit.code} from ${oldLength} to ${updatedLength} ${unit.unit}: ${reason}`,
      createdAt: timestamp
    });

    this.syncProductStockBalance(unit.productId, unit.warehouseId);
    return storageService.getById(this.COLLECTION_UNITS, unitId);
  }

  /**
   * Manually cut length from a specific unit (full roll or loose piece)
   */
  cutFromUnit({ unitId, cutLength, reason = '', userId = 'user-admin', referenceDocType = 'manual_cut', referenceDocId = 'MANUAL' }) {
    const unit = storageService.getById(this.COLLECTION_UNITS, unitId);
    if (!unit) throw new Error('Unit not found');
    const cut = Number(cutLength);
    if (cut <= 0) throw new Error('Cut length must be greater than zero');
    if (cut > Number(unit.quantity)) {
      throw new Error(`Cannot cut ${cut} ${unit.unit || 'ft'}. Unit only has ${unit.quantity} ${unit.unit || 'ft'} available.`);
    }

    const timestamp = new Date().toISOString();
    const product = productService.getProductById(unit.productId);
    const baseUnit = product?.base_unit || unit.unit || 'ft';

    const generateLooseCode = () => {
      const allUnits = storageService.getCollection(this.COLLECTION_UNITS) || [];
      const looseCount = allUnits.filter(u => u.classification === 'LOOSE').length + 1;
      return `L${String(looseCount).padStart(3, '0')}`;
    };

    if (unit.classification === 'FULL') {
      const origQty = Number(unit.quantity);
      const remaining = origQty - cut;

      storageService.update(this.COLLECTION_UNITS, unit.id, {
        quantity: 0,
        status: 'CONSUMED',
        consumedAt: timestamp,
        consumedByDocType: referenceDocType,
        consumedByDocId: referenceDocId
      });

      let newLooseUnit = null;
      if (remaining > 0) {
        const looseCode = generateLooseCode();
        newLooseUnit = storageService.insert(this.COLLECTION_UNITS, {
          code: looseCode,
          productId: unit.productId,
          warehouseId: unit.warehouseId,
          classification: 'LOOSE',
          quantity: remaining,
          initialQuantity: unit.initialQuantity,
          unit: baseUnit,
          parentUnitId: unit.id,
          status: 'AVAILABLE',
          createdAt: timestamp,
          notes: `Created from manual cut of roll ${unit.code}`
        });
      }

      storageService.insert(this.COLLECTION_TXS, {
        transactionType: 'ROLL_OPEN',
        referenceDocType,
        referenceDocId,
        productId: unit.productId,
        warehouseId: unit.warehouseId,
        sourceUnitId: unit.id,
        sourceCode: unit.code,
        originalLength: origQty,
        issuedLength: cut,
        remainingLength: remaining,
        resultingUnitId: newLooseUnit ? newLooseUnit.id : null,
        newClassification: 'LOOSE',
        userId,
        notes: reason || `Manual cut ${cut} ${baseUnit} from full roll ${unit.code}`,
        createdAt: timestamp
      });

      this.syncProductStockBalance(unit.productId, unit.warehouseId);
      return { success: true, unitConsumed: true, remainingPiece: newLooseUnit };
    } else {
      const origQty = Number(unit.quantity);
      const remaining = origQty - cut;
      const isConsumed = remaining <= 0;

      storageService.update(this.COLLECTION_UNITS, unit.id, {
        quantity: remaining,
        status: isConsumed ? 'CONSUMED' : 'AVAILABLE',
        updatedAt: timestamp
      });

      storageService.insert(this.COLLECTION_TXS, {
        transactionType: 'MANUAL_CUT',
        referenceDocType,
        referenceDocId,
        productId: unit.productId,
        warehouseId: unit.warehouseId,
        sourceUnitId: unit.id,
        sourceCode: unit.code,
        originalLength: origQty,
        issuedLength: cut,
        remainingLength: remaining,
        resultingUnitId: unit.id,
        newClassification: isConsumed ? 'CONSUMED' : 'LOOSE',
        userId,
        notes: reason || `Manual cut ${cut} ${baseUnit} from loose piece ${unit.code}`,
        createdAt: timestamp
      });

      this.syncProductStockBalance(unit.productId, unit.warehouseId);
      return { success: true, unitConsumed: isConsumed, remainingPiece: storageService.getById(this.COLLECTION_UNITS, unit.id) };
    }
  }

  /**
   * Syncs the total footage of physical units back to stockBalances
   * so that warehouse summaries, balances, and reports always match physical stock.
   */
  syncProductStockBalance(productId, warehouseId) {
    const summary = this.getSummary(productId, warehouseId);
    if (!summary) return;

    // Find any variant belonging to this product
    const variants = productService.getVariantsByProduct(productId);
    const variantId = variants.length > 0 ? variants[0].id : null;
    if (!variantId) return;

    const balances = storageService.getCollection('stockBalances') || [];
    const entry = balances.find(b => b.warehouseId === warehouseId && b.variantId === variantId);

    if (entry) {
      storageService.update('stockBalances', entry.id, {
        quantity: summary.totalFootage,
        unit: summary.baseUnit.toUpperCase(),
        lastMovementAt: new Date().toISOString()
      });
    } else {
      storageService.insert('stockBalances', {
        warehouseId,
        variantId,
        quantity: summary.totalFootage,
        averageCost: variants[0]?.costPrice || 0,
        unit: summary.baseUnit.toUpperCase()
      });
    }
  }
}

export const cutToLengthService = new CutToLengthService();
