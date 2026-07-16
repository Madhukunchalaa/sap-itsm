const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'src/pages/DashboardPage.tsx');
let content = fs.readFileSync(filePath, 'utf-8');

// 1. Add the RADIAN and renderCustomizedLabel helper to the top of the file
const labelHelper = `
const RADIAN = Math.PI / 180;
const renderCustomizedLabel = ({ cx, cy, midAngle, innerRadius, outerRadius, percent }: any) => {
  if (percent < 0.05) return null; // Don't show label if less than 5%
  const radius = innerRadius + (outerRadius - innerRadius) * 0.5;
  const x = cx + radius * Math.cos(-midAngle * RADIAN);
  const y = cy + radius * Math.sin(-midAngle * RADIAN);

  return (
    <text x={x} y={y} fill="white" textAnchor="middle" dominantBaseline="central" fontSize={12} fontWeight="bold">
      {\`\${(percent * 100).toFixed(0)}%\`}
    </text>
  );
};
`;

if (!content.includes('renderCustomizedLabel')) {
  content = content.replace(
    /const PIE_COLORS = \[.*?\];/,
    `const PIE_COLORS = ['#3b82f6','#ef4444','#f59e0b','#10b981','#8b5cf6','#6b7280'];\n${labelHelper}`
  );
}

// 2. Update all Pie charts to use:
// innerRadius={0} outerRadius={80} labelLine={false} label={renderCustomizedLabel}
content = content.replace(/innerRadius=\{50\} outerRadius=\{80\}/g, 'outerRadius={80} labelLine={false} label={renderCustomizedLabel}');

// 3. Update all Legends to layout="vertical" verticalAlign="middle" align="right"
content = content.replace(/<Legend \/>/g, '<Legend layout="vertical" verticalAlign="middle" align="right" wrapperStyle={{ fontSize: "12px" }} />');

fs.writeFileSync(filePath, content);
console.log('Fixed Pie charts with custom label and right-aligned legend');
