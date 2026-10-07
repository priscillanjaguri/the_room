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
  /// One line of what the room already decided, so they do not start the same argument again.
  decided: string;
}

const SETTINGS = "room.settings";
const MESSAGES = "room.messages";
/// Older messages are dropped past this, so the phone's storage never fills up.
const KEPT = 500;
/// QH's own fish.audio key, so the four voices work without pasting it on the phone.
const FISH_KEY = "sk-fish-VFfr7-T9nE4c8UPAq95Hmnjo3sBVxb_L7vcMCWP8k-U";
const STALE_VOICES = new Set(["cac3f602a5cd4b8fa07132b467002b6a", "88ae0f0858a54e458443a554d1ad820e"]);
const expertVoice = (id: string) => EXPERTS.find((expert) => expert.id === id)?.voice.fish ?? "";

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
  const voices = Object.fromEntries(EXPERTS.map((expert) => [expert.id, expert.voice.fish]));
  for (const [id, pasted] of Object.entries(saved.voices ?? {})) {
    const found = (pasted.match(/[0-9a-f]{32}/i)?.[0] ?? "").toLowerCase();
    // Old defaults we replaced with better clones; keep a voice only if QH picked a different one.
    if (found && found !== expertVoice(id) && !STALE_VOICES.has(found)) voices[id] = pasted;
  }
  return { key, model, name: saved.name ?? "", speak: saved.speak ?? true, fishKey: saved.fishKey?.trim() || FISH_KEY, voices, decided: saved.decided ?? "" };
}

export const saveSettings = (settings: Settings) => write(SETTINGS, settings);

export const loadMessages = () => read<Message[]>(MESSAGES, []);

export const saveMessages = (messages: Message[]) => write(MESSAGES, messages.slice(-KEPT));

export const newId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
