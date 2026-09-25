const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const { load } = require('./load-typescript.cjs');

function loadComponent(relative) {
  const filename = path.resolve(relative);
  const compiled = new Module(filename, module);
  compiled.filename = filename;
  compiled.paths = Module._nodeModulePaths(path.dirname(filename));
  const originalRequire = compiled.require.bind(compiled);
  compiled.require = name => name.startsWith('@/components/') ? loadComponent(`src/${name.slice(2)}.tsx`)
    : name.startsWith('@/') ? load(`src/${name.slice(2)}.ts`) : originalRequire(name);
  compiled._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText, filename);
  return compiled.exports;
}

const { TimelineEventCard } = loadComponent('src/components/timeline-event-card.tsx');
const { TransactionLink } = loadComponent('src/components/transaction-link.tsx');
const { buildInvestigationTimeline } = load('src/lib/investigation-timeline.ts');
// Synthetic evidence is confined to this test; no live records are created.
const hash = `0x${'A'.repeat(64)}`, address = `0x${'a'.repeat(40)}`, other = `0x${'b'.repeat(40)}`;
const record = { id: 'case/?&x=1', case_code: 'TEST', title: 'Test case', description: '', created_at: null, wallets: [{ address, network: 'ethereum' }] };

for (const incoming of [false, true]) {
  for (const timestamp of ['2026-01-01T00:00:00Z', null]) {
    test(`${incoming ? 'incoming' : 'outgoing'} ${timestamp ? 'dated' : 'undated'} card links the visible hash with case context`, () => {
      const { events } = buildInvestigationTimeline({ record, wallets: [{ address, network: 'Ethereum Mainnet', dataSource: 'Test fixture', transactions: [{ hash, from: incoming ? other : address, to: incoming ? address : other, value: '1', status: 'success', timestamp }] }] });
      const event = events.find(event => event.category === 'Transfers');
      assert.ok(event);
      let selected;
      const tree = TimelineEventCard({ event, caseId: record.id, selected: false, onSelect: value => { selected = value; } });
      const html = renderToStaticMarkup(tree);
      const expected = `/transactions/${hash.toLowerCase()}?case=case%2F%3F%26x%3D1`;
      assert.ok(html.includes(`href="${expected}"`), html);
      assert.match(html, /Transaction: <a[^>]*>0x[a-f0-9]{64}<\/a>/);
      assert.match(html, /class="[^"]*underline[^"]*focus-visible:outline/);
      assert.doesNotMatch(html, /<button\b[^>]*>[\s\S]*?<a\b[\s\S]*?<\/button>/);
      assert.ok(html.indexOf('</button>') < html.indexOf('<a '));
      assert.ok(html.indexOf('</a>') < html.indexOf('</li>'));
      assert.equal(selected, undefined);
      // Inspector selection stays on its own button; the link has no selection ancestor.
      tree.props.children[0].props.onClick();
      assert.equal(selected, event);
      assert.equal(tree.props.onClick, undefined);
    });
  }
}

test('TransactionLink emits a native Next link without a case and keeps invalid hashes non-navigable', () => {
  const html = renderToStaticMarkup(React.createElement(TransactionLink, { hash }));
  assert.ok(html.includes(`href="/transactions/${hash.toLowerCase()}"`));
  assert.ok(html.includes(`>${hash}</a>`));
  for (const invalid of ['', address, 'javascript:alert(1)']) {
    const fallback = renderToStaticMarkup(React.createElement(TransactionLink, { hash: invalid, caseId: record.id }));
    assert.doesNotMatch(fallback, /<a\b|href=/);
  }
});

test('both timeline lists pass the active case to the card', () => {
  const source = fs.readFileSync('src/app/(dashboard)/investigation-timeline/page.tsx', 'utf8');
  for (const list of ['shownDated', 'shownUndated']) {
    assert.ok(source.includes(`${list}.map(event => <TimelineEventCard key={event.id} caseId={record.id}`));
  }
});
