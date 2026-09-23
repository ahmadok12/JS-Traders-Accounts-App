/**
 * JS Traders ERP - Application Configuration
 * Modular configuration separating credentials and business environment settings.
 */

export const APP_CONFIG = {
  company: {
    code: 'JST-PK',
    name: 'JS Traders',
    legalName: 'JS Traders Poultry Equipment & Automation Private Ltd',
    tagline: 'Poultry Equipment Import & Turnkey Automation',
    baseCurrency: 'PKR',
    phone: '+92 42 35789123',
    email: 'operations@jstraders.pk',
    address: 'Plot 45-B, Industrial Estate, Multan Road, Lahore, Pakistan',
    taxNumber: 'TR-7865421-9'
  },

  // Persistence Mode: 'local' (offline reactive storage engine) or 'supabase'
  persistenceMode: 'local',

  supabase: {
    url: 'https://placeholder-project.supabase.co',
    anonKey: 'placeholder-anon-key-local-mode'
  },

  currencies: [
    { code: 'PKR', symbol: 'Rs.', name: 'Pakistani Rupee', isBase: true, rate: 1.0 },
    { code: 'USD', symbol: '$', name: 'US Dollar', isBase: false, rate: 280.0 },
    { code: 'CNY', symbol: '¥', name: 'Chinese Yuan', isBase: false, rate: 38.5 },
    { code: 'EUR', symbol: '€', name: 'Euro', isBase: false, rate: 305.0 }
  ],

  inventoryRules: {
    allowNegativeStockDefault: false,
    defaultCostingMethod: 'FIFO',
    rollTrackingBaseUnit: 'FT'
  },

  // Initial user roles available in the prototype
  roles: [
    { id: 'role-owner', code: 'owner', name: 'Company Owner', isSystem: true },
    { id: 'role-admin', code: 'admin', name: 'System Administrator', isSystem: true },
    { id: 'role-wh-mgr', code: 'warehouse_manager', name: 'Warehouse Manager', isSystem: true },
    { id: 'role-wh-staff', code: 'warehouse_staff', name: 'Warehouse Staff', isSystem: true },
    { id: 'role-sales', code: 'sales_person', name: 'Sales Representative', isSystem: true },
    { id: 'role-accounts', code: 'accounts', name: 'Finance & Accounts', isSystem: true },
    { id: 'role-purchase', code: 'purchase', name: 'Procurement & Imports', isSystem: true },
    { id: 'role-mgmt', code: 'management', name: 'Executive Management', isSystem: true }
  ]
};
