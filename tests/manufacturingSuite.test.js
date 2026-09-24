/**
 * JS Traders ERP - Comprehensive Manufacturing, Disassembly & Bundles Test Suite
 * 
 * Verifies all 3 core specifications:
 * 1. Assembly & Manufacturing (Air Cooler, Fan Finishing, BOMs, Costing, Labor Payables, Reversal)
 * 2. Standalone Disassembly & Breakdown (Any item, Partial Teardown, Incomplete Units, Reversal)
 * 3. Bundles, Sets & Complete Systems (Fixed Sets, Variable Systems, Rules, Extra Qty, Gate Pass inheritance)
 */

import { storageService } from '../services/storageService.js';
import { productService } from '../services/productService.js';
import { inventoryService } from '../services/inventoryService.js';
import { assemblyService } from '../services/assemblyService.js';
import { bundleService } from '../services/bundleService.js';
import { salesService } from '../services/salesService.js';
import { gatepassService } from '../services/gatepassService.js';

let passedTests = 0;
let failedTests = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  ✅ PASS: ${message}`);
    passedTests++;
  } else {
    console.error(`  ❌ FAIL: ${message}`);
    failedTests++;
    throw new Error(`Assertion failed: ${message}`);
  }
}

function assertEquals(actual, expected, message) {
  if (actual === expected) {
    console.log(`  ✅ PASS: ${message} (Expected: ${expected}, Got: ${actual})`);
    passedTests++;
  } else {
    console.error(`  ❌ FAIL: ${message} (Expected: ${expected}, Got: ${actual})`);
    failedTests++;
    throw new Error(`Assertion failed: ${message} (Expected: ${expected}, Got: ${actual})`);
  }
}

console.log('===============================================================');
console.log('🧪 RUNNING MANUFACTURING, DISASSEMBLY & BUNDLES TEST SUITE');
console.log('===============================================================\n');

// Reset to defaults for a clean slate
storageService.resetToDefaults();

// ----------------------------------------------------------------------------
// TEST 1: Assembly Recipe Creation (Multi-component & Single-component)
// ----------------------------------------------------------------------------
console.log('TEST 1: Assembly Recipe Creation');
const coolerRecipe = assemblyService.getRecipeById('rec-1');
assert(coolerRecipe !== null, 'Air Cooler 18" Recipe exists');
assertEquals(coolerRecipe.assemblyType, 'MANUFACTURING', 'Air Cooler type is MANUFACTURING');
assertEquals(coolerRecipe.components.length, 3, 'Air Cooler BOM has 3 components (Body, Motor, Pad)');
assertEquals(coolerRecipe.defaultLaborRate, 500, 'Air Cooler default labor rate is Rs. 500/unit');

const fanRecipe = assemblyService.getRecipeById('rec-2');
assert(fanRecipe !== null, 'Assembled Fan Recipe exists');
assertEquals(fanRecipe.assemblyType, 'FINISHING', 'Fan type is FINISHING');
assertEquals(fanRecipe.components.length, 1, 'Fan finishing has single component');
assertEquals(fanRecipe.defaultLaborRate, 150, 'Fan labor rate is Rs. 150/unit');


// ----------------------------------------------------------------------------
// TEST 2: Draft Assembly Order Isolation (Zero stock/accounting/payable effect)
// ----------------------------------------------------------------------------
console.log('\nTEST 2: Draft Assembly Order Isolation');
const initialBodyStock = inventoryService.getBalance('wh-1', 'var-cooler-body');
const initialMotorStock = inventoryService.getBalance('wh-1', 'var-6');
const initialCoolerStock = inventoryService.getBalance('wh-1', 'var-4');
const initialPayablesCount = assemblyService.getLaborPayables().length;

const draftAsm = assemblyService.createAssemblyDraft({
  recipeId: 'rec-1',
  assemblyType: 'MANUFACTURING',
  finishedVariantId: 'var-4',
  quantity: 10,
  sourceWarehouseId: 'wh-1',
  outputWarehouseId: 'wh-1',
  laborPartyId: 'pty-labor-1',
  laborRate: 500,
  lines: [
    { componentVariantId: 'var-cooler-body', recipeQuantity: 10, actualQuantity: 10, unitCost: 4000 },
    { componentVariantId: 'var-6', recipeQuantity: 10, actualQuantity: 10, unitCost: 18500 },
    { componentVariantId: 'var-pad-100', recipeQuantity: 10, actualQuantity: 10, unitCost: 800 }
  ],
  notes: 'Draft batch of 10 coolers'
});

assertEquals(draftAsm.status, 'Draft', 'Assembly order created as Draft');
assertEquals(inventoryService.getBalance('wh-1', 'var-cooler-body'), initialBodyStock, 'Component Body stock completely untouched while Draft');
assertEquals(inventoryService.getBalance('wh-1', 'var-6'), initialMotorStock, 'Component Motor stock completely untouched while Draft');
assertEquals(inventoryService.getBalance('wh-1', 'var-4'), initialCoolerStock, 'Finished Cooler stock completely untouched while Draft');
assertEquals(assemblyService.getLaborPayables().length, initialPayablesCount, 'No labor payable created while Draft');


// ----------------------------------------------------------------------------
// TEST 3: Stock Availability Validation
// ----------------------------------------------------------------------------
console.log('\nTEST 3: Stock Availability Validation');
const availCheck = assemblyService.checkStockAvailability('wh-1', [
  { componentVariantId: 'var-cooler-body', actualQuantity: 5000 } // Exceeds available stock
]);
assertEquals(availCheck.isAvailable, false, 'Stock check correctly detects insufficient inventory');
assertEquals(availCheck.shortfalls.length, 1, 'Shortfall item identified');
assert(availCheck.shortfalls[0].short > 0, 'Shortfall quantity calculated');


// ----------------------------------------------------------------------------
// TEST 4: Multi-Component Assembly Completion (Air Cooler)
// ----------------------------------------------------------------------------
console.log('\nTEST 4: Multi-Component Assembly Completion (Air Cooler)');
const bodyStockBefore = inventoryService.getBalance('wh-1', 'var-cooler-body');
const motorStockBefore = inventoryService.getBalance('wh-1', 'var-6');
const padStockBefore = inventoryService.getBalance('wh-1', 'var-pad-100');
const coolerStockBefore = inventoryService.getBalance('wh-1', 'var-4');

const completedAsm = assemblyService.completeAssembly(draftAsm.id, { userId: 'user-admin' });

assertEquals(completedAsm.status, 'Completed', 'Assembly status updated to Completed');
assertEquals(inventoryService.getBalance('wh-1', 'var-cooler-body'), bodyStockBefore - 10, 'Consumed exactly 10 Bodies');
assertEquals(inventoryService.getBalance('wh-1', 'var-6'), motorStockBefore - 10, 'Consumed exactly 10 Motors');
assertEquals(inventoryService.getBalance('wh-1', 'var-pad-100'), padStockBefore - 10, 'Consumed exactly 10 Cooling Pads');
assertEquals(inventoryService.getBalance('wh-1', 'var-4'), coolerStockBefore + 10, 'Produced exactly 10 Finished Air Coolers');

// Cost Breakdown & Valuation
// Body (10 * 4000 = 40000), Motor (10 * 18500 = 185000), Pad (10 * 800 = 8000) -> Material = 233,000
// Labor = 10 * 500 = 5,000
// Total = 238,000, Unit Cost = 23,800
assertEquals(completedAsm.materialCost, 233000, 'Material cost is Rs. 233,000 (40k + 185k + 8k)');
assertEquals(completedAsm.laborCost, 5000, 'Labor cost is Rs. 5,000 (10 x 500)');
assertEquals(completedAsm.totalCost, 238000, 'Total assembly cost is Rs. 238,000');
assertEquals(completedAsm.unitFinishedCost, 23800, 'Unit finished good cost is Rs. 23,800');

// Labor Payable Creation
assert(completedAsm.payableId !== null, 'Labor payable ID stamped on assembly');
const payable = storageService.getById('assemblyPayables', completedAsm.payableId);
assert(payable !== null, 'Assembly Labor Payable document created');
assertEquals(payable.amount, 5000, 'Payable amount is Rs. 5,000');
assertEquals(payable.status, 'Unpaid', 'Payable initial status is Unpaid');
assertEquals(payable.laborPartyId, 'pty-labor-1', 'Payable assigned to ABC Assembly Workshop');

// Accounting Journal Entry
assert(completedAsm.journalEntryId !== null, 'Journal entry ID stamped on assembly');
const je = storageService.getById('journalEntries', completedAsm.journalEntryId);
assert(je !== null, 'Double-entry Journal Entry created');
const totalDebits = je.lines.reduce((sum, l) => sum + (Number(l.debit) || 0), 0);
const totalCredits = je.lines.reduce((sum, l) => sum + (Number(l.credit) || 0), 0);
assertEquals(totalDebits, 238000, 'Journal Entry Total Debits = Rs. 238,000');
assertEquals(totalCredits, 238000, 'Journal Entry Total Credits = Rs. 238,000');


// ----------------------------------------------------------------------------
// TEST 5: Idempotency & Direct Edit Prevention on Completed Assembly
// ----------------------------------------------------------------------------
console.log('\nTEST 5: Idempotency & Completed Assembly Edit Protection');
const repeatComplete = assemblyService.completeAssembly(draftAsm.id);
assertEquals(repeatComplete.id, completedAsm.id, 'Idempotent completion returns existing assembly without re-running');
assertEquals(inventoryService.getBalance('wh-1', 'var-4'), coolerStockBefore + 10, 'Stock was NOT deducted twice');

let editPrevented = false;
try {
  assemblyService.updateAssemblyDraft(completedAsm.id, { quantity: 20 });
} catch (e) {
  editPrevented = true;
}
assert(editPrevented, 'Direct editing of Completed assembly is strictly blocked');


// ----------------------------------------------------------------------------
// TEST 6: Single-Product Finishing Assembly (Fan Finishing)
// ----------------------------------------------------------------------------
console.log('\nTEST 6: Single-Product Finishing Assembly (Fan Finishing)');
const importedFanStockBefore = inventoryService.getBalance('wh-1', 'var-fan-imported');
const assembledFanStockBefore = inventoryService.getBalance('wh-1', 'var-fan-assembled');

const fanAsm = assemblyService.createAssemblyDraft({
  recipeId: 'rec-2',
  assemblyType: 'FINISHING',
  finishedVariantId: 'var-fan-assembled',
  quantity: 50,
  sourceWarehouseId: 'wh-1',
  outputWarehouseId: 'wh-1',
  laborPartyId: 'pty-labor-2', // XYZ Fan Assembly
  laborRate: 150,
  lines: [
    { componentVariantId: 'var-fan-imported', recipeQuantity: 50, actualQuantity: 50, unitCost: 9500 }
  ],
  notes: 'Finishing 50 imported fans'
});

assemblyService.completeAssembly(fanAsm.id);

assertEquals(inventoryService.getBalance('wh-1', 'var-fan-imported'), importedFanStockBefore - 50, 'Consumed 50 Imported Fans');
assertEquals(inventoryService.getBalance('wh-1', 'var-fan-assembled'), assembledFanStockBefore + 50, 'Produced 50 Assembled Fans');
const fanPayable = assemblyService.getLaborPayables({ laborPartyId: 'pty-labor-2' })[0];
assertEquals(fanPayable.amount, 7500, 'Labor payable for XYZ Fan Assembly is Rs. 7,500 (50 x 150)');


// ----------------------------------------------------------------------------
// TEST 7: Dual-Warehouse Assembly Movement (Source != Output)
// ----------------------------------------------------------------------------
console.log('\nTEST 7: Dual-Warehouse Assembly Movement (Source != Output)');
const wh1BodyBefore = inventoryService.getBalance('wh-1', 'var-cooler-body');
const wh2CoolerBefore = inventoryService.getBalance('wh-2', 'var-4');

const dualWhAsm = assemblyService.createAssemblyDraft({
  recipeId: 'rec-1',
  finishedVariantId: 'var-4',
  quantity: 2,
  sourceWarehouseId: 'wh-1', // Components in Main Warehouse
  outputWarehouseId: 'wh-2', // Finished goods into Office / Showroom
  laborPartyId: 'pty-labor-1',
  laborRate: 500,
  lines: [
    { componentVariantId: 'var-cooler-body', actualQuantity: 2, unitCost: 4000 },
    { componentVariantId: 'var-6', actualQuantity: 2, unitCost: 18500 },
    { componentVariantId: 'var-pad-100', actualQuantity: 2, unitCost: 800 }
  ]
});

assemblyService.completeAssembly(dualWhAsm.id);

assertEquals(inventoryService.getBalance('wh-1', 'var-cooler-body'), wh1BodyBefore - 2, 'Deducted 2 bodies from Source Warehouse (wh-1)');
assertEquals(inventoryService.getBalance('wh-2', 'var-4'), wh2CoolerBefore + 2, 'Added 2 finished coolers into Output Warehouse (wh-2)');


// ----------------------------------------------------------------------------
// TEST 8: Assembly Reversal (Audit-safe exact rollback)
// ----------------------------------------------------------------------------
console.log('\nTEST 8: Assembly Reversal');
const bodyBeforeRev = inventoryService.getBalance('wh-1', 'var-cooler-body');
const coolerBeforeRev = inventoryService.getBalance('wh-1', 'var-4');

const reversed = assemblyService.reverseAssembly(completedAsm.id, { reason: 'Quality defect audit', userId: 'user-admin' });

assertEquals(reversed.status, 'Reversed', 'Assembly status changed to Reversed');
assertEquals(inventoryService.getBalance('wh-1', 'var-cooler-body'), bodyBeforeRev + 10, '10 Bodies successfully restored to warehouse');
assertEquals(inventoryService.getBalance('wh-1', 'var-4'), coolerBeforeRev - 10, '10 Finished coolers deducted from warehouse');

const reversedPayable = storageService.getById('assemblyPayables', completedAsm.payableId);
assertEquals(reversedPayable.status, 'Reversed', 'Labor payable marked Reversed');
assertEquals(reversedPayable.remainingAmount, 0, 'Remaining payable balance reset to 0');


// ----------------------------------------------------------------------------
// TEST 9: Assembly Labor Payment & Allocation (Option A, Option B & Partial Payments)
// ----------------------------------------------------------------------------
console.log('\nTEST 9: Assembly Labor Payment & Allocation');
// Create two fresh completed assemblies for ABC Workshop
const freshAsm1 = assemblyService.createAssemblyDraft({
  recipeId: 'rec-1',
  finishedVariantId: 'var-4',
  quantity: 4,
  sourceWarehouseId: 'wh-1',
  outputWarehouseId: 'wh-1',
  laborPartyId: 'pty-labor-1',
  laborRate: 500,
  lines: [
    { componentVariantId: 'var-cooler-body', actualQuantity: 4, unitCost: 4000 },
    { componentVariantId: 'var-6', actualQuantity: 4, unitCost: 18500 },
    { componentVariantId: 'var-pad-100', actualQuantity: 4, unitCost: 800 }
  ]
});
assemblyService.completeAssembly(freshAsm1.id); // Payable: Rs. 2,000

const freshAsm2 = assemblyService.createAssemblyDraft({
  recipeId: 'rec-1',
  finishedVariantId: 'var-4',
  quantity: 6,
  sourceWarehouseId: 'wh-1',
  outputWarehouseId: 'wh-1',
  laborPartyId: 'pty-labor-1',
  laborRate: 500,
  lines: [
    { componentVariantId: 'var-cooler-body', actualQuantity: 6, unitCost: 4000 },
    { componentVariantId: 'var-6', actualQuantity: 6, unitCost: 18500 },
    { componentVariantId: 'var-pad-100', actualQuantity: 6, unitCost: 800 }
  ]
});
assemblyService.completeAssembly(freshAsm2.id); // Payable: Rs. 3,000
// Note: initial seed asm-1 also has unpaid Rs. 1,000. Total outstanding = 1,000 + 2,000 + 3,000 = 6,000.

const initialSummary = assemblyService.getLaborPartySummary('pty-labor-1');
assertEquals(initialSummary.outstanding, 7000, 'Initial ABC Workshop outstanding payable is Rs. 7,000 (Seed 1k + DualWh 1k + Asm1 2k + Asm2 3k)');

// Option B: Pay Rs. 2,500 using FIFO allocation
const payment1 = assemblyService.recordLaborPayment({
  laborPartyId: 'pty-labor-1',
  amount: 2500,
  allocationType: 'balance_fifo',
  notes: 'Partial advance payment for weekly assemblies'
});

assertEquals(payment1.amount, 2500, 'Payment recorded for Rs. 2,500');
const midSummary = assemblyService.getLaborPartySummary('pty-labor-1');
assertEquals(midSummary.paid, 2500, 'Paid amount is Rs. 2,500');
assertEquals(midSummary.outstanding, 4500, 'Remaining outstanding is Rs. 4,500 (7,000 - 2,500)');


// ----------------------------------------------------------------------------
// TEST 10: Standalone Disassembly / Breakdown (Zero Assembly BOM dependency)
// ----------------------------------------------------------------------------
console.log('\nTEST 10: Standalone Disassembly / Breakdown');
const fanStockBeforeDis = inventoryService.getBalance('wh-1', 'var-fan-imported');
const motorStockBeforeDis = inventoryService.getBalance('wh-1', 'var-6');
const bladesStockBeforeDis = inventoryService.getBalance('wh-1', 'var-7');
const pulleyStockBeforeDis = inventoryService.getBalance('wh-1', 'var-pulley');
const bodyStockBeforeDis = inventoryService.getBalance('wh-1', 'var-fan-body');

const disDraft = assemblyService.createDisassemblyDraft({
  warehouseId: 'wh-1',
  sourceVariantId: 'var-fan-imported',
  sourceQuantity: 1,
  lines: [
    { componentVariantId: 'var-6', actualQuantity: 1, unitCost: 5500 }, // Motor
    { componentVariantId: 'var-7', actualQuantity: 1, unitCost: 2000 }, // Blades
    { componentVariantId: 'var-pulley', actualQuantity: 1, unitCost: 800 }, // Pulley
    { componentVariantId: 'var-fan-body', actualQuantity: 1, unitCost: 1200 } // Body
  ],
  notes: 'Full teardown of imported fan unit'
});

assemblyService.completeDisassembly(disDraft.id);

assertEquals(inventoryService.getBalance('wh-1', 'var-fan-imported'), fanStockBeforeDis - 1, 'Source Fan decreased by 1');
assertEquals(inventoryService.getBalance('wh-1', 'var-6'), motorStockBeforeDis + 1, 'Recovered Motor increased by 1');
assertEquals(inventoryService.getBalance('wh-1', 'var-7'), bladesStockBeforeDis + 1, 'Recovered Blades increased by 1');
assertEquals(inventoryService.getBalance('wh-1', 'var-pulley'), pulleyStockBeforeDis + 1, 'Recovered Pulley increased by 1');
assertEquals(inventoryService.getBalance('wh-1', 'var-fan-body'), bodyStockBeforeDis + 1, 'Recovered Body increased by 1');


// ----------------------------------------------------------------------------
// TEST 11: Partial Disassembly (Extract Motor Only)
// ----------------------------------------------------------------------------
console.log('\nTEST 11: Partial Disassembly (Extract Motor Only)');
const fanStockBeforePartial = inventoryService.getBalance('wh-1', 'var-fan-imported');
const motorStockBeforePartial = inventoryService.getBalance('wh-1', 'var-6');
const bladesStockBeforePartial = inventoryService.getBalance('wh-1', 'var-7');

const partialDis = assemblyService.createDisassemblyDraft({
  warehouseId: 'wh-1',
  sourceVariantId: 'var-fan-imported',
  sourceQuantity: 1,
  lines: [
    { componentVariantId: 'var-6', actualQuantity: 1, unitCost: 5500 } // Only motor recovered for warranty replacement!
  ],
  notes: 'Customer warranty motor salvage'
});

assemblyService.completeDisassembly(partialDis.id);

assertEquals(inventoryService.getBalance('wh-1', 'var-fan-imported'), fanStockBeforePartial - 1, 'Source Fan decreased by 1');
assertEquals(inventoryService.getBalance('wh-1', 'var-6'), motorStockBeforePartial + 1, 'Recovered Motor increased by 1');
assertEquals(inventoryService.getBalance('wh-1', 'var-7'), bladesStockBeforePartial, 'Blades stock UNTOUCHED (partial disassembly respected)');


// ----------------------------------------------------------------------------
// TEST 12: Disassembly Reversal
// ----------------------------------------------------------------------------
console.log('\nTEST 12: Disassembly Reversal');
const fanBeforeRevDis = inventoryService.getBalance('wh-1', 'var-fan-imported');
const motorBeforeRevDis = inventoryService.getBalance('wh-1', 'var-6');

assemblyService.reverseDisassembly(partialDis.id, { reason: 'Salvage mistake' });

assertEquals(inventoryService.getBalance('wh-1', 'var-fan-imported'), fanBeforeRevDis + 1, 'Source Fan restored to inventory (+1)');
assertEquals(inventoryService.getBalance('wh-1', 'var-6'), motorBeforeRevDis - 1, 'Recovered Motor removed from inventory (-1)');


// ----------------------------------------------------------------------------
// TEST 13: Simplified Bundle Engine - Proportional Scaling
// ----------------------------------------------------------------------------
console.log('\nTEST 13: Simplified Bundle Engine - Proportional Scaling');
// Proportional Set: 1 Fan Pulley Set = 1 Pulley + 3 Fan Blades
// 3 Sets = 3 Pulleys + 9 Fan Blades
const pulley3Calc = bundleService.calculateBundleComponents('bnd-pulley-set', 3);
assertEquals(pulley3Calc.bundleQty, 3, 'Bundle quantity is 3');
assertEquals(pulley3Calc.components.find(c => c.componentVariantId === 'var-pulley').finalQty, 3, '3 Pulley Sets require 3 Pulleys');
assertEquals(pulley3Calc.components.find(c => c.componentVariantId === 'var-7').finalQty, 9, '3 Pulley Sets require 9 Fan Blades (3 x 3)');

// 10 Sets = 10 Pulleys + 30 Fan Blades
const pulley10Calc = bundleService.calculateBundleComponents('bnd-pulley-set', 10);
assertEquals(pulley10Calc.components.find(c => c.componentVariantId === 'var-pulley').finalQty, 10, '10 Pulley Sets require 10 Pulleys');
assertEquals(pulley10Calc.components.find(c => c.componentVariantId === 'var-7').finalQty, 30, '10 Pulley Sets require 30 Fan Blades');

// Multi-component system: Feeding Line x 4
// 1 Line = 40 Hangers, 40 Pans, 400 FT Pipe, 1 Handle
const feed4Calc = bundleService.calculateBundleComponents('bnd-feed-line', 4);
assertEquals(feed4Calc.components.find(c => c.componentVariantId === 'var-hanger').finalQty, 160, '4 lines require 160 Hangers (40 x 4)');
assertEquals(feed4Calc.components.find(c => c.componentVariantId === 'var-1').finalQty, 160, '4 lines require 160 Feed Pans (40 x 4)');
assertEquals(feed4Calc.components.find(c => c.componentVariantId === 'var-pipe-galv').finalQty, 1600, '4 lines require 1,600 ft Pipe (400 x 4)');
assertEquals(feed4Calc.components.find(c => c.componentVariantId === 'var-handle').finalQty, 4, '4 lines require 4 Handles (1 x 4)');


// ----------------------------------------------------------------------------
// TEST 14: Extra Qty & Manual Override Qty in Bundles
// ----------------------------------------------------------------------------
console.log('\nTEST 14: Extra Qty & Manual Override Qty in Bundles');
// Pulley Set x 3: Pulley=3, Blades scaled to 9, then manually changed from 9 to 8
const pulleyOverrideCalc = bundleService.calculateBundleComponents('bnd-pulley-set', 3, {
  overrideQuantities: {
    'var-7': 8 // manually change blades from 9 to 8
  }
});
assertEquals(pulleyOverrideCalc.components.find(c => c.componentVariantId === 'var-7').finalQty, 8, 'Blades manually changed from 9 to 8');
assertEquals(pulleyOverrideCalc.components.find(c => c.componentVariantId === 'var-pulley').finalQty, 3, 'Pulleys remain 3');

// Feeding Line x 4 with adjustments (extra 5 hangers -> 165, override handles to 2)
const feedAdjustedCalc = bundleService.calculateBundleComponents('bnd-feed-line', 4, [
  { componentVariantId: 'var-hanger', extraQty: 5 }, // 160 + 5 = 165
  { componentVariantId: 'var-handle', overrideQty: 2 } // 4 overridden to 2
]);

assertEquals(feedAdjustedCalc.numberOfLines, 4, 'Commercial quantity remains exactly 4 lines');
const hangerComp = feedAdjustedCalc.components.find(c => c.componentVariantId === 'var-hanger');
assertEquals(hangerComp.calculatedQty, 160, 'Calculated qty is 160');
assertEquals(hangerComp.extraQty, 5, 'Extra qty is 5');
assertEquals(hangerComp.finalQty, 165, 'Final qty is 165');

const handleComp = feedAdjustedCalc.components.find(c => c.componentVariantId === 'var-handle');
assertEquals(handleComp.calculatedQty, 4, 'Calculated handle qty is 4');
assertEquals(handleComp.overrideQty, 2, 'Override handle qty is 2');
assertEquals(handleComp.finalQty, 2, 'Final handle qty is 2');


// ----------------------------------------------------------------------------
// TEST 15: Invoice to Gate Pass Continuity & Physical Stock Deduction
// ----------------------------------------------------------------------------
console.log('\nTEST 15: Invoice to Gate Pass Continuity & Physical Stock Deduction');
// 1. Create Invoice with Feeding Line x 4 (with extras: 165 Hangers, 160 Pans, 1600 Pipe, 2 Handles)
const invoice = salesService.createSalesInvoice({
  customerPartyId: 'pty-1',
  date: '2025-09-23',
  lines: [
    {
      isBundle: true,
      bundleId: 'bnd-feed-line',
      bundleName: 'Automatic Feeding Line',
      bundleType: 'VARIABLE_SYSTEM',
      quantity: 4,
      unitPrice: 185000,
      bundleComponents: feedAdjustedCalc.components
    }
  ]
});

assertEquals(invoice.lines[0].quantity, 4, 'Commercial invoice line shows 4 lines of Feeding Line');
assertEquals(invoice.lines[0].bundleComponents.length, 4, 'Invoice line stores full component breakdown metadata');

// 2. Automatically generate Gate Pass from Invoice
const gp = gatepassService.createGatepassFromInvoice(invoice.id, {
  warehouseId: 'wh-1',
  assignedStaffIds: ['user-wh-alitoor']
});

assert(gp !== null, 'Gate Pass generated from invoice');
const gpHangerLine = gp.lines.find(l => l.variantId === 'var-hanger');
assert(gpHangerLine !== undefined, 'Gate Pass contains Hanger line');
assertEquals(gpHangerLine.quantity, 165, 'Gate Pass automatically inherited final quantity of 165 Hangers');

const gpHandleLine = gp.lines.find(l => l.variantId === 'var-handle');
assertEquals(gpHandleLine.quantity, 2, 'Gate Pass automatically inherited final quantity of 2 Handles');

// 3. Approve Gatepass and verify physical stock deduction of Final Quantities
const hangerStockBeforeGP = inventoryService.getBalance('wh-1', 'var-hanger');
const handleStockBeforeGP = inventoryService.getBalance('wh-1', 'var-handle');

gatepassService.approveGatepass(gp.id, 'user-wh-mgr');

assertEquals(inventoryService.getBalance('wh-1', 'var-hanger'), hangerStockBeforeGP - 165, 'Exactly 165 physical Hangers deducted from warehouse inventory');
assertEquals(inventoryService.getBalance('wh-1', 'var-handle'), handleStockBeforeGP - 2, 'Exactly 2 physical Handles deducted from warehouse inventory');


// ----------------------------------------------------------------------------
// TEST 16: Reports Engine (Assembly Register, Costing, Payables, Consumption)
// ----------------------------------------------------------------------------
console.log('\nTEST 16: Reports Engine');
const registerReport = assemblyService.getAssemblyRegisterReport();
assert(registerReport.length >= 3, 'Assembly Register contains all completed and reversed assemblies');

const costReport = assemblyService.getProductAssemblyCostReport();
assert(costReport.length >= 1, 'Product Assembly Cost Report generated');
assert(costReport[0].averageCostPerUnit > 0, 'Average unit cost calculated');

const payableReport = assemblyService.getLaborPayableReport();
assert(payableReport.length >= 2, 'Labor Payable Report generated for labor parties');

const consumptionReport = assemblyService.getComponentConsumptionReport();
assert(consumptionReport.length >= 3, 'Component Consumption Report tracks consumed raw materials');

const disRegister = assemblyService.getDisassemblyRegisterReport();
assert(disRegister.length >= 2, 'Disassembly Register tracks teardown transactions');


console.log('\n===============================================================');
console.log(`🎉 ALL TESTS COMPLETED: ${passedTests} PASSED, ${failedTests} FAILED`);
console.log('===============================================================');
