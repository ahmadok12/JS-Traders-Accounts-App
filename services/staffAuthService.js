/**
 * JS Traders ERP - Mobile Warehouse Staff Authentication Service
 * Manages PIN-based authentication, staff sessions, and Warehouse Manager credential generation/reset.
 */

import { storageService } from './storageService.js';

const STAFF_SESSION_KEY = 'js_staff_session';

class StaffAuthService {
  constructor() {
    this.currentStaff = null;
    this.sessionListeners = new Set();
    this.init();
  }

  init() {
    try {
      const stored = localStorage.getItem(STAFF_SESSION_KEY);
      if (stored) {
        const staff = JSON.parse(stored);
        // Validate against current DB
        const users = storageService.getCollection('users');
        const liveUser = users.find(u => u.id === staff.id);
        this.currentStaff = liveUser || staff;
      }
    } catch (e) {
      console.warn('Error reading staff session:', e);
      this.currentStaff = null;
    }
    this.staffSeeded = false;
  }

  ensureDefaultStaff() {
    if (this.staffSeeded) return;
    this.staffSeeded = true;

    try {
      const users = storageService.getCollection('users') || [];
      const staffDefinitions = [
        {
          id: 'user-office-mudassar',
          fullName: 'Mudassar',
          username: 'mudassar_office',
          pin: '5678',
          roleCode: 'warehouse_staff',
          staffType: 'office_staff',
          email: 'mudassar@jstraders.pk',
          phone: '+92 302 7775678',
          activeWarehouseId: 'wh-2',
          status: 'Active'
        },
        {
          id: 'user-wh-alitoor',
          fullName: 'Ali Toor',
          username: 'ali_toor',
          pin: '1111',
          roleCode: 'warehouse_staff',
          staffType: 'warehouse_staff',
          email: 'alitoor@jstraders.pk',
          phone: '+92 301 5551111',
          activeWarehouseId: 'wh-1',
          status: 'Active'
        },
        {
          id: 'user-wh-alichhota',
          fullName: 'Ali Chhota',
          username: 'ali_chhota',
          pin: '2222',
          roleCode: 'warehouse_staff',
          staffType: 'warehouse_staff',
          email: 'alichhota@jstraders.pk',
          phone: '+92 301 5552222',
          activeWarehouseId: 'wh-1',
          status: 'Active'
        },
        {
          id: 'user-wh-zain',
          fullName: 'Zain',
          username: 'zain',
          pin: '3333',
          roleCode: 'warehouse_staff',
          staffType: 'warehouse_staff',
          email: 'zain@jstraders.pk',
          phone: '+92 301 5553333',
          activeWarehouseId: 'wh-1',
          status: 'Active'
        }
      ];

      let changed = false;
      staffDefinitions.forEach(staffDef => {
        const existing = users.find(u => u.id === staffDef.id || u.username === staffDef.username);
        if (!existing) {
          users.push(staffDef);
          changed = true;
        }
      });

      if (changed && storageService.db) {
        storageService.db.users = users;
        try {
          localStorage.setItem('js_traders_erp_db_v1', JSON.stringify(storageService.db));
        } catch (e) {}
      }
    } catch (e) {
      console.warn('Error ensuring default staff:', e);
    }
  }

  // Get list of all staff members managed by Warehouse Manager (pure read)
  getStaffMembers() {
    this.ensureDefaultStaff();
    const users = storageService.getCollection('users') || [];
    return users.filter(u => u.roleCode === 'warehouse_staff' || u.staffType);
  }

  getStaffById(id) {
    const users = storageService.getCollection('users');
    return users.find(u => u.id === id) || null;
  }

  // Warehouse Manager adds new staff member
  createStaff({ fullName, username, phone, staffType = 'warehouse_staff', pin = null }) {
    const users = storageService.getCollection('users');
    
    // Check for username collision
    if (users.some(u => u.username.toLowerCase() === username.toLowerCase())) {
      throw new Error(`Username "${username}" is already in use.`);
    }

    const assignedPin = pin || this.generateRandomPin();
    const id = `staff-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    const email = `${username.toLowerCase()}@jstraders.pk`;
    const activeWarehouseId = staffType === 'office_staff' ? 'wh-2' : 'wh-1';

    const newStaff = storageService.insert('users', {
      id,
      fullName,
      username,
      pin: String(assignedPin),
      roleCode: 'warehouse_staff',
      staffType, // 'warehouse_staff' | 'office_staff'
      phone: phone || '',
      email,
      activeWarehouseId,
      status: 'Active',
      credentialsGeneratedAt: new Date().toISOString()
    });

    return { ...newStaff, generatedPin: assignedPin };
  }

  // Warehouse Manager resets credentials/PIN
  resetCredentials(staffId, customPin = null) {
    const staff = this.getStaffById(staffId);
    if (!staff) throw new Error('Staff member not found.');

    const newPin = customPin || this.generateRandomPin();

    const updated = storageService.update('users', staffId, {
      pin: String(newPin),
      credentialsGeneratedAt: new Date().toISOString()
    });

    return { ...updated, newPin };
  }

  // Mobile App: Staff PIN Login
  login(usernameOrPhone, pin) {
    const users = storageService.getCollection('users');
    const term = usernameOrPhone.trim().toLowerCase();
    const cleanPin = String(pin).trim();

    const user = users.find(u => 
      (u.username?.toLowerCase() === term || u.phone?.replace(/\s+/g, '') === term.replace(/\s+/g, '')) &&
      String(u.pin) === cleanPin
    );

    if (!user) {
      throw new Error('Invalid username/phone or PIN. Please check your credentials with the Warehouse Manager.');
    }

    if (user.status && user.status === 'Inactive') {
      throw new Error('This staff account is currently inactive.');
    }

    this.currentStaff = user;
    localStorage.setItem(STAFF_SESSION_KEY, JSON.stringify(user));
    this.notifySessionChange();
    return user;
  }

  logout() {
    this.currentStaff = null;
    localStorage.removeItem(STAFF_SESSION_KEY);
    this.notifySessionChange();
  }

  getCurrentStaff() {
    if (!this.currentStaff) {
      this.init();
    }
    return this.currentStaff;
  }

  generateRandomPin() {
    return String(Math.floor(1000 + Math.random() * 9000));
  }

  onSessionChange(callback) {
    this.sessionListeners.add(callback);
    return () => this.sessionListeners.delete(callback);
  }

  notifySessionChange() {
    this.sessionListeners.forEach(cb => cb(this.currentStaff));
  }
}

export const staffAuthService = new StaffAuthService();
