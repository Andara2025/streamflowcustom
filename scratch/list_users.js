const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const dbPath = path.join(__dirname, '..', 'db', 'streamflow.db');
const db = new sqlite3.Database(dbPath);

db.all('SELECT username, status, user_role FROM users', [], (err, rows) => {
  if (err) {
    console.error(err);
    return;
  }
  console.log('Registered Users:');
  console.table(rows);
  db.close();
});
