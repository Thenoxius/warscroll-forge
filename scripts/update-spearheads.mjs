#!/usr/bin/env node
// Bouwt data/spearheads.js: de Spearhead-sets (apart spelformaat, eigen warscrolls).
// Bron: Wahapedia — de Spearhead-warscrolls zijn de "virtuele" warscrolls in de CSV-export
// (eigen stats/abilities), de roster + Spearhead-regels komen van de HTML-factiepagina.
//
// POC: alleen Hedonites of Slaanesh. Structuur is generaliseerbaar naar meer facties.
//
// Gebruik:  node scripts/update-spearheads.mjs

import { writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const WH = 'https://wahapedia.ru/aos4/';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) warscroll-forge';

// POC-factielijst (uit te breiden). fid = Wahapedia faction_id, slug = pagina-URL.
const FACTIONS = [
  { name: 'Hedonites of Slaanesh', fid: 'HS', slug: 'hedonites-of-slaanesh' },
];

/* ---------- fetch ---------- */
async function fetchText(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
  return res.text();
}

/* ---------- CSV (| gescheiden, quotes aan veldbegin; met rij-reparatie) ---------- */
function parseCsv(text) {
  const rows = [];
  let row = [], field = '', quoted = false, atStart = true, i = 0;
  text = text.replace(/^﻿/, '');
  while (i < text.length) {
    const c = text[i];
    if (quoted) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i += 2; continue; } quoted = false; i++; continue; }
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
  const fixed = [];
  for (let i = 1; i < rows.length; i++) {
    let r = rows[i];
    while (r.length < hdr.length - 1 && i + 1 < rows.length && r.length + rows[i + 1].length - 1 <= hdr.length) {
      const next = rows[++i];
      r = [...r.slice(0, -1), r[r.length - 1] + '\n' + next[0], ...next.slice(1)];
    }
    fixed.push(r);
  }
  return fixed.map(r => { const o = {}; hdr.forEach((h, idx) => { if (h) o[h] = (r[idx] ?? '').trim(); }); return o; });
}
async function csv(name) { return toObjects(parseCsv(await fetchText(WH + name + '.csv'))); }

/* ---------- Wahapedia-HTML → app-HTML ---------- */
function sanitize(html) {
  if (!html) return '';
  let s = html;
  s = s.replace(/%\d{6,}([^%]*)%/g, '$1');                          // %000123Naam% → Naam
  s = s.replace(/<a\b[^>]*>/gi, '').replace(/<\/a>/gi, '');
  s = s.replace(/<img\b[^>]*>/gi, '');
  // keyword-spans (kwb / kwbu) → placeholder, dan álle spans strippen (tooltips e.d.),
  // dan placeholder → kw-span. Zo blijven de tags gebalanceerd (geen losse </span>).
  s = s.replace(/<span\b[^>]*class="[^"]*\bkw(?:b|bu)\b[^"]*"[^>]*>(.*?)<\/span>/gis, '⟦KW⟧$1⟦/KW⟧');
  s = s.replace(/<\/?span[^>]*>/gi, '');
  s = s.replace(/⟦KW⟧/g, '<span class="kw">').replace(/⟦\/KW⟧/g, '</span>');
  s = s.replace(/<\/span>(\s*)<span class="kw">/g, '$1'); // aangrenzende kw-spans samenvoegen
  // tabellen (bv. de depravity-drempels) → regels/kolommen scheiden vóór het strippen
  s = s.replace(/<\/td>\s*<td[^>]*>/gi, ' — ').replace(/<\/tr>/gi, '<br>');
  s = s.replace(/<div\b[^>]*>/gi, '<br>').replace(/<\/div>/gi, '');
  s = s.replace(/<(?!\/?(b|i|em|strong|br|ul|ol|li|span)\b)[^>]*>/gi, '');
  s = s.replace(/<(b|i|em|strong|ul|ol|li)\b[^>]*>/gi, '<$1>');
  s = s.replace(/<br\b[^>]*>/gi, '<br>');
  s = s.replace(/(<br>\s*)+$/g, '').replace(/^(\s*<br>)+/g, '');
  return s.trim();
}
const plain = s => sanitize(s).replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').trim();

/* ---------- warscroll uit CSV → self-contained kaartobject ---------- */
function buildWarscroll(w, abById, wpById, kwById) {
  const abs = (abById.get(w.id) || []).map(a => ({
    name: a.name, desc: sanitize(a.description), legend: plain(a.legend),
    atype: a.ability_type, reaction: a.is_reaction === 'true',
    cond: plain(a.condition) || (/passive/i.test(a.ability_phase || '') ? '' : ''),
    kw: plain(a.keywords), phase: a.ability_phase, ptype: a.points_type, pts: a.points,
  }));
  const wpns = (wpById.get(w.id) || []).map(x => ({
    name: x.name, rng: x.Rng, atk: x.Atk, hit: x.Hit, wnd: x.Wnd, rnd: x.Rnd, dmg: x.Dmg,
    type: x.type, abilities: plain(x.abilities), bd: x.has_battle_damage === 'true',
  }));
  const kws = (kwById.get(w.id) || []);
  const wardKw = kws.find(k => /^WARD/i.test(k.keyword));
  const ward = wardKw ? (wardKw.parameter || (String(wardKw.keyword).match(/([0-9]\+)/) || [])[1] || '') : '';
  return {
    id: w.id, name: w.name, role: w.role, move: w.Move, save: w.Save, control: w.Control,
    health: w.Health, ward, unitSize: w.UnitSize, cost: w.Cost,
    weapons: wpns, abilities: abs,
    keywords: kws.map(k => ({ kw: k.keyword, fac: k.is_faction_keyword === 'true', param: /^WARD/i.test(k.keyword) ? ward : (k.parameter || '') })),
  };
}

/* ---------- roster uit HTML ---------- */
function parseRoster(html) {
  const i = html.toLowerCase().indexOf('consists of the following units');
  if (i < 0) return { general: [], units: [] };
  const seg = html.slice(i, i + 2000);
  const grab = (label) => {
    const m = seg.match(new RegExp(`hi_custom">${label}</div>\\s*<ul[^>]*>(.*?)</ul>`, 'is'));
    if (!m) return [];
    return [...m[1].matchAll(/<li[^>]*>(.*?)<\/li>/gis)].map(li => {
      const t = li[1].replace(/<[^>]+>/g, '').trim();
      const cm = t.match(/^(\d+)\s+(.*)$/);
      const withM = t.match(/\bwith\b(.*)$/i);
      let count = cm ? +cm[1] : 1;
      let name = (cm ? cm[2] : t).replace(/\bwith\b.*$/i, '').trim();
      return { name, count, note: withM ? withM[1].trim() : '' };
    });
  };
  return { general: grab('General'), units: grab('Units') };
}

/* ---------- Spearhead-regels uit HTML ----------
   Twee structuren: eenvoudige div.h_custom-blokken (battle traits) én Wahapedia's
   ability-cards (td.abHeader = timing + div.abBody met <b>Naam</b> en effecttekst). */
function parseRules(html) {
  const start = html.toLowerCase().indexOf('consists of the following units');
  const end = html.toLowerCase().indexOf('spearhead warscroll', start);
  const seg = html.slice(start, end > 0 ? end : start + 30000);

  const markers = [];
  for (const m of seg.matchAll(/<h3[^>]*outline_header3[^>]*>(.*?)<\/h3>/gis))
    markers.push({ pos: m.index, type: 'section', text: m[1].replace(/<[^>]+>/g, '').trim() });
  for (const m of seg.matchAll(/<div class="h_custom">(.*?)<\/div>/gis))
    markers.push({ pos: m.index, type: 'hcustom', name: m[1].replace(/<[^>]+>/g, '').trim(), bodyStart: m.index + m[0].length });
  for (const m of seg.matchAll(/<td class="abHeader"[^>]*>(.*?)<\/td>/gis)) {
    const timing = m[1].replace(/<img[^>]*>/gi, '').replace(/<[^>]+>/g, '').trim();
    const rest = seg.slice(m.index);
    const bodyM = rest.match(/<div[^>]*class="abBody[^"]*"[^>]*>/i);
    if (bodyM) markers.push({ pos: m.index, type: 'abcard', timing, bodyStart: m.index + bodyM.index + bodyM[0].length });
  }
  markers.sort((a, b) => a.pos - b.pos);

  const rules = [];
  let section = '';
  for (let k = 0; k < markers.length; k++) {
    const mk = markers[k];
    if (mk.type === 'section') { section = mk.text; continue; }
    const bodyEnd = k + 1 < markers.length ? markers[k + 1].pos : seg.length;
    let body = seg.slice(mk.bodyStart, bodyEnd);
    let name = mk.name || '';
    if (mk.type === 'abcard') {
      const nm = body.match(/<b>(.*?)<\/b>/is);
      name = nm ? nm[1].replace(/<span[^>]*>.*?<\/span>/gis, '').replace(/<[^>]+>/g, '').replace(/:\s*$/, '').trim() : '';
      body = body.replace(/<b>.*?<\/b>/is, '');
    }
    const legM = body.match(/<span[^>]*ShowFluff[^>]*legend\d?[^>]*>(.*?)<\/span>/is) || body.match(/<p[^>]*ShowFluff[^>]*>(.*?)<\/p>/is);
    const legend = legM ? plain(legM[1]) : '';
    body = body.replace(/<span[^>]*ShowFluff[^>]*>.*?<\/span>/gis, '').replace(/<p[^>]*ShowFluff[^>]*>.*?<\/p>/gis, '');
    const cond = mk.timing || '';
    const desc = sanitize(body);
    if (name && desc) rules.push({ section, name, cond, phase: cond, legend, desc, atype: '', reaction: false, kw: '', ptype: '', pts: '' });
  }
  return rules;
}

/* ---------- main ---------- */
async function main() {
  console.log('Wahapedia-CSV ophalen…');
  const [wsAll, abAll, wpAll, kwAll] = await Promise.all([
    csv('Warscrolls'), csv('Warscrolls_abilities'), csv('Warscrolls_weapons'), csv('Warscrolls_keywords'),
  ]);
  const group = (arr, key) => { const m = new Map(); for (const x of arr) { (m.get(x[key]) || m.set(x[key], []).get(x[key])).push(x); } return m; };
  const abById = group(abAll, 'warscroll_id');
  const wpById = group(wpAll, 'warscroll_id');
  const kwById = group(kwAll, 'warscroll_id');

  const boxes = [];
  for (const fac of FACTIONS) {
    console.log(`Spearhead: ${fac.name}…`);
    const html = await fetchText(`${WH}factions/${fac.slug}/`);
    // Spearhead-warscrolls = virtuele warscrolls van deze factie
    const virt = wsAll.filter(w => w.faction_id === fac.fid && w.virtual === 'true');
    const warscrolls = {};
    for (const w of virt) warscrolls[w.id] = buildWarscroll(w, abById, wpById, kwById);
    const byName = new Map(virt.map(w => [w.name.toLowerCase(), w.id]));

    const roster = parseRoster(html);
    const link = e => ({ ...e, warscrollId: byName.get(e.name.toLowerCase()) || null });
    const rosterEntries = [
      ...roster.general.map(e => ({ ...link(e), general: true })),
      ...roster.units.map(e => ({ ...link(e), general: false })),
    ];
    // box-naam uit de pagina (Spearhead: <factie> - <naam>), zonder tags/edition-suffix
    const facEsc = fac.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const nameM = html.match(new RegExp(`Spearhead:\\s*${facEsc}\\s*[-–]\\s*([^<(]+)`, 'i'));
    const boxName = nameM ? nameM[1].trim() : `${fac.name} Spearhead`;

    boxes.push({
      id: fac.fid.toLowerCase(), faction: fac.name, name: boxName,
      roster: rosterEntries, warscrolls, rules: parseRules(html),
    });
    console.log(`  ${Object.keys(warscrolls).length} warscrolls, ${rosterEntries.length} roster-items, ${parseRules(html).length} regels — box: ${boxName}`);
  }

  const data = { source: 'Wahapedia', builtAt: new Date().toISOString().slice(0, 10), boxes };
  const js = '// Gegenereerd door scripts/update-spearheads.mjs — niet met de hand bewerken.\n'
    + '// Spearhead-data (apart spelformaat). Bron: Wahapedia. Build: ' + data.builtAt + '\n'
    + 'window.WSF_SPEARHEADS = ' + JSON.stringify(data) + ';\n';
  await writeFile(join(ROOT, 'data', 'spearheads.js'), js, 'utf8');
  console.log(`Klaar: data/spearheads.js (${boxes.length} box).`);
}

await main();
