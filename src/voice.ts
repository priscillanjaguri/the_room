import type { Expert } from "./experts";
import { Offline, post } from "./net";
import { BrainError } from "./openai";
import type { Settings } from "./store";

const OPENAI_SPEECH = "https://api.openai.com/v1/audio/speech";
const OPENAI_HEARING = "https://api.openai.com/v1/audio/transcriptions";
const SPEECH_MODEL = "gpt-4o-mini-tts";
const HEARING_MODEL = "gpt-4o-mini-transcribe";
const FISH_SPEECH = "https://api.fish.audio/v1/tts";
/// fish.audio's free tier of its newest voice model, the one Gleam uses: it needs no API credit.
const FISH_MODEL = "s2.1-pro-free";
/// Speech is paid by length and a long answer is tiring to hear; past this the gist is spoken.
const LONGEST_SPOKEN = 900;

/// The words a voice should read: no emojis, no asterisks around actions, no stray spacing.
export function forSpeech(text: string): string {
  let spoken = text
    .replace(/[\p{Extended_Pictographic}\u{1F1E6}-\u{1F1FF}\u{FE0F}\u{200D}\u{20E3}]/gu, "")
    .replace(/\*/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (spoken.length > LONGEST_SPOKEN) {
    spoken = spoken.slice(0, LONGEST_SPOKEN);
    const stop = Math.max(spoken.lastIndexOf(". "), spoken.lastIndexOf("! "), spoken.lastIndexOf("? "));
    if (stop > 0) spoken = spoken.slice(0, stop + 1);
  }
  return spoken;
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
export async function say(text: string, expert: Expert, settings: Settings, signal?: AbortSignal): Promise<Blob> {
  const spoken = forSpeech(text);
  if (!spoken) throw new BrainError("Nothing to read aloud.");
  const fish = fishVoice(expert, settings);
  const service = fish ? "fish.audio" : "OpenAI";
  try {
    const answer = fish
      ? await post({
          url: FISH_SPEECH,
          headers: { authorization: `Bearer ${settings.fishKey.trim()}`, model: FISH_MODEL },
          json: { text: spoken, format: "mp3", mp3_bitrate: 192, latency: "low", reference_id: fish },
          want: "blob",
          signal,
        })
      : await post({
          url: OPENAI_SPEECH,
          headers: { authorization: `Bearer ${settings.key}` },
          json: { model: SPEECH_MODEL, voice: expert.voice.openai, input: spoken, instructions: expert.voice.style, response_format: "mp3" },
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

  /// Queues audio that may still be on its way; it plays once everything before it has finished.
  queue(id: string, audio: Promise<Blob>) {
    const round = this.round;
    this.chain = this.chain.then(async () => {
      let blob: Blob;
      try {
        blob = await audio;
      } catch {
        return;
      }
      if (round === this.round) await this.play(id, blob, round);
    });
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
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (error) {
      const name = (error as DOMException)?.name;
      if (name === "NotAllowedError" || name === "SecurityError")
        throw new BrainError("The room is not allowed to use the microphone. Install the newest app from your PC once, then allow the microphone when your phone asks.");
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
