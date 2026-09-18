const fs = require('fs');
const path = require('path');
const { db } = require('../db/database');

async function fix() {
  console.log('=== FIX DOMAIN MISMATCH pejuangmonet.cloud -> my.id ===');

  // 1. Fix .env BASE_URL
  const envPath = path.join(__dirname, '..', '.env');
  if (fs.existsSync(envPath)) {
    let env = fs.readFileSync(envPath, 'utf8');
    if (env.includes('pejuangmonet.cloud')) {
      env = env.replace(/pejuangmonet\.cloud/g, 'pejuangmonet.my.id');
      fs.writeFileSync(envPath, env);
      console.log('✓ .env BASE_URL fixed to my.id');
    } else if (!env.includes('BASE_URL')) {
      env += '\nBASE_URL=https://pejuangmonet.my.id\n';
      fs.writeFileSync(envPath, env);
      console.log('✓ .env BASE_URL added');
    } else {
      console.log('- .env already my.id');
    }
    console.log(fs.readFileSync(envPath, 'utf8'));
  }

  // 2. Fix DB youtube_redirect_uri
  await new Promise(res => setTimeout(res, 500));
  db.all("SELECT id, username, youtube_redirect_uri FROM users WHERE youtube_redirect_uri LIKE '%pejuangmonet.cloud%'", [], (err, rows) => {
    if (err) { console.error(err); process.exit(1); }
    console.log(`Found ${rows.length} user(s) with cloud redirect_uri`);
    if (rows.length === 0) {
      console.log('No DB fix needed');
      process.exit(0);
    }
    let done = 0;
    rows.forEach(r => {
      const fixed = r.youtube_redirect_uri.replace(/pejuangmonet\.cloud/g, 'pejuangmonet.my.id');
      db.run("UPDATE users SET youtube_redirect_uri=? WHERE id=?", [fixed, r.id], (e) => {
        if (e) console.error(e);
        else console.log(`✓ Fixed user ${r.username}: ${fixed}`);
        done++;
        if (done === rows.length) {
          console.log('=== DB FIX DONE ===');
          process.exit(0);
        }
      });
    });
  });
}

fix();
