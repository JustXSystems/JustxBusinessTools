#!/usr/bin/env node
/**
 * Parse SolarSiteSurvey-Tool_final.html and emit fields-schema.json
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { JSDOM } from 'jsdom';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const HTML_PATH = path.join(ROOT, 'SolarSiteSurvey-Tool_final.html');
const OUT_PATH = path.join(ROOT, 'web', 'lib', 'site-survey-v1', 'fields-schema.json');

const TABS_RES = [
  { id: 'system', icon: 'ti-sun', label: 'System' },
  { id: 'electrical', icon: 'ti-bolt', label: 'Electrical' },
  { id: 'load', icon: 'ti-list-check', label: 'Load' },
  { id: 'photos', icon: 'ti-camera', label: 'Photos' },
  { id: 'safety', icon: 'ti-shield-check', label: 'Safety' },
  { id: 'report', icon: 'ti-report-analytics', label: 'Report' },
];

const TABS_EPC = [
  { id: 'overview', icon: 'ti-building-skyscraper', label: 'Overview' },
  { id: 'site', icon: 'ti-map-pin', label: 'Site' },
  { id: 'electrical', icon: 'ti-bolt', label: 'Electrical' },
  { id: 'commercial', icon: 'ti-currency-rupee', label: 'Commercial' },
  { id: 'safety', icon: 'ti-shield-check', label: 'Safety' },
  { id: 'checklist', icon: 'ti-camera', label: 'Checklist' },
  { id: 'report', icon: 'ti-report-analytics', label: 'Report' },
];

function stripBase64(html) {
  return html
    .replace(/data:image\/[^"'\s>]+/g, 'data:image/stripped')
    .replace(/src="data:[^"]{500,}"/g, 'src="data:stripped"');
}

function closestFlow(el) {
  let node = el;
  while (node && node !== node.ownerDocument.body) {
    if (node.classList?.contains('flow-block') && node.getAttribute('data-flow')) {
      return node.getAttribute('data-flow');
    }
    if (node.classList?.contains('step') && node.getAttribute('data-flow')) {
      return node.getAttribute('data-flow');
    }
    node = node.parentElement;
  }
  return 'common';
}

function closestItype(el) {
  let node = el;
  while (node && node !== node.ownerDocument.body) {
    if (node.classList?.contains('itype-block') && node.getAttribute('data-itype')) {
      return node.getAttribute('data-itype');
    }
    node = node.parentElement;
  }
  return null;
}

function getFieldMeta(el) {
  const field = el.closest('.field');
  if (!field) return { section: null, label: null, required: false };
  const section = field.getAttribute('data-pdf-section') || null;
  let label = field.getAttribute('data-pdf-label') || null;
  if (!label) {
    const lbl = field.querySelector(':scope > label');
    if (lbl) {
      label = lbl.textContent.replace(/\s*\*\s*$/, '').replace(/\s*\(optional\)\s*/i, '').trim();
    }
  }
  const required = field.getAttribute('data-req') === 'true';
  return { section, label, required };
}

function inputKind(type) {
  switch (type) {
    case 'number':
      return 'number';
    case 'email':
      return 'email';
    case 'date':
      return 'date';
    case 'file':
      return 'file';
    case 'tel':
    case 'text':
    case 'url':
    case 'password':
    default:
      return 'text';
  }
}

function cleanFileKey(id) {
  if (!id) return id;
  return id
    .replace(/Preview$/i, '')
    .replace(/Photos$/i, '_photos')
    .replace(/Photo$/i, '_photo')
    .replace(/File$/i, '');
}

function collectOptions(inputs) {
  return inputs.map((inp) => {
    const parentLabel = inp.closest('label');
    let optLabel = inp.value;
    if (parentLabel) {
      const clone = parentLabel.cloneNode(true);
      clone.querySelectorAll('input').forEach((n) => n.remove());
      optLabel = clone.textContent.trim() || inp.value;
    }
    return { value: inp.value, label: optLabel };
  });
}

function parseSelectOptions(select) {
  return Array.from(select.querySelectorAll('option'))
    .filter((o) => o.value !== '')
    .map((o) => ({ value: o.value, label: o.textContent.trim() }));
}

function parseFields(document) {
  const fields = [];
  const seenGroups = new Set();
  const seenIds = new Set();

  // Individual inputs, selects, textareas
  document.querySelectorAll('input, select, textarea').forEach((el) => {
    const tag = el.tagName.toLowerCase();
    const type = (el.getAttribute('type') || '').toLowerCase();
    const id = el.id || '';

    if (id.endsWith('Preview')) return;
    if (type === 'radio' || type === 'checkbox') return;

    const flow = closestFlow(el);
    const itype = closestItype(el);
    const { section, label, required } = getFieldMeta(el);

    if (tag === 'select') {
      if (!id || seenIds.has(id)) return;
      seenIds.add(id);
      fields.push({
        key: id,
        kind: 'select',
        label,
        section,
        required,
        flow,
        itype,
        options: parseSelectOptions(el),
        placeholder: null,
      });
      return;
    }

    if (tag === 'textarea') {
      if (!id || seenIds.has(id)) return;
      seenIds.add(id);
      fields.push({
        key: id,
        kind: 'textarea',
        label,
        section,
        required,
        flow,
        itype,
        options: [],
        placeholder: el.getAttribute('placeholder') || null,
      });
      return;
    }

    if (tag === 'input') {
      if (!id || seenIds.has(id)) return;
      seenIds.add(id);

      const kind = inputKind(type);
      let key = id;
      if (kind === 'file') {
        key = cleanFileKey(id);
      }

      fields.push({
        key,
        kind,
        label,
        section,
        required,
        flow,
        itype,
        options: [],
        placeholder: el.getAttribute('placeholder') || null,
      });
    }
  });

  // Radio and checkbox groups
  document.querySelectorAll('.pill-group').forEach((group) => {
    const inputs = Array.from(group.querySelectorAll('input[type="radio"], input[type="checkbox"]'));
    if (inputs.length === 0) return;

    const name = inputs[0].getAttribute('name');
    if (!name) return;

    const groupKey = `${name}::${closestFlow(group)}::${closestItype(group) || ''}`;
    if (seenGroups.has(groupKey)) return;
    seenGroups.add(groupKey);

    const first = inputs[0];
    const kind = first.getAttribute('type') === 'radio' ? 'radio' : 'checkbox';
    const flow = closestFlow(group);
    const itype = closestItype(group);
    const { section, label, required } = getFieldMeta(group);

    fields.push({
      key: name,
      kind,
      label,
      section,
      required,
      flow,
      itype,
      options: collectOptions(inputs),
      placeholder: null,
    });
  });

  return fields;
}

function buildSteps() {
  return {
    residential: [
      { id: 'contact', label: 'Owner', icon: 'ti-user-circle' },
      ...TABS_RES,
    ],
    epc: [
      { id: 'project', label: 'Project', icon: 'ti-user-circle' },
      ...TABS_EPC,
    ],
  };
}

function summarize(fields) {
  const byFlow = {};
  const byFlowItype = {};

  for (const f of fields) {
    byFlow[f.flow] = (byFlow[f.flow] || 0) + 1;
    const ik = `${f.flow}/${f.itype ?? 'null'}`;
    byFlowItype[ik] = (byFlowItype[ik] || 0) + 1;
  }

  return { byFlow, byFlowItype, total: fields.length };
}

// --- main ---
const raw = fs.readFileSync(HTML_PATH, 'utf8');
const lean = stripBase64(raw);
const dom = new JSDOM(lean);
const { document } = dom.window;

const fields = parseFields(document);
fields.sort((a, b) => {
  const flowOrder = { common: 0, residential: 1, epc: 2 };
  const fo = (flowOrder[a.flow] ?? 9) - (flowOrder[b.flow] ?? 9);
  if (fo !== 0) return fo;
  const io = (a.itype || '').localeCompare(b.itype || '');
  if (io !== 0) return io;
  return a.key.localeCompare(b.key);
});

const schema = {
  steps: buildSteps(),
  fields,
};

fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
fs.writeFileSync(OUT_PATH, JSON.stringify(schema, null, 2) + '\n', 'utf8');

const summary = summarize(fields);
console.log('Wrote:', OUT_PATH);
console.log('Total fields:', summary.total);
console.log('By flow:', JSON.stringify(summary.byFlow, null, 2));
console.log('By flow/itype:', JSON.stringify(summary.byFlowItype, null, 2));
