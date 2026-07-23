# Warscroll Forge

Zet een geëxporteerde legerlijst uit de officiële **Warhammer Age of Sigmar-app** om naar
printbare referentiekaarten in AoS-stijl. Alles draait **volledig lokaal** — geen server,
geen internetverbinding nodig tijdens gebruik.

**Live versie:** https://thenoxius.github.io/warscroll-forge/
(elke push naar `main` haalt automatisch de nieuwste Wahapedia-data op en deployt via
[GitHub Actions](https://github.com/Thenoxius/warscroll-forge/actions))

## Gebruik

1. Dubbelklik op `index.html` (werkt direct in elke browser, ook offline).
2. Exporteer je lijst in de AoS-app (deel → kopieer als tekst) en plak hem in het linkerpaneel.
3. Klik **Maak kaarten**.
4. Klik **Afdrukken** (of Ctrl+P) voor een printbare A4-versie.

### Wat je krijgt

- **Leger-overzichtskaart** — regimenten, enhancements, drops, punten, lores.
- **Battle traits & battle formation** — de factieregels als eigen kaarten.
- **Warscroll-kaarten** — statdiamant (Move/Save/Control/Health/Ward), wapentabellen,
  abilities met fase-kleurcodering zoals op officiële 4e-warscrolls, keywords en base size.
  Artefacts en heroic traits uit je lijst worden als extra blok op de kaart van de drager gezet.
- **Spell lore / manifestation lore-kaarten** — inclusief de warscrolls van de manifestaties zelf.

### Opties

- **Groot** (1 kaart per kolom), **Compact** (2 kolommen per A4) of **A6-kaarten**:
  elke kaart is dan exact 105 × 148 mm en de inhoud schaalt automatisch passend
  (lange warscrolls gaan eerst naar twee kolommen zodat de tekst leesbaar blijft).
  Bij afdrukken komen er automatisch **4 kaarten op één A4-vel** (2×2-snijvel; een kwart
  A4 is exact A6). Printvenster: papier A4, schaal 100%, marges "Geen", en zet
  **kop- en voetteksten uit** (anders drukt de browser datum/URL op het vel).
- **Taal**: NL/EN-schakelaar rechtsboven. Standaard volgt de app de taal van je browser
  (`navigator.language`); je keuze wordt onthouden. Ook via URL: `?lang=en`.
- **Faction pack**: kies een factie en genereer in één klik alle warscrolls van die factie
  (plus battle traits, formations en lores als die opties aanstaan) — handig om een complete
  referentieset te printen los van een specifieke lijst.
- **Kaart-achterkanten**: voor dubbelzijdig printen (alleen in A6-modus). De app zet automatisch
  een gespiegeld vel achterkanten achter elk vel voorkanten, zodat je op de **lange zijde** kunt
  omslaan. Je stelt de achterkant zelf samen:
  - **Twee kleuren + motief**: kies een basiskleur en een accentkleur, en een van de acht motieven
    (effen, diagonale strepen, stippen, rooster, arcering, chevron, schubben, ruiten). De motieven
    zijn vector-CSS, dus ze printen scherp op elk formaat.
  - **Eigen afbeelding, schaalbaar**: upload een logo of illustratie en schaal die met de
    schuifregelaar (10–250%). Op 100% zonder tegelen vult de afbeelding de kaart (cover); met
    **tegelen** wordt het een herhalend patroon — handig voor kleine logo's of motieven.
    De afbeelding ligt over het gekozen motief heen, dus je kunt beide combineren.
    Ze wordt niet geüpload of opgeslagen (alleen deze sessie, blijft lokaal in de browser).
- URL-parameters voor de live versie: `?demo=1` laadt de voorbeeldlijst, `?size=a6|s|l` kiest het
  formaat, `?lang=nl|en` kiest de taal, `?backs=1` zet achterkanten aan en `?pattern=…` kiest het motief.
- Flavourtekst aan/uit.
- Klik op een kaartkop om die kaart bij het afdrukken over te slaan.
- Voeg via *Extra kaart* elke willekeurige warscroll toe (handig voor Spearhead of proxies).

## Regeldata bijwerken

De regeldata komt uit de officiële CSV-data-export van
[Wahapedia](https://wahapedia.ru/aos4/the-rules/data-export/) (*powered by Wahapedia*) en staat
lokaal opgeslagen in `data/`. Staat er iets niet in (bv. een gloednieuwe unit), dan krijg je een
nette invulkaart. Bijwerken:

```
npm run update-data
```

(of `node scripts/update-data.mjs`; met `--offline` compileert hij alleen de al gedownloade CSV's opnieuw).

## Structuur

```
index.html            de app (dubbelklik en klaar)
css/styles.css        AoS-styling + print-CSS (A4)
js/app.js             lijst-parser, matching, kaart-rendering
data/data.js          gecompileerde regeldata (gegenereerd)
data/csv/             ruwe Wahapedia CSV-export
scripts/update-data.mjs   downloadt en compileert de data
```

Punten op de kaarten komen uit je geplakte lijst (die is leidend voor jouw battlepack);
staat een unit niet in de lijst, dan geldt de puntenwaarde uit de data.
