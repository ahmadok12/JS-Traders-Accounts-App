import { storageService } from '../services/storageService.js';
import { inventoryService } from '../services/inventoryService.js';
import { renderStockAdjustmentsView } from '../modules/inventory/stockAdjustmentsView.js';

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  ✓ PASS: ${message}`);
    passed++;
  } else {
    console.error(`  ✗ FAIL: ${message}`);
    failed++;
  }
}

async function runTests() {
  console.log('=== TEST SUITE: STOCK ADJUSTMENT DUAL-MODE & REDESIGN ===\n');

  storageService.init();

  const testWarehouseId = 'wh-1';
  const testVariantId = 'var-1';

  // -------------------------------------------------------------
  // TEST 1: Mode 1 - Increase Quantity (+25 pcs)
  // -------------------------------------------------------------
  console.log('Test 1: Stock Adjustment via Delta Increase (+25 pcs)');
  const initialStock1 = inventoryService.getBalance(testWarehouseId, testVariantId);
  console.log(`  Initial stock for ${testVariantId}: ${initialStock1}`);

  const adj1 = inventoryService.createStockAdjustment({
    type: 'reconciliation',
    warehouseId: testWarehouseId,
    reason: 'Surplus items found in aisle 4',
    lines: [
      {
        variantId: testVariantId,
        currentStock: initialStock1,
        newStock: initialStock1 + 25,
        quantity: 25, // Delta mode: +25
        unit: 'PCS',
        mode: 'delta'
      }
    ],
    userId: 'test-auditor'
  });

  assert(adj1 !== null && adj1.adjustmentNumber.startsWith('ADJ-'), 'Adjustment document created with ADJ- number');
  assert(adj1.type === 'increase', 'Adjustment automatically classified as "increase"');
  assert(adj1.status === 'Confirmed', 'Adjustment status is Confirmed');

  const stockAfterAdj1 = inventoryService.getBalance(testWarehouseId, testVariantId);
  assert(stockAfterAdj1 === initialStock1 + 25, `Stock balance increased by 25: before=${initialStock1}, after=${stockAfterAdj1}`);

  // -------------------------------------------------------------
  // TEST 2: Mode 1 - Decrease Quantity (-30 pcs)
  // -------------------------------------------------------------
  console.log('\nTest 2: Stock Adjustment via Delta Decrease (-30 pcs)');
  const initialStock2 = inventoryService.getBalance(testWarehouseId, testVariantId);

  const adj2 = inventoryService.createStockAdjustment({
    type: 'reconciliation',
    warehouseId: testWarehouseId,
    reason: 'Damaged packaging write-off',
    lines: [
      {
        variantId: testVariantId,
        currentStock: initialStock2,
        newStock: initialStock2 - 30,
        quantity: -30, // Delta mode: -30
        unit: 'PCS',
        mode: 'delta'
      }
    ],
    userId: 'test-auditor'
  });

  assert(adj2.type === 'decrease', 'Adjustment automatically classified as "decrease"');
  const stockAfterAdj2 = inventoryService.getBalance(testWarehouseId, testVariantId);
  assert(stockAfterAdj2 === initialStock2 - 30, `Stock balance decreased by 30: before=${initialStock2}, after=${stockAfterAdj2}`);

  // -------------------------------------------------------------
  // TEST 3: Mode 2 - Specify Final Quantity (e.g. Current 213 -> New 250)
  // -------------------------------------------------------------
  console.log('\nTest 3: Stock Adjustment via Final Count (Target Final Stock)');
  // Set an exact starting balance for demonstration:
  const targetCurrent = 213;
  const targetNew = 250;
  const computedDelta = targetNew - targetCurrent; // +37

  // Force seed balance to 213 for clear testing
  let balances = storageService.getCollection('stockBalances');
  let balEntry = balances.find(b => b.warehouseId === testWarehouseId && b.variantId === 'var-2');
  if (balEntry) {
    storageService.update('stockBalances', balEntry.id, { quantity: targetCurrent });
  } else {
    storageService.insert('stockBalances', {
      warehouseId: testWarehouseId,
      variantId: 'var-2',
      quantity: targetCurrent,
      unit: 'PCS'
    });
  }

  assert(inventoryService.getBalance(testWarehouseId, 'var-2') === 213, 'Setup: Current stock is exactly 213 PCS');

  // User enters new final stock 250. System calculates delta = 250 - 213 = +37
  const adj3 = inventoryService.createStockAdjustment({
    type: 'reconciliation',
    warehouseId: testWarehouseId,
    reason: 'Annual comprehensive physical inventory count',
    lines: [
      {
        variantId: 'var-2',
        currentStock: targetCurrent,
        newStock: targetNew,
        quantity: computedDelta, // +37 pcs
        unit: 'PCS',
        mode: 'final'
      }
    ],
    userId: 'test-auditor'
  });

  assert(adj3.lines[0].quantity === 37, 'Computed delta is exactly +37 PCS');
  assert(adj3.lines[0].newStock === 250, 'Recorded target newStock is 250 PCS');
  const stockAfterAdj3 = inventoryService.getBalance(testWarehouseId, 'var-2');
  assert(stockAfterAdj3 === 250, `Physical stock after adjustment is exactly 250 PCS (was ${targetCurrent})`);

  // -------------------------------------------------------------
  // TEST 4: Mode 2 - Specify Final Quantity Lower (e.g. Current 250 -> New 190)
  // -------------------------------------------------------------
  console.log('\nTest 4: Stock Adjustment via Final Count (Lower Count)');
  const targetCurrent4 = 250;
  const targetNew4 = 190;
  const computedDelta4 = targetNew4 - targetCurrent4; // -60

  const adj4 = inventoryService.createStockAdjustment({
    type: 'reconciliation',
    warehouseId: testWarehouseId,
    reason: 'Missing items adjustment',
    lines: [
      {
        variantId: 'var-2',
        currentStock: targetCurrent4,
        newStock: targetNew4,
        quantity: computedDelta4, // -60 pcs
        unit: 'PCS',
        mode: 'final'
      }
    ],
    userId: 'test-auditor'
  });

  assert(adj4.lines[0].quantity === -60, 'Computed delta is exactly -60 PCS');
  const stockAfterAdj4 = inventoryService.getBalance(testWarehouseId, 'var-2');
  assert(stockAfterAdj4 === 190, `Physical stock after adjustment is exactly 190 PCS (was ${targetCurrent4})`);

  // -------------------------------------------------------------
  // TEST 5: Multi-Line Mixed Adjustment (Increase + Decrease together)
  // -------------------------------------------------------------
  console.log('\nTest 5: Multi-line Mixed Adjustment in Single Document');
  const curBalVar1 = inventoryService.getBalance(testWarehouseId, 'var-1');
  const curBalVar2 = inventoryService.getBalance(testWarehouseId, 'var-2');

  const adj5 = inventoryService.createStockAdjustment({
    type: 'reconciliation',
    warehouseId: testWarehouseId,
    reason: 'Monthly cycle count reconciliation',
    lines: [
      {
        variantId: 'var-1',
        currentStock: curBalVar1,
        newStock: curBalVar1 + 15,
        quantity: 15,
        unit: 'PCS',
        mode: 'delta'
      },
      {
        variantId: 'var-2',
        currentStock: curBalVar2,
        newStock: curBalVar2 - 10,
        quantity: -10,
        unit: 'PCS',
        mode: 'delta'
      }
    ],
    userId: 'test-auditor'
  });

  assert(adj5.type === 'reconciliation', 'Mixed multi-line adjustment correctly classified as "reconciliation"');
  assert(inventoryService.getBalance(testWarehouseId, 'var-1') === curBalVar1 + 15, 'Line 1 increased by +15');
  assert(inventoryService.getBalance(testWarehouseId, 'var-2') === curBalVar2 - 10, 'Line 2 decreased by -10');

  // -------------------------------------------------------------
  // TEST 6: Zero Quantity Validation Guard
  // -------------------------------------------------------------
  console.log('\nTest 6: Zero Quantity Change Rejection');
  try {
    inventoryService.createStockAdjustment({
      type: 'reconciliation',
      warehouseId: testWarehouseId,
      reason: 'No change test',
      lines: [
        {
          variantId: 'var-1',
          currentStock: 100,
          newStock: 100,
          quantity: 0,
          unit: 'PCS',
          mode: 'delta'
        }
      ]
    });
    assert(false, 'Should have thrown error for 0 quantity adjustment');
  } catch (err) {
    assert(err.message.includes('No quantity adjustments specified'), 'Properly rejected adjustment with 0 change');
  }

  // -------------------------------------------------------------
  // TEST 7: Render View HTML Integrity
  // -------------------------------------------------------------
  console.log('\nTest 7: Stock Adjustments View HTML Rendering');
  const viewHtml = renderStockAdjustmentsView();
  assert(typeof viewHtml === 'string' && viewHtml.length > 500, `View rendered successfully (${viewHtml.length} chars)`);
  assert(viewHtml.includes('adjustments-table-container'), 'View contains adjustments table container');
  assert(viewHtml.includes('New Stock Adjustment'), 'View contains primary action button');
  assert(viewHtml.includes('Net Variance'), 'View renders Net Variance column');

  console.log(`\n========================================`);
  console.log(`SUMMARY: ${passed} PASSED, ${failed} FAILED`);
  console.log(`========================================`);

  if (failed > 0) process.exit(1);
}

runTests().catch(err => {
  console.error('Test execution failed:', err);
  process.exit(1);
});
