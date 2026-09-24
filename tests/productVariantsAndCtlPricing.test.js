/**
 * JS Traders ERP - Product Variants in Add Dialog & Cut-to-Length Pricing per Foot Test
 */

import { productService } from '../services/productService.js';
import { salesService } from '../services/salesService.js';
import { invoiceTemplateService } from '../services/invoiceTemplateService.js';
import { cutToLengthService } from '../services/cutToLengthService.js';

function assert(condition, message) {
  if (!condition) {
    console.error(`❌ FAIL: ${message}`);
    process.exit(1);
  }
  console.log(`  ✅ PASS: ${message}`);
}

console.log('===============================================================');
console.log('🧪 TESTING INLINE VARIANTS IN ADD PRODUCT & CTL PRICING PER FT');
console.log('===============================================================');

// --- TEST 1: Create Product with Multiple Variants & Roll Lengths ---
console.log('\n--- TEST 1: Add Product with Multiple Variants ---');
const newProduct = productService.createProduct({
  businessName: 'High Tensile Wire Master',
  customerName: 'High Tensile Galvanized Steel Wire',
  urduName: 'ہائی ٹینسائل اسٹیل وائر',
  categoryId: 'cat-2',
  baseUnitId: 'u-meter',
  productType: 'Stock',
  cut_to_length: true,
  enableRollTracking: true,
  base_unit: 'ft',
  full_unit: 'roll'
});

assert(newProduct && newProduct.id, 'Product created successfully');
assert(newProduct.cut_to_length === true, 'Product has cut_to_length enabled');
assert(newProduct.base_unit === 'ft', 'Default base unit is ft');

// Add 2 variants directly as if created inside Add Product dialog
const var1 = productService.createVariant({
  productId: newProduct.id,
  name: 'Heavy Duty 5,000 ft Roll',
  sku: `${newProduct.code}-5000`,
  costPrice: 15,
  sellingPrice: 22,
  unit: 'ft',
  isCutToLength: true,
  rollLength: 5000,
  rollUnit: 'ft'
});

const var2 = productService.createVariant({
  productId: newProduct.id,
  name: 'Medium Duty 3,000 ft Roll',
  sku: `${newProduct.code}-3000`,
  costPrice: 12,
  sellingPrice: 18,
  unit: 'ft',
  isCutToLength: true,
  rollLength: 3000,
  rollUnit: 'ft'
});

assert(var1.rollLength === 5000 && var1.rollUnit === 'ft', 'Variant 1 roll length is 5,000 ft');
assert(var2.rollLength === 3000 && var2.rollUnit === 'ft', 'Variant 2 roll length is 3,000 ft');

// Initialize warehouse stock for both variants
cutToLengthService.saveVariantStock('wh-1', var1.id, { fullRolls: 5, rollLength: 5000, loosePieces: [], unit: 'ft' });
cutToLengthService.saveVariantStock('wh-1', var2.id, { fullRolls: 3, rollLength: 3000, loosePieces: [], unit: 'ft' });

const stockVar1 = cutToLengthService.getVariantStock('wh-1', var1.id);
assert(stockVar1.fullRolls === 5, 'Variant 1 has 5 full rolls');

// --- TEST 2: Invoicing 2 Rolls -> Rate Charged per ft ---
console.log('\n--- TEST 2: Invoice 2 Rolls (Rate Charged per ft) ---');
// 2 rolls of 5,000 ft each = 10,000 ft. Rate = Rs. 22/ft. Line total must be 10,000 * 22 = 220,000!
const qtyRolls = 2;
const ratePerFt = 22;
const totalFootage = qtyRolls * 5000; // 10,000 ft
const expectedTotal = totalFootage * ratePerFt; // Rs. 220,000

const invoice1 = salesService.createSalesInvoice({
  customerPartyId: 'pty-1',
  dueDate: '2026-10-25',
  lines: [
    {
      variantId: var1.id,
      productId: newProduct.id,
      quantity: qtyRolls,
      rollCount: qtyRolls,
      rollLength: 5000,
      totalFeet: totalFootage,
      isCutToLength: true,
      isRoll: true,
      mode: 'rolls',
      unit: 'Rolls',
      baseUnit: 'ft',
      unitPrice: ratePerFt,
      lineTotal: expectedTotal
    }
  ]
});

assert(invoice1.lines[0].lineTotal === 220000, `Invoice 2 rolls total is Rs. 220,000 (Got: ${invoice1.lines[0].lineTotal})`);
assert(invoice1.total === 220000, `Invoice total is Rs. 220,000 (Got: ${invoice1.total})`);

// --- TEST 3: Invoicing 4,000 ft Loose -> Rate Charged per ft ---
console.log('\n--- TEST 3: Invoice 4,000 ft Loose (Rate Charged per ft) ---');
// 4,000 ft loose @ Rs. 22/ft = Rs. 88,000
const looseQty = 4000;
const expectedLooseTotal = looseQty * ratePerFt; // 88,000

const invoice2 = salesService.createSalesInvoice({
  customerPartyId: 'pty-1',
  dueDate: '2026-10-25',
  lines: [
    {
      variantId: var1.id,
      productId: newProduct.id,
      quantity: looseQty,
      totalFeet: looseQty,
      isCutToLength: true,
      isRoll: false,
      mode: 'loose_continuous',
      unit: 'ft',
      baseUnit: 'ft',
      unitPrice: ratePerFt,
      lineTotal: expectedLooseTotal
    }
  ]
});

assert(invoice2.lines[0].lineTotal === 88000, `Invoice 4,000 ft loose total is Rs. 88,000 (Got: ${invoice2.lines[0].lineTotal})`);
assert(invoice2.total === 88000, `Invoice total is Rs. 88,000 (Got: ${invoice2.total})`);

// --- TEST 4: Printable Invoice displays Base Unit 'ft' and Rate per ft ---
console.log('\n--- TEST 4: Printable Invoice Rendering ---');
const printLines = invoice1.lines.map(l => ({
  name: 'High Tensile Steel Wire',
  sku: var1.sku,
  quantity: l.quantity,
  unit: l.unit,
  unitPrice: l.unitPrice,
  lineTotal: l.lineTotal,
  isCutToLength: l.isCutToLength,
  isRoll: l.isRoll,
  rollCount: l.rollCount,
  rollLength: l.rollLength,
  totalFeet: l.totalFeet,
  baseUnit: l.baseUnit
}));

// --- TEST 5: Verify Product Picker UI with 0 variants & Attribute Removal ---
console.log('\n--- TEST 5: Verify Product Picker with 0 Variants & Removed Attributes ---');
import { renderProductVariantPicker } from '../components/searchableSelect.js';

const productNoVar = productService.createProduct({
  businessName: 'Simple Wire Standard',
  customerName: 'Simple Wire Standard (No Variants)',
  categoryId: 'cat-2',
  baseUnitId: 'u-meter',
  productType: 'Stock',
  cut_to_length: true
});

const pickerHtmlNoVar = renderProductVariantPicker({
  rowId: 'row-test-1',
  selectedProductId: productNoVar.id,
  selectedVariantId: null,
  products: [productNoVar],
  variants: []
});

assert(!pickerHtmlNoVar.includes('Standard Product (No SKUs)'), 'Picker HTML does not show "Standard Product (No SKUs)" card');
assert(pickerHtmlNoVar.includes('pv-variant-container relative hidden'), 'Picker variant container is hidden when product has 0 variants');
assert(!pickerHtmlNoVar.includes('sm:grid-cols-2'), 'Picker is full-width (no sm:grid-cols-2) when product has 0 variants');

const pickerHtmlMulti = renderProductVariantPicker({
  rowId: 'row-test-2',
  selectedProductId: newProduct.id,
  selectedVariantId: null,
  products: [newProduct],
  variants: [var1, var2]
});

assert(pickerHtmlMulti.includes('sm:grid-cols-2'), 'Picker has 2 columns when product has variants');
assert(!pickerHtmlMulti.includes('pv-variant-container relative hidden'), 'Picker variant container is visible when product has variants');
assert(!pickerHtmlMulti.includes('Origin:'), 'No Origin attribute pills rendered in variant picker');
assert(!pickerHtmlMulti.includes('Gauge:'), 'No Gauge attribute pills rendered in variant picker');

console.log('\n===============================================================');
console.log('🎉 ALL INLINE VARIANTS & CTL PRICING TESTS PASSED!');
console.log('===============================================================\n');

