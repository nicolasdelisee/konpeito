/**
 * Handwriting recognition — pure functions, no DOM, no dependencies.
 *
 * Both sides of the comparison are reduced to the same thing: a normalised
 * cloud of N points.
 *
 *   reference kana  →  glyph bitmap  →  thinning  →  point cloud
 *   what you drew   →  polylines     →  resample  →  point cloud
 *
 * Thinning is what makes the two comparable: a rendered glyph is a *filled
 * outline*, while a drawing is a *centre line*. Zhang-Suen erodes the filled
 * shape down to its skeleton, so both end up describing the same strokes.
 *
 * Shapes are compared with a symmetric Chamfer distance rather than the greedy
 * matching of the $P recogniser: the clouds are unordered here (a skeleton has
 * no stroke order at all), and Chamfer has no greedy bias.
 *
 * Three choices carry most of the accuracy, all three measured — see
 * test-recognizer.js and the log in README.md:
 *
 *  - Points are kept at a constant SPACING, not a constant COUNT. A finger
 *    drawing yields ~480 skeleton points where a font glyph yields ~100, and
 *    Chamfer between clouds of unequal density is biased.
 *  - Scale comes from the spread of the points (2σ), not the bounding box: one
 *    stray stroke moves a bounding box, it barely moves a standard deviation.
 *  - The score adds the worst-matched 5% to the mean. The mean alone dilutes
 *    small but decisive marks — dakuten are 3 points out of 35, so ignoring
 *    them was nearly free, and テ scored like デ.
 *
 * Runs both in the browser (global `Recognizer`) and in Node (module.exports).
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Recognizer = api;
})(typeof self !== 'undefined' ? self : globalThis, function () {
  const POINT_SPACING = 0.06; // distance between kept points, once normalised
  const TAIL_QUANTILE = 0.95; // "the worst-matched 5%"
  const TAIL_WEIGHT = 1; // weight of that tail next to the mean
  const MAX_POINTS = 400; // hard stop, never reached by a kana

  // ------------------------------------------------------------- thinning

  /** Zhang-Suen thinning. `grid` is a 0/1 Uint8Array of w*h, 1 = ink. */
  function thin(grid, w, h) {
    const px = Uint8Array.from(grid);
    const at = (x, y) => (x < 0 || y < 0 || x >= w || y >= h ? 0 : px[y * w + x]);
    let changed = true;

    while (changed) {
      changed = false;
      for (const step of [0, 1]) {
        const doomed = [];
        for (let y = 1; y < h - 1; y += 1) {
          for (let x = 1; x < w - 1; x += 1) {
            if (!px[y * w + x]) continue;
            // P2..P9 clockwise from north
            const n = [
              at(x, y - 1),
              at(x + 1, y - 1),
              at(x + 1, y),
              at(x + 1, y + 1),
              at(x, y + 1),
              at(x - 1, y + 1),
              at(x - 1, y),
              at(x - 1, y - 1),
            ];
            const filled = n.reduce((sum, v) => sum + v, 0);
            if (filled < 2 || filled > 6) continue;
            let transitions = 0;
            for (let i = 0; i < 8; i += 1) {
              if (!n[i] && n[(i + 1) % 8]) transitions += 1;
            }
            if (transitions !== 1) continue;
            const [p2, , p4, , p6, , p8] = n;
            if (step === 0) {
              if (p2 * p4 * p6 || p4 * p6 * p8) continue;
            } else if (p2 * p4 * p8 || p2 * p6 * p8) continue;
            doomed.push(y * w + x);
          }
        }
        if (doomed.length) {
          changed = true;
          for (const index of doomed) px[index] = 0;
        }
      }
    }
    return px;
  }

  // --------------------------------------------------------------- clouds

  function inkPoints(grid, w, h) {
    const points = [];
    for (let y = 0; y < h; y += 1) {
      for (let x = 0; x < w; x += 1) {
        if (grid[y * w + x]) points.push([x, y]);
      }
    }
    return points;
  }

  /**
   * Farthest-point sampling, stopped once the cloud is evenly covered at
   * `spacing` rather than after a fixed number of points.
   *
   * Constant spacing is what makes the two sides comparable: the same stroke
   * contributes the same number of points whether it came from a font glyph or
   * from a finger, so neither side is artificially denser than the other.
   * Expects points already normalised, so `spacing` is in the same units.
   */
  function spreadEvenly(points, spacing) {
    if (points.length <= 2) return points.map((p) => p.slice());
    // Seed on the lexicographically smallest point: ordering survives
    // translation and scaling exactly, so the same shape drawn bigger selects
    // the very same points. A centroid seed depends on a float sum and can flip
    // between two tied candidates.
    let seed = 0;
    for (let i = 1; i < points.length; i += 1) {
      const p = points[i];
      const best = points[seed];
      if (p[0] < best[0] || (p[0] === best[0] && p[1] < best[1])) seed = i;
    }

    const picked = [seed];
    const minDist = points.map((p) => (p[0] - points[seed][0]) ** 2 + (p[1] - points[seed][1]) ** 2);
    const stop = spacing * spacing;
    while (picked.length < MAX_POINTS) {
      let far = -1;
      let farDist = -1;
      for (let i = 0; i < points.length; i += 1) {
        const d = minDist[i];
        if (far === -1 || d > farDist * (1 + 1e-9)) {
          farDist = d;
          far = i;
        } else if (d >= farDist * (1 - 1e-9)) {
          // Tie: settle it on the coordinates, not on the array index. Ties are
          // everywhere on symmetric shapes, and index order is not preserved
          // when the same drawing comes in at another size.
          const a = points[i];
          const b = points[far];
          if (a[0] < b[0] || (a[0] === b[0] && a[1] < b[1])) far = i;
        }
      }
      if (farDist < stop) break;
      picked.push(far);
      minDist[far] = -1;
      for (let i = 0; i < points.length; i += 1) {
        if (minDist[i] < 0) continue;
        const d = (points[i][0] - points[far][0]) ** 2 + (points[i][1] - points[far][1]) ** 2;
        if (d < minDist[i]) minDist[i] = d;
      }
    }
    return picked.map((i) => points[i].slice());
  }

  /**
   * Spreads points evenly along each polyline, so a long stroke contributes
   * more points than a short one.
   *
   * Each stroke gets its own point budget from its own length. Walking the
   * whole drawing with a running offset instead would let rounding drift from
   * one stroke to the next, and the same shape drawn at another size would
   * split its points slightly differently between strokes.
   */
  function densifyStrokes(strokes, step) {
    const out = [];
    for (const stroke of strokes) {
      if (!stroke.length) continue;
      if (stroke.length === 1) {
        out.push([stroke[0].x, stroke[0].y]);
        continue;
      }
      const cumulative = [0];
      for (let i = 1; i < stroke.length; i += 1) {
        cumulative.push(
          cumulative[i - 1] + Math.hypot(stroke[i].x - stroke[i - 1].x, stroke[i].y - stroke[i - 1].y),
        );
      }
      const total = cumulative[cumulative.length - 1];
      if (total === 0) {
        out.push([stroke[0].x, stroke[0].y]);
        continue;
      }
      const count = Math.max(1, Math.round(total / step));
      let segment = 1;
      for (let k = 0; k <= count; k += 1) {
        const target = (total * k) / count;
        while (segment < cumulative.length - 1 && cumulative[segment] < target) segment += 1;
        const span = cumulative[segment] - cumulative[segment - 1] || 1;
        const t = (target - cumulative[segment - 1]) / span;
        const a = stroke[segment - 1];
        const b = stroke[segment];
        out.push([a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t]);
      }
    }
    return out;
  }

  /**
   * Centre on the centroid, scale by the spread of the points.
   *
   * Using 2σ rather than the bounding box makes the scale robust: a single
   * stray stroke — or a dropped extremity — shifts a bounding box outright,
   * while it barely moves a standard deviation. Proportions are preserved,
   * since both axes share one scale factor.
   */
  function normalize(points) {
    if (!points.length) return [];
    const cx = points.reduce((s, p) => s + p[0], 0) / points.length;
    const cy = points.reduce((s, p) => s + p[1], 0) / points.length;
    const spread =
      2 * Math.sqrt(points.reduce((s, p) => s + (p[0] - cx) ** 2 + (p[1] - cy) ** 2, 0) / points.length);
    const scale = spread || 1;
    return points.map(([x, y]) => [(x - cx) / scale, (y - cy) / scale]);
  }

  function toShape(rawPoints) {
    return { points: spreadEvenly(normalize(rawPoints), POINT_SPACING) };
  }

  /** Reference shape from a rendered glyph bitmap. */
  function shapeFromBitmap(grid, w, h) {
    return toShape(inkPoints(thin(grid, w, h), w, h));
  }

  /** Shape from what the user drew: strokes of {x, y} points. */
  function shapeFromStrokes(strokes) {
    const flat = strokes.flat();
    if (!flat.length) return null;
    const xs = flat.map((p) => p.x);
    const ys = flat.map((p) => p.y);
    const diagonal = Math.hypot(
      Math.max(...xs) - Math.min(...xs),
      Math.max(...ys) - Math.min(...ys),
    );
    // The step must stay proportional to the drawing: an absolute floor here
    // would sample a small drawing and a large one differently, and the same
    // shape drawn bigger would no longer score the same.
    const step = diagonal / 100;
    if (!(step > 0)) return toShape(flat.map((p) => [p.x, p.y]));
    return toShape(densifyStrokes(strokes, step));
  }

  // ------------------------------------------------------------ comparison

  /**
   * Chamfer distance, symmetric, with a tail term.
   *
   * The mean says "on average the two shapes sit close". The 95th percentile
   * says "and no part of either is left stranded". That second half is what
   * separates a kana from the same kana plus dakuten: those two marks are a
   * handful of points out of ~35, so a mean alone barely notices them.
   */
  function chamfer(a, b) {
    if (!a.length || !b.length) return Infinity;
    const oneWay = (from, to) => {
      const nearest = from.map((p) => {
        let best = Infinity;
        for (const q of to) {
          const d = (p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2;
          if (d < best) best = d;
        }
        return Math.sqrt(best);
      });
      nearest.sort((x, y) => x - y);
      const mean = nearest.reduce((sum, v) => sum + v, 0) / nearest.length;
      const tail = nearest[Math.min(nearest.length - 1, Math.floor(TAIL_QUANTILE * nearest.length))];
      return mean + TAIL_WEIGHT * tail;
    };
    return (oneWay(a, b) + oneWay(b, a)) / 2;
  }

  /** Lower is better. 0 means identical. */
  function distance(shape, template) {
    return chamfer(shape.points, template.points);
  }

  /** Ranks templates against a drawn shape, best first. */
  function rank(shape, templates) {
    return templates
      .map((template) => ({
        key: template.key,
        template,
        score: distance(shape, template),
      }))
      .sort((a, b) => a.score - b.score);
  }

  return {
    POINT_SPACING,
    thin,
    inkPoints,
    spreadEvenly,
    densifyStrokes,
    normalize,
    shapeFromBitmap,
    shapeFromStrokes,
    shapeFromPoints: toShape,
    chamfer,
    distance,
    rank,
  };
});
