#!/usr/bin/env node
// Bouwt data/data.js uit de BSData Age of Sigmar 4th catalogi (BattleScribe-XML,
// dezelfde bron als New Recruit). Deze data loopt voor op Wahapedia's CSV-export.
//
// Gebruik:  node scripts/update-data.mjs            (downloaden + compileren)
//           node scripts/update-data.mjs --offline  (compileren uit data/bsdata)
//
// Bron: github.com/BSData/age-of-sigmar-4th (community, open licentie).

import { mkdir, readFile, writeFile, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { XMLParser } from 'fast-xml-parser';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DATA_DIR = join(ROOT, 'data', 'bsdata');
const REPO = 'BSData/age-of-sigmar-4th';
const RAW = `https://raw.githubusercontent.com/${REPO}/main/`;
const UA = 'warscroll-forge data build (github.com/Thenoxius/warscroll-forge)';

/* ---------------- XML ---------------- */
const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '',
  isArray: (n) => [
    'selectionEntry', 'selectionEntryGroup', 'entryLink', 'categoryLink', 'profile',
    'characteristic', 'cost', 'constraint', 'rule', 'infoLink', 'catalogueLink',
    'publication', 'sharedSelectionEntry', 'sharedSelectionEntryGroup', 'sharedProfile',
  ].includes(n),
});
const arr = (v) => (v == null ? [] : Array.isArray(v) ? v : [v]);

/* ---------------- tekst-opmaak ----------------
   BSData gebruikt **vet**, ^^keyword^^ en \n. Omzetten naar de HTML die de app rendert. */
const esc = (s) => String(s ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
function markup(s) {
  if (!s) return '';
  let t = esc(s);
  t = t.replace(/\*\*(.+?)\*\*/gs, '<b>$1</b>');
  t = t.replace(/\^\^(.+?)\^\^/gs, '<span class="kw">$1</span>');
  t = t.replace(/\r?\n/g, '<br>');
  return t.trim();
}
const plain = (s) => String(s ?? '').replace(/\*\*|\^\^/g, '').replace(/\r?\n/g, ' ').trim();

/* ---------------- download ---------------- */
async function fetchText(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
  return res.text();
}
async function download() {
  await mkdir(DATA_DIR, { recursive: true });
  const tree = JSON.parse(await fetchText(`https://api.github.com/repos/${REPO}/git/trees/main?recursive=1`));
  const files = tree.tree.filter((t) => t.path.endsWith('.cat') || t.path.endsWith('.gst')).map((t) => t.path);
  console.log(`Downloaden van ${files.length} catalogi…`);
  let done = 0;
  for (const f of files) {
    const txt = await fetchText(RAW + encodeURIComponent(f).replace(/%2F/g, '/'));
    await writeFile(join(DATA_DIR, f), txt, 'utf8');
    if (++done % 20 === 0) console.log(`  ${done}/${files.length}`);
  }
  console.log(`  ${files.length}/${files.length} klaar.`);
}

/* ---------------- laden ---------------- */
async function loadAll() {
  const names = (await readdir(DATA_DIR)).filter((f) => f.endsWith('.cat') || f.endsWith('.gst'));
  const cats = [];
  for (const n of names) {
    const doc = parser.parse(await readFile(join(DATA_DIR, n), 'utf8'));
    const root = doc.catalogue || doc.gameSystem;
    if (root) cats.push({ file: n, name: root.name || n, root });
  }
  return cats;
}

/* ---------------- boom-helpers ---------------- */
// Verzamel alle nodes van gegeven containertype (bv. 'selectionEntry') ergens in de boom.
function collect(node, kind, out = []) {
  if (!node || typeof node !== 'object') return out;
  for (const [key, val] of Object.entries(node)) {
    for (const child of arr(val)) {
      if (typeof child !== 'object') continue;
      if (key === kind) out.push(child);
      collect(child, kind, out);
    }
  }
  return out;
}
// Directe kinderen van een bepaald containertype: node.<plural>.<kind>
const children = (node, plural, kind) => arr(node?.[plural]?.[kind]);

// Profielen (inline + via infoLink) binnen een subtree, zonder in geneste units te duiken.
function unitProfiles(node, profileById, out = []) {
  for (const p of children(node, 'profiles', 'profile')) out.push(p);
  for (const l of children(node, 'infoLinks', 'infoLink')) {
    const p = profileById.get(l.targetId);
    if (p) out.push(p);
  }
  for (const plural of ['selectionEntries', 'selectionEntryGroups']) {
    for (const kind of ['selectionEntry', 'selectionEntryGroup']) {
      for (const c of children(node, plural, kind)) {
        if (c.type === 'unit') continue; // niet in een geneste unit duiken
        unitProfiles(c, profileById, out);
      }
    }
  }
  return out;
}
function unitCategoryLinks(node, out = []) {
  for (const c of children(node, 'categoryLinks', 'categoryLink')) out.push(c);
  for (const plural of ['selectionEntries', 'selectionEntryGroups']) {
    for (const kind of ['selectionEntry', 'selectionEntryGroup']) {
      for (const c of children(node, plural, kind)) {
        if (c.type === 'unit') continue;
        unitCategoryLinks(c, out);
      }
    }
  }
  return out;
}

/* ---------------- characteristic-helpers ---------------- */
const chars = (profile) => {
  const m = {};
  for (const c of children(profile, 'characteristics', 'characteristic')) m[c.name] = (c['#text'] ?? '').toString();
  return m;
};
const typeName = (p) => p.typeName || '';

/* ---------------- ability parsen ---------------- */
function parseAbility(p, line) {
  const c = chars(p);
  const tn = typeName(p);
  let ptype = '';
  let pts = '';
  if (tn.includes('Spell')) { ptype = 'Spell'; pts = c['Casting Value'] || ''; }
  else if (tn.includes('Prayer')) { ptype = 'Prayer'; pts = c['Chanting Value'] || ''; }
  else if (tn.includes('Command')) { ptype = 'Command'; pts = c['Cost'] || ''; }
  else if (tn.includes('Blood Tithe')) { ptype = 'Blood tithe'; pts = c['Blood Tithe Points'] || ''; }
  else if (tn.includes('Fate')) { ptype = 'Fate'; pts = c['Fate Points'] || ''; }
  const timing = c['Timing'] || (tn.includes('Passive') ? 'Passive' : '');
  const parts = [];
  if (c['Declare']) parts.push('<b>Declare:</b> ' + markup(c['Declare']));
  if (c['Effect']) parts.push('<b>Effect:</b> ' + markup(c['Effect']));
  if (c['Unlock Condition']) parts.push('<b>Unlock:</b> ' + markup(c['Unlock Condition']));
  return {
    line, name: p.name, desc: parts.join('<br>'), legend: '',
    atype: '', reaction: /reaction/i.test(timing), cond: timing, kw: plain(c['Keywords'] || ''),
    phase: timing, ptype, pts: String(pts || ''),
  };
}

/* ---------------- weapon parsen ---------------- */
function parseWeapon(p, line) {
  const c = chars(p);
  const ranged = typeName(p).includes('Ranged');
  return {
    line, name: p.name,
    rng: c['Rng'] || '', atk: c['Atk'] || '', hit: c['Hit'] || '', wnd: c['Wnd'] || '',
    rnd: c['Rnd'] || '', dmg: c['Dmg'] || '', type: ranged ? 'RANGED' : 'MELEE',
    abilities: plain(c['Ability'] || ''), bd: false,
  };
}

/* ---------------- rol afleiden uit keywords ---------------- */
function deriveRole(kwUpper) {
  const has = (k) => kwUpper.includes(k);
  if (has('FACTION TERRAIN') || has('TERRAIN')) return 'Faction Terrain';
  if (has('MANIFESTATION') || has('ENDLESS SPELL') || has('INVOCATION')) return 'Manifestation';
  const body = has('MONSTER') ? 'Monster' : has('CAVALRY') ? 'Cavalry' : has('WAR MACHINE') ? 'War Machine' : has('INFANTRY') ? 'Infantry' : '';
  if (has('HERO')) return (body && body !== 'Infantry' ? body + ' ' : (body === 'Infantry' ? 'Infantry ' : '')) + 'Hero';
  return body || '';
}

/* ---------------- hoofdcompilatie ---------------- */
async function compile() {
  const cats = await loadAll();

  // faction-lijst = de speelbare hoofd-catalogi (bestand zonder ' - ' en zonder LEGENDS)
  const factionFiles = cats.filter((c) => /\.cat$/.test(c.file) && !c.file.includes(' - ') && !/LEGENDS/i.test(c.file)
    && !/^(Lores|Regiments of Renown|Path to Glory|Legions of Nagash|The Duardin Ascendant|Big Waaagh)/.test(c.file));
  const factionNames = factionFiles.map((c) => c.name.replace(/\.cat$/, '').trim());
  const factions = {}; // fid -> naam (fid == naam voor eenvoud)
  for (const n of factionNames) factions[n] = n;
  const facByKeyword = new Map(); // UPPERCASE keyword -> fid
  for (const n of factionNames) facByKeyword.set(n.toUpperCase(), n);

  // globale index van gedeelde profielen (voor infoLink-resolutie)
  const profileById = new Map();
  for (const c of cats) {
    for (const p of collect(c.root, 'profile')) if (p.id) profileById.set(p.id, p);
    for (const p of children(c.root, 'sharedProfiles', 'sharedProfile')) if (p.id) profileById.set(p.id, p);
  }

  // puntenkaart: unitnaam -> kosten (uit alle catalogi; hoogste niet-nul wint)
  const costByName = new Map();
  for (const c of cats) {
    for (const e of [...collect(c.root, 'selectionEntry'), ...collect(c.root, 'entryLink')]) {
      if (!e.name) continue;
      for (const cost of children(e, 'costs', 'cost')) {
        if ((cost.name || '').toLowerCase().includes('pts')) {
          const v = parseInt(cost.value, 10);
          if (v > 0 && !costByName.has(e.name)) costByName.set(e.name, String(v));
        }
      }
    }
  }

  /* ----- warscrolls uit de '* - Library.cat' bestanden ----- */
  const warscrolls = [];
  const abilities = [];
  const weapons = [];
  const keywords = [];
  const seenUnits = new Set();

  const libFiles = cats.filter((c) => / - Library\.cat$/.test(c.file));
  for (const lib of libFiles) {
    const libFaction = lib.name.replace(/ - Library$/, '').trim();
    for (const unit of collect(lib.root, 'selectionEntry').filter((e) => e.type === 'unit')) {
      if (!unit.name || unit.id == null) continue;
      const profs = unitProfiles(unit, profileById);
      const statP = profs.find((p) => typeName(p) === 'Unit' || typeName(p) === 'Manifestation');
      if (!statP) continue; // geen warscroll-statblok → geen kaart
      const id = unit.id;
      if (seenUnits.has(id)) continue;
      seenUnits.add(id);

      const st = chars(statP);
      const kls = unitCategoryLinks(unit);
      const kwUpper = kls.map((k) => (k.name || '').toUpperCase());
      // faction bepalen: via faction-keyword, anders het library-bestand
      let fid = libFaction;
      for (const k of kwUpper) if (facByKeyword.has(k)) { fid = facByKeyword.get(k); break; }
      const wardKw = kls.find((k) => /^WARD/i.test(k.name || ''));
      const wardParam = wardKw ? (String(wardKw.name).match(/\(?([0-9]\+)\)?/) || [])[1] || '' : '';

      // unit size uit model-constraint (max selecties)
      let unitSize = '';
      const model = collect(unit, 'selectionEntry').find((e) => e.type === 'model');
      if (model) {
        const maxC = children(model, 'constraints', 'constraint').find((c) => c.type === 'max');
        if (maxC && +maxC.value > 0 && +maxC.value < 1000) unitSize = String(maxC.value);
      }

      warscrolls.push({
        id, name: unit.name, fid, role: deriveRole(kwUpper), virtual: false,
        legend: '', notes: '', regOptions: '',
        move: st['Move'] || '', save: st['Save'] || '', control: st['Control'] || '',
        health: st['Health'] || '', ward: wardParam, unitSize, cost: costByName.get(unit.name) || '',
      });

      let aLine = 0, wLine = 0;
      for (const p of profs) {
        const tn = typeName(p);
        if (tn.startsWith('Ability')) abilities.push({ wid: id, ...parseAbility(p, ++aLine) });
        else if (tn.includes('Weapon')) weapons.push({ wid: id, ...parseWeapon(p, ++wLine) });
      }
      for (const k of kls) {
        const name = (k.name || '').replace(/\s*\([0-9]\+\)$/, '');
        const param = /^WARD/i.test(k.name || '') ? wardParam : '';
        const fac = facByKeyword.has((k.name || '').toUpperCase()) || ['CHAOS', 'ORDER', 'DEATH', 'DESTRUCTION'].includes((k.name || '').toUpperCase());
        keywords.push({ wid: id, kw: name, fac, param });
      }
    }
  }

  /* ----- faction abilities: lores (universeel) + enhancements/formations/traits (per factie) ----- */
  const fabTypes = [];
  const fabSubtypes = [];
  const fabs = [];

  // index van entries (voor entryLink-resolutie): gedeelde + gewone met id
  const entryById = new Map();
  for (const c of cats) {
    for (const e of collect(c.root, 'selectionEntry')) if (e.id) entryById.set(e.id, e);
    for (const e of collect(c.root, 'selectionEntryGroup')) if (e.id) entryById.set(e.id, e);
  }

  const abilityProfilesOf = (node) => {
    const out = [];
    for (const p of children(node, 'profiles', 'profile')) if (typeName(p).startsWith('Ability')) out.push(p);
    for (const l of children(node, 'infoLinks', 'infoLink')) {
      const p = profileById.get(l.targetId);
      if (p && typeName(p).startsWith('Ability')) out.push(p);
    }
    return out;
  };
  // kinderen van een groep (selectionEntries + opgeloste entryLinks)
  const groupItems = (group) => {
    const items = [];
    for (const se of children(group, 'selectionEntries', 'selectionEntry')) items.push(se);
    for (const el of children(group, 'entryLinks', 'entryLink')) items.push(entryById.get(el.targetId) || el);
    return items;
  };

  const typeId = (fid, name) => `${fid}::${name}`;
  const ensureType = (fid, name) => {
    const id = typeId(fid, name);
    if (!fabTypes.some((t) => t.id === id && t.fid === fid)) fabTypes.push({ fid, id, name, desc: '' });
    return id;
  };
  const ensureSub = (fid, name, tId) => {
    const id = `${fid}::sub::${name}`;
    if (!fabSubtypes.some((s) => s.id === id && s.fid === fid)) fabSubtypes.push({ fid, id, name, typeId: tId, desc: '', legend: '' });
    return id;
  };
  const pushFabs = (fid, typeNameStr, subName, subId, node) => {
    let line = 0;
    for (const p of abilityProfilesOf(node)) {
      fabs.push({ fid, typeName: typeNameStr, subId, subName, ...parseAbility(p, ++line) });
    }
    return line;
  };

  // Lores.cat → universele spell/prayer/manifestation lores
  const loresCat = cats.find((c) => /^Lores\.cat$/.test(c.file));
  if (loresCat) {
    for (const g of children(loresCat.root, 'sharedSelectionEntryGroups', 'selectionEntryGroup')) {
      const items = groupItems(g);
      if (!items.length) continue;
      const profs = items.flatMap(abilityProfilesOf);
      if (!profs.length) continue;
      const allSummon = items.every((i) => /^summon\b/i.test(i.name || ''));
      const isPrayer = profs.some((p) => typeName(p).includes('Prayer'));
      const kind = /manifestation/i.test(g.name) || allSummon ? 'Manifestation Lore'
        : isPrayer ? 'Prayer Lore' : 'Spell Lore';
      const tId = ensureType('', kind);
      const sId = ensureSub('', g.name, tId);
      let line = 0;
      for (const item of items) {
        for (const p of abilityProfilesOf(item)) {
          // Manifestatie-lore = alleen de summon-spells; de eigen abilities van de
          // manifestatie horen op háár warscroll, niet op de lore-kaart.
          if (kind === 'Manifestation Lore' && !/Spell|Prayer/.test(typeName(p)) && !/^summon\b/i.test(p.name || '')) continue;
          fabs.push({ fid: '', typeName: kind, subId: sId, subName: g.name, ...parseAbility(p, ++line) });
        }
      }
    }
  }

  // Per factie: enhancement-/formation-/trait-groepen uit de hoofd-.cat
  const SKIP_GROUPS = /battle wounds|scars|^paths$|path to glory|command traits pool|^allies$/i;
  const LORE_GROUP = /^(spell|prayer|manifestation) lores?$/i;
  for (const fc of factionFiles) {
    const fid = fc.name.replace(/\.cat$/, '').trim();
    // Top-containers: enhancement-groepen + losse entries als 'Battle Traits' (die eigen ability-profielen dragen)
    const groups = [
      ...children(fc.root, 'sharedSelectionEntryGroups', 'selectionEntryGroup'),
      ...children(fc.root, 'selectionEntryGroups', 'selectionEntryGroup'),
      ...children(fc.root, 'sharedSelectionEntries', 'selectionEntry').filter((e) => /battle traits?/i.test(e.name || '')),
      ...children(fc.root, 'selectionEntries', 'selectionEntry').filter((e) => /battle traits?/i.test(e.name || '')),
    ];
    for (const g of groups) {
      if (!g.name || SKIP_GROUPS.test(g.name)) continue;
      // Lore-groepen in de factie-cat linken naar Lores.cat (al gedekt) → overslaan
      if (LORE_GROUP.test(g.name)) continue;

      const isFormation = /formation/i.test(g.name);
      const tName = isFormation ? 'Battle Formations'
        : /battle trait/i.test(g.name) ? 'Battle Traits'
        : g.name;
      const tId = ensureType(fid, tName);

      // Emit eigen ability-profielen van een container + items + geneste subgroepen
      const walkGroup = (grp, ownSub) => {
        const ownProfs = abilityProfilesOf(grp);
        if (ownProfs.length) {
          const subName = ownSub || grp.name;
          const sId = ensureSub(fid, subName, tId);
          let ln = 0;
          for (const p of ownProfs) fabs.push({ fid, typeName: tName, subId: sId, subName, ...parseAbility(p, ++ln) });
        }
        for (const item of groupItems(grp)) {
          const profs = abilityProfilesOf(item);
          if (!profs.length) continue;
          // Formatie: elk item is een eigen subtype (naam = itemnaam); anders groepeer op groepsnaam
          const subName = isFormation ? (item.name || grp.name) : grp.name;
          const sId = ensureSub(fid, subName, tId);
          for (const p of profs) fabs.push({ fid, typeName: tName, subId: sId, subName, ...parseAbility(p, 1) });
        }
        for (const sg of children(grp, 'selectionEntryGroups', 'selectionEntryGroup')) walkGroup(sg);
      };
      walkGroup(g);
    }
  }

  const data = {
    lastUpdate: new Date().toISOString().slice(0, 10) + ' (BSData)',
    factions, warscrolls, abilities, weapons, keywords,
    bases: [], org: [], fabTypes, fabSubtypes, fabs,
  };
  const js = '// Gegenereerd door scripts/update-data.mjs — niet met de hand bewerken.\n'
    + '// Bron: BSData Age of Sigmar 4th (community, powered by BattleScribe-data). Build: ' + data.lastUpdate + '\n'
    + 'window.WSF_DATA = ' + JSON.stringify(data) + ';\n';
  await writeFile(join(ROOT, 'data', 'data.js'), js, 'utf8');
  console.log(`Gecompileerd: ${warscrolls.length} warscrolls, ${abilities.length} abilities, ${weapons.length} weapons, ${keywords.length} keywords, ${Object.keys(factions).length} facties.`);
  console.log(`Faction abilities: ${fabTypes.length} types, ${fabSubtypes.length} subtypes, ${fabs.length} abilities.`);
}

const offline = process.argv.includes('--offline');
if (!offline) await download();
await compile();
