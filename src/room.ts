import { ask, QUICK_MODEL } from "./openai";
import { byId, called, EXPERTS, type Expert } from "./experts";
import type { Message, Settings } from "./store";

/// How much of the thread each reply sees.
const REMEMBERED = 40;
/// Generous, because the limit also covers the model's hidden reasoning; the prompt keeps replies short.
const REPLY_TOKENS = 1500;

/// Who a message goes to: the room decides, everyone, or one expert's id.
export type Target = "auto" | "everyone" | string;

const you = (settings: Settings) => settings.name.trim() || "the person who runs this room";

function transcript(messages: Message[], settings: Settings): string {
  return messages
    .filter((message) => message.from !== "error")
    .slice(-REMEMBERED)
    .map((message) => `${message.from === "you" ? settings.name.trim() || "You (the coordinator)" : byId(message.from)?.name ?? message.from}: ${message.text}`)
    .join("\n\n");
}

function system(expert: Expert, settings: Settings): string {
  const others = EXPERTS.filter((one) => one.id !== expert.id)
    .map((one) => `${one.name} (${one.craft})`)
    .join(", ");
  return [
    `You are ${expert.name}, whose craft is ${expert.craft}, in a private group chat called "The room" on ${you(settings)}'s phone.`,
    `Also in the room: ${others}. ${settings.name.trim() || "The person messaging you"} runs the meeting and makes the calls.`,
    expert.personality,
    "How to reply:",
    `- Stay fully in character: talk the way ${expert.name} talks, with their humour and turns of phrase, while giving genuinely useful, expert advice.`,
    "- This is a phone chat. Keep it to two to four short sentences unless you are asked for more.",
    "- Plain text only: no markdown, headings or bullet lists. A rare short action in asterisks is fine.",
    "- Speak only as yourself and never write lines for the others. You can agree with, challenge or answer the others by name.",
    "- Do not start your reply with your own name.",
  ].join("\n");
}

/// Strips a "Name:" the model sometimes puts in front of its own reply.
function clean(text: string, expert: Expert): string {
  const prefix = new RegExp(`^\\s*(${expert.name}|${expert.short}|Captain ${expert.short}|Captain Jack Sparrow)\\s*:\\s*`, "i");
  return text.replace(prefix, "").trim();
}

/// One expert's reply to the thread so far, streamed through `onText`.
export async function reply(expert: Expert, messages: Message[], settings: Settings, signal: AbortSignal, onText: (text: string) => void): Promise<string> {
  const prompt = `The conversation so far:\n\n${transcript(messages, settings)}\n\nNow reply as ${expert.name}.`;
  const text = await ask({ key: settings.key, model: settings.model, system: system(expert, settings), prompt, maxTokens: REPLY_TOKENS, signal, onText: (soFar) => onText(clean(soFar, expert)) });
  return clean(text, expert);
}

/// The one expert best placed to answer, chosen by the quick model; the least recent speaker if
/// that fails, so the room never stalls on the choice.
async function best(messages: Message[], settings: Settings, signal: AbortSignal): Promise<string> {
  const fallback = () => {
    const spoken = messages.map((message) => message.from);
    return [...EXPERTS].sort((a, b) => spoken.lastIndexOf(a.id) - spoken.lastIndexOf(b.id))[0].id;
  };
  try {
    const roster = EXPERTS.map((one) => `${one.short}: ${one.craft}`).join("\n");
    const text = await ask({
      key: settings.key,
      model: QUICK_MODEL,
      system: "You pick who answers next in a group chat. Reply with exactly one first name and nothing else.",
      prompt: `The people:\n${roster}\n\nThe conversation:\n\n${transcript(messages.slice(-12), settings)}\n\nWho is best placed to answer the last message? One of: ${EXPERTS.map((one) => one.short).join(", ")}.`,
      maxTokens: 200,
      signal,
    });
    const named = called(text);
    return Array.isArray(named) && named.length ? named[0] : fallback();
  } catch (error) {
    if (signal.aborted) throw error;
    return fallback();
  }
}

/// The experts who answer a message, in order.
export async function speakers(target: Target, text: string, messages: Message[], settings: Settings, signal: AbortSignal): Promise<string[]> {
  if (target === "everyone") return EXPERTS.map((one) => one.id);
  if (target !== "auto") return [target];
  const named = called(text);
  if (named === "everyone") return EXPERTS.map((one) => one.id);
  if (named.length) return named;
  return [await best(messages, settings, signal)];
}
