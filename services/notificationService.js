/**
 * JS Traders ERP - Event-Driven Notification Service
 */

import { storageService } from './storageService.js';

class NotificationService {
  getNotifications() {
    return storageService.getCollection('notifications');
  }

  getUnreadCount() {
    return this.getNotifications().filter(n => !n.isRead).length;
  }

  notify({ title, message, type = 'info', link = null, userId = null }) {
    return storageService.insert('notifications', {
      title,
      message,
      type,
      link,
      userId,
      isRead: false,
      createdAt: new Date().toISOString()
    });
  }

  markAsRead(id) {
    return storageService.update('notifications', id, { isRead: true });
  }

  markAllAsRead() {
    const list = this.getNotifications();
    list.forEach(n => {
      if (!n.isRead) storageService.update('notifications', n.id, { isRead: true });
    });
  }
}

export const notificationService = new NotificationService();
