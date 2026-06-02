const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'src/pages/DashboardPage.tsx');
let content = fs.readFileSync(filePath, 'utf-8');

// The non-greedy .*? should capture the entire label prop
content = content.replace(/outerRadius=\{75\}\s+label=\{.*?\}\s+labelLine=\{false\}/g, 'innerRadius={50} outerRadius={80}');

fs.writeFileSync(filePath, content);
console.log('Fixed Pie charts completely');
