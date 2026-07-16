const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'src/pages/DashboardPage.tsx');
let content = fs.readFileSync(filePath, 'utf-8');

// The goal is to replace `label={({ name, percent }) => ...} labelLine={false}` with `innerRadius={50} outerRadius={80}`
// and add `<Legend />` before `</PieChart>`.

// Remove the label and labelLine, and set innerRadius and outerRadius
content = content.replace(/outerRadius=\{75\}\s+label=\{[^}]+\}\s+labelLine=\{false\}/g, 'innerRadius={50} outerRadius={80}');

// For the PMDashboard pie chart, it's:
// `</Pie>`
// `  <Tooltip />`
// `</PieChart>`
// We want to add `<Legend />` where it's missing inside a `<PieChart>`.
// Let's just do a simpler replace for all `</Pie>` blocks that are followed by `<Tooltip />` without a `<Legend />`
content = content.replace(/<\/Pie>\s*<Tooltip \/>\s*(?!<Legend \/>)/g, '</Pie>\n                <Tooltip />\n                <Legend />\n              ');

fs.writeFileSync(filePath, content);
console.log('Fixed Pie charts');
