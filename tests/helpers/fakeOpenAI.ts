import type OpenAI from "openai";
import { setOpenAIClientForTests } from "../../src/services/ai.service";

// Faux client OpenAI pour les tests : aucun appel réseau, aucune clé nécessaire.
// Chaque appel est enregistré (paramètres envoyés) et reçoit la réponse prévue par le test.

export type FakeCompletion = {
  content?: string | null;
  refusal?: string | null;
  finish_reason?: string;
};

// Contenu JSON tel que le renverrait le modèle avec la sortie structurée
export const modelReply = (category: string, reply: string) => JSON.stringify({ category, reply });

export function installFakeOpenAI(behavior: (params: any) => FakeCompletion | Promise<FakeCompletion>) {
  const calls: any[] = [];
  const client = {
    chat: {
      completions: {
        create: async (params: any) => {
          calls.push(params);
          const { content = null, refusal = null, finish_reason = "stop" } = await behavior(params);
          return { choices: [{ index: 0, finish_reason, message: { role: "assistant", content, refusal } }] };
        },
      },
    },
  };
  setOpenAIClientForTests(client as unknown as OpenAI);
  return calls;
}

// Raccourci : le modèle renvoie toujours la même catégorie et la même réponse
export const fakeModelReply = (category: string, reply: string) =>
  installFakeOpenAI(() => ({ content: modelReply(category, reply) }));

// Message utilisateur envoyé au modèle (le ticket), et instructions système
export const userMessage = (call: any): string => call.messages.find((m: any) => m.role === "user").content;
export const systemMessage = (call: any): string => call.messages.find((m: any) => m.role === "system").content;
