# Map tools

`gen.py` rebuilds `js/mapdata.js` and `assets/ground.jpg`.

It reads three inputs:

- `roads.json`: the hand-traced street centrelines, in map pixels, with each street's name and drawn width.
- `blds.json`: the building footprints, as oriented rectangles in map pixels.
- The map screenshot itself, which the script uses for the green areas. It is not included in the repo.

Run it from this folder with Python 3, with Pillow, NumPy and SciPy installed. The paths are set at the top of the
script.
