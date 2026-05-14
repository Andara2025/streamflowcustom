const { db } = require('./db/database');

db.all('SELECT * FROM youtube_channels', [], (err, rows) => {
  if (err) {
    console.error(err);
    process.exit(1);
  }
  console.log(JSON.stringify(rows, null, 2));
  process.exit(0);
});
