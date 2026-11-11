import { compile } from 'tailwindcss';
import fs from 'fs';
import path from 'path';

async function buildCss() {
  const inputCss = fs.readFileSync(path.resolve('./app/globals.input.css'), 'utf-8');
  const compiler = await compile(inputCss, {
    base: process.cwd(),
    onDependency: (file) => console.log('Dependency:', file),
  });
  
  // Scan all project files in app and components
  function getFiles(dir) {
    const subdirs = fs.readdirSync(dir);
    const files = [];
    for (const file of subdirs) {
      const fullPath = path.join(dir, file);
      if (fs.statSync(fullPath).isDirectory()) {
        if (!['node_modules', '.next', '.git'].includes(file)) {
          files.push(...getFiles(fullPath));
        }
      } else if (/\.(tsx|ts|jsx|js|html)$/.test(file)) {
        files.push(fullPath);
      }
    }
    return files;
  }

  const candidateFiles = [
    ...getFiles(path.resolve('./app')),
    ...getFiles(path.resolve('./components')),
    ...getFiles(path.resolve('./lib')),
  ];

  const candidates = new Set();
  for (const file of candidateFiles) {
    const content = fs.readFileSync(file, 'utf-8');
    // Extract words/candidates
    const matches = content.match(/[\w\-/:[\]#%]+/g) || [];
    for (const m of matches) candidates.add(m);
  }

  const compiled = compiler.build(Array.from(candidates));
  fs.writeFileSync(path.resolve('./app/globals.css'), compiled);
  console.log(`Successfully compiled Tailwind CSS (${compiled.length} bytes)!`);
}

buildCss().catch(err => {
  console.error('Error building CSS:', err);
  process.exit(1);
});
