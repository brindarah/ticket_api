import express from "express";
import ticketRoutes from "./routes/ticket.routes";
import { errorHandler, notFound } from "./middlewares/errorHandler";

const app = express();

// Permet de lire le JSON envoyé dans le body des requêtes
app.use(express.json());

// Route de test pour vérifier que le serveur tourne
app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

// Toutes les routes /tickets
app.use("/tickets", ticketRoutes);

// Toujours en dernier : route inconnue, puis gestion des erreurs
app.use(notFound);
app.use(errorHandler);

export default app;
