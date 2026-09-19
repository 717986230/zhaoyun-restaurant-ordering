# Anbindung an das Kassensystem / POS integration

This app takes orders. It is not a Registrierkasse and must not become one:
under the RKSV a cash register needs a signature creation unit, a DEP, a start
receipt registered with FinanzOnline, and receipts carrying a machine-readable
code. None of that is here, deliberately. The bill this app prints says so —
`Interne Rechnung, kein Kassenbeleg` — and the receipt a guest is legally owed
still comes from the existing POS.

So the integration has one shape, whatever the transport turns out to be:
**orders leave this system and arrive in the POS; the POS issues the receipt.**
Nothing flows back except, optionally, "this table is paid".

## What this system can already hand over

Everything a POS needs is already computed and already reachable:

| | |
|---|---|
| One table's open bill | `GET /api/admin/tables/{table}/bill` |
| Every table, with what is on it | `GET /api/admin/tables/overview` |
| All orders | `GET /api/orders?limit=n` |
| One order, as placed | inside the bill, grouped by `orderNo` |

The bill is gross-priced per line with the VAT rate on each line and a split
per rate, which is the part a POS integration most often gets wrong.
`docs/samples/bill.json` is a real payload produced by the server's own code
(ids and order numbers replaced with fixed ones so the file does not change on
every regeneration), spanning both rates:

```
10 %  brutto 39.90   netto 36.27   USt 3.63
20 %  brutto  7.60   netto  6.33   USt 1.27
                                  Summe 47.50
```

Dish names come trilingual (`names.zh/de/en`), so the POS can be fed whichever
language its receipts and reports are in.

## What is still unknown

Which interface **JK Kasse** offers. That decides everything else, and it is the
one thing that cannot be guessed. Ask the vendor for the
*Schnittstellen-Dokumentation*.

Four shapes are possible, in descending order of how well they work:

1. **HTTP API.** Vendor supplies a base URL and a token; this system POSTs
   orders or bills. An adapter plus a retry queue — the print-job queue in
   `print_jobs` is already exactly that pattern and would be copied.
2. **File import (CSV/XML).** The POS watches a directory or polls. Same queue,
   different sink; common with older systems and perfectly workable.
3. **Direct database access.** Possible, and the most fragile: a vendor update
   can break it silently, and a wrong write lands in data the tax office cares
   about. If it is the only option, writes go to one staging table the vendor
   names, never to their live tables.
4. **No interface.** Then staff re-key, and the useful work here is making the
   internal bill fast to copy — or evaluating a POS that does have an API.

## Fragen an den Hersteller

Diese Fragen an JK Kasse weiterleiten; die Antworten genügen, um die Anbindung
zu bauen.

1. Gibt es eine dokumentierte Schnittstelle (REST-API, Datei-Import, Datenbank)?
   Bitte um die Schnittstellen-Dokumentation.
2. Können Bestellungen von außen angelegt werden — also ein Tisch eröffnen,
   Artikel nachbuchen und später abrechnen? Oder nimmt die Kassa nur eine
   fertige Rechnung entgegen?
3. Wie werden Artikel identifiziert: über eine Artikelnummer der Kassa, über
   einen PLU-Code, oder über den Namen? Falls über eine Artikelnummer: wie
   bekommen wir die Artikelstammdaten (Export, API)?
4. Wie werden Steuersätze übergeben — als Prozentsatz (10 / 20) oder als
   Steuerschlüssel der Kassa? Werden Preise brutto oder netto erwartet?
5. Wie werden Zusatzwünsche / Beilagen abgebildet (eigene Artikel, Modifier,
   Textzeile)?
6. Wie werden Storni und Änderungen übergeben, wenn eine Bestellung schon
   übermittelt wurde?
7. Läuft die Kassa im Lokal oder in der Cloud? Ist sie aus dem Internet
   erreichbar, oder muss die Anbindung im selben Netz laufen?
8. Gibt es eine Testinstanz, gegen die wir entwickeln können?

Frage 2 entscheidet, ob pro Bestellung oder erst bei der Abrechnung übergeben
wird. Frage 3 ist der Aufwandstreiber: ohne gemeinsame Artikelnummern muss eine
Zuordnung zwischen unserem Katalog und dem Kassen-Artikelstamm gepflegt werden,
und die gehört dann in die Verwaltung.

## Wenn die Antworten da sind

The catalogue would gain an optional `posArticleId` per product, the bill would
gain a delivery record per table, and a queue would carry the handover with the
same lease-and-backoff behaviour the printers already use — a restaurant network
drops, and an order that reached the kitchen must not be lost on the way to the
till. None of that is worth building against a guessed interface.
