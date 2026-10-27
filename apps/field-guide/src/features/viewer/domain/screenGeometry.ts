export interface Size {
  readonly width: number;
  readonly height: number;
}

/** A part's place on screen, in points from the viewport's top left. */
export interface ScreenBox {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}
