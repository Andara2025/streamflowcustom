const fs = require('fs');
const path = require('path');

const directories = [
  path.join(__dirname, '../views'),
  path.join(__dirname, '../')
];

const filesToProcess = [];

function findEjsAndJsFiles(dir) {
  if (!fs.existsSync(dir)) return;
  const files = fs.readdirSync(dir);
  for (const file of files) {
    const fullPath = path.join(dir, file);
    const stat = fs.statSync(fullPath);
    if (stat.isDirectory() && dir === path.join(__dirname, '../views')) {
      findEjsAndJsFiles(fullPath);
    } else if (stat.isFile()) {
      if (fullPath.endsWith('.ejs') || fullPath.endsWith('app.js') || fullPath.endsWith('package.json')) {
        filesToProcess.push(fullPath);
      }
    }
  }
}

directories.forEach(findEjsAndJsFiles);

let modifiedCount = 0;

filesToProcess.forEach(filePath => {
  if (filePath.includes('node_modules')) return;
  
  let content = fs.readFileSync(filePath, 'utf-8');
  let originalContent = content;
  
  // Replace HTML formatted names
  content = content.replace(/Stream<span class="text-primary">Flow<\/span>/gi, 'PEJUANG <span class="text-primary">MONET</span>');
  content = content.replace(/Stream<span class="text-white">Flow<\/span>/gi, 'PEJUANG <span class="text-white">MONET</span>');
  content = content.replace(/Livora \/ StreamFlow/gi, 'PEJUANG MONET');
  content = content.replace(/Livora/gi, 'PEJUANG MONET');
  content = content.replace(/StreamFlow/gi, 'PEJUANG MONET');
  content = content.replace(/Streamflow/gi, 'PEJUANG MONET');
  
  if (content !== originalContent) {
    fs.writeFileSync(filePath, content, 'utf-8');
    console.log('Updated:', filePath);
    modifiedCount++;
  }
});

console.log(`Finished renaming. Modified ${modifiedCount} files.`);
