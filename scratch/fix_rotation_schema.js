const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const dbPath = path.join(__dirname, '..', 'db', 'streamflow.db');
const db = new sqlite3.Database(dbPath);

db.serialize(() => {
  console.log('Checking/Adding columns to stream_rotations...');
  
  db.run(`ALTER TABLE stream_rotations ADD COLUMN global_youtube_altered_content INTEGER DEFAULT 0`, (err) => {
    if (err) {
      if (err.message.includes('duplicate column name')) {
        console.log('global_youtube_altered_content already exists.');
      } else {
        console.error('Error adding global_youtube_altered_content:', err.message);
      }
    } else {
      console.log('Added global_youtube_altered_content successfully.');
    }
  });

  db.run(`ALTER TABLE stream_rotations ADD COLUMN global_youtube_made_for_kids INTEGER DEFAULT 0`, (err) => {
    if (err) {
      if (err.message.includes('duplicate column name')) {
        console.log('global_youtube_made_for_kids already exists.');
      } else {
        console.error('Error adding global_youtube_made_for_kids:', err.message);
      }
    } else {
      console.log('Added global_youtube_made_for_kids successfully.');
    }
  });
});

db.close();
