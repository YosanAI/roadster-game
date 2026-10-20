# Third-party notices

## Runtime

The game uses [Three.js](https://github.com/mrdoob/three), pinned to `0.180.0`, under its MIT license. The retained license is [THREE-LICENSE.txt](THREE-LICENSE.txt). The npm package includes its upstream license as well.

All car/environment geometry, generated textures, particles, UI and synthesized audio in this repository are procedural application code. Event photographs were used as visual references and are not included in the distributed assets. Tesla and Roadster names identify the visual inspiration; this is an unofficial fan game.

## Development tooling

[Vite](https://github.com/vitejs/vite) and [Prettier](https://github.com/prettier/prettier) are development dependencies distributed with their own MIT license notices in their npm packages. Transitive dependencies retain their own package licenses. `package-lock.json` records the exact dependency tree.

The source archive excludes `node_modules/`. Run `npm ci` to install those packages with their upstream notices. The build is also supplied in `dist/`; keep this documentation with a redistributed repository.
