import { useContext, useEffect, useLayoutEffect, useRef, useState } from "react";
import { byId, EXPERTS, type Expert } from "./experts";
import { BrainError, check, KEY_PAGE, MODELS } from "./openai";
import { faceFrom, loadPhotos, PhotosContext, savePhotos, type Photos } from "./photos";
import { reply, speakers, type Target } from "./room";
import { loadMessages, loadSettings, newId, saveMessages, saveSettings, type Message, type Settings } from "./store";

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
          <button className="primary" disabled={!draft.key.trim()} onClick={() => onSave({ ...draft, key: draft.key.trim() })}>Save</button>
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
  const stop = useRef<AbortController | null>(null);
  const list = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLTextAreaElement>(null);
  const pinned = useRef(true);

  useEffect(() => saveMessages(messages), [messages]);
  useEffect(() => saveSettings(settings), [settings]);

  useLayoutEffect(() => {
    const element = list.current;
    if (element && pinned.current) element.scrollTop = element.scrollHeight;
  }, [messages, live, retry, page]);

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
        onClear={() => (setMessages([]), setRetry(null), setPage("room"))}
      />
    );

  /// Runs the experts in turn; each one sees what the ones before it said.
  const run = async (who: string[] | null, thread: Message[], text: string, chosen: Target) => {
    const controller = new AbortController();
    stop.current = controller;
    setRetry(null);
    pinned.current = true;
    let current = thread;
    let queue = who ?? [];
    try {
      if (!who) {
        setLive({ who: "", text: "" });
        queue = await speakers(chosen, text, thread, settings, controller.signal);
      }
      while (queue.length) {
        const expert = byId(queue[0])!;
        setLive({ who: expert.id, text: "" });
        const said = await reply(expert, current, settings, controller.signal, (soFar) => setLive({ who: expert.id, text: soFar }));
        const message: Message = { id: newId(), from: expert.id, text: said || "...", at: Date.now() };
        current = [...current, message];
        setMessages(current);
        queue = queue.slice(1);
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
    }
  };

  const send = (text = draft) => {
    const words = text.trim();
    if (!words || live) return;
    const thread = [...messages, { id: newId(), from: "you", text: words, at: Date.now() }];
    setMessages(thread);
    setDraft("");
    void run(null, thread, words, target);
  };

  const again = () => {
    if (!retry || live) return;
    const thread = messages.filter((message, index) => !(message.from === "error" && index === messages.length - 1));
    setMessages(thread);
    void run(retry, thread, "", "auto");
  };

  const liveExpert = live?.who ? byId(live.who) : undefined;
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
          <span>{live ? (liveExpert ? `${liveExpert.short} is typing...` : "choosing who answers...") : "Rick, Harvey, Jack, Steve"}</span>
        </div>
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
            <p>Ask anything. Name someone to ask only them, or say "everyone" for a round.</p>
            {SUGGESTIONS.map((suggestion) => (
              <button key={suggestion} onClick={() => send(suggestion)}>{suggestion}</button>
            ))}
          </div>
        )}
        {messages.map((message) => {
          if (message.from === "you") return <div key={message.id} className="bubble mine">{message.text}</div>;
          if (message.from === "error") return <div key={message.id} className="problem">{message.text}</div>;
          const expert = byId(message.from);
          if (!expert) return null;
          return (
            <div key={message.id} className="said">
              <Avatar expert={expert} />
              <div className="bubble theirs">
                <b style={{ color: expert.colour }}>{expert.name}</b>
                {message.text}
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
      </div>

      <footer className="composer">
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
            <button className="send stop" onClick={() => stop.current?.abort()} aria-label="Stop">
              <svg viewBox="0 0 24 24" width="18" height="18"><rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" /></svg>
            </button>
          ) : (
            <button className="send" disabled={!draft.trim()} onClick={() => send()} aria-label="Send">
              <svg viewBox="0 0 24 24" width="20" height="20"><path d="M4 12l16-8-6 16-2.5-6.5L4 12Z" fill="currentColor" /></svg>
            </button>
          )}
        </div>
      </footer>
    </main>
  );
}
