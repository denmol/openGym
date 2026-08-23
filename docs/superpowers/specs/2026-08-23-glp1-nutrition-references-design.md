# Källmärkta näringsreferenser för vuxna och GLP-1

Status: godkänd av användaren 2026-08-23. Ingen implementation ingår i specifikationen.

## Mål

Dagsnav ska automatiskt visa vetenskapligt källmärkta näringsreferenser för vuxna. För personer som använder GLP-1-receptoragonist eller kombinerad GIP/GLP-1-behandling för viktbehandling ska appen dessutom kunna visa ett separat GLP-1-lager med relevanta intervall och riskgränser efter en uttrycklig säkerhetskontroll. Incretinbehandling för diabetes ska fortfarande aktivera läkemedlets säkerhetsfrågor, men inte automatiskt viktbehandlingsreferenserna.

Referenser är inte samma sak som personliga behandlingsmål. Appen ska därför:

- visa intervall, miniminivåer, maximinivåer och riskgränser med rätt semantik;
- aldrig välja en godtycklig mittpunkt och kalla den ett mål;
- aldrig skriva över ett manuellt mål;
- visa källa, årtal, målgrupp och viktiga begränsningar vid varje värde;
- låta användaren öppna befintligt manuellt målfält med ett tryck;
- behålla medicinsk information i användarens befintliga Dagsnav-data på den egna servern och utanför AI-modellen;
- behålla den medicinska gränsen: ingen insulinberäkning, kolhydratkvot, korrektionsfaktor, insulin-on-board eller råd vid lågt glukos.

## Avgränsning

Första versionen omfattar de åtta näringsvärden som redan kan loggas: energi, kolhydrater, sockerarter, protein, fett, mättat fett, fiber och salt. Vätska visas som en GLP-1-referens men loggas inte ännu.

Följande ingår inte:

- ett automatiskt dagligt kalorimål från BMR;
- ett fast energiunderskott eller energiöverskott;
- sjukdoms- eller läkemedelsdosering;
- automatiska vitamin-, mineral- eller kosttillskottsdoser;
- AI-genererade näringsvärden;
- nya livsmedelsfält för mikronäringsämnen;
- vätskeloggning;
- omräkning av E%-intervall till gram;
- en dold formel för idealvikt eller justerad kroppsvikt.

Ett dagligt energibehov kräver aktivitetsdata eller uppmätt förbrukning. BMR är bara vilometabolism och får inte återanvändas som dagsmål. Det arbetet hör till den planerade fasen för uppmätt förbrukning från vikt över tid och loggat intag.

## Referenskatalog

Referenserna ska ligga i ren, deterministisk frontendkod. Ingen nätanslutning eller AI behövs för att räkna fram eller visa dem. Varje post innehåller minst `kind` (`range`, `min`, `max`, `example` eller `warning`), värde, enhet, källa, årtal, målgrupp och förklarande begränsning.

### Vuxna som inte är gravida eller ammar, NNR 2023

| Område | Referens | Typ |
| --- | ---: | --- |
| Kolhydrater | 45–60 E% | intervall |
| Protein | 10–20 E% | intervall |
| Fett | 25–40 E% | intervall |
| Mättat fett | <10 E% | maximum |
| Fiber | minst 25 g/dag för kvinnor, 35 g/dag för män | minimum |
| Salt | högst 5,75 g/dag, motsvarande 2,3 g natrium | maximum |

NNR:s gräns <10 E% gäller tillsatt och fritt socker. Dagsnavs fält `sugar` är totalsocker från EU-näringsdeklarationer. Dessa storheter får inte jämföras och appen ska därför inte skapa ett automatiskt mål för det loggade sockerfältet. Referensen får visas som förklaring med texten att den inte kan mätas mot totalsocker.

Fiberreferensen väljs uttryckligen i näringsinställningarna. Utan ett val visas populationsintervallet 25–35 g/dag. Appens eventuella standardvärde för kroppstyp eller könsidentitet får inte användas som dold reserv.

Graviditet, planerad graviditet eller amning har andra referensbehov. Den frågan måste därför vara uttryckligen besvarad med **Nej/inte relevant** innan de allmänna vuxenreferenserna visas. Ett obesvarat eller positivt svar visar i stället en kort förklaring och hänvisar till professionell anpassning.

E%-intervall visas endast som E% i första versionen. Appen räknar inte om dem till gram, även om användaren har ett manuellt energimål.

### GLP-1 och kombinerad GIP/GLP-1 vid viktbehandling

GLP-1-lagret läggs ovanpå vuxenreferenserna och ersätter inte dem. Numeriska GLP-1-referenser kan visas när behandlingsanvändningen är `weight` eller `both` och alla säkerhetsfrågor är besvarade. Därefter döljer spärrmatrisen hela lagret eller berörda delar. Obesvarade säkerhetsfrågor ger en uppmaning att slutföra kontrollen, inte antagandet att risk saknas.

| Område | Referens | Hur Dagsnav använder den |
| --- | ---: | --- |
| Protein | 80–120 g/dag | praktiskt referensintervall endast när användaren bekräftat aktiv viktnedgång, inte GLP-1-specifik RDA eller individuell ordination; källan anger att det motsvarar 16–24 E% vid 2 000 kcal men appen skalar inte intervallet från energiintag |
| Protein, europeisk konsensus | 1,0–1,5 g/kg justerad vikt/dag, minst 60 g/dag | visas som källinformation men räknas inte om utan en uttryckligen kliniskt angiven referensvikt |
| Fiber | minst 25 g/dag | minimum; ökning ska ske gradvis och tillsammans med tillräcklig vätska |
| Vätska | 2,0–2,5 liter/dag | referens, inte loggat mål; får inte visas som ordination vid hjärt-/njurrelaterad begränsning |
| Energi under 1 500 kcal/dag | hög risk för otillräckliga mikronäringsämnen | informationsgräns, aldrig mål |
| Energi under 1 200 kcal/dag | klinisk bedömning av näringskvalitet och eventuella tillskott | informationsgräns, appen rekommenderar inget tillskott |
| Energi under 800 kcal/dag eller oförmåga att täcka behov | kräver klinisk behandlingsöversyn | fast vårdhänvisning, ingen läkemedels- eller dosrekommendation |

Dagsnav ska inte automatiskt utlösa energivarningarna från en enskild matlogg. En ofullständig logg är inte samma sak som verkligt intag. Gränserna visas i referenskortet och jämförs bara med ett uttryckligt manuellt energimål.

Det nordamerikanska rådet anger att faktisk kroppsvikt kan överskatta proteinbehovet vid obesitas och att konsensus saknas om faktisk, ideal, justerad eller fettfri vikt. Därför får Dagsnav inte tyst multiplicera aktuell vikt med ett proteinintervall. Intervallet 80–120 g/dag visas endast som ett praktiskt källexempel efter säkerhetskontrollen och blir aldrig automatiskt användarens mål.

## Profil och lagring

`nutritionGoals` utökas minimalt med:

- `incretinUse: null | 'none' | 'weight' | 'diabetes' | 'both' | 'other'` — skiljer användning från behandlingsindikation utan att lagra preparat eller dos;
- `weightPhase: null | 'active_loss' | 'maintenance'` — avgör om källexemplet 80–120 g protein alls är tillämpligt;
- `fiberReference: 'range' | 'female' | 'male'` — ett uttryckligt val av vilken NNR-fiberreferens som ska visas; det är inte ett härlett könsfält;
- `safety.kidneyOrProteinRestriction: true | false | null` — njursjukdom, dialys, transplantation eller ordinerad proteinbegränsning;
- `safety.fluidOrSodiumRestriction: true | false | null` — hjärtsvikt eller ordinerad vätske-/natriumbegränsning;
- `safety.pregnancyOrBreastfeeding: true | false | null` — graviditet, planerad graviditet eller amning;
- `safety.eatingDisorder: true | false | null` — aktiv, misstänkt eller tidigare ätstörning, självframkallade kräkningar eller uttalad restriktion;
- `safety.severeGI: true | false | null` — svåra eller ihållande gastrointestinala symtom, uttorkning eller oförmåga att täcka behov;
- `safety.malnutritionRisk: true | false | null` — skörhet, sarkopeni, undernäring eller snabb/oavsiktlig viktnedgång;
- `safety.otherClinicalNutrition: true | false | null` — leversjukdom, tidigare obesitaskirurgi eller annan ordinerad klinisk näringsplan;
- `safety.hypoglycemiaRiskMedication: true | false | null` — insulin, sulfonylurea, meglitinid, annan insulinsekretagog eller annat läkemedel som behandlande kliniker bedömt kan ge hypoglykemi;
- `safetyReviewedAt: null | ISO-datum` — när svaren senast bekräftades;
- `targetReviewRequired: boolean` — ligger kvar som `true` efter en ny riskmarkering tills användaren uttryckligen granskat sina manuella mål.

Aktiv substans, dos, laboratorievärden och diagnosnamn lagras inte eftersom de inte behövs för referenskatalogen. Den befintliga generella markeringen för sjukdom eller annan medicinering bevaras och fortsätter kräva vårdgranskning.

Härledda referenser sparas inte. De räknas fram vid visning från källkatalogen och profilens explicita uppgifter. Befintliga profiler migreras genom normalisering: saknad/ogiltig `incretinUse` och `weightPhase` blir `null`, saknad/ogiltig `fiberReference` blir `'range'`, saknade säkerhetssvar och `safetyReviewedAt` blir `null`, och saknad `targetReviewRequired` blir `false`. Gamla manuella mål lämnas exakt som de är. `null` betyder obesvarat och ska aldrig konverteras med `Number` eller behandlas som ett nekande svar.

Säkerhetssvaren måste bekräftas på nytt när incretinanvändning eller behandlingsfas ändras, när användaren ändrar markeringen för sjukdom/medicinering eller en säkerhetsmarkering, samt senast 90 dagar efter föregående bekräftelse. Nittio dagar är Dagsnavs försiktiga produktregel, inte ett medicinskt riktvärde. Klient och server använder samma UTC-kalenderdag för denna regel så att AI-vägen aldrig öppnas av två olika datumtolkningar. Saknade, ogiltiga eller utgångna svar behandlas fail-closed och blockerar numeriska GLP-1-referenser.

När en riskmarkering blir `true` sätts `targetReviewRequired` till `true`. Att risken senare ändras till `false` återaktiverar inte måljämförelser automatiskt. Användaren måste först öppna de bevarade målen och bekräfta **Jag har granskat mina egna mål**.

Eftersom `targetReviewRequired` är en enda boolesk flagga pausas alla måljämförelser medan den är `true`. Efter användarens uttryckliga målgranskning fortsätter spärrmatrisen att pausa de enskilda mål som fortfarande berörs av en aktiv risk.

## Säkerhetsregler

Populationens referensvärden får visas för alla bekräftat vuxna, men Dagsnav ska tydligt markera att de inte är personliga behandlingsmål. Ålder måste vara ett heltal mellan 18 och 100, samma intervall som den befintliga profilnormaliseringen. Om ålder saknas eller ligger utanför intervallet visas i stället en uppmaning att ange ålder; inga vuxenreferenser väljs.

En riskmarkering döljer berörda referenser och pausar jämförelse mot berörda manuella mål enligt denna matris. Det manuella värdet ligger kvar i lagringen men visas som **Pausat – behöver granskas** utan måluppfyllelse eller färgkodning.

| Markering | Referenser som döljs | Manuella mål som pausas |
| --- | --- | --- |
| Njur-/proteinbegränsning | protein, salt och GLP-1-vätska | protein och salt |
| Vätske-/natriumbegränsning | salt och GLP-1-vätska | salt |
| Graviditet, planering eller amning | alla automatiska referenser | alla näringsmål |
| Aktiv/tidigare ätstörning eller uttalad restriktion | alla automatiska referenser | alla näringsmål |
| Svåra eller ihållande GI-symtom | GLP-1-protein, fiber, vätska och energigränser | energi, protein och fiber |
| Skörhet, sarkopeni, undernäring eller snabb/oavsiktlig viktnedgång | alla automatiska referenser | alla näringsmål |
| Annan klinisk näringsplan | hela GLP-1-lagret | alla näringsmål |
| Läkemedel med hypoglykemirisk | kolhydratreferens och GLP-1-energigränser | energi och kolhydrater |

När `severeGI` är `true` visar appen dessutom en fast vårdhänvisning för svår buksmärta, ihållande kräkningar, tecken på uttorkning eller svår förstoppning tillsammans med buksmärta, uppblåsthet eller kräkning. När `hypoglycemiaRiskMedication` är `true` skiljer den fasta texten mellan akut allvarlig hypoglykemi, som kräver användarens ordinerade akutplan och akut hjälp, och upprepade episoder, som kräver kontakt med diabetesvården. Hänvisningarna är lokal fast text och innehåller ingen läkemedels-, dos- eller kolhydratrekommendation.

När ett manuellt energimål är aktivt används själva målvärdet, aldrig en ofullständig matlogg, för GLP-1-lagrets energisignaler. Endast den mest allvarliga tillämpliga signalen visas:

- under 1 500 kcal/dag: granskningsvarning;
- under 1 200 kcal/dag: klinisk näringsgranskning;
- under 800 kcal/dag: målet pausas och en fast klinisk hänvisning visas.

I spärrade lägen visas en fast, kort text om vilken del som behöver professionell anpassning. Dagsnav bedömer inte läkemedlets lämplighet och får inte föreslå ändring eller utsättning av läkemedel.

En generell friskrivning om eget ansvar kan finnas, men ersätter inte dessa specifika stoppregler.

## Användargränssnitt

I arket **Näringsmål** läggs följande till:

1. Ett explicit val för incretinbehandling: ingen, viktbehandling, diabetes, båda eller annan/oklar.
2. Vid viktbehandling: ett explicit val mellan **Aktiv viktnedgång** och **Viktstabil fas**.
3. Ett kompakt säkerhetsavsnitt där varje fråga måste besvaras **Ja** eller **Nej/inte relevant** innan numeriska GLP-1-referenser kan visas.
4. Frågan om undernäringsrisk använder begripliga tecken i stället för diagnosord: oavsiktlig snabb viktnedgång, tydligt minskat matintag eller oförmåga att äta, ny uttalad svaghet/funktionsförlust eller tidigare klinisk bedömning av undernäring/muskelförlust.
5. Ett avsnitt **Vetenskapliga referenser** med kort per näringsområde. Kortet visar värde, om det är min/max/intervall/källexempel, källa och en kort begränsning.
6. En knapp **Ange eget mål** på relevanta, ospärrade kort flyttar fokus till motsvarande befintliga manuella fält i samma ark. Referensen kopieras inte automatiskt och manuella mål skrivs aldrig över.
7. Fiberkortet erbjuder ett uttryckligt NNR-val: kvinnors referens, mäns referens eller populationsintervallet. Det använder inte kroppstyp eller könsidentitet som dold reserv.

På kostsidan visas manuellt mål och automatisk referens som två olika rader. Ordvalen ska vara **Eget mål** respektive **Referens**, inte två varianter av ordet mål.

Källornas precision ska bevaras i visningen: salt visas som exakt 5,75 g i svensk miljö och vätskeintervallet som 2,0–2,5 liter. Den befintliga en-decimalsformatteraren får inte avrunda bort dessa skillnader.

Källänkar öppnas i ny flik med `rel="noopener"`. Min/max/intervall får inte kommuniceras enbart med färg, och säkerhetsmeddelanden använder `role="note"` eller `role="alert"` efter allvarlighetsgrad.

## AI och integritet

Referensmotorn använder inte AI. Klienten normaliserar och tillämpar fail-closed-reglerna innan referenser visas. Den sparade användarstaten på Dagsnav-servern är separat auktoritet för API-anrop: servern normaliserar samma fält på nytt och litar aldrig på klientens påstående om att medicinska markeringar saknas.

Incretinanvändning och säkerhetskategorierna ska behandlas som medicinska markeringar i det befintliga AI-flödet. Modellen får fortfarande bara befintliga, icke-medicinska och tillåtna faktakoder. Alla vårdanteckningar som följer av en medicinsk markering skapas som fast text på servern. Ingen läkemedelsklass, behandlingsindikation, riskkategori, diagnos, vikt eller siffra skickas till modellen. Saknat, okänt, ogiltigt eller utgånget säkerhetstillstånd får inte tolkas som riskfritt av vare sig klient eller server.

AI får därför bara anropas när den sparade serverstaten visar en bekräftat vuxen användare, `incretinUse: 'none'`, samtliga säkerhetsfält exakt `false`, ett giltigt granskningsdatum som är högst 90 dagar gammalt, `targetReviewRequired: false` och inga befintliga diabetes-, sjukdoms- eller medicineringsspärrar. Saknad serverstat eller ett äldre/ogiltigt fält ger ett lokalt `clinician_review`-svar innan AI-kvot reserveras. Klientens motsvarande generella spärr får endast göra beslutet striktare, aldrig öppna AI-vägen.

## Testkrav

Tester ska verifiera värden och semantik, inte bara att funktionerna körs:

- 17 och 101 år ger inga vuxenreferenser; 18 och 100 år med `pregnancyOrBreastfeeding: false` gör det; `null` eller `true` ger inga allmänna vuxenreferenser;
- fiberreferens `female` ger minst 25 g, `male` minst 35 g och `range` ger intervallet 25–35 g; kroppstyp påverkar inte valet;
- salt är exakt 5,75 g och får aldrig behandlas som 2,3 g salt;
- totalsocker får inget automatiskt mål från gränsen för tillsatt/fritt socker;
- obesvarade säkerhetsfrågor förblir `null` och ger inga numeriska GLP-1-referenser;
- `incretinUse: 'weight'` eller `'both'`, `weightPhase: 'active_loss'`, aktuellt `safetyReviewedAt` och alla säkerhetssvar `false` visar källexemplet protein 80–120 g, fiber minst 25 g och vätska 2,0–2,5 liter;
- `incretinUse: 'diabetes'`, `'other'` eller `null` visar inte viktbehandlingsreferenserna;
- 80–120 g visas endast vid `weightPhase: 'active_loss'`, är märkt som referens/källexempel, aldrig automatiskt mål, och skalas inte från 2 000 kcal;
- säkerhetssvar är giltiga till och med dag 90 och blockerar GLP-1-referenser från dag 91; ändrad användning, fas, sjukdom eller medicinering kräver ny bekräftelse;
- BMR skapar aldrig ett kalorimål;
- faktisk vikt används aldrig tyst som justerad vikt;
- `null`, tom sträng, boolean och noll får inte bli ett rimligt men felaktigt näringsvärde;
- manuella mål överlever profilnormalisering och skrivs aldrig över av referenser;
- en borttagen risk återaktiverar inte måljämförelser förrän användaren bekräftat sin målgranskning;
- varje säkerhetsmarkering döljer och pausar exakt de områden som anges i spärrmatrisen;
- energimål på 1 500, 1 200 och 800 kcal ligger utanför respektive strikt **under**-gräns, medan värden precis under ger rätt varning; matloggen utlöser aldrig dessa signaler;
- incretinanvändning och övriga medicinska markeringar lämnar aldrig servern i AI-underlaget;
- frontendtester, API-tester, produktionsbygge och `git diff --check` ska vara gröna.

## Källor

- Nordic Nutrition Recommendations 2023: https://pub.norden.org/nord2023-003/recommendations.html
- EASO, EFAD och ECPO, klinisk infografik 2026: https://easo.org/wp-content/uploads/2026/07/obesity-incretin-based-therapy_v6.pdf
- EASO/EFAD/ECPO-konsensus, *The Lancet Diabetes & Endocrinology* 2026: https://doi.org/10.1016/S2213-8587(26)00122-1
- ACLM/ASN/OMA/TOS, gemensam GLP-1-rådgivning 2025: https://doi.org/10.1016/j.obpill.2025.100181 (fulltext: https://pmc.ncbi.nlm.nih.gov/articles/PMC12264624/)
- EMA, Wegovy produktinformation: https://www.ema.europa.eu/en/documents/product-information/wegovy-epar-product-information_en.pdf
- EMA, Mounjaro produktinformation: https://www.ema.europa.eu/en/documents/product-information/mounjaro-epar-product-information_en.pdf
- KDIGO 2024 CKD Guideline: https://kdigo.org/wp-content/uploads/2024/03/KDIGO-2024-CKD-Guideline.pdf
- ESC Heart Failure Association 2024, natrium och vätska: https://academic.oup.com/eurjhf/article/26/4/730/8328801
