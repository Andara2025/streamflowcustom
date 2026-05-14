const si = require('systeminformation');

async function test() {
  console.log('Testing si.currentLoad()...');
  try {
    const cpu = await si.currentLoad();
    console.log('CPU OK');
  } catch (e) {
    console.error('CPU Error:', e.message);
  }

  console.log('Testing si.mem()...');
  try {
    const mem = await si.mem();
    console.log('MEM OK');
  } catch (e) {
    console.error('MEM Error:', e.message);
  }

  console.log('Testing si.networkStats()...');
  try {
    const net = await si.networkStats();
    console.log('NET OK');
  } catch (e) {
    console.error('NET Error:', e.message);
  }

  console.log('Testing si.fsSize()...');
  try {
    const fs = await si.fsSize();
    console.log('FS OK');
  } catch (e) {
    console.error('FS Error:', e.message);
  }
}

test();
