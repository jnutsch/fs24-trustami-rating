/**
 * scrape-trustami.js
 *
 * Liest die öffentliche Trustami-Bewertungsseite von FaschingShop24 aus
 * (https://www.trustami.com/erfahrung/faschingshop24-bewertung) und schreibt
 * die aktuelle Gesamtbewertung als rating.json in dieses Repo.
 *
 * Läuft in GitHub Actions (siehe .github/workflows/sync-trustami.yml),
 * NICHT im plentyShop selbst – plentyShop bietet keine Möglichkeit,
 * eigene serverseitige Scripts/Cronjobs auszuführen.
 *
 * Node 18+ (global fetch vorhanden). Keine externen Abhängigkeiten nötig.
 */

const fs = require("fs");

const TRUSTAMI_URL = "https://www.trustami.com/erfahrung/faschingshop24-bewertung";

async function main() {
  const res = await fetch(TRUSTAMI_URL, {
    headers: {
      // Ganz normaler Browser-User-Agent, keine Verschleierung -
      // wir lesen nur die frei zugängliche, öffentliche Seite.
      "User-Agent":
        "Mozilla/5.0 (compatible; FaschingShop24-RatingSync/1.0; +https://www.faschingshop24.de)",
      "Accept-Language": "de-DE,de;q=0.9",
    },
  });

  if (!res.ok) {
    throw new Error(`Trustami-Seite antwortete mit Status ${res.status}`);
  }

  const html = await res.text();

  // Tags grob entfernen, damit wir robust auf den Fließtext matchen können -
  // das übersteht Layout-/CSS-Änderungen bei Trustami besser als starre
  // CSS-Selektoren, solange die deutschen Formulierungen gleich bleiben.
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ");

  // Beispiel-Textbausteine auf der Seite (Stand 04.09.2026):
  //   "4,92 von 5,00"
  //   "aus 307.545 Bewertungen"
  //   "zu 97,52% positiv"
  //   "Ausgezeichnet"
  const ratingMatch = text.match(/(\d[,.]\d{2})\s*von\s*5[,.]00/);
  const countMatch = text.match(/aus\s*([\d.]{1,12})\s*Bewertungen/);
  const positiveMatch = text.match(/zu\s*([\d,]+)\s*%\s*positiv/);
  const labelMatch = text.match(
    /(Ausgezeichnet|Sehr Gut|Gut|Befriedigend|Ausreichend|Mangelhaft)/
  );

  if (!ratingMatch || !countMatch) {
    throw new Error(
      "Konnte Bewertung/Anzahl nicht aus der Trustami-Seite extrahieren – " +
        "die Seitenstruktur/Formulierung hat sich vermutlich geändert. " +
        "scrape-trustami.js muss dann angepasst werden."
    );
  }

  const rating = parseFloat(ratingMatch[1].replace(",", "."));
  const count = parseInt(countMatch[1].replace(/\./g, ""), 10);
  const positivePercent = positiveMatch
    ? parseFloat(positiveMatch[1].replace(",", "."))
    : null;
  const label = labelMatch ? labelMatch[1] : null;

  // Plausibilitätsprüfung, damit ein kaputter Parser nicht versehentlich
  // Unsinn (z.B. rating 0 oder count 0) live auf die Seite bringt.
  if (rating < 1 || rating > 5 || count < 1) {
    throw new Error(
      `Unplausible Werte extrahiert (rating=${rating}, count=${count}) – wird nicht gespeichert.`
    );
  }

  let previous = null;
  try {
    previous = JSON.parse(fs.readFileSync("rating.json", "utf8"));
  } catch (e) {
    // Erste Ausführung / Datei existiert noch nicht - kein Problem.
  }

  const data = {
    rating,
    count,
    positivePercent,
    label,
    source: TRUSTAMI_URL,
    updatedAt: new Date().toISOString(),
  };

  fs.writeFileSync("rating.json", JSON.stringify(data, null, 2) + "\n");
  console.log("Gespeichert:", data);

  if (previous && Math.abs(previous.rating - rating) > 1) {
    console.warn(
      "WARNUNG: Sprung der Bewertung um mehr als 1 Punkt gegenüber dem letzten Lauf " +
        `(${previous.rating} -> ${rating}). Bitte manuell prüfen, ob der Parser noch korrekt liest.`
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
