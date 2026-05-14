const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const dbPath = path.join(__dirname, '..', 'db', 'streamflow.db');
const db = new sqlite3.Database(dbPath);

db.run("UPDATE users SET status = 'active', user_role = 'admin'", (err) => {
  if (err) {
    console.error('Error:', err.message);
  } else {
    console.log('Success: All accounts are now ACTIVE and set as ADMIN!');
    console.log('You can now log in with your username and password.');
  }
  db.close();
});
