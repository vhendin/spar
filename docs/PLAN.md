# Spår — Milestone 1 Plan

Nov 16, 2026 · @Magnus

## Goal and scope

Milestone 1 delivers one real 10×10 km area in the Jämtland mountains, fully procedural scenery, one data-driven vehicle, and two or more players driving together over a home LAN. Everything runs from the host's computer with no paid APIs and no runtime internet access.

**In scope**

- One hardcoded region in the Jämtland mountains, imported once from Lantmäteriet elevation, an OpenStreetMap extract and Skogsstyrelsen forest data
- Terrain streamed in tiles with level of detail
- A data-driven vegetation and formation system with several Swedish biome types from day one, not a single tree
- One vehicle defined in a config file, with a procedurally built body
- Node.js server that serves the game and relays player state over WebSockets
- A basic day/night cycle and two or three weather states, owned by the server

**Deliberately out of scope**

- The click-on-a-map region picker
- Winches, multiple vehicle types, damage, fuel, missions
- Mud and deformable terrain
- Internet play, accounts, persistence

The out-of-scope items still shape the design; see Design for later.

## Tech stack and structure

The whole game is TypeScript: one Node.js server on the host computer and a browser client that does rendering, physics and world generation locally.

&#91;embedded content: architecture · host computer and LAN clients\]

The server only ships files and relays small state messages; heavy work like building forests happens in each browser from the same seed.

| Layer | Choice | Why |
| --- | --- | --- |
| Language | TypeScript (client and server) | Shared types for messages and data definitions |
| Rendering | Three.js, WebGPU renderer with WebGL fallback | Mature, instancing and LOD built in, works on most browsers |
| Physics | Rapier (WebAssembly) | Fast, has a raycast vehicle controller and joints for winches later |
| Server | Node.js with the `ws` WebSocket library | Minimal, runs anywhere, easy LAN hosting |
| Client build | Vite | Fast reloads while tuning |
| Importer | Node or Python using GDAL and osmium | Standard tools for GeoTIFF and OSM data |

Suggested repository layout:

```
/client      game code: rendering, physics, procedural generators
/server      HTTP + WebSocket server, world clock, weather
/shared      message types, vehicle and species schemas
/importer    offline scripts: raw data to region tiles
/defs        JSON: vehicles, species, objects, biome rules
/data        downloaded raw data and generated regions (not in git)
/docs        this plan
```

**Language decision:** TypeScript on both client and server. The target is up to 5 players on a LAN, well within Node's capacity, and if server-side physics is ever needed (for example for winching between players), Node can run the same Rapier WebAssembly build as the clients. Rust is reconsidered only if the game moves to a large public server. The importer talks to the game only through files, so its language is free to choose (Python or Rust with GDAL).

**Docker:** two images, run with Docker Compose.

- `game`: a small Node image serving the built client, the WebSocket endpoint and region tiles from a read-only mounted volume; publishes port 8080 to the LAN
- `importer`: based on the official GDAL image, in a `tools` profile so it only runs on demand (`docker compose run importer`)

Friends connect to `http://<host-ip>:8080`; the host's firewall must allow that port.

## Data pipeline

An offline import script turns raw national data into the game's own tile format once; the game never reads GeoTIFFs or OSM files directly. This keeps the runtime simple and makes a later region picker just "run the importer on a new area".

| Source | What it gives | Used for |
| --- | --- | --- |
| Lantmäteriet Markhöjdmodell (1 m grid) | Ground elevation | Terrain heightmaps, slope, wetness estimates |
| Copernicus DEM or Lantmäteriet coarse model | Low-res elevation | Distant terrain and horizon beyond the 10×10 km area |
| OpenStreetMap Sweden extract (Geofabrik) | Roads, tracks, water, land use, buildings, power lines | Drivable network, surface types, lakes, clearings, placed structures |
| Skogsstyrelsen tree height and forest data | Canopy height, density | Where vegetation stands and how tall it is |
| Lantmäteriet land cover (if available as open data) | Bog, rock, field, forest classes | Biome assignment where OSM is thin |

Import steps:

1. Crop every source to the area plus a margin, reproject to SWEREF 99 TM (meters).
2. Cut terrain into 256×256 m tiles with 3–4 LOD levels; store heights as 16-bit.
3. Compute per-tile masks: slope, wetness, biome ID, surface type.
4. Rasterize OSM roads and tracks into the masks and keep them as vector splines too.
5. Write a tile index (JSON) plus binary tiles to `data/regions/<name>/`.

Attribution for Lantmäteriet, OpenStreetMap and Skogsstyrelsen goes on a credits screen. Confirm each source's current license and download method when importing; agency portals change.

## Procedural world

Every visible object comes from a generator function plus a data definition; no 3D model files. Adding a new plant or rock type means writing one generator and one JSON entry, never touching the placement or rendering code.

**Three layers, kept separate**

1. **Generators** build a mesh from parameters: a conifer (whorled branches, drooping tiers), a broadleaf (forked branching, blobby crown), a shrub, a grass tuft, a boulder (noise-displaced sphere), a stone wall, a fence, a cabin, a power-line pylon.
2. **Species and object definitions** (JSON) give each type its generator, parameter ranges and visual variation: height, trunk ratio, crown shape, bark and leaf colors, seasonal tint, wind stiffness.
3. **Biome rules** decide what grows where from the import masks: elevation, slope, wetness, canopy height, OSM land use, distance to roads and water.

**Vegetation types for Sweden (initial set)**

| Type | Generator | Typical placement |
| --- | --- | --- |
| Norway spruce (gran) | Conifer, dense drooping tiers | Moist forest, north slopes |
| Scots pine (tall) | Conifer, bare trunk, flat crown | Dry ridges, sandy and rocky ground |
| Bog pine (tallmyr) | Conifer, stunted and crooked | Bog edges |
| Birch | Broadleaf, white trunk, light crown | Clearings, roadsides, regrowth |
| Aspen, rowan, alder | Broadleaf variants | Mixed forest, alder along water |
| Mountain birch (fjällbjörk) | Broadleaf, low and twisted | Near the treeline |
| Juniper, blueberry and heather shrubs | Shrub | Forest floor, rocky outcrops |
| Grasses, sedges, reeds | Grass tuft / card clusters | Meadows, ditches, lake shores |
| Moss and lichen | Ground shader, not geometry | Forest floor, rock surfaces |

**Formations and features**

- Granite outcrops and hällmark (bare rock slabs), from slope plus low soil depth
- Glacial erratics (flyttblock) and boulder fields
- Eskers (åsar) and moraine ridges, already present in real elevation; give them sandy pine biomes
- Bogs and mires with open water pools, tussocks and sparse pines
- Lakes and streams from OSM, with shore vegetation bands
- Clear-cuts (hyggen) with stumps, slash and young growth, from canopy-height gaps
- Man-made: forest roads with ditches, stone walls, fences, red cabins, barns, power lines, logging piles

**Rendering**

- GPU instancing for everything that repeats; per-instance seed drives variation so a pine is never quite the same twice
- Placement is deterministic from tile coordinates plus a seed, so every player sees the identical forest without sending it over the network
- Distance LOD: full mesh near, simplified mesh mid-range, flat impostor far away, nothing beyond fog
- Only objects near a vehicle get physics colliders (trunks, boulders, buildings)

## Vehicle

Milestone 1 ships one vehicle, inspired by the Swedish Army's Terrängbil 11 (Volvo C303): a boxy, narrow 4×4 built for forest roads. It is defined entirely as data, and the 6×6 Terrängbil 13 follows as the second definition to prove the system handles any number of axles. Use a generic military look without Volvo names or badges.

The vehicle definition (JSON) holds:

- **Chassis:** mass, center of mass, dimensions, collision box
- **Wheels:** any number of axles (Tgb 13 has three), positions, radius, width, which are driven and steered, portal axle offset
- **Suspension:** travel, stiffness, damping per axle
- **Drivetrain:** engine torque curve, gear ratios, high and low range, lockable differentials per axle
- **Tires:** grip per surface type (asphalt, gravel, dirt, grass, rock, wet variants)
- **Body:** parameters for the procedural mesh generator (cab shape, bed, bumpers, roof rack, colors, headlight positions)
- **Attachment points:** front and rear tow points, reserved now for the winch later

Physics uses Rapier's raycast vehicle controller. Grip per wheel comes from the surface mask under that wheel. Expect most of the tuning time to go into suspension and tire feel; build a debug overlay showing wheel loads, slip and surface early.

Reference figures for tuning the first two definitions ([Wikipedia](https://en.wikipedia.org/wiki/Volvo_C303), [Hans Högman](https://hhogman.se/wheeled-off-road-vehicles-1-swe.htm)):

|  | Tgb 11 (4×4) | Tgb 13 (6×6) |
| --- | --- | --- |
| Length | 4,350 mm | 5,350 mm (1 m longer at the rear) |
| Width | 1,930 mm | 1,930 mm |
| Height | 2,170 mm | 2,170 mm |
| Curb weight | 2,400 kg | 2,820 kg |
| Engine | 3.0 L inline six (B30), about 206 N·m at 2,500 rpm | Same |
| Key traits | Portal axles, locking differentials, drum brakes, 85 L fuel tank | Same, plus a second driven rear axle |

Treat these as starting points; the game feel matters more than exact realism.

## LAN multiplayer

Each browser simulates its own vehicle and sends its state to the server about 20 times a second; the server relays it to everyone else. This is simple, cheap and plenty for friendly co-op on a LAN.

- Server listens on all interfaces; friends open `http://<host-ip>:<port>` and pick a name
- Messages: join/leave, vehicle state (position, rotation, velocity, wheel states, lights), chat, world clock and weather
- Remote vehicles are drawn interpolated about 100 ms behind to smooth out jitter
- Remote vehicles are kinematic bodies locally, so you can bump into friends
- Server is the single source of truth for time of day, weather, region and the world seed
- No cheat protection needed for milestone 1

Define the message protocol as a versioned, language-neutral schema in the shared folder (JSON Schema to start, FlatBuffers if a compact binary format is needed later). Any future server, in any language, then only has to implement the same contract.

## Time of day and weather

The server runs a game clock (default: one in-game day per 30 real minutes) and a weather state; clients render both. Sun and moon positions come from the region's real latitude and the in-game date, so a Swedish summer night stays light and a December afternoon goes dark early.

Milestone 1 includes:

- Sky shader with atmospheric scattering, sun and moon, stars at night
- Shadow-casting sun, ambient light and fog color that follow the sky
- Vehicle headlights as spotlights, plus taillights
- Weather states: clear, overcast, rain, with smooth transitions
- Rain particles near the camera, wet-surface shader (darker, glossier), lower tire grip when wet
- Wind strength shared by weather and vegetation sway

Snow, fog banks and real-world weather via Open-Meteo come after milestone 1.

## Design for later

These are not built in milestone 1, but the code must not block them.

| Future feature | What milestone 1 must already do |
| --- | --- |
| Click-on-map region picker | Importer runs as a callable job on any bounding box; game loads any region by name; spawn point snaps to the nearest drivable OSM way |
| Multiple vehicle types (ATV, truck, tractor, old Volvo) | Vehicle fully defined by JSON; procedural body generator takes parameters, not hardcoded shapes |
| Winch | Vehicles expose attachment points; trees, boulders and vehicles near the player have colliders and stable IDs that can be anchors |
| Winching between players | Physics authority is a per-vehicle field that can move between clients, not assumed to be "my own car" |
| Mud, snow, deep water | Surface type is a mask channel read per wheel; adding sinkage later only changes the tire model |
| Seasons | Species definitions carry seasonal colors and leaf states from the start |
| Damage, fuel, cargo | Vehicle state is an extensible object synced as one message |

## Build order and done criteria

Build in this order; each step should be playable or viewable before the next starts.

1. Server skeleton: Node.js serves a page with a Three.js scene and a free-fly camera.
2. Importer v1: one Swedish area to height tiles; terrain renders with LOD and fog.
3. Ground shading from masks: forest floor, rock, bog, field, road, water.
4. Vegetation system: generators, species JSON, biome rules, instancing. Start with spruce, pine, birch, one shrub, grass and boulders, then add the rest of the table.
5. Vehicle: JSON definition, procedural body, Rapier raycast vehicle, surface grip, debug overlay.
6. Multiplayer: join over LAN, see and bump into friends.
7. Sky, day/night cycle, headlights, then rain and wet surfaces.
8. Remaining formations and man-made features; performance pass.

**Milestone 1 is done when**

- [ ] Three players on different computers on the LAN drive together in the same Swedish area
- [ ] At least eight vegetation types and four formation types appear, placed from real data
- [ ] Holds 60 fps on a mid-range laptop at medium settings
- [ ] A full day/night cycle and a rain transition look right and match on every client
- [ ] No internet access is needed while playing
- [ ] Adding a new tree species or a new vehicle needs only a generator function and/or a JSON file

To use this with Claude Code, export the doc as Markdown into the repository (for example `docs/PLAN.md`) and ask it to work through the build order one step at a time.
