export type StripFormat = "image/jpeg" | "image/png";

export type StripPart = {
  blobId: string;
  height: number;
};

export type Strip = {
  width: number;
  totalHeight: number;
  parts: StripPart[];
  panelIds: string[];
  widthSetting: number;
  seam: number;
  format: StripFormat;
  createdAt: number;
};

export type Project = {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
};

export type Chapter = {
  id: string;
  projectId: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  width: number;
  seam: number;
  format: StripFormat;
  strip: Strip | null;
};

export type Panel = {
  id: string;
  chapterId: string;
  name: string;
  mime: string;
  width: number;
  height: number;
  blobId: string;
  thumbId: string;
  order: number;
  createdAt: number;
};

export const PAGE_WIDTHS = [640, 800, 1080] as const;
export const SEAMS = [
  { value: 0, label: "Flush" },
  { value: 8, label: "Tight" },
  { value: 24, label: "Air" },
] as const;

export const PAPER = "#f3efe6";
