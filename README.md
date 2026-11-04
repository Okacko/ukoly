# Úkoly – prototyp

Minimalistická TODO aplikace (PWA): projekty → JIRA tasky → úkoly → checklist, volitelný termín a upozornění.

## Spuštění

```bash
node serve.js
```

Pak otevřít http://localhost:5173. V Edge/Chrome jde aplikace nainstalovat jako samostatné okno (ikona „Nainstalovat“ v adresním řádku).

## Nezařazené (rychlá schránka)

Úplně nahoře v levém menu je **Nezařazené** – sem si můžeš bez zdržování hodit úkol (projekt ani JIRA task neřeš). Projekt a JIRA task mu přiřadíš kdykoli později v detailu úkolu; jakmile projekt vybereš, ze schránky zmizí.

## Rychlé zadání úkolu

`Název úkolu !pá 14:00` – termín se rozpozná z konce textu, za znakem `!`:

- `!dnes`, `!zítra`, `!pozítří`
- den v týdnu (nejbližší příští): zkratka `!po` … `!ne`, nebo celé jméno `!pondělí` … `!neděle` (funguje i bez diakritiky, `!pondeli`)
- konkrétní datum `!12.11.` (letos / příští výskyt) nebo `!12.11.2027`
- volitelně čas na konci: `… HH:MM` (např. `!pondělí 9:00`)

Termín jde změnit i dodatečně – stačí v detailu do názvu dopsat nový `!token` (třeba `!pozítří`) a po opuštění pole se datum přepíše. Datum v detailu se zadává/zobrazuje jako **DD/MM/RRRR**, vedle je tlačítko s vlastním **českým kalendářem** (týden od pondělí).

JIRA task je volný text (např. `UL72 SMPOESB-123 Rozhraní ESB`). Po zadání adresy JIRA v Nastavení jsou JIRA klíče v textu odkazem do JIRA; odkaz do Confluence jde přidat přes `…` u JIRA tasku. Aplikace do JIRA/Confluence nic nezapisuje.

## Pořadí (drag & drop)

Projekty v levém menu, JIRA tasky i úkoly jde přetažením přeuspořádat. Úkoly v projektu a ve schránce „Nezařazené" tak drží ruční pořadí (ne řazení podle termínu; hotové zůstávají dole). Přetažením úkolu na úkol pod jiným JIRA taskem se úkol zároveň přeřadí do té skupiny.

Na počítači se taká myší rovnou. Na dotykovém displeji (telefon/tablet) se položka **podrží prstem** (~0,3 s, krátce zavibruje) a pak se tažením přesune; krátký pohyb bez podržení normálně scrolluje a ťuknutí otevře detail.

## Synchronizace (Supabase, E2E šifrovaně)

V Nastavení je sekce **Synchronizace**. Přihlášení je přes **odkaz v e-mailu** (magic link) – heslo nikam nezadáváš, session drží knihovna `supabase-js` v prohlížeči. Data se **před odesláním zašifrují přímo v prohlížeči** (AES-GCM, klíč odvozený z tvojí **passfráze** přes PBKDF2), takže Supabase ukládá jen šifrovaný balík – obsah úkolů nevidí. Passfráze se nikam neposílá, zůstává jen na zařízení (poslední zápis vyhrává podle času `updatedAt`; stav se stahuje při otevření/návratu a po úpravě se nahrává, plus živá aktualizace přes realtime).

Konfigurace je v [sync.js](sync.js) → `SYNC_CONFIG` (`url`, `key`). `key` je **publishable (anon) klíč** – je ze své podstaty veřejný a patří do klientského kódu; řádky chrání RLS. Knihovna je vendorovaná v `vendor/supabase.min.js`.

### Nastavení Supabase (jednorázově)

1. **SQL Editor** → vlož a spusť [supabase.sql](supabase.sql) (tabulka `app_state` + RLS + politiky).
2. **Authentication → URL Configuration** → do **Redirect URLs** přidej adresy, kde appku otevíráš:
   - lokálně: `http://localhost:5173/`
   - po nasazení: skutečná `https://…` adresa hostingu
   (jinak magic link nepřesměruje zpět do aplikace).
3. V appce: Nastavení → Synchronizace → zadej e-mail → **Poslat odkaz** → otevři odkaz **na stejném zařízení a prohlížeči** → zadej **šifrovací passfrázi**. Na všech zařízeních použij **stejnou passfrázi** (jinak si navzájem data nedešifrují). Passfrázi si zapiš – nejde obnovit.

## Omezení prototypu

- Bez zapnuté synchronizace jsou data jen v `localStorage` tohoto prohlížeče (zálohu dělá Export/Import JSON v Nastavení).
- Upozornění chodí jen když je aplikace otevřená. Doručení na zavřenou aplikaci, iPhone a Apple Watch bude vyžadovat server s Web Push.
