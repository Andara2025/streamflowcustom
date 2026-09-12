const bcrypt = require('bcrypt');
const { db } = require('./db/database');
const User = require('./models/User');
require('dotenv').config();

async function createAdmin() {
    const username = 'admin';
    const password = 'Admin123';
    
    try {
        const existing = await User.findByUsername(username);
        if (existing) {
            console.log('⚠️  User admin sudah ada, mereset password...');
            const hashedPassword = await bcrypt.hash(password, 10);
            await User.update(existing.id, { password: hashedPassword });
            console.log('✅ Password berhasil direset!');
        } else {
            await User.create({
                username: username,
                password: password,
                user_role: 'admin',
                status: 'active',
                disk_limit: 0,
                stream_limit: 0
            });
            console.log('✅ User admin berhasil dibuat!');
        }
        
        console.log('\n📋 Login Details:');
        console.log('=================');
        console.log(`Username: ${username}`);
        console.log(`Password: ${password}`);
        console.log('=================\n');
        
        process.exit(0);
    } catch (error) {
        console.error('❌ Error:', error);
        process.exit(1);
    }
}

createAdmin();
