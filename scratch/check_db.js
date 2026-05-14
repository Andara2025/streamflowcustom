const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');
const dbPath = path.join(__dirname, '..', 'db', 'streamflow.db');
const db = new sqlite3.Database(dbPath);

db.all("PRAGMA table_info(stream_rotations)", (err, rows) => {
  let result = "";
  if (err) {
    result = "Error: " + err.message;
  } else {
    result = JSON.stringify(rows, null, 2);
  }
  fs.writeFileSync(path.join(__dirname, 'db_check.txt'), result);
  db.close();
});
