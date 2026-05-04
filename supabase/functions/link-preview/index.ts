// @ts-nocheck
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};

const jsonHeaders = {
  ...corsHeaders,
  "Content-Type": "application/json",
};

type LinkPreviewResponse = {
  url: string;
  title: string | null;
  description: string | null;
  image: string | null;
  favicon: string | null;
  domain: string;
};

function getDomain(input: string): string {
  try {
    return new URL(input).hostname.replace(/^www\./i, "");
  } catch {
    return "bilinmiyor";
  }
}

function normalizeUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const candidate = /^https?:\/\//i.test(trimmed)
    ? trimmed
    : trimmed.startsWith("//")
      ? `https:${trimmed}`
      : `https://${trimmed}`;

  try {
    const parsed = new URL(candidate);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return null;
    }
    if (!parsed.hostname) {
      return null;
    }
    if (
      parsed.hostname !== "localhost" &&
      !parsed.hostname.includes(".") &&
      !parsed.hostname.includes(":")
    ) {
      return null;
    }
    return parsed.toString();
  } catch {
    return null;
  }
}

function toAbsoluteUrl(value: string | null, baseUrl: string): string | null {
  if (!value) return null;
  try {
    return new URL(value, baseUrl).toString();
  } catch {
    return null;
  }
}

function textOrNull(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function fallbackPayload(url: string): LinkPreviewResponse {
  return {
    url,
    title: null,
    description: null,
    image: null,
    favicon: null,
    domain: getDomain(url),
  };
}

function firstMetaContent(doc: Document, selectors: string[]): string | null {
  for (const selector of selectors) {
    const value = textOrNull(doc.querySelector(selector)?.getAttribute("content"));
    if (value) return value;
  }
  return null;
}

function parsePreview(html: string, sourceUrl: string): LinkPreviewResponse {
  const fallback = fallbackPayload(sourceUrl);
  const doc = new DOMParser().parseFromString(html, "text/html");

  if (!doc) {
    return fallback;
  }

  const title =
    firstMetaContent(doc, [
      'meta[property="og:title"]',
      'meta[name="twitter:title"]',
    ]) ?? textOrNull(doc.querySelector("title")?.textContent);

  const description =
    firstMetaContent(doc, [
      'meta[property="og:description"]',
      'meta[name="description"]',
      'meta[name="twitter:description"]',
    ]) ?? null;

  const rawImage = firstMetaContent(doc, [
    'meta[property="og:image"]',
    'meta[name="twitter:image"]',
  ]);

  const faviconHref =
    textOrNull(doc.querySelector('link[rel="icon"]')?.getAttribute("href")) ??
    textOrNull(doc.querySelector('link[rel="shortcut icon"]')?.getAttribute("href")) ??
    "/favicon.ico";

  return {
    url: sourceUrl,
    title,
    description,
    image: toAbsoluteUrl(rawImage, sourceUrl),
    favicon: toAbsoluteUrl(faviconHref, sourceUrl),
    domain: getDomain(sourceUrl),
  };
}

async function fetchWithTimeout(url: string, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      method: "GET",
      signal: controller.signal,
      headers: {
        "User-Agent": "genovakorist-link-preview/1.0",
      },
      redirect: "follow",
    });
  } finally {
    clearTimeout(timeout);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { status: 200, headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Yetkilendirme eksik" }), {
        status: 401,
        headers: jsonHeaders,
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Geçersiz oturum" }), {
        status: 401,
        headers: jsonHeaders,
      });
    }

    const body = await req.json().catch(() => ({}));
    const rawUrl = typeof body?.url === "string" ? body.url : "";
    const normalizedUrl = normalizeUrl(rawUrl);

    if (!normalizedUrl) {
      return new Response(JSON.stringify({ error: "Geçerli bir URL gönderin" }), {
        status: 400,
        headers: jsonHeaders,
      });
    }

    const response = await fetchWithTimeout(normalizedUrl, 3000);
    const finalUrl = normalizeUrl(response.url) ?? normalizedUrl;

    const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
    if (!response.ok || !contentType.includes("text/html")) {
      return new Response(JSON.stringify(fallbackPayload(finalUrl)), {
        headers: jsonHeaders,
      });
    }

    const html = await response.text();
    const preview = parsePreview(html.slice(0, 300_000), finalUrl);

    return new Response(JSON.stringify(preview), { headers: jsonHeaders });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      return new Response(
        JSON.stringify({ error: "Bağlantı zaman aşımına uğradı (3s)" }),
        { status: 504, headers: jsonHeaders },
      );
    }

    const message = error instanceof Error ? error.message : "Bilinmeyen hata";
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: jsonHeaders,
    });
  }
});
