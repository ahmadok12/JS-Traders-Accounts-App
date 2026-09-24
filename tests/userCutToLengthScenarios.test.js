// Mock browser localStorage for Node.js environment
if (typeof globalThis.localStorage === 'undefined') {
  const store = {};
  globalThis.localStorage = {
    getItem: (k) => store[k] || null,
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
    clear: () => { Object.keys(store).forEach(k => delete store[k]); }
  };
}

import { cutToLengthService } from '../services/cutToLengthService.js';
import { storageService } from '../services/storageService.js';

let passed = 0;
let failed = 0;

function assertEquals(actual, expected, message) {
  const actStr = JSON.stringify(actual);
  const expStr = JSON.stringify(expected);
  if (actStr === expStr) {
    console.log(`  ✅ PASS: ${message} (Got: ${actStr})`);
    passed++;
  } else {
    console.error(`  ❌ FAIL: ${message}\n      Expected: ${expStr}\n      Got:      ${actStr}`);
    failed++;
    throw new Error(`Test failed: ${message}`);
  }
}

function runTests() {
  console.log('===============================================================');
  console.log('🧪 TESTING USER CUT-TO-LENGTH SCENARIOS (VARIANT LEVEL)');
  console.log('===============================================================\n');

  const variantId = 'var-test-5000';
  const warehouseId = 'wh-1';

  // INITIAL STATE: 5 rolls of 5,000 ft each, 0 loose pieces
  console.log('--- TEST 0: INITIAL STATE (5 rolls × 5,000 ft) ---');
  cutToLengthService.saveVariantStock(warehouseId, variantId, {
    fullRolls: 5,
    rollLength: 5000,
    loosePieces: [],
    unit: 'ft'
  });
  let stock = cutToLengthService.getVariantStock(warehouseId, variantId);
  assertEquals(stock.fullRolls, 5, 'Initial full rolls count is 5');
  assertEquals(stock.loosePieces, [], 'Initial loose pieces is empty');

  // SCENARIO 1: Customer asks for 4,000 ft loose
  console.log('\n--- SCENARIO 1: Order 4,000 ft loose ---');
  let plan = cutToLengthService.simulateAllocation({
    warehouseId,
    variantId,
    mode: 'loose_continuous',
    quantity: 4000
  });
  assertEquals(plan.canFulfill, true, 'Can fulfill 4,000 ft loose');
  assertEquals(plan.fullRollsAfter, 4, 'Remaining full rolls is 4');
  assertEquals(plan.loosePiecesAfter, [1000], 'Remaining loose piece is [1,000 ft]');
  
  // Commit Scenario 1
  cutToLengthService.commitAllocation(plan, { referenceDocType: 'salesOrder', referenceDocId: 'SO-001' });
  stock = cutToLengthService.getVariantStock(warehouseId, variantId);
  assertEquals(stock.fullRolls, 4, 'Committed full rolls is 4');
  assertEquals(stock.loosePieces, [1000], 'Committed loose pieces is [1000]');

  // SCENARIO 2A: Customer orders 1,500 ft loose (loose - pcs)
  console.log('\n--- SCENARIO 2A: Order 1,500 ft loose (loose - pcs) ---');
  plan = cutToLengthService.simulateAllocation({
    warehouseId,
    variantId,
    mode: 'loose_pcs',
    quantity: 1500
  });
  assertEquals(plan.canFulfill, true, 'Can fulfill 1,500 ft loose - pcs');
  assertEquals(plan.fullRollsAfter, 3, 'Remaining rolls is 3 Rolls');
  assertEquals(plan.loosePiecesAfter, [4500], 'Remaining loose is 4,500 ft loose');

  // SCENARIO 2B: Customer orders 1,500 ft loose (loose - continuous)
  console.log('\n--- SCENARIO 2B: Order 1,500 ft loose (loose - continuous) ---');
  // From 4 rolls and [1000] loose:
  plan = cutToLengthService.simulateAllocation({
    warehouseId,
    variantId,
    mode: 'loose_continuous',
    quantity: 1500
  });
  assertEquals(plan.canFulfill, true, 'Can fulfill 1,500 ft loose - continuous');
  assertEquals(plan.fullRollsAfter, 3, 'Remaining rolls is 3 Rolls');
  assertEquals(plan.loosePiecesAfter, [1000, 3500], 'Remaining loose is 1000 ft + 3500 ft');

  // Commit Scenario 2B so we have 3 rolls + [1000, 3500] for Scenario 3
  cutToLengthService.commitAllocation(plan, { referenceDocType: 'salesOrder', referenceDocId: 'SO-002' });
  stock = cutToLengthService.getVariantStock(warehouseId, variantId);
  assertEquals(stock.fullRolls, 3, 'Committed full rolls is 3');
  assertEquals(stock.loosePieces, [1000, 3500], 'Committed loose pieces is [1000, 3500]');

  // SCENARIO 3: Customer orders 500 ft
  console.log('\n--- SCENARIO 3: Order 500 ft (from 3 rolls, [1000, 3500]) ---');
  // Both loose - continuous and loose - pcs should pick smallest sufficient piece (1,000 ft)
  plan = cutToLengthService.simulateAllocation({
    warehouseId,
    variantId,
    mode: 'loose_continuous',
    quantity: 500
  });
  assertEquals(plan.canFulfill, true, 'Can fulfill 500 ft');
  assertEquals(plan.fullRollsAfter, 3, 'Remaining rolls is 3');
  assertEquals(plan.loosePiecesAfter, [500, 3500], 'Remaining loose is [500, 3500]');

  cutToLengthService.commitAllocation(plan, { referenceDocType: 'salesOrder', referenceDocId: 'SO-003' });
  stock = cutToLengthService.getVariantStock(warehouseId, variantId);
  assertEquals(stock.fullRolls, 3, 'Committed full rolls is 3');
  assertEquals(stock.loosePieces, [500, 3500], 'Committed loose pieces is [500, 3500]');

  // SCENARIO 4A: Customer orders 4,500 ft (loose - pcs)
  console.log('\n--- SCENARIO 4A: Order 4,500 ft (loose - pcs from 3 rolls, [500, 3500]) ---');
  plan = cutToLengthService.simulateAllocation({
    warehouseId,
    variantId,
    mode: 'loose_pcs',
    quantity: 4500
  });
  assertEquals(plan.canFulfill, true, 'Can fulfill 4,500 ft loose - pcs');
  // Consumes 500 + 3500 = 4000. Deficit = 500. Takes 500 from 1 new roll.
  // Remaining rolls = 2, remainder from new roll = 4500.
  assertEquals(plan.fullRollsAfter, 2, 'Remaining rolls is 2');
  assertEquals(plan.loosePiecesAfter, [4500], 'Remaining loose is 4,500 ft loose');

  // SCENARIO 4B: Customer orders 4,500 ft (loose - continuous)
  console.log('\n--- SCENARIO 4B: Order 4,500 ft (loose - continuous from 3 rolls, [500, 3500]) ---');
  plan = cutToLengthService.simulateAllocation({
    warehouseId,
    variantId,
    mode: 'loose_continuous',
    quantity: 4500
  });
  assertEquals(plan.canFulfill, true, 'Can fulfill 4,500 ft loose - continuous');
  // Neither 500 nor 3500 is >= 4500. Cuts from new roll, leaving 500 ft.
  // Existing loose [500, 3500] remain intact!
  assertEquals(plan.fullRollsAfter, 2, 'Remaining rolls is 2');
  assertEquals(plan.loosePiecesAfter, [500, 3500, 500], 'Remaining loose is [500, 3500, 500]');

  // SCENARIO 5: Complete Full Rolls Sale (Mode 1: Rolls)
  console.log('\n--- SCENARIO 5: Order 2 Full Rolls ---');
  plan = cutToLengthService.simulateAllocation({
    warehouseId,
    variantId,
    mode: 'rolls',
    quantity: 2
  });
  assertEquals(plan.canFulfill, true, 'Can fulfill 2 full rolls');
  assertEquals(plan.fullRollsAfter, 1, 'Remaining rolls is 1 (3 - 2)');
  assertEquals(plan.loosePiecesAfter, [500, 3500], 'Loose pieces untouched');
  assertEquals(plan.totalFootage, 10000, 'Total footage is 10,000 ft (2 × 5,000 ft)');

  console.log('\n===============================================================');
  console.log(`🎉 ALL USER SCENARIOS PASSED: ${passed} PASSED, ${failed} FAILED`);
  console.log('===============================================================\n');
}

runTests();
