import { ask, QUICK_MODEL } from "./openai";
import { byId, called, EXPERTS, type Expert } from "./experts";
import type { Message, Settings } from "./store";

/// How much of the thread each reply sees.
const REMEMBERED = 40;
/// Short replies; the limit also covers hidden reasoning.
const SHORT_TOKENS = 500;
/// Only when QH asks for more detail. Four spoken sentences do not need more than this.
const LONG_TOKENS = 800;

const MORE = /\b(more|detail|details|explain|elaborate|expand|deeper|why\b|how come|break (it|that) down|go on|keep going|say more|tell me more|walk me through|examples?|step by step|what do you mean)\b/i;

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

function lastAsk(messages: Message[]): string {
  for (let index = messages.length - 1; index >= 0; index--) {
    if (messages[index].from === "you") return messages[index].text;
  }
  return "";
}

/// QH asked for depth, so this turn can run long.
export const wantsMore = (text: string) => MORE.test(text);

function system(expert: Expert, settings: Settings, messages: Message[]): string {
  const others = EXPERTS.filter((one) => one.id !== expert.id)
    .map((one) => `${one.name} (${one.craft})`)
    .join(", ");
  const previous = lastSpeaker(messages.filter((message) => message.from !== expert.id));
  const reacting = previous && messages.at(-1)?.from !== "you";
  const deeper = wantsMore(lastAsk(messages));
  return [
    `You are ${expert.name}, whose craft is ${expert.craft}, in a private group chat called "The room" on ${you(settings)}'s phone.`,
    `Also in the room: ${others}. ${you(settings)} runs the meeting and makes the calls.`,
    expert.personality,
    `Your job in this room: ${expert.job} Stay in that lane. Do not do the others' jobs.`,
    settings.decided.trim() ? `The room's current note: ${settings.decided.trim()} If this records a decision, do not reopen it unless ${you(settings)} clearly wants to.` : "",
    "How to reply:",
    `- Stay fully in character: talk the way ${expert.name} talks, with their humour and turns of phrase, while giving genuinely useful, expert advice.`,
    "- Talk like a person in a room, not an essay. Short spoken sentences. No stacked clauses, no lists, no 'first... second...'.",
    deeper
      ? `- ${you(settings)} asked you to explain. At most four short sentences. Stop at four even if there is more to say.`
      : `- One short sentence. Two if you must. Do not explain unless asked.`,
    "- Plain text only: no markdown, headings or bullet lists. A rare short action in asterisks is fine.",
    `- Use an emoji now and then where ${expert.name} naturally would, one or two at most, never in every reply.`,
    "- Speak only as yourself and never write lines for the others.",
    "- Do not start your reply with your own name.",
    reacting
      ? `- The last person to speak was ${previous.name}. Talk to them by name. Agree, steal the point, or push back. Do not repeat what they just said, and do not give ${you(settings)} a second copy of the same advice.${deeper ? "" : " One line is enough."}`
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

/// Hard cap so a long-winded reply cannot run past the spoken length we asked for.
function cap(text: string, sentences: number): string {
  const parts = text.split(/(?<=[.!?])\s+/).filter(Boolean);
  return (parts.length <= sentences ? parts : parts.slice(0, sentences)).join(" ").trim();
}

/// Pulls the WhatsApp reaction off the first line so it never gets spoken or shown as chat.
function peel(raw: string, expert: Expert): { text: string; react: string | null } {
  const cleaned = clean(raw, expert);
  const lines = cleaned.split("\n");
  const match = lines[0]?.trim().match(/^REACT\s+(laugh|sad|up|down|party|none)\.?$/i);
  if (!match) return { text: cleaned, react: null };
  const id = match[1].toLowerCase();
  return { text: lines.slice(1).join("\n").trim(), react: id === "none" ? null : id };
}

/// The spoken part only, so a half-typed REACT line does not flash on screen.
function shown(raw: string, expert: Expert): string {
  const cleaned = clean(raw, expert);
  if (!/^REACT\b/i.test(cleaned)) return cleaned;
  const breakAt = cleaned.indexOf("\n");
  return breakAt < 0 ? "" : cleaned.slice(breakAt + 1).trim();
}

export interface Said {
  text: string;
  /// laugh, sad, up, down, party — or null if they let it pass.
  react: string | null;
}

/// One expert's reply to the thread so far, streamed through `onText`.
export async function reply(expert: Expert, messages: Message[], settings: Settings, signal: AbortSignal, onText: (text: string) => void): Promise<Said> {
  const previous = lastSpeaker(messages);
  const deeper = wantsMore(lastAsk(messages));
  const longest = deeper ? 4 : 2;
  const cue =
    previous && previous.id !== expert.id && messages.at(-1)?.from !== "you"
      ? `Now reply as ${expert.name} to ${previous.name}. Talk to them, not past them.${deeper ? " At most four short sentences." : " One short spoken sentence."}`
      : `Now reply as ${expert.name}.${deeper ? " At most four short sentences." : " One short spoken sentence."}`;
  const prompt = `The conversation so far:\n\n${transcript(messages, settings)}\n\n${cue}`;
  const text = await ask({
    key: settings.key,
    model: settings.model,
    system: system(expert, settings, messages),
    prompt,
    maxTokens: deeper ? LONG_TOKENS : SHORT_TOKENS,
    signal,
    onText: (soFar) => onText(cap(shown(soFar, expert), longest)),
  });
  const peeled = peel(text, expert);
  return { text: cap(peeled.text, longest), react: peeled.react };
}

const FEEL = /\b(laugh|sad|up|down|party|none)\b/i;

/// Who in the room taps a WhatsApp reaction on this bubble. Any subset, including nobody.
export async function feelings(message: Message, messages: Message[], settings: Settings, signal: AbortSignal): Promise<{ from: string; react: string }[]> {
  const others = EXPERTS.filter((one) => one.id !== message.from);
  if (!others.length || message.from === "error") return [];
  const who = message.from === "you" ? you(settings) : byId(message.from)?.name ?? message.from;
  try {
    const text = await ask({
      key: settings.key,
      model: QUICK_MODEL,
      system:
        "You pick WhatsApp reactions for a group chat. Not everyone reacts. One, two, or none is normal. All four is rare. Each person who would sit it out says none. Reply with one line per person: Name laugh, Name sad, Name up, Name down, Name party, or Name none. Nothing else.",
      prompt: `The people who can react:\n${others.map((one) => `${one.short}: ${one.craft}`).join("\n")}\n\n${who} just said:\n${message.text}\n\nRecent chat:\n${transcript(messages.slice(-8), settings)}\n\nWho actually taps an emoji?`,
      maxTokens: 80,
      signal,
    });
    const picked: { from: string; react: string }[] = [];
    const seen = new Set<string>();
    for (const line of text.split("\n")) {
      const id = namesIn(line)[0];
      const react = line.match(FEEL)?.[1]?.toLowerCase();
      if (!id || !react || react === "none" || id === message.from || seen.has(id)) continue;
      if (!others.some((one) => one.id === id)) continue;
      seen.add(id);
      picked.push({ from: id, react });
    }
    return picked;
  } catch (error) {
    if (signal.aborted) throw error;
    return [];
  }
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
      maxTokens: 80,
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
  const fallback = (first?: string) => {
    const spoken = messages.map((message) => message.from);
    const ordered = [...EXPERTS].sort((a, b) => spoken.lastIndexOf(a.id) - spoken.lastIndexOf(b.id));
    const one = first ?? ordered[0].id;
    const two = ordered.find((expert) => expert.id !== one)!.id;
    return [one, two];
  };
  try {
    const roster = EXPERTS.map((one) => `${one.short}: ${one.job}`).join("\n");
    const text = await ask({
      key: settings.key,
      model: QUICK_MODEL,
      system: "You pick two people for a short group-chat round. Reply with two different first names, comma separated, nothing else: who answers first, then who talks back to them.",
      prompt: `The people:\n${roster}\n\nThe conversation:\n\n${transcript(messages.slice(-12), settings)}\n\nWho answers first, and who talks back? Two of: ${EXPERTS.map((one) => one.short).join(", ")}.`,
      maxTokens: 80,
      signal,
    });
    const named = [...new Set(namesIn(text))];
    if (named.length >= 2) return named.slice(0, 2);
    if (named.length === 1) return fallback(named[0]);
    return fallback();
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
  if (Array.isArray(named) && named.length) return { now: named, later: [] };
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
