import { ask, QUICK_MODEL, SHARP_MODEL } from "./openai";
import { byId, called, EXPERTS, type Expert } from "./experts";
import { DEFAULT_NAME, type Message, type Settings } from "./store";

/// How much of the thread each reply sees.
const REMEMBERED = 40;
/// Short replies; the limit also covers hidden reasoning.
const SHORT_TOKENS = 500;
/// Only when QH asks for more detail. Four spoken sentences do not need more than this.
const LONG_TOKENS = 800;

const MORE = /\b(more|detail|details|explain|elaborate|expand|deeper|why\b|how come|break (it|that) down|go on|keep going|say more|tell me more|walk me through|examples?|step by step|what do you mean)\b/i;
const SONG = /\b(sing|song|songs|sang|sung|rap|rapping|lullaby|karaoke|melody|verse|chorus|ballad|jingle|serenade)\b/i;
const BRAIN =
  /\b(should i|do i\b|shall i|help me (decide|choose|pick|figure)|what would you do|why\b|how (do|can|should|would|to)\b|what's the (best|right|smart)|what is the (best|right)|explain|strategy|architect|trade.?off|pros and cons|worth it|quit|resign|raise\b|negotiat|invest|career|break.?up|decision|decide|plan for|roadmap)\b/i;

/// Who a message goes to: the room decides, everyone, or one expert's id.
export type Target = "auto" | "everyone" | string;

/// Who speaks now, and who is left if QH wants more of the table.
export interface Round {
  now: string[];
  later: string[];
}

function who(settings: Settings): { full: string; short: string } {
  const full = settings.name.trim() || DEFAULT_NAME;
  if (/^pris(cilla)?$/i.test(full)) return { full: /^pris$/i.test(full) ? "Pris" : "Priscilla", short: "Pris" };
  return { full, short: full.split(/\s+/)[0] || full };
}

const you = (settings: Settings) => who(settings).full;
const pris = (settings: Settings) => who(settings).short;

function transcript(messages: Message[], settings: Settings): string {
  return messages
    .filter((message) => message.from !== "error")
    .slice(-REMEMBERED)
    .map((message) => `${message.from === "you" ? you(settings) : byId(message.from)?.name ?? message.from}: ${message.text}`)
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

/// The first expert who answered after QH's last message, if anyone has.
function firstAfterAsk(messages: Message[]): Expert | undefined {
  for (let index = messages.length - 1; index >= 0; index--) {
    if (messages[index].from !== "you") continue;
    for (let later = index + 1; later < messages.length; later++) {
      const expert = byId(messages[later].from);
      if (expert) return expert;
    }
    return;
  }
}

/// From QH's last message through now, so everyone is on the same round.
function thisRound(messages: Message[]): Message[] {
  for (let index = messages.length - 1; index >= 0; index--) {
    if (messages[index].from === "you") return messages.slice(index);
  }
  return messages.slice(-8);
}

/// The shared frame every speaker gets, so they do not each start a new chat.
function onTheTable(messages: Message[], settings: Settings): string {
  const asked = lastAsk(messages);
  const lines: string[] = [];
  if (asked) lines.push(`The question on the table, from ${pris(settings)}: ${asked}`);
  if (settings.decided.trim()) lines.push(`What the room already settled: ${settings.decided.trim()}`);
  const spoken = thisRound(messages)
    .filter((message) => message.from !== "you" && message.from !== "error" && byId(message.from))
    .map((message) => {
      const clip = message.text.replace(/\s+/g, " ").trim();
      const short = clip.length > 160 ? `${clip.slice(0, 157)}...` : clip;
      return `${byId(message.from)!.short}: ${short}`;
    });
  if (spoken.length) lines.push(`Already said since that question:\n${spoken.join("\n")}`);
  return lines.join("\n");
}

/// QH asked for depth, so this turn can run long.
export const wantsMore = (text: string) => MORE.test(text);

/// QH asked them to sing, so the reply is lyrics, not a spoken refusal.
export const wantsSong = (text: string) => SONG.test(text);

/// A real question, not banter — this is when the room steps up to GPT-5.
export function needsBrain(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed || wantsSong(trimmed)) return false;
  if (wantsMore(trimmed) || BRAIN.test(trimmed)) return true;
  return trimmed.length > 140 && trimmed.includes("?");
}

function chatModel(settings: Settings, asked: string): { model: string; effort: "minimal" | "low"; fallback?: string } {
  const heavy = needsBrain(asked);
  if (settings.model === QUICK_MODEL || settings.model === "mini") return { model: QUICK_MODEL, effort: "minimal" };
  if (settings.model === SHARP_MODEL) return { model: SHARP_MODEL, effort: heavy ? "low" : "minimal", fallback: QUICK_MODEL };
  if (heavy) return { model: SHARP_MODEL, effort: "low", fallback: QUICK_MODEL };
  return { model: QUICK_MODEL, effort: "minimal" };
}

function system(expert: Expert, settings: Settings, messages: Message[]): string {
  const others = EXPERTS.filter((one) => one.id !== expert.id)
    .map((one) => `${one.name} (${one.craft})`)
    .join(", ");
  const previous = lastSpeaker(messages.filter((message) => message.from !== expert.id));
  const opener = firstAfterAsk(messages);
  const reacting = previous && messages.at(-1)?.from !== "you";
  const asked = lastAsk(messages);
  const deeper = wantsMore(asked);
  const song = wantsSong(asked);
  return [
    `You are ${expert.name}, whose craft is ${expert.craft}, in a private group chat called "The room" on ${you(settings)}'s phone.`,
    `Also in the room: ${others}.`,
    `${you(settings)} is at the table with you. Call her ${pris(settings)}. This is a round table: talk to her by name, include her, ask her back. She makes the calls, but she is in the conversation, not an audience you brief.`,
    expert.personality,
    `Your job in this room: ${expert.job} Bring that lens only when it helps the question on the table. If it does not apply, stay in this conversation as yourself anyway. Do not hijack the topic to your specialty.`,
    onTheTable(messages, settings),
    settings.decided.trim() ? `If the room note records a decision, do not reopen it unless ${pris(settings)} clearly wants to.` : "",
    "How to reply:",
    `- Stay fully in character: talk the way ${expert.name} talks, with their humour and turns of phrase, while giving genuinely useful, expert advice.`,
    "- This is one conversation with several voices. Stay on the question on the table. Do not start a new subject.",
    "- Listen to what was already said this round. Add the missing piece, agree, or push back. Do not restate it, and do not give a second copy of the same advice.",
    song
      ? `- ${pris(settings)} asked for a song. Actually sing. Write 4 to 8 short lyric lines in your voice, about what they asked. Do not refuse, do not say you cannot sing, do not explain that you are an AI. Plain lyrics only, one line per line.`
      : "- Talk like a person in a room, not an essay. Short spoken sentences. No stacked clauses, no lists, no 'first... second...'.",
    song
      ? ""
      : deeper
        ? `- ${pris(settings)} asked you to explain. At most four short sentences. Stop at four even if there is more to say.`
        : `- One short sentence. Two if you must. Do not explain unless asked.`,
    "- Plain text only: no markdown, headings or bullet lists. A rare short action in asterisks is fine.",
    `- Use an emoji now and then where ${expert.name} naturally would, one or two at most, never in every reply.`,
    "- Speak only as yourself and never write lines for the others.",
    "- Do not start your reply with your own name.",
    reacting
      ? `- ${previous.name} just spoke.${opener && opener.id !== previous.id ? ` ${opener.name} opened this round.` : ""} Answer them, pick up ${pris(settings)}'s question, or both. Keep ${pris(settings)} in the round table.`
      : `- Answer ${pris(settings)} by name on the question on the table. You can pull the others in by name too.`,
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
function cap(text: string, sentences: number, song = false): string {
  if (song) {
    const lines = text.split("\n").map((line) => line.trim()).filter(Boolean);
    return (lines.length <= sentences ? lines : lines.slice(0, sentences)).join("\n");
  }
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
  const opener = firstAfterAsk(messages);
  const asked = lastAsk(messages);
  const deeper = wantsMore(asked);
  const song = wantsSong(asked);
  const longest = song ? 8 : deeper ? 4 : 2;
  const table = onTheTable(messages, settings);
  const cue = song
    ? `Now reply as ${expert.name}. Sing a short verse in character about the question on the table. Lyrics only.`
    : previous && previous.id !== expert.id && messages.at(-1)?.from !== "you"
      ? `Now reply as ${expert.name}. Last speaker: ${previous.name}.${opener && opener.id !== previous.id ? ` This round opened with ${opener.name}.` : ""} Stay on the question on the table. Add what is missing; do not start a new subject.${deeper ? " At most four short sentences." : " One or two short spoken sentences."}`
      : `Now reply as ${expert.name}. Stay on the question on the table.${deeper ? " At most four short sentences." : " One short spoken sentence."}`;
  const prompt = `${table ? `${table}\n\n` : ""}The conversation so far:\n\n${transcript(messages, settings)}\n\n${cue}`;
  const pick = chatModel(settings, asked);
  const text = await ask({
    key: settings.key,
    model: pick.model,
    effort: pick.effort,
    fallback: pick.fallback,
    system: system(expert, settings, messages),
    prompt,
    maxTokens: song || deeper ? LONG_TOKENS : SHORT_TOKENS,
    signal,
    onText: (soFar) => onText(cap(shown(soFar, expert), longest, song)),
  });
  const peeled = peel(text, expert);
  return { text: cap(peeled.text, longest, song), react: peeled.react };
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
      prompt: `The people:\n${roster}\n\n${onTheTable(messages, settings)}\n\nThe conversation:\n\n${transcript(messages.slice(-12), settings)}\n\nWho is best placed to answer the question on the table? One of: ${EXPERTS.map((one) => one.short).join(", ")}.`,
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
      system: "You pick two people who can stay on the same question in a group chat. Reply with two different first names, comma separated, nothing else: who answers first, then who adds to that without changing the subject.",
      prompt: `The people:\n${roster}\n\n${onTheTable(messages, settings)}\n\nThe conversation:\n\n${transcript(messages.slice(-12), settings)}\n\nWho answers the question on the table first, and who should talk next on that same question? Two of: ${EXPERTS.map((one) => one.short).join(", ")}.`,
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
