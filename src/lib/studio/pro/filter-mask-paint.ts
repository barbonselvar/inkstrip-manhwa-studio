import { selectionCanvas, clippedStroke } from "./render.ts";
import { coverageRegion } from "./refine-selection.ts";
import type { Stroke } from "./model.ts";
import type { FilterMask } from "./smart-filters.ts";
import {
  maskPaintSize,
  validateMaskPaintWork,
  validateMaskPaintSelection,
  type MaskPaintState,
} from "./mask-paint-policy.ts";
export type { MaskPaintState } from "./mask-paint-policy.ts";
/** Draft coverage only: R3 brush and R7 selection rasterization are reused.
 * Two bounded native surfaces; the visible grayscale canvas is reduced UI only. */
export class FilterMaskSurface {
  readonly width: number;
  readonly height: number;
  private committed: OffscreenCanvas;
  private preview: OffscreenCanvas;
  private state: MaskPaintState | undefined;
  constructor(width: number, height: number) {
    const size = maskPaintSize(width, height);
    this.width = size.width;
    this.height = size.height;
    this.committed = new OffscreenCanvas(1, 1);
    this.preview = new OffscreenCanvas(this.width, this.height);
  }
  paint(state: MaskPaintState, gesture?: Stroke) {
    validateMaskPaintWork(
      gesture ? [...state.strokes, gesture] : state.strokes,
      this.width * this.height,
    );
    if (this.state !== state) {
      validateMaskPaintSelection(state.base, this.width * this.height);
      this.committed.width = this.committed.height = 1;
      this.committed = selectionCanvas(state.base, this.width, this.height, 1);
      const ctx = this.committed.getContext("2d")!;
      for (const s of state.strokes) clippedStroke(ctx, s, this.width, this.height, 1);
      this.state = state;
    }
    const ctx = this.preview.getContext("2d")!;
    ctx.clearRect(0, 0, this.width, this.height);
    ctx.drawImage(this.committed, 0, 0);
    if (gesture) clippedStroke(ctx, gesture, this.width, this.height, 1);
    return this.preview;
  }
  mask(state: MaskPaintState, settings: FilterMask): FilterMask {
    const raw = this.paint(state)
        .getContext("2d")!
        .getImageData(0, 0, this.width, this.height).data,
      alpha = new Uint8Array(this.width * this.height);
    for (let i = 0; i < alpha.length; i++) alpha[i] = raw[i * 4 + 3]!;
    return {
      ...settings,
      selection: {
        regions: [coverageRegion(alpha, this.width, this.height)],
        inverted: false,
        feather: 0,
      },
    };
  }
  dispose() {
    this.committed.width = this.committed.height = this.preview.width = this.preview.height = 1;
  }
}
