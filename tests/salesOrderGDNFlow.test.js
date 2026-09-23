import assert from 'assert';
import { salesService } from '../services/salesService.js';
import { inwardOrderService } from '../services/inwardOrderService.js';
import { gatepassService } from '../services/gatepassService.js';
import { storageService } from '../services/storageService.js';
import { productService } from '../services/productService.js';

console.log('=== TEST SUITE: SALES ORDER (DRAFT GATEPASS) -> GDN & STOCK INWARD -> GRN ===\n');

// 1. Setup sample product
const variants = productService.getVariants();
const testVar = variants[0];
assert(testVar, 'Test variant must exist');

// TEST 1: Create Sales Order (Draft Gatepass) without rate and amount
console.log('Test 1: Create Sales Order (Draft Gatepass)');
const so = salesService.createSalesOrder({
  customerName: 'Al-Madina Poultry Farms (Faisalabad)',
  vehicleNumber: 'LES-9412 Truck',
  driverName: 'Muhammad Rasheed',
  driverPhone: '+92 345 6789012',
  assignedStaffIds: ['user-wh-alitoor'],
  notes: 'Urgent site delivery. High priority.',
  lines: [
    {
      variantId: testVar.id,
      warehouseQty: 60,
      officeQty: 40,
      orderedQty: 100,
      unit: 'PCS'
    }
  ]
});

assert(so, 'Sales order created');
assert.strictEqual(so.customerName, 'Al-Madina Poultry Farms (Faisalabad)');
assert.strictEqual(so.vehicleNumber, 'LES-9412 Truck');
assert.strictEqual(so.driverName, 'Muhammad Rasheed');
assert.strictEqual(so.status, 'Confirmed');
assert.strictEqual(so.lines[0].orderedQty, 100);
assert.strictEqual(so.lines[0].warehouseQty, 60);
assert.strictEqual(so.lines[0].officeQty, 40);
assert.strictEqual(so.lines[0].deliveredQty, 0);
assert.strictEqual(so.lines[0].pendingQty, 100);
console.log('  ✓ PASS: Sales order created with gatepass logistics metadata & dual allocation');

// TEST 2: Convert Sales Order to partial GDN 1 (40 units)
console.log('\nTest 2: Convert Sales Order to Partial GDN 1');
const gdn1 = gatepassService.createGDNFromSalesOrder(so.id, {
  warehouseId: 'wh-1',
  vehicleNumber: 'LES-9412 Truck',
  driverName: 'Muhammad Rasheed',
  lines: [
    {
      variantId: testVar.id,
      warehouseQty: 40,
      officeQty: 0,
      quantity: 40,
      unit: 'PCS'
    }
  ],
  notes: 'First delivery batch: 40 pcs'
});

assert(gdn1, 'GDN 1 created');
assert.strictEqual(gdn1.gatepassType, 'outward');
assert.strictEqual(gdn1.salesOrderId, so.id);

// Approve GDN 1
gatepassService.approveGatepass(gdn1.id, 'user-wh-mgr');

const soAfterGdn1 = salesService.getSalesOrderById(so.id);
assert.strictEqual(soAfterGdn1.lines[0].deliveredQty, 40);
assert.strictEqual(soAfterGdn1.status, 'Partially Delivered');
const remainingAfterGdn1 = salesService.getRemainingDeliveryLines(so.id);
assert.strictEqual(remainingAfterGdn1[0].remainingDeliveryQty, 60);
console.log('  ✓ PASS: Partial GDN 1 created & approved. Order deliveredQty=40, status=Partially Delivered');

// TEST 3: Convert Sales Order to partial GDN 2 (remaining 60 units)
console.log('\nTest 3: Convert Sales Order to Partial GDN 2 (Remaining 60 units)');
const gdn2 = gatepassService.createGDNFromSalesOrder(so.id, {
  warehouseId: 'wh-1',
  vehicleNumber: 'LES-9412 Truck',
  driverName: 'Muhammad Rasheed',
  lines: [
    {
      variantId: testVar.id,
      warehouseQty: 20,
      officeQty: 40,
      quantity: 60,
      unit: 'PCS'
    }
  ],
  notes: 'Final delivery batch: 60 pcs'
});

assert(gdn2, 'GDN 2 created');
gatepassService.approveGatepass(gdn2.id, 'user-wh-mgr');

const soAfterGdn2 = salesService.getSalesOrderById(so.id);
assert.strictEqual(soAfterGdn2.lines[0].deliveredQty, 100);
assert.strictEqual(soAfterGdn2.status, 'Fully Delivered');

const remainingAfterGdn2 = salesService.getRemainingDeliveryLines(so.id);
assert.strictEqual(remainingAfterGdn2.length, 0);

const linkedGDNs = gatepassService.getGDNsBySalesOrder(so.id);
assert.strictEqual(linkedGDNs.length, 2);
console.log('  ✓ PASS: Multiple GDNs (2) successfully belong to 1 Sales Order. Order fully delivered.');

// TEST 4: Create Stock Inwards (Draft GRN)
console.log('\nTest 4: Create Stock Inwards (Draft GRN)');
const sio = inwardOrderService.createInwardOrder({
  partyName: 'Qingdao Jinhe Poultry Machinery Co.',
  vehicleNumber: 'LES-4029 Truck',
  driverName: 'Tariq Mehmood',
  driverPhone: '+92 300 9876543',
  assignedStaffIds: ['user-wh-alitoor'],
  notes: 'Import shipment batch inspection.',
  lines: [
    {
      variantId: testVar.id,
      warehouseQty: 50,
      officeQty: 50,
      expectedQty: 100,
      unit: 'PCS'
    }
  ]
});

assert(sio, 'Stock Inward created');
assert.strictEqual(sio.partyName, 'Qingdao Jinhe Poultry Machinery Co.');
assert.strictEqual(sio.vehicleNumber, 'LES-4029 Truck');
assert.strictEqual(sio.status, 'Confirmed');
assert.strictEqual(sio.lines[0].expectedQty, 100);
assert.strictEqual(sio.lines[0].receivedQty, 0);
assert.strictEqual(sio.lines[0].remainingQty, 100);
console.log('  ✓ PASS: Stock Inward created with reversed allocation & demand tracking');

// TEST 5: Convert Stock Inwards to partial GRN 1 (30 units) and GRN 2 (70 units)
console.log('\nTest 5: Convert Stock Inwards to Multiple GRNs');
const grn1 = gatepassService.createGRNFromInwardOrder(sio.id, {
  warehouseId: 'wh-1',
  vehicleNumber: 'LES-4029 Truck',
  driverName: 'Tariq Mehmood',
  lines: [
    {
      variantId: testVar.id,
      warehouseQty: 30,
      officeQty: 0,
      quantity: 30,
      unit: 'PCS'
    }
  ]
});
assert.strictEqual(grn1.gatepassType, 'inward');
gatepassService.approveGatepass(grn1.id, 'user-wh-mgr');

const sioAfterGrn1 = inwardOrderService.getInwardOrderById(sio.id);
assert.strictEqual(sioAfterGrn1.lines[0].receivedQty, 30);
assert.strictEqual(sioAfterGrn1.status, 'Partially Received');

const grn2 = gatepassService.createGRNFromInwardOrder(sio.id, {
  warehouseId: 'wh-1',
  vehicleNumber: 'LES-4029 Truck',
  driverName: 'Tariq Mehmood',
  lines: [
    {
      variantId: testVar.id,
      warehouseQty: 20,
      officeQty: 50,
      quantity: 70,
      unit: 'PCS'
    }
  ]
});
gatepassService.approveGatepass(grn2.id, 'user-wh-mgr');

const sioAfterGrn2 = inwardOrderService.getInwardOrderById(sio.id);
assert.strictEqual(sioAfterGrn2.lines[0].receivedQty, 100);
assert.strictEqual(sioAfterGrn2.status, 'Fully Received');

const linkedGRNs = gatepassService.getGRNsByInwardOrder(sio.id);
assert.strictEqual(linkedGRNs.length, 2);
console.log('  ✓ PASS: Multiple GRNs (2) successfully belong to 1 Stock Inward Order. Order fully received.');

console.log('\n========================================');
console.log('ALL TESTS PASSED! FULL PIPELINE VERIFIED.');
console.log('========================================');
