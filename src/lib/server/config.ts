import { db } from "@/lib/db";

/**
 * Gateway (Orthanc) connection settings.
 *
 * Resolution order: AppSetting DB rows (user-editable in the Settings dialog)
 * → environment variables (deploy/docker-compose.yml) → empty (unconfigured).
 *
 * Keys stored in AppSetting:
 *   gatewayUrl       e.g. "http://192.168.1.50:8042" (or http://orthanc:8042 in compose)
 *   gatewayUsername  optional basic-auth user
 *   gatewayPassword  optional basic-auth password (never sent back to client)
 *   gatewayAet       AE Title of THIS viewer's Orthanc gateway (C-MOVE target),
 *                    must match DicomAet in deploy/orthanc.json
 */

export interface GatewayConfig {
  base: string; // no trailing slash
  username: string;
  password: string;
  gatewayAet: string; // this gateway's own AE Title
  source: "db" | "env";
}

export const DEFAULT_GATEWAY_AET = "SYNOLOGYVIEWER";

export async function getSettings(keys: string[]): Promise<Record<string, string>> {
  const rows = await db.appSetting.findMany({ where: { key: { in: keys } } });
  const out: Record<string, string> = {};
  for (const r of rows) out[r.key] = r.value;
  return out;
}

export async function setSetting(key: string, value: string): Promise<void> {
  await db.appSetting.upsert({
    where: { key },
    update: { value },
    create: { key, value },
  });
}

export async function deleteSetting(key: string): Promise<void> {
  await db.appSetting.deleteMany({ where: { key } });
}

export async function getGatewayConfig(): Promise<GatewayConfig | null> {
  const s = await getSettings(["gatewayUrl", "gatewayUsername", "gatewayPassword", "gatewayAet"]);
  const url = (s.gatewayUrl || process.env.ORTHANC_URL || "").trim();
  if (!url) return null;
  return {
    base: url.replace(/\/+$/, ""),
    username: s.gatewayUsername ?? process.env.ORTHANC_USERNAME ?? "",
    password: s.gatewayPassword ?? process.env.ORTHANC_PASSWORD ?? "",
    gatewayAet: (s.gatewayAet || process.env.GATEWAY_AET || DEFAULT_GATEWAY_AET).trim(),
    source: s.gatewayUrl ? "db" : "env",
  };
}

export function basicAuth(cfg: GatewayConfig): string {
  return `Basic ${Buffer.from(`${cfg.username}:${cfg.password}`).toString("base64")}`;
}
