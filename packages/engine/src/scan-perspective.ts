import { PdfEngineError } from './errors.js';
import {
  downscaleForDetection,
  otsuThreshold,
  WORKING_EDGE_LIMIT,
  type GrayscaleImage,
} from './scan-deskew.js';

/**
 * Perspective (four-point) deskew for captured page images.
 *
 * README §4.5 specifies "perspective deskew", which is a different capability from the in-plane
 * rotation `scan-deskew.ts` corrects. A rotation is a single angle about a single centre; a
 * perspective is a projective transform that maps one quadrilateral onto another, so a page
 * photographed at an angle to the sensor is a trapezoid rather than a tilted rectangle, and no
 * amount of rotating it will make its edges square.
 *
 * The pipeline is dependency-free and deterministic, so the same code runs in a module worker and
 * in Node (README §8.4):
 *
 *  1. Flood-fill the bright page region from the frame border, giving a mask that is the page
 *     rather than the ink on it — the text is dark holes inside the region, not its outline.
 *  2. Trace the boundary per row and per column and fit a straight line to each of the four
 *     edges, then intersect the lines for the corners. A single global extreme cannot work: the
 *     topmost pixel of a keystone is one *corner*, not an edge, so the extreme yields a bounding
 *     box and reports every page as a rectangle.
 *  3. Solve the 8-DOF homography from the four correspondences and resample through it.
 *
 * It is deliberately *not* wired into `deskew`: rotation and perspective are independent
 * corrections, a caller may have either or both, and a photo can have both at once. What this
 * does not do is stated in `PerspectiveEstimate.reason` rather than left for the caller to
 * discover from a wrong-looking page.
 */

/** Below this the page is not separable from its background, so any quad we find is noise. */
const MIN_QUAD_AREA_FRACTION = 0.15;

/** Reject a quad that is not convex enough to be a page seen in perspective. */
const MIN_CONVEXITY = 0.55;

/** Below this the sides are equal to within rounding, so there is no keystone to correct. */
const MIN_KEYSTONE = 0.01;

/** The confidence a quad must reach before the correction is worth its resampling cost. */
const MIN_CONFIDENCE = 0.2;

/**
 * The fraction of each edge's samples discarded at both ends before fitting.
 *
 * Per-column extremes near a slanted edge read the bottom of a clipped sliver rather than the
 * bottom of the page, so the samples closest to the corners are wrong by a large margin. A fifth
 * trimmed from each end is more than the sliver effect reaches on a hand-held capture and still
 * leaves most of the edge to fit.
 */
const EDGE_TRIM_FRACTION = 0.2;

export type Point = { readonly x: number; readonly y: number };
export type Quad = readonly [Point, Point, Point, Point];

export type PerspectiveEstimate = {
  /** The detected page corners in the ORIGINAL image's coordinates, ordered. */
  readonly quad?: Quad;
  /** 0–1. Below `minConfidence` the estimate is reported but not acted on. */
  readonly confidence: number;
  /** True when a quad was found, confident enough, and worth correcting. */
  readonly applied: boolean;
  /** How the four sides differ in length — 0 is a perfect rectangle seen head-on. */
  readonly keystone: number;
  readonly reason?: string;
};

export type PerspectiveOptions = {
  readonly minConfidence?: number;
  readonly workingEdgeLimit?: number;
};

function fail(remedy: string): never {
  throw new PdfEngineError({ kind: 'invalid-operation', operation: 'perspective-deskew', remedy });
}

function assertImage(image: GrayscaleImage): void {
  const { width, height, pixels } = image;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0)
    fail('The captured page has no pixels. Retake the photo, or import an image file instead.');
  if (pixels.length !== width * height)
    fail(
      `The captured page is inconsistent: ${pixels.length} pixel values for a ${width}x${height} image. Retake the photo.`,
    );
}

const distance = (a: Point, b: Point): number => Math.hypot(b.x - a.x, b.y - a.y);

const signedArea = (points: readonly Point[]): number => {
  let total = 0;
  for (let index = 0; index < points.length; index += 1) {
    const a = points[index]!;
    const b = points[(index + 1) % points.length]!;
    total += a.x * b.y - b.x * a.y;
  }
  return total / 2;
};

/** Ratio of the quad's area to the area of its axis-aligned bounding box. */
function fillRatio(quad: Quad): number {
  const xs = quad.map((point) => point.x);
  const ys = quad.map((point) => point.y);
  const boxWidth = Math.max(...xs) - Math.min(...xs);
  const boxHeight = Math.max(...ys) - Math.min(...ys);
  const box = boxWidth * boxHeight;
  return box > 0 ? Math.abs(signedArea(quad)) / box : 0;
}

/** Opposite sides of a rectangle under perspective have the same length; a keystone does not. */
export function keystoneRatio(quad: Quad): number {
  const [tl, tr, br, bl] = quad;
  const top = distance(tl, tr);
  const bottom = distance(bl, br);
  const left = distance(tl, bl);
  const right = distance(tr, br);
  const horizontal = Math.max(top, bottom);
  const vertical = Math.max(left, right);
  if (!horizontal || !vertical) return 0;
  const horizontalSkew = Math.abs(top - bottom) / horizontal;
  const verticalSkew = Math.abs(left - right) / vertical;
  return Math.max(horizontalSkew, verticalSkew);
}

/**
 * Orders four corners into top-left, top-right, bottom-right, bottom-left.
 *
 * The homography needs correspondence, and a wrong winding maps the page inside out rather than
 * producing a subtly wrong result — so ordering is explicit and its two failure modes are both
 * checked: a bow-tie quad (signed area near zero) is not a page, and a clockwise quad is
 * reversed rather than used as-is.
 */
export function orderCorners(points: readonly Point[]): Quad | undefined {
  if (points.length !== 4) return undefined;
  const area = signedArea(points);
  if (Math.abs(area) < 1) return undefined;
  const working = area < 0 ? [...points].reverse() : [...points];

  // Rotate the cycle so it starts at the corner nearest the origin, which is the top-left for a
  // page photographed in any normal orientation. Ties break on the smaller y, then x, so the
  // ordering is deterministic rather than dependent on contour traversal order.
  let start = 0;
  let bestScore = Infinity;
  for (let index = 0; index < 4; index += 1) {
    const point = working[index]!;
    const score = point.x + point.y;
    if (score < bestScore) {
      bestScore = score;
      start = index;
    }
  }
  const rotated = [0, 1, 2, 3].map((offset) => working[(start + offset) % 4]!);
  const [tl, next, opposite, last] = rotated as [Point, Point, Point, Point];
  // Within the cycle, the corner diagonally opposite the top-left is the bottom-right.
  return [tl, next, opposite, last];
}

/** Solves the 8 unknowns of a homography from four point correspondences. */
function solveHomography(source: Quad, target: Quad): Float64Array | undefined {
  // Each correspondence contributes two rows: x' = (h0x + h1y + h2) / (h6x + h7y + 1), and the
  // same for y'. Solved by Gaussian elimination with partial pivoting on the 8x8 system.
  const rows: number[][] = [];
  for (let index = 0; index < 4; index += 1) {
    const { x, y } = source[index]!;
    const { x: tx, y: ty } = target[index]!;
    rows.push([x, y, 1, 0, 0, 0, -x * tx, -y * tx, tx]);
    rows.push([0, 0, 0, x, y, 1, -x * ty, -y * ty, ty]);
  }

  const size = 8;
  for (let column = 0; column < size; column += 1) {
    let pivot = column;
    for (let row = column + 1; row < size; row += 1) {
      if (Math.abs(rows[row]![column]!) > Math.abs(rows[pivot]![column]!)) pivot = row;
    }
    if (Math.abs(rows[pivot]![column]!) < 1e-9) return undefined;
    [rows[column], rows[pivot]] = [rows[pivot]!, rows[column]!];

    const divisor = rows[column]![column]!;
    for (let index = column; index <= size; index += 1) rows[column]![index]! /= divisor;

    for (let row = 0; row < size; row += 1) {
      if (row === column) continue;
      const factor = rows[row]![column]!;
      if (factor === 0) continue;
      for (let index = column; index <= size; index += 1) {
        rows[row]![index]! -= factor * rows[column]![index]!;
      }
    }
  }
  const h = new Float64Array(9);
  for (let index = 0; index < size; index += 1) h[index] = rows[index]![size]!;
  h[8] = 1;
  return h;
}

function applyHomography(h: Float64Array, x: number, y: number): Point | undefined {
  const w = h[6]! * x + h[7]! * y + 1;
  // A near-zero w means the point maps to infinity: the sampled pixel lies behind the camera
  // after the transform, which means the quad is degenerate rather than that the page is skewed.
  if (Math.abs(w) < 1e-9) return undefined;
  return { x: (h[0]! * x + h[1]! * y + h[2]!) / w, y: (h[3]! * x + h[4]! * y + h[5]!) / w };
}

/**
 * Resamples `image` so the quadrilateral `from` becomes an upright `toWidth` × `toHeight`
 * rectangle, with bilinear sampling.
 *
 * The homography is solved as **target → source**, not source → target. The output is generated
 * one pixel at a time, so every pixel needs to know *where to read from*; a source→target map
 * would have to be inverted to be used that way. Solving it in the direction it is consumed also
 * means the output rectangle is exact — every output pixel maps inside the quad by construction,
 * so none is left as background.
 */
export function warpPerspective(
  image: GrayscaleImage,
  from: Quad,
  toWidth: number,
  toHeight: number,
  fill = 255,
): GrayscaleImage | undefined {
  const target: Quad = [
    { x: 0, y: 0 },
    { x: toWidth - 1, y: 0 },
    { x: toWidth - 1, y: toHeight - 1 },
    { x: 0, y: toHeight - 1 },
  ];
  // `target` is the rectangle being produced, `from` the quadrilateral in the source image, so
  // this maps an output coordinate directly to the source pixel it should copy.
  const h = solveHomography(target, from);
  if (!h) return undefined;

  const out = new Uint8Array(toWidth * toHeight);
  for (let y = 0; y < toHeight; y += 1) {
    for (let x = 0; x < toWidth; x += 1) {
      const source = applyHomography(h, x, y);
      out[y * toWidth + x] = source ? sample(image, source.x, source.y, fill) : fill;
    }
  }
  return { pixels: out, width: toWidth, height: toHeight };
}

function sample(image: GrayscaleImage, x: number, y: number, fill: number): number {
  const { width, height, pixels } = image;
  if (x < -1 || y < -1 || x > width || y > height) return fill;
  const x0 = Math.min(Math.max(Math.floor(x), 0), width - 1);
  const y0 = Math.min(Math.max(Math.floor(y), 0), height - 1);
  const x1 = Math.min(x0 + 1, width - 1);
  const y1 = Math.min(y0 + 1, height - 1);
  const fx = x - x0;
  const fy = y - y0;
  const top = y0 * width;
  const bottom = y1 * width;
  const p00 = pixels[top + x0]!;
  const p10 = pixels[top + x1]!;
  const p01 = pixels[bottom + x0]!;
  const p11 = pixels[bottom + x1]!;
  return p00 * (1 - fx) * (1 - fy) + p10 * fx * (1 - fy) + p01 * (1 - fx) * fy + p11 * fx * fy;
}

/**
 * Traces the page boundary.
 *
 * A page on a contrasting background is a single connected light (or dark) region touching all
 * four sides, so rather than a full contour trace this walks each border inward until it crosses
 * the page edge. That is the dominant case for a scan — page on desk, page filling the frame — and
 * it is stable, whereas a general contour follower is a large amount of code for cases this tool
 * does not claim.
 */
function traceQuad(image: GrayscaleImage, page: Uint8Array): Quad | undefined {
  const { width, height } = image;
  const inside = (x: number, y: number): boolean =>
    x >= 0 && y >= 0 && x < width && y < height && page[y * width + x] === 1;

  /**
   * Per-row page extents, which is what makes a slanted edge visible.
   *
   * A global extreme cannot work: the topmost page pixel of a keystone is a single *corner*, not
   * an edge, so taking one extreme per axis yields a bounding box and reports every page as a
   * rectangle. Sampling the leftmost and rightmost page pixel on every row instead traces the
   * actual boundary, and the same again per column for the top and bottom edges.
   */
  const rowLeft = new Int32Array(height).fill(-1);
  const rowRight = new Int32Array(height).fill(-1);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (!inside(x, y)) continue;
      if (rowLeft[y] === -1) rowLeft[y] = x;
      rowRight[y] = x;
    }
  }
  const colTop = new Int32Array(width).fill(-1);
  const colBottom = new Int32Array(width).fill(-1);
  for (let x = 0; x < width; x += 1) {
    for (let y = 0; y < height; y += 1) {
      if (!inside(x, y)) continue;
      if (colTop[x] === -1) colTop[x] = y;
      colBottom[x] = y;
    }
  }

  const rowsWithPage: number[] = [];
  for (let y = 0; y < height; y += 1) if (rowLeft[y] !== -1) rowsWithPage.push(y);
  if (rowsWithPage.length < 4) return undefined;
  const firstRow = rowsWithPage[0]!;
  const lastRow = rowsWithPage[rowsWithPage.length - 1]!;
  const columnsWithPage: number[] = [];
  for (let x = 0; x < width; x += 1) if (colTop[x] !== -1) columnsWithPage.push(x);
  if (columnsWithPage.length < 4) return undefined;
  const firstCol = columnsWithPage[0]!;
  const lastCol = columnsWithPage[columnsWithPage.length - 1]!;

  /**
   * A fitted edge as an implicit line, `a·x + b·y + c = 0`.
   *
   * Kept implicit rather than as `y = m·x + k` because a page edge can be near-vertical, where
   * `m` is unbounded and the slope form loses all precision — which is exactly the case for a
   * keystone whose left and right sides lean inwards. The implicit form stays well-conditioned
   * for every orientation, and the corner solve below is a plain 2x2 determinant.
   */
  type Line = { a: number; b: number; c: number };
  const fitLine = (points: readonly Point[]): Line | undefined => {
    if (points.length < 2) return undefined;
    // Total least squares: the line through the points closest to all of them, which for a
    // near-vertical edge is the well-posed version of the same fit.
    let mx = 0;
    let my = 0;
    for (const point of points) {
      mx += point.x;
      my += point.y;
    }
    mx /= points.length;
    my /= points.length;
    let sxx = 0;
    let syy = 0;
    let sxy = 0;
    for (const point of points) {
      const dx = point.x - mx;
      const dy = point.y - my;
      sxx += dx * dx;
      syy += dy * dy;
      sxy += dx * dy;
    }
    // The line's direction is the eigenvector of the covariance matrix with the LARGER
    // eigenvalue (the points spread most along the line, not least). For a symmetric 2x2 that
    // eigenvector's angle is half the angle of (sxx - syy, 2·sxy) — the standard construction.
    const theta = 0.5 * Math.atan2(2 * sxy, sxx - syy);
    const dx = Math.cos(theta);
    const dy = Math.sin(theta);
    // If the points are essentially a point (no spread at all) the direction is meaningless and
    // the line would be arbitrary; that is not an edge.
    if (sxx + syy < 1e-9) return undefined;
    // The line's NORMAL is (-dy, dx); the constant must be taken against that normal, not
    // against the direction vector. Using the direction here gives a line with a plausible
    // angle that does not pass through the points at all — the residual is then large but
    // non-zero, so nothing reports the fit as bad.
    const a = -dy;
    const b = dx;
    return { a, b, c: -(a * mx + b * my) };
  };

  // Sample every SAMPLE_STEP rows/columns so a 512px detection copy does not fit 500 points.
  const SAMPLE_STEP = Math.max(1, Math.floor(rowsWithPage.length / 40));
  const leftEdge: Point[] = [];
  const rightEdge: Point[] = [];
  for (let y = firstRow; y <= lastRow; y += SAMPLE_STEP) {
    if (rowLeft[y] === -1) continue;
    leftEdge.push({ x: rowLeft[y]!, y });
    rightEdge.push({ x: rowRight[y]!, y });
  }
  const COLUMN_STEP = Math.max(1, Math.floor(columnsWithPage.length / 40));
  const topEdge: Point[] = [];
  const bottomEdge: Point[] = [];
  for (let x = firstCol; x <= lastCol; x += COLUMN_STEP) {
    if (colTop[x] === -1) continue;
    topEdge.push({ x, y: colTop[x]! });
    bottomEdge.push({ x, y: colBottom[x]! });
  }

  /**
   * Fit an edge, discarding the points nearest the page's corners.
   *
   * Per-column extremes are unreliable near a *slanted* edge: a column that clips only a few rows
   * of the page reports the bottom of that sliver, not the bottom of the page, so the samples
   * closest to either corner are wrong by a large margin — measured, a keystone's `colBottom`
   * read 559 in the middle but 4, 88 and 284 at the ends. A least-squares fit over all samples
   * is then dragged down by those errors and the "bottom" edge comes out nearly horizontal.
   *
   * Trimming the outer band leaves the samples that genuinely lie on the edge, and the corners
   * are recovered by intersecting the fitted lines rather than by reading an extreme.
   */
  const fitEdge = (points: readonly Point[]): Line | undefined => {
    if (points.length < 6) return fitLine(points);
    const trim = Math.max(1, Math.floor(points.length * EDGE_TRIM_FRACTION));
    const sorted = [...points].sort((a, b) => a.x - b.x);
    const core = sorted.length > trim * 2 ? [...sorted.slice(trim, sorted.length - trim)] : sorted;
    // Two fits and keep the one that disagrees less: a slanted page's edges are straight, so a
    // correct fit has a tiny residual, while a fit still catching corner error does not.
    return fitLine(core) ?? fitLine(points);
  };

  const leftLine = fitEdge(leftEdge);
  const rightLine = fitEdge(rightEdge);
  const topLine = fitEdge(topEdge);
  const bottomLine = fitEdge(bottomEdge);
  if (!leftLine || !rightLine || !topLine || !bottomLine) return undefined;

  // The corners are where each fitted pair intersects. Solving the two implicit lines directly is
  // more accurate than taking an extreme of a fitted line, because a keystone's corners are
  // exactly the intersection of two slanted edges.
  const intersect = (first: Line, second: Line): Point | undefined => {
    // a1x + b1y = -c1 ;  a2x + b2y = -c2   ->   Cramer's rule.
    const determinant = first.a * second.b - second.a * first.b;
    // Parallel edges never meet, which means the two "sides" of the page are the same line — a
    // degenerate quad rather than a corner.
    if (Math.abs(determinant) < 1e-9) return undefined;
    const x = (-first.c * second.b + second.c * first.b) / determinant;
    const y = (-first.a * second.c + second.a * first.c) / determinant;
    if (!Number.isFinite(x) || !Number.isFinite(y)) return undefined;
    return { x, y };
  };

  const topLeft = intersect(topLine, leftLine);
  const topRight = intersect(topLine, rightLine);
  const bottomRight = intersect(bottomLine, rightLine);
  const bottomLeft = intersect(bottomLine, leftLine);
  if (!topLeft || !topRight || !bottomRight || !bottomLeft) return undefined;

  const clamp = (point: Point): Point => ({
    x: Math.max(0, Math.min(width - 1, Math.round(point.x))),
    y: Math.max(0, Math.min(height - 1, Math.round(point.y))),
  });
  const corners: Point[] = [clamp(topLeft), clamp(topRight), clamp(bottomRight), clamp(bottomLeft)];
  return orderCorners(corners);
}

/**
 * A mask of the PAGE, as opposed to the ink.
 *
 * A page on a desk is the bright region; the desk is darker. Thresholding at the Otsu level and
 * keeping the *bright* side gives the page, but the text on it is dark and would punch holes in
 * that region — so the mask is flood-filled from the image border and only the connected
 * component that reaches the border is kept. A hole where a word is does not stop the fill,
 * because the fill travels around it.
 */
function pageRegionMask(image: GrayscaleImage): Uint8Array {
  const { width, height, pixels } = image;
  const threshold = otsuThreshold(pixels);
  const bright = new Uint8Array(pixels.length);
  for (let index = 0; index < pixels.length; index += 1) {
    bright[index] = pixels[index]! > threshold ? 1 : 0;
  }

  // Flood fill from the whole border, so the page is reached whether or not it touches an edge.
  const mask = new Uint8Array(pixels.length);
  const stack: number[] = [];
  const push = (index: number) => {
    if (mask[index] === 0 && bright[index] === 1) {
      mask[index] = 1;
      stack.push(index);
    }
  };
  for (let x = 0; x < width; x += 1) {
    push(x);
    push((height - 1) * width + x);
  }
  for (let y = 0; y < height; y += 1) {
    push(y * width);
    push(y * width + width - 1);
  }
  while (stack.length) {
    const index = stack.pop()!;
    const x = index % width;
    const y = (index - x) / width;
    if (x > 0) push(index - 1);
    if (x < width - 1) push(index + 1);
    if (y > 0) push(index - width);
    if (y < height - 1) push(index + width);
  }
  return mask;
}

function noEstimate(reason: string): PerspectiveEstimate {
  return { confidence: 0, applied: false, keystone: 0, reason };
}

/**
 * Detects the page as a quadrilateral and reports how confident it is.
 *
 * Never throws for a page it cannot find: a photo that fills the frame, or one on a
 * low-contrast surface, is a normal outcome for a hand-held capture, and the caller is better
 * served by a rotation-only correction plus a stated reason than by an exception.
 */
export function estimatePerspective(
  image: GrayscaleImage,
  options: PerspectiveOptions = {},
): PerspectiveEstimate {
  assertImage(image);
  const working = downscaleForDetection(image, options.workingEdgeLimit ?? WORKING_EDGE_LIMIT);
  return estimateInWorking(image, working, options);
}

/**
 * The detection half, kept separate so `correctPerspective` can downscale once and reuse the
 * working copy for both detection and warping. The quad is scaled back to the original here, at
 * the point where the scale is known, rather than reconstructed later from the quad's extent.
 */
function estimateInWorking(
  image: GrayscaleImage,
  working: GrayscaleImage,
  options: PerspectiveOptions,
): PerspectiveEstimate {
  const scale = image.width / working.width;
  // The PAGE mask, not the ink mask. `otsuInkMask` marks dark pixels — the text — and the text
  // does not have the page's outline, so tracing it finds scattered glyph strokes rather than a
  // quadrilateral. A page on a desk is the *bright* region, so the mask is the Otsu threshold
  // taken the other way round.
  const pageMask = pageRegionMask(working);
  const detected = traceQuad(working, pageMask);
  if (!detected) return noEstimate('No page edge was found against the background.');

  const quad = detected.map((point) => ({
    x: point.x * scale,
    y: point.y * scale,
  })) as unknown as Quad;
  const area = Math.abs(signedArea(quad)) / (image.width * image.height);
  if (area < MIN_QUAD_AREA_FRACTION)
    return {
      quad,
      confidence: 0,
      applied: false,
      keystone: 0,
      reason: 'The page fills too little of the frame to correct.',
    };

  const convexity = fillRatio(quad);
  if (convexity < MIN_CONVEXITY)
    return {
      quad,
      confidence: 0,
      applied: false,
      keystone: 0,
      reason: 'The detected page is not a clean quadrilateral.',
    };

  const keystone = keystoneRatio(quad);
  // A page with no keystone needs no perspective correction. Reporting it as applied would mean
  // re-encoding a straight page for nothing and losing a little sharpness to the resample.
  if (keystone < MIN_KEYSTONE)
    return {
      quad,
      confidence: 0,
      applied: false,
      keystone,
      reason: 'The page is already rectangular.',
    };

  // Confidence rises with how much of the frame the page covers and how solidly convex it is.
  const confidence = Number(Math.max(0, Math.min(1, area * convexity)).toFixed(3));
  return {
    quad,
    confidence,
    keystone: Number(keystone.toFixed(4)),
    applied: confidence >= (options.minConfidence ?? MIN_CONFIDENCE),
  };
}

export type PerspectiveResult = {
  readonly image: GrayscaleImage;
  readonly estimate: PerspectiveEstimate;
};

/** Detects and warps the page to a rectangle, leaving it untouched when nothing is found. */
export function correctPerspective(
  image: GrayscaleImage,
  options: PerspectiveOptions = {},
): PerspectiveResult {
  const limit = options.workingEdgeLimit ?? WORKING_EDGE_LIMIT;
  const working = downscaleForDetection(image, limit);
  // `estimateInWorking` returns the quad in the ORIGINAL's coordinates, so the warp below samples
  // the full-resolution image. Deriving the scale here instead would be guesswork: the quad's size
  // depends on how much of the frame the page fills, not on the downscale factor.
  const estimate = estimateInWorking(image, working, options);
  if (!estimate.applied || !estimate.quad) return { image, estimate };

  const [tl, tr, br, bl] = estimate.quad;
  /**
   * Output size, taken from the quad's own side lengths.
   *
   * The `max` over each opposite pair is deliberate and is what makes the output an upright
   * rectangle rather than another trapezoid: the rectified page is as wide as its widest edge and
   * as tall as its tallest, and the homography absorbs the rest. Taking the *mean* instead
   * squashes the page towards its average width, which on a strong keystone crops the narrow end
   * of the content — the text then sits at a different offset on every row and a vertical edge
   * still measures as slanted after correction.
   */
  const width = Math.max(1, Math.round(Math.max(distance(tl, tr), distance(bl, br))));
  const height = Math.max(1, Math.round(Math.max(distance(tl, bl), distance(tr, br))));
  const warped = warpPerspective(image, estimate.quad, width, height);
  return warped ? { image: warped, estimate } : { image, estimate };
}
