import { Capacitor, CapacitorHttp } from "@capacitor/core";

export type Field = { name: string; value: string } | { name: string; file: Blob; fileName: string };

interface Post {
  url: string;
  headers: Record<string, string>;
  json?: unknown;
  form?: Field[];
  /// "blob" for audio back, "json" for anything else. Error bodies are always read as JSON.
  want: "json" | "blob";
  signal?: AbortSignal;
}

export interface Answer {
  status: number;
  json: unknown;
  blob: Blob | null;
}

/// Thrown when the request never reached the service at all.
export class Offline extends Error {}

/// Hosts that refused the WebView's own cross-origin requests. Those go through the phone's HTTP
/// stack from then on, which browser rules do not apply to.
const refused = new Set<string>();

const toBase64 = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });

function fromBase64(data: string, type: string): Blob {
  const bytes = Uint8Array.from(atob(data), (char) => char.charCodeAt(0));
  return new Blob([bytes], { type });
}

function aborted(signal?: AbortSignal): Promise<never> {
  return new Promise((_, reject) => signal?.addEventListener("abort", () => reject(new DOMException("Stopped", "AbortError")), { once: true }));
}

async function direct({ url, headers, json, form, want, signal }: Post): Promise<Answer> {
  let body: BodyInit;
  if (form) {
    const data = new FormData();
    for (const field of form) "file" in field ? data.append(field.name, field.file, field.fileName) : data.append(field.name, field.value);
    body = data;
  } else {
    body = JSON.stringify(json);
    headers = { ...headers, "content-type": "application/json" };
  }
  const response = await fetch(url, { method: "POST", headers, body, signal });
  if (response.ok && want === "blob") return { status: response.status, json: null, blob: await response.blob() };
  return { status: response.status, json: await response.json().catch(() => null), blob: null };
}

async function native({ url, headers, json, form, want, signal }: Post): Promise<Answer> {
  const data = form
    ? await Promise.all(form.map(async (field) => ("file" in field ? { type: "base64File", key: field.name, value: await toBase64(field.file), fileName: field.fileName, contentType: field.file.type } : { type: "string", key: field.name, value: field.value })))
    : json;
  const request = CapacitorHttp.request({
    method: "POST",
    url,
    headers: { ...headers, "Content-Type": form ? "multipart/form-data" : "application/json" },
    data,
    responseType: want === "blob" ? "blob" : "json",
  });
  const response = await Promise.race([request, aborted(signal)]);
  const ok = response.status >= 200 && response.status < 300;
  if (want === "blob") {
    if (ok) return { status: response.status, json: null, blob: fromBase64(response.data, String(response.headers["Content-Type"] ?? response.headers["content-type"] ?? "audio/mpeg")) };
    let error: unknown = null;
    try {
      error = JSON.parse(atob(response.data));
    } catch {
      // Not JSON; the status still says enough.
    }
    return { status: response.status, json: error, blob: null };
  }
  return { status: response.status, json: response.data, blob: null };
}

/// Posts JSON or a form, straight from the page when the service allows it and through the phone
/// otherwise.
export async function post(request: Post): Promise<Answer> {
  const host = new URL(request.url).host;
  if (!refused.has(host)) {
    try {
      return await direct(request);
    } catch (error) {
      if (request.signal?.aborted) throw error;
      // A refused cross-origin request and a dropped connection look the same from here.
      if (!Capacitor.isNativePlatform()) throw new Offline();
      refused.add(host);
    }
  }
  try {
    return await native(request);
  } catch (error) {
    if (request.signal?.aborted) throw error;
    throw new Offline();
  }
}
