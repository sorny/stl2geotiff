# stl2geotiff

A browser-based tool to convert STL files into Float32 GeoTIFF heightmaps. Runs entirely client-side — no uploads, no server, no dependencies.

Developed as a companion tool for [erzberg](https://github.com/sorny/erzberg).

## Live Demo

Deployed via GitHub Pages: `https://<your-username>.github.io/stl2geotiff`

## Features

- Parses binary and ASCII STL files
- Rasterizes to a Float32 GeoTIFF with accurate Z values preserved
- NoData masking for pixels outside the mesh
- Configurable output resolution (256 – 4096 px)
- Post-conversion rotation (0°, 90°, 180°, 270°)
- Grayscale heightmap preview with magenta NoData highlight
- Output filename derived from the input STL filename
- Validated against GDAL (`gdalinfo`, QGIS)

## Usage

Open `index.html` in a browser (no build step required):

```
# local dev
open index.html

# or serve with any static server
npx serve .
python3 -m http.server
```

1. Drop an `.stl` file onto the drop zone or click to browse
2. Choose output resolution and NoData value
3. Click **Convert**
4. Optionally rotate the result
5. Click **Download .tif**

## Output format

| Property | Value |
|---|---|
| Format | GeoTIFF (TIFF + GeoTIFF tags) |
| Data type | Float32 |
| Bands | 1 |
| Compression | None |
| Coordinate system | Pixel space (1 unit = 1 px) |
| NoData | Configurable (default −9999) |
| Projection direction | Top-down (Z = height, row 0 = max Y) |

## Technical notes

- STL is rasterized by projecting triangles top-down onto the XY plane
- Z interpolation uses barycentric coordinates; containment uses edge functions
- Triangles are indexed into a spatial bucket grid for performance
- For overlapping surfaces the maximum Z is taken (topmost surface wins)
- GeoTIFF is hand-encoded (no external libraries) with correct `ModelPixelScaleTag`, `ModelTiepointTag`, `GeoKeyDirectoryTag`, and `GDAL_NODATA` tags

## License

MIT — see [LICENSE](LICENSE).
