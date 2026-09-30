# Georgia Davis

A plain HTML/CSS portfolio. No installation or build step is needed.

Open `dist/index.html` in a browser, or serve `dist` with any static web server.

Ten photos (the work images plus `photo-1.png` through `photo-3.png`) lie in a low mound on a tabletop plane (`--pile-tilt` and `--pile-depth` in `dist/styles.css`, shared with `dist/print.js`). Change the `workPhotos` and `snapshots` lists in `dist/print.js` to replace or add images, and update the initial image in `dist/index.html` for the static fallback.

When the camera comes into view it prints 6 images, drawn in shuffled order from all of the photos. Each print starts ejecting while the previous one settles, so the motion reads as one stream. Every sheet ejects upright from the slot, then tips back onto the table and glides to its own spot on the inner mound. While the paper is moving, the WebGL shader adds a travelling ripple, directional lighting, a gloss sweep and a slight emulsion warp. These effects fade out before the sheet lands, so the handoff to the HTML card is seamless. Its shadow then fades in. Click the camera (or use Enter/Space while focused) after completion to replay the sequence. The sequence pauses while the tab is hidden. Keep replacement images local under `dist/assets/` so they can also be drawn into the paper texture.

The camera's upper face is a CSS-clipped second copy of the supplied image, ending inside the output slot. The camera and card share responsive dimensions so the paper fits the opening at its final size and never scales up during printing. It travels over the lower casing in one continuous sheet. No image editing or extra camera asset is needed. Reduced-motion preferences and unavailable WebGL show the completed stack immediately; shader failures retain the static card.

For GitHub Pages, publish the contents of `dist` as your site root.
