const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const dbPath = path.join(__dirname, '..', 'db', 'streamflow.db');
const db = new sqlite3.Database(dbPath);

db.serialize(() => {
  // Add columns to streams table
  db.run(`ALTER TABLE streams ADD COLUMN youtube_altered_content INTEGER DEFAULT 0`, (err) => {
    if (err && !err.message.includes('duplicate column name')) console.error('Error adding youtube_altered_content to streams:', err.message);
  });
  db.run(`ALTER TABLE streams ADD COLUMN youtube_made_for_kids INTEGER DEFAULT 0`, (err) => {
    if (err && !err.message.includes('duplicate column name')) console.error('Error adding youtube_made_for_kids to streams:', err.message);
  });

  // Add columns to rotation_items table
  db.run(`ALTER TABLE rotation_items ADD COLUMN youtube_altered_content INTEGER DEFAULT 0`, (err) => {
    if (err && !err.message.includes('duplicate column name')) console.error('Error adding youtube_altered_content to rotation_items:', err.message);
  });
  db.run(`ALTER TABLE rotation_items ADD COLUMN youtube_made_for_kids INTEGER DEFAULT 0`, (err) => {
    if (err && !err.message.includes('duplicate column name')) console.error('Error adding youtube_made_for_kids to rotation_items:', err.message);
  });
});

db.close();
