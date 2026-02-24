import { Express } from "express";
import { SessionManager } from "../core/sessionManager";

export interface IngressAdapter {
  register(app: Express, sessionManager: SessionManager): void;
}
