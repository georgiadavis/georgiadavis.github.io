# Georgia Davis

A plain HTML/CSS portfolio. No installation or build step is needed.

Open `dist/index.html` in a browser, or serve `dist` with any static web server.

To replace the pink square, add your image to `dist/assets/` and replace the placeholder div in `dist/index.html` with the commented image example. The image keeps a square crop automatically.

The footer currently links to Instagram. Edit its `href` in `dist/index.html` to change the destination.

The camera automatically prints once when it comes into view. Click it (or use Enter/Space while focused) to replay. `dist/print.js` renders a subdivided WebGL paper mesh with bending and shading, then returns to the HTML card. It uses the same project image and labels as the HTML. Keep replacement images local under `dist/assets/` so they can also be drawn into the paper texture.

The camera's upper face is a CSS-clipped second copy of the supplied image, ending inside the output slot. The paper stays narrower than the opening until it clears the camera and travels over the lower casing in one continuous sheet. No image editing or extra camera asset is needed. Reduced-motion preferences, unavailable WebGL, or shader failures retain the static card.

For GitHub Pages, publish the contents of `dist` as your site root.
