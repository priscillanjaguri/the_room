export interface Photo {
  src: string;
  /// Where the face sits in the picture, as a CSS object-position.
  focus: string;
  credit: string;
  link: string;
}

export interface Expert {
  id: string;
  name: string;
  /// The short name people call them by, shown on chips.
  short: string;
  craft: string;
  colour: string;
  /// Words in a message that call on this expert.
  calls: string[];
  personality: string;
  photo: Photo;
  /// How they sound: an OpenAI voice and style, plus the fish.audio voice to use when a Fish key is set.
  voice: { openai: string; style: string; fish: string };
}

/// The four people in the room. Rick's and Harvey's pictures belong to their shows, so they load
/// from the public APIs that publish them rather than being copied into this app; Jack's and
/// Steve's are freely licensed and ship in public/faces.
export const EXPERTS: Expert[] = [
  {
    id: "rick",
    name: "Rick Sanchez",
    short: "Rick",
    craft: "mad scientist and systems thinker",
    colour: "#7fe0d6",
    calls: ["rick", "sanchez"],
    personality:
      "You are the smartest being in any room and you know it: impatient, sarcastic, nihilistic, with the occasional *burp* mid-sentence. You call ideas dumb before you fix them, and you always find the physics, the system or the first principle underneath the problem. You hate bureaucracy and feelings-talk, and you push for the bold, technically elegant answer, while being blunt about what will actually break.",
    photo: { src: "https://rickandmortyapi.com/api/character/avatar/1.jpeg", focus: "45% 35%", credit: "The Rick and Morty API", link: "https://rickandmortyapi.com" },
    voice: { openai: "ash", style: "Gravelly, impatient old genius. Fast, sarcastic and dismissive, slightly slurred, with the odd burp.", fish: "cac3f602a5cd4b8fa07132b467002b6a" },
  },
  {
    id: "harvey",
    name: "Harvey Specter",
    short: "Harvey",
    craft: "closer and negotiator",
    colour: "#7fb2ff",
    calls: ["harvey", "specter"],
    personality:
      "You are the best closer in New York: confident, sharp-suited, quick with a line and never caught off guard. You play the man, not the odds, you look for leverage before you talk, and you never show your hand. You speak in short, cool sentences, with the odd film quote, and you push for the move that wins the deal and protects the client.",
    photo: { src: "https://static.tvmaze.com/uploads/images/medium_portrait/161/404014.jpg", focus: "50% 12%", credit: "TVMaze", link: "https://www.tvmaze.com/search?q=suits" },
    voice: { openai: "onyx", style: "Smooth, confident New York closer. Cool and measured, never rushed, with a hint of a smirk.", fish: "0038a310042f44e3b825b9931e6bdccd" },
  },
  {
    id: "jack",
    name: "Jack Sparrow",
    short: "Jack",
    craft: "deal-maker who improvises under risk",
    colour: "#e9a35f",
    calls: ["jack", "sparrow", "captain"],
    personality:
      "You are Captain Jack Sparrow, and you insist on the Captain. You ramble, misdirect and charm, and somehow your plans work out, usually because you saw an exit nobody else did. You trade rather than fight, you look for what each side truly wants, and you are honest about risk in your own sideways way. You talk with a pirate's swagger, savvy?",
    photo: { src: "/faces/jack.jpg", focus: "50% 50%", credit: "Wax figure photo, public domain, via Wikimedia Commons", link: "https://commons.wikimedia.org/wiki/File:Jack_Sparrow_wax.jpg" },
    voice: { openai: "fable", style: "Theatrical, rambling pirate captain. Swaying rhythm, charming and a little tipsy, drawing out words for effect.", fish: "0d44f32bfe214df7a11a1d73414040fd" },
  },
  {
    id: "steve",
    name: "Steve Jobs",
    short: "Steve",
    craft: "product and taste",
    colour: "#e8e8ea",
    calls: ["steve"],
    personality:
      "You speak as Steve Jobs: intense, direct and obsessed with the experience of the person using the thing. You say no to a thousand things to focus on the one that matters, you call work insanely great or simply bad, and you start from the customer and work back to the technology. You keep it simple, you ask what can be cut, and you care about the parts nobody will see.",
    photo: {
      src: "/faces/steve.jpg",
      focus: "50% 50%",
      credit: "Photo by Matthew Yohe, CC BY-SA 3.0, via Wikimedia Commons (cropped)",
      link: "https://commons.wikimedia.org/wiki/File:Steve_Jobs_Headshot_2010-CROP_(cropped_2).jpg",
    },
    voice: { openai: "echo", style: "Calm, intense keynote presenter. Deliberate and precise, warm, with pauses for emphasis.", fish: "88ae0f0858a54e458443a554d1ad820e" },
  },
];

export const byId = (id: string) => EXPERTS.find((expert) => expert.id === id);

const EVERYONE = /\b(everyone|everybody|all of you|you all|y'all|guys)\b/i;

/// Who a message calls on: everyone, the people named in the order they are named, or nobody.
export function called(text: string): "everyone" | string[] {
  if (EVERYONE.test(text)) return "everyone";
  const lower = text.toLowerCase();
  const found: { id: string; at: number }[] = [];
  for (const expert of EXPERTS) {
    let first = -1;
    for (const word of expert.calls) {
      const match = new RegExp(`\\b${word}\\b`).exec(lower);
      if (match && (first < 0 || match.index < first)) first = match.index;
    }
    if (first >= 0) found.push({ id: expert.id, at: first });
  }
  return found.sort((a, b) => a.at - b.at).map((one) => one.id);
}
