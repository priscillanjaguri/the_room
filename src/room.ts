import { ask, QUICK_MODEL } from "./openai";
import { byId, called, EXPERTS, type Expert } from "./experts";
import type { Message, Settings } from "./store";

/// How much of the thread each reply sees.
const REMEMBERED = 40;
/// Generous, because the limit also covers the model's hidden reasoning; the prompt keeps replies short.
const REPLY_TOKENS = 1500;

/// Who a message goes to: the room decides, everyone, or one expert's id.
export type Target = "auto" | "everyone" | string;

/// Who speaks now, and who is left if QH wants more of the table.
export interface Round {
  now: string[];
  later: string[];
}

const you = (settings: Settings) => settings.name.trim() || "the person who runs this room";

function transcript(messages: Message[], settings: Settings): string {
  return messages
    .filter((message) => message.from !== "error")
    .slice(-REMEMBERED)
    .map((message) => `${message.from === "you" ? settings.name.trim() || "You (the coordinator)" : byId(message.from)?.name ?? message.from}: ${message.text}`)
    .join("\n\n");
}

/// The last expert who spoke in this thread, if anyone has.
function lastSpeaker(messages: Message[]): Expert | undefined {
  for (let index = messages.length - 1; index >= 0; index--) {
    const expert = byId(messages[index].from);
    if (expert) return expert;
  }
}

function system(expert: Expert, settings: Settings, messages: Message[]): string {
  const others = EXPERTS.filter((one) => one.id !== expert.id)
    .map((one) => `${one.name} (${one.craft})`)
    .join(", ");
  const previous = lastSpeaker(messages.filter((message) => message.from !== expert.id));
  const reacting = previous && messages.at(-1)?.from !== "you";
  return [
    `You are ${expert.name}, whose craft is ${expert.craft}, in a private group chat called "The room" on ${you(settings)}'s phone.`,
    `Also in the room: ${others}. ${you(settings)} runs the meeting and makes the calls.`,
    expert.personality,
    `Your job in this room: ${expert.job} Stay in that lane. Do not do the others' jobs.`,
    settings.decided.trim() ? `The room's current note: ${settings.decided.trim()} If this records a decision, do not reopen it unless ${you(settings)} clearly wants to.` : "",
    "How to reply:",
    `- Stay fully in character: talk the way ${expert.name} talks, with their humour and turns of phrase, while giving genuinely useful, expert advice.`,
    "- This is a phone chat. Two to four short sentences. No speeches.",
    "- Plain text only: no markdown, headings or bullet lists. A rare short action in asterisks is fine.",
    `- Use an emoji now and then where ${expert.name} naturally would, one or two at most, never in every reply.`,
    "- Speak only as yourself and never write lines for the others.",
    "- Do not start your reply with your own name.",
    reacting
      ? `- The last person to speak was ${previous.name}. Talk to them by name. Agree, steal the point, or push back. Do not repeat what they just said, and do not give ${you(settings)} a second copy of the same advice.`
      : `- Answer ${you(settings)}. You can mention the others by name if you want them to come in.`,
  ]
    .filter(Boolean)
    .join("\n");
}

/// Strips a "Name:" the model sometimes puts in front of its own reply.
function clean(text: string, expert: Expert): string {
  const prefix = new RegExp(`^\\s*(${expert.name}|${expert.short}|Captain ${expert.short}|Captain Jack Sparrow)\\s*:\\s*`, "i");
  return text.replace(prefix, "").trim();
}

/// One expert's reply to the thread so far, streamed through `onText`.
export async function reply(expert: Expert, messages: Message[], settings: Settings, signal: AbortSignal, onText: (text: string) => void): Promise<string> {
  const previous = lastSpeaker(messages);
  const cue =
    previous && previous.id !== expert.id && messages.at(-1)?.from !== "you"
      ? `Now reply as ${expert.name} to ${previous.name}. Talk to them, not past them.`
      : `Now reply as ${expert.name}.`;
  const prompt = `The conversation so far:\n\n${transcript(messages, settings)}\n\n${cue}`;
  const text = await ask({ key: settings.key, model: settings.model, system: system(expert, settings, messages), prompt, maxTokens: REPLY_TOKENS, signal, onText: (soFar) => onText(clean(soFar, expert)) });
  return clean(text, expert);
}

function namesIn(text: string): string[] {
  const named = called(text);
  return named === "everyone" ? [] : named;
}

/// The one expert best placed to answer, chosen by the quick model; the least recent speaker if
/// that fails, so the room never stalls on the choice.
async function best(messages: Message[], settings: Settings, signal: AbortSignal): Promise<string> {
  const fallback = () => {
    const spoken = messages.map((message) => message.from);
    return [...EXPERTS].sort((a, b) => spoken.lastIndexOf(a.id) - spoken.lastIndexOf(b.id))[0].id;
  };
  try {
    const roster = EXPERTS.map((one) => `${one.short}: ${one.craft}. Job: ${one.job}`).join("\n");
    const text = await ask({
      key: settings.key,
      model: QUICK_MODEL,
      system: "You pick who answers next in a group chat. Reply with exactly one first name and nothing else.",
      prompt: `The people:\n${roster}\n\nThe conversation:\n\n${transcript(messages.slice(-12), settings)}\n\nWho is best placed to answer the last message? One of: ${EXPERTS.map((one) => one.short).join(", ")}.`,
      maxTokens: 200,
      signal,
    });
    const named = namesIn(text);
    return named[0] ?? fallback();
  } catch (error) {
    if (signal.aborted) throw error;
    return fallback();
  }
}

/// Two different people: who answers first, then who talks back to them.
async function pair(messages: Message[], settings: Settings, signal: AbortSignal): Promise<string[]> {
  const first = await best(messages, settings, signal);
  const fallback = () => {
    const spoken = messages.map((message) => message.from);
    const second = [...EXPERTS].filter((one) => one.id !== first).sort((a, b) => spoken.lastIndexOf(a.id) - spoken.lastIndexOf(b.id))[0].id;
    return [first, second];
  };
  try {
    const roster = EXPERTS.map((one) => `${one.short}: ${one.job}`).join("\n");
    const text = await ask({
      key: settings.key,
      model: QUICK_MODEL,
      system: "You pick two people for a short group-chat round. Reply with two different first names, comma separated, nothing else: who answers first, then who talks back to them.",
      prompt: `The people:\n${roster}\n\nThe conversation:\n\n${transcript(messages.slice(-12), settings)}\n\nFirst name already chosen to open: ${byId(first)?.short}. Who should talk back to them? One of: ${EXPERTS.filter((one) => one.id !== first).map((one) => one.short).join(", ")}.`,
      maxTokens: 200,
      signal,
    });
    const second = namesIn(text).find((id) => id !== first);
    return second ? [first, second] : fallback();
  } catch (error) {
    if (signal.aborted) throw error;
    return fallback();
  }
}

const restOf = (spoken: string[]) => EXPERTS.map((one) => one.id).filter((id) => !spoken.includes(id));

/// The experts who answer a message, in order. Auto is a two-person round; the rest wait behind
/// "Anyone else". Naming someone brings only them in, so you can jump in on the last speaker.
export async function speakers(target: Target, text: string, messages: Message[], settings: Settings, signal: AbortSignal): Promise<Round> {
  if (target === "everyone" || called(text) === "everyone") {
    const first = await best(messages, settings, signal);
    const now = [first, ...restOf([first])];
    return { now, later: [] };
  }
  if (target !== "auto") return { now: [target], later: [] };
  const named = called(text);
  if (Array.isArray(named) && named.length) return { now: named, later: restOf(named) };
  const now = await pair(messages, settings, signal);
  return { now, later: restOf(now) };
}

/// A one-line note of what the room has decided or still has open, so the next round does not start over.
export async function note(messages: Message[], settings: Settings, signal: AbortSignal): Promise<string> {
  const text = await ask({
    key: settings.key,
    model: QUICK_MODEL,
    system: "You keep a one-line note for a group chat. No names. If they decided something, state the decision. If not, state the open question. One sentence, nothing else.",
    prompt: `Current note:\n${settings.decided.trim() || "(none)"}\n\nConversation:\n\n${transcript(messages.slice(-16), settings)}\n\nUpdate the note.`,
    maxTokens: 200,
    signal,
  });
  return text.replace(/\s+/g, " ").trim().slice(0, 220);
}
