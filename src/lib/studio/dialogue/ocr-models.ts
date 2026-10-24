/** Official tessdata_fast weights; downloads contain no user artwork. Pinned and integrity-checked. */
export const OCR_REVISION = "87416418657359cb625c412a48b6e1d6d41c29bd";
export const OCR_MODELS = {
  eng: {
    code: "eng",
    bytes: 4113088,
    sha256: "7d4322bd2a7749724879683fc3912cb542f19906c83bcc1a52132556427170b2",
  },
  ara: {
    code: "ara",
    bytes: 1432056,
    sha256: "e3206d3dc87fd50c24a0fb9f01838615911d25168f4e64415244b67d2bb3e729",
  },
  kor: {
    code: "kor",
    bytes: 1677415,
    sha256: "6b85e11d9bbf07863b97b3523b1b112844c43e713df8b66418a081fd1060b3b2",
  },
  jpn: {
    code: "jpn",
    bytes: 2471260,
    sha256: "1f5de9236d2e85f5fdf4b3c500f2d4926f8d9449f28f5394472d9e8d83b91b4d",
  },
  jpn_vert: {
    code: "jpn_vert",
    bytes: 3037480,
    sha256: "bf1e2640954691797e2dc14f38533e601b59ee37958698ae0f0b81dc6f09c71b",
  },
} as const;
export type OcrLanguage = keyof typeof OCR_MODELS;
export const OCR_SOURCE = `https://raw.githubusercontent.com/tesseract-ocr/tessdata_fast/${OCR_REVISION}`;
