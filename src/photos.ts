import { createContext } from "react";

/// Pictures you chose from your phone, by expert id, as small JPEG data URLs.
export type Photos = Record<string, string>;

const PHOTOS = "room.photos";
/// A profile picture is never shown bigger than this, so a phone photo is shrunk to it.
const SIDE = 256;

export const PhotosContext = createContext<Photos>({});

export function loadPhotos(): Photos {
  try {
    return JSON.parse(localStorage.getItem(PHOTOS) ?? "{}") as Photos;
  } catch {
    return {};
  }
}

export function savePhotos(photos: Photos) {
  try {
    localStorage.setItem(PHOTOS, JSON.stringify(photos));
  } catch {
    // Storage full: the picture shows until the app closes.
  }
}

/// A square, centred crop of a picture from the phone, shrunk to profile size.
export async function faceFrom(file: File): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error("That file is not a picture this phone can open."));
      element.src = url;
    });
    const side = Math.min(image.naturalWidth, image.naturalHeight);
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = SIDE;
    canvas.getContext("2d")!.drawImage(image, (image.naturalWidth - side) / 2, (image.naturalHeight - side) / 2, side, side, 0, 0, SIDE, SIDE);
    return canvas.toDataURL("image/jpeg", 0.85);
  } finally {
    URL.revokeObjectURL(url);
  }
}
