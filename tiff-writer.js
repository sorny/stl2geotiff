// Encode a Float32 single-band GeoTIFF (pixel-space, no projection).
// nodata is stored in GDAL_NODATA tag (42113) and used for uncovered pixels.
function encodeGeoTIFF(width, height, float32data, nodata) {
  const NUM_TAGS = 14;

  // Fixed layout:
  // [0]     8 B  TIFF header
  // [8]   174 B  IFD (2 + 14*12 + 4)
  // [182]  24 B  ModelPixelScale (3 × float64)
  // [206]  48 B  ModelTiepoint  (6 × float64)
  // [254]  16 B  GeoKeyDirectory (8 × uint16)
  // [270]  32 B  GDAL_NODATA string (ASCII, reserved)
  // [302]   2 B  padding to 4-byte align → PIXEL_DATA_OFFSET = 304
  const PIXEL_SCALE_OFF  = 182;
  const TIEPOINT_OFF     = 206;
  const GEOKEYS_OFF      = 254;
  const NODATA_STR_OFF   = 270;
  const NODATA_RESERVED  = 32; // bytes reserved for nodata string
  const PIXEL_DATA_OFF   = 304; // (270 + 32 = 302, padded to 304)

  const nodataStr = String(nodata) + '\0';
  const nodataLen = nodataStr.length; // actual count for TIFF tag

  const totalBytes = PIXEL_DATA_OFF + width * height * 4;
  const buf = new ArrayBuffer(totalBytes);
  const dv  = new DataView(buf);

  // TIFF header (little-endian "II")
  dv.setUint8(0, 0x49); dv.setUint8(1, 0x49);
  dv.setUint16(2, 42, true);
  dv.setUint32(4, 8, true); // IFD at offset 8

  // IFD: entry count
  dv.setUint16(8, NUM_TAGS, true);

  // Write IFD entries (must be sorted by tag number)
  let pos = 10;
  function entry(tag, type, count, valueOrOff) {
    dv.setUint16(pos,     tag,   true);
    dv.setUint16(pos + 2, type,  true);
    dv.setUint32(pos + 4, count, true);
    // Inline vs offset: SHORT=type3 (2B), LONG=type4 (4B), others use offset
    if (type === 3 && count === 1) {          // SHORT, fits inline
      dv.setUint16(pos + 8, valueOrOff, true);
    } else if (type === 4 && count === 1) {   // LONG, fits inline
      dv.setUint32(pos + 8, valueOrOff, true);
    } else {                                  // offset
      dv.setUint32(pos + 8, valueOrOff, true);
    }
    pos += 12;
  }

  entry(256,   4,  1,         width);                     // ImageWidth
  entry(257,   4,  1,         height);                    // ImageLength
  entry(258,   3,  1,         32);                        // BitsPerSample
  entry(259,   3,  1,         1);                         // Compression: none
  entry(262,   3,  1,         1);                         // PhotometricInterpretation: minIsBlack
  entry(273,   4,  1,         PIXEL_DATA_OFF);            // StripOffsets
  entry(277,   3,  1,         1);                         // SamplesPerPixel
  entry(278,   4,  1,         height);                    // RowsPerStrip (single strip)
  entry(279,   4,  1,         width * height * 4);        // StripByteCounts
  entry(339,   3,  1,         3);                         // SampleFormat: IEEE float
  entry(33550, 12, 3,         PIXEL_SCALE_OFF);           // ModelPixelScaleTag
  entry(33922, 12, 6,         TIEPOINT_OFF);              // ModelTiepointTag
  entry(34736, 3,  8,         GEOKEYS_OFF);               // GeoKeyDirectoryTag
  entry(42113, 2,  nodataLen, NODATA_STR_OFF);            // GDAL_NODATA

  // Next IFD = 0 (no more IFDs)
  dv.setUint32(pos, 0, true);

  // ModelPixelScale: [1.0, 1.0, 0.0] — 1 pixel = 1 model unit in X and Y
  dv.setFloat64(PIXEL_SCALE_OFF,      1.0, true);
  dv.setFloat64(PIXEL_SCALE_OFF +  8, 1.0, true);
  dv.setFloat64(PIXEL_SCALE_OFF + 16, 0.0, true);

  // ModelTiepoint: pixel (0,0,0) → world (0,0,0)
  for (let i = 0; i < 6; i++) dv.setFloat64(TIEPOINT_OFF + i * 8, 0.0, true);

  // GeoKeyDirectory: KeyDirectoryVersion=1, KeyRevision=1, MinorRevision=0, NumberOfKeys=1
  //                  GTRasterTypeGeoKey (1025) = 1 (PixelIsArea)
  const geoKeys = [1, 1, 0, 1,  1025, 0, 1, 1];
  for (let i = 0; i < 8; i++) dv.setUint16(GEOKEYS_OFF + i * 2, geoKeys[i], true);

  // GDAL_NODATA string (ASCII, null-terminated)
  for (let i = 0; i < Math.min(nodataLen, NODATA_RESERVED); i++) {
    dv.setUint8(NODATA_STR_OFF + i, nodataStr.charCodeAt(i));
  }

  // Pixel data (Float32, row-major, top to bottom)
  const pixView = new Float32Array(buf, PIXEL_DATA_OFF, width * height);
  pixView.set(float32data);

  return new Blob([buf], { type: 'image/tiff' });
}
