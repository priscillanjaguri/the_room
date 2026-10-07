import { Capacitor, CapacitorHttp } from "@capacitor/core";

const CHAT_URL = "https://api.openai.com/v1/chat/completions";
const MODELS_URL = "https://api.openai.com/v1/models";

export const MODELS: [string, string][] = [
  ["gpt-5-mini", "GPT-5 mini (quick, cheapest)"],
  ["gpt-5", "GPT-5 (sharper, slower)"],
];
export const DEFAULT_MODEL = MODELS[0][0];
/// Choosing who speaks next is a one-word job, so it always uses the quickest model.
export const QUICK_MODEL = MODELS[0][0];
export const KEY_PAGE = "https://platform.openai.com/api-keys";

export class BrainError extends Error {}

interface Ask {
  key: string;
  model: string;
  system: string;
  prompt: string;
  /// Covers the model's hidden reasoning as well as the words it sends back.
  maxTokens: number;
  signal?: AbortSignal;
  /// Called with the whole reply so far, each time more of it arrives.
  onText?: (soFar: string) => void;
}

/// False once the WebView has been refused a direct request; from then on every request goes
/// through the phone's own HTTP stack, which OpenAI's browser rules do not apply to.
let direct = true;

const headers = (key: string): Record<string, string> => ({ "content-type": "application/json", authorization: `Bearer ${key}` });

/// A plain-language reason for a refused request.
function problem(status: number, body: unknown): BrainError {
  const error = (body as { error?: { message?: string; code?: string } } | null)?.error;
  if (status === 401) return new BrainError("OpenAI refused that API key. Check that you copied all of it.");
  if (error?.code === "insufficient_quota") return new BrainError("Your OpenAI credit has run out. Add credit at platform.openai.com.");
  if (status === 404 || error?.code === "model_not_found") return new BrainError("This API key cannot use that model. Pick the other one in Settings.");
  if (status === 429) return new BrainError("Too many requests right now. Wait a moment and try again.");
  if (status >= 500) return new BrainError("OpenAI is busy. Try again in a moment.");
  return new BrainError(error?.message || `OpenAI answered with error ${status}.`);
}

const offline = () => new BrainError("No connection to OpenAI. Check your internet and try again.");

function aborted(signal?: AbortSignal): Promise<never> {
  return new Promise((_, reject) => signal?.addEventListener("abort", () => reject(new DOMException("Stopped", "AbortError")), { once: true }));
}

function body({ model, system, prompt, maxTokens }: Ask, stream: boolean) {
  return {
    model,
    stream,
    max_completion_tokens: maxTokens,
    // A chat reply needs little thinking, and minimal effort keeps the wait short.
    reasoning_effort: "minimal",
    messages: [
      { role: "developer", content: system },
      { role: "user", content: prompt },
    ],
  };
}

async function streamed(ask: Ask): Promise<string> {
  const response = await fetch(CHAT_URL, { method: "POST", headers: headers(ask.key), signal: ask.signal, body: JSON.stringify(body(ask, true)) });
  if (!response.ok || !response.body) {
    let detail: unknown = null;
    try {
      detail = await response.json();
    } catch {
      // The body was not JSON; the status still says enough.
    }
    throw problem(response.status, detail);
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let text = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let end: number;
    while ((end = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, end).trim();
      buffer = buffer.slice(end + 1);
      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trim();
      if (data === "[DONE]") return text;
      let chunk;
      try {
        chunk = JSON.parse(data);
      } catch {
        continue;
      }
      if (chunk.error) throw new BrainError(chunk.error.message ?? "The reply broke off.");
      const piece = chunk.choices?.[0]?.delta?.content;
      if (piece) {
        text += piece;
        ask.onText?.(text);
      }
    }
  }
  return text;
}

async function native(ask: Ask): Promise<string> {
  let response;
  try {
    response = await Promise.race([CapacitorHttp.post({ url: CHAT_URL, headers: headers(ask.key), data: body(ask, false) }), aborted(ask.signal)]);
  } catch (error) {
    if (ask.signal?.aborted) throw error;
    throw offline();
  }
  if (response.status < 200 || response.status >= 300) throw problem(response.status, response.data);
  const text: string = response.data?.choices?.[0]?.message?.content ?? "";
  ask.onText?.(text);
  return text;
}

/// Sends one prompt and returns the whole reply, streaming it through `onText` when it can.
export async function ask(request: Ask): Promise<string> {
  if (direct) {
    try {
      return await streamed(request);
    } catch (error) {
      if (request.signal?.aborted || error instanceof BrainError) throw error;
      // A refused cross-origin request and a dropped connection look the same from here.
      if (!Capacitor.isNativePlatform()) throw offline();
      direct = false;
    }
  }
  return native(request);
}

async function models(key: string): Promise<{ status: number; data: unknown }> {
  if (direct) {
    try {
      const response = await fetch(MODELS_URL, { headers: headers(key) });
      return { status: response.status, data: await response.json().catch(() => null) };
    } catch {
      if (!Capacitor.isNativePlatform()) throw offline();
      direct = false;
    }
  }
  try {
    const response = await CapacitorHttp.get({ url: MODELS_URL, headers: headers(key) });
    return { status: response.status, data: response.data };
  } catch {
    throw offline();
  }
}

/// Checks a key by listing the models it can use; this costs nothing.
export async function check(key: string, model: string): Promise<void> {
  const { status, data } = await models(key);
  if (status < 200 || status >= 300) throw problem(status, data);
  const ids = ((data as { data?: { id: string }[] } | null)?.data ?? []).map((one) => one.id);
  if (ids.length && !ids.includes(model)) throw problem(404, null);
}
