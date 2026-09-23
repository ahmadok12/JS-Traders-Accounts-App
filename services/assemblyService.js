/**
 * JS Traders ERP - Comprehensive Assembly, Manufacturing & Standalone Disassembly Service
 * 
 * Subsystems:
 * 1. Assembly & Manufacturing (BOM Recipes, Atomic Assembly Orders, Cost Valuation, Dual Warehouses)
 * 2. Unpaid Assembly Labor Payables & Settlement Engine (Option A: Specific Assemblies, Option B: FIFO Balance)
 * 3. Standalone Disassembly & Breakdown (Any item breakdown, Partial Disassembly, Incomplete units)
 * 4. Double-entry General Ledger Integration & Audit-Safe Reversals
 * 5. Production & Consumption Reports
 */

import { storageService } from './storageService.js';
import { inventoryService } from './inventoryService.js';
import { productService } from './productService.js';
import { accountingService } from './accountingService.js';
import { APP_CONFIG } from '../config/appConfig.js';

class AssemblyService {

  // ==========================================================================
  // 1. ASSEMBLY RECIPES / BOMS
  // ==========================================================================

  getRecipes() {
    return storageService.getCollection('assemblyRecipes') || [];
  }

  getRecipeById(id) {
    return storageService.getById('assemblyRecipes', id);
  }

  createRecipe({
    name,
    assemblyType = 'MANUFACTURING',
    finishedVariantId,
    defaultOutputQuantity = 1,
    defaultLaborRate = 0,
    laborRateType = 'per_unit',
    defaultLaborPartyId = null,
    defaultSourceWarehouseId = 'wh-1',
    defaultOutputWarehouseId = 'wh-1',
    components = [],
    notes = '',
    userId = 'user-admin'
  }) {
    if (!finishedVariantId) throw new Error('Finished product/variant must be specified for recipe.');
    if (!components || components.length === 0) throw new Error('At least one component is required for the recipe.');

    const recipes = this.getRecipes();
    const recipeNumber = `REC-${String(recipes.length + 1).padStart(5, '0')}`;

    const formattedComponents = components.map((c, idx) => ({
      id: `rc-${Date.now()}-${idx}`,
      componentVariantId: c.componentVariantId,
      quantityPerUnit: Number(c.quantityPerUnit) || 1,
      sequence: idx + 1,
      unit: c.unit || 'PCS',
      notes: c.notes || ''
    }));

    return storageService.insert('assemblyRecipes', {
      recipeNumber,
      name: name || `Recipe for ${recipeNumber}`,
      assemblyType,
      finishedVariantId,
      defaultOutputQuantity: Number(defaultOutputQuantity) || 1,
      defaultLaborRate: Number(defaultLaborRate) || 0,
      laborRateType,
      defaultLaborPartyId,
      defaultSourceWarehouseId,
      defaultOutputWarehouseId,
      isActive: true,
      version: 1,
      notes,
      components: formattedComponents,
      createdBy: userId,
      createdAt: new Date().toISOString()
    });
  }

  updateRecipe(id, updates) {
    const existing = this.getRecipeById(id);
    if (!existing) throw new Error('Recipe not found.');

    const newVersion = (Number(existing.version) || 1) + 1;
    return storageService.update('assemblyRecipes', id, {
      ...updates,
      version: newVersion,
      updatedAt: new Date().toISOString()
    });
  }

  toggleRecipeActive(id) {
    const existing = this.getRecipeById(id);
    if (!existing) throw new Error('Recipe not found.');
    return storageService.update('assemblyRecipes', id, {
      isActive: !existing.isActive,
      updatedAt: new Date().toISOString()
    });
  }


  // ==========================================================================
  // 2. ASSEMBLY ORDERS LIFECYCLE
  // ==========================================================================

  getAssemblies(filters = {}) {
    let list = storageService.getCollection('assemblies') || [];
    if (filters.status) list = list.filter(a => a.status === filters.status);
    if (filters.finishedVariantId) list = list.filter(a => a.finishedVariantId === filters.finishedVariantId);
    if (filters.laborPartyId) list = list.filter(a => a.laborPartyId === filters.laborPartyId);
    if (filters.warehouseId) list = list.filter(a => a.sourceWarehouseId === filters.warehouseId || a.outputWarehouseId === filters.warehouseId || a.warehouseId === filters.warehouseId);
    if (filters.assemblyType) list = list.filter(a => a.assemblyType === filters.assemblyType);

    return [...list].sort((a, b) => new Date(b.date || b.assemblyDate || b.createdAt || 0) - new Date(a.date || a.assemblyDate || a.createdAt || 0));
  }

  getAssemblyById(id) {
    return storageService.getById('assemblies', id);
  }

  // Pre-check stock availability in warehouse
  checkStockAvailability(sourceWarehouseId, lines = []) {
    const balances = storageService.getCollection('stockBalances') || [];
    const variants = productService.getVariants();
    const varMap = new Map(variants.map(v => [v.id, v]));

    const shortfalls = [];
    let isAvailable = true;

    for (const line of lines) {
      const variantId = line.componentVariantId || line.variantId;
      const requiredQty = Number(line.actualQuantity !== undefined ? line.actualQuantity : line.quantityConsumed) || 0;
      const currentBal = inventoryService.getBalance(sourceWarehouseId, variantId);

      if (currentBal < requiredQty) {
        isAvailable = false;
        const v = varMap.get(variantId);
        shortfalls.push({
          variantId,
          variantName: v?.name || 'Component',
          sku: v?.sku || '',
          required: requiredQty,
          available: currentBal,
          short: requiredQty - currentBal,
          unit: line.unit || 'PCS'
        });
      }
    }

    return { isAvailable, shortfalls };
  }

  createAssemblyOrder(payload) {
    return this.createAssemblyDraft({
      ...payload,
      quantity: payload.quantity || payload.finishedQuantity,
      date: payload.date || payload.assemblyDate
    });
  }

  // Create Draft Assembly Order (No stock movement, No payable, No accounting)
  createAssemblyDraft({
    recipeId = null,
    assemblyType = 'MANUFACTURING',
    finishedVariantId,
    quantity,
    finishedQuantity,
    sourceWarehouseId = 'wh-1',
    outputWarehouseId = 'wh-1',
    laborPartyId = null,
    laborRate = 0,
    laborRateType = 'per_unit',
    lines = [], // { componentVariantId, recipeQuantity, actualQuantity, unitCost, isAdditional, unit }
    notes = '',
    date = null,
    assemblyDate = null,
    userId = 'user-admin',
    status = 'Draft'
  }) {
    const finishedQty = Number(quantity || finishedQuantity);
    if (finishedQty <= 0) throw new Error('Quantity to assemble must be greater than zero.');
    if (!finishedVariantId) throw new Error('Target finished product must be specified.');
    if (!lines || lines.length === 0) throw new Error('At least one component must be specified for assembly.');

    const assemblies = storageService.getCollection('assemblies') || [];
    let maxNum = 0;
    assemblies.forEach(a => {
      const match = (a.assemblyNumber || '').match(/\d+/);
      if (match) {
        const val = parseInt(match[0], 10);
        if (val > maxNum) maxNum = val;
      }
    });
    const assemblyNumber = `ASM-${String(maxNum + 1).padStart(5, '0')}`;

    // Calculate preliminary costs
    let materialCost = 0;
    const processedLines = lines.map((l, idx) => {
      const actQty = Number(l.actualQuantity !== undefined ? l.actualQuantity : l.quantityConsumed) || 0;
      const recQty = Number(l.recipeQuantity !== undefined ? l.recipeQuantity : actQty) || 0;
      const variant = productService.getVariantById(l.componentVariantId);
      const unitCost = Number(l.unitCost) || variant?.costPrice || 0;
      const lineCost = actQty * unitCost;
      materialCost += lineCost;

      return {
        id: `asml-${Date.now()}-${idx}`,
        componentVariantId: l.componentVariantId,
        recipeQuantity: recQty,
        actualQuantity: actQty,
        quantityConsumed: actQty, // Backward compatibility alias
        unitCost,
        totalCost: lineCost,
        isAdditional: Boolean(l.isAdditional),
        unit: l.unit || 'PCS',
        warehouseId: sourceWarehouseId
      };
    });

    const lRate = Number(laborRate) || 0;
    const laborCost = finishedQty * lRate;
    const totalCost = materialCost + laborCost;
    const unitFinishedCost = Math.round((totalCost / finishedQty) * 100) / 100;

    return storageService.insert('assemblies', {
      assemblyNumber,
      recipeId,
      assemblyType,
      finishedVariantId,
      quantity: finishedQty,
      finishedQuantity: finishedQty, // Backward compatibility alias
      sourceWarehouseId,
      outputWarehouseId,
      warehouseId: sourceWarehouseId, // Backward compatibility alias
      laborPartyId,
      laborRate: lRate,
      laborRateType,
      laborQuantity: finishedQty,
      materialCost,
      laborCost,
      totalCost,
      unitFinishedCost,
      date: date || new Date().toISOString().split('T')[0],
      assemblyDate: date || new Date().toISOString().split('T')[0],
      status: status || 'Draft', // 'Draft', 'In Progress', 'Completed', 'Cancelled', 'Reversed'
      lines: processedLines,
      notes,
      createdBy: userId,
      createdAt: new Date().toISOString()
    });
  }

  // Update Draft Assembly
  updateAssemblyDraft(id, updates) {
    const existing = this.getAssemblyById(id);
    if (!existing) throw new Error('Assembly not found.');
    if (existing.status === 'Completed' || existing.status === 'Reversed') {
      throw new Error('Completed or Reversed assemblies cannot be edited directly. Use Reverse Assembly instead to preserve audit trails.');
    }

    let materialCost = existing.materialCost;
    let finishedQty = updates.quantity !== undefined ? Number(updates.quantity) : existing.quantity;
    let lRate = updates.laborRate !== undefined ? Number(updates.laborRate) : existing.laborRate;

    let updatedLines = existing.lines;
    if (updates.lines) {
      materialCost = 0;
      updatedLines = updates.lines.map((l, idx) => {
        const actQty = Number(l.actualQuantity !== undefined ? l.actualQuantity : l.quantityConsumed) || 0;
        const recQty = Number(l.recipeQuantity !== undefined ? l.recipeQuantity : actQty) || 0;
        const variant = productService.getVariantById(l.componentVariantId);
        const unitCost = Number(l.unitCost) || variant?.costPrice || 0;
        const lineCost = actQty * unitCost;
        materialCost += lineCost;

        return {
          id: l.id || `asml-${Date.now()}-${idx}`,
          componentVariantId: l.componentVariantId,
          recipeQuantity: recQty,
          actualQuantity: actQty,
          quantityConsumed: actQty,
          unitCost,
          totalCost: lineCost,
          isAdditional: Boolean(l.isAdditional),
          unit: l.unit || 'PCS',
          warehouseId: updates.sourceWarehouseId || existing.sourceWarehouseId
        };
      });
    }

    const laborCost = finishedQty * lRate;
    const totalCost = materialCost + laborCost;
    const unitFinishedCost = finishedQty > 0 ? Math.round((totalCost / finishedQty) * 100) / 100 : 0;

    return storageService.update('assemblies', id, {
      ...updates,
      quantity: finishedQty,
      finishedQuantity: finishedQty,
      materialCost,
      laborCost,
      totalCost,
      unitFinishedCost,
      lines: updatedLines,
      updatedAt: new Date().toISOString()
    });
  }

  // Cancel Draft Assembly
  cancelAssembly(id, notes = '') {
    const existing = this.getAssemblyById(id);
    if (!existing) throw new Error('Assembly not found.');
    if (existing.status === 'Completed') {
      throw new Error('Completed assembly cannot be cancelled. Use Reverse Assembly instead.');
    }
    return storageService.update('assemblies', id, {
      status: 'Cancelled',
      cancelNotes: notes,
      updatedAt: new Date().toISOString()
    });
  }

  // Confirm / Complete Assembly Order
  completeAssembly(assemblyId, { userId = 'user-admin', idempotentKey = null } = {}) {
    const asm = this.getAssemblyById(assemblyId);
    if (!asm) throw new Error('Assembly order not found.');

    // Duplicate submission protection (Idempotency)
    if (asm.status === 'Completed') {
      return asm; // Already successfully completed
    }
    if (asm.status === 'Cancelled' || asm.status === 'Reversed') {
      throw new Error(`Cannot complete an assembly with status "${asm.status}".`);
    }

    const sourceWh = asm.sourceWarehouseId || asm.warehouseId || 'wh-1';
    const outputWh = asm.outputWarehouseId || asm.sourceWarehouseId || asm.warehouseId || 'wh-1';
    const finishedQty = Number(asm.quantity || asm.finishedQuantity) || 1;

    // 1. Stock Availability Pre-check
    const { isAvailable, shortfalls } = this.checkStockAvailability(sourceWh, asm.lines);
    const allowNegative = APP_CONFIG?.inventoryRules?.allowNegativeStockDefault || false;

    if (!isAvailable && !allowNegative) {
      const s = shortfalls[0];
      throw new Error(
        `Insufficient stock in selected warehouse for "${s.variantName}". ` +
        `Required: ${s.required} ${s.unit}, Available: ${s.available} ${s.unit}, Short: ${s.short} ${s.unit}`
      );
    }

    // 2. Calculate actual consumed inventory values using existing moving average costs
    let actualMaterialCost = 0;
    const finalLines = [];
    const sourceMovementLines = [];

    for (const line of asm.lines) {
      const actQty = Number(line.actualQuantity !== undefined ? line.actualQuantity : line.quantityConsumed);
      if (actQty <= 0) continue;

      // Use moving average cost from stock balances, fallback to variant costPrice
      const variant = productService.getVariantById(line.componentVariantId);
      const balance = (storageService.getCollection('stockBalances') || []).find(
        b => b.warehouseId === sourceWh && b.variantId === line.componentVariantId
      );
      const unitCost = Number(balance?.averageCost) || Number(line.unitCost) || variant?.costPrice || 0;
      const lineTotal = actQty * unitCost;
      actualMaterialCost += lineTotal;

      finalLines.push({
        ...line,
        actualQuantity: actQty,
        quantityConsumed: actQty,
        unitCost,
        totalCost: lineTotal
      });

      // Deduction from source warehouse
      sourceMovementLines.push({
        variantId: line.componentVariantId,
        quantity: -actQty,
        unitRate: unitCost,
        unit: line.unit || 'PCS',
        notes: `Assembly ${asm.assemblyNumber} component consumption`
      });
    }

    // 3. Labor Cost calculation
    const laborRate = Number(asm.laborRate) || 0;
    const laborCost = finishedQty * laborRate;
    const totalCost = actualMaterialCost + laborCost;
    const unitFinishedCost = Math.round((totalCost / finishedQty) * 100) / 100;

    // Output movement line
    const outputMovementLine = {
      variantId: asm.finishedVariantId,
      quantity: finishedQty,
      unitRate: unitFinishedCost,
      unit: 'PCS',
      notes: `Assembly ${asm.assemblyNumber} finished goods output`
    };

    // 4. Post Atomic Stock Movements
    let stockMov = null;
    if (sourceWh === outputWh) {
      // Single warehouse movement
      stockMov = inventoryService.postStockMovement({
        movementType: 'assembly_output',
        referenceDocType: 'assembly',
        referenceDocId: asm.id,
        warehouseId: sourceWh,
        lines: [...sourceMovementLines, outputMovementLine],
        notes: `Assembly ${asm.assemblyNumber}: Produced ${finishedQty} finished units.`,
        userId
      });
    } else {
      // Dual warehouse: component consumption at source, finished output at destination
      inventoryService.postStockMovement({
        movementType: 'assembly_consumption',
        referenceDocType: 'assembly',
        referenceDocId: asm.id,
        warehouseId: sourceWh,
        lines: sourceMovementLines,
        notes: `Assembly ${asm.assemblyNumber}: Consumed components for production at ${outputWh}`,
        userId
      });

      stockMov = inventoryService.postStockMovement({
        movementType: 'assembly_output',
        referenceDocType: 'assembly',
        referenceDocId: asm.id,
        warehouseId: outputWh,
        lines: [outputMovementLine],
        notes: `Assembly ${asm.assemblyNumber}: Received ${finishedQty} assembled units from ${sourceWh}`,
        userId
      });
    }

    // 5. Create Double-Entry Accounting Journal Entry
    // Debit: Finished Goods Inventory = totalCost
    // Credit: Consumed Component Inventory = actualMaterialCost
    // Credit: Assembly Labor Payable = laborCost
    let journalEntry = null;
    try {
      const coaList = accountingService.getChartOfAccounts();
      const inventoryAssetAcc = coaList.find(c => c.code === '1130') || { id: 'coa-6' };
      const laborPayableAcc = coaList.find(c => c.code === '2120' || c.id === 'coa-assembly-payable') || { id: 'coa-assembly-payable' };

      const jeLines = [
        {
          accountId: inventoryAssetAcc.id,
          debit: totalCost,
          credit: 0,
          description: `Finished Goods Assembly: ${asm.assemblyNumber}`
        }
      ];

      if (actualMaterialCost > 0) {
        jeLines.push({
          accountId: inventoryAssetAcc.id,
          debit: 0,
          credit: actualMaterialCost,
          description: `Consumed Components: ${asm.assemblyNumber}`
        });
      }

      if (laborCost > 0) {
        jeLines.push({
          accountId: laborPayableAcc.id,
          partyId: asm.laborPartyId || null,
          debit: 0,
          credit: laborCost,
          description: `Assembly Labor Payable: ${asm.assemblyNumber}`
        });
      }

      journalEntry = accountingService.createJournalEntry({
        date: asm.date || asm.assemblyDate,
        memo: `Assembly ${asm.assemblyNumber}: Produced ${finishedQty} finished units (Material: Rs. ${actualMaterialCost.toLocaleString()}, Labor: Rs. ${laborCost.toLocaleString()})`,
        referenceType: 'assembly',
        referenceId: asm.id,
        lines: jeLines,
        userId
      });
    } catch (e) {
      console.warn('Accounting entry posting notice:', e.message);
    }

    // 6. Create Unpaid Assembly Labor Payable (if labor cost > 0 and party specified)
    let payableDoc = null;
    if (laborCost > 0 && asm.laborPartyId) {
      const payables = storageService.getCollection('assemblyPayables') || [];
      const payableNumber = `ALP-${String(payables.length + 1).padStart(5, '0')}`;
      payableDoc = storageService.insert('assemblyPayables', {
        payableNumber,
        assemblyId: asm.id,
        assemblyNumber: asm.assemblyNumber,
        laborPartyId: asm.laborPartyId,
        date: asm.date || asm.assemblyDate || new Date().toISOString().split('T')[0],
        amount: laborCost,
        paidAmount: 0,
        remainingAmount: laborCost,
        status: 'Unpaid',
        createdAt: new Date().toISOString()
      });
    }

    // 7. Lock and Mark Assembly Order as Completed
    const updated = storageService.update('assemblies', asm.id, {
      status: 'Completed',
      materialCost: actualMaterialCost,
      laborCost,
      totalCost,
      unitFinishedCost,
      lines: finalLines,
      stockMovementId: stockMov ? stockMov.id : null,
      journalEntryId: journalEntry ? journalEntry.id : null,
      payableId: payableDoc ? payableDoc.id : null,
      completedBy: userId,
      completedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });

    return updated;
  }

  // Reverse Completed Assembly (Rolls back stock, journal entries, and payable without deleting audit record)
  reverseAssembly(assemblyId, { reason = 'Assembly reversal', userId = 'user-admin' } = {}) {
    const asm = this.getAssemblyById(assemblyId);
    if (!asm) throw new Error('Assembly order not found.');
    if (asm.status !== 'Completed') {
      throw new Error(`Only completed assemblies can be reversed. Current status: ${asm.status}`);
    }

    const sourceWh = asm.sourceWarehouseId || asm.warehouseId || 'wh-1';
    const outputWh = asm.outputWarehouseId || asm.sourceWarehouseId || asm.warehouseId || 'wh-1';
    const finishedQty = Number(asm.quantity || asm.finishedQuantity) || 1;

    // 1. Check if labor payable was already paid
    if (asm.payableId) {
      const payable = storageService.getById('assemblyPayables', asm.payableId);
      if (payable && payable.paidAmount > 0) {
        throw new Error(`Cannot reverse assembly ${asm.assemblyNumber}. Labor payable ${payable.payableNumber} has already been partially or fully paid (Paid: Rs. ${payable.paidAmount.toLocaleString()}). Reverse labor payments first.`);
      }
    }

    // 2. Prepare reversing stock movement lines
    const componentRestorationLines = (asm.lines || []).map(line => ({
      variantId: line.componentVariantId,
      quantity: Math.abs(Number(line.actualQuantity || line.quantityConsumed)),
      unitRate: Number(line.unitCost) || 0,
      unit: line.unit || 'PCS',
      notes: `Reversal of Assembly ${asm.assemblyNumber} component restoration`
    }));

    const finishedGoodsDeductionLine = {
      variantId: asm.finishedVariantId,
      quantity: -finishedQty,
      unitRate: Number(asm.unitFinishedCost) || 0,
      unit: 'PCS',
      notes: `Reversal of Assembly ${asm.assemblyNumber} finished good deduction`
    };

    let reversalMov = null;
    if (sourceWh === outputWh) {
      reversalMov = inventoryService.postStockMovement({
        movementType: 'assembly_consumption',
        referenceDocType: 'assembly_reversal',
        referenceDocId: asm.id,
        warehouseId: sourceWh,
        lines: [...componentRestorationLines, finishedGoodsDeductionLine],
        notes: `Reversal of Assembly ${asm.assemblyNumber}: ${reason}`,
        userId
      });
    } else {
      // Reversal dual-warehouse
      inventoryService.postStockMovement({
        movementType: 'assembly_output',
        referenceDocType: 'assembly_reversal',
        referenceDocId: asm.id,
        warehouseId: sourceWh,
        lines: componentRestorationLines,
        notes: `Reversal of Assembly ${asm.assemblyNumber}: Restored components to ${sourceWh}`,
        userId
      });

      reversalMov = inventoryService.postStockMovement({
        movementType: 'assembly_consumption',
        referenceDocType: 'assembly_reversal',
        referenceDocId: asm.id,
        warehouseId: outputWh,
        lines: [finishedGoodsDeductionLine],
        notes: `Reversal of Assembly ${asm.assemblyNumber}: Deducted finished units from ${outputWh}`,
        userId
      });
    }

    // 3. Post Reversing Journal Entry
    let revJournalEntry = null;
    try {
      const coaList = accountingService.getChartOfAccounts();
      const inventoryAssetAcc = coaList.find(c => c.code === '1130') || { id: 'coa-6' };
      const laborPayableAcc = coaList.find(c => c.code === '2120' || c.id === 'coa-assembly-payable') || { id: 'coa-assembly-payable' };

      const revJELines = [];
      if (asm.materialCost > 0) {
        revJELines.push({
          accountId: inventoryAssetAcc.id,
          debit: asm.materialCost,
          credit: 0,
          description: `Reversal Components Restored: ${asm.assemblyNumber}`
        });
      }
      if (asm.laborCost > 0) {
        revJELines.push({
          accountId: laborPayableAcc.id,
          partyId: asm.laborPartyId || null,
          debit: asm.laborCost,
          credit: 0,
          description: `Reversal Labor Payable Cancelled: ${asm.assemblyNumber}`
        });
      }
      revJELines.push({
        accountId: inventoryAssetAcc.id,
        debit: 0,
        credit: asm.totalCost,
        description: `Reversal Finished Goods Deducted: ${asm.assemblyNumber}`
      });

      revJournalEntry = accountingService.createJournalEntry({
        date: new Date().toISOString().split('T')[0],
        memo: `Reversal of Assembly ${asm.assemblyNumber}: ${reason}`,
        referenceType: 'assembly_reversal',
        referenceId: asm.id,
        lines: revJELines,
        userId
      });
    } catch (e) {
      console.warn('Reversal accounting notice:', e.message);
    }

    // 4. Cancel Labor Payable
    if (asm.payableId) {
      storageService.update('assemblyPayables', asm.payableId, {
        status: 'Reversed',
        remainingAmount: 0,
        notes: `Cancelled by reversal of assembly ${asm.assemblyNumber}`
      });
    }

    // 5. Update Assembly Order to Reversed
    return storageService.update('assemblies', asm.id, {
      status: 'Reversed',
      reversedBy: userId,
      reversedAt: new Date().toISOString(),
      reversalReason: reason,
      reversalStockMovementId: reversalMov ? reversalMov.id : null,
      reversalJournalEntryId: revJournalEntry ? revJournalEntry.id : null,
      updatedAt: new Date().toISOString()
    });
  }


  // ==========================================================================
  // 3. STANDALONE DISASSEMBLY & BREAKDOWN ENGINE
  // ==========================================================================

  getDisassemblyTemplates() {
    return storageService.getCollection('disassemblyTemplates') || [];
  }

  getDisassemblyTemplateById(id) {
    return storageService.getById('disassemblyTemplates', id);
  }

  getDisassemblyTemplateByVariant(variantId) {
    const templates = this.getDisassemblyTemplates();
    return templates.find(t => t.sourceVariantId === variantId && t.isActive) || null;
  }

  createDisassemblyTemplate({
    name,
    sourceVariantId,
    components = [],
    notes = '',
    userId = 'user-admin'
  }) {
    if (!sourceVariantId) throw new Error('Source item to disassemble must be specified.');
    const templates = this.getDisassemblyTemplates();
    const templateNumber = `DT-${String(templates.length + 1).padStart(5, '0')}`;

    return storageService.insert('disassemblyTemplates', {
      templateNumber,
      name: name || `Breakdown Template ${templateNumber}`,
      sourceVariantId,
      components: components.map((c, idx) => ({
        id: `dtc-${Date.now()}-${idx}`,
        componentVariantId: c.componentVariantId,
        defaultQuantity: Number(c.defaultQuantity) || 1,
        allocatedCost: Number(c.allocatedCost) || 0,
        unit: c.unit || 'PCS'
      })),
      notes,
      isActive: true,
      createdBy: userId,
      createdAt: new Date().toISOString()
    });
  }

  getDisassemblies(filters = {}) {
    let list = storageService.getCollection('disassemblies') || [];
    if (filters.status) list = list.filter(d => d.status === filters.status);
    if (filters.sourceVariantId) list = list.filter(d => d.sourceVariantId === filters.sourceVariantId);
    if (filters.warehouseId) list = list.filter(d => d.warehouseId === filters.warehouseId);
    return [...list].sort((a, b) => new Date(b.date || b.disassemblyDate || b.createdAt || 0) - new Date(a.date || a.disassemblyDate || a.createdAt || 0));
  }

  getDisassemblyById(id) {
    return storageService.getById('disassemblies', id);
  }

  createDisassemblyOrder(payload) {
    return this.createDisassemblyDraft({
      ...payload,
      sourceQuantity: payload.sourceQuantity || payload.disassembledQuantity,
      lines: payload.lines || payload.recoveredComponents,
      date: payload.date || payload.disassemblyDate
    });
  }

  createDisassemblyDraft({
    warehouseId = 'wh-1',
    sourceVariantId,
    sourceQuantity = 1,
    disassembledQuantity = null,
    templateId = null,
    lines = [], // Array of { componentVariantId, actualQuantity, unitCost, unit }
    recoveredComponents = null,
    notes = '',
    date = null,
    disassemblyDate = null,
    userId = 'user-admin',
    status = 'Draft'
  }) {
    const qty = Number(sourceQuantity || disassembledQuantity);
    if (qty <= 0) throw new Error('Quantity to disassemble must be greater than zero.');
    if (!sourceVariantId) throw new Error('Source item to disassemble must be specified.');
    if (!lines || lines.length === 0) throw new Error('At least one component must be selected for recovery.');

    const disassemblies = storageService.getCollection('disassemblies') || [];
    let maxNum = 0;
    disassemblies.forEach(d => {
      const match = (d.disassemblyNumber || '').match(/\d+/);
      if (match) {
        const val = parseInt(match[0], 10);
        if (val > maxNum) maxNum = val;
      }
    });
    const disassemblyNumber = `DIS-${String(maxNum + 1).padStart(5, '0')}`;

    // Source unit cost from inventory valuation
    const variant = productService.getVariantById(sourceVariantId);
    const balance = (storageService.getCollection('stockBalances') || []).find(
      b => b.warehouseId === warehouseId && b.variantId === sourceVariantId
    );
    const sourceUnitCost = Number(balance?.averageCost) || variant?.costPrice || 0;
    const totalSourceCost = qty * sourceUnitCost;

    let totalRecoveredCost = 0;
    const processedLines = lines.map((l, idx) => {
      const recQty = Number(l.actualQuantity !== undefined ? l.actualQuantity : l.quantityRestored) || 0;
      const compVar = productService.getVariantById(l.componentVariantId);
      const uCost = Number(l.unitCost) || compVar?.costPrice || 0;
      const lineCost = recQty * uCost;
      totalRecoveredCost += lineCost;

      return {
        id: `disl-${Date.now()}-${idx}`,
        componentVariantId: l.componentVariantId,
        actualQuantity: recQty,
        quantityRestored: recQty, // Alias for backward compatibility
        unitCost: uCost,
        totalCost: lineCost,
        unit: l.unit || 'PCS'
      };
    });

    return storageService.insert('disassemblies', {
      disassemblyNumber,
      templateId,
      warehouseId,
      sourceVariantId,
      sourceQuantity: qty,
      finishedVariantId: sourceVariantId, // Alias
      finishedQuantity: qty,             // Alias
      sourceUnitCost,
      totalSourceCost,
      totalRecoveredCost,
      varianceCost: totalSourceCost - totalRecoveredCost,
      date: date || new Date().toISOString().split('T')[0],
      disassemblyDate: date || new Date().toISOString().split('T')[0],
      status: status || 'Draft',
      lines: processedLines,
      notes,
      createdBy: userId,
      createdAt: new Date().toISOString()
    });
  }

  completeDisassembly(disassemblyId, { userId = 'user-admin' } = {}) {
    const dis = this.getDisassemblyById(disassemblyId);
    if (!dis) throw new Error('Disassembly transaction not found.');
    if (dis.status === 'Completed') return dis;
    if (dis.status === 'Cancelled' || dis.status === 'Reversed') {
      throw new Error(`Cannot complete disassembly with status "${dis.status}".`);
    }

    const qty = Number(dis.sourceQuantity || dis.finishedQuantity) || 1;
    const whId = dis.warehouseId || 'wh-1';

    // 1. Verify source stock availability
    const availableSource = inventoryService.getBalance(whId, dis.sourceVariantId);
    const allowNegative = APP_CONFIG?.inventoryRules?.allowNegativeStockDefault || false;
    if (availableSource < qty && !allowNegative) {
      const v = productService.getVariantById(dis.sourceVariantId);
      throw new Error(`Insufficient stock for "${v?.name || 'Source item'}" to disassemble. Available: ${availableSource}, Requested: ${qty}`);
    }

    // 2. Prepare atomic movement lines:
    // Deduct source item
    const movementLines = [
      {
        variantId: dis.sourceVariantId,
        quantity: -qty,
        unitRate: Number(dis.sourceUnitCost) || 0,
        unit: 'PCS',
        notes: `Disassembly ${dis.disassemblyNumber} source item deduction`
      }
    ];

    // Add recovered components
    let totalRecoveredCost = 0;
    const finalLines = (dis.lines || []).map(line => {
      const recQty = Number(line.actualQuantity !== undefined ? line.actualQuantity : line.quantityRestored) || 0;
      const compVar = productService.getVariantById(line.componentVariantId);
      const uCost = Number(line.unitCost) || compVar?.costPrice || 0;
      const lineCost = recQty * uCost;
      totalRecoveredCost += lineCost;

      movementLines.push({
        variantId: line.componentVariantId,
        quantity: recQty,
        unitRate: uCost,
        unit: line.unit || 'PCS',
        notes: `Disassembly ${dis.disassemblyNumber} recovered component`
      });

      return {
        ...line,
        actualQuantity: recQty,
        quantityRestored: recQty,
        unitCost: uCost,
        totalCost: lineCost
      };
    });

    // 3. Post atomic stock movement
    const stockMov = inventoryService.postStockMovement({
      movementType: 'disassembly_consumption',
      referenceDocType: 'disassembly',
      referenceDocId: dis.id,
      warehouseId: whId,
      lines: movementLines,
      notes: `Disassembly ${dis.disassemblyNumber}: Recovered ${finalLines.length} component types`,
      userId
    });

    // 4. Double-Entry Accounting
    // Debit: Inventory Asset (Recovered Components)
    // Credit: Inventory Asset (Source Finished Product)
    // Debit/Credit: Disassembly Variance (if any)
    let journalEntry = null;
    try {
      const coaList = accountingService.getChartOfAccounts();
      const inventoryAssetAcc = coaList.find(c => c.code === '1130') || { id: 'coa-6' };
      const varianceAcc = coaList.find(c => c.code === '5150' || c.id === 'coa-disassembly-variance') || { id: 'coa-disassembly-variance' };

      const totalSource = Number(dis.totalSourceCost) || (qty * (Number(dis.sourceUnitCost) || 0));
      const jeLines = [
        {
          accountId: inventoryAssetAcc.id,
          debit: totalRecoveredCost,
          credit: 0,
          description: `Disassembly ${dis.disassemblyNumber} Recovered Components`
        }
      ];

      const diff = totalSource - totalRecoveredCost;
      if (Math.abs(diff) > 0.01) {
        if (diff > 0) {
          // Unrecovered value written off as disassembly scrap/loss
          jeLines.push({
            accountId: varianceAcc.id,
            debit: diff,
            credit: 0,
            description: `Disassembly ${dis.disassemblyNumber} Unrecovered Scrap Value`
          });
        } else {
          jeLines.push({
            accountId: varianceAcc.id,
            debit: 0,
            credit: Math.abs(diff),
            description: `Disassembly ${dis.disassemblyNumber} Recovery Gain`
          });
        }
      }

      jeLines.push({
        accountId: inventoryAssetAcc.id,
        debit: 0,
        credit: totalSource,
        description: `Disassembly ${dis.disassemblyNumber} Source Product Deducted`
      });

      journalEntry = accountingService.createJournalEntry({
        date: dis.date || dis.disassemblyDate,
        memo: `Disassembly ${dis.disassemblyNumber}: Broken down ${qty} unit(s) into recovered components`,
        referenceType: 'disassembly',
        referenceId: dis.id,
        lines: jeLines,
        userId
      });
    } catch (e) {
      console.warn('Disassembly accounting notice:', e.message);
    }

    return storageService.update('disassemblies', dis.id, {
      status: 'Completed',
      totalRecoveredCost,
      lines: finalLines,
      stockMovementId: stockMov ? stockMov.id : null,
      journalEntryId: journalEntry ? journalEntry.id : null,
      completedBy: userId,
      completedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
  }

  reverseDisassembly(disassemblyId, { reason = 'Disassembly reversal', userId = 'user-admin' } = {}) {
    const dis = this.getDisassemblyById(disassemblyId);
    if (!dis) throw new Error('Disassembly transaction not found.');
    if (dis.status !== 'Completed') {
      throw new Error(`Only completed disassemblies can be reversed. Current status: ${dis.status}`);
    }

    const qty = Number(dis.sourceQuantity || dis.finishedQuantity) || 1;
    const whId = dis.warehouseId || 'wh-1';

    // Reverse stock movements: Restore source item (+qty), deduct recovered components (-qty)
    const revMovementLines = [
      {
        variantId: dis.sourceVariantId,
        quantity: qty,
        unitRate: Number(dis.sourceUnitCost) || 0,
        unit: 'PCS',
        notes: `Reversal of Disassembly ${dis.disassemblyNumber} source product restoration`
      }
    ];

    (dis.lines || []).forEach(line => {
      const actQty = Number(line.actualQuantity !== undefined ? line.actualQuantity : line.quantityRestored) || 0;
      revMovementLines.push({
        variantId: line.componentVariantId,
        quantity: -actQty,
        unitRate: Number(line.unitCost) || 0,
        unit: line.unit || 'PCS',
        notes: `Reversal of Disassembly ${dis.disassemblyNumber} component removal`
      });
    });

    const revStockMov = inventoryService.postStockMovement({
      movementType: 'disassembly_output',
      referenceDocType: 'disassembly_reversal',
      referenceDocId: dis.id,
      warehouseId: whId,
      lines: revMovementLines,
      notes: `Reversal of Disassembly ${dis.disassemblyNumber}: ${reason}`,
      userId
    });

    // Reversing accounting
    let revJE = null;
    try {
      const coaList = accountingService.getChartOfAccounts();
      const inventoryAssetAcc = coaList.find(c => c.code === '1130') || { id: 'coa-6' };
      const varianceAcc = coaList.find(c => c.code === '5150' || c.id === 'coa-disassembly-variance') || { id: 'coa-disassembly-variance' };

      const totalSource = Number(dis.totalSourceCost) || (qty * (Number(dis.sourceUnitCost) || 0));
      const totalRecovered = Number(dis.totalRecoveredCost) || 0;
      const diff = totalSource - totalRecovered;

      const revJELines = [
        {
          accountId: inventoryAssetAcc.id,
          debit: totalSource,
          credit: 0,
          description: `Reversal Disassembly ${dis.disassemblyNumber} Source Product Restored`
        }
      ];

      if (Math.abs(diff) > 0.01) {
        if (diff > 0) {
          revJELines.push({
            accountId: varianceAcc.id,
            debit: 0,
            credit: diff,
            description: `Reversal Disassembly ${dis.disassemblyNumber} Scrap Cancelled`
          });
        } else {
          revJELines.push({
            accountId: varianceAcc.id,
            debit: Math.abs(diff),
            credit: 0,
            description: `Reversal Disassembly ${dis.disassemblyNumber} Gain Cancelled`
          });
        }
      }

      revJELines.push({
        accountId: inventoryAssetAcc.id,
        debit: 0,
        credit: totalRecovered,
        description: `Reversal Disassembly ${dis.disassemblyNumber} Recovered Components Deducted`
      });

      revJE = accountingService.createJournalEntry({
        date: new Date().toISOString().split('T')[0],
        memo: `Reversal of Disassembly ${dis.disassemblyNumber}: ${reason}`,
        referenceType: 'disassembly_reversal',
        referenceId: dis.id,
        lines: revJELines,
        userId
      });
    } catch (e) {
      console.warn('Disassembly reversal accounting notice:', e.message);
    }

    return storageService.update('disassemblies', dis.id, {
      status: 'Reversed',
      reversedBy: userId,
      reversedAt: new Date().toISOString(),
      reversalReason: reason,
      reversalStockMovementId: revStockMov ? revStockMov.id : null,
      reversalJournalEntryId: revJE ? revJE.id : null,
      updatedAt: new Date().toISOString()
    });
  }


  // ==========================================================================
  // 4. ASSEMBLY LABOR PAYABLES & SETTLEMENT ENGINE
  // ==========================================================================

  getLaborParties() {
    const parties = storageService.getCollection('parties') || [];
    return parties.filter(p => p.isLaborParty || p.partyType === 'Assembly Labor');
  }

  getLaborPayables(filters = {}) {
    let list = storageService.getCollection('assemblyPayables') || [];
    if (filters.laborPartyId) list = list.filter(p => p.laborPartyId === filters.laborPartyId);
    if (filters.status) list = list.filter(p => p.status === filters.status);
    return [...list].sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));
  }

  getLaborPayments(filters = {}) {
    let list = storageService.getCollection('assemblyPayments') || [];
    if (filters.laborPartyId) list = list.filter(p => p.laborPartyId === filters.laborPartyId);
    return [...list].sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));
  }

  getLaborPartySummary(laborPartyId = null) {
    const payables = this.getLaborPayables({ laborPartyId: laborPartyId || undefined });
    const assemblies = this.getAssemblies({ laborPartyId: laborPartyId || undefined, status: 'Completed' });

    const totalLabor = payables.filter(p => p.status !== 'Reversed').reduce((sum, p) => sum + (Number(p.amount) || 0), 0);
    const paid = payables.filter(p => p.status !== 'Reversed').reduce((sum, p) => sum + (Number(p.paidAmount) || 0), 0);
    const outstanding = Math.max(0, totalLabor - paid);
    const totalUnitsAssembled = assemblies.reduce((sum, a) => sum + (Number(a.quantity || a.finishedQuantity) || 0), 0);

    return {
      assemblyCount: assemblies.length,
      unitsAssembled: totalUnitsAssembled,
      totalLabor,
      paid,
      outstanding
    };
  }

  getLaborPartyBalance(laborPartyId) {
    const summary = this.getLaborPartySummary(laborPartyId);
    return {
      outstandingBalance: summary.outstanding,
      totalLabor: summary.totalLabor,
      paid: summary.paid
    };
  }

  // Record payment against Assembly Labor Party
  recordLaborPayment({
    laborPartyId,
    amount,
    paymentMethod = 'bank',
    bankAccountId = 'ba-1',
    allocationType = 'balance_fifo', // 'specific_assemblies' (Option A) or 'balance_fifo' (Option B)
    selectedAssemblyIds = [],
    notes = '',
    userId = 'user-accounts'
  }) {
    const paymentAmount = Number(amount);
    if (paymentAmount <= 0) throw new Error('Payment amount must be greater than zero.');
    if (!laborPartyId) throw new Error('Labor party must be specified.');

    const allPayables = this.getLaborPayables({ laborPartyId }).filter(p => p.status !== 'Paid' && p.status !== 'Reversed');
    if (allPayables.length === 0) throw new Error('No outstanding assembly payables found for this labor party.');

    let remainingToAllocate = paymentAmount;
    const allocations = [];

    if (allocationType === 'specific_assemblies' && selectedAssemblyIds.length > 0) {
      // Option A: Pay selected assembly transactions
      const selectedPayables = allPayables.filter(p => selectedAssemblyIds.includes(p.assemblyId) || selectedAssemblyIds.includes(p.id));
      for (const payable of selectedPayables) {
        if (remainingToAllocate <= 0) break;
        const unpaid = Number(payable.remainingAmount) || (Number(payable.amount) - (Number(payable.paidAmount) || 0));
        const alloc = Math.min(unpaid, remainingToAllocate);

        const newPaid = (Number(payable.paidAmount) || 0) + alloc;
        const newRemaining = Math.max(0, Number(payable.amount) - newPaid);
        const newStatus = newRemaining === 0 ? 'Paid' : 'Partially Paid';

        storageService.update('assemblyPayables', payable.id, {
          paidAmount: newPaid,
          remainingAmount: newRemaining,
          status: newStatus,
          lastPaidAt: new Date().toISOString()
        });

        allocations.push({
          payableId: payable.id,
          assemblyId: payable.assemblyId,
          assemblyNumber: payable.assemblyNumber,
          allocatedAmount: alloc
        });

        remainingToAllocate -= alloc;
      }
    } else {
      // Option B: Pay outstanding balance via FIFO allocation
      // Sort oldest first
      const sortedPayables = [...allPayables].sort((a, b) => new Date(a.date || 0) - new Date(b.date || 0));
      for (const payable of sortedPayables) {
        if (remainingToAllocate <= 0) break;
        const unpaid = Number(payable.remainingAmount) || (Number(payable.amount) - (Number(payable.paidAmount) || 0));
        const alloc = Math.min(unpaid, remainingToAllocate);

        const newPaid = (Number(payable.paidAmount) || 0) + alloc;
        const newRemaining = Math.max(0, Number(payable.amount) - newPaid);
        const newStatus = newRemaining === 0 ? 'Paid' : 'Partially Paid';

        storageService.update('assemblyPayables', payable.id, {
          paidAmount: newPaid,
          remainingAmount: newRemaining,
          status: newStatus,
          lastPaidAt: new Date().toISOString()
        });

        allocations.push({
          payableId: payable.id,
          assemblyId: payable.assemblyId,
          assemblyNumber: payable.assemblyNumber,
          allocatedAmount: alloc
        });

        remainingToAllocate -= alloc;
      }
    }

    const totalAllocated = paymentAmount - remainingToAllocate;

    // Create Accounting Journal Entry for Labor Payment
    // Debit: Assembly Labor Payable
    // Credit: Cash/Bank Account
    let journalEntry = null;
    try {
      const coaList = accountingService.getChartOfAccounts();
      const laborPayableAcc = coaList.find(c => c.code === '2120' || c.id === 'coa-assembly-payable') || { id: 'coa-assembly-payable' };
      const bankAccount = storageService.getById('bankAccounts', bankAccountId);
      const creditAccId = bankAccount?.glAccountId || 'coa-4';

      journalEntry = accountingService.createJournalEntry({
        date: new Date().toISOString().split('T')[0],
        memo: `Labor payment to party: Rs. ${totalAllocated.toLocaleString()} (${paymentMethod.toUpperCase()})`,
        referenceType: 'labor_payment',
        referenceId: null,
        lines: [
          {
            accountId: laborPayableAcc.id,
            partyId: laborPartyId,
            debit: totalAllocated,
            credit: 0,
            description: `Payment for Assembly Labor`
          },
          {
            accountId: creditAccId,
            debit: 0,
            credit: totalAllocated,
            description: `Payment via ${paymentMethod.toUpperCase()}`
          }
        ],
        userId
      });
    } catch (e) {
      console.warn('Labor payment accounting notice:', e.message);
    }

    const payments = storageService.getCollection('assemblyPayments') || [];
    const paymentNumber = `LPAY-${String(payments.length + 1).padStart(5, '0')}`;

    return storageService.insert('assemblyPayments', {
      paymentNumber,
      laborPartyId,
      amount: totalAllocated,
      paymentMethod,
      bankAccountId,
      allocationType,
      allocations,
      notes,
      journalEntryId: journalEntry ? journalEntry.id : null,
      createdBy: userId,
      createdAt: new Date().toISOString()
    });
  }


  // ==========================================================================
  // 5. PRODUCTION REPORTS & REGISTERS
  // ==========================================================================

  getAssemblyRegisterReport(filters = {}) {
    const assemblies = this.getAssemblies(filters);
    const variants = productService.getVariants();
    const parties = storageService.getCollection('parties') || [];
    const warehouses = storageService.getCollection('warehouses') || [];

    const varMap = new Map(variants.map(v => [v.id, v]));
    const partyMap = new Map(parties.map(p => [p.id, p]));
    const whMap = new Map(warehouses.map(w => [w.id, w.name]));

    return assemblies.map(a => {
      const finished = varMap.get(a.finishedVariantId) || {};
      const party = partyMap.get(a.laborPartyId) || {};
      return {
        id: a.id,
        assemblyNumber: a.assemblyNumber,
        date: a.date || a.assemblyDate,
        finishedProduct: finished.name || 'Finished Good',
        sku: finished.sku || '',
        quantity: a.quantity || a.finishedQuantity,
        assemblyType: a.assemblyType || 'MANUFACTURING',
        sourceWarehouse: whMap.get(a.sourceWarehouseId) || 'Main Warehouse',
        outputWarehouse: whMap.get(a.outputWarehouseId) || 'Main Warehouse',
        laborParty: party.name || 'In-House / None',
        materialCost: a.materialCost || 0,
        laborCost: a.laborCost || 0,
        totalCost: a.totalCost || 0,
        unitCost: a.unitFinishedCost || 0,
        status: a.status
      };
    });
  }

  getProductAssemblyCostReport() {
    const assemblies = this.getAssemblies({ status: 'Completed' });
    const variants = productService.getVariants();
    const varMap = new Map(variants.map(v => [v.id, v]));

    const productMap = new Map();
    for (const a of assemblies) {
      const vId = a.finishedVariantId;
      const qty = Number(a.quantity || a.finishedQuantity) || 0;
      const mat = Number(a.materialCost) || 0;
      const lab = Number(a.laborCost) || 0;
      const tot = Number(a.totalCost) || 0;

      if (!productMap.has(vId)) {
        const v = varMap.get(vId) || {};
        productMap.set(vId, {
          variantId: vId,
          productName: v.name || 'Product',
          sku: v.sku || '',
          assemblyCount: 0,
          totalQuantity: 0,
          totalMaterialCost: 0,
          totalLaborCost: 0,
          totalAssemblyCost: 0
        });
      }

      const entry = productMap.get(vId);
      entry.assemblyCount += 1;
      entry.totalQuantity += qty;
      entry.totalMaterialCost += mat;
      entry.totalLaborCost += lab;
      entry.totalAssemblyCost += tot;
    }

    return Array.from(productMap.values()).map(p => ({
      ...p,
      averageCostPerUnit: p.totalQuantity > 0 ? Math.round(p.totalAssemblyCost / p.totalQuantity) : 0
    }));
  }

  getLaborPayableReport() {
    const laborParties = this.getLaborParties();
    return laborParties.map(party => {
      const summary = this.getLaborPartySummary(party.id);
      return {
        laborPartyId: party.id,
        partyName: party.name,
        contactPerson: party.contactPerson || '-',
        phone: party.phone || '-',
        assemblyCount: summary.assemblyCount,
        unitsAssembled: summary.unitsAssembled,
        totalLabor: summary.totalLabor,
        paid: summary.paid,
        outstanding: summary.outstanding
      };
    });
  }

  getComponentConsumptionReport(filters = {}) {
    const assemblies = this.getAssemblies({ status: 'Completed' });
    const variants = productService.getVariants();
    const varMap = new Map(variants.map(v => [v.id, v]));

    const compMap = new Map();
    for (const a of assemblies) {
      if (filters.fromDate && a.date < filters.fromDate) continue;
      if (filters.toDate && a.date > filters.toDate) continue;

      for (const line of (a.lines || [])) {
        const cId = line.componentVariantId;
        const qty = Number(line.actualQuantity || line.quantityConsumed) || 0;
        const cost = Number(line.totalCost) || (qty * (Number(line.unitCost) || 0));

        if (!compMap.has(cId)) {
          const v = varMap.get(cId) || {};
          compMap.set(cId, {
            componentVariantId: cId,
            componentName: v.name || 'Component',
            sku: v.sku || '',
            unit: line.unit || 'PCS',
            totalConsumedQuantity: 0,
            totalConsumedCost: 0
          });
        }

        const entry = compMap.get(cId);
        entry.totalConsumedQuantity += qty;
        entry.totalConsumedCost += cost;
      }
    }

    return Array.from(compMap.values()).map(c => ({
      ...c,
      averageUnitCost: c.totalConsumedQuantity > 0 ? Math.round(c.totalConsumedCost / c.totalConsumedQuantity) : 0
    }));
  }

  getDisassemblyRegisterReport(filters = {}) {
    const disassemblies = this.getDisassemblies(filters);
    const variants = productService.getVariants();
    const varMap = new Map(variants.map(v => [v.id, v]));
    const warehouses = storageService.getCollection('warehouses') || [];
    const whMap = new Map(warehouses.map(w => [w.id, w.name]));

    return disassemblies.map(d => {
      const source = varMap.get(d.sourceVariantId) || {};
      return {
        id: d.id,
        disassemblyNumber: d.disassemblyNumber,
        date: d.date || d.disassemblyDate,
        warehouse: whMap.get(d.warehouseId) || 'Main Warehouse',
        sourceItem: source.name || 'Item',
        sku: source.sku || '',
        quantity: d.sourceQuantity || d.finishedQuantity,
        recoveredComponentsCount: (d.lines || []).length,
        totalSourceCost: d.totalSourceCost || 0,
        totalRecoveredCost: d.totalRecoveredCost || 0,
        status: d.status
      };
    });
  }
}

export const assemblyService = new AssemblyService();
