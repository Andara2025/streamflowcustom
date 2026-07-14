const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const dbPath = path.join(__dirname, '..', 'db', 'streamflow.db');
const db = new sqlite3.Database(dbPath);

db.serialize(() => {
  db.run(`ALTER TABLE users ADD COLUMN package_name TEXT DEFAULT 'custom'`, (err) => {
    if (err) console.error(err.message);
    else console.log("Added package_name");
  });
  db.run(`ALTER TABLE users ADD COLUMN stream_limit INTEGER DEFAULT 0`, (err) => {
    if (err) console.error(err.message);
    else console.log("Added stream_limit");
  });
});

db.close();
