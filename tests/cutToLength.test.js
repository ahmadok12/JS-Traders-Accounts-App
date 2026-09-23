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
  console.log('TEST 8: Auger 45mm Separate Variant Inventory (400 ft & 450 ft)');
  // --------------------------------------------------------------------------
  const augerProd = productService.getProductById('prod-9');
  assert(augerProd !== undefined, 'Auger 45mm product exists');
  assertEquals(Boolean(augerProd.cut_to_length), true, 'Auger has cut_to_length = true');

  const augerVariants = productService.getVariantsByProduct('prod-9');
  assertEquals(augerVariants.length, 2, 'Auger has 2 separate variants configured');
  assert(augerVariants.some(v => v.id === 'var-9-450' && v.rollSize === 450), 'Has var-9-450 (450 ft Roll variant)');
  assert(augerVariants.some(v => v.id === 'var-9-400' && v.rollSize === 400), 'Has var-9-400 (400 ft Roll variant)');

  // Overall product summary
  const overallSummary = cutToLengthService.getSummary('prod-9', 'wh-1');
  assertEquals(overallSummary.fullRollsCount, 8, 'Overall Auger has 8 full rolls (5x 450 ft + 3x 400 ft)');
  assertEquals(overallSummary.loosePiecesCount, 1, 'Overall Auger has 1 loose piece (250 ft)');
  assertEquals(overallSummary.totalFootage, 3700, 'Overall continuous stock is 3,700 ft');

  // Variant 450ft isolated summary
  const summary450 = cutToLengthService.getSummary('prod-9', 'wh-1', 'var-9-450');
  assertEquals(summary450.fullRollsCount, 5, '450 ft variant has 5 full rolls');
  assertEquals(summary450.loosePiecesCount, 1, '450 ft variant has 1 loose piece (250 ft)');
  assertEquals(summary450.totalFootage, 2500, '450 ft variant total stock is 2,500 ft (5x450 + 250)');

  // Variant 400ft isolated summary
  const summary400 = cutToLengthService.getSummary('prod-9', 'wh-1', 'var-9-400');
  assertEquals(summary400.fullRollsCount, 3, '400 ft variant has 3 full rolls');
  assertEquals(summary400.loosePiecesCount, 0, '400 ft variant has 0 loose pieces initially');
  assertEquals(summary400.totalFootage, 1200, '400 ft variant total stock is 1,200 ft (3x400)');
  console.log('');

  // --------------------------------------------------------------------------
  console.log('TEST 8B: Insufficient Loose Cut -> Open Roll & Keep 2 Loose Pieces');
  console.log('(Loose piece is 250 ft; Customer requests 300 ft. Must cut 450ft roll -> leaves 2 loose pcs: 250 ft + 150 ft)');
  // --------------------------------------------------------------------------
  const plan300 = cutToLengthService.planAllocation({
    productId: 'prod-9',
    variantId: 'var-9-450',
    warehouseId: 'wh-1',
    requestedQty: 300,
    unit: 'ft',
    allowMultiPieces: false
  });

  assertEquals(plan300.canFulfill, true, 'Can fulfill 300 ft continuous cut');
  assertEquals(plan300.type, 'OPEN_FULL_ROLL_CUT', 'Opens a full roll because existing loose piece (250 ft) < requested (300 ft)');
  assertEquals(plan300.sourceUnit.cutLength, 300, 'Cuts exactly 300 ft from the full roll');
  assertEquals(plan300.newLoosePiece.remainingLength, 150, 'New loose piece remainder is 150 ft (450 - 300)');

  // Commit this allocation
  cutToLengthService.commitAllocation(plan300, {
    referenceDocType: 'salesInvoice',
    referenceDocId: 'INV-TEST-300',
    notes: 'Cut 300 ft for Poultry Shed line'
  });

  // Check 450ft variant summary: should now have 2 loose pieces!
  const afterCut450 = cutToLengthService.getSummary('prod-9', 'wh-1', 'var-9-450');
  assertEquals(afterCut450.fullRollsCount, 4, '450 ft variant full rolls reduced from 5 to 4');
  assertEquals(afterCut450.loosePiecesCount, 2, 'System successfully has 2 loose pieces now (250 ft and 150 ft)!');
  assertEquals(afterCut450.loosePiecesFootage, 400, 'Loose footage is 400 ft (250 ft + 150 ft)');
  assertEquals(afterCut450.totalFootage, 2200, '450 ft variant total stock is 2,200 ft (2,500 - 300)');

  // Verify that 400ft variant was completely untouched
  const afterCut400 = cutToLengthService.getSummary('prod-9', 'wh-1', 'var-9-400');
  assertEquals(afterCut400.fullRollsCount, 3, '400 ft variant full rolls untouched at 3');
  assertEquals(afterCut400.loosePiecesCount, 0, '400 ft variant loose pieces untouched at 0');
  assertEquals(afterCut400.totalFootage, 1200, '400 ft variant footage untouched at 1,200 ft');

  // Verify stockBalances were updated accurately
  const stockBalances = storageService.getCollection('stockBalances') || [];
  const bal450 = stockBalances.find(b => b.warehouseId === 'wh-1' && b.variantId === 'var-9-450');
  const bal400 = stockBalances.find(b => b.warehouseId === 'wh-1' && b.variantId === 'var-9-400');
  assertEquals(bal450?.quantity, 2200, 'stockBalances entry for var-9-450 updated to 2,200 FT');
  assertEquals(bal400?.quantity, 1200, 'stockBalances entry for var-9-400 intact at 1,200 FT');
  console.log('');

  // --------------------------------------------------------------------------
  console.log('TEST 9: Gatepass Outward with Full Roll & Loose Cut Integration');
  console.log('(Verify Gatepass dispatches full rolls, cuts loose continuous ft, and notifies staff)');
  // --------------------------------------------------------------------------
  const initialWireSummary = cutToLengthService.getSummary('prod-4', 'wh-1');
  const initialAuger400Summary = cutToLengthService.getSummary('prod-9', 'wh-1', 'var-9-400');

  // Create Gatepass Outward
  const gp = gatepassService.createGatepass({
    customerName: 'Fatima Poultry Farm',
    assignedStaffIds: ['user-wh-alitoor'],
    vehicleNumber: 'LHR-8821',
    driverName: 'Muhammad Akram',
    lines: [
      {
        variantId: 'var-5', // 3mm Steel Wire
        warehouseQty: 1,
        officeQty: 0,
        unit: 'Roll (5,000 ft)',
        packagingName: 'Roll (5,000 ft)',
        isRoll: true,
        rollSize: 5000,
        totalFeet: 5000
      },
      {
        variantId: 'var-9-400', // Auger 45mm 400ft variant
        warehouseQty: 600,
        officeQty: 0,
        unit: 'ft',
        packagingName: 'ft',
        isRoll: false,
        rollSize: 1,
        totalFeet: 600
      }
    ],
    notes: 'Urgent shed installation dispatch'
  });

  assert(gp !== null, 'Gatepass created successfully');
  assertEquals(gp.lines.length, 2, 'Gatepass has 2 line items');
  assertEquals(gp.lines[0].isRoll, true, 'Line 1 is flagged as intact roll');
  assertEquals(gp.lines[1].unit, 'ft', 'Line 2 is loose ft cut');

  // Verify staff notification format
  const notifs = storageService.getCollection('staffNotifications') || [];
  const staffNotif = notifs.find(n => n.gatepassId === gp.id && n.staffId === 'user-wh-alitoor');
  assert(staffNotif !== undefined, 'Staff notification generated for Ali Toor');
  assert(staffNotif.message.includes('Roll (5,000 ft)'), 'Staff notification contains roll packaging name');
  assert(staffNotif.message.includes('[Loose Cut]'), 'Staff notification clearly flags loose cut');

  // Approve Gatepass
  gatepassService.approveGatepass(gp.id, 'user-wh-mgr');

  // Verify physical stock deduction
  const afterWireSummary = cutToLengthService.getSummary('prod-4', 'wh-1');
  const afterAuger400Summary = cutToLengthService.getSummary('prod-9', 'wh-1', 'var-9-400');

  assertEquals(afterWireSummary.fullRollsCount, initialWireSummary.fullRollsCount - 1, 'Full roll deducted intact (count - 1)');
  assertEquals(afterWireSummary.loosePiecesCount, initialWireSummary.loosePiecesCount, 'Loose pieces count unchanged for full roll dispatch');
  assertEquals(afterWireSummary.totalFootage, initialWireSummary.totalFootage - 5000, 'Total wire footage reduced by 5,000 ft');

  assertEquals(afterAuger400Summary.totalFootage, initialAuger400Summary.totalFootage - 600, 'Total auger 400ft footage reduced by 600 ft');

  // Void Gatepass & test rollback
  gatepassService.voidGatepass(gp.id, 'user-wh-mgr');

  const restoredWireSummary = cutToLengthService.getSummary('prod-4', 'wh-1');
  const restoredAuger400Summary = cutToLengthService.getSummary('prod-9', 'wh-1', 'var-9-400');

  assertEquals(restoredWireSummary.totalFootage, initialWireSummary.totalFootage, 'Wire footage 100% restored on gatepass void');
  assertEquals(restoredAuger400Summary.totalFootage, initialAuger400Summary.totalFootage, 'Auger 400ft footage 100% restored on gatepass void');
  console.log('');

  console.log('===============================================================');
  console.log(`🎉 ALL TESTS COMPLETED: ${passedTests} PASSED, ${failedTests} FAILED`);
  console.log('===============================================================');
}

runTests().catch(err => {
  console.error('\n❌ TEST RUN ABORTED WITH ERROR:\n', err);
  process.exit(1);
});
