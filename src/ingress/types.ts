import { Express } from "express";
import { SessionManager } from "../sessionManager";

export interface IngressAdapter {
  register(app: Express, sessionManager: SessionManager): void;
}
