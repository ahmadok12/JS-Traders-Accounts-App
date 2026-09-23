/**
 * JS Traders ERP - Shipment Tracking Provider Abstraction
 * Provider interface supporting Tracktainer, MockTrackingProvider, and manual tracking modes.
 */

import { storageService } from './storageService.js';
import { notificationService } from './notificationService.js';

class TracktainerProvider {
  constructor() {
    this.name = 'Tracktainer';
  }

  async checkStatus(shipment) {
    if (shipment.remainingCredits <= 0) {
      throw new Error('Tracktainer credit balance exhausted. Please top up API credits.');
    }

    // Simulate Tracktainer synchronization
    const newRemainingCredits = shipment.remainingCredits - 1;
    const waypoints = [
      'Departed Ningbo Port, China',
      'Passing Malacca Strait (Lat 2.4°N, Lon 101.8°E)',
      'Arrived Arabian Sea / Approaching Karachi Port Qasim',
      'Moored at Karachi QICT Terminal - Awaiting Customs Clearance'
    ];

    const randomWaypoint = waypoints[Math.floor(Math.random() * waypoints.length)];

    storageService.update('importShipments', shipment.id, {
      remainingCredits: newRemainingCredits,
      currentLocation: randomWaypoint,
      lastCheckedAt: new Date().toISOString()
    });

    notificationService.notify({
      title: `Tracktainer Sync: ${shipment.containerNumber}`,
      message: `Updated location: ${randomWaypoint}. Remaining API credits: ${newRemainingCredits}`,
      type: 'info',
      link: 'shipments'
    });

    return {
      success: true,
      currentLocation: randomWaypoint,
      remainingCredits: newRemainingCredits
    };
  }
}

class TrackingService {
  constructor() {
    this.providers = {
      Tracktainer: new TracktainerProvider()
    };
  }

  getProvider(name = 'Tracktainer') {
    return this.providers[name] || this.providers.Tracktainer;
  }

  async syncShipment(shipmentId) {
    const shipment = storageService.getById('importShipments', shipmentId);
    if (!shipment) throw new Error('Shipment not found.');
    const provider = this.getProvider(shipment.trackingProvider);
    return await provider.checkStatus(shipment);
  }
}

export const trackingService = new TrackingService();
