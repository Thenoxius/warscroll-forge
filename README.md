# Warscroll Forge

Zet een geëxporteerde legerlijst uit de officiële **Warhammer Age of Sigmar-app** om naar
printbare referentiekaarten in AoS-stijl. Alles draait **volledig lokaal** — geen server,
geen internetverbinding nodig tijdens gebruik.

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
  Bij afdrukken wordt elke A6-kaart een eigen pagina: print direct op A6-(kaart)papier,
  of kies in het printvenster A4 met **4 pagina's per vel** voor een 2×2-snijvel.
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
