import { Express, Request, Response as ExResponse } from "express";
import { CelestiaClient } from "../../../integrations/celestia/client";
import { CelestiaAIDevice } from "../../../integrations/celestia/catalog";
import { AdminRouteContext } from "../context";
import { getEnvValue } from "../env";

export function registerCelestiaAdminRoutes(app: Express, context: AdminRouteContext): void {
  app.get("/admin/api/celestia/devices", async (req: Request, res: ExResponse) => {
    const envPath = context.envStore.getPath();
    const baseUrl = getEnvValue(envPath, "CELESTIA_BASE_URL");
    const token = getEnvValue(envPath, "CELESTIA_TOKEN");
    const pluginId = normalizeOptionalQuery(req.query.plugin_id);
    const kind = normalizeOptionalQuery(req.query.kind);
    const query = normalizeOptionalQuery(req.query.q);
    const configured = Boolean(baseUrl && token);

    if (!configured) {
      res.json({
        ok: true,
        configured: false,
        baseUrl,
        devices: [],
        filters: {
          ...(pluginId ? { plugin_id: pluginId } : {}),
          ...(kind ? { kind } : {}),
          ...(query ? { q: query } : {})
        }
      });
      return;
    }

    try {
      const client = new CelestiaClient(baseUrl, token);
      const devices = await client.requestJson<CelestiaAIDevice[]>("GET", "/api/ai/v1/devices", {
        query: {
          ...(pluginId ? { plugin_id: pluginId } : {}),
          ...(kind ? { kind } : {}),
          ...(query ? { q: query } : {})
        }
      });
      res.json({
        ok: true,
        configured: true,
        baseUrl,
        devices: Array.isArray(devices) ? devices : [],
        filters: {
          ...(pluginId ? { plugin_id: pluginId } : {}),
          ...(kind ? { kind } : {}),
          ...(query ? { q: query } : {})
        }
      });
    } catch (error) {
      console.error("[admin][celestia] list devices failed", {
        baseUrl,
        pluginId,
        kind,
        query,
        error
      });
      res.status(502).json({
        ok: false,
        configured: true,
        baseUrl,
        error: (error as Error).message ?? "failed to fetch Celestia devices"
      });
    }
  });
}

function normalizeOptionalQuery(input: unknown): string {
  const value = Array.isArray(input) ? input[0] : input;
  return typeof value === "string" ? value.trim() : "";
}
