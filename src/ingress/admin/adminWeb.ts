import fs from "fs";
import path from "path";
import express, { Express } from "express";

export function registerAdminWebRoutes(app: Express, adminDistCandidates: string[]): void {
  const adminDist = resolveAdminDist(adminDistCandidates);

  if (!adminDist) {
    app.get("/admin", (_req, res) => {
      res.status(503).send("Admin web build not found. Run: npm run build:admin");
    });
    app.get("/admin/*", (req, res, next) => {
      if (req.path.startsWith("/admin/api/")) {
        next();
        return;
      }
      res.status(503).send("Admin web build not found. Run: npm run build:admin");
    });
    return;
  }

  const assetsDir = path.join(adminDist, "assets");
  if (fs.existsSync(assetsDir)) {
    app.use("/admin/assets", express.static(assetsDir, {
      immutable: true,
      maxAge: "365d"
    }));
  }

  const indexFile = path.join(adminDist, "index.html");
  app.get("/admin", (_req, res) => {
    res.sendFile(indexFile);
  });

  app.get("/admin/*", (req, res, next) => {
    if (req.path.startsWith("/admin/api/")) {
      next();
      return;
    }
    res.sendFile(indexFile);
  });
}

function resolveAdminDist(adminDistCandidates: string[]): string | null {
  for (const candidate of adminDistCandidates) {
    const indexFile = path.join(candidate, "index.html");
    if (fs.existsSync(indexFile)) {
      return candidate;
    }
  }
  return null;
}
