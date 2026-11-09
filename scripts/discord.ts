/** WForYou · envío a Discord con tarjetas (embeds) */

// Colores oficiales de clase (id de clase de la API → color)
export const COLOR_CLASE: Record<number, number> = {
  1: 0xc69b6d, 2: 0xf48cba, 3: 0xaad372, 4: 0xfff468, 5: 0xffffff,
  7: 0x0070dd, 8: 0x3fc7eb, 9: 0x8788ee, 11: 0xff7c0a,
};
export const COLOR_WFORYOU = 0xe0a84b;

export interface Embed {
  title?: string;
  author?: { name: string; url?: string; icon_url?: string };
  description?: string;
  url?: string;
  color?: number;
  timestamp?: string;
  thumbnail?: { url: string };
  fields?: { name: string; value: string; inline?: boolean }[];
  footer?: { text: string };
}

/** Términos de la API de Blizzard (2.13): indicar a Blizzard como fuente de los datos, sin dar a entender respaldo */
export const PIE_FUENTE = "WForYou · Datos: Blizzard Entertainment (API de Battle.net)";

/** Envía las tarjetas en bloques de 10 (máximo de Discord por mensaje). Sin webhook no hace nada. */
export async function enviarEmbeds(embeds: Embed[]): Promise<void> {
  const webhook = process.env.DISCORD_WEBHOOK_URL;
  if (!webhook || embeds.length === 0) return;
  for (let i = 0; i < embeds.length; i += 10) {
    const res = await fetch(webhook, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: "WForYou",
        embeds: embeds.slice(i, i + 10).map((e) => ({ ...e, footer: e.footer ?? { text: PIE_FUENTE } })),
      }),
    });
    if (!res.ok) console.warn(`Discord: HTTP ${res.status} ${await res.text().catch(() => "")}`);
  }
}

/** Solo usa la URL si es http(s); Discord rechaza el mensaje entero con URLs no válidas */
export const urlValida = (u: unknown): string | undefined =>
  typeof u === "string" && /^https?:\/\//.test(u) ? u : undefined;
