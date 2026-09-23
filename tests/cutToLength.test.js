/**
 * JS Traders ERP - Cut-to-Length & Multi-Roll Packaging Inventory Verification Suite
 * 
 * Verifies all 7 core acceptance criteria:
 * 1. Initial purchase: 10 rolls × 5,000 ft -> Full = 10, Loose = 0, Total = 50,000 ft
 * 2. 4,000-ft sale -> Full = 9, Loose = 1,000 ft, Total = 46,000 ft
 * 3. 1,300-ft sale with 1,000 ft loose and 9 full rolls -> Opens roll, Full = 8, Loose = 1,000 ft + 3,700 ft, Total = 44,700 ft
 * 4. 800-ft sale with L001 = 1,000 ft, L002 = 3,700 ft -> L001 = 200 ft, L002 = 3,700 ft
 * 5. Continuous allocation rule: no auto-combining loose pieces; opens full roll
 * 6. Selling complete full roll directly deducts intact roll with 0 loose pieces created
 * 7. Normal product (cut_to_length = false) remains 100% unchanged
 * 8. Multi-unit packaging flexibility (3,280 ft & 5,000 ft wire; 400 ft & 450 ft auger)
 * 9. Void rollback restoring physical stock entities
 */

// Mock browser localStorage for Node.js environment if needed
if (typeof globalThis.localStorage === 'undefined') {
  const store = {};
  globalThis.localStorage = {
    getItem: (k) => store[k] || null,
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
    clear: () => { Object.keys(store).forEach(k => delete store[k]); }
  };
}

import { storageService } from '../services/storageService.js';
import { productService } from '../services/productService.js';
import { cutToLengthService } from '../services/cutToLengthService.js';

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

async function runTests() {
  console.log('===============================================================');
  console.log('🧪 RUNNING CUT-TO-LENGTH & MULTI-PACKAGING TEST SUITE');
  console.log('===============================================================\n');

  // Reset storage
  storageService.resetToDefaults();

  // Test Product: Create a dedicated clean test product
  const testProd = productService.createProduct({
    businessName: 'Test Continuous Steel Cable',
    customerName: 'High-Tensile Cable',
    categoryId: 'cat-6',
    brand: 'JS Industrial',
    cut_to_length: true,
    base_unit: 'ft',
    full_unit: 'roll',
    full_unit_quantity: 5000,
    packagingUnits: [
      { id: 'pack-5000', name: 'Roll (5,000 ft)', factor: 5000 },
      { id: 'pack-3280', name: 'Roll (3,280 ft)', factor: 3280 }
    ]
  });

  const productId = testProd.id;
  const warehouseId = 'wh-1';

  // --------------------------------------------------------------------------
  console.log('TEST 1: Initial Purchase (10 rolls × 5,000 ft)');
  // --------------------------------------------------------------------------
  cutToLengthService.receiveFullRolls({
    productId,
    warehouseId,
    count: 10,
    rollSize: 5000,
    packagingName: 'Roll (5,000 ft)',
    unit: 'ft',
    referenceDocId: 'PO-TEST-001'
  });

  let summary = cutToLengthService.getSummary(productId, warehouseId);
  assertEquals(summary.fullRollsCount, 10, 'Full rolls count is 10');
  assertEquals(summary.loosePiecesCount, 0, 'Loose pieces count is 0');
  assertEquals(summary.totalFootage, 50000, 'Total stock is 50,000 ft');
  console.log('');

  // --------------------------------------------------------------------------
  console.log('TEST 2: Sale of 4,000 ft (Cut from Full Roll)');
  // --------------------------------------------------------------------------
  let plan = cutToLengthService.planAllocation({
    productId,
    warehouseId,
    requestedQty: 4000,
    unit: 'ft'
  });

  assertEquals(plan.canFulfill, true, 'Allocation plan is fulfillable');
  assertEquals(plan.type, 'OPEN_FULL_ROLL_CUT', 'Plan type is OPEN_FULL_ROLL_CUT');
  assertEquals(plan.newLoosePiece.remainingLength, 1000, 'Leaves 1,000 ft loose piece');

  // Commit sale
  cutToLengthService.commitAllocation(plan, {
    referenceDocType: 'invoice',
    referenceDocId: 'INV-TEST-001',
    userId: 'test-user'
  });

  summary = cutToLengthService.getSummary(productId, warehouseId);
  assertEquals(summary.fullRollsCount, 9, 'Full rolls count decreased to 9');
  assertEquals(summary.loosePiecesCount, 1, 'Loose pieces count is 1');
  assertEquals(summary.loosePieces[0].quantity, 1000, 'Loose piece has exactly 1,000 ft');
  assertEquals(summary.totalFootage, 46000, 'Total continuous stock is 46,000 ft (50,000 - 4,000)');
  console.log('');

  // --------------------------------------------------------------------------
  console.log('TEST 3: Sale of 1,300 ft with 1,000 ft loose and 9 full rolls');
  console.log('(Continuous Rule 2 & 3: Do not combine loose piece, open new full roll)');
  // --------------------------------------------------------------------------
  plan = cutToLengthService.planAllocation({
    productId,
    warehouseId,
    requestedQty: 1300,
    unit: 'ft'
  });

  assertEquals(plan.canFulfill, true, 'Allocation plan is fulfillable');
  assertEquals(plan.type, 'OPEN_FULL_ROLL_CUT', 'Does not combine loose; opens full roll');
  assertEquals(plan.newLoosePiece.remainingLength, 3700, 'Remaining length on new loose piece is 3,700 ft');

  // Commit sale
  cutToLengthService.commitAllocation(plan, {
    referenceDocType: 'invoice',
    referenceDocId: 'INV-TEST-002',
    userId: 'test-user'
  });

  summary = cutToLengthService.getSummary(productId, warehouseId);
  assertEquals(summary.fullRollsCount, 8, 'Full rolls count decreased to 8');
  assertEquals(summary.loosePiecesCount, 2, 'Loose pieces count is 2 (L001 and L002)');
  assertEquals(summary.totalFootage, 44700, 'Total continuous stock is 44,700 ft');
  
  // Verify physical entities exist separately
  const piece1 = summary.loosePieces.find(p => p.quantity === 1000);
  const piece2 = summary.loosePieces.find(p => p.quantity === 3700);
  assert(piece1 !== undefined, 'Physical piece of 1,000 ft exists individually');
  assert(piece2 !== undefined, 'Physical piece of 3,700 ft exists individually');
  console.log('');

  // --------------------------------------------------------------------------
  console.log('TEST 4: Sale of 800 ft with L001 = 1,000 ft, L002 = 3,700 ft');
  console.log('(Continuous Rule 1: Best-fit selects smallest sufficient piece L001)');
  // --------------------------------------------------------------------------
  plan = cutToLengthService.planAllocation({
    productId,
    warehouseId,
    requestedQty: 800,
    unit: 'ft'
  });

  assertEquals(plan.canFulfill, true, 'Allocation plan is fulfillable');
  assertEquals(plan.type, 'LOOSE_PIECE_CUT', 'Plan cuts from existing loose piece');
  assertEquals(plan.sourceUnit.originalLength, 1000, 'Best fit chose 1,000 ft piece (L001)');
  assertEquals(plan.sourceUnit.remainingLength, 200, 'Leaves 200 ft on piece');

  // Commit sale
  cutToLengthService.commitAllocation(plan, {
    referenceDocType: 'invoice',
    referenceDocId: 'INV-TEST-003',
    userId: 'test-user'
  });

  summary = cutToLengthService.getSummary(productId, warehouseId);
  assertEquals(summary.fullRollsCount, 8, 'Full rolls remain 8');
  assertEquals(summary.loosePiecesCount, 2, 'Loose pieces count remains 2');
  
  const piece200 = summary.loosePieces.find(p => p.quantity === 200);
  const piece3700 = summary.loosePieces.find(p => p.quantity === 3700);
  assert(piece200 !== undefined, 'L001 updated to 200 ft');
  assert(piece3700 !== undefined, 'L002 untouched at 3,700 ft');
  assertEquals(summary.totalFootage, 43900, 'Total stock is 43,900 ft');
  console.log('');

  // --------------------------------------------------------------------------
  console.log('TEST 5: Multi-Roll Packaging & Complete Roll Sale');
  console.log('(Selling full roll directly deducts intact roll with 0 loose pieces)');
  // --------------------------------------------------------------------------
  // Receive 3 rolls of 3,280 ft
  cutToLengthService.receiveFullRolls({
    productId,
    warehouseId,
    count: 3,
    rollSize: 3280,
    packagingName: 'Roll (3,280 ft)',
    unit: 'ft',
    referenceDocId: 'PO-TEST-002'
  });

  summary = cutToLengthService.getSummary(productId, warehouseId);
  assertEquals(summary.fullRollsCount, 11, 'Full rolls count is now 11 (8x 5,000 ft + 3x 3,280 ft)');
  const rolls3280 = summary.rollsBySize.find(s => s.rollSize === 3280);
  assertEquals(rolls3280.count, 3, '3 rolls of 3,280 ft recorded');

  // Sell 1 full roll of 3,280 ft
  plan = cutToLengthService.planAllocation({
    productId,
    warehouseId,
    requestedQty: 1,
    unit: 'Roll (3,280 ft)'
  });

  assertEquals(plan.canFulfill, true, 'Plan can fulfill full roll sale');
  assertEquals(plan.type, 'FULL_ROLL_SALE', 'Plan type is FULL_ROLL_SALE');
  assertEquals(plan.rollsToDeduct.length, 1, 'Deducts exactly 1 roll');
  assertEquals(plan.rollsToDeduct[0].length, 3280, 'Roll length is 3,280 ft');

  // Commit sale
  cutToLengthService.commitAllocation(plan, {
    referenceDocType: 'invoice',
    referenceDocId: 'INV-TEST-004',
    userId: 'test-user'
  });

  summary = cutToLengthService.getSummary(productId, warehouseId);
  assertEquals(summary.fullRollsCount, 10, 'Full rolls decreased to 10');
  const rolls3280After = summary.rollsBySize.find(s => s.rollSize === 3280);
  assertEquals(rolls3280After.count, 2, '2 rolls of 3,280 ft remain');
  assertEquals(summary.loosePiecesCount, 2, 'Loose pieces count completely unchanged (no loose pieces created)');
  console.log('');

  // --------------------------------------------------------------------------
  console.log('TEST 6: Invoice Void / Stock Restoration');
  // --------------------------------------------------------------------------
  const rollbackSuccess = cutToLengthService.rollbackAllocation('invoice', 'INV-TEST-004', 'test-user');
  assertEquals(rollbackSuccess, true, 'Rollback succeeded');

  summary = cutToLengthService.getSummary(productId, warehouseId);
  assertEquals(summary.fullRollsCount, 11, 'Restored full roll back to 11 full rolls');
  const rolls3280Restored = summary.rollsBySize.find(s => s.rollSize === 3280);
  assertEquals(rolls3280Restored.count, 3, 'All 3 rolls of 3,280 ft restored to available');
  console.log('');

  // --------------------------------------------------------------------------
  console.log('TEST 7: Non-Cut-To-Length Product Isolation');
  // --------------------------------------------------------------------------
  const normalProd = productService.getProductById('prod-1'); // Feed Pan
  assertEquals(Boolean(normalProd.cut_to_length), false, 'Normal product has cut_to_length = false');
  
  const ctlUnitsForNormal = cutToLengthService.getUnits('prod-1');
  assertEquals(ctlUnitsForNormal.length, 0, 'Zero cut-to-length units exist for normal product');
  console.log('');

  // --------------------------------------------------------------------------
  console.log('TEST 8: Auger 45mm Multi-Unit Verification (400 ft & 450 ft)');
  // --------------------------------------------------------------------------
  const augerProd = productService.getProductById('prod-9');
  assert(augerProd !== undefined, 'Auger 45mm product exists');
  assertEquals(Boolean(augerProd.cut_to_length), true, 'Auger has cut_to_length = true');
  assert(augerProd.packagingUnits.some(p => p.factor === 450), 'Has 450 ft roll packaging');
  assert(augerProd.packagingUnits.some(p => p.factor === 400), 'Has 400 ft roll packaging');

  const augerSummary = cutToLengthService.getSummary('prod-9', 'wh-1');
  assertEquals(augerSummary.fullRollsCount, 8, 'Auger has 8 full rolls (5x 450 ft + 3x 400 ft)');
  assertEquals(augerSummary.loosePiecesCount, 1, 'Auger has 1 loose piece (250 ft)');
  assertEquals(augerSummary.totalFootage, 3700, 'Auger total continuous stock is 3,700 ft');
  console.log('');

  console.log('===============================================================');
  console.log(`🎉 ALL TESTS COMPLETED: ${passedTests} PASSED, ${failedTests} FAILED`);
  console.log('===============================================================');
}

runTests().catch(err => {
  console.error('\n❌ TEST RUN ABORTED WITH ERROR:\n', err);
  process.exit(1);
});
