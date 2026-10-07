import { useContext, useEffect, useLayoutEffect, useRef, useState } from "react";
import { byId, EXPERTS, type Expert } from "./experts";
import { BrainError, check, KEY_PAGE, MODELS } from "./openai";
import { faceFrom, loadPhotos, PhotosContext, savePhotos, type Photos } from "./photos";
import { emojiOf, grouped, REACTIONS, setReaction } from "./reacts";
import { note, reply, speakers, type Target } from "./room";
import { loadMessages, loadSettings, newId, saveMessages, saveSettings, type Message, type Settings } from "./store";
import { fishVoiceIn, hear, openMicSettings, Recorder, say, Speaker } from "./voice";

/// A recording stops by itself after this, so a forgotten mic doesn't run up a bill.
const LONGEST_RECORDING = 120;
const SAMPLE = "Hello. This is how I sound in the room.";

const SUGGESTIONS = [
  "Everyone: should I quit my job to start a company?",
  "Harvey, how do I ask for a raise?",
  "Steve, what should I cut from my app idea?",
  "Jack, how do I get out of a deal that went bad?",
  "Rick, explain how a fusion reactor works.",
];

const initials = (expert: Expert) => expert.name.split(" ").map((part) => part[0]).join("");

/// The expert's picture over their initials, so the initials show while it loads or if it cannot.
function Avatar({ expert, size = 34 }: { expert: Expert; size?: number }) {
  const own = useContext(PhotosContext)[expert.id];
  const src = own || expert.photo.src;
  const [broken, setBroken] = useState("");
  return (
    <span className="avatar" style={{ background: expert.colour, borderColor: expert.colour, width: size, height: size, fontSize: size * 0.38 }} aria-hidden>
      {initials(expert)}
      {broken !== src && <img src={src} alt="" draggable={false} style={{ objectPosition: own ? "50% 50%" : expert.photo.focus }} onError={() => setBroken(src)} />}
    </span>
  );
}

const reason = (error: unknown) => (error instanceof BrainError ? error.message : error instanceof Error ? error.message : String(error));

const whoReacted = (id: string) => (id === "you" ? "You" : byId(id)?.short ?? id);

function ReactBar({ message, onReact, open, onOpen }: { message: Message; onReact: (emoji: string) => void; open: boolean; onOpen: () => void }) {
  const pills = grouped(message.reactions);
  const mine = message.reactions?.find((one) => one.from === "you")?.emoji;
  return (
    <div className="reacts">
      {pills.map((pill) => (
        <button key={pill.emoji} className={mine === pill.emoji ? "react on" : "react"} title={pill.from.map(whoReacted).join(", ")} onClick={() => onReact(pill.emoji)}>
          {pill.emoji}
          {pill.from.length > 1 ? <span>{pill.from.length}</span> : null}
        </button>
      ))}
      <button className="react add" onClick={onOpen} aria-label="React">
        +
      </button>
      {open && (
        <div className="react-tray">
          {REACTIONS.map((one) => (
            <button key={one.id} className={mine === one.emoji ? "react on" : "react"} onClick={() => onReact(one.emoji)}>
              {one.emoji}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function Setup({ settings, onDone }: { settings: Settings; onDone: (settings: Settings) => void }) {
  const [key, setKey] = useState(settings.key);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState("");

  const go = async () => {
    const trimmed = key.trim();
    if (!trimmed) return setError("Paste your OpenAI API key first.");
    setChecking(true);
    setError("");
    try {
      await check(trimmed, settings.model);
      onDone({ ...settings, key: trimmed });
    } catch (problem) {
      setError(reason(problem));
    } finally {
      setChecking(false);
    }
  };

  return (
    <main className="setup">
      <div className="setup-faces">
        {EXPERTS.map((expert) => (
          <Avatar key={expert.id} expert={expert} size={52} />
        ))}
      </div>
      <h1>The room</h1>
      <p>Rick, Harvey, Jack and Steve, on your phone. They think with OpenAI's GPT-5, using your own OpenAI API key.</p>
      <ol>
        <li>
          Open <a href={KEY_PAGE}>platform.openai.com</a>, make sure your account has credit, and create an API key.
        </li>
        <li>Paste it here. It stays on this phone and only goes to OpenAI.</li>
      </ol>
      <input className="field" type="password" autoComplete="off" spellCheck={false} placeholder="sk-..." value={key} onChange={(event) => setKey(event.target.value)} onKeyDown={(event) => event.key === "Enter" && void go()} />
      {error && <p className="error-text">{error}</p>}
      <button className="primary" disabled={checking} onClick={() => void go()}>
        {checking ? "Checking the key..." : "Open the room"}
      </button>
    </main>
  );
}

interface SettingsProps {
  settings: Settings;
  photos: Photos;
  onSave: (settings: Settings) => void;
  onClose: () => void;
  onClear: () => void;
  /// A picture from the phone for one expert, or null to go back to their own.
  onPhoto: (id: string, photo: string | null) => void;
}

function SettingsPage({ settings, photos, onSave, onClose, onClear, onPhoto }: SettingsProps) {
  const [draft, setDraft] = useState(settings);
  const [photoError, setPhotoError] = useState("");

  const choose = async (id: string, file: File | undefined) => {
    if (!file) return;
    setPhotoError("");
    try {
      onPhoto(id, await faceFrom(file));
    } catch (problem) {
      setPhotoError(reason(problem));
    }
  };
  const [shown, setShown] = useState(false);
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const [checking, setChecking] = useState(false);
  const [sampling, setSampling] = useState("");
  const [voiceStatus, setVoiceStatus] = useState("");

  const sample = async (expert: Expert) => {
    setSampling(expert.id);
    setVoiceStatus("");
    try {
      const audio = new Audio(URL.createObjectURL(await say(SAMPLE, expert, { ...draft, key: draft.key.trim() })));
      audio.onended = () => URL.revokeObjectURL(audio.src);
      await audio.play();
    } catch (problem) {
      setVoiceStatus(reason(problem));
    } finally {
      setSampling("");
    }
  };

  const test = async () => {
    setChecking(true);
    setStatus(null);
    try {
      await check(draft.key.trim(), draft.model);
      setStatus({ ok: true, text: "The key works with this model." });
    } catch (problem) {
      setStatus({ ok: false, text: reason(problem) });
    } finally {
      setChecking(false);
    }
  };

  return (
    <main className="settings">
      <header className="bar">
        <button className="icon" onClick={onClose} aria-label="Back">
          <svg viewBox="0 0 24 24" width="22" height="22"><path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </button>
        <h2>Settings</h2>
      </header>
      <div className="settings-body">
        <label>
          <span>Your name</span>
          <input className="field" value={draft.name} placeholder="What the room calls you" onChange={(event) => setDraft({ ...draft, name: event.target.value })} />
        </label>
        <label>
          <span>OpenAI API key</span>
          <div className="key-row">
            <input className="field" type={shown ? "text" : "password"} autoComplete="off" spellCheck={false} value={draft.key} onChange={(event) => setDraft({ ...draft, key: event.target.value })} />
            <button className="ghost" onClick={() => setShown(!shown)}>{shown ? "Hide" : "Show"}</button>
          </div>
        </label>
        <label>
          <span>Model</span>
          <select className="field" value={draft.model} onChange={(event) => setDraft({ ...draft, model: event.target.value })}>
            {MODELS.map(([id, label]) => (
              <option key={id} value={id}>{label}</option>
            ))}
          </select>
        </label>
        {status && <p className={status.ok ? "ok-text" : "error-text"}>{status.text}</p>}
        <div className="row">
          <button className="ghost" disabled={checking || !draft.key.trim()} onClick={() => void test()}>{checking ? "Testing..." : "Test key"}</button>
          <button className="primary" disabled={!draft.key.trim()} onClick={() => onSave({ ...draft, key: draft.key.trim(), fishKey: draft.fishKey.trim() })}>Save</button>
        </div>
        <hr />
        <div className="people">
          {EXPERTS.map((expert) => (
            <div key={expert.id} className="person">
              <Avatar expert={expert} size={48} />
              <div>
                <b style={{ color: expert.colour }}>{expert.name}</b>
                <span>{expert.craft}</span>
                <div className="photo-actions">
                  <label className="link">
                    Change photo
                    <input type="file" accept="image/*" hidden onChange={(event) => (void choose(expert.id, event.target.files?.[0]), (event.target.value = ""))} />
                  </label>
                  {photos[expert.id] && (
                    <button className="link" onClick={() => onPhoto(expert.id, null)}>
                      Use theirs
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
        {photoError && <p className="error-text">{photoError}</p>}
        <hr />
        <label className="toggle">
          <input type="checkbox" checked={draft.speak} onChange={(event) => setDraft({ ...draft, speak: event.target.checked })} />
          <span>Read replies aloud</span>
        </label>
        <label>
          <span>fish.audio API key (optional)</span>
          <input className="field" type="password" autoComplete="off" spellCheck={false} placeholder="For fish.audio voices" value={draft.fishKey} onChange={(event) => setDraft({ ...draft, fishKey: event.target.value })} />
        </label>
        <p className="hint">
          Voices below are already picked. The fish.audio key is already in the app. Clear a link to use OpenAI's voice for that person instead.
        </p>
        <div className="voices">
          {EXPERTS.map((expert) => {
            const link = draft.voices[expert.id] ?? expert.voice.fish;
            const fishId = fishVoiceIn(link);
            const fish = !!draft.fishKey.trim() && !!fishId;
            const canHear = fish || !!draft.key.trim();
            return (
              <div key={expert.id} className="voice">
                <div className="voice-head">
                  <b style={{ color: expert.colour }}>{expert.short}</b>
                  <span>{fish ? "fish.audio voice" : link.trim() && !fishId ? "Not a fish.audio voice link" : `OpenAI "${expert.voice.openai}" voice`}</span>
                  <button className="link" disabled={!!sampling || !canHear} onClick={() => void sample(expert)}>{sampling === expert.id ? "Loading..." : "Hear"}</button>
                </div>
                <input className="field" spellCheck={false} placeholder="fish.audio voice link (optional)" value={link} onChange={(event) => setDraft({ ...draft, voices: { ...draft.voices, [expert.id]: event.target.value } })} />
              </div>
            );
          })}
        </div>
        {voiceStatus && <p className="error-text">{voiceStatus}</p>}
        <button className="primary" disabled={!draft.key.trim()} onClick={() => onSave({ ...draft, key: draft.key.trim(), fishKey: draft.fishKey.trim() })}>Save</button>
        <div className="credits">
          <span>Pictures</span>
          {EXPERTS.map((expert) => (
            <a key={expert.id} href={expert.photo.link}>
              {expert.short}: {expert.photo.credit}
            </a>
          ))}
        </div>
        <hr />
        <button className="danger" onClick={() => window.confirm("Clear the whole conversation? This cannot be undone.") && onClear()}>Clear conversation</button>
        <p className="version">Version {__BUILD__}</p>
      </div>
    </main>
  );
}

interface Live {
  /// The expert speaking now, or "" while the room chooses who answers.
  who: string;
  text: string;
}

export default function App() {
  const [photos, setPhotos] = useState<Photos>(loadPhotos);

  const photo = (id: string, picture: string | null) =>
    setPhotos((all) => {
      const next = { ...all };
      if (picture) next[id] = picture;
      else delete next[id];
      savePhotos(next);
      return next;
    });

  return (
    <PhotosContext.Provider value={photos}>
      <Room photos={photos} onPhoto={photo} />
    </PhotosContext.Provider>
  );
}

function Room({ photos, onPhoto }: { photos: Photos; onPhoto: SettingsProps["onPhoto"] }) {
  const [settings, setSettings] = useState(loadSettings);
  const [messages, setMessages] = useState<Message[]>(loadMessages);
  const [page, setPage] = useState<"room" | "settings">("room");
  const [draft, setDraft] = useState("");
  const [target, setTarget] = useState<Target>("auto");
  const [live, setLive] = useState<Live | null>(null);
  const [retry, setRetry] = useState<string[] | null>(null);
  const [more, setMore] = useState<string[] | null>(null);
  const [turn, setTurn] = useState(false);
  const fromMic = useRef(false);
  /// Message ids whose text is held back until the voice actually starts, so they don't type first.
  const [held, setHeld] = useState<Set<string>>(() => new Set());
  const [tray, setTray] = useState<string | null>(null);
  const unhold = (id: string) =>
    setHeld((all) => {
      if (!all.has(id)) return all;
      const next = new Set(all);
      next.delete(id);
      return next;
    });
  const stop = useRef<AbortController | null>(null);
  const list = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLTextAreaElement>(null);
  const pinned = useRef(true);
  const [speaking, setSpeaking] = useState<string | null>(null);
  const [speaker] = useState(() => new Speaker(setSpeaking));
  const spoken = useRef(new Map<string, Promise<Blob>>());
  const [notice, setNotice] = useState("");
  const [recorder] = useState(() => new Recorder());
  const [mic, setMic] = useState<"off" | "starting" | "on" | "hearing">("off");
  const [seconds, setSeconds] = useState(0);
  const autoStop = useRef(() => {});

  useEffect(() => saveMessages(messages), [messages]);
  useEffect(() => saveSettings(settings), [settings]);
  useEffect(() => () => speaker.stop(), [speaker]);
  useEffect(() => {
    if (speaking) unhold(speaking);
  }, [speaking]);

  useEffect(() => {
    if (mic !== "on") return;
    setSeconds(0);
    const started = Date.now();
    const tick = window.setInterval(() => {
      const elapsed = Math.floor((Date.now() - started) / 1000);
      setSeconds(elapsed);
      if (elapsed >= LONGEST_RECORDING) {
        window.clearInterval(tick);
        autoStop.current();
      }
    }, 250);
    return () => window.clearInterval(tick);
  }, [mic]);

  useLayoutEffect(() => {
    const element = list.current;
    if (element && pinned.current) element.scrollTop = element.scrollHeight;
  }, [messages, live, retry, more, turn, page]);

  useLayoutEffect(() => {
    const element = box.current;
    if (!element) return;
    element.style.height = "auto";
    element.style.height = `${Math.min(element.scrollHeight, 140)}px`;
  }, [draft]);

  if (!settings.key) return <Setup settings={settings} onDone={setSettings} />;

  if (page === "settings")
    return (
      <SettingsPage
        settings={settings}
        photos={photos}
        onPhoto={onPhoto}
        onClose={() => setPage("room")}
        onSave={(next) => (setSettings(next), setPage("room"))}
        onClear={() => (speaker.stop(), spoken.current.clear(), setMessages([]), setRetry(null), setMore(null), setSettings((all) => ({ ...all, decided: "" })), setPage("room"))}
      />
    );

  /// Reads a reply aloud after anything already playing. The audio is kept so a replay is free.
  const speak = (message: Message, use = settings, signal?: AbortSignal, laugh = false) => {
    const expert = byId(message.from);
    if (!expert) return;
    let audio = spoken.current.get(message.id);
    if (!audio) {
      audio = say(message.text, expert, use, signal, laugh);
      spoken.current.set(message.id, audio);
      audio.catch((problem) => {
        spoken.current.delete(message.id);
        unhold(message.id);
        setNotice(reason(problem));
      });
    }
    speaker.queue(message.id, audio);
  };

  /// Tapping a reply plays it, or stops it if it is the one playing.
  const replay = (message: Message) => {
    const playing = speaking === message.id;
    speaker.stop();
    if (!playing) speak(message);
  };

  const toggleVoice = () => {
    if (settings.speak) speaker.stop();
    setSettings({ ...settings, speak: !settings.speak });
  };

  const listen = async (hands = false) => {
    speaker.stop();
    setNotice("");
    setTurn(false);
    setMic("starting");
    try {
      await recorder.start();
      setMic("on");
    } catch (problem) {
      setMic("off");
      if (hands) setTurn(true);
      else setNotice(reason(problem));
    }
  };

  const finish = async (keep: boolean) => {
    const recording = await recorder.stop(keep);
    if (!recording) return setMic("off");
    setMic("hearing");
    try {
      const words = await hear(recording, settings);
      if (words) send(words, "mic");
      else setNotice("Didn't catch that. Try again a little closer to the phone.");
    } catch (problem) {
      setNotice(reason(problem));
    } finally {
      setMic("off");
    }
  };
  autoStop.current = () => void finish(true);

  const handBack = () => {
    if (box.current?.value.trim() || document.visibilityState === "hidden") return setTurn(true);
    void listen(true);
  };

  /// Runs the experts in turn; each one sees what the ones before it said.
  const run = async (who: string[] | null, thread: Message[], text: string, chosen: Target) => {
    const controller = new AbortController();
    stop.current = controller;
    setRetry(null);
    setMore(null);
    setTurn(false);
    setHeld(new Set());
    pinned.current = true;
    let current = thread;
    let queue = who ?? [];
    let later: string[] = [];
    try {
      if (!who) {
        setLive({ who: "", text: "" });
        const round = await speakers(chosen, text, thread, settings, controller.signal);
        queue = round.now;
        later = round.later;
      }
      while (queue.length) {
        const expert = byId(queue[0])!;
        const id = newId();
        setLive({ who: expert.id, text: "" });
        const said = await reply(expert, current, settings, controller.signal, (soFar) => {
          if (!settings.speak) setLive({ who: expert.id, text: soFar });
        });
        const targetMsg = [...current].reverse().find((known) => known.from !== "error" && known.from !== expert.id);
        const emoji = said.react ? emojiOf(said.react) : "";
        if (emoji && targetMsg) current = current.map((known) => (known.id === targetMsg.id ? { ...known, reactions: setReaction(known.reactions, expert.id, emoji) } : known));
        const message: Message = { id, from: expert.id, text: said.text || "...", at: Date.now() };
        current = [...current, message];
        setMessages(current);
        setLive(null);
        if (settings.speak && said.text) {
          setHeld((all) => new Set(all).add(id));
          speak(message, settings, controller.signal, said.react === "laugh");
          const audio = spoken.current.get(id);
          if (audio) await audio.catch(() => {});
        }
        queue = queue.slice(1);
      }
      if (later.length) setMore(later);
      try {
        const decided = await note(current, settings, controller.signal);
        if (decided) setSettings((all) => ({ ...all, decided }));
      } catch (problem) {
        if (controller.signal.aborted) throw problem;
      }
    } catch (problem) {
      if (!controller.signal.aborted) {
        current = [...current, { id: newId(), from: "error", text: reason(problem), at: Date.now() }];
        setMessages(current);
        setRetry(queue.length ? queue : null);
      }
    } finally {
      stop.current = null;
      setLive(null);
      if (fromMic.current && !controller.signal.aborted) {
        if (settings.speak) speaker.whenQuiet(handBack);
        else handBack();
      }
    }
  };

  const send = (text = draft, via: "type" | "mic" = "type") => {
    const words = text.trim();
    if (!words || live) return;
    const thread = [...messages, { id: newId(), from: "you", text: words, at: Date.now() }];
    fromMic.current = via === "mic";
    speaker.stop();
    setNotice("");
    setTurn(false);
    setMessages(thread);
    setDraft("");
    void run(null, thread, words, target);
  };

  const ask = (expert: Expert) => {
    setTarget(expert.id);
    box.current?.focus();
  };

  const reactTo = (id: string, emoji: string) => {
    setMessages((all) => all.map((message) => (message.id === id ? { ...message, reactions: setReaction(message.reactions, "you", emoji) } : message)));
    setTray(null);
  };

  const again = () => {
    if (!retry || live) return;
    const thread = messages.filter((message, index) => !(message.from === "error" && index === messages.length - 1));
    setMessages(thread);
    void run(retry, thread, "", "auto");
  };

  const liveExpert = live?.who ? byId(live.who) : undefined;
  const speakingExpert = speaking ? byId(messages.find((message) => message.id === speaking)?.from ?? "") : undefined;
  const waitingExpert = [...held].map((id) => byId(messages.find((message) => message.id === id)?.from ?? "")).find(Boolean);
  const chips: [Target, string][] = [["auto", "Room picks"], ["everyone", "Everyone"], ...EXPERTS.map((expert): [Target, string] => [expert.id, expert.short])];

  return (
    <main className="room">
      <header className="bar">
        <div className="faces">
          {EXPERTS.map((expert) => (
            <Avatar key={expert.id} expert={expert} size={30} />
          ))}
        </div>
        <div className="title">
          <h2>The room</h2>
          <span>
            {live
              ? liveExpert
                ? `${liveExpert.short} is ${settings.speak ? "talking" : "typing"}...`
                : "choosing who answers..."
              : speakingExpert
                ? `${speakingExpert.short} is speaking...`
                : waitingExpert
                  ? `${waitingExpert.short} is talking...`
                  : "Rick, Harvey, Jack, Steve"}
          </span>
        </div>
        <button className={settings.speak ? "icon" : "icon muted"} onClick={toggleVoice} aria-label={settings.speak ? "Turn voices off" : "Turn voices on"}>
          <svg viewBox="0 0 24 24" width="22" height="22">
            <path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4v-5Z" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
            {settings.speak ? (
              <path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
            ) : (
              <path d="M16 9.5l5 5M21 9.5l-5 5" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
            )}
          </svg>
        </button>
        <button className="icon" onClick={() => setPage("settings")} aria-label="Settings">
          <svg viewBox="0 0 24 24" width="22" height="22"><path d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Zm7.4-2.5a7.6 7.6 0 0 0 0-2l2-1.6-2-3.4-2.4 1a7.4 7.4 0 0 0-1.7-1l-.4-2.6h-4l-.4 2.6a7.4 7.4 0 0 0-1.7 1l-2.4-1-2 3.4 2 1.6a7.6 7.6 0 0 0 0 2l-2 1.6 2 3.4 2.4-1c.5.4 1.1.7 1.7 1l.4 2.6h4l.4-2.6c.6-.3 1.2-.6 1.7-1l2.4 1 2-3.4-2-1.6Z" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" /></svg>
        </button>
      </header>

      <div className="thread" ref={list} onScroll={(event) => {
        const element = event.currentTarget;
        pinned.current = element.scrollHeight - element.scrollTop - element.clientHeight < 60;
      }}>
        {messages.length === 0 && !live && (
          <div className="empty">
            <p>Ask anything. They keep it short. Say "tell me more" when you want the why. Name someone to bring only them in, or say "everyone" for the whole table.</p>
            {SUGGESTIONS.map((suggestion) => (
              <button key={suggestion} onClick={() => send(suggestion)}>{suggestion}</button>
            ))}
          </div>
        )}
        {messages.map((message) => {
          if (message.from === "you")
            return (
              <div key={message.id} className="said mine-wrap">
                <div>
                  <div className="bubble mine">{message.text}</div>
                  <ReactBar message={message} onReact={(emoji) => reactTo(message.id, emoji)} open={tray === message.id} onOpen={() => setTray(tray === message.id ? null : message.id)} />
                </div>
              </div>
            );
          if (message.from === "error") return <div key={message.id} className="problem">{message.text}</div>;
          const expert = byId(message.from);
          if (!expert) return null;
          return (
            <div key={message.id} className="said">
              <button className="face-btn" onClick={() => ask(expert)} aria-label={`Message ${expert.short}`}>
                <Avatar expert={expert} />
              </button>
              <div>
                <div className={speaking === message.id ? "bubble theirs speaking" : "bubble theirs"} style={speaking === message.id ? { borderColor: expert.colour } : undefined} onClick={() => replay(message)}>
                  <b style={{ color: expert.colour }}>{expert.name}</b>
                  {held.has(message.id) ? <span className="dots"><i /><i /><i /></span> : message.text}
                  {speaking === message.id && <span className="wave" style={{ color: expert.colour }}><i /><i /><i /><i /></span>}
                </div>
                <ReactBar message={message} onReact={(emoji) => reactTo(message.id, emoji)} open={tray === message.id} onOpen={() => setTray(tray === message.id ? null : message.id)} />
                <button className="ask" onClick={() => ask(expert)}>
                  Ask {expert.short}
                </button>
              </div>
            </div>
          );
        })}
        {live && liveExpert && (
          <div className="said">
            <Avatar expert={liveExpert} />
            <div className="bubble theirs">
              <b style={{ color: liveExpert.colour }}>{liveExpert.name}</b>
              {live.text || <span className="dots"><i /><i /><i /></span>}
            </div>
          </div>
        )}
        {live && !liveExpert && <div className="choosing"><span className="dots"><i /><i /><i /></span></div>}
        {retry && !live && (
          <button className="ghost retry" onClick={again}>Try again</button>
        )}
        {more && !live && !retry && (
          <button className="ghost retry" onClick={() => {
            const who = more;
            setMore(null);
            void run(who, messages, "", "auto");
          }}>Anyone else?</button>
        )}
      </div>

      <footer className="composer">
        {turn && mic === "off" && !live && (
          <button className="turn" onClick={() => void listen()}>
            Your turn
          </button>
        )}
        {notice && (
          <div className="notice">
            <span onClick={() => setNotice("")}>{notice}</span>
            {notice.toLowerCase().includes("microphone") && (
              <button className="link" onClick={() => void openMicSettings()}>
                Open settings
              </button>
            )}
          </div>
        )}
        <div className="chips">
          {chips.map(([id, label]) => {
            const expert = byId(id);
            return (
              <button key={id} className={target === id ? "chip on" : "chip"} style={target === id && expert ? { background: expert.colour } : undefined} onClick={() => setTarget(id)}>
                {label}
              </button>
            );
          })}
        </div>
        {mic === "on" || mic === "hearing" ? (
          <div className="write recording">
            <button className="send cancel" disabled={mic === "hearing"} onClick={() => void finish(false)} aria-label="Cancel">
              <svg viewBox="0 0 24 24" width="18" height="18"><path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" /></svg>
            </button>
            <div className="listening">
              {mic === "on" ? (
                <>
                  <span className="rec" />
                  <span>Listening {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, "0")}</span>
                </>
              ) : (
                <span>Writing down what you said...</span>
              )}
            </div>
            <button className="send" disabled={mic === "hearing"} onClick={() => void finish(true)} aria-label="Send what I said">
              <svg viewBox="0 0 24 24" width="20" height="20"><path d="M4 12l16-8-6 16-2.5-6.5L4 12Z" fill="currentColor" /></svg>
            </button>
          </div>
        ) : (
        <div className="write">
          <textarea
            ref={box}
            rows={1}
            value={draft}
            placeholder={target === "auto" ? "Message the room" : target === "everyone" ? "Message everyone" : `Message ${byId(target)?.short}`}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey && window.matchMedia("(pointer: fine)").matches) {
                event.preventDefault();
                send();
              }
            }}
          />
          {live ? (
            <button className="send stop" onClick={() => (stop.current?.abort(), speaker.stop())} aria-label="Stop">
              <svg viewBox="0 0 24 24" width="18" height="18"><rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" /></svg>
            </button>
          ) : draft.trim() ? (
            <button className="send" onClick={() => send()} aria-label="Send">
              <svg viewBox="0 0 24 24" width="20" height="20"><path d="M4 12l16-8-6 16-2.5-6.5L4 12Z" fill="currentColor" /></svg>
            </button>
          ) : (
            <button className="send" disabled={mic === "starting"} onClick={() => void listen()} aria-label="Talk">
              <svg viewBox="0 0 24 24" width="20" height="20"><rect x="9" y="3" width="6" height="11" rx="3" fill="currentColor" /><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
            </button>
          )}
        </div>
        )}
      </footer>
    </main>
  );
}
