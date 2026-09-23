/**
 * JS Traders ERP - Permission Service
 * Enforces Module + Action role matrix, sensitive financial permission checks (View Cost/Profit),
 * and warehouse restriction policies.
 */

// Master role-permission definitions
const ROLE_PERMISSIONS = {
  owner: {
    all: true,
    viewCostProfit: true
  },
  admin: {
    all: true,
    viewCostProfit: true
  },
  warehouse_manager: {
    modules: {
      dashboard: ['view'],
      inventory: ['view', 'create', 'edit', 'adjust', 'assembly', 'disassembly'],
      warehouse: ['view', 'create', 'edit', 'confirm', 'approve'],
      gatepass: ['view', 'create', 'edit', 'submit', 'assign'],
      delivery: ['view', 'create', 'confirm'],
      reports: ['view', 'export'],
      settings: ['view']
    },
    viewCostProfit: false, // Default false for warehouse unless explicitly permitted
    warehouseRestricted: true
  },
  warehouse_staff: {
    modules: {
      dashboard: ['view'],
      inventory: ['view'],
      warehouse: ['view'],
      gatepass: ['view'],
      delivery: ['view'],
      reports: ['view']
    },
    viewCostProfit: false, // Strictly NO cost or margin visibility!
    warehouseRestricted: true
  },
  sales_person: {
    modules: {
      dashboard: ['view'],
      inventory: ['view'],
      sales: ['view', 'create', 'edit'],
      gatepass: ['view', 'rate_entry', 'submit_invoice'],
      delivery: ['view'],
      customers: ['view', 'create', 'edit'],
      reports: ['view']
    },
    viewCostProfit: false
  },
  accounts: {
    modules: {
      dashboard: ['view'],
      sales: ['view', 'approve', 'invoice'],
      purchasing: ['view', 'approve'],
      accounting: ['view', 'create', 'edit', 'post'],
      banking: ['view', 'reconcile'],
      reports: ['view', 'export'],
      inventory: ['view']
    },
    viewCostProfit: true
  },
  purchase: {
    modules: {
      dashboard: ['view'],
      purchasing: ['view', 'create', 'edit', 'approve'],
      shipments: ['view', 'create', 'edit', 'landed_cost'],
      inventory: ['view'],
      reports: ['view']
    },
    viewCostProfit: true
  },
  management: {
    all: true,
    viewCostProfit: true
  }
};

class PermissionService {
  can(roleCode, moduleName, action = 'view') {
    const roleDef = ROLE_PERMISSIONS[roleCode];
    if (!roleDef) return false;
    if (roleDef.all) return true;

    if (!roleDef.modules || !roleDef.modules[moduleName]) {
      return false;
    }

    return roleDef.modules[moduleName].includes(action);
  }

  canViewCostProfit(roleCode) {
    const roleDef = ROLE_PERMISSIONS[roleCode];
    if (!roleDef) return false;
    return !!roleDef.viewCostProfit;
  }

  isWarehouseRestricted(roleCode) {
    const roleDef = ROLE_PERMISSIONS[roleCode];
    if (!roleDef) return false;
    return !!roleDef.warehouseRestricted;
  }

  filterDataByWarehouse(items, userWarehouseId, roleCode) {
    if (!this.isWarehouseRestricted(roleCode)) {
      return items;
    }
    if (!userWarehouseId) return items;
    return items.filter(item => !item.warehouseId || item.warehouseId === userWarehouseId);
  }
}

export const permissionService = new PermissionService();
