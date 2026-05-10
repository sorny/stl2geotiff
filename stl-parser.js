function parseSTL(arrayBuffer) {
  const view = new DataView(arrayBuffer);
  if (arrayBuffer.byteLength < 84) return parseASCIISTL(arrayBuffer);

  const numTriangles = view.getUint32(80, true);
  const expectedBinary = 84 + numTriangles * 50;
  if (numTriangles > 0 && expectedBinary === arrayBuffer.byteLength) {
    return parseBinarySTL(view, numTriangles);
  }
  return parseASCIISTL(arrayBuffer);
}

function parseBinarySTL(view, numTriangles) {
  const triangles = [];
  let minX = Infinity, maxX = -Infinity;
  let minY = Infinity, maxY = -Infinity;
  let minZ = Infinity, maxZ = -Infinity;

  let off = 84;
  for (let i = 0; i < numTriangles; i++) {
    off += 12; // skip normal
    const v1 = { x: view.getFloat32(off, true), y: view.getFloat32(off+4, true), z: view.getFloat32(off+8, true) }; off += 12;
    const v2 = { x: view.getFloat32(off, true), y: view.getFloat32(off+4, true), z: view.getFloat32(off+8, true) }; off += 12;
    const v3 = { x: view.getFloat32(off, true), y: view.getFloat32(off+4, true), z: view.getFloat32(off+8, true) }; off += 12;
    off += 2; // attribute

    triangles.push({ v1, v2, v3 });

    if (v1.x < minX) minX = v1.x; if (v1.x > maxX) maxX = v1.x;
    if (v2.x < minX) minX = v2.x; if (v2.x > maxX) maxX = v2.x;
    if (v3.x < minX) minX = v3.x; if (v3.x > maxX) maxX = v3.x;
    if (v1.y < minY) minY = v1.y; if (v1.y > maxY) maxY = v1.y;
    if (v2.y < minY) minY = v2.y; if (v2.y > maxY) maxY = v2.y;
    if (v3.y < minY) minY = v3.y; if (v3.y > maxY) maxY = v3.y;
    if (v1.z < minZ) minZ = v1.z; if (v1.z > maxZ) maxZ = v1.z;
    if (v2.z < minZ) minZ = v2.z; if (v2.z > maxZ) maxZ = v2.z;
    if (v3.z < minZ) minZ = v3.z; if (v3.z > maxZ) maxZ = v3.z;
  }

  return { triangles, bounds: { minX, maxX, minY, maxY, minZ, maxZ } };
}

function parseASCIISTL(arrayBuffer) {
  const text = new TextDecoder().decode(arrayBuffer);
  const lines = text.split('\n');
  const triangles = [];
  let minX = Infinity, maxX = -Infinity;
  let minY = Infinity, maxY = -Infinity;
  let minZ = Infinity, maxZ = -Infinity;

  let verts = [];
  for (const line of lines) {
    const t = line.trim();
    if (t.startsWith('vertex')) {
      const p = t.split(/\s+/);
      const v = { x: parseFloat(p[1]), y: parseFloat(p[2]), z: parseFloat(p[3]) };
      verts.push(v);
      if (v.x < minX) minX = v.x; if (v.x > maxX) maxX = v.x;
      if (v.y < minY) minY = v.y; if (v.y > maxY) maxY = v.y;
      if (v.z < minZ) minZ = v.z; if (v.z > maxZ) maxZ = v.z;
      if (verts.length === 3) {
        triangles.push({ v1: verts[0], v2: verts[1], v3: verts[2] });
        verts = [];
      }
    }
  }

  return { triangles, bounds: { minX, maxX, minY, maxY, minZ, maxZ } };
}
