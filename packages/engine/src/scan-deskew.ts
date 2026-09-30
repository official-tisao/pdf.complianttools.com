import { PdfEngineError } from './errors.js';
import { runInModuleWorker } from './runtime/module-worker.js';

/**
 * In-plane rotation deskew for captured page images.
 *
 * This corrects rotation only — the small tilt a page picks up when it is
 * photographed on a flat surface, which is the dominant case for a phone scan.
 * It is deliberately not a projective warp: four-point document detection and the
 * homography live in `scan-perspective.ts`, because a photo can have both a tilt
 * and a perspective and the two corrections are independent. A caller that has
 * both runs this and then `correctPerspective`.
 *
 * The estimate uses the classical projection-profile method (Postl). Text lines
 * that are horizontal stack into the same rows, so the row-sum profile is
 * sharpest there, and the angle maximising profile variance is the skew. The
 * algorithm is deterministic, dependency-free, and touches no DOM, so the same
 * code runs in a module worker and in Node (README §8.4).
 */

/** Luma coefficients (Rec. 709), applied per channel when a caller hands us colour pixels. */
const LUMA_R = 0.2126;
const LUMA_G = 0.7152;
const LUMA_B = 0.0722;

/** Beyond this the page is not "slightly askew", and the caller should be told rather than corrected. */
const MAX_SEARCH_ANGLE_DEGREES = 15;
const ANGLE_STEP_DEGREES = 0.1;

/** Detection runs on a downscaled copy; the correction always runs at full resolution. */
export const WORKING_EDGE_LIMIT = 512;

/** Below this the rotation is invisible and re-encoding the image is not worth the quality loss. */
const MIN_APPLIED_ANGLE_DEGREES = 0.25;

/** A page with almost no ink has no lines to align, so any angle we returned would be noise. */
const MIN_INK_FRACTION = 0.002;
const MIN_INK_PIXELS = 200;

export type GrayscaleImage = {
  readonly pixels: Uint8Array;
  readonly width: number;
  readonly height: number;
};

export type SkewOptions = {
  readonly maxAngleDegrees?: number;
  readonly angleStepDegrees?: number;
  readonly workingEdgeLimit?: number;
  readonly minAngleDegrees?: number;
};

export type SkewEstimate = {
  /** Degrees the image must be rotated by, with the sign of `rotateGrayscale`. */
  readonly angleDegrees: number;
  /** 0–1; how far the winning profile stands out from the mean profile. */
  readonly confidence: number;
  /** False when the estimate is too weak or too small to act on. */
  readonly applied: boolean;
};

export type DeskewResult = {
  readonly image: GrayscaleImage;
  readonly estimate: SkewEstimate;
};

/**
 * Runs `deskew` somewhere other than the calling thread.
 *
 * The default is a module worker, which is what the capture UI wants: a large
 * page is a multi-megabyte buffer, and §8.4 requires the main thread to hold
 * only thumbnails and UI state. The seam is injectable so the contract can be
 * exercised in Node, where `Worker` does not exist, and so a caller can supply
 * its own execution context.
 */
export type DeskewRunner = (image: GrayscaleImage, signal?: AbortSignal) => Promise<DeskewResult>;

/** The worker-backed default. Rejects with a typed error where `Worker` is missing. */
export const deskewInModuleWorker: DeskewRunner = async (image, signal) => {
  if (typeof Worker === 'undefined')
    throw new PdfEngineError({
      kind: 'unsupported-feature',
      feature: 'deskew worker',
      remedy:
        'This runtime has no Web Worker, so the page cannot be deskewed off the main thread. Use a browser with module-worker support, or deskew synchronously.',
    });
  if (signal?.aborted) throw new DOMException('The task was aborted.', 'AbortError');
  // Transfer rather than copy, per §8.4: the caller's buffer is detached, so
  // callers must treat `image.pixels` as consumed by this call.
  const pixels = image.pixels.slice();
  return runInModuleWorker<ArrayBuffer, DeskewResult>(
    new URL('./scan-deskew.worker.js', import.meta.url),
    pixels.buffer as ArrayBuffer,
    [pixels.buffer as ArrayBuffer],
    signal,
  );
};

/**
 * Deskews off the main thread when a worker is available, falling back to the
 * synchronous implementation when one is not.
 *
 * A caller that injects a `runner` is taken at its word: the runner owns its own
 * execution context, so the absence of an ambient `Worker` global says nothing
 * about whether it can do the work. Gating on that global would make the seam
 * untestable in exactly the environment — Node — where it has to be tested.
 *
 * The fallback is a deliberate, documented degradation, not a silent one: the
 * result carries `ranInWorker: false` so the caller can say so. A user on an old
 * browser gets a corrected page on the main thread; they are never told a
 * worker ran when it did not.
 */
export async function deskewInWorker(
  image: GrayscaleImage,
  signal?: AbortSignal,
  runner?: DeskewRunner,
): Promise<DeskewResult & { ranInWorker: boolean }> {
  if (signal?.aborted) throw new DOMException('The task was aborted.', 'AbortError');
  if (runner) return { ...(await runner(image, signal)), ranInWorker: true };
  if (typeof Worker === 'undefined') return { ...deskew(image), ranInWorker: false };
  return { ...(await deskewInModuleWorker(image, signal)), ranInWorker: true };
}

function fail(remedy: string): never {
  throw new PdfEngineError({ kind: 'invalid-operation', operation: 'deskew', remedy });
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

/** Converts 3- or 4-channel 8-bit pixels to one luminance byte per pixel. */
export function toGrayscale(
  pixels: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
  channels: 3 | 4 = 4,
): GrayscaleImage {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0)
    fail('The captured page has no pixels. Retake the photo, or import an image file instead.');
  if (pixels.length !== width * height * channels)
    fail(
      `The captured page is inconsistent: ${pixels.length} values for a ${width}x${height} image with ${channels} channels per pixel.`,
    );
  const out = new Uint8Array(width * height);
  const stride = width * height;
  for (let index = 0; index < stride; index += 1) {
    const at = index * channels;
    out[index] = (LUMA_R * pixels[at]! + LUMA_G * pixels[at + 1]! + LUMA_B * pixels[at + 2]!) | 0;
  }
  return { pixels: out, width, height };
}

/** Box-filter downscale. Detection only needs the line structure, not the glyph detail. */
export function downscaleForDetection(image: GrayscaleImage, limit: number): GrayscaleImage {
  const longest = Math.max(image.width, image.height);
  if (longest <= limit) return image;
  const width = Math.max(1, Math.round((image.width * limit) / longest));
  const height = Math.max(1, Math.round((image.height * limit) / longest));
  const out = new Uint8Array(width * height);
  for (let y = 0; y < height; y += 1) {
    const y0 = Math.floor((y * image.height) / height);
    const y1 = Math.max(y0 + 1, Math.ceil(((y + 1) * image.height) / height));
    for (let x = 0; x < width; x += 1) {
      const x0 = Math.floor((x * image.width) / width);
      const x1 = Math.max(x0 + 1, Math.ceil(((x + 1) * image.width) / width));
      let total = 0;
      let count = 0;
      for (let sy = y0; sy < y1; sy += 1) {
        const row = sy * image.width;
        for (let sx = x0; sx < x1; sx += 1) {
          total += image.pixels[row + sx]!;
          count += 1;
        }
      }
      out[y * width + x] = (total / count) | 0;
    }
  }
  return { pixels: out, width, height };
}

/** Otsu's method: the threshold maximising between-class variance. */
export function otsuThreshold(pixels: Uint8Array): number {
  const histogram = new Uint32Array(256);
  for (let index = 0; index < pixels.length; index += 1) histogram[pixels[index]!]! += 1;
  const total = pixels.length;
  let totalSum = 0;
  for (let level = 0; level < 256; level += 1) totalSum += level * histogram[level]!;
  let backgroundWeight = 0;
  let backgroundSum = 0;
  let bestVariance = -1;
  let threshold = 127;
  for (let level = 0; level < 256; level += 1) {
    backgroundWeight += histogram[level]!;
    if (backgroundWeight === 0) continue;
    const foregroundWeight = total - backgroundWeight;
    if (foregroundWeight === 0) break;
    backgroundSum += level * histogram[level]!;
    const backgroundMean = backgroundSum / backgroundWeight;
    const foregroundMean = (totalSum - backgroundSum) / foregroundWeight;
    const variance = backgroundWeight * foregroundWeight * (backgroundMean - foregroundMean) ** 2;
    if (variance > bestVariance) {
      bestVariance = variance;
      threshold = level;
    }
  }
  return threshold;
}

type InkPoints = { readonly xs: Int32Array; readonly ys: Int32Array; readonly count: number };

/**
 * An Otsu-thresholded ink mask, one byte per pixel.
 *
 * Exported for the perspective detector, which needs the same "dark against light" decision but
 * as a filled region rather than a point list: tracing a page boundary asks which pixels are
 * *page*, which is the complement of the ink the rotation estimator looks for.
 */
export function otsuInkMask(image: GrayscaleImage): Uint8Array {
  const threshold = otsuThreshold(image.pixels);
  const mask = new Uint8Array(image.pixels.length);
  for (let index = 0; index < image.pixels.length; index += 1) {
    mask[index] = image.pixels[index]! <= threshold ? 1 : 0;
  }
  return mask;
}

function collectInk(image: GrayscaleImage): InkPoints {
  const threshold = otsuThreshold(image.pixels);
  const { width, height, pixels } = image;
  const xs = new Int32Array(pixels.length);
  const ys = new Int32Array(pixels.length);
  let count = 0;
  for (let y = 0; y < height; y += 1) {
    const row = y * width;
    for (let x = 0; x < width; x += 1) {
      if (pixels[row + x]! <= threshold) {
        xs[count] = x;
        ys[count] = y;
        count += 1;
      }
    }
  }
  return { xs, ys, count };
}

/**
 * Projection-profile variance for every candidate angle.
 *
 * The bin count is fixed across the whole sweep rather than recomputed per
 * angle. The rotated y-extent `|h·cos| + |w·sin|` grows with the angle, so
 * per-angle bins would give wider angles more bins and a spuriously higher
 * variance. Sharing one bin count keeps the scores directly comparable; the
 * per-angle origin below is what keeps every projection inside those bins.
 */
function scoreAngles(
  ink: InkPoints,
  width: number,
  height: number,
  angles: Float64Array,
  bins: number,
): Float64Array {
  const { xs, ys, count } = ink;
  const scores = new Float64Array(angles.length);
  const profile = new Float64Array(bins);
  for (let index = 0; index < angles.length; index += 1) {
    const radians = (angles[index]! * Math.PI) / 180;
    const cos = Math.cos(radians);
    const sin = Math.sin(radians);
    // Per-angle origin. The projection must be taken about the image centre:
    // raw pixel coordinates are not centred on zero, so projecting them directly
    // shifts the whole profile by (h/2, w/2) and pushes the content past the end
    // of the bin array, where it clamps into the edge bins and manufactures a
    // spurious peak that grows with the angle.
    //
    // With coordinates measured from the centre, a point is within
    // (h/2)|cos| + (w/2)|sin| of zero, so adding half of that extent maps every
    // projection onto [0, extent] and nothing can fall outside the array.
    const centreY = height / 2;
    const centreX = width / 2;
    const origin = (Math.abs(height * cos) + Math.abs(width * sin)) / 2;
    profile.fill(0);
    for (let point = 0; point < count; point += 1) {
      // Project each ink pixel onto the axis perpendicular to the candidate text
      // direction. At the true skew, points on one text line share a projection.
      const projected = (ys[point]! - centreY) * cos - (xs[point]! - centreX) * sin + origin;
      const bin = projected < 0 ? 0 : projected >= bins ? bins - 1 : projected | 0;
      profile[bin]! += 1;
    }
    // Two-pass variance. The usual sum(x^2) - n*mean^2 shortcut is unusable
    // here: a document's profile is sparse relative to the bin count, so the two
    // terms are of similar magnitude and their difference is rounding noise.
    let sum = 0;
    for (let bin = 0; bin < bins; bin += 1) sum += profile[bin]!;
    const mean = sum / bins;
    let variance = 0;
    for (let bin = 0; bin < bins; bin += 1) {
      const delta = profile[bin]! - mean;
      variance += delta * delta;
    }
    // Divided by bins^2 so every angle is scored on the same scale.
    scores[index] = variance / (bins * bins);
  }
  return scores;
}

/** Parabolic sub-step refinement around the winning index. */
function refine(angles: Float64Array, scores: Float64Array, best: number): number {
  if (best <= 0 || best >= scores.length - 1) return angles[best]!;
  const left = scores[best - 1]!;
  const centre = scores[best]!;
  const right = scores[best + 1]!;
  const denominator = left - 2 * centre + right;
  if (denominator === 0) return angles[best]!;
  const offset = (0.5 * (left - right)) / denominator;
  const step = angles[1]! - angles[0]!;
  return angles[best]! + Math.max(-1, Math.min(1, offset)) * step;
}

function noEstimate(): SkewEstimate {
  return { angleDegrees: 0, confidence: 0, applied: false };
}

export function estimateSkew(image: GrayscaleImage, options: SkewOptions = {}): SkewEstimate {
  assertImage(image);
  const maxAngle = Math.min(Math.abs(options.maxAngleDegrees ?? MAX_SEARCH_ANGLE_DEGREES), 89);
  const step = Math.abs(options.angleStepDegrees ?? ANGLE_STEP_DEGREES);
  const working = downscaleForDetection(
    image,
    Math.max(16, options.workingEdgeLimit ?? WORKING_EDGE_LIMIT),
  );
  const ink = collectInk(working);
  const minimumInk = Math.max(
    MIN_INK_PIXELS,
    Math.floor(working.width * working.height * MIN_INK_FRACTION),
  );
  if (ink.count < minimumInk) return noEstimate();

  const count = Math.floor((2 * maxAngle) / step) + 1;
  const angles = new Float64Array(count);
  for (let index = 0; index < count; index += 1) angles[index] = -maxAngle + index * step;

  let largestSpan = 0;
  for (let index = 0; index < angles.length; index += 1) {
    const radians = (angles[index]! * Math.PI) / 180;
    const span =
      Math.abs(working.height * Math.cos(radians)) + Math.abs(working.width * Math.sin(radians));
    if (span > largestSpan) largestSpan = span;
  }
  const bins = Math.max(2, Math.ceil(largestSpan) + 1);
  const scores = scoreAngles(ink, working.width, working.height, angles, bins);

  let best = 0;
  let bestScore = -Infinity;
  let total = 0;
  for (let index = 0; index < scores.length; index += 1) {
    const score = scores[index]!;
    total += score;
    if (score > bestScore) {
      bestScore = score;
      best = index;
    }
  }
  if (!(bestScore > 0)) return noEstimate();

  // Confidence is how far the winner stands above the average candidate. A page
  // of unstructured ink scores the same at every angle and correctly reports 0.
  const average = total / scores.length;
  const confidence =
    average > 0 ? Math.max(0, Math.min(1, (bestScore - average) / (bestScore + average))) : 0;
  const angleDegrees = Number(refine(angles, scores, best).toFixed(3));
  const minimum = Math.abs(options.minAngleDegrees ?? MIN_APPLIED_ANGLE_DEGREES);
  return {
    angleDegrees,
    confidence: Number(confidence.toFixed(3)),
    applied: Math.abs(angleDegrees) >= minimum,
  };
}

/**
 * Rotates about the image centre with bilinear sampling, then crops to the
 * largest axis-aligned rectangle that fits inside the rotated page, so the
 * correction never leaves black wedges along two edges.
 *
 * Positive degrees turn the content anticlockwise as displayed.
 */
export function rotateGrayscale(
  image: GrayscaleImage,
  degrees: number,
  fill = 255,
): GrayscaleImage {
  assertImage(image);
  if (!Number.isFinite(degrees))
    fail('The deskew angle was not a number, so the page cannot be corrected. Retake the photo.');

  const radians = (degrees * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const absCos = Math.abs(cos);
  const absSin = Math.abs(sin);
  let cropWidth = Math.floor(image.width * absCos - image.height * absSin);
  let cropHeight = Math.floor(image.height * absCos - image.width * absSin);
  if (cropWidth < 1 || cropHeight < 1) {
    // Past the point where any upright rectangle fits; keep the full frame and
    // let the fill colour mark the corners rather than silently cropping to 1px.
    cropWidth = image.width;
    cropHeight = image.height;
  }

  const out = new Uint8Array(cropWidth * cropHeight);
  const centreX = image.width / 2;
  const centreY = image.height / 2;
  const outCentreX = cropWidth / 2;
  const outCentreY = cropHeight / 2;
  for (let y = 0; y < cropHeight; y += 1) {
    const dy = y + 0.5 - outCentreY;
    for (let x = 0; x < cropWidth; x += 1) {
      const dx = x + 0.5 - outCentreX;
      const sx = centreX + dx * cos + dy * sin;
      const sy = centreY - dx * sin + dy * cos;
      out[y * cropWidth + x] = sampleBilinear(image, sx - 0.5, sy - 0.5, fill);
    }
  }
  return { pixels: out, width: cropWidth, height: cropHeight };
}

function sampleBilinear(image: GrayscaleImage, x: number, y: number, fill: number): number {
  const { width, height, pixels } = image;
  if (x < -1 || y < -1 || x > width || y > height) return fill;
  // Clamped into the image, so a sample landing exactly on the far edge cannot
  // read past the last row and wrap into the next one.
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
 * Detects and corrects rotation in one call. The image is returned untouched
 * when the estimate is too weak to act on, so a blank or unstructured page is
 * never degraded by a correction we do not believe.
 */
export function deskew(image: GrayscaleImage, options: SkewOptions = {}): DeskewResult {
  const estimate = estimateSkew(image, options);
  return {
    image: estimate.applied ? rotateGrayscale(image, -estimate.angleDegrees) : image,
    estimate,
  };
}
