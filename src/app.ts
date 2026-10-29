import express from "express";

const app = express();

// Permet de lire le JSON envoyé dans le body des requêtes
app.use(express.json());

// Route de test pour vérifier que le serveur tourne
app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

export default app;
