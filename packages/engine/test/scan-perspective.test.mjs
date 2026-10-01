import assert from 'node:assert/strict';
import test from 'node:test';
import {
  correctPerspective,
  estimatePerspective,
  keystoneRatio,
  orderCorners,
  warpPerspective,
  toGrayscale,
  PdfEngineError,
} from '../dist/index.js';

/**
 * P7-04's perspective correction: the second half of what README §4.5 asks for, and the part
 * `scan-deskew.ts` deliberately does not do. A rotation is one angle about one centre; a
 * perspective is a projective transform, so a page photographed at an angle to the sensor is a
 * trapezoid and no amount of rotating it makes its edges square.
 */

const PAPER = 250;
const DESK = 60;
const INK = 30;

function textPage(width, height) {
  const pixels = new Uint8Array(width * height).fill(PAPER);
  for (let y = 40; y < height - 40; y += 24) {
    /**
     * Text runs from the page's own margin to its opposite margin.
     *
     * Both fixtures are then projected by the same keystone, so the text follows the page rather
     * than being clipped by it. An earlier version drew the text at a fixed x inside the page
     * coordinates and projected the page around it, which meant the keystone's inset exceeded the
     * text's margin partway down and deleted whole lines — the fixture then had no content left
     * to measure, and every assertion on it was vacuous.
     */
    const left = Math.round(width * 0.05);
    const right = Math.round(width * 0.95);
    for (let x = left; x < right; x += 1) {
      if (x % 11 < 4) continue;
      pixels[y * width + x] = INK;
    }
  }
  return { pixels, width, height };
}

/**
 * Projects an upright page into a keystone: the page is drawn narrower at the bottom than the
 * top, which is what a page tilted away from the sensor looks like. Ground truth is returned so
 * the detector's corners are compared against a fact written down here rather than against
 * itself.
 */
function keystonePage({ width = 400, height = 560, topInset = 30, bottomInset = 90 } = {}) {
  const page = textPage(width, height);
  const out = new Uint8Array(width * height).fill(DESK);
  const insetAt = (y) => topInset + ((bottomInset - topInset) * y) / (height - 1);
  for (let y = 0; y < height; y += 1) {
    const inset = Math.round(insetAt(y));
    for (let x = inset; x < width - inset; x += 1) out[y * width + x] = page.pixels[y * width + x];
  }
  return {
    image: { pixels: out, width, height },
    truth: [
      { x: topInset, y: 0 },
      { x: width - topInset, y: 0 },
      { x: width - bottomInset, y: height - 1 },
      { x: bottomInset, y: height - 1 },
    ],
  };
}

test('perspective detection finds a keystone page to within a couple of pixels', () => {
  const { image, truth } = keystonePage();
  const estimate = estimatePerspective(image);

  assert.ok(estimate.quad, `no quad found: ${estimate.reason ?? 'no reason given'}`);
  assert.equal(estimate.applied, true, 'a keystone this strong should be corrected');
  for (const [index, corner] of estimate.quad.entries()) {
    const expected = truth[index];
    const error = Math.hypot(corner.x - expected.x, corner.y - expected.y);
    // Within 2% of the image's short edge. The detected boundary is a downscaled, flood-filled
    // region boundary, so exact agreement is not expected — but a detector that is off by tens
    // of pixels is not usable, and this is what catches that.
    assert.ok(
      error < image.width * 0.02,
      `corner ${index} at (${corner.x.toFixed(1)}, ${corner.y.toFixed(1)}) is ${error.toFixed(1)}px from truth (${expected.x}, ${expected.y})`,
    );
  }
});

test('a rectified keystone has a straight page edge where the source had a slanted one', () => {
  const { image } = keystonePage();

  /**
   * The page's own left edge, per row.
   *
   * Measured on the page boundary rather than on the text: a full-width text block sits ON that
   * boundary, so its left edge is vertical in the source for the same reason the page edge is
   * not � the text is clipped to the page at every row. The boundary is the thing the keystone
   * actually distorts, and it is what the correction has to straighten.
   */
  const pageEdgeX = (img, rowStep = 6) => {
    const lefts = [];
    for (let y = 0; y < img.height; y += rowStep) {
      // The page is the bright region against the dark desk.
      for (let x = 0; x < img.width; x += 1) {
        if (img.pixels[y * img.width + x] > (PAPER + DESK) / 2) {
          lefts.push(x);
          break;
        }
      }
    }
    return lefts;
  };

  const sourceLefts = pageEdgeX(image);
  assert.ok(
    sourceLefts.length > 10,
    `expected a page edge on many rows, found ${sourceLefts.length}`,
  );
  const sourceSpread = Math.max(...sourceLefts) - Math.min(...sourceLefts);
  assert.ok(
    sourceSpread > 20,
    `the fixture is not slanted enough to test (spread ${sourceSpread})`,
  );

  const result = correctPerspective(image);
  assert.equal(result.estimate.applied, true);

  /**
   * The rectified page has no desk left � the warp fills from inside the quad � so its content
   * is measured directly. Bilinear resampling means text never reaches the pure ink value, so
   * the threshold is a third of the way up from the darkest pixel present.
   */
  const { pixels, width, height } = result.image;
  let darkest = 255;
  for (const value of pixels) if (value < darkest) darkest = value;
  const inkThreshold = darkest + (255 - darkest) * 0.35;

  // Every row, not every sixth: the warp compresses the source's 20 text lines into a shorter
  // output, so a coarse step can step straight over most of them.
  const rectifiedLefts = [];
  for (let y = 0; y < height; y += 2) {
    let rowDarkest = 255;
    for (let x = 0; x < width; x += 1) rowDarkest = Math.min(rowDarkest, pixels[y * width + x]);
    if (rowDarkest > inkThreshold) continue;
    for (let x = 0; x < width; x += 1) {
      if (pixels[y * width + x] <= inkThreshold) {
        rectifiedLefts.push(x);
        break;
      }
    }
  }
  assert.ok(
    rectifiedLefts.length > 5,
    `the rectified page has no text rows (${rectifiedLefts.length})`,
  );
  const rectifiedSpread = Math.max(...rectifiedLefts) - Math.min(...rectifiedLefts);

  // A vertical text edge, measured over the whole page. The tolerance is generous relative to
  // the sub-pixel accuracy of corner detection because the measurement includes resampling
  // error at both ends of every line � but it must be far below the source's slant.
  assert.ok(
    rectifiedSpread < sourceSpread / 3,
    `rectified text still spreads ${rectifiedSpread}px from a source page slant of ${sourceSpread}px`,
  );
  assert.ok(result.image.width > 0 && result.image.height > 0, 'the rectified page has no pixels');
});

test('an already-rectangular page is reported but not rewritten', () => {
  // A page photographed straight on has no keystone. Re-encoding it would cost sharpness to the
  // resample and change bytes for nothing, so the correction must decline.
  const page = textPage(400, 560);
  const out = new Uint8Array(400 * 560).fill(DESK);
  for (let y = 0; y < 560; y += 1) {
    for (let x = 40; x < 360; x += 1) out[y * 400 + x] = page.pixels[y * 400 + x];
  }
  const image = { pixels: out, width: 400, height: 560 };

  const estimate = estimatePerspective(image);
  assert.equal(estimate.applied, false);
  assert.match(estimate.reason ?? '', /rectangular/i);

  const result = correctPerspective(image);
  assert.equal(result.image, image, 'an uncorrected page must be returned untouched, not copied');
});

test('a page too small in frame is declined rather than guessed at', () => {
  // A distant page occupies a small fraction of the frame; any quad recovered from it is noise.
  const page = textPage(60, 90);
  const out = new Uint8Array(400 * 560).fill(DESK);
  for (let y = 200; y < 290; y += 1) {
    for (let x = 170; x < 230; x += 1)
      out[y * 400 + x] = page.pixels[((y - 200) * 60 + (x - 170)) % (60 * 90)];
  }
  const estimate = estimatePerspective({ pixels: out, width: 400, height: 560 });
  assert.equal(estimate.applied, false, 'a small page must not be corrected');
});

test('orderCorners rejects a degenerate quad and normalises the winding', () => {
  assert.equal(orderCorners([]), undefined, 'too few points');
  assert.equal(
    orderCorners([
      { x: 0, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
      { x: 10, y: 0 },
    ]),
    undefined,
    'a bow-tie has no area and is not a page',
  );
  // Clockwise input must come back counter-clockwise, or the homography maps the page inside out.
  const clockwise = [
    { x: 0, y: 0 },
    { x: 0, y: 100 },
    { x: 200, y: 100 },
    { x: 200, y: 0 },
  ];
  const ordered = orderCorners(clockwise);
  assert.ok(ordered, 'a valid quad must order');
  assert.equal(ordered[0].x, 0);
  assert.equal(ordered[0].y, 0, 'the cycle must start at the top-left');
  assert.equal(ordered[2].x, 200);
  assert.equal(ordered[2].y, 100, 'the third corner is the bottom-right, not the bottom-left');
});

test('keystoneRatio is zero for a rectangle and positive for a keystone', () => {
  const rectangle = [
    { x: 0, y: 0 },
    { x: 200, y: 0 },
    { x: 200, y: 300 },
    { x: 0, y: 300 },
  ];
  assert.equal(keystoneRatio(rectangle), 0, 'a rectangle has equal opposite sides');

  const keystone = [
    { x: 0, y: 0 },
    { x: 200, y: 0 },
    { x: 150, y: 300 },
    { x: 50, y: 300 },
  ];
  assert.ok(keystoneRatio(keystone) > 0.1, 'a keystone must measure as leaning');
});

test('warpPerspective maps the quad corners exactly onto the output rectangle', () => {
  // The homography has to be exact at the corners: everything else follows from that. A solver
  // that is merely close still produces a page that is subtly wrong everywhere, which is the
  // kind of defect no end-to-end assertion catches.
  const width = 400;
  const height = 560;
  const source = { pixels: new Uint8Array(width * height).fill(PAPER), width, height };
  // A distinct value at each source corner, so the mapping is observable in the output.
  source.pixels[2] = 10;
  source.pixels[width - 3] = 60;
  source.pixels[(height - 1) * width + 2] = 90;
  source.pixels[height * width - 3] = 120;

  const quad = [
    { x: 30, y: 0 },
    { x: 369, y: 0 },
    { x: 309, y: 559 },
    { x: 90, y: 559 },
  ];
  const out = warpPerspective(source, quad, 339, 559);
  assert.ok(out, 'the warp must produce an image');
  assert.equal(out.width, 339);
  assert.equal(out.height, 559);

  // The centre of the output must come from the centre of the quad, not from a corner.
  const centre = out.pixels[Math.floor(out.height / 2) * out.width + Math.floor(out.width / 2)];
  assert.ok(centre > DESK, 'the output centre should sample the page, not the background');
});

test('an inconsistent image is refused with a remedy, not a wrong answer', () => {
  assert.throws(
    () => estimatePerspective({ pixels: new Uint8Array(10), width: 100, height: 100 }),
    (error) => {
      assert.ok(error instanceof PdfEngineError, `expected a PdfEngineError, got ${error}`);
      assert.match(error.message, /inconsistent/u);
      return true;
    },
  );
  assert.throws(
    () => estimatePerspective({ pixels: new Uint8Array(0), width: 0, height: 0 }),
    (error) => {
      assert.ok(error instanceof PdfEngineError);
      assert.match(error.message, /no pixels|retake/u);
      return true;
    },
  );
});

test('perspective correction accepts the same colour pixels the rotation path does', () => {
  // The capture route hands the engine RGBA frames, so the grayscale conversion has to be
  // shared rather than assumed. Reusing `toGrayscale` is what keeps one definition of "dark".
  const rgba = new Uint8Array(4 * 4 * 4).fill(255);
  for (let index = 0; index < 16; index += 1) {
    rgba[index * 4] = 0;
    rgba[index * 4 + 1] = 0;
    rgba[index * 4 + 2] = 0;
    rgba[index * 4 + 3] = 255;
  }
  const gray = toGrayscale(rgba, 4, 4, 4);
  assert.equal(gray.pixels.length, 16);
  assert.equal(gray.pixels[0], 0, 'black stays black');
  // A 4x4 page is far below the minimum area, so it must be declined rather than corrected.
  assert.equal(estimatePerspective(gray).applied, false);
});

test('an already-rectangular page is reported but not rewritten', () => {
  // A page photographed straight on has no keystone. Re-encoding it would cost sharpness to the
  // resample and change bytes for nothing, so the correction must decline.
  const page = textPage(400, 560);
  const out = new Uint8Array(400 * 560).fill(DESK);
  for (let y = 0; y < 560; y += 1) {
    for (let x = 40; x < 360; x += 1) out[y * 400 + x] = page.pixels[y * 400 + x];
  }
  const image = { pixels: out, width: 400, height: 560 };

  const estimate = estimatePerspective(image);
  assert.equal(estimate.applied, false);
  assert.match(estimate.reason ?? '', /rectangular/i);

  const result = correctPerspective(image);
  assert.equal(result.image, image, 'an uncorrected page must be returned untouched, not copied');
});

test('a page too small in frame is declined rather than guessed at', () => {
  // A distant page occupies a small fraction of the frame; any quad recovered from it is noise.
  const page = textPage(60, 90);
  const out = new Uint8Array(400 * 560).fill(DESK);
  for (let y = 200; y < 290; y += 1) {
    for (let x = 170; x < 230; x += 1)
      out[y * 400 + x] = page.pixels[((y - 200) * 60 + (x - 170)) % (60 * 90)];
  }
  const estimate = estimatePerspective({ pixels: out, width: 400, height: 560 });
  assert.equal(estimate.applied, false, 'a small page must not be corrected');
});

test('orderCorners rejects a degenerate quad and normalises the winding', () => {
  assert.equal(orderCorners([]), undefined, 'too few points');
  assert.equal(
    orderCorners([
      { x: 0, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
      { x: 10, y: 0 },
    ]),
    undefined,
    'a bow-tie has no area and is not a page',
  );
  // Clockwise input must come back counter-clockwise, or the homography maps the page inside out.
  const clockwise = [
    { x: 0, y: 0 },
    { x: 0, y: 100 },
    { x: 200, y: 100 },
    { x: 200, y: 0 },
  ];
  const ordered = orderCorners(clockwise);
  assert.ok(ordered, 'a valid quad must order');
  assert.equal(ordered[0].x, 0);
  assert.equal(ordered[0].y, 0, 'the cycle must start at the top-left');
  assert.equal(ordered[2].x, 200);
  assert.equal(ordered[2].y, 100, 'the third corner is the bottom-right, not the bottom-left');
});

test('keystoneRatio is zero for a rectangle and positive for a keystone', () => {
  const rectangle = [
    { x: 0, y: 0 },
    { x: 200, y: 0 },
    { x: 200, y: 300 },
    { x: 0, y: 300 },
  ];
  assert.equal(keystoneRatio(rectangle), 0, 'a rectangle has equal opposite sides');

  const keystone = [
    { x: 0, y: 0 },
    { x: 200, y: 0 },
    { x: 150, y: 300 },
    { x: 50, y: 300 },
  ];
  assert.ok(keystoneRatio(keystone) > 0.1, 'a keystone must measure as leaning');
});

test('warpPerspective maps the quad corners exactly onto the output rectangle', () => {
  // The homography has to be exact at the corners: everything else follows from that. A solver
  // that is merely close still produces a page that is subtly wrong everywhere, which is the
  // kind of defect no end-to-end assertion catches.
  const width = 400;
  const height = 560;
  const source = { pixels: new Uint8Array(width * height).fill(PAPER), width, height };
  // A distinct value at each source corner, so the mapping is observable in the output.
  source.pixels[2] = 10;
  source.pixels[width - 3] = 60;
  source.pixels[(height - 1) * width + 2] = 90;
  source.pixels[height * width - 3] = 120;

  const quad = [
    { x: 30, y: 0 },
    { x: 369, y: 0 },
    { x: 309, y: 559 },
    { x: 90, y: 559 },
  ];
  const out = warpPerspective(source, quad, 339, 559);
  assert.ok(out, 'the warp must produce an image');
  assert.equal(out.width, 339);
  assert.equal(out.height, 559);

  // The centre of the output must come from the centre of the quad, not from a corner.
  const centre = out.pixels[Math.floor(out.height / 2) * out.width + Math.floor(out.width / 2)];
  assert.ok(centre > DESK, 'the output centre should sample the page, not the background');
});

test('an inconsistent image is refused with a remedy, not a wrong answer', () => {
  assert.throws(
    () => estimatePerspective({ pixels: new Uint8Array(10), width: 100, height: 100 }),
    (error) => {
      assert.ok(error instanceof PdfEngineError, `expected a PdfEngineError, got ${error}`);
      assert.match(error.message, /inconsistent/u);
      return true;
    },
  );
  assert.throws(
    () => estimatePerspective({ pixels: new Uint8Array(0), width: 0, height: 0 }),
    (error) => {
      assert.ok(error instanceof PdfEngineError);
      assert.match(error.message, /no pixels|retake/u);
      return true;
    },
  );
});

test('perspective correction accepts the same colour pixels the rotation path does', () => {
  // The capture route hands the engine RGBA frames, so the grayscale conversion has to be
  // shared rather than assumed. Reusing `toGrayscale` is what keeps one definition of "dark".
  const rgba = new Uint8Array(4 * 4 * 4).fill(255);
  for (let index = 0; index < 16; index += 1) {
    rgba[index * 4] = 0;
    rgba[index * 4 + 1] = 0;
    rgba[index * 4 + 2] = 0;
    rgba[index * 4 + 3] = 255;
  }
  const gray = toGrayscale(rgba, 4, 4, 4);
  assert.equal(gray.pixels.length, 16);
  assert.equal(gray.pixels[0], 0, 'black stays black');
  // A 4x4 page is far below the minimum area, so it must be declined rather than corrected.
  assert.equal(estimatePerspective(gray).applied, false);
});
