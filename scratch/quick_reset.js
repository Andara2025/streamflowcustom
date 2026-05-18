const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const bcrypt = require('bcrypt');

const dbPath = path.join(__dirname, '..', 'db', 'streamflow.db');
const db = new sqlite3.Database(dbPath);

console.log('=========================================');
console.log('   Streamflow Password Reset Helper      ');
console.log('=========================================\n');

// 1. Get all users in the database
db.all('SELECT id, username, status, user_role FROM users', [], async (err, users) => {
  if (err) {
    console.error('❌ Error reading users from database:', err.message);
    db.close();
    return;
  }

  if (!users || users.length === 0) {
    console.log('❌ No users found in the database. Please create a user first.');
    db.close();
    return;
  }

  console.log('Registered accounts in your database:');
  users.forEach((u, i) => {
    console.log(`  [${i + 1}] Username: "${u.username}" | Role: ${u.user_role} | Status: ${u.status}`);
  });
  console.log('');

  // 2. Select the username to reset (default: the first user, or admin if found)
  let targetUser = users.find(u => u.username.toLowerCase() === 'admin') || users[0];
  const newPassword = 'Admin1234!'; // Meets all criteria (>=8 chars, lowercase, uppercase, number)

  console.log(`Resetting password for username: "${targetUser.username}"...`);

  try {
    const hashedPassword = await bcrypt.hash(newPassword, 10);
    
    db.run(
      'UPDATE users SET password = ?, status = \'active\' WHERE id = ?',
      [hashedPassword, targetUser.id],
      function(updateErr) {
        if (updateErr) {
          console.error('❌ Error updating password in database:', updateErr.message);
        } else {
          console.log('\n=========================================');
          console.log('🎉 PASSWORD RESET SUCCESSFUL!');
          console.log('=========================================');
          console.log(`Username     : ${targetUser.username}`);
          console.log(`New Password : ${newPassword}`);
          console.log('=========================================');
          console.log('👉 You can now open your browser, go to login page,');
          console.log('   and use these credentials to log in!');
        }
        db.close();
      }
    );
  } catch (hashErr) {
    console.error('❌ Error hashing password:', hashErr.message);
    db.close();
  }
});
