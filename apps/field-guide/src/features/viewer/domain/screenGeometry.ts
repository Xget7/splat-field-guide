export interface Size {
  readonly width: number;
  readonly height: number;
}

/** Before the first layout, nothing has a size. */
export const NO_SIZE: Size = { width: 0, height: 0 };

/** A part's place on screen, in points from the viewport's top left. */
export interface ScreenBox {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}
