// Chargé avant chaque fichier de test (npm test : tsx --test --import ./tests/helpers/testEnv.ts).
// Les tests écrivent en base : ils doivent viser une base de test dédiée, jamais la base de développement.
import "dotenv/config";

// TEST_DATABASE_URL (dans .env ou l'environnement) remplace DATABASE_URL pour les tests uniquement.
if (process.env.TEST_DATABASE_URL) {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
}

// Garde-fou : refuse toute base dont le nom ne se termine pas par _test.
// Seul le nom de la base est affiché, jamais l'URL complète (elle contient le mot de passe).
let databaseName = "";
try {
  databaseName = new URL(process.env.DATABASE_URL ?? "").pathname.slice(1);
} catch {
  // URL absente ou invalide : traitée ci-dessous
}

if (!databaseName.endsWith("_test")) {
  throw new Error(
    `Tests refusés : la base "${databaseName || "inconnue"}" n'est pas une base de test. ` +
      "Définissez TEST_DATABASE_URL vers une base dont le nom se termine par _test (ex. ticket_api_test).",
  );
}
