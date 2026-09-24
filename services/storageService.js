/**
 * JS Traders ERP - Unified Storage & Data Access Service
 * Reactive local storage engine with pre-seeded poultry equipment enterprise data.
 * Adheres to data-access layer boundary so the app can seamlessly connect to Supabase PostgreSQL.
 */

import { APP_CONFIG } from '../config/appConfig.js';

const STORAGE_KEY = 'js_traders_erp_db_v1';

// Initial pre-seeded database for immediate full prototype functionality
const SEED_DATABASE = {
  warehouses: [
    { id: 'wh-1', code: 'WH-001', name: 'Warehouse', city: 'Lahore', address: 'Plot 45-B Industrial Area, Multan Road', contactPerson: 'Tariq Mehmood', phone: '+92 300 1234567', isActive: true },
    { id: 'wh-2', code: 'WH-002', name: 'Office', city: 'Lahore', address: 'Main Commercial Plaza, Lahore', contactPerson: 'Usman Tariq', phone: '+92 321 7654321', isActive: true },
    { id: 'wh-3', code: 'WH-003', name: 'Showroom Gujranwala', city: 'Gujranwala', address: 'GT Road Bypass', contactPerson: 'Rizwan Ahmed', phone: '+92 333 9876543', isActive: true }
  ],

  warehouseLocations: [
    { id: 'loc-1', warehouseId: 'wh-1', code: 'RACK-A', name: 'Rack A - Motors & Pan Feeders' },
    { id: 'loc-2', warehouseId: 'wh-1', code: 'RACK-B', name: 'Rack B - Nipple Lines & Small Parts' },
    { id: 'loc-3', warehouseId: 'wh-1', code: 'YARD-1', name: 'Yard 1 - Steel Tubes & Coils' }
  ],

  categories: [
    { id: 'cat-1', code: 'CAT-001', name: 'Feeding Equipment', description: 'Automatic pan feeding systems, augers, drive units, hoppers', isActive: true },
    { id: 'cat-2', code: 'CAT-002', name: 'Drinking Equipment', description: 'Nipple drinker lines, pressure regulators, anti-roost wire', isActive: true },
    { id: 'cat-3', code: 'CAT-003', name: 'Ventilation & Fans', description: '50-inch cone fans, box fans, air inlets', isActive: true },
    { id: 'cat-4', code: 'CAT-004', name: 'Evaporative Cooling', description: 'Cooling pad systems, pumps, guttering and filters', isActive: true },
    { id: 'cat-5', code: 'CAT-005', name: 'Climate Automation', description: 'Automated shed controllers, temperature & humidity sensors', isActive: true },
    { id: 'cat-6', code: 'CAT-006', name: 'Pipes & Fittings', description: 'Galvanized feeder pipes, PVC water pipes, winching cables', isActive: true }
  ],

  units: [
    { id: 'u-1', code: 'PCS', name: 'Piece', symbol: 'pc' },
    { id: 'u-2', code: 'CTN', name: 'Carton', symbol: 'ctn' },
    { id: 'u-3', code: 'FT', name: 'Feet', symbol: 'ft' },
    { id: 'u-4', code: 'MTR', name: 'Meter', symbol: 'm' },
    { id: 'u-5', code: 'ROLL', name: 'Roll', symbol: 'roll' },
    { id: 'u-6', code: 'SET', name: 'Set', symbol: 'set' },
    { id: 'u-7', code: 'KG', name: 'Kilogram', symbol: 'kg' }
  ],

  unitConversions: [
    { fromUnitId: 'u-2', toUnitId: 'u-1', factor: 20 } // 1 CTN = 20 PCS
  ],

  attributeDefinitions: [
    { id: 'attr-1', name: 'Origin', values: ['China', 'Pakistan'] },
    { id: 'attr-2', name: 'Material', values: ['Virgin Polypropylene', 'Recycled Plastic', 'Galvanized Steel', 'Stainless Steel 304'] },
    { id: 'attr-3', name: 'Size', values: ['14-inch', '16-inch', '45mm', '50-inch', '1.5 kW', '2.0 kW'] }
  ],

  products: [
    {
      id: 'prod-1',
      code: 'PROD-00001',
      businessName: 'FP-CN-150',
      customerName: 'Feed Pan 16"',
      urduName: 'فیڈ پین',
      categoryId: 'cat-1',
      baseUnitId: 'u-1',
      productType: 'Stock',
      lowStockLevel: 50,
      enableRollTracking: false,
      negativeStockAllowed: 'disallow',
      description: 'Standard broiler feeding pan with 14-grill feed saver lip and cone.',
      isActive: true
    },
    {
      id: 'prod-2',
      code: 'PROD-00002',
      businessName: 'DN-SS-360',
      customerName: 'Drinking Nipple 360° Stainless Steel',
      urduName: 'پینے والا نپل',
      categoryId: 'cat-2',
      baseUnitId: 'u-1',
      productType: 'Stock',
      lowStockLevel: 200,
      enableRollTracking: false,
      negativeStockAllowed: 'disallow',
      description: 'Top quality 360-degree stainless steel trigger nipple with double seal rubber.',
      isActive: true
    },
    {
      id: 'prod-3',
      code: 'PROD-00003',
      businessName: 'AC-IND-COOL',
      customerName: 'Industrial Evaporative Air Cooler 1.5kW',
      urduName: 'انڈسٹریل ایئر کولر',
      categoryId: 'cat-4',
      baseUnitId: 'u-1',
      productType: 'Stock',
      lowStockLevel: 5,
      enableRollTracking: false,
      negativeStockAllowed: 'disallow',
      description: 'Assembled heavy-duty evaporative cooler unit with 100mm cooling pads and axial fan.',
      isActive: true
    },
    {
      id: 'prod-4',
      code: 'PROD-00004',
      businessName: 'WIRE-3MM-GAL',
      customerName: '3mm Galvanized Steel Wire',
      urduName: 'تار 3 ایم ایم',
      categoryId: 'cat-6',
      baseUnitId: 'u-3', // Feet
      productType: 'Stock',
      lowStockLevel: 500,
      enableRollTracking: true, // Cut-to-length / Roll tracking enabled!
      cut_to_length: true,
      base_unit: 'ft',
      full_unit: 'roll',
      full_unit_quantity: 5000,
      packagingUnits: [
        { id: 'pkg-wire-5000', name: 'Roll (5,000 ft)', factor: 5000, unit: 'ft' },
        { id: 'pkg-wire-3280', name: 'Roll (3,280 ft)', factor: 3280, unit: 'ft' }
      ],
      negativeStockAllowed: 'disallow',
      description: 'Continuous coil roll and cut galvanized high-tensile 3mm steel wire for winch lines & curtains.',
      isActive: true
    },
    {
      id: 'prod-9',
      code: 'PROD-00009',
      businessName: 'AUG-45-GAL',
      customerName: 'Galvanized Feeder Auger 45mm',
      urduName: 'اوگر 45 ایم ایم',
      categoryId: 'cat-1',
      baseUnitId: 'u-3', // Feet
      productType: 'Stock',
      lowStockLevel: 200,
      enableRollTracking: true,
      cut_to_length: true,
      base_unit: 'ft',
      full_unit: 'roll',
      full_unit_quantity: 450,
      packagingUnits: [
        { id: 'pkg-aug-450', name: 'Roll (450 ft)', factor: 450, unit: 'ft' },
        { id: 'pkg-aug-400', name: 'Roll (400 ft)', factor: 400, unit: 'ft' }
      ],
      negativeStockAllowed: 'disallow',
      description: 'High-grade carbon spring steel spiral auger for 45mm automatic feed pan lines.',
      isActive: true
    },
    {
      id: 'prod-5',
      code: 'PROD-00005',
      businessName: 'MOT-IND-15',
      customerName: 'Electric Motor 1.5 kW 3-Phase',
      urduName: 'موٹر 1.5 کلو واٹ',
      categoryId: 'cat-1',
      baseUnitId: 'u-1',
      productType: 'Stock',
      lowStockLevel: 10,
      enableRollTracking: false,
      negativeStockAllowed: 'disallow',
      description: 'Heavy duty IP55 flange mounted motor for feeding drive units and cooler pumps.',
      isActive: true
    },
    {
      id: 'prod-6',
      code: 'PROD-00006',
      businessName: 'FAN-AX-50',
      customerName: 'Axial Fan Blade 50-inch',
      urduName: 'کولر پنکھا بلیڈ',
      categoryId: 'cat-3',
      baseUnitId: 'u-1',
      productType: 'Stock',
      lowStockLevel: 15,
      enableRollTracking: false,
      negativeStockAllowed: 'disallow',
      description: 'Precision balanced stainless steel / aluminium fan blade assembly.',
      isActive: true
    },
    {
      id: 'prod-7',
      code: 'PROD-00007',
      businessName: 'PMP-SUB-COOL',
      customerName: 'Submersible Cooler Water Pump',
      urduName: 'کولر واٹر پمپ',
      categoryId: 'cat-4',
      baseUnitId: 'u-1',
      productType: 'Stock',
      lowStockLevel: 10,
      enableRollTracking: false,
      negativeStockAllowed: 'disallow',
      description: 'Ceramic shaft water circulation pump for evaporative cooling walls.',
      isActive: true
    },
    {
      id: 'prod-8',
      code: 'PROD-00008',
      businessName: 'SYS-FEED-LINE',
      customerName: 'Complete Automatic Feeding Line (System Bundle)',
      urduName: 'مکمل آٹومیٹک فیڈنگ لائن',
      categoryId: 'cat-1',
      baseUnitId: 'u-6', // Set
      productType: 'Stock',
      lowStockLevel: 2,
      enableRollTracking: false,
      negativeStockAllowed: 'disallow',
      description: 'Turnkey broiler shed feeding line bundle (Drive motor + Hopper + Auger + 100 Pans + Tubing).',
      isActive: true
    },
    {
      id: 'prod-cooler-body',
      code: 'PROD-00010',
      businessName: 'AC-BODY-18',
      customerName: 'Cooler Body + Accessories 18"',
      urduName: 'کولر باڈی بمعہ فٹنگ',
      categoryId: 'cat-4',
      baseUnitId: 'u-1',
      productType: 'Stock',
      lowStockLevel: 10,
      enableRollTracking: false,
      negativeStockAllowed: 'disallow',
      description: 'Heavy duty composite industrial evaporative air cooler housing frame and louvers.',
      isActive: true
    },
    {
      id: 'prod-cooling-pad',
      code: 'PROD-00011',
      businessName: 'PAD-100MM',
      customerName: 'Cellulose Cooling Pad 100mm',
      urduName: 'کولنگ پیڈ 100 ایم ایم',
      categoryId: 'cat-4',
      baseUnitId: 'u-1',
      productType: 'Stock',
      lowStockLevel: 50,
      enableRollTracking: false,
      negativeStockAllowed: 'disallow',
      description: 'High water absorption evaporative cooling media pad for shed walls and industrial coolers.',
      isActive: true
    },
    {
      id: 'prod-fan-imp',
      code: 'PROD-00012',
      businessName: 'FAN-50-IMP',
      customerName: 'Imported Complete Fan 50-inch',
      urduName: 'امپورٹڈ فین 50 انچ مکمل',
      categoryId: 'cat-3',
      baseUnitId: 'u-1',
      productType: 'Stock',
      lowStockLevel: 10,
      enableRollTracking: false,
      negativeStockAllowed: 'disallow',
      description: 'Direct imported 50" heavy-duty exhaust fan unit complete with motor, shutter and cone.',
      isActive: true
    },
    {
      id: 'prod-fan-asm',
      code: 'PROD-00013',
      businessName: 'FAN-50-ASM',
      customerName: 'Assembled Cone Fan 50-inch',
      urduName: 'تیار شدہ کون فین 50 انچ',
      categoryId: 'cat-3',
      baseUnitId: 'u-1',
      productType: 'Stock',
      lowStockLevel: 5,
      enableRollTracking: false,
      negativeStockAllowed: 'disallow',
      description: 'Finished workshop assembled 50-inch cone ventilation fan calibrated with safety guard.',
      isActive: true
    },
    {
      id: 'prod-pulley',
      code: 'PROD-00014',
      businessName: 'PUL-FAN-50',
      customerName: 'Cast Iron Fan Pulley & Belt Hub',
      urduName: 'پنکھا پلی اور ہب',
      categoryId: 'cat-3',
      baseUnitId: 'u-1',
      productType: 'Stock',
      lowStockLevel: 20,
      enableRollTracking: false,
      negativeStockAllowed: 'disallow',
      description: 'CNC machined cast iron drive pulley for 50-inch exhaust fan motors.',
      isActive: true
    },
    {
      id: 'prod-fan-body',
      code: 'PROD-00015',
      businessName: 'BDY-FAN-50',
      customerName: 'Galvanized Fan Cone & Shutter Body',
      urduName: 'فین باڈی بمعہ شٹر',
      categoryId: 'cat-3',
      baseUnitId: 'u-1',
      productType: 'Stock',
      lowStockLevel: 10,
      enableRollTracking: false,
      negativeStockAllowed: 'disallow',
      description: 'Hot dip galvanized sheet housing cone and centrifugal shutter box for 50-inch fan.',
      isActive: true
    },
    {
      id: 'prod-hanger',
      code: 'PROD-00016',
      businessName: 'HNG-FEED-LINE',
      customerName: 'Ceiling Suspension Hanger Bracket',
      urduName: 'فیڈنگ لائن ہینگر بریکٹ',
      categoryId: 'cat-1',
      baseUnitId: 'u-1',
      productType: 'Stock',
      lowStockLevel: 100,
      enableRollTracking: false,
      negativeStockAllowed: 'disallow',
      description: 'Galvanized drop cable clamping hanger bracket for automated feeding and drinking lines.',
      isActive: true
    },
    {
      id: 'prod-pipe-galv',
      code: 'PROD-00017',
      businessName: 'PIP-GALV-45',
      customerName: 'Galvanized Feeder Seam Pipe 45mm',
      urduName: 'فیڈر پائپ 45 ایم ایم (فٹ)',
      categoryId: 'cat-6',
      baseUnitId: 'u-3', // Feet
      productType: 'Stock',
      lowStockLevel: 500,
      enableRollTracking: false,
      negativeStockAllowed: 'disallow',
      description: 'Zinc coated steel seamed pipe for automatic auger feed transmission.',
      isActive: true
    },
    {
      id: 'prod-handle',
      code: 'PROD-00018',
      businessName: 'HDL-WINCH-MAN',
      customerName: 'Manual Winch Lifting Handle',
      urduName: 'ونچ ہینڈل',
      categoryId: 'cat-1',
      baseUnitId: 'u-1',
      productType: 'Stock',
      lowStockLevel: 15,
      enableRollTracking: false,
      negativeStockAllowed: 'disallow',
      description: 'Removable heavy-duty turning crank handle for line height winching systems.',
      isActive: true
    },
    {
      id: 'prod-regulator',
      code: 'PROD-00019',
      businessName: 'REG-DRINK-WTR',
      customerName: 'Water Pressure Regulator Unit',
      urduName: 'پریشر ریگولیٹر یونٹ',
      categoryId: 'cat-2',
      baseUnitId: 'u-1',
      productType: 'Stock',
      lowStockLevel: 10,
      enableRollTracking: false,
      negativeStockAllowed: 'disallow',
      description: 'Single/double outlet shed water pressure regulator with flushing tube.',
      isActive: true
    },
    {
      id: 'prod-inverter',
      code: 'PROD-00020',
      businessName: 'INV-CTRL-3P',
      customerName: 'Variable Speed Inverter Drive Panel',
      urduName: 'انورٹر پینل',
      categoryId: 'cat-5',
      baseUnitId: 'u-1',
      productType: 'Stock',
      lowStockLevel: 5,
      enableRollTracking: false,
      negativeStockAllowed: 'disallow',
      description: '3-phase variable frequency inverter controller for fan motor speed modulation.',
      isActive: true
    },
    {
      id: 'prod-remote',
      code: 'PROD-00021',
      businessName: 'REM-INV-WLS',
      customerName: 'Wireless Digital Inverter Remote',
      urduName: 'وائرلیس ریموٹ کنٹرولر',
      categoryId: 'cat-5',
      baseUnitId: 'u-1',
      productType: 'Stock',
      lowStockLevel: 10,
      enableRollTracking: false,
      negativeStockAllowed: 'disallow',
      description: 'Handheld RF remote for variable drive speed control and shed overrides.',
      isActive: true
    },
    {
      id: 'prod-display',
      code: 'PROD-00022',
      businessName: 'LCD-DISP-MOD',
      customerName: 'Digital Shed Climate LCD Display',
      urduName: 'ڈیجیٹل ڈسپلے یونٹ',
      categoryId: 'cat-5',
      baseUnitId: 'u-1',
      productType: 'Stock',
      lowStockLevel: 10,
      enableRollTracking: false,
      negativeStockAllowed: 'disallow',
      description: 'Wall mounted 7-inch LED/LCD telemetry monitor for shed climate automation.',
      isActive: true
    }
  ],

  variants: [
    {
      id: 'var-1',
      productId: 'prod-1',
      code: 'VAR-00001',
      sku: 'FP-CN-16-CHN',
      name: 'Feed Pan 16" - Made in China',
      costPrice: 950,
      sellingPrice: 1450,
      attributes: { Origin: 'China', Material: 'Virgin Polypropylene', Size: '16-inch' },
      isActive: true
    },
    {
      id: 'var-2',
      productId: 'prod-1',
      code: 'VAR-00002',
      sku: 'FP-PK-16-LCL',
      name: 'Feed Pan 16" - Made in Pakistan',
      costPrice: 650,
      sellingPrice: 980,
      attributes: { Origin: 'Pakistan', Material: 'Recycled Plastic', Size: '16-inch' },
      isActive: true
    },
    {
      id: 'var-3',
      productId: 'prod-2',
      code: 'VAR-00003',
      sku: 'DN-360-CHN',
      name: 'Drinking Nipple 360° - China Top Grade',
      costPrice: 65,
      sellingPrice: 110,
      attributes: { Origin: 'China', Material: 'Stainless Steel 304' },
      isActive: true
    },
    {
      id: 'var-4',
      productId: 'prod-3',
      code: 'VAR-00004',
      sku: 'AC-15KW-PAD',
      name: 'Air Cooler 1.5 kW + With Pad',
      costPrice: 42000,
      sellingPrice: 65000,
      attributes: { Origin: 'Pakistan', Size: '1.5 kW' },
      isActive: true
    },
    {
      id: 'var-5',
      productId: 'prod-4',
      code: 'VAR-00005',
      sku: 'WIRE-3MM-FT',
      name: '3mm Galvanized Steel Wire (Continuous)',
      costPrice: 20, // Per foot
      sellingPrice: 32,
      isCutToLength: true,
      rollLength: 5000,
      rollUnit: 'ft',
      attributes: { Origin: 'China', Material: 'Galvanized High-Tensile Steel', Size: '3mm' },
      isActive: true
    },
    {
      id: 'var-6',
      productId: 'prod-5',
      code: 'VAR-00006',
      sku: 'MOT-15KW',
      name: 'Electric Motor 1.5 kW 3-Phase',
      costPrice: 18500,
      sellingPrice: 26000,
      attributes: { Origin: 'China', Size: '1.5 kW' },
      isActive: true
    },
    {
      id: 'var-7',
      productId: 'prod-6',
      code: 'VAR-00007',
      sku: 'FAN-50IN',
      name: 'Axial Fan Blade 50-inch',
      costPrice: 9500,
      sellingPrice: 14000,
      attributes: { Origin: 'China', Size: '50-inch' },
      isActive: true
    },
    {
      id: 'var-8',
      productId: 'prod-7',
      code: 'VAR-00008',
      sku: 'PMP-SUB',
      name: 'Submersible Cooler Water Pump',
      costPrice: 3800,
      sellingPrice: 5500,
      attributes: { Origin: 'China' },
      isActive: true
    },
    {
      id: 'var-9-450',
      productId: 'prod-9',
      code: 'VAR-00009-450',
      sku: 'AUG-45-450FT',
      name: 'Galvanized Feeder Auger 45mm (450 ft Roll)',
      costPrice: 180, // Per foot
      sellingPrice: 260,
      isCutToLength: true,
      rollLength: 450,
      rollSize: 450,
      rollUnit: 'ft',
      packagingName: 'Roll (450 ft)',
      attributes: { Origin: 'South Africa', Material: 'Spring Steel', Size: '45mm', Packaging: '450 ft Roll' },
      isActive: true
    },
    {
      id: 'var-9-400',
      productId: 'prod-9',
      code: 'VAR-00009-400',
      sku: 'AUG-45-400FT',
      name: 'Galvanized Feeder Auger 45mm (400 ft Roll)',
      costPrice: 180, // Per foot
      sellingPrice: 260,
      isCutToLength: true,
      rollLength: 400,
      rollSize: 400,
      rollUnit: 'ft',
      packagingName: 'Roll (400 ft)',
      attributes: { Origin: 'South Africa', Material: 'Spring Steel', Size: '45mm', Packaging: '400 ft Roll' },
      isActive: true
    },
    {
      id: 'var-cooler-body',
      productId: 'prod-cooler-body',
      code: 'VAR-00010',
      sku: 'AC-BODY-18',
      name: 'Cooler Body + Accessories 18"',
      costPrice: 4000,
      sellingPrice: 6000,
      attributes: { Origin: 'Pakistan', Size: '18-inch' },
      isActive: true
    },
    {
      id: 'var-pad-100',
      productId: 'prod-cooling-pad',
      code: 'VAR-00011',
      sku: 'PAD-100MM',
      name: 'Cellulose Cooling Pad 100mm',
      costPrice: 800,
      sellingPrice: 1400,
      attributes: { Origin: 'Pakistan', Size: '100mm' },
      isActive: true
    },
    {
      id: 'var-fan-imported',
      productId: 'prod-fan-imp',
      code: 'VAR-00012',
      sku: 'FAN-50-IMP',
      name: 'Imported Complete Fan 50-inch',
      costPrice: 9500,
      sellingPrice: 13500,
      attributes: { Origin: 'China', Size: '50-inch' },
      isActive: true
    },
    {
      id: 'var-fan-assembled',
      productId: 'prod-fan-asm',
      code: 'VAR-00013',
      sku: 'FAN-50-ASM',
      name: 'Assembled Cone Fan 50-inch',
      costPrice: 9650,
      sellingPrice: 14800,
      attributes: { Origin: 'Pakistan', Size: '50-inch' },
      isActive: true
    },
    {
      id: 'var-pulley',
      productId: 'prod-pulley',
      code: 'VAR-00014',
      sku: 'PUL-FAN-50',
      name: 'Cast Iron Fan Pulley & Belt Hub',
      costPrice: 1200,
      sellingPrice: 1900,
      attributes: { Origin: 'Pakistan', Size: '50-inch' },
      isActive: true
    },
    {
      id: 'var-fan-body',
      productId: 'prod-fan-body',
      code: 'VAR-00015',
      sku: 'BDY-FAN-50',
      name: 'Galvanized Fan Cone & Shutter Body',
      costPrice: 3500,
      sellingPrice: 5200,
      attributes: { Origin: 'Pakistan', Size: '50-inch' },
      isActive: true
    },
    {
      id: 'var-hanger',
      productId: 'prod-hanger',
      code: 'VAR-00016',
      sku: 'HNG-FEED-LINE',
      name: 'Ceiling Suspension Hanger Bracket',
      costPrice: 80,
      sellingPrice: 120,
      attributes: { Origin: 'Pakistan', Type: 'Hanger' },
      isActive: true
    },
    {
      id: 'var-pipe-galv',
      productId: 'prod-pipe-galv',
      code: 'VAR-00017',
      sku: 'PIP-GALV-45',
      name: 'Galvanized Feeder Seam Pipe 45mm (ft)',
      costPrice: 35, // Per ft
      sellingPrice: 55,
      attributes: { Origin: 'Pakistan', Size: '45mm' },
      isActive: true
    },
    {
      id: 'var-handle',
      productId: 'prod-handle',
      code: 'VAR-00018',
      sku: 'HDL-WINCH-MAN',
      name: 'Manual Winch Lifting Handle',
      costPrice: 450,
      sellingPrice: 750,
      attributes: { Origin: 'Pakistan', Type: 'Handle' },
      isActive: true
    },
    {
      id: 'var-regulator',
      productId: 'prod-regulator',
      code: 'VAR-00019',
      sku: 'REG-DRINK-WTR',
      name: 'Water Pressure Regulator Unit',
      costPrice: 1800,
      sellingPrice: 2600,
      attributes: { Origin: 'China', Type: 'Regulator' },
      isActive: true
    },
    {
      id: 'var-inverter',
      productId: 'prod-inverter',
      code: 'VAR-00020',
      sku: 'INV-CTRL-3P',
      name: 'Variable Speed Inverter Drive Panel',
      costPrice: 28000,
      sellingPrice: 38000,
      attributes: { Origin: 'China', Power: '3-Phase' },
      isActive: true
    },
    {
      id: 'var-remote',
      productId: 'prod-remote',
      code: 'VAR-00021',
      sku: 'REM-INV-WLS',
      name: 'Wireless Digital Inverter Remote',
      costPrice: 1500,
      sellingPrice: 2500,
      attributes: { Origin: 'China' },
      isActive: true
    },
    {
      id: 'var-display',
      productId: 'prod-display',
      code: 'VAR-00022',
      sku: 'LCD-DISP-MOD',
      name: 'Digital Shed Climate LCD Display',
      costPrice: 3200,
      sellingPrice: 5000,
      attributes: { Origin: 'China', Size: '7-inch' },
      isActive: true
    }
  ],

  // Variant-Level Roll & Loose Stock Balances
  variantRollStocks: [
    // 3mm Galvanized Steel Wire (var-5, prod-4): 5 full rolls of 5,000 ft, 0 loose pieces (total 25,000 ft) in wh-1
    {
      id: 'vrs-wh-1-var-5',
      warehouseId: 'wh-1',
      variantId: 'var-5',
      productId: 'prod-4',
      fullRolls: 5,
      rollLength: 5000,
      loosePieces: [],
      unit: 'ft'
    },
    {
      id: 'vrs-wh-2-var-5',
      warehouseId: 'wh-2',
      variantId: 'var-5',
      productId: 'prod-4',
      fullRolls: 0,
      rollLength: 5000,
      loosePieces: [],
      unit: 'ft'
    },
    // Auger 450 (var-9-450): 5 full rolls of 450 ft, 0 loose pieces (total 2,250 ft) in wh-1
    {
      id: 'vrs-wh-1-var-9-450',
      warehouseId: 'wh-1',
      variantId: 'var-9-450',
      productId: 'prod-9',
      fullRolls: 5,
      rollLength: 450,
      loosePieces: [250],
      unit: 'ft'
    },
    // Auger 400 (var-9-400): 3 full rolls of 400 ft, 0 loose pieces (total 1,200 ft) in wh-1
    {
      id: 'vrs-wh-1-var-9-400',
      warehouseId: 'wh-1',
      variantId: 'var-9-400',
      productId: 'prod-9',
      fullRolls: 3,
      rollLength: 400,
      loosePieces: [],
      unit: 'ft'
    }
  ],

  // Physical units (Full untouched rolls & partially used loose pieces)
  cutToLengthUnits: [
    // 3mm Galvanized Steel Wire (prod-4, var-5)
    // 6 Full Rolls of 5,000 ft (30,000 ft)
    { id: 'unit-r001', code: 'R001', productId: 'prod-4', variantId: 'var-5', warehouseId: 'wh-1', classification: 'FULL', quantity: 5000, initialQuantity: 5000, packagingName: 'Roll (5,000 ft)', unit: 'ft', status: 'AVAILABLE', createdAt: '2025-09-01T08:00:00Z', notes: 'Import shipment lot 1' },
    { id: 'unit-r002', code: 'R002', productId: 'prod-4', variantId: 'var-5', warehouseId: 'wh-1', classification: 'FULL', quantity: 5000, initialQuantity: 5000, packagingName: 'Roll (5,000 ft)', unit: 'ft', status: 'AVAILABLE', createdAt: '2025-09-01T08:00:00Z', notes: 'Import shipment lot 1' },
    { id: 'unit-r003', code: 'R003', productId: 'prod-4', variantId: 'var-5', warehouseId: 'wh-1', classification: 'FULL', quantity: 5000, initialQuantity: 5000, packagingName: 'Roll (5,000 ft)', unit: 'ft', status: 'AVAILABLE', createdAt: '2025-09-01T08:00:00Z', notes: 'Import shipment lot 1' },
    { id: 'unit-r004', code: 'R004', productId: 'prod-4', variantId: 'var-5', warehouseId: 'wh-1', classification: 'FULL', quantity: 5000, initialQuantity: 5000, packagingName: 'Roll (5,000 ft)', unit: 'ft', status: 'AVAILABLE', createdAt: '2025-09-01T08:00:00Z', notes: 'Import shipment lot 1' },
    { id: 'unit-r005', code: 'R005', productId: 'prod-4', variantId: 'var-5', warehouseId: 'wh-1', classification: 'FULL', quantity: 5000, initialQuantity: 5000, packagingName: 'Roll (5,000 ft)', unit: 'ft', status: 'AVAILABLE', createdAt: '2025-09-01T08:00:00Z', notes: 'Import shipment lot 1' },
    { id: 'unit-r006', code: 'R006', productId: 'prod-4', variantId: 'var-5', warehouseId: 'wh-1', classification: 'FULL', quantity: 5000, initialQuantity: 5000, packagingName: 'Roll (5,000 ft)', unit: 'ft', status: 'AVAILABLE', createdAt: '2025-09-01T08:00:00Z', notes: 'Import shipment lot 1' },
    // 4 Full Rolls of 3,280 ft (13,120 ft)
    { id: 'unit-r101', code: 'R101', productId: 'prod-4', variantId: 'var-5', warehouseId: 'wh-1', classification: 'FULL', quantity: 3280, initialQuantity: 3280, packagingName: 'Roll (3,280 ft)', unit: 'ft', status: 'AVAILABLE', createdAt: '2025-09-05T09:30:00Z', notes: 'Standard 1000m coil import' },
    { id: 'unit-r102', code: 'R102', productId: 'prod-4', variantId: 'var-5', warehouseId: 'wh-1', classification: 'FULL', quantity: 3280, initialQuantity: 3280, packagingName: 'Roll (3,280 ft)', unit: 'ft', status: 'AVAILABLE', createdAt: '2025-09-05T09:30:00Z', notes: 'Standard 1000m coil import' },
    { id: 'unit-r103', code: 'R103', productId: 'prod-4', variantId: 'var-5', warehouseId: 'wh-1', classification: 'FULL', quantity: 3280, initialQuantity: 3280, packagingName: 'Roll (3,280 ft)', unit: 'ft', status: 'AVAILABLE', createdAt: '2025-09-05T09:30:00Z', notes: 'Standard 1000m coil import' },
    { id: 'unit-r104', code: 'R104', productId: 'prod-4', variantId: 'var-5', warehouseId: 'wh-1', classification: 'FULL', quantity: 3280, initialQuantity: 3280, packagingName: 'Roll (3,280 ft)', unit: 'ft', status: 'AVAILABLE', createdAt: '2025-09-05T09:30:00Z', notes: 'Standard 1000m coil import' },
    // 2 Loose Pieces of 3mm wire (4,700 ft)
    { id: 'unit-l001', code: 'L001', productId: 'prod-4', variantId: 'var-5', warehouseId: 'wh-1', classification: 'LOOSE', quantity: 1000, initialQuantity: 5000, unit: 'ft', parentUnitId: 'unit-r005', status: 'AVAILABLE', createdAt: '2025-09-10T14:15:00Z', notes: 'Remaining from 4,000 ft cut for Farm A' },
    { id: 'unit-l002', code: 'L002', productId: 'prod-4', variantId: 'var-5', warehouseId: 'wh-1', classification: 'LOOSE', quantity: 3700, initialQuantity: 5000, unit: 'ft', parentUnitId: 'unit-r006', status: 'AVAILABLE', createdAt: '2025-09-12T11:00:00Z', notes: 'Remaining from 1,300 ft cut for Farm B' },

    // Galvanized Feeder Auger 45mm (prod-9)
    // 450 ft Variation (var-9-450)
    // 5 Full Rolls of 450 ft (2,250 ft)
    { id: 'unit-a001', code: 'A001', productId: 'prod-9', variantId: 'var-9-450', warehouseId: 'wh-1', classification: 'FULL', quantity: 450, initialQuantity: 450, packagingName: 'Roll (450 ft)', unit: 'ft', status: 'AVAILABLE', createdAt: '2025-09-02T10:00:00Z', notes: 'Standard 450ft box' },
    { id: 'unit-a002', code: 'A002', productId: 'prod-9', variantId: 'var-9-450', warehouseId: 'wh-1', classification: 'FULL', quantity: 450, initialQuantity: 450, packagingName: 'Roll (450 ft)', unit: 'ft', status: 'AVAILABLE', createdAt: '2025-09-02T10:00:00Z', notes: 'Standard 450ft box' },
    { id: 'unit-a003', code: 'A003', productId: 'prod-9', variantId: 'var-9-450', warehouseId: 'wh-1', classification: 'FULL', quantity: 450, initialQuantity: 450, packagingName: 'Roll (450 ft)', unit: 'ft', status: 'AVAILABLE', createdAt: '2025-09-02T10:00:00Z', notes: 'Standard 450ft box' },
    { id: 'unit-a004', code: 'A004', productId: 'prod-9', variantId: 'var-9-450', warehouseId: 'wh-1', classification: 'FULL', quantity: 450, initialQuantity: 450, packagingName: 'Roll (450 ft)', unit: 'ft', status: 'AVAILABLE', createdAt: '2025-09-02T10:00:00Z', notes: 'Standard 450ft box' },
    { id: 'unit-a005', code: 'A005', productId: 'prod-9', variantId: 'var-9-450', warehouseId: 'wh-1', classification: 'FULL', quantity: 450, initialQuantity: 450, packagingName: 'Roll (450 ft)', unit: 'ft', status: 'AVAILABLE', createdAt: '2025-09-02T10:00:00Z', notes: 'Standard 450ft box' },
    // 1 Loose Piece of Auger 450 ft (250 ft)
    { id: 'unit-l201', code: 'L201', productId: 'prod-9', variantId: 'var-9-450', warehouseId: 'wh-1', classification: 'LOOSE', quantity: 250, initialQuantity: 450, unit: 'ft', parentUnitId: 'unit-a006', status: 'AVAILABLE', createdAt: '2025-09-14T16:00:00Z', notes: 'Remaining from 200 ft cut for Shed 3 replacement' },

    // 400 ft Variation (var-9-400)
    // 3 Full Rolls of 400 ft (1,200 ft)
    { id: 'unit-a101', code: 'A101', productId: 'prod-9', variantId: 'var-9-400', warehouseId: 'wh-1', classification: 'FULL', quantity: 400, initialQuantity: 400, packagingName: 'Roll (400 ft)', unit: 'ft', status: 'AVAILABLE', createdAt: '2025-09-06T12:00:00Z', notes: 'Standard 400ft box' },
    { id: 'unit-a102', code: 'A102', productId: 'prod-9', variantId: 'var-9-400', warehouseId: 'wh-1', classification: 'FULL', quantity: 400, initialQuantity: 400, packagingName: 'Roll (400 ft)', unit: 'ft', status: 'AVAILABLE', createdAt: '2025-09-06T12:00:00Z', notes: 'Standard 400ft box' },
    { id: 'unit-a103', code: 'A103', productId: 'prod-9', variantId: 'var-9-400', warehouseId: 'wh-1', classification: 'FULL', quantity: 400, initialQuantity: 400, packagingName: 'Roll (400 ft)', unit: 'ft', status: 'AVAILABLE', createdAt: '2025-09-06T12:00:00Z', notes: 'Standard 400ft box' }
  ],

  // Audit trail of roll / cut operations
  cutToLengthTransactions: [
    {
      id: 'tx-ctl-001',
      transactionType: 'INITIAL_PURCHASE',
      referenceDocType: 'purchase',
      referenceDocId: 'PO-2025-001',
      productId: 'prod-4',
      warehouseId: 'wh-1',
      sourceUnitId: 'unit-r001',
      sourceCode: 'R001',
      originalLength: 0,
      issuedLength: 0,
      remainingLength: 5000,
      resultingUnitId: 'unit-r001',
      newClassification: 'FULL',
      userId: 'user-admin',
      notes: 'Initial import batch received: 6 rolls of 5,000 ft',
      createdAt: '2025-09-01T08:00:00Z'
    },
    {
      id: 'tx-ctl-002',
      transactionType: 'ROLL_OPEN',
      referenceDocType: 'invoice',
      referenceDocId: 'INV-2025-0012',
      productId: 'prod-4',
      warehouseId: 'wh-1',
      sourceUnitId: 'unit-r005',
      sourceCode: 'R005',
      originalLength: 5000,
      issuedLength: 4000,
      remainingLength: 1000,
      resultingUnitId: 'unit-l001',
      resultingCode: 'L001',
      newClassification: 'LOOSE',
      userId: 'user-admin',
      notes: 'Opened full roll R005 (5,000 ft), cut 4,000 ft, created loose piece L001 (1,000 ft)',
      createdAt: '2025-09-10T14:15:00Z'
    },
    {
      id: 'tx-ctl-003',
      transactionType: 'ROLL_OPEN',
      referenceDocType: 'invoice',
      referenceDocId: 'INV-2025-0019',
      productId: 'prod-4',
      warehouseId: 'wh-1',
      sourceUnitId: 'unit-r006',
      sourceCode: 'R006',
      originalLength: 5000,
      issuedLength: 1300,
      remainingLength: 3700,
      resultingUnitId: 'unit-l002',
      resultingCode: 'L002',
      newClassification: 'LOOSE',
      userId: 'user-admin',
      notes: 'Opened full roll R006 (5,000 ft), cut 1,300 ft, created loose piece L002 (3,700 ft)',
      createdAt: '2025-09-12T11:00:00Z'
    }
  ],

  // Backward compatibility alias
  physicalRolls: [
    { id: 'roll-1', variantId: 'var-5', warehouseId: 'wh-1', code: 'R001', initialLength: 5000, remainingLength: 5000, isFull: true },
    { id: 'roll-2', variantId: 'var-5', warehouseId: 'wh-1', code: 'R002', initialLength: 5000, remainingLength: 5000, isFull: true },
    { id: 'roll-3', variantId: 'var-5', warehouseId: 'wh-1', code: 'R003', initialLength: 5000, remainingLength: 5000, isFull: true },
    { id: 'roll-4', variantId: 'var-5', warehouseId: 'wh-1', code: 'R101', initialLength: 3280, remainingLength: 3280, isFull: true }
  ],

  // Stock balances by warehouse & variant
  stockBalances: [
    { id: 'bal-wh1-var1', warehouseId: 'wh-1', variantId: 'var-1', quantity: 1250, averageCost: 950, unit: 'PCS' },
    { id: 'bal-wh1-var2', warehouseId: 'wh-1', variantId: 'var-2', quantity: 820, averageCost: 650, unit: 'PCS' },
    { id: 'bal-wh1-var3', warehouseId: 'wh-1', variantId: 'var-3', quantity: 4500, averageCost: 65, unit: 'PCS' },
    { id: 'bal-wh1-var4', warehouseId: 'wh-1', variantId: 'var-4', quantity: 6, averageCost: 42000, unit: 'PCS' },
    { id: 'bal-wh1-var5', warehouseId: 'wh-1', variantId: 'var-5', quantity: 47820, averageCost: 20, unit: 'FT' },
    { id: 'bal-wh1-var6', warehouseId: 'wh-1', variantId: 'var-6', quantity: 25, averageCost: 18500, unit: 'PCS' },
    { id: 'bal-wh1-var7', warehouseId: 'wh-1', variantId: 'var-7', quantity: 30, averageCost: 9500, unit: 'PCS' },
    { id: 'bal-wh1-var8', warehouseId: 'wh-1', variantId: 'var-8', quantity: 40, averageCost: 3800, unit: 'PCS' },
    { id: 'bal-wh1-var9-450', warehouseId: 'wh-1', variantId: 'var-9-450', quantity: 2500, averageCost: 180, unit: 'FT' },
    { id: 'bal-wh1-var9-400', warehouseId: 'wh-1', variantId: 'var-9-400', quantity: 1200, averageCost: 180, unit: 'FT' },
    // Office Stock Balances (wh-2)
    { id: 'bal-wh2-var1', warehouseId: 'wh-2', variantId: 'var-1', quantity: 350, averageCost: 950, unit: 'PCS' },
    { id: 'bal-wh2-var2', warehouseId: 'wh-2', variantId: 'var-2', quantity: 180, averageCost: 650, unit: 'PCS' },
    { id: 'bal-wh2-var3', warehouseId: 'wh-2', variantId: 'var-3', quantity: 1200, averageCost: 65, unit: 'PCS' },
    { id: 'bal-wh2-var4', warehouseId: 'wh-2', variantId: 'var-4', quantity: 3, averageCost: 42000, unit: 'PCS' },
    { id: 'bal-wh2-var5', warehouseId: 'wh-2', variantId: 'var-5', quantity: 5000, averageCost: 20, unit: 'FT' },
    { id: 'bal-wh2-var6', warehouseId: 'wh-2', variantId: 'var-6', quantity: 5, averageCost: 18500, unit: 'PCS' },
    { id: 'bal-wh2-var7', warehouseId: 'wh-2', variantId: 'var-7', quantity: 6, averageCost: 9500, unit: 'PCS' },
    { id: 'bal-wh2-var8', warehouseId: 'wh-2', variantId: 'var-8', quantity: 15, averageCost: 3800, unit: 'PCS' },
    // Assembly components & products (wh-1)
    { id: 'bal-wh1-var-cooler-body', warehouseId: 'wh-1', variantId: 'var-cooler-body', quantity: 150, averageCost: 4000, unit: 'PCS' },
    { id: 'bal-wh1-var-pad-100', warehouseId: 'wh-1', variantId: 'var-pad-100', quantity: 200, averageCost: 800, unit: 'PCS' },
    { id: 'bal-wh1-var-fan-imported', warehouseId: 'wh-1', variantId: 'var-fan-imported', quantity: 80, averageCost: 9500, unit: 'PCS' },
    { id: 'bal-wh1-var-fan-assembled', warehouseId: 'wh-1', variantId: 'var-fan-assembled', quantity: 10, averageCost: 9650, unit: 'PCS' },
    { id: 'bal-wh1-var-pulley', warehouseId: 'wh-1', variantId: 'var-pulley', quantity: 120, averageCost: 1200, unit: 'PCS' },
    { id: 'bal-wh1-var-fan-body', warehouseId: 'wh-1', variantId: 'var-fan-body', quantity: 60, averageCost: 3500, unit: 'PCS' },
    { id: 'bal-wh1-var-hanger', warehouseId: 'wh-1', variantId: 'var-hanger', quantity: 1200, averageCost: 80, unit: 'PCS' },
    { id: 'bal-wh1-var-pipe-galv', warehouseId: 'wh-1', variantId: 'var-pipe-galv', quantity: 15000, averageCost: 35, unit: 'FT' },
    { id: 'bal-wh1-var-handle', warehouseId: 'wh-1', variantId: 'var-handle', quantity: 50, averageCost: 450, unit: 'PCS' },
    { id: 'bal-wh1-var-regulator', warehouseId: 'wh-1', variantId: 'var-regulator', quantity: 30, averageCost: 1800, unit: 'PCS' },
    { id: 'bal-wh1-var-inverter', warehouseId: 'wh-1', variantId: 'var-inverter', quantity: 12, averageCost: 28000, unit: 'PCS' },
    { id: 'bal-wh1-var-remote', warehouseId: 'wh-1', variantId: 'var-remote', quantity: 25, averageCost: 1500, unit: 'PCS' },
    { id: 'bal-wh1-var-display', warehouseId: 'wh-1', variantId: 'var-display', quantity: 18, averageCost: 3200, unit: 'PCS' },
    // Assembly components & products (wh-2)
    { id: 'bal-wh2-var-cooler-body', warehouseId: 'wh-2', variantId: 'var-cooler-body', quantity: 20, averageCost: 4000, unit: 'PCS' },
    { id: 'bal-wh2-var-pad-100', warehouseId: 'wh-2', variantId: 'var-pad-100', quantity: 30, averageCost: 800, unit: 'PCS' },
    { id: 'bal-wh2-var-fan-imported', warehouseId: 'wh-2', variantId: 'var-fan-imported', quantity: 15, averageCost: 9500, unit: 'PCS' },
    { id: 'bal-wh2-var-fan-assembled', warehouseId: 'wh-2', variantId: 'var-fan-assembled', quantity: 5, averageCost: 9650, unit: 'PCS' },
    { id: 'bal-wh2-var-pulley', warehouseId: 'wh-2', variantId: 'var-pulley', quantity: 20, averageCost: 1200, unit: 'PCS' },
    { id: 'bal-wh2-var-fan-body', warehouseId: 'wh-2', variantId: 'var-fan-body', quantity: 10, averageCost: 3500, unit: 'PCS' },
    { id: 'bal-wh2-var-hanger', warehouseId: 'wh-2', variantId: 'var-hanger', quantity: 300, averageCost: 80, unit: 'PCS' },
    { id: 'bal-wh2-var-pipe-galv', warehouseId: 'wh-2', variantId: 'var-pipe-galv', quantity: 3000, averageCost: 35, unit: 'FT' },
    { id: 'bal-wh2-var-handle', warehouseId: 'wh-2', variantId: 'var-handle', quantity: 10, averageCost: 450, unit: 'PCS' },
    { id: 'bal-wh2-var-regulator', warehouseId: 'wh-2', variantId: 'var-regulator', quantity: 8, averageCost: 1800, unit: 'PCS' },
    { id: 'bal-wh2-var-inverter', warehouseId: 'wh-2', variantId: 'var-inverter', quantity: 3, averageCost: 28000, unit: 'PCS' },
    { id: 'bal-wh2-var-remote', warehouseId: 'wh-2', variantId: 'var-remote', quantity: 5, averageCost: 1500, unit: 'PCS' },
    { id: 'bal-wh2-var-display', warehouseId: 'wh-2', variantId: 'var-display', quantity: 4, averageCost: 3200, unit: 'PCS' }
  ],

  stockMovements: [
    {
      id: 'mov-1',
      movementNumber: 'MOV-00001',
      movementType: 'opening_balance',
      referenceDocType: 'opening_stock',
      referenceDocId: null,
      warehouseId: 'wh-1',
      date: '2025-09-01T10:00:00Z',
      createdBy: 'user-admin',
      notes: 'Initial fiscal opening balance import',
      lines: [
        { variantId: 'var-1', quantity: 1250, unitRate: 950, totalCost: 1187500, unit: 'PCS' },
        { variantId: 'var-2', quantity: 820, unitRate: 650, totalCost: 533000, unit: 'PCS' },
        { variantId: 'var-3', quantity: 4500, unitRate: 65, totalCost: 292500, unit: 'PCS' },
        { variantId: 'var-4', quantity: 8, unitRate: 42000, totalCost: 336000, unit: 'PCS' },
        { variantId: 'var-5', quantity: 25000, unitRate: 120, totalCost: 3000000, unit: 'FT' }
      ]
    }
  ],

  stockAdjustments: [
    {
      id: 'adj-1',
      adjustmentNumber: 'ADJ-00001',
      type: 'increase',
      warehouseId: 'wh-1',
      date: '2025-09-10',
      reason: 'Physical inventory audit variance found extra stock',
      status: 'Confirmed',
      lines: [{ variantId: 'var-1', quantity: 25, unitRate: 950, unit: 'PCS' }],
      notes: 'Approved after quarterly stock count'
    }
  ],

  // Shared Party Architecture: Customer and Supplier
  parties: [
    {
      id: 'pty-1',
      code: 'PTY-00001',
      name: 'Ali Poultry Group',
      businessName: 'Ali Broiler & Layer Farms Pvt Ltd',
      isCustomer: true,
      isSupplier: false,
      contactPerson: 'Haji Ali Muhammad',
      phone: '+92 300 8456123',
      email: 'ali@alipoultry.com',
      city: 'Lahore',
      address: 'Near Raiwind Road, Lahore',
      currency: 'PKR',
      paymentTerms: '30 Days Net',
      isActive: true
    },
    {
      id: 'pty-2',
      code: 'PTY-00002',
      name: 'Sadiq Feed & Poultry Associates',
      businessName: 'Sadiq Associates',
      isCustomer: true,
      isSupplier: true, // Both Customer AND Supplier! Shared Party demonstration!
      contactPerson: 'Khurram Sadiq',
      phone: '+92 322 4567890',
      email: 'khurram@sadiqgroup.com',
      city: 'Rawalpindi',
      address: 'Chaklala Scheme III, Rawalpindi',
      currency: 'PKR',
      paymentTerms: '15 Days Net',
      isActive: true
    },
    {
      id: 'pty-3',
      code: 'PTY-00003',
      name: 'Ningbo Agri-Tech Automation Co.',
      businessName: 'Ningbo Agri-Tech China',
      isCustomer: false,
      isSupplier: true,
      contactPerson: 'David Chen',
      phone: '+86 574 88991122',
      email: 'export@nbagritech.com',
      city: 'Ningbo',
      country: 'China',
      currency: 'USD',
      paymentTerms: 'FOB Ningbo / 30% Advance',
      isActive: true
    },
    {
      id: 'pty-4',
      code: 'PTY-00004',
      name: 'Qingdao Jinhe Poultry Machinery Co.',
      businessName: 'Jinhe Poultry Machinery',
      isCustomer: false,
      isSupplier: true,
      contactPerson: 'Li Wei',
      phone: '+86 532 87654321',
      email: 'sales@jinhepoultry.com',
      city: 'Qingdao',
      country: 'China',
      currency: 'USD',
      paymentTerms: 'EXW Factory / LC at sight',
      isActive: true
    },
    {
      id: 'pty-labor-1',
      code: 'PTY-L001',
      name: 'ABC Assembly Workshop',
      businessName: 'ABC Assembly Works (Haji Rafiq)',
      isCustomer: false,
      isSupplier: true,
      isLaborParty: true,
      partyType: 'Assembly Labor',
      contactPerson: 'Haji Rafiq',
      phone: '+92 300 4567891',
      city: 'Lahore',
      address: 'Shed 4, Multan Road Workshop Area, Lahore',
      currency: 'PKR',
      isActive: true
    },
    {
      id: 'pty-labor-2',
      code: 'PTY-L002',
      name: 'XYZ Fan Assembly',
      businessName: 'XYZ Industrial Assembly Co.',
      isCustomer: false,
      isSupplier: true,
      isLaborParty: true,
      partyType: 'Assembly Labor',
      contactPerson: 'Tariq Mehmood',
      phone: '+92 321 8899776',
      city: 'Gujranwala',
      address: 'Small Industrial Estate, Gujranwala',
      currency: 'PKR',
      isActive: true
    },
    {
      id: 'pty-labor-3',
      code: 'PTY-L003',
      name: 'Ali Workshop',
      businessName: 'Ali Mechanics & Assembly Services',
      isCustomer: false,
      isSupplier: true,
      isLaborParty: true,
      partyType: 'Assembly Labor',
      contactPerson: 'Ali Hassan',
      phone: '+92 333 1122334',
      city: 'Lahore',
      address: 'Band Road Industrial Area, Lahore',
      currency: 'PKR',
      isActive: true
    }
  ],

  // Customer Hierarchy: Customer Owner -> Farm/Branch -> Deal/Ledger Account
  customerFarms: [
    { id: 'farm-1', customerPartyId: 'pty-1', code: 'FRM-001', name: 'Farm 1 - Bhai Pheru Modern Sheds', location: 'Bhai Pheru Bypass, Kasur', capacity: 35000, contact: '+92 301 2233445' },
    { id: 'farm-2', customerPartyId: 'pty-1', code: 'FRM-002', name: 'Farm 2 - Okara Controlled House', location: 'Deepalpur Road, Okara', capacity: 50000, contact: '+92 301 5566778' },
    { id: 'farm-3', customerPartyId: 'pty-2', code: 'FRM-003', name: 'Chakri Breeder Farm', location: 'Chakri Road, Rawalpindi', capacity: 25000, contact: '+92 321 8899001' }
  ],

  customerDeals: [
    { id: 'deal-1', farmId: 'farm-1', code: 'DEAL-2025-01', name: 'Turnkey 4-Line Automated Feeding Automation', assignedSalesperson: 'Salung Prastyo', budget: 2450000, status: 'Active' },
    { id: 'deal-2', farmId: 'farm-2', code: 'DEAL-2025-02', name: 'Cooling Pad & Air Cooler Overhaul Phase 1', assignedSalesperson: 'Taimoor Shah', budget: 1650000, status: 'Active' }
  ],

  // Sales Orders (Customer complete orders / requirements - No physical stock deduction)
  salesOrders: [
    {
      id: 'so-1',
      orderNumber: 'SO-00001',
      customerPartyId: 'pty-1',
      customerName: 'Ryan Korsgaard — Ergo Systems Ltd.',
      farmId: 'farm-1',
      dealId: 'deal-1',
      assignedSalespersonId: 'user-sales',
      date: '2025-09-15',
      currency: 'PKR',
      status: 'Partially Delivered', // Draft, Confirmed, Partially Delivered, Fully Delivered, Cancelled
      subtotal: 145000,
      tax: 0,
      discount: 5000,
      total: 140000,
      notes: 'Delivery requested in 2 batches for Bhai Pheru site',
      gdnIds: ['gp-1'],
      lines: [
        {
          id: 'sol-1',
          variantId: 'var-1',
          orderedQty: 100,
          deliveredQty: 50,
          invoicedQty: 0,
          unit: 'PCS',
          unitPrice: 1450,
          lineTotal: 145000,
          notes: 'Feed Pan 16" - China'
        }
      ]
    },
    {
      id: 'so-2',
      orderNumber: 'SO-00002',
      customerPartyId: 'pty-2',
      customerName: 'Madelyn Lubin — Sunset Creative Corp',
      farmId: 'farm-2',
      dealId: null,
      assignedSalespersonId: 'user-sales',
      date: '2025-09-22',
      currency: 'PKR',
      status: 'Confirmed', // 0 delivered
      subtotal: 75000,
      tax: 0,
      discount: 0,
      total: 75000,
      notes: 'Full order to be dispatched upon confirmation',
      gdnIds: [],
      lines: [
        {
          id: 'sol-2',
          variantId: 'var-fan-assembled',
          orderedQty: 20,
          deliveredQty: 0,
          invoicedQty: 0,
          unit: 'PCS',
          unitPrice: 3750,
          lineTotal: 75000,
          notes: 'Assembled Cone Fan 50"'
        }
      ]
    }
  ],

  // Stock Inward Orders (Generic Expected Inbound - No physical stock addition)
  stockInwardOrders: [
    {
      id: 'sio-1',
      orderNumber: 'SIO-00001',
      partyName: 'Shanghai Poultry Equipment Co.',
      referenceNumber: 'BL-984210 / Container MSCU-8491024',
      date: '2025-09-18',
      expectedArrivalDate: '2025-09-22',
      targetWarehouseId: 'wh-1',
      status: 'Partially Received', // Draft, Confirmed, Partially Received, Fully Received, Cancelled
      source_type: 'PURCHASE',
      source_id: 'imp-1',
      grnIds: ['gp-in-1'],
      notes: 'Incoming container shipment of feed pans and feeding line components',
      lines: [
        {
          id: 'siol-1',
          variantId: 'var-1',
          expectedQty: 500,
          receivedQty: 300,
          unit: 'PCS',
          notes: 'Feed Pan 16" - China'
        },
        {
          id: 'siol-2',
          variantId: 'var-3',
          expectedQty: 2000,
          receivedQty: 2000,
          unit: 'PCS',
          notes: 'Drip Cup 360'
        }
      ],
      createdBy: 'user-wh-mgr',
      createdAt: '2025-09-18T09:00:00Z'
    },
    {
      id: 'sio-2',
      orderNumber: 'SIO-00002',
      partyName: 'Lahore Electric Motors Ltd.',
      referenceNumber: 'DC-4421',
      date: '2025-09-22',
      expectedArrivalDate: '2025-09-24',
      targetWarehouseId: 'wh-1',
      status: 'Confirmed',
      source_type: 'PURCHASE',
      source_id: null,
      grnIds: [],
      notes: 'Batch of 1.5 kW cooler motors',
      lines: [
        {
          id: 'siol-3',
          variantId: 'var-motor-cooler',
          expectedQty: 50,
          receivedQty: 0,
          unit: 'PCS',
          notes: 'Air Cooler Motor 1.5 kW'
        }
      ],
      createdBy: 'user-wh-mgr',
      createdAt: '2025-09-22T10:30:00Z'
    }
  ],

  // Gatepasses (Warehouse operational logistics documents: GDN = Outward, GRN = Inward)
  gatepasses: [
    {
      id: 'gp-1',
      gatepassNumber: 'GP-00001',
      gatepassType: 'outward',
      salesOrderId: 'so-1',
      warehouseId: 'wh-1',
      customerPartyId: 'pty-1',
      customerName: 'Ryan Korsgaard — Ergo Systems Ltd.',
      farmId: 'farm-1',
      assignedSalespersonId: 'user-sales',
      assignedStaffIds: ['user-wh-staff', 'user-office-staff'],
      date: '2025-09-16',
      vehicleNumber: 'LES-9412 Hino Truck',
      driverName: 'Muhammad Rasheed',
      driverPhone: '+92 345 6789012',
      status: 'Approved - Ready to Deliver',
      notes: 'Partial dispatch of 50 pcs for Bhai Pheru site.',
      staffProofs: [],
      lines: [
        { variantId: 'var-1', warehouseQty: 30, officeQty: 20, quantity: 50, unit: 'PCS', negotiatedRate: 1400 }
      ]
    },
    {
      id: 'gp-in-1',
      gatepassNumber: 'GRN-00001',
      gatepassType: 'inward',
      inwardOrderId: 'sio-1',
      partyName: 'Shanghai Poultry Equipment Co.',
      targetWarehouseId: 'wh-1',
      assignedStaffIds: ['user-wh-alitoor', 'user-wh-zain'],
      date: '2025-09-20',
      vehicleNumber: 'LES-9412 Container Trailer',
      driverName: 'Muhammad Rasheed',
      driverPhone: '+92 345 6789012',
      transporterName: 'Al-Madina Goods Transport',
      biltyNumber: 'BL-984210',
      status: 'Verified & Stock In',
      notes: 'First batch of 300 feed pans and 2000 drip cups unloaded in good condition.',
      staffProofs: [],
      lines: [
        { variantId: 'var-1', quantity: 300, warehouseQty: 300, officeQty: 0, unit: 'PCS', conditionNotes: 'Intact, seal verified' },
        { variantId: 'var-3', quantity: 2000, warehouseQty: 2000, officeQty: 0, unit: 'PCS', conditionNotes: 'Good condition' }
      ],
      createdBy: 'user-wh-mgr',
      createdAt: '2025-09-20T14:00:00Z',
      verifiedAt: '2025-09-20T16:30:00Z',
      verifiedByUserId: 'user-wh-mgr'
    },
    {
      id: 'gp-2',
      gatepassNumber: 'GP-00002',
      gatepassType: 'outward',
      salesOrderId: 'so-1',
      customerPartyId: 'pty-1',
      farmId: 'farm-1',
      assignedSalespersonId: 'user-sales',
      assignedStaffIds: ['user-wh-staff', 'user-office-staff'],
      date: '2025-09-22',
      vehicleNumber: 'MN-782 Mazda Titan',
      driverName: 'Muhammad Aslam',
      driverPhone: '+92 300 9876543',
      status: 'Draft - Staff Assigned',
      notes: 'Urgent delivery for Okara Sheds. Items allocated across Warehouse and Office.',
      staffProofs: [],
      lines: [
        { variantId: 'var-1', warehouseQty: 100, officeQty: 20, quantity: 120, unit: 'PCS', negotiatedRate: 1450 },
        { variantId: 'var-3', warehouseQty: 500, officeQty: 150, quantity: 650, unit: 'PCS', negotiatedRate: 105 }
      ]
    }
  ],

  // Deliveries (Atomic stock deduction engine)
  deliveries: [
    {
      id: 'del-1',
      deliveryNumber: 'DEL-00001',
      salesOrderId: 'so-1',
      customerPartyId: 'pty-1',
      farmId: 'farm-1',
      warehouseId: 'wh-1',
      date: '2025-09-16',
      vehicleNumber: 'LES-9412 Hino Truck',
      driverName: 'Muhammad Rasheed',
      driverPhone: '+92 345 6789012',
      status: 'Confirmed', // Confirmed deducted 40 pans!
      notes: 'First batch of 40 pieces delivered successfully.',
      lines: [
        { salesOrderLineId: 'sol-1', variantId: 'var-1', deliveredQuantity: 40, unit: 'PCS' }
      ]
    }
  ],

  // Sales Invoices (Financial document - does NOT touch stock)
  salesInvoices: [
    {
      id: 'inv-1',
      invoiceNumber: 'INV-00001',
      salesOrderId: 'so-1',
      deliveryId: 'del-1',
      customerPartyId: 'pty-1',
      farmId: 'farm-1',
      dealId: 'deal-1',
      date: '2025-09-18',
      dueDate: '2025-10-18',
      currency: 'PKR',
      exchangeRate: 1.0,
      subtotal: 56000, // 40 delivered pans x 1400
      tax: 0,
      discount: 0,
      total: 56000,
      paidAmount: 0,
      status: 'Confirmed',
      notes: 'Billed for Delivered Batch #1 (40 units). Stock unaffected by invoice confirmation.',
      lines: [
        { variantId: 'var-1', quantity: 40, unit: 'PCS', unitPrice: 1400, lineTotal: 56000 }
      ]
    }
  ],

  // Assembly Recipes / BOMs
  assemblyRecipes: [
    {
      id: 'rec-1',
      recipeNumber: 'REC-00001',
      name: 'Air Cooler 18" Assembly',
      assemblyType: 'MANUFACTURING',
      finishedVariantId: 'var-4', // Air Cooler 1.5 kW + With Pad
      defaultOutputQuantity: 100,
      defaultLaborRate: 500,
      laborRateType: 'per_unit',
      defaultLaborPartyId: 'pty-labor-1', // ABC Assembly Workshop
      defaultSourceWarehouseId: 'wh-1',
      defaultOutputWarehouseId: 'wh-1',
      isActive: true,
      version: 1,
      notes: 'Standard 18" Industrial Air Cooler BOM: 1 Body, 1 Motor, 1 Cooling Pad + Rs. 500 labor per unit',
      components: [
        { id: 'rc-1', componentVariantId: 'var-cooler-body', quantityPerUnit: 1, sequence: 1, unit: 'PCS' },
        { id: 'rc-2', componentVariantId: 'var-6', quantityPerUnit: 1, sequence: 2, unit: 'PCS' }, // Motor
        { id: 'rc-3', componentVariantId: 'var-pad-100', quantityPerUnit: 1, sequence: 3, unit: 'PCS' } // Pad
      ],
      createdAt: '2025-09-01T08:00:00Z',
      createdBy: 'user-admin'
    },
    {
      id: 'rec-2',
      recipeNumber: 'REC-00002',
      name: 'Assembled Fan 50" Finishing',
      assemblyType: 'FINISHING',
      finishedVariantId: 'var-fan-assembled',
      defaultOutputQuantity: 50,
      defaultLaborRate: 150,
      laborRateType: 'per_unit',
      defaultLaborPartyId: 'pty-labor-2', // XYZ Fan Assembly
      defaultSourceWarehouseId: 'wh-1',
      defaultOutputWarehouseId: 'wh-1',
      isActive: true,
      version: 1,
      notes: 'Single-product finishing: Imported Complete Fan x 1 + Rs. 150 labor -> Assembled Fan',
      components: [
        { id: 'rc-4', componentVariantId: 'var-fan-imported', quantityPerUnit: 1, sequence: 1, unit: 'PCS' }
      ],
      createdAt: '2025-09-01T08:00:00Z',
      createdBy: 'user-admin'
    }
  ],

  // Disassembly Templates / Salvage BOMs
  disassemblyTemplates: [
    {
      id: 'dt-1',
      templateNumber: 'DT-00001',
      name: 'Fan 50" Standard Breakdown Template',
      sourceVariantId: 'var-fan-imported',
      notes: 'Standard salvage breakdown for 50-inch fan into motor, blades, pulley, and body',
      isActive: true,
      components: [
        { id: 'dtc-1', componentVariantId: 'var-6', defaultQuantity: 1, unit: 'PCS', allocatedCost: 5500 }, // Motor
        { id: 'dtc-2', componentVariantId: 'var-7', defaultQuantity: 1, unit: 'PCS', allocatedCost: 2000 }, // Blades
        { id: 'dtc-3', componentVariantId: 'var-pulley', defaultQuantity: 1, unit: 'PCS', allocatedCost: 800 }, // Pulley
        { id: 'dtc-4', componentVariantId: 'var-fan-body', defaultQuantity: 1, unit: 'PCS', allocatedCost: 1200 } // Body
      ]
    },
    {
      id: 'dt-2',
      templateNumber: 'DT-00002',
      name: 'Air Cooler Salvage Breakdown',
      sourceVariantId: 'var-4',
      notes: 'Salvage recovered motor, blades, and pump from damaged cooler',
      isActive: true,
      components: [
        { id: 'dtc-5', componentVariantId: 'var-6', defaultQuantity: 1, unit: 'PCS', allocatedCost: 18500 },
        { id: 'dtc-6', componentVariantId: 'var-7', defaultQuantity: 1, unit: 'PCS', allocatedCost: 9500 },
        { id: 'dtc-7', componentVariantId: 'var-8', defaultQuantity: 1, unit: 'PCS', allocatedCost: 3800 }
      ]
    }
  ],

  // Assemblies
  assemblies: [
    {
      id: 'asm-1',
      assemblyNumber: 'ASM-00001',
      recipeId: 'rec-1',
      assemblyType: 'MANUFACTURING',
      warehouseId: 'wh-1',
      sourceWarehouseId: 'wh-1',
      outputWarehouseId: 'wh-1',
      finishedVariantId: 'var-4', // Air Cooler 1.5 kW + With Pad
      quantity: 2,
      finishedQuantity: 2,
      assemblyDate: '2025-09-12',
      status: 'Completed',
      laborPartyId: 'pty-labor-1',
      laborRate: 500,
      laborRateType: 'per_unit',
      laborQuantity: 2,
      materialCost: 62600,
      laborCost: 1000,
      totalCost: 63600,
      unitFinishedCost: 31800,
      notes: 'Assembled 2 Industrial Evaporative Coolers using China motors and axial blades',
      completedBy: 'user-admin',
      completedAt: '2025-09-12T14:00:00Z',
      lines: [
        { componentVariantId: 'var-6', recipeQuantity: 2, actualQuantity: 2, quantityConsumed: 2, unit: 'PCS', unitCost: 18500, totalCost: 37000 },
        { componentVariantId: 'var-7', recipeQuantity: 2, actualQuantity: 2, quantityConsumed: 2, unit: 'PCS', unitCost: 9500, totalCost: 19000 },
        { componentVariantId: 'var-8', recipeQuantity: 2, actualQuantity: 2, quantityConsumed: 2, unit: 'PCS', unitCost: 3800, totalCost: 7600 }
      ]
    }
  ],

  // Disassemblies
  disassemblies: [
    {
      id: 'dis-1',
      disassemblyNumber: 'DIS-00001',
      warehouseId: 'wh-1',
      sourceVariantId: 'var-fan-imported',
      sourceQuantity: 1,
      finishedVariantId: 'var-fan-imported',
      finishedQuantity: 1,
      disassemblyDate: '2025-09-15',
      status: 'Completed',
      totalSourceCost: 9500,
      totalRecoveredCost: 9500,
      notes: 'Salvaged motor and blades for farm replacement call',
      completedBy: 'user-admin',
      completedAt: '2025-09-15T11:30:00Z',
      lines: [
        { componentVariantId: 'var-6', quantityRestored: 1, actualQuantity: 1, unitCost: 5500, totalCost: 5500, unit: 'PCS' },
        { componentVariantId: 'var-7', quantityRestored: 1, actualQuantity: 1, unitCost: 2000, totalCost: 2000, unit: 'PCS' },
        { componentVariantId: 'var-pulley', quantityRestored: 1, actualQuantity: 1, unitCost: 800, totalCost: 800, unit: 'PCS' },
        { componentVariantId: 'var-fan-body', quantityRestored: 1, actualQuantity: 1, unitCost: 1200, totalCost: 1200, unit: 'PCS' }
      ]
    }
  ],

  // Assembly Labor Payables
  assemblyPayables: [
    {
      id: 'alp-1',
      payableNumber: 'ALP-00001',
      assemblyId: 'asm-1',
      assemblyNumber: 'ASM-00001',
      laborPartyId: 'pty-labor-1', // ABC Assembly Workshop
      date: '2025-09-12',
      amount: 1000,
      paidAmount: 0,
      remainingAmount: 1000,
      status: 'Unpaid',
      createdAt: '2025-09-12T14:00:00Z'
    }
  ],

  // Assembly Labor Payments
  assemblyPayments: [],

  // Bundle Definitions (Sets & Variable Systems)
  bundleDefinitions: [
    {
      id: 'bnd-feed-line',
      code: 'BND-FEED',
      name: 'Automatic Feeding Line',
      bundleQty: 1,
      sellingPrice: 185000,
      notes: 'Complete automated broiler feeding line.',
      components: [
        {
          id: 'bc-1',
          componentVariantId: 'var-hanger',
          quantity: 40,
          unit: 'PCS'
        },
        {
          id: 'bc-2',
          componentVariantId: 'var-1', // Feed Pan
          quantity: 40,
          unit: 'PCS'
        },
        {
          id: 'bc-3',
          componentVariantId: 'var-pipe-galv', // Galvanized Pipe
          quantity: 400,
          unit: 'FT'
        },
        {
          id: 'bc-4',
          componentVariantId: 'var-handle', // Winch Handle
          quantity: 1,
          unit: 'PCS'
        }
      ]
    },
    {
      id: 'bnd-drink-line',
      code: 'BND-DRINK',
      name: 'Automatic Drinking Line',
      bundleQty: 1,
      sellingPrice: 95000,
      notes: 'Poultry nipple drinking line system.',
      components: [
        {
          id: 'bc-5',
          componentVariantId: 'var-3', // Nipple 360
          quantity: 50,
          unit: 'PCS'
        },
        {
          id: 'bc-6',
          componentVariantId: 'var-pipe-galv',
          quantity: 400,
          unit: 'FT'
        },
        {
          id: 'bc-7',
          componentVariantId: 'var-regulator',
          quantity: 1,
          unit: 'PCS'
        },
        {
          id: 'bc-8',
          componentVariantId: 'var-handle',
          quantity: 1,
          unit: 'PCS'
        }
      ]
    },
    {
      id: 'bnd-pulley-set',
      code: 'BND-PULLEY-SET',
      name: 'Pulley Set',
      bundleQty: 1,
      sellingPrice: 10800,
      notes: '1 fan pulley set = 1 fan pulley + 3 fan blades',
      components: [
        {
          id: 'bc-9',
          componentVariantId: 'var-pulley',
          quantity: 1,
          unit: 'PCS'
        },
        {
          id: 'bc-10',
          componentVariantId: 'var-7', // Fan Blade
          quantity: 3,
          unit: 'PCS'
        }
      ]
    },
    {
      id: 'bnd-inverter-set',
      code: 'BND-INVERTER-SET',
      name: 'Complete Inverter Set',
      bundleQty: 1,
      sellingPrice: 46000,
      notes: 'Complete Inverter Set: Inverter x 1, Remote x 1, Display x 1, Wire x 50 ft',
      components: [
        {
          id: 'bc-11',
          componentVariantId: 'var-inverter',
          quantity: 1,
          unit: 'PCS'
        },
        {
          id: 'bc-12',
          componentVariantId: 'var-remote',
          quantity: 1,
          unit: 'PCS'
        },
        {
          id: 'bc-13',
          componentVariantId: 'var-display',
          quantity: 1,
          unit: 'PCS'
        },
        {
          id: 'bc-14',
          componentVariantId: 'var-5', // Wire
          quantity: 50,
          unit: 'FT'
        }
      ]
    }
  ],

  // Purchasing & Import Shipments
  importShipments: [
    {
      id: 'imp-1',
      shipmentNumber: 'IMP-00001',
      supplierPartyId: 'pty-3',
      shippingTerm: 'FOB', // FOB vs EXW
      originCountry: 'China',
      originPort: 'Ningbo Port',
      destinationPort: 'Karachi Port Qasim',
      containerNumber: 'MSCU-8491024 / 40HQ',
      blNumber: 'MSK-PK-789012',
      carrierName: 'Maersk Line',
      etd: '2025-09-02',
      eta: '2025-09-28',
      clearingAgent: 'Al-Hussain Cargo Logistics',
      trackingProvider: 'Tracktainer',
      trackingNumber: 'MSCU8491024',
      trackingMode: 'Automatic',
      currentStatus: 'In Transit - Indian Ocean',
      currentLocation: 'Passing Malacca Strait (Lat 2.4°N, Lon 101.8°E)',
      status: 'Shipped',
      remainingCredits: 14,
      expenses: [
        { name: 'Ocean Freight (40HQ Container)', amountPkr: 685000, isLandedCostEligible: true },
        { name: 'Import Customs Duty & FBR Taxes', amountPkr: 420000, isLandedCostEligible: true },
        { name: 'Port Clearance & Documentation', amountPkr: 85000, isLandedCostEligible: true },
        { name: 'Port to Lahore Multan Rd Trucking', amountPkr: 145000, isLandedCostEligible: true }
      ],
      allocationMethod: 'Value' // Value, Quantity, Weight, Volume
    },
    {
      id: 'imp-txgu6848701',
      shipmentNumber: 'IMP-00002',
      supplierPartyId: 'pty-4',
      shippingTerm: 'FOB',
      originCountry: 'China',
      originPort: 'Qingdao',
      destinationPort: 'Karachi',
      polCode: 'CNTAO',
      podCode: 'PKKHI',
      containerNumber: 'TXGU6848701',
      blNumber: 'BL-TXGU6848701',
      carrierName: 'TS Lines',
      vesselName: 'KMTC CHENNAI',
      vesselImo: '9375513',
      voyage: '2605W',
      etd: '2026-08-31',
      eta: '2026-10-03',
      transitTime: 33,
      delayDays: 0,
      containerCount: 1,
      transshipmentCount: 0,
      co2: 0.93,
      trackingProvider: 'Tracktainer',
      trackingNumber: 'TXGU6848701',
      trackingMode: 'Automatic',
      shipmentStatus: 'IN_TRANSIT',
      currentStatus: 'Departed · Qingdao, China',
      currentLocation: 'Malacca Strait (Lat 3.5°N, Lon 100.5°E)',
      status: 'Shipped',
      remainingCredits: 14,
      containers: [
        {
          container_number: 'TXGU6848701',
          container_size: 20,
          container_type: 'HC',
          latest_movement: {
            event: 'DEPA',
            classifier: 'ACT',
            date: '2026-08-31',
            location: { name: 'Qingdao', code: 'CNTAO', country: { name: 'China', code: 'CN' } },
            vessel: { name: 'KMTC CHENNAI', imo: 9375513, call_sign: 'D7KC' },
            voyage: '2605W',
            transport_mode: 'VESSEL'
          },
          movements: [
            { event: 'EMSH', classifier: 'ACT', date: '2026-08-24', location: { name: 'Qingdao', code: 'CNTAO', country: { name: 'China', code: 'CN' } }, vessel: { name: 'KMTC CHENNAI', imo: 9375513, call_sign: 'D7KC' }, voyage: '2605W', transport_mode: 'VESSEL' },
            { event: 'GTIN', classifier: 'ACT', date: '2026-08-27', location: { name: 'Qingdao', code: 'CNTAO', country: { name: 'China', code: 'CN' } }, vessel: { name: 'KMTC CHENNAI', imo: 9375513, call_sign: 'D7KC' }, voyage: '2605W', transport_mode: 'VESSEL' },
            { event: 'GTIN', classifier: 'ACT', date: '2026-08-31', location: { name: 'Qingdao', code: 'CNTAO', country: { name: 'China', code: 'CN' } }, vessel: { name: 'KMTC CHENNAI', imo: 9375513, call_sign: 'D7KC' }, voyage: '2605W', transport_mode: 'VESSEL' },
            { event: 'LOAD', classifier: 'ACT', date: '2026-08-31', location: { name: 'Qingdao', code: 'CNTAO', country: { name: 'China', code: 'CN' } }, vessel: { name: 'KMTC CHENNAI', imo: 9375513, call_sign: 'D7KC' }, voyage: '2605W', transport_mode: 'VESSEL' },
            { event: 'DEPA', classifier: 'ACT', date: '2026-08-31', location: { name: 'Qingdao', code: 'CNTAO', country: { name: 'China', code: 'CN' } }, vessel: { name: 'KMTC CHENNAI', imo: 9375513, call_sign: 'D7KC' }, voyage: '2605W', transport_mode: 'VESSEL' },
            { event: 'ARRI', classifier: 'EST', date: '2026-10-03', location: { name: 'Karachi', code: 'PKKHI', country: { name: 'Pakistan', code: 'PK' } }, vessel: { name: 'KMTC CHENNAI', imo: 9375513, call_sign: 'D7KC' }, voyage: '2605W', transport_mode: 'VESSEL' }
          ]
        }
      ],
      expenses: [
        { name: 'Ocean Freight (40HQ Container)', amountPkr: 720000, isLandedCostEligible: true },
        { name: 'Import Customs Duty & FBR Taxes', amountPkr: 380000, isLandedCostEligible: true },
        { name: 'Port Clearance & Documentation', amountPkr: 95000, isLandedCostEligible: true },
        { name: 'Port to Lahore Multan Rd Trucking', amountPkr: 160000, isLandedCostEligible: true }
      ],
      allocationMethod: 'Value'
    }
  ],

  purchaseBills: [
    {
      id: 'pur-1',
      billNumber: 'PUR-00001',
      supplierPartyId: 'pty-3',
      date: '2025-09-02',
      currency: 'USD',
      exchangeRate: 280.0,
      subtotal: 12500, // USD
      tax: 0,
      freight: 2450,
      total: 14950,
      paidAmount: 5000,
      status: 'Pending', // Marked Pending for review
      notes: 'Advance 30% paid. Balance payable on BL original copy presentation.'
    }
  ],

  // 4-Level Chart of Accounts
  chartOfAccounts: [
    { id: 'coa-1', code: '1000', name: 'Assets', type: 'Asset', level: 1, parentId: null },
    { id: 'coa-2', code: '1100', name: 'Current Assets', type: 'Asset', level: 2, parentId: 'coa-1' },
    { id: 'coa-3', code: '1110', name: 'Cash & Bank Balances', type: 'Asset', level: 3, parentId: 'coa-2' },
    { id: 'coa-4', code: '1111', name: 'Meezan Bank - Main Commercial Account', type: 'Asset', level: 4, parentId: 'coa-3' },
    { id: 'coa-5', code: '1120', name: 'Accounts Receivable (Trade Debtors)', type: 'Asset', level: 3, parentId: 'coa-2' },
    { id: 'coa-6', code: '1130', name: 'Inventory Asset (Merchandise Held)', type: 'Asset', level: 3, parentId: 'coa-2' },

    { id: 'coa-7', code: '2000', name: 'Liabilities', type: 'Liability', level: 1, parentId: null },
    { id: 'coa-8', code: '2100', name: 'Current Liabilities', type: 'Liability', level: 2, parentId: 'coa-7' },
    { id: 'coa-9', code: '2110', name: 'Accounts Payable (Trade Creditors)', type: 'Liability', level: 3, parentId: 'coa-8' },
    { id: 'coa-assembly-payable', code: '2120', name: 'Assembly Labor Payable', type: 'Liability', level: 3, parentId: 'coa-8' },

    { id: 'coa-10', code: '3000', name: 'Equity', type: 'Equity', level: 1, parentId: null },
    { id: 'coa-11', code: '3100', name: 'Owner Capital & Retained Earnings', type: 'Equity', level: 2, parentId: 'coa-10' },

    { id: 'coa-12', code: '4000', name: 'Operating Revenue', type: 'Income', level: 1, parentId: null },
    { id: 'coa-13', code: '4100', name: 'Sales Revenue - Poultry Equipment', type: 'Income', level: 2, parentId: 'coa-12' },

    { id: 'coa-14', code: '5000', name: 'Cost of Goods Sold', type: 'Expense', level: 1, parentId: null },
    { id: 'coa-15', code: '5100', name: 'Cost of Sales - Equipment & Parts', type: 'Expense', level: 2, parentId: 'coa-14' },
    { id: 'coa-disassembly-variance', code: '5150', name: 'Disassembly Scrap / Variance', type: 'Expense', level: 2, parentId: 'coa-14' },
    { id: 'coa-16', code: '6000', name: 'Operating Expenses', type: 'Expense', level: 1, parentId: null },
    { id: 'coa-17', code: '6100', name: 'Freight, Logistics & Storage', type: 'Expense', level: 2, parentId: 'coa-16' }
  ],

  journalEntries: [
    {
      id: 'je-1',
      entryNumber: 'JE-00001',
      date: '2025-09-01',
      memo: 'Opening inventory asset valuation',
      isPosted: true,
      lines: [
        { accountId: 'coa-6', debit: 5349000, credit: 0, description: 'Opening stock asset' },
        { accountId: 'coa-11', debit: 0, credit: 5349000, description: 'Owner opening equity' }
      ]
    }
  ],

  bankAccounts: [
    { id: 'ba-1', name: 'Meezan Bank - Main Commercial', accountNumber: '0102-0100984711', iban: 'PK45MEZN0001020100984711', currency: 'PKR', balance: 4850000, glAccountId: 'coa-4' },
    { id: 'ba-2', name: 'Bank Alfalah - Foreign Exchange (USD)', accountNumber: '5512-009841', iban: 'PK22ALFH00551200984100', currency: 'USD', balance: 34500, glAccountId: 'coa-4' }
  ],

  // Notifications
  notifications: [
    { id: 'notif-1', title: 'Gatepass Assigned', message: 'Warehouse Manager submitted GP-00001 for Ali Poultry Group. Rates pending.', type: 'info', link: 'gatepass', isRead: false, createdAt: '2025-09-16T14:30:00Z' },
    { id: 'notif-2', title: 'Container Tracktainer Alert', message: 'Shipment IMP-00001 Maersk container MSCU-8491024 passed Singapore waypoint. ETA unchanged.', type: 'info', link: 'shipments', isRead: false, createdAt: '2025-09-17T09:15:00Z' },
    { id: 'notif-3', title: 'Low Stock Alert', message: 'Air Cooler 1.5 kW stock has fallen to 8 pcs (Minimum reorder level: 10 pcs).', type: 'warning', link: 'inventory', isRead: false, createdAt: '2025-09-18T11:00:00Z' }
  ],

  // Generic Tags & Custom Fields
  tags: [
    { id: 'tag-1', name: 'VIP Customer', color: '#10B981' },
    { id: 'tag-2', name: 'China Direct Import', color: '#138FCB' },
    { id: 'tag-3', name: 'Urgent Delivery', color: '#EF4444' },
    { id: 'tag-4', name: 'Credit Customer', color: '#F59E0B' }
  ],

  tagAssignments: [
    { tagId: 'tag-1', entityType: 'customer', entityId: 'pty-1' },
    { tagId: 'tag-2', entityType: 'supplier', entityId: 'pty-3' }
  ],

  customFields: [
    { id: 'cf-1', module: 'customer', name: 'shed_type', label: 'Poultry Shed Type', type: 'select', options: ['Environment Controlled (EC)', 'Semi-Controlled', 'Open Shed'] },
    { id: 'cf-2', module: 'shipment', name: 'fbr_gd_number', label: 'FBR Goods Declaration (GD) No.', type: 'text' }
  ],

  customFieldValues: [
    { definitionId: 'cf-1', entityId: 'pty-1', value: 'Environment Controlled (EC)' }
  ],

  // Users for Role Demonstration & Staff Mobile App
  users: [
    { id: 'user-owner', fullName: 'Muhammad Jamil', username: 'owner', pin: '0000', roleCode: 'owner', email: 'jamil@jstraders.pk', phone: '+92 300 1110000', activeWarehouseId: 'wh-1' },
    { id: 'user-admin', fullName: 'Admin User', username: 'admin', pin: '9999', roleCode: 'admin', email: 'admin@jstraders.pk', phone: '+92 300 2220000', activeWarehouseId: 'wh-1' },
    { id: 'user-wh-mgr', fullName: 'Tariq Mehmood', username: 'tariq_wh', pin: '1122', roleCode: 'warehouse_manager', email: 'tariq@jstraders.pk', phone: '+92 300 1234567', activeWarehouseId: 'wh-1' },
    { id: 'user-office-mudassar', fullName: 'Mudassar', username: 'mudassar_office', pin: '5678', roleCode: 'warehouse_staff', staffType: 'office_staff', email: 'mudassar@jstraders.pk', phone: '+92 302 7775678', activeWarehouseId: 'wh-2', status: 'Active' },
    { id: 'user-wh-alitoor', fullName: 'Ali Toor', username: 'ali_toor', pin: '1111', roleCode: 'warehouse_staff', staffType: 'warehouse_staff', email: 'alitoor@jstraders.pk', phone: '+92 301 5551111', activeWarehouseId: 'wh-1', status: 'Active' },
    { id: 'user-wh-alichhota', fullName: 'Ali Chhota', username: 'ali_chhota', pin: '2222', roleCode: 'warehouse_staff', staffType: 'warehouse_staff', email: 'alichhota@jstraders.pk', phone: '+92 301 5552222', activeWarehouseId: 'wh-1', status: 'Active' },
    { id: 'user-wh-zain', fullName: 'Zain', username: 'zain', pin: '3333', roleCode: 'warehouse_staff', staffType: 'warehouse_staff', email: 'zain@jstraders.pk', phone: '+92 301 5553333', activeWarehouseId: 'wh-1', status: 'Active' },
    { id: 'user-sales', fullName: 'Salung Prastyo', username: 'salung_sales', pin: '3344', roleCode: 'sales_person', email: 'salung@jstraders.pk', phone: '+92 300 3330000', activeWarehouseId: 'wh-1' },
    { id: 'user-accounts', fullName: 'Farhan Zaidi', username: 'farhan_acc', pin: '5566', roleCode: 'accounts', email: 'farhan@jstraders.pk', phone: '+92 300 4440000', activeWarehouseId: 'wh-1' }
  ],

  // Staff Mobile Notifications
  staffNotifications: [
    {
      id: 'notif-1',
      staffId: 'user-wh-alitoor',
      gatepassId: 'gp-1',
      gatepassNumber: 'GP-00001',
      title: 'New Stock Fetch Task: GP-00001',
      message: 'Fetch 150 pcs Feed Pan 16" from Warehouse for Ali Poultry Group.',
      isRead: false,
      createdAt: '2025-09-12T11:00:00Z'
    },
    {
      id: 'notif-2',
      staffId: 'user-office-mudassar',
      gatepassId: 'gp-1',
      gatepassNumber: 'GP-00001',
      title: 'New Office Stock Fetch Task: GP-00001',
      message: 'Fetch 50 pcs Feed Pan 16" from Office for Ali Poultry Group.',
      isRead: false,
      createdAt: '2025-09-12T11:00:00Z'
    }
  ]
};

class StorageService {
  constructor() {
    this.listeners = new Map();
    this.db = null;
    this.syncVersion = 0;
    this.isSyncing = false;
    this.init();
  }

  init() {
    try {
      const stored = (typeof localStorage !== 'undefined') ? localStorage.getItem(STORAGE_KEY) : null;
      if (stored) {
        this.db = JSON.parse(stored);
        // Ensure cutToLength collections and updated products are present in existing stored DB
        if (!this.db.cutToLengthUnits || !this.db.cutToLengthUnits.length) {
          this.db.cutToLengthUnits = JSON.parse(JSON.stringify(SEED_DATABASE.cutToLengthUnits));
        }
        if (!this.db.cutToLengthTransactions || !this.db.cutToLengthTransactions.length) {
          this.db.cutToLengthTransactions = JSON.parse(JSON.stringify(SEED_DATABASE.cutToLengthTransactions));
        }
        if (this.db.products && !this.db.products.some(p => p.id === 'prod-9')) {
          const prod9 = SEED_DATABASE.products.find(p => p.id === 'prod-9');
          if (prod9) this.db.products.push(JSON.parse(JSON.stringify(prod9)));
        }
        // Ensure Auger 400ft and 450ft variants exist
        if (this.db.variants) {
          this.db.variants = this.db.variants.filter(v => v.id !== 'var-9');
          if (!this.db.variants.some(v => v.id === 'var-9-450')) {
            const v450 = SEED_DATABASE.variants.find(v => v.id === 'var-9-450');
            if (v450) this.db.variants.push(JSON.parse(JSON.stringify(v450)));
          }
          if (!this.db.variants.some(v => v.id === 'var-9-400')) {
            const v400 = SEED_DATABASE.variants.find(v => v.id === 'var-9-400');
            if (v400) this.db.variants.push(JSON.parse(JSON.stringify(v400)));
          }
        }

        // Ensure new assembly/disassembly/bundle products and variants exist in stored DB
        if (!this.db.products) this.db.products = [];
        SEED_DATABASE.products.forEach(sp => {
          if (!this.db.products.some(p => p.id === sp.id)) {
            this.db.products.push(JSON.parse(JSON.stringify(sp)));
          }
        });

        if (!this.db.variants) this.db.variants = [];
        SEED_DATABASE.variants.forEach(sv => {
          if (!this.db.variants.some(v => v.id === sv.id)) {
            this.db.variants.push(JSON.parse(JSON.stringify(sv)));
          }
        });

        // Ensure assembly and disassembly collections exist
        if (!this.db.assemblyRecipes || !this.db.assemblyRecipes.length) {
          this.db.assemblyRecipes = JSON.parse(JSON.stringify(SEED_DATABASE.assemblyRecipes));
        }
        if (!this.db.disassemblyTemplates || !this.db.disassemblyTemplates.length) {
          this.db.disassemblyTemplates = JSON.parse(JSON.stringify(SEED_DATABASE.disassemblyTemplates));
        }
        if (!this.db.bundleDefinitions || !this.db.bundleDefinitions.length) {
          this.db.bundleDefinitions = JSON.parse(JSON.stringify(SEED_DATABASE.bundleDefinitions));
        }
        if (!this.db.assemblies || !this.db.assemblies.length) {
          this.db.assemblies = JSON.parse(JSON.stringify(SEED_DATABASE.assemblies));
        }
        if (!this.db.disassemblies || !this.db.disassemblies.length) {
          this.db.disassemblies = JSON.parse(JSON.stringify(SEED_DATABASE.disassemblies));
        }
        if (!this.db.assemblyPayables) {
          this.db.assemblyPayables = JSON.parse(JSON.stringify(SEED_DATABASE.assemblyPayables));
        }
        if (!this.db.assemblyPayments) {
          this.db.assemblyPayments = [];
        }

        // Ensure stockInwardOrders collection exists
        if (!this.db.stockInwardOrders || !this.db.stockInwardOrders.length) {
          this.db.stockInwardOrders = JSON.parse(JSON.stringify(SEED_DATABASE.stockInwardOrders));
        }

        // Ensure Labor Parties exist in parties
        if (!this.db.parties) this.db.parties = [];
        SEED_DATABASE.parties.forEach(sp => {
          if (sp.isLaborParty && !this.db.parties.some(p => p.id === sp.id)) {
            this.db.parties.push(JSON.parse(JSON.stringify(sp)));
          }
        });

        // Ensure Chart of Accounts has assembly & disassembly accounts
        if (!this.db.chartOfAccounts) this.db.chartOfAccounts = [];
        ['coa-assembly-payable', 'coa-disassembly-variance'].forEach(accId => {
          if (!this.db.chartOfAccounts.some(a => a.id === accId)) {
            const acc = SEED_DATABASE.chartOfAccounts.find(a => a.id === accId);
            if (acc) this.db.chartOfAccounts.push(JSON.parse(JSON.stringify(acc)));
          }
        });

        // Ensure stock balances exist for new variants
        if (!this.db.stockBalances) this.db.stockBalances = [];
        SEED_DATABASE.stockBalances.forEach(sb => {
          if (!this.db.stockBalances.some(b => b.warehouseId === sb.warehouseId && b.variantId === sb.variantId)) {
            this.db.stockBalances.push(JSON.parse(JSON.stringify(sb)));
          }
        });

        // Ensure physical units have variantId stamped
        if (this.db.cutToLengthUnits && Array.isArray(this.db.cutToLengthUnits)) {
          this.db.cutToLengthUnits.forEach(u => {
            if (!u.variantId) {
              if (u.productId === 'prod-4') {
                u.variantId = 'var-5';
              } else if (u.productId === 'prod-9') {
                if (Number(u.initialQuantity) === 400 || (u.packagingName && u.packagingName.includes('400')) || (u.code && u.code.startsWith('A1'))) {
                  u.variantId = 'var-9-400';
                } else {
                  u.variantId = 'var-9-450';
                }
              }
            }
          });
        }
        const p4 = (this.db.products || []).find(p => p.id === 'prod-4');
        if (p4 && (!p4.packagingUnits || !p4.packagingUnits.length)) {
          const seedP4 = SEED_DATABASE.products.find(p => p.id === 'prod-4');
          if (seedP4) {
            p4.customerName = seedP4.customerName;
            p4.cut_to_length = true;
            p4.enableRollTracking = true;
            p4.base_unit = seedP4.base_unit;
            p4.full_unit = seedP4.full_unit;
            p4.full_unit_quantity = seedP4.full_unit_quantity;
            p4.packagingUnits = JSON.parse(JSON.stringify(seedP4.packagingUnits));
          }
        }
      } else {
        this.resetToDefaults();
      }
    } catch (e) {
      console.warn('Storage initialisation error, falling back to memory seed:', e);
      this.db = JSON.parse(JSON.stringify(SEED_DATABASE));
    }

    this.hasPendingPush = false;
    // Start background cross-device sync
    if (typeof window !== 'undefined' && typeof fetch !== 'undefined') {
      this.startServerSync();
    }
  }

  mergeIncomingDb(incomingDb, incomingVersion) {
    if (!incomingDb) return;
    if (!this.db) {
      this.db = incomingDb;
      this.syncVersion = incomingVersion || this.syncVersion;
      return;
    }

    let hadLocalOnlyData = false;
    const merged = { ...this.db, ...incomingDb };

    // Smart-merge core operational collections
    const collections = [
      'gatepasses', 'staffNotifications', 'deliveries', 'salesOrders', 'stockInwardOrders', 'stockAdjustments',
      'stockBalances', 'stockMovements', 'cutToLengthUnits', 'cutToLengthTransactions', 'variantRollStocks',
      'users', 'assemblies', 'disassemblies', 'assemblyRecipes', 'disassemblyTemplates',
      'assemblyPayables', 'assemblyPayments', 'bundleDefinitions'
    ];
    for (const col of collections) {
      const localArr = Array.isArray(this.db[col]) ? this.db[col] : [];
      const incArr = Array.isArray(incomingDb[col]) ? incomingDb[col] : [];

      const getItemKey = (item) => {
        if (!item) return null;
        if (item.id) return item.id;
        if (item.warehouseId && item.variantId) {
          item.id = `bal-${item.warehouseId}-${item.variantId}`;
          return item.id;
        }
        return null;
      };

      const map = new Map();
      incArr.forEach(item => {
        const key = getItemKey(item);
        if (key) map.set(key, item);
      });

      localArr.forEach(item => {
        const key = getItemKey(item);
        if (!key) return;
        if (!map.has(key)) {
          // Local has a gatepass or record that server doesn't have yet (e.g. newly created GP-00007)!
          map.set(key, item);
          hadLocalOnlyData = true;
        } else {
          // Item exists in both: preserve local item if it has more proof photos or newer status
          const inc = map.get(key);
          const localProofs = (item.staffProofs || []).length;
          const incProofs = (inc.staffProofs || []).length;
          if (localProofs > incProofs) {
            map.set(key, { ...inc, ...item });
            hadLocalOnlyData = true;
          }
        }
      });

      merged[col] = Array.from(map.values());
    }

    // Guarantee essential seed entities exist in merged db
    if (Array.isArray(SEED_DATABASE.products)) {
      if (!Array.isArray(merged.products)) merged.products = [];
      const pIds = new Set(merged.products.map(p => p.id));
      SEED_DATABASE.products.forEach(sp => {
        if (!pIds.has(sp.id)) merged.products.push(JSON.parse(JSON.stringify(sp)));
      });
    }
    if (Array.isArray(SEED_DATABASE.variants)) {
      if (!Array.isArray(merged.variants)) merged.variants = [];
      const vIds = new Set(merged.variants.map(v => v.id));
      SEED_DATABASE.variants.forEach(sv => {
        if (!vIds.has(sv.id)) merged.variants.push(JSON.parse(JSON.stringify(sv)));
      });
    }
    if (Array.isArray(SEED_DATABASE.parties)) {
      if (!Array.isArray(merged.parties)) merged.parties = [];
      const partyIds = new Set(merged.parties.map(p => p.id));
      SEED_DATABASE.parties.forEach(sp => {
        if (!partyIds.has(sp.id)) merged.parties.push(JSON.parse(JSON.stringify(sp)));
      });
    }
    if (Array.isArray(SEED_DATABASE.chartOfAccounts)) {
      if (!Array.isArray(merged.chartOfAccounts)) merged.chartOfAccounts = [];
      const coaIds = new Set(merged.chartOfAccounts.map(c => c.id));
      SEED_DATABASE.chartOfAccounts.forEach(sc => {
        if (!coaIds.has(sc.id)) merged.chartOfAccounts.push(JSON.parse(JSON.stringify(sc)));
      });
    }
    if (Array.isArray(SEED_DATABASE.assemblyRecipes) && (!merged.assemblyRecipes || !merged.assemblyRecipes.length)) {
      merged.assemblyRecipes = JSON.parse(JSON.stringify(SEED_DATABASE.assemblyRecipes));
    }
    if (Array.isArray(SEED_DATABASE.bundleDefinitions) && (!merged.bundleDefinitions || !merged.bundleDefinitions.length)) {
      merged.bundleDefinitions = JSON.parse(JSON.stringify(SEED_DATABASE.bundleDefinitions));
    }
    if (Array.isArray(SEED_DATABASE.disassemblyTemplates) && (!merged.disassemblyTemplates || !merged.disassemblyTemplates.length)) {
      merged.disassemblyTemplates = JSON.parse(JSON.stringify(SEED_DATABASE.disassemblyTemplates));
    }

    this.db = merged;
    this.syncVersion = Math.max(this.syncVersion, incomingVersion || 0);

    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.db));
    } catch (e) {}

    this.notifyListeners('*');

    // If local had records that the server was missing, push with throttle
    if (hadLocalOnlyData && !this.isPushing) {
      setTimeout(() => this.pushToServer(), 300);
    }
  }

  async startServerSync() {
    try {
      const res = await fetch('/api/sync', { cache: 'no-store' });
      if (res.ok) {
        const data = await res.json();
        if (data.db && data.version) {
          this.mergeIncomingDb(data.db, data.version);
        } else if (!data.db) {
          await this.pushToServer();
        }
      }
    } catch (err) {
      console.warn('[Sync] Initial server sync check:', err.message);
    }

    // Begin continuous long-polling
    this.pollLoop();
  }

  async pushToServer() {
    if (this.isPushing) {
      this.hasPendingPush = true;
      return;
    }
    this.isPushing = true;
    try {
      const res = await fetch('/api/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ db: this.db, version: this.syncVersion })
      });
      if (res.ok) {
        const result = await res.json();
        if (result && result.version) {
          this.syncVersion = result.version;
        }
      }
    } catch (err) {
      console.warn('[Sync] Push to server failed:', err.message);
    } finally {
      this.isPushing = false;
      if (this.hasPendingPush) {
        this.hasPendingPush = false;
        this.pushToServer();
      }
    }
  }

  async pollLoop() {
    while (true) {
      try {
        const res = await fetch(`/api/sync/poll?since=${this.syncVersion}`, { cache: 'no-store' });
        if (res.ok) {
          const data = await res.json();
          if (data.changed && data.db && data.version > this.syncVersion) {
            this.mergeIncomingDb(data.db, data.version);
          }
        }
        // Yield on every cycle so the loop never blocks the main browser thread
        await new Promise(r => setTimeout(r, 400));
      } catch (err) {
        await new Promise(r => setTimeout(r, 2000));
      }
    }
  }

  save() {
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(this.db));
      }
    } catch (e) {
      console.error('Failed to save to localStorage:', e);
    }

    // Push changes to server for instant cross-device delivery
    if (typeof window !== 'undefined' && typeof fetch !== 'undefined') {
      this.pushToServer();
    }
  }

  resetToDefaults() {
    this.db = JSON.parse(JSON.stringify(SEED_DATABASE));
    this.save();
    return this.db;
  }

  subscribe(collection, callback) {
    if (!this.listeners.has(collection)) {
      this.listeners.set(collection, new Set());
    }
    this.listeners.get(collection).add(callback);
    return () => this.listeners.get(collection).delete(callback);
  }

  notifyListeners(collection) {
    // Snapshot callbacks into a new Set to prevent infinite loop if a callback adds new subscribers during iteration
    const toCall = new Set();
    if (this.listeners.has(collection)) {
      this.listeners.get(collection).forEach(cb => toCall.add(cb));
    }
    if (this.listeners.has('*')) {
      this.listeners.get('*').forEach(cb => toCall.add(cb));
    }
    toCall.forEach(cb => {
      try {
        cb();
      } catch (e) {
        console.error('Error in storage subscriber:', e);
      }
    });
  }

  // Generic query operations
  getCollection(name) {
    return this.db[name] || [];
  }

  setCollection(collection, items) {
    this.db[collection] = items;
    this.save();
    this.notifyListeners(collection);
    return this.db[collection];
  }

  getById(collection, id) {
    const list = this.getCollection(collection);
    return list.find(item => item.id === id) || null;
  }

  insert(collection, item) {
    if (!this.db[collection]) {
      this.db[collection] = [];
    }
    const newItem = {
      ...item,
      id: item.id || `id-${Date.now()}-${Math.floor(Math.random()*1000)}`,
      createdAt: item.createdAt || new Date().toISOString()
    };
    this.db[collection].push(newItem);
    this.save();
    this.notifyListeners(collection);
    return newItem;
  }

  update(collection, id, updates) {
    if (!this.db[collection]) return null;
    const index = this.db[collection].findIndex(item => item.id === id);
    if (index === -1) return null;

    this.db[collection][index] = {
      ...this.db[collection][index],
      ...updates,
      updatedAt: new Date().toISOString()
    };
    this.save();
    this.notifyListeners(collection);
    return this.db[collection][index];
  }

  delete(collection, id) {
    if (!this.db[collection]) return false;
    const index = this.db[collection].findIndex(item => item.id === id);
    if (index === -1) return false;
    this.db[collection].splice(index, 1);
    this.save();
    this.notifyListeners(collection);
    return true;
  }
}

export const storageService = new StorageService();
