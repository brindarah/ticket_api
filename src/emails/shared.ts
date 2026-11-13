// Utilitaires communs aux contenus d'emails

// Échappe les caractères spéciaux pour insérer une valeur dans le HTML sans l'interpréter
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function formatParisDate(date: Date): string {
  const formatted = new Intl.DateTimeFormat("fr-FR", {
    dateStyle: "long",
    timeStyle: "short",
    timeZone: "Europe/Paris",
  }).format(date);
  return `${formatted} (heure de Paris)`;
}

// Adresse d'une route de l'API. Sans URL publique, seul le chemin est indiqué.
export function apiEndpoint(path: string, apiBaseUrl?: string): string {
  return `${apiBaseUrl?.trim().replace(/\/+$/, "") ?? ""}${path}`;
}

export function assertValidDate(date: Date, name: string, caller: string): void {
  if (Number.isNaN(date.getTime())) {
    throw new Error(`${caller} : ${name} doit être une date valide`);
  }
}

// Bloc de requête HTTP affiché dans l'email, puisqu'il n'existe pas encore de frontend
export function apiRequestBlock(endpoint: string, body: string) {
  const text = [`  POST ${endpoint}`, "  Content-Type: application/json", "", `  ${body}`].join("\n");
  const html = `<pre style="background: #f3f4f6; padding: 12px; border-radius: 4px; white-space: pre-wrap;">POST ${escapeHtml(endpoint)}
Content-Type: application/json

${escapeHtml(body)}</pre>`;
  return { text, html };
}

export function htmlLayout(paragraphs: string): string {
  return `<!doctype html>
<html lang="fr">
  <body style="font-family: Arial, sans-serif; line-height: 1.5; color: #1f2937;">
${paragraphs}
  </body>
</html>`;
}
