import express from "express";
import swaggerUi from "swagger-ui-express";
import { openApiDocument } from "./docs/openapi";
import ticketRoutes from "./routes/ticket.routes";
import authRoutes from "./routes/auth.routes";
import userRoutes from "./routes/user.routes";
import invitationRoutes from "./routes/invitation.routes";
import { errorHandler, notFound } from "./middlewares/errorHandler";

const app = express();

// Permet de lire le JSON envoyé dans le body des requêtes
app.use(express.json());

// Route de test pour vérifier que le serveur tourne
app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

// Documentation OpenAPI (publique) : interface Swagger sur /docs, JSON brut sur /docs/openapi.json
app.get("/docs/openapi.json", (_req, res) => {
  res.json(openApiDocument);
});
app.use("/docs", swaggerUi.serve, swaggerUi.setup(openApiDocument));

// Toutes les routes /tickets
app.use("/tickets", ticketRoutes);

// Toutes les routes /auth
app.use("/auth", authRoutes);

// Acceptation d'une invitation : POST /auth/accept-invitation
app.use("/auth", invitationRoutes);

// Toutes les routes /users (Super Admin)
app.use("/users", userRoutes);

// Toujours en dernier : route inconnue, puis gestion des erreurs
app.use(notFound);
app.use(errorHandler);

export default app;