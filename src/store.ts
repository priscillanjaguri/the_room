import { EXPERTS } from "./experts";
import { DEFAULT_MODEL, MODELS } from "./openai";

export interface Message {
  id: string;
  /// "you", an expert's id, or "error" for a turn that failed.
  from: string;
  text: string;
  at: number;
}

export interface Settings {
  key: string;
  model: string;
  name: string;
  /// Replies are read aloud.
  speak: boolean;
  /// Optional: lets an expert speak in a fish.audio voice instead of OpenAI's.
  fishKey: string;
  /// A fish.audio voice link or id per expert id.
  voices: Record<string, string>;
}

const SETTINGS = "room.settings";
const MESSAGES = "room.messages";
/// Older messages are dropped past this, so the phone's storage never fills up.
const KEPT = 500;

function read<T>(name: string, fallback: T): T {
  try {
    const text = localStorage.getItem(name);
    return text ? (JSON.parse(text) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write(name: string, value: unknown) {
  try {
    localStorage.setItem(name, JSON.stringify(value));
  } catch {
    // Storage full or blocked: the room still works, it only forgets on restart.
  }
}

export function loadSettings(): Settings {
  const saved = read<Partial<Settings>>(SETTINGS, {});
  const model = MODELS.some(([id]) => id === saved.model) ? saved.model! : DEFAULT_MODEL;
  // An Anthropic key from the first version of the app means nothing to OpenAI.
  const key = saved.key?.startsWith("sk-ant-") ? "" : saved.key ?? "";
  const voices = { ...Object.fromEntries(EXPERTS.map((expert) => [expert.id, expert.voice.fish])), ...saved.voices };
  return { key, model, name: saved.name ?? "", speak: saved.speak ?? true, fishKey: saved.fishKey ?? "", voices };
}

export const saveSettings = (settings: Settings) => write(SETTINGS, settings);

export const loadMessages = () => read<Message[]>(MESSAGES, []);

export const saveMessages = (messages: Message[]) => write(MESSAGES, messages.slice(-KEPT));

export const newId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
