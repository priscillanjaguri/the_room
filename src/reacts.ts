/// WhatsApp-style reactions the room can put on a bubble.

export const REACTIONS: { id: string; emoji: string }[] = [
  { id: "laugh", emoji: "😂" },
  { id: "sad", emoji: "😢" },
  { id: "up", emoji: "👍" },
  { id: "down", emoji: "👎" },
  { id: "party", emoji: "🎉" },
];

export const emojiOf = (id: string) => REACTIONS.find((one) => one.id === id)?.emoji ?? "";

export interface Reaction {
  from: string;
  emoji: string;
}

export function setReaction(reactions: Reaction[] | undefined, from: string, emoji: string): Reaction[] {
  const next = (reactions ?? []).filter((one) => one.from !== from);
  const already = (reactions ?? []).find((one) => one.from === from && one.emoji === emoji);
  if (!already) next.push({ from, emoji });
  return next;
}

export function grouped(reactions: Reaction[] | undefined): { emoji: string; from: string[] }[] {
  const map = new Map<string, string[]>();
  for (const one of reactions ?? []) {
    const who = map.get(one.emoji) ?? [];
    who.push(one.from);
    map.set(one.emoji, who);
  }
  return [...map.entries()].map(([emoji, from]) => ({ emoji, from }));
}
