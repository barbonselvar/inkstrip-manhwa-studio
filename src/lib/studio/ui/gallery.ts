/** Original Inkstrip gallery artwork; lettering is separate from generated pixels. */
export const GALLERY = [
  {
    id: "murim",
    title: "Beyond the Jade Gate",
    genre: "Murim / Martial Arts",
    alt: "Swordswoman on a misty mountain temple bridge",
    dialogue: "길은 여기서 시작돼.",
    language: "ko",
  },
  {
    id: "fantasy",
    title: "The Atlas of Starlight",
    genre: "Fantasy",
    alt: "Star-cartographer conjuring constellations in a forest library",
  },
  {
    id: "medieval",
    title: "A Promise at Dusk",
    genre: "Medieval Fantasy",
    alt: "Knight and mage meeting beneath castle towers at twilight",
    dialogue: "Then we face tomorrow together.",
    language: "en",
  },
  {
    id: "action",
    title: "Run Above the Rain",
    genre: "Action",
    alt: "Silver-haired courier leaping between rain-slick city rooftops",
    effect: "WHOOSH!",
  },
  {
    id: "manga",
    title: "The Last Local Train",
    genre: "Black & White Manga",
    alt: "Railway apprentice and a cat on a quiet rural platform in black and white",
    dialogue: "次の駅で、会おう。",
    language: "ja",
  },
  {
    id: "romance",
    title: "Under One Umbrella",
    genre: "Romance / Slice of Life",
    alt: "Two friends sharing an umbrella on a rainy bookshop street",
    dialogue: "비가 그치면 같이 걷자.",
    language: "ko",
  },
  {
    id: "horror",
    title: "The Inn That Waits",
    genre: "Horror",
    alt: "Lantern-bearing investigator approaching a haunted inn in a bamboo forest",
  },
  {
    id: "scifi",
    title: "A Garden Beyond Earth",
    genre: "Science Fiction",
    alt: "Astronaut beneath a ringed planet in an orbital botanical greenhouse",
  },
  {
    id: "adventure",
    title: "Where the Sky Begins",
    genre: "Adventure",
    alt: "Explorer swinging across a waterfall canyon toward a ruined sky temple",
    effect: "SWISH!",
  },
] as const;
export const GALLERY_INTERVAL = 3000;
export function galleryIndex(index: number) {
  return ((index % GALLERY.length) + GALLERY.length) % GALLERY.length;
}
export function galleryPosition(index: number, active: number) {
  const offset = galleryIndex(index - active);
  return offset === 0
    ? "front"
    : offset === 1
      ? "right"
      : offset === GALLERY.length - 1
        ? "left"
        : "hidden";
}
