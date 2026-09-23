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
      businessName: 'PIP-GAL-45',
      customerName: 'Galvanized Feeder Auger Pipe 45mm',
      urduName: 'فیڈ پائپ',
      categoryId: 'cat-6',
      baseUnitId: 'u-3', // Feet
      productType: 'Stock',
      lowStockLevel: 500,
      enableRollTracking: true, // Cut-to-length / Roll tracking enabled!
      negativeStockAllowed: 'disallow',
      description: 'Continuous coil roll and cut galvanized tubing for automated auger lines.',
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
      sku: 'PIP-GAL-ROLL',
      name: 'Galvanized Feeder Pipe 45mm (Roll/Continuous)',
      costPrice: 120, // Per foot
      sellingPrice: 185,
      attributes: { Origin: 'China', Material: 'Galvanized Steel', Size: '45mm' },
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
    }
  ],

  // Physical rolls for Roll / Cut-to-length tracking
  physicalRolls: [
    { id: 'roll-1', variantId: 'var-5', warehouseId: 'wh-1', code: 'ROLL-101', initialLength: 5000, remainingLength: 5000, isFull: true },
    { id: 'roll-2', variantId: 'var-5', warehouseId: 'wh-1', code: 'ROLL-102', initialLength: 5000, remainingLength: 5000, isFull: true },
    { id: 'roll-3', variantId: 'var-5', warehouseId: 'wh-1', code: 'ROLL-103', initialLength: 5000, remainingLength: 5000, isFull: true },
    { id: 'roll-4', variantId: 'var-5', warehouseId: 'wh-1', code: 'ROLL-104', initialLength: 5000, remainingLength: 5000, isFull: true },
    { id: 'roll-5', variantId: 'var-5', warehouseId: 'wh-1', code: 'ROLL-105', initialLength: 5000, remainingLength: 5000, isFull: true }
  ],

  // Stock balances by warehouse & variant
  stockBalances: [
    { id: 'bal-wh1-var1', warehouseId: 'wh-1', variantId: 'var-1', quantity: 1250, averageCost: 950, unit: 'PCS' },
    { id: 'bal-wh1-var2', warehouseId: 'wh-1', variantId: 'var-2', quantity: 820, averageCost: 650, unit: 'PCS' },
    { id: 'bal-wh1-var3', warehouseId: 'wh-1', variantId: 'var-3', quantity: 4500, averageCost: 65, unit: 'PCS' },
    { id: 'bal-wh1-var4', warehouseId: 'wh-1', variantId: 'var-4', quantity: 6, averageCost: 42000, unit: 'PCS' },
    { id: 'bal-wh1-var5', warehouseId: 'wh-1', variantId: 'var-5', quantity: 22500, averageCost: 120, unit: 'FT' },
    { id: 'bal-wh1-var6', warehouseId: 'wh-1', variantId: 'var-6', quantity: 25, averageCost: 18500, unit: 'PCS' },
    { id: 'bal-wh1-var7', warehouseId: 'wh-1', variantId: 'var-7', quantity: 30, averageCost: 9500, unit: 'PCS' },
    { id: 'bal-wh1-var8', warehouseId: 'wh-1', variantId: 'var-8', quantity: 40, averageCost: 3800, unit: 'PCS' },
    // Office Stock Balances (wh-2)
    { id: 'bal-wh2-var1', warehouseId: 'wh-2', variantId: 'var-1', quantity: 350, averageCost: 950, unit: 'PCS' },
    { id: 'bal-wh2-var2', warehouseId: 'wh-2', variantId: 'var-2', quantity: 180, averageCost: 650, unit: 'PCS' },
    { id: 'bal-wh2-var3', warehouseId: 'wh-2', variantId: 'var-3', quantity: 1200, averageCost: 65, unit: 'PCS' },
    { id: 'bal-wh2-var4', warehouseId: 'wh-2', variantId: 'var-4', quantity: 3, averageCost: 42000, unit: 'PCS' },
    { id: 'bal-wh2-var5', warehouseId: 'wh-2', variantId: 'var-5', quantity: 2500, averageCost: 120, unit: 'FT' },
    { id: 'bal-wh2-var6', warehouseId: 'wh-2', variantId: 'var-6', quantity: 5, averageCost: 18500, unit: 'PCS' },
    { id: 'bal-wh2-var7', warehouseId: 'wh-2', variantId: 'var-7', quantity: 6, averageCost: 9500, unit: 'PCS' },
    { id: 'bal-wh2-var8', warehouseId: 'wh-2', variantId: 'var-8', quantity: 15, averageCost: 3800, unit: 'PCS' }
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

  // Sales Orders
  salesOrders: [
    {
      id: 'so-1',
      orderNumber: 'SO-00001',
      customerPartyId: 'pty-1',
      farmId: 'farm-1',
      dealId: 'deal-1',
      assignedSalespersonId: 'user-sales',
      date: '2025-09-15',
      currency: 'PKR',
      status: 'Confirmed', // Draft, Confirmed, Partially Delivered, Delivered, Cancelled
      subtotal: 145000,
      tax: 0,
      discount: 5000,
      total: 140000,
      notes: 'Delivery requested in 2 batches for Bhai Pheru site',
      lines: [
        {
          id: 'sol-1',
          variantId: 'var-1',
          orderedQty: 100,
          deliveredQty: 40, // 40 delivered, 60 remaining!
          unit: 'PCS',
          unitPrice: 1450,
          lineTotal: 145000
        }
      ]
    }
  ],

  // Gatepasses (Warehouse operational logistics document)
  gatepasses: [
    {
      id: 'gp-1',
      gatepassNumber: 'GP-00001',
      gatepassType: 'outward',
      salesOrderId: 'so-1',
      warehouseId: 'wh-1',
      customerPartyId: 'pty-1',
      farmId: 'farm-1',
      assignedSalespersonId: 'user-sales',
      assignedStaffIds: ['user-wh-staff', 'user-office-staff'],
      date: '2025-09-16',
      vehicleNumber: 'LES-9412 Hino Truck',
      driverName: 'Muhammad Rasheed',
      driverPhone: '+92 345 6789012',
      status: 'Draft - Staff Assigned',
      notes: 'Urgent allocation for Bhai Pheru site. Picked across Warehouse and Office.',
      staffProofs: [],
      lines: [
        { variantId: 'var-1', warehouseQty: 30, officeQty: 20, quantity: 50, unit: 'PCS', negotiatedRate: 1400 }
      ]
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

  // Assemblies
  assemblies: [
    {
      id: 'asm-1',
      assemblyNumber: 'ASM-00001',
      warehouseId: 'wh-1',
      finishedVariantId: 'var-4', // Air Cooler 1.5 kW + With Pad
      finishedQuantity: 2,
      assemblyDate: '2025-09-12',
      status: 'Confirmed',
      totalCost: 63600,
      unitFinishedCost: 31800,
      notes: 'Assembled 2 Industrial Evaporative Coolers using China motors and axial blades',
      lines: [
        { componentVariantId: 'var-6', quantityConsumed: 2, unit: 'PCS', unitCost: 18500, totalCost: 37000 }, // 2 Motors
        { componentVariantId: 'var-7', quantityConsumed: 2, unit: 'PCS', unitCost: 9500, totalCost: 19000 },   // 2 Fan blades
        { componentVariantId: 'var-8', quantityConsumed: 2, unit: 'PCS', unitCost: 3800, totalCost: 7600 }     // 2 Submersible pumps
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

    { id: 'coa-10', code: '3000', name: 'Equity', type: 'Equity', level: 1, parentId: null },
    { id: 'coa-11', code: '3100', name: 'Owner Capital & Retained Earnings', type: 'Equity', level: 2, parentId: 'coa-10' },

    { id: 'coa-12', code: '4000', name: 'Operating Revenue', type: 'Income', level: 1, parentId: null },
    { id: 'coa-13', code: '4100', name: 'Sales Revenue - Poultry Equipment', type: 'Income', level: 2, parentId: 'coa-12' },

    { id: 'coa-14', code: '5000', name: 'Cost of Goods Sold', type: 'Expense', level: 1, parentId: null },
    { id: 'coa-15', code: '5100', name: 'Cost of Sales - Equipment & Parts', type: 'Expense', level: 2, parentId: 'coa-14' },
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
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        this.db = JSON.parse(stored);
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
    const collections = ['gatepasses', 'staffNotifications', 'deliveries', 'salesOrders', 'stockBalances', 'stockMovements'];
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

    this.db = merged;
    this.syncVersion = Math.max(this.syncVersion, incomingVersion || 0);

    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.db));
    } catch (e) {}

    this.notifyListeners('gatepasses');
    this.notifyListeners('staffNotifications');
    this.notifyListeners('*');

    // If local had records that the server was missing, immediately push to server!
    if (hadLocalOnlyData) {
      this.pushToServer();
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
        } else {
          await new Promise(r => setTimeout(r, 1500));
        }
      } catch (err) {
        await new Promise(r => setTimeout(r, 2000));
      }
    }
  }

  save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.db));
      this.notifyListeners('*');
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
    if (this.listeners.has(collection)) {
      this.listeners.get(collection).forEach(cb => cb());
    }
    if (this.listeners.has('*')) {
      this.listeners.get('*').forEach(cb => cb());
    }
  }

  // Generic query operations
  getCollection(name) {
    return this.db[name] || [];
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
