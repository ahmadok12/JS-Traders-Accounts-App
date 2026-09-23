import { storageService } from '../services/storageService.js';
import { salesService } from '../services/salesService.js';
import { inwardOrderService } from '../services/inwardOrderService.js';
import { gatepassService } from '../services/gatepassService.js';
import { inventoryService } from '../services/inventoryService.js';
import { purchasingService } from '../services/purchasingService.js';

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
  console.log('=== TEST SUITE: WAREHOUSE STOCK FLOW & SHIPMENT FILTERING ===\n');

  // Initialize storage with fresh mock or existing memory
  storageService.init();

  // -------------------------------------------------------------
  // TEST 1: Voided / Cancelled Shipment Tracking Filter
  // -------------------------------------------------------------
  console.log('Test 1: Voided / Cancelled Shipments Excluded from Tracking');
  const testShipment = purchasingService.createImportShipment({
    containerNumber: 'TESTVOID999',
    carrierName: 'Test Line',
    originPort: 'Shanghai',
    destinationPort: 'Karachi'
  });
  assert(testShipment.status === 'Shipped', 'Created shipment starts with Shipped status');

  purchasingService.cancelImportShipment(testShipment.id);
  const updatedShip = purchasingService.getImportShipmentById(testShipment.id);
  assert(updatedShip.status === 'Cancelled', 'Shipment status is Cancelled after cancellation');

  const allShipments = purchasingService.getImportShipments();
  const activeShipments = allShipments.filter(s => s && s.status !== 'Cancelled' && s.status !== 'Voided');
  assert(!activeShipments.some(s => s.id === testShipment.id), 'Cancelled shipment is filtered out of active tracking list');
  console.log('');

  // -------------------------------------------------------------
  // TEST 2: Outgoing Flow - Sales Order -> Partial GDNs -> Physical Stock Out
  // -------------------------------------------------------------
  console.log('Test 2: Outgoing Stock Workflow (Sales Order -> Partial GDNs)');
  const testVariantId = 'var-1'; // Feed Pan
  const initialStock = inventoryService.getBalance('wh-1', testVariantId);
  console.log(`  Initial stock of ${testVariantId} in wh-1: ${initialStock}`);

  // Create Sales Order for 50 units (Must NOT move physical stock)
  const so = salesService.createSalesOrder({
    customerPartyId: 'pty-1',
    lines: [
      { variantId: testVariantId, orderedQty: 50, unitPrice: 1450 }
    ],
    notes: 'Test Automated Outgoing Flow'
  });
  assert(so.id && so.orderNumber, `Sales Order created: ${so.orderNumber}`);
  assert(so.status === 'Confirmed', 'Sales Order initial status is Confirmed');
  assert(so.lines[0].orderedQty === 50, 'Ordered qty is 50');
  assert(so.lines[0].deliveredQty === 0, 'Delivered qty starts at 0');

  // Verify physical stock has NOT changed
  const stockAfterSO = inventoryService.getBalance('wh-1', testVariantId);
  assert(stockAfterSO === initialStock, 'Physical stock unchanged by Sales Order creation');

  // Check remaining delivery lines
  let remainingSO = salesService.getRemainingDeliveryLines(so.id);
  assert(remainingSO.length === 1 && remainingSO[0].remainingDeliveryQty === 50, 'Remaining delivery qty is 50');

  // Create Partial GDN 1 for 20 units
  const gdn1 = gatepassService.createGDNFromSalesOrder(so.id, {
    warehouseId: 'wh-1',
    lines: [{ variantId: testVariantId, warehouseQty: 20, officeQty: 0, quantity: 20, unit: 'PCS' }],
    vehicleNumber: 'TRK-001',
    driverName: 'Driver 1'
  });
  assert(gdn1.id && gdn1.gatepassNumber, `Partial GDN 1 created: ${gdn1.gatepassNumber}`);
  assert(gdn1.status.includes('Draft'), 'GDN 1 starts in Draft state');

  // Before approval, stock is still intact
  assert(inventoryService.getBalance('wh-1', testVariantId) === initialStock, 'Stock unchanged before GDN 1 approval');

  // Approve GDN 1 -> Physical stock must decrease by 20, Sales Order deliveredQty -> 20
  gatepassService.approveGatepass(gdn1.id, 'user-wh-mgr');
  const stockAfterGDN1 = inventoryService.getBalance('wh-1', testVariantId);
  assert(stockAfterGDN1 === initialStock - 20, `Physical stock decreased by 20 (now ${stockAfterGDN1})`);

  const updatedSO1 = salesService.getSalesOrderById(so.id);
  assert(updatedSO1.lines[0].deliveredQty === 20, 'Sales Order deliveredQty updated to 20');
  assert(updatedSO1.status === 'Partially Delivered', 'Sales Order status is now Partially Delivered');

  // Remaining should now be 30
  remainingSO = salesService.getRemainingDeliveryLines(so.id);
  assert(remainingSO[0].remainingDeliveryQty === 30, 'Remaining delivery qty is now 30');

  // Create Partial GDN 2 for remaining 30 units
  const gdn2 = gatepassService.createGDNFromSalesOrder(so.id, {
    warehouseId: 'wh-1',
    vehicleNumber: 'TRK-002',
    driverName: 'Driver 2'
  });
  assert(gdn2.lines[0].quantity === 30, 'GDN 2 automatically picks up remaining 30 units');

  // Approve GDN 2 -> Stock decreases by another 30, Sales Order -> Fully Delivered
  gatepassService.approveGatepass(gdn2.id, 'user-wh-mgr');
  const stockAfterGDN2 = inventoryService.getBalance('wh-1', testVariantId);
  assert(stockAfterGDN2 === initialStock - 50, `Physical stock decreased by total 50 (now ${stockAfterGDN2})`);

  const updatedSO2 = salesService.getSalesOrderById(so.id);
  assert(updatedSO2.lines[0].deliveredQty === 50, 'Sales Order deliveredQty is 50');
  assert(updatedSO2.status === 'Fully Delivered', 'Sales Order status is now Fully Delivered');

  // Remaining delivery lines should now be empty
  remainingSO = salesService.getRemainingDeliveryLines(so.id);
  assert(remainingSO.length === 0, 'No remaining delivery lines left on Sales Order');

  // Test Voiding GDN 2 -> Stock restored by 30, Sales Order reverted to Partially Delivered
  gatepassService.voidGatepass(gdn2.id, 'user-wh-mgr');
  const stockAfterVoid = inventoryService.getBalance('wh-1', testVariantId);
  assert(stockAfterVoid === initialStock - 20, `Physical stock restored on GDN 2 void (now ${stockAfterVoid})`);

  const updatedSO3 = salesService.getSalesOrderById(so.id);
  assert(updatedSO3.lines[0].deliveredQty === 20, 'Sales Order deliveredQty rolled back to 20');
  assert(updatedSO3.status === 'Partially Delivered', 'Sales Order status rolled back to Partially Delivered');
  console.log('');

  // -------------------------------------------------------------
  // TEST 3: Incoming Flow - Stock Inward Order -> Partial GRNs -> Physical Stock In
  // -------------------------------------------------------------
  console.log('Test 3: Incoming Stock Workflow (Stock Inward Order -> Partial GRNs)');
  const testVariantInId = 'var-2'; // Drinking Nipple
  const initialStockIn = inventoryService.getBalance('wh-1', testVariantInId);
  console.log(`  Initial stock of ${testVariantInId} in wh-1: ${initialStockIn}`);

  // Create Stock Inward Order for 100 units (Must NOT increase physical stock)
  const sio = inwardOrderService.createInwardOrder({
    partyName: 'Global Agro Parts Ltd',
    referenceNumber: 'REF-EXP-900',
    targetWarehouseId: 'wh-1',
    lines: [
      { variantId: testVariantInId, expectedQty: 100, unit: 'PCS' }
    ],
    notes: 'Test Automated Incoming Flow'
  });
  assert(sio.id && sio.orderNumber, `Stock Inward Order created: ${sio.orderNumber}`);
  assert(sio.status === 'Confirmed', 'Stock Inward Order initial status is Confirmed');
  assert(sio.lines[0].expectedQty === 100, 'Expected qty is 100');
  assert(sio.lines[0].receivedQty === 0, 'Received qty starts at 0');

  // Verify physical stock has NOT changed
  const stockAfterSIO = inventoryService.getBalance('wh-1', testVariantInId);
  assert(stockAfterSIO === initialStockIn, 'Physical stock unchanged by Stock Inward Order creation');

  // Check remaining expected lines
  let remainingSIO = inwardOrderService.getRemainingExpectedLines(sio.id);
  assert(remainingSIO.length === 1 && remainingSIO[0].remainingQty === 100, 'Remaining expected qty is 100');

  // Create Partial GRN 1 for 40 units
  const grn1 = gatepassService.createGRNFromInwardOrder(sio.id, {
    warehouseId: 'wh-1',
    lines: [{ variantId: testVariantInId, warehouseQty: 40, officeQty: 0, quantity: 40, unit: 'PCS' }],
    vehicleNumber: 'INW-TRK-1',
    driverName: 'Inward Driver 1'
  });
  assert(grn1.id && grn1.gatepassNumber, `Partial GRN 1 created: ${grn1.gatepassNumber}`);
  assert(grn1.gatepassType === 'inward', 'Gatepass type is inward');
  assert(grn1.status === 'Draft', 'GRN starts in Draft state');

  // Stock before approval unchanged
  assert(inventoryService.getBalance('wh-1', testVariantInId) === initialStockIn, 'Stock unchanged before GRN 1 approval');

  // Approve GRN 1 -> Physical stock increases by 40, SIO receivedQty -> 40
  gatepassService.approveGatepass(grn1.id, 'user-wh-mgr');
  const stockAfterGRN1 = inventoryService.getBalance('wh-1', testVariantInId);
  assert(stockAfterGRN1 === initialStockIn + 40, `Physical stock increased by 40 (now ${stockAfterGRN1})`);

  const updatedSIO1 = inwardOrderService.getInwardOrderById(sio.id);
  assert(updatedSIO1.lines[0].receivedQty === 40, 'Inward Order receivedQty updated to 40');
  assert(updatedSIO1.status === 'Partially Received', 'Inward Order status is now Partially Received');

  // Remaining should now be 60
  remainingSIO = inwardOrderService.getRemainingExpectedLines(sio.id);
  assert(remainingSIO[0].remainingQty === 60, 'Remaining expected qty is now 60');

  // Create Partial GRN 2 for remaining 60 units
  const grn2 = gatepassService.createGRNFromInwardOrder(sio.id, {
    warehouseId: 'wh-1',
    vehicleNumber: 'INW-TRK-2',
    driverName: 'Inward Driver 2'
  });
  assert(grn2.lines[0].quantity === 60, 'GRN 2 automatically picks up remaining 60 units');

  // Approve GRN 2 -> Stock increases by another 60, SIO -> Fully Received
  gatepassService.approveGatepass(grn2.id, 'user-wh-mgr');
  const stockAfterGRN2 = inventoryService.getBalance('wh-1', testVariantInId);
  assert(stockAfterGRN2 === initialStockIn + 100, `Physical stock increased by total 100 (now ${stockAfterGRN2})`);

  const updatedSIO2 = inwardOrderService.getInwardOrderById(sio.id);
  assert(updatedSIO2.lines[0].receivedQty === 100, 'Inward Order receivedQty is 100');
  assert(updatedSIO2.status === 'Fully Received', 'Inward Order status is now Fully Received');

  // Remaining expected lines should now be empty
  remainingSIO = inwardOrderService.getRemainingExpectedLines(sio.id);
  assert(remainingSIO.length === 0, 'No remaining expected lines left on Inward Order');

  // Test Voiding GRN 2 -> Stock reversed by 60, Inward Order reverted to Partially Received
  gatepassService.voidGatepass(grn2.id, 'user-wh-mgr');
  const stockAfterVoidGRN = inventoryService.getBalance('wh-1', testVariantInId);
  assert(stockAfterVoidGRN === initialStockIn + 40, `Physical stock deducted on GRN 2 void (now ${stockAfterVoidGRN})`);

  const updatedSIO3 = inwardOrderService.getInwardOrderById(sio.id);
  assert(updatedSIO3.lines[0].receivedQty === 40, 'Inward Order receivedQty rolled back to 40');
  assert(updatedSIO3.status === 'Partially Received', 'Inward Order status rolled back to Partially Received');
  console.log('');

  // -------------------------------------------------------------
  // SUMMARY
  // -------------------------------------------------------------
  console.log(`========================================`);
  console.log(`Total tests passed: ${passed}`);
  console.log(`Total tests failed: ${failed}`);
  console.log(`========================================`);

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error('Test run failed with error:', err);
  process.exit(1);
});
