/**
 * JS Traders ERP - Authentication & Session Service
 * Manages active user session, role switching, and assigned warehouse contexts.
 */

import { storageService } from './storageService.js';
import { permissionService } from './permissionService.js';

class AuthService {
  constructor() {
    this.currentUser = null;
    this.sessionListeners = new Set();
    this.init();
  }

  init() {
    const users = storageService.getCollection('users');
    // Default to Owner for full initial visibility, with one-click switcher
    const savedUserId = (typeof localStorage !== 'undefined' ? localStorage.getItem('js_active_user_id') : null) || 'user-owner';
    this.currentUser = users.find(u => u.id === savedUserId) || users[0] || {
      id: 'user-owner',
      fullName: 'Muhammad Jamil',
      roleCode: 'owner',
      activeWarehouseId: 'wh-1'
    };
  }

  getCurrentUser() {
    return this.currentUser;
  }

  getRole() {
    return this.currentUser ? this.currentUser.roleCode : 'warehouse_staff';
  }

  getActiveWarehouseId() {
    return this.currentUser ? this.currentUser.activeWarehouseId : 'wh-1';
  }

  switchRole(newRoleCode) {
    const users = storageService.getCollection('users');
    let matchingUser = users.find(u => u.roleCode === newRoleCode);
    if (!matchingUser) {
      matchingUser = {
        id: `user-${newRoleCode}`,
        fullName: this.getRoleDisplayName(newRoleCode),
        username: newRoleCode,
        roleCode: newRoleCode,
        email: `${newRoleCode}@jstraders.pk`,
        activeWarehouseId: 'wh-1'
      };
    }

    this.currentUser = matchingUser;
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('js_active_user_id', matchingUser.id);
    }
    this.notifySessionChange();
  }

  switchWarehouse(warehouseId) {
    if (this.currentUser) {
      this.currentUser.activeWarehouseId = warehouseId;
      storageService.update('users', this.currentUser.id, { activeWarehouseId: warehouseId });
      this.notifySessionChange();
    }
  }

  getRoleDisplayName(roleCode) {
    const names = {
      owner: 'Company Owner',
      admin: 'System Administrator',
      warehouse_manager: 'Warehouse Manager',
      warehouse_staff: 'Warehouse Staff',
      sales_person: 'Sales Operator',
      accounts: 'Accounts & Finance',
      purchase: 'Procurement / Imports',
      management: 'Executive Management'
    };
    return names[roleCode] || roleCode;
  }

  can(module, action) {
    return permissionService.can(this.getRole(), module, action);
  }

  canViewCostProfit() {
    return permissionService.canViewCostProfit(this.getRole());
  }

  onSessionChange(callback) {
    this.sessionListeners.add(callback);
    return () => this.sessionListeners.delete(callback);
  }

  notifySessionChange() {
    this.sessionListeners.forEach(cb => cb(this.currentUser));
  }
}

export const authService = new AuthService();
