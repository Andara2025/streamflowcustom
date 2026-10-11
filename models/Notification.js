const { db } = require('../db/database');
const { v4: uuidv4 } = require('uuid');

class Notification {
  static create(data) {
    const id = data.id || uuidv4();
    const type = data.type || 'info'; // 'info', 'warning', 'error', 'success'
    const isRead = data.is_read || 0;
    const metadata = typeof data.metadata === 'object' ? JSON.stringify(data.metadata) : (data.metadata || null);

    return new Promise((resolve, reject) => {
      db.run(
        `INSERT INTO user_notifications (id, user_id, type, title, message, is_read, metadata, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
        [id, data.user_id, type, data.title, data.message, isRead, metadata],
        function(err) {
          if (err) return reject(err);
          resolve({ id, ...data, is_read: isRead, created_at: new Date().toISOString() });
        }
      );
    });
  }

  static findByUserId(userId, limit = 20) {
    return new Promise((resolve, reject) => {
      db.all(
        `SELECT * FROM user_notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT ?`,
        [userId, limit],
        (err, rows) => {
          if (err) return reject(err);
          resolve(rows || []);
        }
      );
    });
  }

  static countUnread(userId) {
    return new Promise((resolve, reject) => {
      db.get(
        `SELECT COUNT(*) as count FROM user_notifications WHERE user_id = ? AND is_read = 0`,
        [userId],
        (err, row) => {
          if (err) return reject(err);
          resolve(row ? row.count : 0);
        }
      );
    });
  }

  static markAsRead(id, userId) {
    return new Promise((resolve, reject) => {
      db.run(
        `UPDATE user_notifications SET is_read = 1 WHERE id = ? AND user_id = ?`,
        [id, userId],
        function(err) {
          if (err) return reject(err);
          resolve(this.changes > 0);
        }
      );
    });
  }

  static markAllAsRead(userId) {
    return new Promise((resolve, reject) => {
      db.run(
        `UPDATE user_notifications SET is_read = 1 WHERE user_id = ?`,
        [userId],
        function(err) {
          if (err) return reject(err);
          resolve(this.changes > 0);
        }
      );
    });
  }

  static delete(id, userId) {
    return new Promise((resolve, reject) => {
      db.run(
        `DELETE FROM user_notifications WHERE id = ? AND user_id = ?`,
        [id, userId],
        function(err) {
          if (err) return reject(err);
          resolve(this.changes > 0);
        }
      );
    });
  }
}

module.exports = Notification;
