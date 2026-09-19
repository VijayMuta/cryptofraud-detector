const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');

const ts = require('typescript');

// Load the existing TypeScript with its Next alias, without adding dependencies.
const cache = new Map();
function load(relative) {
  const file = path.resolve(__dirname, '..', relative);
  if (cache.has(file)) return cache.get(file).exports;
  const compiled = new Module(file, module);
  compiled.filename = file;
  compiled.paths = Module._nodeModulePaths(path.dirname(file));
  const originalRequire = compiled.require.bind(compiled);
  compiled.require = name => name.startsWith('@/') ? load(`src/${name.slice(2)}.ts`) : originalRequire(name);
  cache.set(file, compiled);
  compiled._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
  }).outputText, file);
  return compiled.exports;
}

module.exports = { load };
