# Inkstrip original gallery

Nine illustrations generated specifically for Inkstrip with OpenAI's image-generation
tool on 2026-10-23/24. Prompts describe original adult characters and settings,
without naming artists, franchises, copyrighted panels, stock photographs or user
projects. These are generated illustrations, not model inference on user artwork.
No third-party image hosting or runtime image-generation service is used.

`provenance.json` records original generation filenames and SHA-256 digests of
original PNGs and every deployed variant. Originals remain in the generation
workspace; deployed WebPs are 360×480 and 720×960 derivatives, made with FFmpeg
Lanczos resizing and WebP quality85. Full compositions are retained, without crops.
Generated artwork does not imply exclusive copyright in every jurisdiction.

| File stem | Genre                          | Lettering                                                                 |
| --------- | ------------------------------ | ------------------------------------------------------------------------- |
| murim     | Martial arts                   | Korean: 길은 여기서 시작돼. (The journey begins here.)                    |
| fantasy   | Fantasy                        | Silent                                                                    |
| medieval  | Medieval fantasy               | English: Then we face tomorrow together.                                  |
| action    | Action                         | WHOOSH!                                                                   |
| manga     | Black-and-white Japanese manga | Japanese: 次の駅で、会おう。 (Let's meet at the next station.)            |
| romance   | Romance / slice of life        | Korean: 비가 그치면 같이 걷자. (Let's walk together when the rain stops.) |
| horror    | Horror                         | Silent                                                                    |
| scifi     | Science fiction                | Silent                                                                    |
| adventure | Adventure                      | SWISH!                                                                    |

Dialogue, speech bubbles and sound effects are controlled HTML/CSS typography,
not unreliable generated lettering. They are decorative gallery layers, not
advertised Dialogue Studio functionality. Four dialogue / three silent / two SFX.

The two tiny WOFF fonts are renamed subsets of Noto Sans CJK Bold, Korean(index1)
and Japanese(index0), from the installed upstream Noto CJK collection. They include
only the exact gallery text and support consistent glyph rendering without remote
font requests. Original copyright and SIL Open Font License1.1 are retained in
`/licenses/Noto-CJK-OFL.txt`. Typeface source: https://github.com/notofonts/noto-cjk.
English uses Inkstrip's already bundled Outfit family; captions use Fraunces.
