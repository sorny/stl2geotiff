// Edge function (cross product sign) — same as reference implementation.
// Returns > 0 if P is left of A→B, < 0 if right, 0 if on the line.
function edgeFn(ax, ay, bx, by, px, py) {
  return (bx - ax) * (py - ay) - (by - ay) * (px - ax);
}

// Barycentric Z interpolation — matches reference calc_Z().
function calcZ(px, py, v1, v2, v3) {
  const det = (v2.y - v3.y) * (v1.x - v3.x) + (v3.x - v2.x) * (v1.y - v3.y);
  if (Math.abs(det) < 1e-10) return null;
  const l1 = ((v2.y - v3.y) * (px - v3.x) + (v3.x - v2.x) * (py - v3.y)) / det;
  const l2 = ((v3.y - v1.y) * (px - v3.x) + (v1.x - v3.x) * (py - v3.y)) / det;
  return l1 * v1.z + l2 * v2.z + (1 - l1 - l2) * v3.z;
}

function rasterize(triangles, bounds, width, height, nodata, onProgress) {
  return new Promise(resolve => {
    const { minX, maxX, minY, maxY } = bounds;
    const rangeX = maxX - minX || 1;
    const rangeY = maxY - minY || 1;
    const scaleX = width  / rangeX;
    const scaleY = height / rangeY;

    // Grid bucket: aim for ~100 triangles per bucket
    const bucketN = Math.max(1, Math.min(
      Math.floor(width / 4),
      Math.ceil(Math.sqrt(triangles.length / 50))
    ));
    const buckets = new Array(bucketN * bucketN);
    for (let i = 0; i < buckets.length; i++) buckets[i] = [];

    for (let ti = 0; ti < triangles.length; ti++) {
      const { v1, v2, v3 } = triangles[ti];
      const triMinX = Math.min(v1.x, v2.x, v3.x);
      const triMaxX = Math.max(v1.x, v2.x, v3.x);
      const triMinY = Math.min(v1.y, v2.y, v3.y);
      const triMaxY = Math.max(v1.y, v2.y, v3.y);

      // Pixel bbox — Y is FLIPPED: row 0 = maxY (north)
      const pxMin = (triMinX - minX) * scaleX;
      const pxMax = (triMaxX - minX) * scaleX;
      const pyMin = (maxY - triMaxY) * scaleY;   // flip: large Y → small row
      const pyMax = (maxY - triMinY) * scaleY;

      const bxMin = Math.max(0, Math.floor(pxMin * bucketN / width));
      const bxMax = Math.min(bucketN - 1, Math.floor(pxMax * bucketN / width));
      const byMin = Math.max(0, Math.floor(pyMin * bucketN / height));
      const byMax = Math.min(bucketN - 1, Math.floor(pyMax * bucketN / height));

      for (let by = byMin; by <= byMax; by++) {
        for (let bx = bxMin; bx <= bxMax; bx++) {
          buckets[by * bucketN + bx].push(ti);
        }
      }
    }

    // Precompute pixel → bucket
    const pixBucketX = new Uint16Array(width);
    const pixBucketY = new Uint16Array(height);
    // Use pixel CENTER (px+0.5) so the bucket matches the triangle's bbox assignment.
    // Using the integer index (px) causes off-by-one bucket mismatches at boundaries.
    for (let px = 0; px < width;  px++) pixBucketX[px] = Math.min(bucketN - 1, Math.floor((px + 0.5) * bucketN / width));
    for (let py = 0; py < height; py++) pixBucketY[py] = Math.min(bucketN - 1, Math.floor((py + 0.5) * bucketN / height));

    const grid = new Float32Array(width * height).fill(nodata);
    let row = 0;

    function processChunk() {
      const endRow = Math.min(row + 16, height);

      for (let py = row; py < endRow; py++) {
        const by = pixBucketY[py];
        // Flipped Y: row py → world Y
        const wy = maxY - (py + 0.5) / scaleY;

        for (let px = 0; px < width; px++) {
          const bx = pixBucketX[px];
          const bucket = buckets[by * bucketN + bx];
          if (bucket.length === 0) continue;

          const wx = minX + (px + 0.5) / scaleX;

          let maxZ = -Infinity;
          let covered = false;

          for (let bi = 0; bi < bucket.length; bi++) {
            const { v1, v2, v3 } = triangles[bucket[bi]];

            // Edge function containment test (matches reference within_triangle)
            const d1 = edgeFn(v1.x, v1.y, v2.x, v2.y, wx, wy);
            const d2 = edgeFn(v2.x, v2.y, v3.x, v3.y, wx, wy);
            const d3 = edgeFn(v3.x, v3.y, v1.x, v1.y, wx, wy);
            const hasNeg = (d1 < 0) || (d2 < 0) || (d3 < 0);
            const hasPos = (d1 > 0) || (d2 > 0) || (d3 > 0);
            if (hasNeg && hasPos) continue; // outside

            const z = calcZ(wx, wy, v1, v2, v3);
            if (z === null) continue;

            if (!covered || z > maxZ) { maxZ = z; covered = true; }
          }

          if (covered) grid[py * width + px] = maxZ;
        }
      }

      row = endRow;
      if (onProgress) onProgress(row / height);
      if (row < height) setTimeout(processChunk, 0);
      else resolve(grid);
    }

    processChunk();
  });
}

// Rotate a square Float32Array by multiples of 90° clockwise.
// Returns a new Float32Array (and the new width/height, always equal for square).
function rotateGrid(grid, size, degrees) {
  const steps = ((degrees / 90) % 4 + 4) % 4; // 0,1,2,3
  if (steps === 0) return { grid, width: size, height: size };

  let src = grid;
  let w = size, h = size;

  for (let s = 0; s < steps; s++) {
    // One step = 90° CW: old(r,c) → new(c, w-1-r), new size = h×w
    const dst = new Float32Array(w * h);
    for (let r = 0; r < h; r++) {
      for (let c = 0; c < w; c++) {
        dst[c * h + (h - 1 - r)] = src[r * w + c];
      }
    }
    src = dst;
    [w, h] = [h, w]; // swap dimensions
  }

  return { grid: src, width: w, height: h };
}
