/**
 * JS Traders ERP - Assembly & Disassembly Engine
 * Flexible Bill of Materials (BOM) allowing actual component quantities to vary.
 * Assembly consumes components and increases finished variant inventory.
 * Disassembly removes finished goods and restores components.
 */

import { storageService } from './storageService.js';
import { inventoryService } from './inventoryService.js';
import { productService } from './productService.js';

class AssemblyService {
  getAssemblies() {
    return storageService.getCollection('assemblies');
  }

  getAssemblyById(id) {
    return storageService.getById('assemblies', id);
  }

  // Confirm Assembly: Consumes component stock and creates finished stock atomically
  confirmAssembly({
    warehouseId,
    finishedVariantId,
    finishedQuantity,
    lines, // Array of { componentVariantId, quantityConsumed, unitCost, unit }
    notes = '',
    userId = 'user-admin'
  }) {
    const finishedQty = Number(finishedQuantity);
    if (finishedQty <= 0) throw new Error('Finished quantity must be greater than zero.');
    if (!lines || lines.length === 0) throw new Error('At least one component must be specified for assembly.');

    // 1. Calculate actual component costs and verify availability
    let totalCost = 0;
    const movementLines = [];

    for (const comp of lines) {
      const consumedQty = Number(comp.quantityConsumed);
      if (consumedQty <= 0) throw new Error('Component consumption quantity must be greater than zero.');

      const variant = productService.getVariantById(comp.componentVariantId);
      const unitCost = Number(comp.unitCost) || variant?.costPrice || 0;
      const lineCost = consumedQty * unitCost;
      totalCost += lineCost;

      // Negative quantity for component consumption
      movementLines.push({
        variantId: comp.componentVariantId,
        quantity: -consumedQty,
        unitRate: unitCost,
        unit: comp.unit || 'PCS',
        notes: `Assembly component consumption`
      });
    }

    const unitFinishedCost = Math.round((totalCost / finishedQty) * 100) / 100;

    // Positive quantity for finished good creation
    movementLines.push({
      variantId: finishedVariantId,
      quantity: finishedQty,
      unitRate: unitFinishedCost,
      unit: 'PCS',
      notes: `Assembly finished output`
    });

    const assemblies = this.getAssemblies();
    const assemblyNumber = `ASM-${String(assemblies.length + 1).padStart(5, '0')}`;

    // 2. Post atomic stock movement (will automatically fail if component stock is insufficient)
    const stockMov = inventoryService.postStockMovement({
      movementType: 'assembly_output',
      referenceDocType: 'assembly',
      referenceDocId: null,
      warehouseId,
      lines: movementLines,
      notes: `Assembly ${assemblyNumber}: Produced ${finishedQty} finished units. ${notes}`,
      userId
    });

    // 3. Record assembly document
    const assemblyDoc = storageService.insert('assemblies', {
      assemblyNumber,
      warehouseId,
      finishedVariantId,
      finishedQuantity: finishedQty,
      totalCost,
      unitFinishedCost,
      assemblyDate: new Date().toISOString().split('T')[0],
      status: 'Confirmed',
      lines: lines.map(l => ({
        componentVariantId: l.componentVariantId,
        quantityConsumed: Number(l.quantityConsumed),
        unitCost: Number(l.unitCost) || 0,
        totalCost: Number(l.quantityConsumed) * (Number(l.unitCost) || 0),
        unit: l.unit || 'PCS'
      })),
      stockMovementId: stockMov.id,
      notes,
      createdBy: userId
    });

    return assemblyDoc;
  }

  // Disassembly: Removes finished goods and restores components
  confirmDisassembly({
    warehouseId,
    finishedVariantId,
    finishedQuantity,
    restoredComponents, // Array of { componentVariantId, quantityRestored, unitCost, unit }
    notes = '',
    userId = 'user-admin'
  }) {
    const finishedQty = Number(finishedQuantity);
    if (finishedQty <= 0) throw new Error('Finished quantity to disassemble must be greater than zero.');

    const movementLines = [
      {
        variantId: finishedVariantId,
        quantity: -finishedQty,
        unit: 'PCS',
        notes: 'Disassembly finished item deduction'
      }
    ];

    for (const comp of restoredComponents) {
      movementLines.push({
        variantId: comp.componentVariantId,
        quantity: Number(comp.quantityRestored),
        unitRate: Number(comp.unitCost) || 0,
        unit: comp.unit || 'PCS',
        notes: 'Disassembly component restoration'
      });
    }

    const disassemblies = storageService.getCollection('disassemblies') || [];
    const disassemblyNumber = `DIS-${String(disassemblies.length + 1).padStart(5, '0')}`;

    inventoryService.postStockMovement({
      movementType: 'disassembly_consumption',
      referenceDocType: 'disassembly',
      referenceDocId: null,
      warehouseId,
      lines: movementLines,
      notes: `Disassembly ${disassemblyNumber}`,
      userId
    });

    return storageService.insert('disassemblies', {
      disassemblyNumber,
      warehouseId,
      finishedVariantId,
      finishedQuantity: finishedQty,
      disassemblyDate: new Date().toISOString().split('T')[0],
      status: 'Confirmed',
      lines: restoredComponents,
      notes,
      createdBy: userId
    });
  }
}

export const assemblyService = new AssemblyService();
