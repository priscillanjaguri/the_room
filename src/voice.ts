import { Capacitor, registerPlugin } from "@capacitor/core";
import type { Expert } from "./experts";
import { Offline, post } from "./net";
import { BrainError } from "./openai";
import type { Settings } from "./store";

const Mic = registerPlugin<{ ask(): Promise<void>; settings(): Promise<void> }>("Mic");

/// Asks Android for the microphone before the page tries to record. Old APKs don't have this
/// plugin, so those fail with "unimplemented" and we tell the person to install the new app.
export async function prepareMic(): Promise<"ok" | "old" | "denied"> {
  if (!Capacitor.isNativePlatform()) return "ok";
  try {
    await Mic.ask();
    return "ok";
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === "UNIMPLEMENTED" || code === "unimplemented") return "old";
    return "denied";
  }
}

export const openMicSettings = () => Mic.settings().catch(() => {});

const OPENAI_SPEECH = "https://api.openai.com/v1/audio/speech";
const OPENAI_HEARING = "https://api.openai.com/v1/audio/transcriptions";
const SPEECH_MODEL = "gpt-4o-mini-tts";
const HEARING_MODEL = "gpt-4o-mini-transcribe";
const FISH_SPEECH = "https://api.fish.audio/v1/tts";
/// fish.audio's free tier of its newest voice model, the one Gleam uses: it needs no API credit.
const FISH_MODEL = "s2.1-pro-free";
/// A runaway reply is tiring in the ear; past this we stop on a sentence end.
const LONGEST_SPOKEN = 900;

/// The words a voice should read: no emojis, no asterisks around actions. Speaks the whole
/// finished reply, and never starts a sentence it cannot finish.
/// Turns a written *burp* into a small burp cue — not a belch, and never the spoken word.
function withBurps(text: string): string {
  return text.replace(/\[(?:short |small )?burps?ing?\]|\*burps?\*|\(burps?\)|\bbelch(?:es|ed|ing)?\b|\bburps?\b/gi, " [short burp] ");
}

export function forSpeech(text: string, sing = false): string {
  const prepared = sing ? text : withBurps(text);
  const spoken = prepared
    .replace(/[\p{Extended_Pictographic}\u{1F1E6}-\u{1F1FF}\u{FE0F}\u{200D}\u{20E3}]/gu, "")
    .replace(/\*/g, "")
    .replace(sing ? /[^\S\n]+/g : /\s+/g, " ")
    .trim();
  if (!spoken) return "";
  if (sing) return spoken.length > LONGEST_SPOKEN ? spoken.slice(0, LONGEST_SPOKEN).trim() : spoken;
  const parts = spoken.split(/(?<=[.!?])\s+/).filter(Boolean);
  const finished = parts.filter((part, index) => /[.!?]$/.test(part) || index === parts.length - 1);
  let out = finished.join(" ");
  if (out.length > LONGEST_SPOKEN) {
    out = out.slice(0, LONGEST_SPOKEN);
    const stop = Math.max(out.lastIndexOf(". "), out.lastIndexOf("! "), out.lastIndexOf("? "));
    if (stop > 0) out = out.slice(0, stop + 1).trim();
  }
  return out;
}

/// A fish.audio voice id is 32 hex characters; people paste the voice page's link as often as the
/// id, so the id is found inside whatever was pasted.
export function fishVoiceIn(pasted: string): string {
  return (pasted.match(/[0-9a-f]{32}/i)?.[0] ?? "").toLowerCase();
}

const fishVoice = (expert: Expert, settings: Settings) => (settings.fishKey.trim() ? fishVoiceIn(settings.voices[expert.id] || expert.voice.fish) : "");

function speechProblem(service: "OpenAI" | "fish.audio", status: number, body: unknown): BrainError {
  const error = (body as { error?: { message?: string; code?: string }; message?: string } | null) ?? null;
  const detail = error?.error?.message ?? error?.message ?? "";
  if (status === 401) return new BrainError(`${service} refused the key, so ${service === "OpenAI" ? "nobody can speak" : "fish.audio voices are off"}. Check it in Settings.`);
  if (status === 402) return new BrainError("fish.audio has no API credit left. Add some at fish.audio, or clear the voice link to use OpenAI's voice.");
  if (error?.error?.code === "insufficient_quota") return new BrainError("Your OpenAI credit has run out, so voices are off. Add credit at platform.openai.com.");
  if (status === 429) return new BrainError(`${service} is getting too many requests. Voices will be back in a moment.`);
  return new BrainError(detail ? `${service} could not speak: ${detail}` : `${service} could not speak (error ${status}).`);
}

/// One reply read aloud in the expert's voice: their fish.audio voice when they have one, OpenAI's
/// voice with their speaking style otherwise. Returns the audio.
export async function say(text: string, expert: Expert, settings: Settings, signal?: AbortSignal, laugh = false, sing = false): Promise<Blob> {
  const spoken = forSpeech(text, sing);
  if (!spoken) throw new BrainError("Nothing to read aloud.");
  const fish = fishVoice(expert, settings);
  const service = fish ? "fish.audio" : "OpenAI";
  const line = sing ? `[singing] ${spoken}` : laugh ? `[laughing] ${spoken}` : spoken;
  const burp = /\[short burp\]/.test(spoken);
  const instructions = sing
    ? `${expert.voice.style} Sing these lyrics as a short song with a clear melody. Do not speak them as prose.`
    : laugh
      ? `${expert.voice.style} Start with a short laugh, then speak.${burp ? " When you see [short burp], make a small burp, not a belch. Never say the word burp." : ""}`
      : burp
        ? `${expert.voice.style} When you see [short burp], make a small burp, not a belch. Never say the word burp.`
        : expert.voice.style;
  try {
    const answer = fish
      ? await post({
          url: FISH_SPEECH,
          headers: { authorization: `Bearer ${settings.fishKey.trim()}`, model: FISH_MODEL },
          json: { text: line, format: "mp3", mp3_bitrate: 192, latency: "low", temperature: 0.78, reference_id: fish },
          want: "blob",
          signal,
        })
      : await post({
          url: OPENAI_SPEECH,
          headers: { authorization: `Bearer ${settings.key}` },
          json: { model: SPEECH_MODEL, voice: expert.voice.openai, input: spoken, instructions, response_format: "mp3" },
          want: "blob",
          signal,
        });
    if (!answer.blob || answer.blob.size === 0) throw speechProblem(service, answer.status, answer.json);
    return answer.blob;
  } catch (error) {
    if (error instanceof Offline) throw new BrainError(`No connection to ${service}, so this one stays silent.`);
    throw error;
  }
}

/// What was said in a recording, as text.
export async function hear(recording: Blob, settings: Settings): Promise<string> {
  const kind = recording.type.includes("mp4") ? "mp4" : recording.type.includes("ogg") ? "ogg" : "webm";
  try {
    const answer = await post({
      url: OPENAI_HEARING,
      headers: { authorization: `Bearer ${settings.key}` },
      form: [
        { name: "model", value: HEARING_MODEL },
        { name: "file", file: recording, fileName: `speech.${kind}` },
      ],
      want: "json",
    });
    const reply = answer.json as { text?: string; error?: { message?: string } } | null;
    if (answer.status === 401) throw new BrainError("OpenAI refused the key, so the mic cannot listen. Check it in Settings.");
    if (answer.status < 200 || answer.status >= 300) throw new BrainError(reply?.error?.message ? `Could not hear that: ${reply.error.message}` : `Could not hear that (error ${answer.status}).`);
    return (reply?.text ?? "").trim();
  } catch (error) {
    if (error instanceof Offline) throw new BrainError("No connection to OpenAI, so the mic cannot listen right now.");
    throw error;
  }
}

/// Plays replies one after another, in the order they were queued, and can be silenced at once.
export class Speaker {
  private chain: Promise<void> = Promise.resolve();
  private audio: HTMLAudioElement | null = null;
  private round = 0;

  constructor(private readonly onSpeaking: (id: string | null) => void) {}

  /// Runs after everything already queued has finished or failed, unless `stop` was called.
  whenQuiet(then: () => void) {
    const round = this.round;
    this.chain = this.chain.then(() => {
      if (round === this.round) then();
    });
  }

  /// Queues audio that may still be on its way; it plays once everything before it has finished.
  /// Resolves when that line has actually been heard, or skipped.
  queue(id: string, audio: Promise<Blob>): Promise<void> {
    const round = this.round;
    const finished = this.chain.then(async () => {
      let blob: Blob;
      try {
        blob = await audio;
      } catch {
        return;
      }
      if (round === this.round) await this.play(id, blob, round);
    });
    this.chain = finished;
    return finished.then(() => undefined);
  }

  /// Stops whatever is playing and forgets what was queued.
  stop() {
    this.round++;
    this.chain = Promise.resolve();
    if (this.audio) {
      this.audio.pause();
      this.audio = null;
    }
    this.onSpeaking(null);
  }

  private play(id: string, blob: Blob, round: number): Promise<void> {
    return new Promise((resolve) => {
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      this.audio = audio;
      const done = () => {
        URL.revokeObjectURL(url);
        if (this.audio === audio) {
          this.audio = null;
          this.onSpeaking(null);
        }
        resolve();
      };
      audio.onended = done;
      audio.onerror = done;
      audio.onpause = () => round !== this.round && done();
      this.onSpeaking(id);
      audio.play().catch(done);
    });
  }
}

/// Records from the microphone until stopped. Returns null if it was cancelled.
export class Recorder {
  private recorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private finished: ((blob: Blob | null) => void) | null = null;
  private keep = true;

  async start(): Promise<void> {
    const allowed = await prepareMic();
    if (allowed === "old") throw new BrainError("This copy of the app cannot use the microphone. Install The-room.apk from your PC, then open The room and tap Allow.");
    if (allowed === "denied") throw new BrainError("Microphone is off for The room. Open the app's permissions and allow Microphone.");
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (error) {
      const name = (error as DOMException)?.name;
      if (name === "NotAllowedError" || name === "SecurityError")
        throw new BrainError("Microphone is off for The room. Open the app's permissions and allow Microphone.");
      if (name === "NotFoundError") throw new BrainError("This phone has no microphone the room can use.");
      throw new BrainError("Could not start the microphone.");
    }
    const type = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg"].find((kind) => MediaRecorder.isTypeSupported(kind));
    const recorder = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
    this.chunks = [];
    this.keep = true;
    recorder.ondataavailable = (event) => event.data.size && this.chunks.push(event.data);
    recorder.onstop = () => {
      stream.getTracks().forEach((track) => track.stop());
      const blob = new Blob(this.chunks, { type: recorder.mimeType || type || "audio/webm" });
      this.finished?.(this.keep && blob.size > 0 ? blob : null);
      this.finished = null;
      this.recorder = null;
    };
    recorder.start();
    this.recorder = recorder;
  }

  /// Stops and hands back the recording, or null when `keep` is false.
  stop(keep = true): Promise<Blob | null> {
    const recorder = this.recorder;
    if (!recorder) return Promise.resolve(null);
    this.keep = keep;
    return new Promise((resolve) => {
      this.finished = resolve;
      recorder.stop();
    });
  }
}
