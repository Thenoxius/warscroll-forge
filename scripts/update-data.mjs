#!/usr/bin/env node
// Downloadt de Wahapedia AoS4 data-export (CSV) en compileert die naar data/data.js
// Gebruik:  node scripts/update-data.mjs            (downloaden + compileren)
//           node scripts/update-data.mjs --offline  (alleen compileren uit data/csv)

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CSV_DIR = join(ROOT, 'data', 'csv');
const BASE = 'https://wahapedia.ru/aos4/';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) warscroll-forge (powered by Wahapedia)';

const FILES = [
  'Factions', 'Warscrolls', 'Warscrolls_abilities', 'Warscrolls_weapons',
  'Warscrolls_keywords', 'Warscrolls_bases', 'Warscrolls_organisation',
  'Faction_ability_types', 'Faction_ability_subtypes', 'Faction_abilities',
  'Last_update',
];

// ---------- CSV (| gescheiden, " alleen speciaal aan veldbegin, zoals Python csv) ----------
function parseCsv(text) {
  const rows = [];
  let row = [], field = '', quoted = false, atStart = true, i = 0;
  text = text.replace(/^﻿/, '');
  while (i < text.length) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
        quoted = false; i++; continue;
      }
      field += c; i++; continue;
    }
    if (c === '"' && atStart) { quoted = true; atStart = false; i++; continue; }
    if (c === '|') { row.push(field); field = ''; atStart = true; i++; continue; }
    if (c === '\r') { i++; continue; }
    if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; atStart = true; i++; continue; }
    field += c; atStart = false; i++;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows.filter(r => r.length > 1 || (r.length === 1 && r[0].trim() !== ''));
}

function toObjects(rows) {
  const hdr = rows[0].map(h => h.trim());
  // Repareer rijen die door ongequote newlines in de bron zijn gesplitst:
  // voeg een te korte rij samen met de volgende zolang dat binnen de headerbreedte past.
  const fixed = [];
  for (let i = 1; i < rows.length; i++) {
    let r = rows[i];
    while (r.length < hdr.length - 1 && i + 1 < rows.length && r.length + rows[i + 1].length - 1 <= hdr.length) {
      const next = rows[++i];
      r = [...r.slice(0, -1), r[r.length - 1] + '\n' + next[0], ...next.slice(1)];
    }
    fixed.push(r);
  }
  return fixed.map(r => {
    const o = {};
    hdr.forEach((h, idx) => { if (h) o[h] = (r[idx] ?? '').trim(); });
    return o;
  });
}


// ---------- HTML opschonen (whitelist) ----------
function sanitize(html) {
  if (!html) return '';
  let s = html;
  s = s.replace(/%\d{6,}([^%]*)%/g, '$1');                      // %000123Naam% -> Naam
  s = s.replace(/<a\b[^>]*>/gi, '').replace(/<\/a>/gi, '');     // links -> platte tekst
  s = s.replace(/<img\b[^>]*>/gi, '');
  s = s.replace(/<span\b[^>]*class="[^"]*kwb[^"]*"[^>]*>/gi, '<span class="kw">');
  s = s.replace(/<div\b[^>]*>/gi, '<br>').replace(/<\/div>/gi, '');
  // alles behalve toegestane tags strippen
  s = s.replace(/<(?!\/?(b|i|em|strong|br|ul|ol|li|span)\b)[^>]*>/gi, '');
  // resterende attributen op toegestane tags weghalen (behalve onze eigen class="kw")
  s = s.replace(/<(b|i|em|strong|ul|ol|li)\b[^>]*>/gi, '<$1>');
  s = s.replace(/<span\b(?![^>]*class="kw")[^>]*>/gi, '<span>');
  s = s.replace(/<br\b[^>]*>/gi, '<br>');
  s = s.replace(/(<br>\s*)+$/g, '').replace(/^(\s*<br>)+/g, '');
  return s.trim();
}

const plain = s => sanitize(s).replace(/<[^>]+>/g, '').trim();

async function download() {
  await mkdir(CSV_DIR, { recursive: true });
  for (const f of FILES) {
    const url = `${BASE}${f}.csv`;
    process.stdout.write(`Downloaden ${f}.csv ... `);
    const res = await fetch(url, { headers: { 'User-Agent': UA } });
    if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    await writeFile(join(CSV_DIR, `${f}.csv`), buf);
    console.log(`${buf.length} bytes`);
  }
}

async function csv(name) {
  const text = await readFile(join(CSV_DIR, `${name}.csv`), 'utf8');
  return toObjects(parseCsv(text));
}

async function compile() {
  const factions = {};
  for (const f of await csv('Factions')) factions[f.id] = f.name;

  const warscrolls = (await csv('Warscrolls')).map(w => ({
    id: w.id, name: w.name, fid: w.faction_id, role: w.role,
    virtual: w.virtual === 'true',
    legend: plain(w.legend), notes: sanitize(w.notes), regOptions: plain(w.regiment_options),
    move: w.Move, save: w.Save, control: w.Control, health: w.Health,
    ward: w.Ward, unitSize: w.UnitSize, cost: w.Cost,
  }));

  const abilities = (await csv('Warscrolls_abilities')).map(a => ({
    wid: a.warscroll_id, line: +a.line || 0, name: a.name,
    desc: sanitize(a.description), legend: plain(a.legend),
    atype: a.ability_type, reaction: a.is_reaction === 'true',
    cond: plain(a.condition), kw: plain(a.keywords), phase: a.ability_phase,
    ptype: a.points_type, pts: a.points,
  }));

  const weapons = (await csv('Warscrolls_weapons')).map(w => ({
    wid: w.warscroll_id, line: +w.line || 0, name: w.name,
    rng: w.Rng, atk: w.Atk, hit: w.Hit, wnd: w.Wnd, rnd: w.Rnd, dmg: w.Dmg,
    type: w.type, abilities: plain(w.abilities), bd: w.has_battle_damage === 'true',
  }));

  const keywords = (await csv('Warscrolls_keywords')).map(k => ({
    wid: k.warscroll_id, kw: k.keyword, fac: k.is_faction_keyword === 'true', param: k.parameter,
  }));

  const bases = (await csv('Warscrolls_bases')).map(b => ({
    wid: b.warscroll_id, model: b.model, base: b.base,
  }));

  const org = (await csv('Warscrolls_organisation')).map(o => ({
    wid: o.warscroll_id, unit: plain(o.unit), size: o.size,
  }));

  const fabTypes = (await csv('Faction_ability_types')).map(t => ({
    fid: t.faction_id, id: t.id, name: t.name, desc: sanitize(t.description),
  }));

  const fabSubtypes = (await csv('Faction_ability_subtypes')).map(s => ({
    fid: s.faction_id, id: s.id, name: s.name, typeId: s.type_id,
    desc: sanitize(s.description), legend: plain(s.legend),
  }));

  const fabs = (await csv('Faction_abilities')).map(a => ({
    fid: a.faction_id, typeName: a.type_name, subId: a.subtype_id, subName: a.subtype_name,
    line: +a.line || 0, name: a.name, desc: sanitize(a.description), legend: plain(a.legend),
    atype: a.ability_type, reaction: a.is_reaction === 'true',
    cond: plain(a.condition), kw: plain(a.keywords), phase: a.ability_phase,
    ptype: a.points_type, pts: a.points,
  }));

  const lastUpdate = (await csv('Last_update'))[0]?.last_update ?? '';

  const data = { lastUpdate, factions, warscrolls, abilities, weapons, keywords, bases, org, fabTypes, fabSubtypes, fabs };
  const js = '// Gegenereerd door scripts/update-data.mjs — niet met de hand bewerken.\n'
    + '// Bron: Wahapedia AoS4 data-export (powered by Wahapedia), laatste update: ' + lastUpdate + '\n'
    + 'window.WSF_DATA = ' + JSON.stringify(data) + ';\n';
  const out = join(ROOT, 'data', 'data.js');
  await writeFile(out, js, 'utf8');
  console.log(`Gecompileerd: data/data.js (${(js.length / 1024 / 1024).toFixed(1)} MB) — ${warscrolls.length} warscrolls, ${abilities.length} abilities, ${fabs.length} faction abilities. Data-update: ${lastUpdate}`);
}

const offline = process.argv.includes('--offline');
if (!offline) await download();
await compile();
