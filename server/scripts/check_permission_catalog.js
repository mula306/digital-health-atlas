import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { PERMISSION_KEYS } from '../utils/rbacCatalog.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..');

const SEARCH_ROOTS = [
    path.join(repoRoot, 'server', 'routes'),
    path.join(repoRoot, 'server', 'middleware'),
    path.join(repoRoot, 'server', 'utils'),
    path.join(repoRoot, 'src')
];

const FILE_EXTENSIONS = new Set(['.js', '.jsx', '.ts', '.tsx']);
const PERMISSION_PATTERN = /\bcan_[a-z_]+\b/g;

const walk = (dirPath, out = []) => {
    if (!fs.existsSync(dirPath)) return out;
    for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
        if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === '.git') continue;
        const fullPath = path.join(dirPath, entry.name);
        if (entry.isDirectory()) {
            walk(fullPath, out);
            continue;
        }
        if (!FILE_EXTENSIONS.has(path.extname(entry.name))) continue;
        out.push(fullPath);
    }
    return out;
};

const files = SEARCH_ROOTS.flatMap((rootPath) => walk(rootPath));
const found = new Set();

for (const filePath of files) {
    const text = fs.readFileSync(filePath, 'utf8');
    const matches = text.match(PERMISSION_PATTERN) || [];
    matches.forEach((permission) => found.add(permission));
}

const known = new Set(PERMISSION_KEYS);
const missingFromCatalog = [...found].filter((permission) => !known.has(permission)).sort();
const unusedInCode = [...known].filter((permission) => !found.has(permission)).sort();

if (missingFromCatalog.length > 0) {
    console.error('RBAC catalog check failed. Permissions used in code but missing from catalog:');
    missingFromCatalog.forEach((permission) => console.error(`  - ${permission}`));
    process.exit(1);
}

console.log(`RBAC catalog check passed. ${found.size} permission keys in code are cataloged.`);
if (unusedInCode.length > 0) {
    console.log('Catalog permissions not currently referenced in code (informational):');
    unusedInCode.forEach((permission) => console.log(`  - ${permission}`));
}
