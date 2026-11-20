// Intersect a planar road triangle with the exact two triangles in every
// occupied terrain grid cell. Sampling ground() at only the original road
// triangle vertices cannot preserve a nonplanar, piecewise-linear DEM.
// Coordinates are local x/east and z/north metres.
const EPS = 1e-9;

function cut(poly, signedDistance) {
  if (!poly.length) return [];
  const result = [];
  let previous = poly[poly.length - 1];
  let last = signedDistance(previous);
  for (const current of poly) {
    const next = signedDistance(current);
    const aInside = last <= EPS;
    const bInside = next <= EPS;
    if (aInside !== bInside) {
      const t = last / (last - next);
      result.push([
        previous[0] + (current[0] - previous[0]) * t,
        previous[1] + (current[1] - previous[1]) * t
      ]);
    }
    if (bInside) result.push(current);
    previous = current;
    last = next;
  }
  // Clipping on an exact boundary may yield repeated consecutive points.
  const unique = [];
  for (const point of result) {
    if (!unique.length || Math.hypot(point[0] - unique.at(-1)[0], point[1] - unique.at(-1)[1]) > 1e-7) {
      unique.push(point);
    }
  }
  if (unique.length > 1 && Math.hypot(unique[0][0] - unique.at(-1)[0], unique[0][1] - unique.at(-1)[1]) <= 1e-7) {
    unique.pop();
  }
  return unique;
}

function emitFan(polygon, emitTriangle) {
  for (let j = 1; j < polygon.length - 1; ++j) {
    const a = polygon[0], b = polygon[j], c = polygon[j + 1];
    const area2 = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    if (Math.abs(area2) > 1e-8) emitTriangle(a, b, c);
  }
}

export function emitTerrainAlignedTriangle(a, b, c, grid, emitTriangle) {
  const { xmin, zmin, xmax, zmax, nx, nz } = grid;
  if (!(nx > 0 && nz > 0 && xmax > xmin && zmax > zmin &&
    Number.isInteger(nx) && Number.isInteger(nz))) throw Error('Invalid terrain grid');
  const dx = (xmax - xmin) / nx;
  const dz = (zmax - zmin) / nz;
  const xs = [a[0], b[0], c[0]], zs = [a[1], b[1], c[1]];
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minZ = Math.min(...zs), maxZ = Math.max(...zs);
  if (maxX < xmin || minX > xmax || maxZ < zmin || minZ > zmax) return;
  const i0 = Math.max(0, Math.floor((minX - xmin) / dx));
  const i1 = Math.min(nx - 1, Math.floor((maxX - xmin) / dx));
  const j0 = Math.max(0, Math.floor((minZ - zmin) / dz));
  const j1 = Math.min(nz - 1, Math.floor((maxZ - zmin) / dz));
  for (let j = j0; j <= j1; ++j) {
    const z0 = zmin + j * dz, z1 = z0 + dz;
    for (let i = i0; i <= i1; ++i) {
      const x0 = xmin + i * dx, x1 = x0 + dx;
      let polygon = [a, b, c];
      polygon = cut(polygon, ([x]) => x0 - x);
      polygon = cut(polygon, ([x]) => x - x1);
      polygon = cut(polygon, ([, z]) => z0 - z);
      polygon = cut(polygon, ([, z]) => z - z1);
      if (polygon.length < 3) continue;
      // generate.mjs terrain grid: (x0,z0)-(x1,z0)-(x0,z1)
      // and (x1,z1)-(x1,z0)-(x0,z1). Diagonal: u + v = 1.
      const side = ([x, z]) => (x - x0) / dx + (z - z0) / dz - 1;
      emitFan(cut(polygon, side), emitTriangle);
      emitFan(cut(polygon, p => -side(p)), emitTriangle);
    }
  }
}
