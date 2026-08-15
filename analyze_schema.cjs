const fs = require('fs');
const s = JSON.parse(fs.readFileSync('data/report_schema.json', 'utf8'));

// Show first 3 modules in detail
for (let i = 0; i < 3; i++) {
  const m = s.modules[i];
  console.log(`\n=== ${m.title} ===`);
  console.log('Sections:', m.sections);
  console.log('Visible fields:');
  (m.fields || []).filter(f => f.isVisible).forEach(f => {
    console.log(`  [${f.type}] id=${f.id} label="${f.labelText}" sel=${f.selector}`);
    if (f.options && f.options.length > 0) {
      console.log(`    options: ${f.options.map(o => o.label).join(', ')}`);
    }
  });
  console.log('Tables:');
  (m.tables || []).forEach(t => {
    console.log(`  headers: [${t.headers.join(', ')}] rows: ${t.rowCount}`);
  });
}

// Show PA1 as a typical PA module
const pa1 = s.modules[10];
console.log(`\n=== ${pa1.title} (sample PA) ===`);
console.log('Sections:', pa1.sections);
console.log('Visible fields:');
(pa1.fields || []).filter(f => f.isVisible).forEach(f => {
  console.log(`  [${f.type}] id=${f.id} label="${f.labelText}" sel=${f.selector}`);
  if (f.options && f.options.length > 0) {
    console.log(`    options: ${f.options.map(o => o.label).join(', ')}`);
  }
});

// Count fields with good selectors (have id)
let withId = 0, withName = 0, noSelector = 0;
s.modules.forEach(m => (m.fields || []).forEach(f => {
  if (f.id) withId++;
  else if (f.name) withName++;
  else noSelector++;
}));
console.log(`\n--- Selector quality ---`);
console.log(`  With ID: ${withId}`);
console.log(`  With name (no id): ${withName}`);
console.log(`  No selector: ${noSelector}`);
