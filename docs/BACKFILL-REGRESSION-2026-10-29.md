# Pass: granskning av efterregistrering

Granskad bas: `c8dde79b2617bbba9d681a356b5c684947bd37e7`, PR #37.
Branch: `fix/backdated-history-regressions`.
Datum: 29 oktober 2026. Inga verkliga användardata eller produktions-API:er har använts.

## Reproducerade problem och rättningar

| Problem | Exempel före rättning | Nytt beteende |
| --- | --- | --- |
| Framtida träningsresultat användes vid efterregistrering | Ett pass den 20 oktober föreslog 102,5 kg från den 28 oktober, trots 40 kg den 19 oktober | Förslag och ”senast” använder historiken före den valda starttiden; exemplet ger 42,5 kg |
| Viktbekräftelse skrev till aktuella standardvikter innan passet sparats | Bekräfta vikten, kasta passet: standardvikten och dess datum hade ändå ändrats | Efterregistreringens bekräftelse stannar i det pågående utkastet; sparande skyddar senare standardvikter |
| Tyst ändring av passlängd | 1 minut blev 5; 360 minuter blev 300 | Positiv, ändlig längd bevaras; sluttid är starttid plus angiven faktisk varaktighet |
| Datumkontroll saknades i startåtgärden; alla pass fick start klockan 12 | Ogiltigt datum kunde normaliseras av JavaScript; två pass samma dag fick osäker ordning | Valbar starttid, kontroll av datum/tid/längd/sluttid och ny kontroll av redan pågående pass |
| Sommartidsgränser saknade uttrycklig hantering | Klockslag som inte finns normaliseras; dubbla hösttimmar är tvetydiga | Obefintlig vårtimme avvisas. Vid dubbel hösttimme krävs val av UTC-offset. Varaktighet räknas som förfluten tid |
| Insättning förutsatte redan sorterad historik | En tidigare aktivitet som lagts sist kunde fortsätta göra ett äldre pass till ”senaste” | Insättning sorterar på sparat datum och starttid; befintliga passinnehåll ändras inte |
| Historiska aktivitetskalorier använde senaste kroppsvikten | Senare vägning påverkade äldre dagars uppskattningar | Passets dokumenterade vikt prioriteras, annars senaste giltiga vägning senast den dagen. Saknad historisk vikt ger okänd kcal |
| Energiberäkningens tak ändrade visad passlängd i matdagboken | Ett sparat 360-minuterspass visades som 180 minuter | Hela längden visas. Det befintliga taket på 180 minuter styrkearbete i energiuppskattningen förklaras separat |
| Timade övningar kunde fortfarande starta en arbetstimer | ”Start set” fanns även vid efterregistrering | Den knappen och dess startåtgärd är avstängda för efterregistrering |

## Automatiskt verifierat lokalt

- Ursprunglig frontend: **921 godkända tester** före ändringarna.
- Utökad frontend: **969 godkända tester**, 57 testfiler; 48 nya regressionstester.
- Tidszonsmatris: UTC, Europe/Stockholm, America/Los_Angeles, Asia/Kolkata och Pacific/Kiritimati. 48 tester i Stockholm och 44 i varje övrig zon; fyra uttryckligen svenska DST-fall hoppas över utanför Stockholm.
- Backend: **126 godkända tester**, ingen ändrad backendkod.
- Produktionsbygge lyckas. Byggverktyget rapporterar fortsatt varning om stora språkpaket.
- **25 praktiska webbläsarfall** med Chromium i mobilstorlek, över Stockholm, Los Angeles och Kiritimati.

Regressionerna omfattar årsskifte och ISO-veckor, söndag/måndag, lokal midnatt,
skottår, båda svenska sommartidsbytena, val av dubbel hösttimme, två pass samma dag,
1/90/360 minuters varaktighet, återupptagning, dubbel avslutning, säkerhetskopians
roundtrip, osorterad äldre historik, veckomål, veckosvit, rutinrotation och progression.
En korrekt insatt tidigare framgång kan ändra beräknad följd av misslyckanden och därmed
nästa träningsförslag; det är en avsedd omberäkning, inte en ändring av senare sparade set.

Matfallen kontrollerar flytt mellan dagar utan dubbletter, bevarade gram och kalorier,
historisk kroppsvikt inklusive pounds, okänd vikt, blandad konditions-/styrketräning,
ofullständiga set och att en ofullständig energisumma inte visas som fullständig.

Webbläsartesterna klickar genom formulär, setbekräftelse, kasta/spara och måltidsflytt.
De kontrollerar lokal lagring efter omladdning, frånvaro av närvarosignaler/vilotimer
och arbetstimer vid efterregistrering. En syntetisk inloggad profil används bara i
lokal minnesstate: alla API-anrop fångas och besvaras av testet. Kontrollfall visar
att vanliga livepass fortfarande skickar närvaro och startar vila. Externa nätanrop
blockeras. Testservern binds endast till loopback och stängs efter körningen.

Nya tester kördes också mot en separat kopia av PR #37. De reproducerade bland annat
framtida viktförslag, ändrad standardvikt efter kastat pass, längdklampning och
arbetstimerknappar. De nya DST-kontrollerna saknas i originalets gränssnitt; det
fallet kan därför inte köras hela vägen där. Separata logiktester reproducerade
fel i historikordning, historisk kaloriberäkning och visad längd före rättning.

## Köra om

Från `frontend/`:

```sh
npm ci
npm test
npm run test:backfill:timezones
npx playwright install chromium
npm run test:backfill:browser
npm run build
```

Från `api/`: `npm ci && npm test`.
GitHub CI kör även tidszonsmatrisen och det syntetiska webbläsarflödet.
Playwright är en utvecklingsberoende för tester, inte en del av appens körkod.
Lokalt användes Node 24.22.1 och Chromium 141; CI är konfigurerad för Node 22.

## Kvar för kontroll i driftsatt app

1. Använd ett separat testkonto med syntetiska data i en isolerad testmiljö. Kontrollera inloggad sparning, omladdning och synk till en andra enhet. Lokal API-mock verifierar inte verklig serversynk eller konflikter mellan enheter.
2. Kontrollera samma flöde i Safari på iPhone och eventuell installerad PWA/Capacitor-app, särskilt datumfält, UTC-val och återkomst från bakgrunden. Chromium i mobilstorlek är inte Safari eller iOS.
3. Säkerställ att aktuell klientversion faktiskt laddas efter driftsättning och gör ett kort omtest av veckomål, historik och matdagbok på testkontot.

Ingen produktionsdriftsättning eller sammanslagning ingår i denna ändring.

## Avgränsningar som kvarstår

- Datumen är lokala kalenderdagar. Starttid tolkas i den tidszon som formuläret visar. Det finns ingen väljare för en annan resas tidszon; ange motsvarande tid i visad zon.
- Den aktuella rutinen är fortfarande mall. Appen arkiverar inte äldre versioner av träningsprogrammet; användaren behöver kontrollera antal set, repetitioner och mål för det verkliga passet.
- Saknad starttid i importerad äldre historik kan inte återskapas. Sparat datum är primär sorteringsnyckel; samma dag sorteras efter känd starttid.
- Aktivitetsenergi är en uppskattning enligt appens befintliga modell, inte uppmätt energiförbrukning. Taket för styrkearbete bevaras och visas nu tydligt. Kostmålen ändras inte av efterregistreringen.
- Veckomål räknar fortsatt sparade pass, även två pass samma dag. Befintlig möjlighet att avsluta ett tomt pass med särskild bekräftelse är oförändrad.
- Befintliga historiska PR-markeringar är sparade ögonblicksbilder och räknas inte om retroaktivt. Uppgifterna i redan sparade set skrivs inte om.
- Ingen automatisk datamigrering eller ”reparation” av verkliga användares poster har körts.
