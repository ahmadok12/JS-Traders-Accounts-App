/**
 * JS Traders ERP - Central Inventory & Stock Engine
 * The authoritative operational source of truth for stock.
 * Invoices NEVER deduct stock. Stock moves ONLY through verified stock movements.
 */

import { storageService } from './storageService.js';
import { productService } from './productService.js';
import { APP_CONFIG } from '../config/appConfig.js';

class InventoryService {
  // Retrieve stock balance for variant in warehouse
  getBalance(warehouseId, variantId) {
    const balances = storageService.getCollection('stockBalances') || [];
    const record = balances.find(b => b.warehouseId === warehouseId && b.variantId === variantId);
    if (record && record.quantity !== undefined && record.quantity !== null) {
      return Number(record.quantity);
    }

    // Dynamic fallback to standard seed balances
    const seedDefaults = {
      'wh-1': { 'var-1': 1250, 'var-2': 820, 'var-3': 4500, 'var-4': 6, 'var-5': 22500, 'var-6': 25, 'var-7': 30, 'var-8': 40 },
      'wh-2': { 'var-1': 350, 'var-2': 180, 'var-3': 1200, 'var-4': 3, 'var-5': 2500, 'var-6': 5, 'var-7': 6, 'var-8': 15 }
    };
    if (seedDefaults[warehouseId] && seedDefaults[warehouseId][variantId] !== undefined) {
      return seedDefaults[warehouseId][variantId];
    }

    return 0;
  }

  // Retrieve all stock balances with joined variant and product details
  getAllBalances(warehouseFilter = null) {
    let balances = storageService.getCollection('stockBalances');
    if (warehouseFilter) {
      balances = balances.filter(b => b.warehouseId === warehouseFilter);
    }

    const variants = productService.getVariants();
    const products = productService.getProducts();
    const warehouses = storageService.getCollection('warehouses');

    const varMap = new Map(variants.map(v => [v.id, v]));
    const prodMap = new Map(products.map(p => [p.id, p]));
    const whMap = new Map(warehouses.map(w => [w.id, w]));

    return balances.map(b => {
      const variant = varMap.get(b.variantId) || {};
      const product = prodMap.get(variant.productId) || {};
      const warehouse = whMap.get(b.warehouseId) || {};
      const isLowStock = product.lowStockLevel && b.quantity <= product.lowStockLevel;
      const isNegative = b.quantity < 0;

      return {
        ...b,
        variant,
        product,
        warehouse,
        isLowStock,
        isNegative,
        stockValue: (b.quantity > 0 ? b.quantity : 0) * (b.averageCost || variant.costPrice || 0)
      };
    });
  }

  // Core Stock Movement Engine: Atomic movement & balance calculation
  postStockMovement({
    movementType,
    referenceDocType,
    referenceDocId,
    warehouseId,
    lines, // Array of { variantId, quantity (positive for in, negative for out), unitRate, rollId, notes }
    notes = '',
    userId = 'user-admin'
  }) {
    const movements = storageService.getCollection('stockMovements');
    const movementNumber = `MOV-${String(movements.length + 1).padStart(5, '0')}`;

    // 1. Validate negative stock rules for all outgoing items first
    for (const line of lines) {
      const qty = Number(line.quantity);
      if (qty < 0) {
        const currentQty = this.getBalance(warehouseId, line.variantId);
        const variant = productService.getVariantById(line.variantId);
        const product = variant ? productService.getProductById(variant.productId) : null;

        const allowsNegative = variant?.negativeStockSetting === 'allow' ||
          (variant?.negativeStockSetting !== 'disallow' && product?.negativeStockAllowed === 'allow') ||
          APP_CONFIG.inventoryRules.allowNegativeStockDefault;

        if (!allowsNegative && (currentQty + qty) < 0) {
          throw new Error(
            `Insufficient stock in selected warehouse for "${variant?.name || 'Item'}". ` +
            `Available: ${currentQty} ${line.unit || 'PCS'}, Requested: ${Math.abs(qty)} ${line.unit || 'PCS'}`
          );
        }
      }
    }

    // 2. Process stock balance updates and physical roll adjustments
    const processedLines = [];
    for (const line of lines) {
      const qty = Number(line.quantity);
      const rate = Number(line.unitRate) || 0;
      const totalCost = Math.abs(qty) * rate;

      // Update cached stock balances
      let balances = storageService.getCollection('stockBalances');
      let balanceEntry = balances.find(b => b.warehouseId === warehouseId && b.variantId === line.variantId);

      if (!balanceEntry) {
        balanceEntry = {
          id: `bal-${Date.now()}-${Math.floor(Math.random()*1000)}`,
          warehouseId,
          variantId: line.variantId,
          quantity: qty,
          averageCost: rate,
          unit: line.unit || 'PCS'
        };
        storageService.insert('stockBalances', balanceEntry);
      } else {
        const oldQty = Number(balanceEntry.quantity);
        const newQty = oldQty + qty;
        let newAvgCost = Number(balanceEntry.averageCost) || 0;

        // Recalculate moving average cost only for inward stock
        if (qty > 0 && newQty > 0) {
          newAvgCost = ((oldQty * newAvgCost) + (qty * rate)) / newQty;
        }

        storageService.update('stockBalances', balanceEntry.id, {
          quantity: newQty,
          averageCost: newAvgCost,
          lastMovementAt: new Date().toISOString()
        });
      }

      // Handle roll / cut-to-length tracking if rollId specified
      if (line.rollId) {
        const roll = storageService.getById('physicalRolls', line.rollId);
        if (roll) {
          const newRemaining = Math.max(0, roll.remainingLength + qty); // qty is negative for cut
          storageService.update('physicalRolls', roll.id, {
            remainingLength: newRemaining,
            isFull: newRemaining >= roll.initialLength
          });
        }
      }

      processedLines.push({
        variantId: line.variantId,
        quantity: qty,
        unit: line.unit || 'PCS',
        unitRate: rate,
        totalCost,
        rollId: line.rollId || null,
        notes: line.notes || ''
      });
    }

    // 3. Persist the movement document
    const movement = storageService.insert('stockMovements', {
      movementNumber,
      movementType,
      referenceDocType,
      referenceDocId,
      warehouseId,
      date: new Date().toISOString(),
      createdBy: userId,
      notes,
      lines: processedLines
    });

    return movement;
  }

  // Stock Adjustments
  getStockAdjustments() {
    return storageService.getCollection('stockAdjustments');
  }

  createStockAdjustment({ type, warehouseId, reason, lines, notes, userId }) {
    if (!lines || !lines.length) {
      throw new Error('At least one item line is required for stock adjustment.');
    }

    const adjustments = this.getStockAdjustments();
    const adjustmentNumber = `ADJ-${String(adjustments.length + 1).padStart(5, '0')}`;

    // Normalize lines with current stock, target stock, and signed delta quantity
    const normalizedLines = lines.map(l => {
      const currentStock = l.currentStock !== undefined ? Number(l.currentStock) : this.getBalance(warehouseId, l.variantId);
      let qty = Number(l.quantity) || 0;
      if (type === 'increase') qty = Math.abs(qty);
      else if (type === 'decrease') qty = -Math.abs(qty);

      const newStock = l.newStock !== undefined ? Number(l.newStock) : (currentStock + qty);

      return {
        variantId: l.variantId,
        currentStock,
        newStock,
        quantity: qty,
        unit: l.unit || 'PCS',
        unitRate: Number(l.unitRate) || 0,
        mode: l.mode || (qty >= 0 ? 'increase' : 'decrease'),
        notes: l.notes || ''
      };
    }).filter(l => l.quantity !== 0);

    if (normalizedLines.length === 0) {
      throw new Error('No quantity adjustments specified (all lines have 0 change).');
    }

    // Determine overall adjustment classification
    let calculatedType = type;
    if (!calculatedType || calculatedType === 'auto' || calculatedType === 'reconciliation' || calculatedType === 'mixed') {
      const allPositive = normalizedLines.every(l => l.quantity > 0);
      const allNegative = normalizedLines.every(l => l.quantity < 0);
      if (allPositive) calculatedType = 'increase';
      else if (allNegative) calculatedType = 'decrease';
      else calculatedType = 'reconciliation';
    }

    const adj = storageService.insert('stockAdjustments', {
      adjustmentNumber,
      type: calculatedType, // 'increase', 'decrease', or 'reconciliation'
      warehouseId,
      date: new Date().toISOString().split('T')[0],
      reason: reason || 'Physical inventory reconciliation',
      status: 'Confirmed', // Confirmed directly triggers stock movement
      notes: notes || '',
      lines: normalizedLines,
      createdBy: userId || 'user-admin'
    });

    // Directly post atomic stock movement
    const movementLines = normalizedLines.map(l => ({
      variantId: l.variantId,
      quantity: l.quantity,
      unitRate: Number(l.unitRate) || 0,
      unit: l.unit || 'PCS',
      notes: `Stock Adjustment ${adjustmentNumber} (${reason || 'Audit'})`
    }));

    const hasAnyPositive = movementLines.some(l => l.quantity > 0);
    const hasAnyNegative = movementLines.some(l => l.quantity < 0);
    let movementType = 'adjustment';
    if (hasAnyPositive && !hasAnyNegative) movementType = 'adjustment_increase';
    if (!hasAnyPositive && hasAnyNegative) movementType = 'adjustment_decrease';

    const movement = this.postStockMovement({
      movementType,
      referenceDocType: 'stock_adjustment',
      referenceDocId: adj.id,
      warehouseId,
      lines: movementLines,
      notes: `Stock adjustment: ${reason || 'Physical Count Reconciliation'}`,
      userId: userId || 'user-admin'
    });

    if (movement && movement.id) {
      storageService.update('stockAdjustments', adj.id, { movementId: movement.id });
    }

    return adj;
  }

  // Roll / Cut-to-length tracking
  getPhysicalRolls(variantId = null, warehouseId = null) {
    let rolls = storageService.getCollection('physicalRolls');
    if (variantId) rolls = rolls.filter(r => r.variantId === variantId);
    if (warehouseId) rolls = rolls.filter(r => r.warehouseId === warehouseId);
    return rolls;
  }

  // Deduct cut length from continuous roll or loose piece
  cutFromRoll({ rollId, cutLengthFeet, warehouseId, notes, userId }) {
    const roll = storageService.getById('physicalRolls', rollId);
    if (!roll) throw new Error('Physical roll not found.');
    if (roll.remainingLength < cutLengthFeet) {
      throw new Error(`Roll ${roll.code} does not have enough continuous length. Available: ${roll.remainingLength} ft, Requested: ${cutLengthFeet} ft.`);
    }

    const variant = productService.getVariantById(roll.variantId);

    // Post stock movement for length cut
    this.postStockMovement({
      movementType: 'delivery',
      referenceDocType: 'roll_cut',
      referenceDocId: roll.id,
      warehouseId: warehouseId || roll.warehouseId,
      lines: [
        {
          variantId: roll.variantId,
          quantity: -cutLengthFeet,
          unit: 'FT',
          rollId: roll.id,
          unitRate: variant?.costPrice || 0,
          notes: notes || `Cut ${cutLengthFeet} ft from roll ${roll.code}`
        }
      ],
      notes: `Roll length cut: ${cutLengthFeet} ft`,
      userId
    });

    return storageService.getById('physicalRolls', roll.id);
  }
}

export const inventoryService = new InventoryService();
