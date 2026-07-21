/* Warscroll Forge — parser, matching en kaart-rendering (alles lokaal) */
(() => {
'use strict';
const D = window.WSF_DATA;
if (!D) { document.getElementById('status').textContent = 'FOUT: data/data.js ontbreekt. Draai: node scripts/update-data.mjs'; return; }

/* ---------- helpers ---------- */
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const norm = s => String(s ?? '')
  .toLowerCase()
  .replace(/[’‘`]/g, "'")
  .replace(/[“”]/g, '"')
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/\s+/g, ' ')
  .trim();
const tokens = s => new Set(norm(s).replace(/[^a-z0-9' ]/g, ' ').split(/\s+/).filter(w => w && !['the', 'of', 'a'].includes(w)));
function sim(a, b) {
  const ta = tokens(a), tb = tokens(b);
  if (!ta.size || !tb.size) return 0;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  return (2 * inter) / (ta.size + tb.size);
}

/* ---------- indexen ---------- */
const wsById = new Map();
const wsList = [];
for (const w of D.warscrolls) { wsById.set(w.id, w); wsList.push(w); }
const byWid = (arr) => {
  const m = new Map();
  for (const x of arr) { if (!m.has(x.wid)) m.set(x.wid, []); m.get(x.wid).push(x); }
  for (const v of m.values()) v.sort((a, b) => (a.line || 0) - (b.line || 0));
  return m;
};
const absByWid = byWid(D.abilities);
const wpnByWid = byWid(D.weapons);
const kwByWid = byWid(D.keywords);
const baseByWid = byWid(D.bases);
const factionIdByName = new Map(Object.entries(D.factions).map(([id, name]) => [norm(name), id]));
const fabsBySub = new Map();
for (const f of D.fabs) { if (!fabsBySub.has(f.subId)) fabsBySub.set(f.subId, []); fabsBySub.get(f.subId).push(f); }
for (const v of fabsBySub.values()) v.sort((a, b) => (a.line || 0) - (b.line || 0));

const warnings = [];
const warn = msg => warnings.push(msg);

/* ---------- zoeken ---------- */
function findWarscroll(name, fid) {
  const n = norm(name);
  const rank = w => (w.virtual ? 0 : 4) + (fid && w.fid === fid ? 2 : 0) + (w.cost ? 1 : 0);
  let hits = wsList.filter(w => norm(w.name) === n);
  if (hits.length) return hits.sort((a, b) => rank(b) - rank(a))[0];
  // bevat / begint met
  hits = wsList.filter(w => { const wn = norm(w.name); return wn.includes(n) || n.includes(wn); });
  if (hits.length) {
    const best = hits.sort((a, b) => (rank(b) - rank(a)) || (Math.abs(norm(a.name).length - n.length) - Math.abs(norm(b.name).length - n.length)))[0];
    warn(`‘${name}’ gelezen als warscroll ‘${best.name}’.`);
    return best;
  }
  // fuzzy
  let best = null, bestS = 0.58;
  for (const w of wsList) {
    const s = sim(w.name, n) + rank(w) * 0.01;
    if (s > bestS) { bestS = s; best = w; }
  }
  if (best) warn(`‘${name}’ gelezen als warscroll ‘${best.name}’ (fuzzy).`);
  return best;
}

function findSubtype(name, fid, typeFilter) {
  const n = norm(name);
  const cand = D.fabSubtypes.filter(s => !typeFilter || typeFilter(s));
  const rank = s => (fid && s.fid === fid ? 2 : 0);
  let hits = cand.filter(s => norm(s.name) === n);
  if (!hits.length) hits = cand.filter(s => { const sn = norm(s.name); return sn.includes(n) || n.includes(sn); });
  if (!hits.length) {
    let best = null, bestS = 0.55;
    for (const s of cand) { const v = sim(s.name, n) + rank(s) * 0.01; if (v > bestS) { bestS = v; best = s; } }
    return best;
  }
  return hits.sort((a, b) => rank(b) - rank(a))[0];
}

const typeNameOf = sub => (D.fabTypes.find(t => t.id === sub.typeId && t.fid === sub.fid) || D.fabTypes.find(t => t.id === sub.typeId) || {}).name || '';

function findEnhancement(name, fid) {
  const n = norm(name);
  const rank = f => (fid && f.fid === fid ? 2 : 0);
  let hits = D.fabs.filter(f => norm(f.name) === n);
  if (!hits.length) hits = D.fabs.filter(f => norm(f.name).includes(n) || n.includes(norm(f.name)));
  if (!hits.length) {
    let best = null, bestS = 0.7;
    for (const f of D.fabs) { const v = sim(f.name, n) + rank(f) * 0.01; if (v > bestS) { bestS = v; best = f; } }
    return best;
  }
  return hits.sort((a, b) => rank(b) - rank(a))[0];
}

/* ---------- lijst-parser ---------- */
function parseList(text) {
  const lines = text.split(/\r?\n/).map(l => l.trim());
  const out = { alliance: '', faction: '', formation: '', battlepack: '', drops: '', lores: [], sections: [], pts: null, ptsMax: null };
  let section = null, unit = null, inPreamble = true;
  const isSep = l => /^-{3,}$/.test(l);
  const knownHeader = l => /^(general'?s regiment|regiment \d+|auxiliary units?|faction terrain|terrain|regiments? of renown|endless spells?|manifestations?|spearhead)$/i.test(l);
  for (const raw of lines) {
    const l = raw;
    if (!l) continue;
    if (/^created with/i.test(l) || /^app version/i.test(l)) continue;
    if (isSep(l)) { inPreamble = false; section = null; unit = null; continue; }

    if (inPreamble) {
      if (l.includes('|')) {
        const parts = l.split('|').map(p => p.trim());
        [out.alliance, out.faction, out.formation] = [parts[0] || '', parts[1] || '', parts[2] || ''];
        continue;
      }
      let m;
      if ((m = l.match(/^drops\s*:\s*(\d+)/i))) { out.drops = m[1]; continue; }
      if ((m = l.match(/^(spell|manifestation|prayer)\s+lores?\s*[-–—:]\s*(.+)$/i))) { out.lores.push({ kind: m[1], name: m[2].trim() }); continue; }
      if ((m = l.match(/(\d+)\s*\/\s*(\d+)\s*(?:pts|points)/i))) { out.pts = +m[1]; out.ptsMax = +m[2]; continue; }
      if (!out.battlepack) { out.battlepack = l; continue; }
      continue;
    }

    let m;
    if ((m = l.match(/^[•·▪‣*]\s*(.+)$/)) || (m = l.match(/^-\s+(.+)$/))) {
      if (unit) unit.bullets.push(m[1].trim());
      continue;
    }
    if (!section && !l.match(/\((\d+)\)\s*$/) || knownHeader(l)) {
      if (knownHeader(l) || !section) { section = { title: l, units: [] }; out.sections.push(section); unit = null; continue; }
    }
    if (!section) { section = { title: 'Overig', units: [] }; out.sections.push(section); }
    if ((m = l.match(/^(.+?)\s*\((\d+)\)\s*$/))) {
      unit = { name: m[1].trim(), pts: +m[2], bullets: [] };
    } else {
      unit = { name: l, pts: null, bullets: [] };
    }
    section.units.push(unit);
  }
  return out;
}

/* ---------- fase-kleuren & iconen ---------- */
function phaseKey(a) {
  const ph = norm(a.phase || '');
  if (ph.includes('hero')) return 'hero';
  if (ph.includes('movement')) return 'movement';
  if (ph.includes('shooting')) return 'shooting';
  if (ph.includes('charge')) return 'charge';
  if (ph.includes('combat')) return 'combat';
  if (ph.includes('end')) return 'end';
  if (ph.includes('start')) return 'start';
  if (ph.includes('defensive')) return 'defensive';
  const c = norm(a.cond || '');
  if (c.includes('deployment')) return 'start';
  return 'passive';
}
const iconFor = t => ({
  Offensive: 'i-offensive', Defensive: 'i-defensive', Special: 'i-special', Control: 'i-control',
  Movement: 'i-movement', Shooting: 'i-shooting', Rallying: 'i-rallying', Damage: 'i-damage',
}[t] || null);

/* ---------- render-bouwstenen ---------- */
const optFlavour = () => $('#optFlavour').checked;

function abilityBlock(a, tag) {
  const key = phaseKey(a);
  const cond = a.cond || a.phase || 'Passive';
  const icon = iconFor(a.atype);
  let chip = '';
  if (a.ptype === 'Spell' && a.pts) chip = `<span class="tag">Spell · CV ${esc(a.pts)}</span>`;
  else if (a.ptype === 'Prayer' && a.pts) chip = `<span class="tag">Prayer · ${esc(a.pts)}</span>`;
  else if (a.ptype === 'Command') chip = `<span class="tag">Command${a.pts ? ' · ' + esc(a.pts) + ' CP' : ''}</span>`;
  else if (a.ptype && a.pts) chip = `<span class="tag">${esc(a.ptype)} · ${esc(a.pts)}</span>`;
  if (tag) chip += `<span class="tag">${esc(tag)}</span>`;
  const legend = optFlavour() && a.legend ? `<div class="legend">${esc(a.legend)}</div>` : '';
  return `<div class="ab" style="--ph: var(--ph-${key})">
    <div class="ab-head"><span class="cond">${esc(cond)}${a.reaction ? ' — Reaction' : ''}</span>
      ${icon ? `<span class="icons"><svg><use href="#${icon}"/></svg></span>` : ''}</div>
    <div class="ab-name">${esc(a.name)}${chip}</div>
    <div class="ab-body">${legend}${a.desc || ''}</div>
    ${a.kw ? `<div class="ab-kw">Keywords: ${esc(a.kw)}</div>` : ''}
  </div>`;
}

function weaponsTable(list, ranged) {
  if (!list.length) return '';
  const cols = ranged ? ['Rng', 'Atk', 'Hit', 'Wnd', 'Rnd', 'Dmg'] : ['Atk', 'Hit', 'Wnd', 'Rnd', 'Dmg'];
  const rows = list.map(w => `<tr><td class="wname">${esc(w.name)}${w.abilities ? `<span class="wab">${esc(w.abilities)}</span>` : ''}${w.bd ? '<span class="wab">Battle Damage</span>' : ''}</td>` +
    cols.map(c => `<td>${esc(w[c.toLowerCase()] || '-')}</td>`).join('') + '</tr>').join('');
  return `<table class="weapons"><caption>${ranged ? 'Ranged weapons' : 'Melee weapons'}</caption>
    <tr><th>Naam</th>${cols.map(c => `<th>${c}</th>`).join('')}</tr>${rows}</table>`;
}

function statCluster(w) {
  const stat = (cls, val, lbl) => `<div class="stat ${cls}"><b>${esc(val || '–')}</b><span>${lbl}</span></div>`;
  return `<div class="stats">
    ${stat('move', w.move, 'Move')}
    ${stat('save', w.save, 'Save')}
    ${stat('control', w.control || (norm(w.role).includes('terrain') ? '–' : ''), 'Control')}
    ${stat('health', w.health, 'Health')}
    ${w.ward ? stat('ward', w.ward, 'Ward') : ''}
  </div>`;
}

function cardShell({ cls = '', head, body, foot = '', kws = '' }) {
  return `<article class="card ${cls}">
    ${head}<div class="card-body"><div class="fitbox">${body}</div></div>${kws}${foot ? `<div class="card-foot">${foot}</div>` : ''}
  </article>`;
}

/* A6-modus: schaal de kaartinhoud zodat die exact in de vaste kaarthoogte past.
   Zou een kaart kleiner dan ~70% moeten, dan proberen we de abilities eerst in
   twee kolommen — dat houdt de tekst groter en leesbaarder. */
function fitA6() {
  const a6 = $('#cards').classList.contains('size-a6');
  for (const card of document.querySelectorAll('#cards .card')) {
    const body = card.querySelector('.card-body');
    const fit = body && body.querySelector(':scope > .fitbox');
    if (!fit) continue;
    fit.style.transform = '';
    fit.style.width = '';
    fit.classList.remove('two-col');
    if (!a6) continue;
    const cs = getComputedStyle(body);
    const availH = body.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
    const availW = body.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    if (fit.offsetHeight <= availH + 1) continue;
    const search = () => {
      let lo = 0.3, hi = 1, best = 0.3;
      for (let i = 0; i < 7; i++) {
        const mid = (lo + hi) / 2;
        fit.style.width = (availW / mid) + 'px';
        if (fit.offsetHeight * mid <= availH) { best = mid; lo = mid; } else { hi = mid; }
      }
      return best;
    };
    let best = search();
    if (best < 0.7 && fit.querySelectorAll('.ab').length > 1) {
      fit.classList.add('two-col');
      const best2 = search();
      if (best2 > best + 0.03) best = best2;
      else fit.classList.remove('two-col');
    }
    fit.style.width = (availW / best) + 'px';
    fit.style.transform = `scale(${best})`;
  }
}

function unitCard(w, ctx = {}) {
  const abs = absByWid.get(w.id) || [];
  const wpns = wpnByWid.get(w.id) || [];
  const kws = kwByWid.get(w.id) || [];
  const bases = baseByWid.get(w.id) || [];
  const pts = ctx.pts ?? (w.cost || null);
  const chips = [];
  if (ctx.general) chips.push('★ Generaal');
  if (ctx.reinforced) chips.push('Versterkt ×2');
  if (ctx.tag) chips.push(ctx.tag);
  const subtitleBits = [D.factions[w.fid] || '', w.role, chips.join(' · ')].filter(Boolean);
  const legend = optFlavour() && w.legend ? `<div class="ab-body legend" style="padding:2px 2px 6px;font-style:italic;color:#6b5d3d;font-size:10.5px">${esc(w.legend)}</div>` : '';

  const enh = (ctx.enhancements || []).map(e => {
    if (e.fab) return abilityBlock(e.fab, e.fab.typeName || 'Enhancement');
    return `<div class="ab" style="--ph: var(--ph-passive)"><div class="ab-head"><span class="cond">Enhancement</span></div>
      <div class="ab-name">${esc(e.name)}</div>
      <div class="ab-body missing" style="font-style:italic;color:#7a2a22">Regels niet gevonden in de lokale data — noteer zelf:</div>
      <div class="ab-body"><div class="write-lines"></div><div class="write-lines"></div></div></div>`;
  }).join('');

  const kwMain = kws.filter(k => !k.fac).map(k => k.kw + (k.param ? ` (${k.param})` : '')).join(', ');
  const kwFac = kws.filter(k => k.fac).map(k => k.kw).join(', ');
  const baseTxt = [...new Set(bases.map(b => b.base + (bases.length > 1 && b.model ? ` (${b.model})` : '')))].join(' · ');
  const unitSize = ctx.reinforced && w.unitSize ? `${+w.unitSize * 2} (versterkt)` : w.unitSize;

  return cardShell({
    cls: ctx.cls || 'unit',
    head: `<header class="card-head" title="Klik om deze kaart bij het afdrukken over te slaan">
      ${ctx.count > 1 ? `<div class="count-badge">${ctx.count}×</div>` : ''}
      ${statCluster(w)}
      <div class="title"><h2>${esc(w.name)}</h2><div class="subtitle">${esc(subtitleBits.join(' • '))}</div></div>
      ${pts ? `<div class="pts"><b>${esc(pts)}</b><span>pts</span></div>` : ''}
    </header>`,
    body: `${legend}
      ${weaponsTable(wpns.filter(x => x.type === 'RANGED'), true)}
      ${weaponsTable(wpns.filter(x => x.type === 'MELEE'), false)}
      <div class="abilities">${abs.map(a => abilityBlock(a)).join('')}${enh}</div>`,
    kws: `${kwMain ? `<div class="kwbar"><span class="lbl">Keywords</span><span class="vals">${esc(kwMain)}</span></div>` : ''}
      ${kwFac ? `<div class="kwbar fac"><span class="lbl">Faction</span><span class="vals">${esc(kwFac)}</span></div>` : ''}`,
    foot: [unitSize ? `Unit size: ${esc(unitSize)}` : '', baseTxt ? `Base: ${esc(baseTxt)}` : '', ctx.regiment ? esc(ctx.regiment) : ''].filter(Boolean).join('<span>&nbsp;</span><span>·</span><span>&nbsp;</span>'),
  });
}

function placeholderCard(name, kind, ctx = {}) {
  return cardShell({
    cls: 'placeholder',
    head: `<header class="card-head"><div class="title"><h2>${esc(name)}</h2>
      <div class="subtitle">${esc(kind)}${ctx.general ? ' • ★ Generaal' : ''}</div></div>
      ${ctx.pts ? `<div class="pts"><b>${esc(ctx.pts)}</b><span>pts</span></div>` : ''}</header>`,
    body: `<p class="missing">Niet gevonden in de lokale Wahapedia-data (export van ${esc(D.lastUpdate.split(' ')[0] || '?')}).
      Waarschijnlijk nieuwer dan de laatste export — draai <b>node scripts/update-data.mjs</b> of noteer de regels hieronder.</p>
      ${'<div class="write-lines"></div>'.repeat(6)}
      ${(ctx.bullets || []).length ? `<p class="missing">Opties uit je lijst: ${esc(ctx.bullets.join(', '))}</p>` : ''}`,
  });
}

function fabGroupCard(title, subtitle, fabs, opts = {}) {
  return cardShell({
    cls: opts.cls || 'lore',
    head: `<header class="card-head"><div class="title"><h2>${esc(title)}</h2><div class="subtitle">${esc(subtitle)}</div></div></header>`,
    body: `${opts.intro || ''}<div class="abilities">${fabs.map(f => abilityBlock(f)).join('')}</div>`,
  });
}

const sectionBreak = t => `<div class="section-break no-print-break">${esc(t)}</div>`;

/* ---------- opbouw van alle kaarten ---------- */
function buildCards(parsed) {
  warnings.length = 0;
  const fid = factionIdByName.get(norm(parsed.faction)) || null;
  if (parsed.faction && !fid) warn(`Factie ‘${parsed.faction}’ niet herkend — er wordt zonder factie-voorkeur gezocht.`);
  const html = [];

  /* Overzichtskaart */
  const listPts = parsed.sections.flatMap(s => s.units).reduce((t, u) => t + (u.pts || 0), 0);
  if ($('#optOverview').checked) {
    const meta = [
      parsed.alliance && `<span class="chip">${esc(parsed.alliance)}</span>`,
      parsed.battlepack && `<span class="chip">${esc(parsed.battlepack)}</span>`,
      parsed.drops && `<span class="chip">Drops: ${esc(parsed.drops)}</span>`,
      `<span class="chip">${listPts}${parsed.ptsMax ? ' / ' + parsed.ptsMax : ''} pts</span>`,
      ...parsed.lores.map(l => `<span class="chip">${esc(l.kind)} Lore: ${esc(l.name)}</span>`),
    ].filter(Boolean).join('');
    const regs = parsed.sections.map(s => `<div class="reg"><h3>${esc(s.title)}</h3><ul>` +
      s.units.map(u => {
        const isGen = u.bullets.some(b => /^general$/i.test(b));
        const enh = u.bullets.filter(b => !/^general$/i.test(b));
        return `<li>${isGen ? '<span class="genstar">★</span> ' : ''}${esc(u.name)} ${u.pts ? `<span class="upts">(${u.pts})</span>` : ''}</li>`
          + enh.map(b => `<li class="enh">${esc(b)}</li>`).join('');
      }).join('') + '</ul></div>').join('');
    html.push(cardShell({
      cls: 'overview',
      head: `<header class="card-head"><div class="title"><h2>${esc(parsed.faction || 'Legerlijst')}</h2>
        <div class="subtitle">${esc(parsed.formation || '')}</div></div>
        <div class="pts"><b>${listPts}</b><span>pts</span></div></header>`,
      body: `<div class="ov-meta">${meta}</div><div class="regiments">${regs}</div>`,
    }));
  }

  /* Battle traits + formation */
  if ($('#optTraits').checked && fid) {
    const traitSubs = D.fabSubtypes.filter(s => s.fid === fid && norm(typeNameOf(s)).includes('battle trait'));
    for (const s of traitSubs) {
      const fabs = fabsBySub.get(s.id) || [];
      if (fabs.length) html.push(fabGroupCard('Battle Traits', D.factions[fid], fabs));
    }
    if (parsed.formation) {
      const sub = findSubtype(parsed.formation, fid, s => norm(typeNameOf(s)).includes('battle formation'));
      if (sub) {
        if (norm(sub.name) !== norm(parsed.formation)) warn(`Formatie ‘${parsed.formation}’ gelezen als ‘${sub.name}’.`);
        html.push(fabGroupCard(sub.name, `Battle Formation — ${D.factions[sub.fid] || ''}`, fabsBySub.get(sub.id) || []));
      } else {
        warn(`Battle formation ‘${parsed.formation}’ niet gevonden — lege kaart toegevoegd.`);
        html.push(placeholderCard(parsed.formation, 'Battle Formation'));
      }
    }
  }

  /* Warscroll-kaarten */
  html.push(sectionBreak('Warscrolls'));
  const groups = new Map(); // dedupe op naam + bullets
  for (const s of parsed.sections) {
    for (const u of s.units) {
      const key = norm(u.name) + '||' + u.bullets.map(norm).sort().join(';');
      if (groups.has(key)) { groups.get(key).count++; continue; }
      groups.set(key, { ...u, count: 1, section: s.title });
    }
  }
  for (const u of groups.values()) {
    const general = u.bullets.some(b => /^general$/i.test(b));
    const reinforced = u.bullets.some(b => /^reinforced/i.test(b));
    const enhNames = u.bullets.filter(b => !/^general$/i.test(b) && !/^reinforced/i.test(b));
    const w = findWarscroll(u.name, fid);
    if (!w) {
      warn(`Warscroll ‘${u.name}’ niet gevonden — lege kaart toegevoegd.`);
      html.push(placeholderCard(u.name, 'Warscroll', { pts: u.pts, general, bullets: enhNames }));
      continue;
    }
    const enhancements = enhNames.map(name => {
      const fab = findEnhancement(name, fid);
      if (!fab) { warn(`Enhancement ‘${name}’ (${u.name}) niet gevonden — invulblok toegevoegd.`); return { name }; }
      if (norm(fab.name) !== norm(name)) warn(`‘${name}’ gelezen als ‘${fab.name}’.`);
      return { name, fab: { ...fab, typeName: fab.typeName || fab.subName } };
    });
    html.push(unitCard(w, { pts: u.pts, count: u.count, general, reinforced, enhancements, regiment: u.section }));
  }

  /* Lores & manifestaties */
  if ($('#optLores').checked && parsed.lores.length) {
    html.push(sectionBreak('Lores & Manifestaties'));
    for (const lore of parsed.lores) {
      const kind = lore.kind.toLowerCase();
      const typeMatch = s => norm(typeNameOf(s)).includes(kind === 'spell' ? 'spell lore' : kind === 'prayer' ? 'prayer lore' : 'manifestation lore');
      const sub = findSubtype(lore.name, fid, typeMatch);
      if (!sub) {
        warn(`${lore.kind} lore ‘${lore.name}’ niet gevonden — lege kaart toegevoegd.`);
        html.push(placeholderCard(lore.name, `${lore.kind} Lore`));
        continue;
      }
      if (norm(sub.name) !== norm(lore.name)) warn(`Lore ‘${lore.name}’ gelezen als ‘${sub.name}’.`);
      const fabs = fabsBySub.get(sub.id) || [];
      html.push(fabGroupCard(sub.name, `${lore.kind} Lore — ${D.factions[sub.fid] || 'Universeel'}`, fabs));
      if (kind === 'manifestation') {
        for (const f of fabs) {
          const mName = f.name.replace(/^summon\s+/i, '');
          const mw = findWarscroll(mName, fid);
          if (mw) html.push(unitCard(mw, { tag: 'Manifestatie', cls: 'unit manifestation' }));
          else { warn(`Manifestatie-warscroll ‘${mName}’ niet gevonden.`); html.push(placeholderCard(mName, 'Manifestatie')); }
        }
      }
    }
  }

  return html.join('');
}

/* ---------- extra kaart ---------- */
function addExtraCard(query) {
  const name = query.split(' — ')[0].trim();
  if (!name) return;
  const w = findWarscroll(name, null);
  if (!w) { setStatus(`<span class="warn">‘${esc(name)}’ niet gevonden.</span>`); return; }
  $('#cards').insertAdjacentHTML('beforeend', unitCard(w, { tag: 'Extra kaart' }));
  fitA6();
}

/* ---------- status ---------- */
function setStatus(html) { $('#status').innerHTML = html; }
function reportStatus(parsed, cardCount) {
  const bits = [];
  bits.push(`<span class="ok">✔ ${cardCount} kaarten aangemaakt${parsed.faction ? ' voor ' + esc(parsed.faction) : ''}.</span>`);
  if (warnings.length) bits.push(`<span class="warn">⚠ Aandachtspunten:</span><ul>` + warnings.map(w => `<li>${esc(w)}</li>`).join('') + '</ul>');
  setStatus(bits.join('<br>'));
}

/* ---------- voorbeeldlijst ---------- */
const SAMPLE = `Grand Alliance Chaos | Hedonites of Slaanesh | Lurid Dreamers
General's Handbook 2026-27
Drops: 4
Spell Lore - Lore of Extravagance
Manifestation Lore - Manifestations of Depravity
-----
General's Regiment
Sigvald, Prince of Slaanesh (240)
• General
Lord of Hysteria (120)
• Centre of Attention
---
Regiment 1
Shardspeaker of Slaanesh (140)
• Crown of the Ur-Slaanesh
Blissbarb Archers (140)
Lord of Hubris (110)
Myrmidesh Painbringers (120)
---
Regiment 2
Thricefold Discord (180)
Daemonettes (110)
Infernal Enrapturess, Herald of Slaanesh (100)
Slaangor Fiendbloods (140)
---
Regiment 3
Keeper of Secrets (420)
Slickblade Seekers (170)`;

/* ---------- UI ---------- */
function generate() {
  const text = $('#listInput').value;
  if (!text.trim()) { setStatus('<span class="warn">Plak eerst een legerlijst.</span>'); return; }
  const parsed = parseList(text);
  const html = buildCards(parsed);
  $('#cards').innerHTML = html;
  reportStatus(parsed, $('#cards').querySelectorAll('.card').length);
  localStorage.setItem('wsf.list', text);
  fitA6();
}

$('#btnGenerate').addEventListener('click', generate);
$('#btnSample').addEventListener('click', () => { $('#listInput').value = SAMPLE; generate(); });
$('#btnPrint').addEventListener('click', () => window.print());
$('#btnAdd').addEventListener('click', () => addExtraCard($('#addUnit').value));
$('#addUnit').addEventListener('keydown', e => { if (e.key === 'Enter') addExtraCard(e.target.value); });

const pageStyle = document.createElement('style');
document.head.appendChild(pageStyle);
const SIZE_BTN = { l: '#sizeL', s: '#sizeS', a6: '#sizeA6' };
$('#sizeL').addEventListener('click', () => setSize('l'));
$('#sizeS').addEventListener('click', () => setSize('s'));
$('#sizeA6').addEventListener('click', () => setSize('a6'));
function setSize(s) {
  if (!SIZE_BTN[s]) s = 'l';
  for (const [k, sel] of Object.entries(SIZE_BTN)) {
    $('#cards').classList.toggle('size-' + k, s === k);
    $(sel).classList.toggle('active', s === k);
  }
  $('#a6Hint').hidden = s !== 'a6';
  pageStyle.textContent = s === 'a6'
    ? '@page { size: 105mm 148mm; margin: 0; }'
    : '@page { size: A4 portrait; margin: 9mm; }';
  localStorage.setItem('wsf.size', s);
  fitA6();
}
setSize(localStorage.getItem('wsf.size') || 'l');
for (const id of ['optFlavour', 'optOverview', 'optTraits', 'optLores']) {
  $('#' + id).addEventListener('change', () => { localStorage.setItem('wsf.' + id, $('#' + id).checked ? '1' : '0'); if ($('#listInput').value.trim()) generate(); });
}

/* klik op kaartkop = overslaan bij afdrukken */
$('#cards').addEventListener('click', e => {
  const head = e.target.closest('.card-head');
  if (head) head.closest('.card').classList.toggle('excluded');
});

/* ---------- init ---------- */
$('#dataVersion').textContent = `Data: Wahapedia-export ${D.lastUpdate.split(' ')[0] || '?'} · ${D.warscrolls.length} warscrolls`;
const dl = $('#allUnits');
dl.innerHTML = D.warscrolls.filter(w => !w.virtual).map(w => `<option value="${esc(w.name)} — ${esc(D.factions[w.fid] || '')}">`).join('');

const savedList = localStorage.getItem('wsf.list');
if (savedList) $('#listInput').value = savedList;
for (const id of ['optFlavour', 'optOverview', 'optTraits', 'optLores']) {
  const v = localStorage.getItem('wsf.' + id);
  if (v !== null) $('#' + id).checked = v === '1';
}
if (savedList) generate();
})();
