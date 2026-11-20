# Multiplayer plan

Step 6 of `PLAN.md`, revisited. Started on 2026-11-19 with the recommendations below accepted
(see "Answered" in `QUESTIONS.md`). Stages 1 to 4 are built; see "Stages" for what they do and
do not do yet.

## What exists today

- **The server** already owns what everyone must agree on: the clock and the weather
  (`server/src/world.ts`), sent to every client every 2 s. Any client can change them with
  `set_world`. Messages have JSON Schemas and a protocol version (now 7), and the server
  validates what it receives.
- **The vehicle** is simulated entirely in the browser (`VehicleSim`, Rapier). Its state record
  already has room for an `authority` field (planned since milestone 1).
- **Things the world remembers, only in this browser:**
  - Felled trees (`felling.ts`). Each tree has a permanent key, so one message can name it.
  - Holes in the ice (`groundStore.ts`), at most 8, kept until the thaw.
  - Tyre tracks (`tracks.ts`). Only for show; they fade after 15 minutes.
  - The logbook and the region you last picked (local storage).
- **Not world state:** how deep a tyre has dug in (`sink`) belongs to the wheel, not the ground,
  so it travels with the vehicle. Spray, exhaust, grime and sound are worked out from the
  vehicle's state and the ground under it.

## Who decides what

| What | Decided by | Sent as |
|---|---|---|
| Your own vehicle | Your browser | state, 20 a second |
| Clock, date, weather | Server | `world`, every 2 s and on change |
| Felled trees, holes in the ice | The browser where it happened, kept by the server | an event, once; a list for anyone joining |
| Tracks, spray, exhaust, sound of others' vehicles | Worked out by each browser from the state it receives | nothing extra |
| A vehicle joined to another by a cable | One browser for the whole group, chosen by the server | `towing`, from the server (see Winching) |
| Logbook, settings | Your browser | nothing |

The server stays a relay with a memory. It runs no physics; for cables it keeps the list and
decides which browser runs which vehicle. That suits up to 5 players on one
network, and keeps the server as small as it is now. Physics on the server would only be
needed for strangers over the internet, where you cannot trust a browser's word, and that is
not the aim.

## Vehicle state message

Sent by each client about 20 times a second, passed on by the server unchanged apart from the
sender's id. Roughly:

- vehicle definition name, colour, a counter that goes up on every jump (so the others snap
  to the new place instead of sliding across the map)
- position, rotation, velocity, spin
- per wheel: steer, rotation, suspension travel, sink, spin and slide, snow and water depth
- engine: rpm, throttle, gear, high or low range, which diffs are locked, drowned
- lights; grime level (a few numbers, sent once a second is enough)
- winch, while its cable is out: its state, the cable's far end, length, pull and drum
- who simulates it: the server's `towing` says, and a snapshot sent for another driver's
  vehicle carries `by`

JSON is fine: about 600 bytes, so 5 players at 20 a second is around 60 kB/s for each client.
That's nothing on a home network. Numbers are rounded before sending, and the schema keeps the
format fixed.

## The other players' vehicles

- **Drawn 100 ms in the past,** blended between the two received states on either side, so
  they move smoothly even when a message comes late. Up to 250 ms they are carried forward from
  their last speed, and after that they freeze. A vehicle not heard from for 5 s is removed.
- **Same body, same effects.** The body generator, lights, tracks, spray, exhaust, grime and
  engine sound read from the vehicle state, not from the physics, so a remote vehicle gets them
  all. Today these read `VehicleSim` directly (view, spray, tracks, grime, exhaust, sound).
  The first job is a small `VehicleState` interface that both `VehicleSim` and a new
  `RemoteVehicle` provide. That is the main refactor in the client.
- **Solid.** In your world a remote vehicle is a kinematic body: your vehicle bounces off it,
  but your physics cannot move it. When the two touch, your browser sends the push to its
  owner, whose browser applies it. On a home network the delay is a few milliseconds, so a
  nudge or a push up a slope works. A hard crash will feel a little uneven: each side feels its
  own half of the hit.
- **Name tags** above each vehicle, fading with distance; the players' positions on the map (M).

## Shared changes to the world

- **Felled trees:** `felled { key, direction }`. The server keeps the list for the session.
  Without this a friend drives straight through a tree that is still standing on your screen.
- **Holes in the ice:** `ice_hole { x, z }`, with the same cap of 8. The server drops them all
  at the thaw, from the date.
- **Joining late:** after `welcome` a new player gets the clock and weather, the players, the
  felled trees and the holes. Tracks are not sent; older ones simply aren't there for them.
- **New ways the world can change** (anything added in single player from now on) should follow
  the same pattern. Each change must name what it changed with a permanent key or a position,
  so it can be sent as one event. Its outcome must not depend on `Math.random`. That is the
  one rule single-player work has to keep.

## Regions

The server's region is the one announced in `welcome`. When playing alone you can choose
another, and that stays allowed. **Recommended:** a "room" is a region. You see and hear only
the players in the same region as you, and the start menu shows how many players are in each.
Felled trees and ice holes are kept per region. The clock and weather stay shared by the whole
server.

## Time, pausing, flying

- **Pausing** stops only your own physics. Your vehicle stands still for the others, marked as
  paused. On another driver's cable it is run by a browser that is not paused instead. The world clock keeps running.
- **The time panel (T)** changes the clock and weather for everybody, as it already does through
  `set_world`. A chat line says who changed what.
- **Flying and the map:** allowed. Your vehicle is parked where you left it.
- **Jumping to a start point** is allowed. A new start point, "join a friend", puts you behind
  another player's vehicle.

## Winching each other

The hard part, and the last stage. A cable is a stiff spring (250 kN/m). Splitting it across two
browsers, each pulling its own end, would make it oscillate, whatever the delay.

**Recommended: the puller takes over.** While hooked, the puller's browser simulates both
vehicles, and `authority` on the towed vehicle moves to the puller. The towed player's controls
(steering, brake, throttle, gear) go to the puller's browser 20 times a second, so they can
still steer and help with their own wheels. They feel about 50 ms of delay, which is fine while
being towed. Unhooking hands authority back. The towed player's browser then carries on from
the last state it received. If the puller drops out, authority returns at once.

**Decided:** anyone can hook onto anyone, without asking.

**Chains.** All vehicles joined by cables form one group, and one browser runs the whole group,
so no cable is ever split across two browsers:

- **Anna winches Bo:** Anna's browser runs both. If Bo then winches Cecilia, his winch input
  goes to Anna's browser like his steering, and Anna's browser takes Cecilia over too.
- **Two groups joined by a new cable:** the bigger group's browser takes over the smaller
  group, so as few vehicles as possible change hands. On a tie, the puller's browser does.
- **A cable comes off:** each part still joined to the running browser's own vehicle stays
  with it. Any other part goes back to its own drivers. A part that is still joined by a cable
  goes to the browser of whoever pulls in it, one browser for the whole part.
- **Range:** cables are at most 40 m, so even five vehicles in a chain stay within about 160 m.
  The running browser loads ground and tree colliders around every vehicle it runs.

The same machinery would later allow towing with a strap, and pushing a stuck vehicle out.

## Joining, names, chat

- **Address:** friends open `http://<host-ip>:8080`. The start menu shows that address,
  because the server knows its own network interfaces (built; in Docker set `ADDRESS`).
- **From outside the home network:** a Cloudflare Tunnel, run as the `tunnel` service in
  `compose.yaml` (`docker compose --profile tunnel up -d`, token in `.env` as
  `TUNNEL_TOKEN`), reaches the game at `http://game:8080` from inside Docker, so no port is
  opened in the router. The page is then https and the client uses `wss` by itself. Cloudflare
  Access stands in front (an allow list of emails, a one-time code by email). Players at
  home keep using the home address, which skips the round trip to Cloudflare. `ADDRESS`
  takes both, comma separated, and the start menu shows them all.
- **Accounts (built):** with `ACCESS_TEAM` and `ACCESS_AUD` set, the server checks the token
  Access signs into every request (against the team's public keys, so a request from the
  home network cannot pretend). `GET /api/me` tells the page who is logged in and what is
  kept for them: the browser values under `ACCOUNT_KEYS` (name, paint, region, vehicle,
  start, last position, logbook, settings, minimap zoom, gamepad). The page puts them in its
  storage before reading it, and sends back what changed every 5 s and when it is hidden
  (`PUT /api/me`, same-origin only). The logbook is merged, so arrivals from two devices are
  all kept. One JSON file per account in the `accounts` volume. Home-network players are
  guests and keep things in their browser, as before.
- **Name and colour:** asked for the first time and remembered in the browser, and on the
  server for a logged-in driver. No passwords of our own. A player who reconnects within a minute keeps their slot (built).
- **Chat:** Enter opens a line at the bottom; messages fade after a while. Arrivals, players
  joining and leaving, and world changes are also shown there.
- **Player list:** in the menu (Esc) and the start menu; the other players also show on the
  minimap, so holding Tab for the big minimap shows where everyone is.

## Trips together

Kept simple to begin with. A destination can be shared: it shows on everyone's map and compass
in blue, beside each driver's own destination, which it leaves alone. Each player's arrival goes into their own logbook, noting who else arrived
within a minute. A shared logbook on the server can come later.

## Stages

Each stage ends playable, with tests, and I stop after each for you to try it.

1. **Seeing each other.** *Built.* `hello` carries the name and paint, `profile` changes them,
   and the server sends `players` to everyone on every change. Each browser sends a `state`
   snapshot 20 times a second (`client/src/multiplayer/track.ts`, about 350 bytes) and `away`
   when it goes back to the start screen; the server passes them on with the sender's id.
   Others are drawn 100 ms behind, carried on 250 ms, removed after 5 s
   (`multiplayer/others.ts`), only in the same region. The view takes a small `VehicleShape`
   (definition, body pose, wheels) that both the simulation and a remote vehicle provide; the
   rest (`VehicleState` for spray, tracks, grime, exhaust and sound) comes with stage 2. The
   two nearest others with their lights on get real beams, from a pool of four made when the
   first other vehicle shows (adding lights rebuilds every material). Setting off from a start
   point where someone already stands puts you 9 m behind them. A tab keeps a token
   (`sessionStorage`); reconnecting with it within a minute is the same player, with no
   "left" or "joined". Name tags fade by 600 m; markers on the map and minimap;
   player lists in the start screen and the menu; chat on Enter, with lines from the server
   for joining, leaving, renaming and changes to the time and weather. Protocol 4.
2. **Touching.** *Built.* The effects read a `VehicleState` (`client/src/vehicle/state.ts`)
   that the simulation and a remote vehicle both provide. The snapshot now carries per wheel
   sink, spin, skid, slide and water and the ground under it, the engine (revs, gear, range,
   shifting, pedal, drowned) and the wading depth, about 600 bytes; protocol 5. Each other
   vehicle gets its own spray, exhaust and tracks within 400 m, mud on its body, and its engine
   and tyres heard within 300 m (let go at 380 m). In our physics it is a kinematic body with
   the same box shapes as the simulation's, moved to its snapshot pose before every step
   (jumped there when more than 5 m off). After each step the contact impulses between our
   body and theirs are summed (`pushOn`), and every 50 ms sent as `push { to, impulse, at }`,
   which the server passes to that driver only; their browser applies it to their body and
   hears it as a knock. Since it was measured against a wall, a steady shove (up to 0.5 m/s
   of change per message) passes whole, anything harder at half, at most 2 m/s. A parked
   vehicle's hold brake resists pushes, on purpose. The chase camera rises over another
   vehicle in its way.
3. **One world.** *Built.* The server keeps, per region and for the session only, the trees
   knocked down (`felled { region, tree: { key, x, z, dx, dz, diameter } }`, at most 5000) and
   the holes in the ice (`ice_hole { region, hole }`, at most 8, dropped once the calendar
   says the lakes are open), in `server/src/rooms.ts`. Each change goes to the others in that
   region, who hear the tree crack. A browser entering a region (after loading it, and after
   every reconnect) sends `room { region }` and gets back everything changed there so far. The
   server also notes each player's region, so the lists show where everyone is and the start
   screen's map cards say how many drive in each. "Join" next to another driver (start screen
   and menu) sets off just behind them; in another region the page loads it first and joins
   once their vehicle shows up (within 30 s). A message the server refuses is only logged now,
   instead of marking the connection as offline. Protocol 6.
4. **Winching each other.** *Built.* Another driver's vehicle is an anchor like a tree: the hook
   goes on the tow point you aim at, front or rear (`Others.vehicleAnchors` gives both). The browser running a winch tells
   the server when it hooks on to a vehicle or lets go (`cable { from, to?, seq }`). The server
   keeps the cables and works out who runs each group (`server/src/towing.ts`, rules as under
   "Chains" above), and sends everyone `towing { cables, runs, ack }`. `ack` is the last
   `cable` or `free` from that browser it took into account, so a browser can tell a cable the
   server refused from one it has not seen yet. In the browser, `multiplayer/towing.ts`
   handles the rest:
   - **Giving a vehicle away:** `handover { vehicle, to, state }` carries everything about the
     vehicle and its winch (`VehicleSim.save`, `Winch.save`).
   - **Taking one over:** the browser waits up to a second for the handover, then carries on
     from the vehicle's last snapshot instead. It simulates the vehicle in its own physics
     world with the driver's `drive` controls, which are sent 20 times a second and at once on
     a key press (range, diff locks, getting back on the wheels, hooking on, unhooking). It
     sends the vehicle's snapshots as `state { of }`, which the server passes on with `by`.
   - **Your own vehicle run elsewhere:** it becomes a kinematic body following those snapshots
     (`VehicleSim.follow`), and your winch shows theirs (`Winch.mirror`). Choosing what to hook
     on to still happens on your screen.
   - **Moving your vehicle somewhere new** (start point, start screen, another vehicle) sends
     `free`: every cable on it comes off, and your browser runs it again at once.
   - **Server checks:** only the browser running a vehicle may speak for it or hook its winch,
     and a push goes to the browser running the pushed vehicle. A driver leaving, going to the
     start screen or changing region frees their vehicle. When a browser that ran others
     disconnects, the cables of the vehicles it ran come off too.
   - **Drawing:** a snapshot carries the winch's cable while it is out, so everyone sees
     everyone's cables. Ground and tree colliders are kept around every vehicle a browser runs.

   - **Pausing** (`pause { paused }`, protocol 8): a paused browser runs nothing while another
     in its group can. What it ran, its own vehicle included, goes to one that is not paused,
     and its paused screen follows along (physics keeps stepping while it follows).

   Known limits:
   - A vehicle run for someone else breaks thin trees only by pushing on them, not by
     hitting them at speed: tree breaking still measures our own vehicle's speed.
   - The diff lock lights on a towed driver's dash do not change until they drive their own
     vehicle again. Protocol 7.
5. **Together.** *Built.* Protocol 9.
   - **Sharing a destination:** the map's side panel offers "Share with everyone" for one's own
     destination when someone else is on the server (`share { region, destination }`, null to
     stop; anyone may stop it or share another instead). The server keeps one per region
     (`rooms.ts`) and passes it on; a driver entering the region later gets it with `room`.
     It is a destination of its own beside each driver's own, which it never touches: a blue
     guide line (under the own one when both show), a blue beacon, a blue pin on the map and
     minimap, and a trip of its own in the logbook (`Trips` keeps an `own` and a `shared`
     trip). When both are the same place, only the shared one shows and the arrival is logged
     once. Once reached, a reload does not guide there again.
   - **Arriving together:** arriving at the shared destination, or at a place from the map
     data (a hut, a summit…), sends `arrived { region, destination }`; the others in the region
     see it in chat. Arrivals at marked spots and other places of one's own are not told. The
     logbook entry lists those who arrived at the same place within a minute before (`with`),
     and an arrival within the minute after is added to it (`Trips.together`): "with Bo and
     Cilla". When everyone in the region (two at least) has reached the shared destination,
     the server says so once: "Everyone has arrived at …", whenever that happens, also when
     the last one missing leaves the region.
   - **The host's address:** `welcome` carries `addresses`, the server's IPv4 addresses on its
     networks with the port; the start menu shows "Friends join at …". Inside a container
     there are none to tell, so `ADDRESS` in the environment says it: one address or several,
     comma separated (the public one through the tunnel and the home one).
   - **Performance with five:** `?ghosts=4` brings made-up drivers along, each following
     our own track 14 m apart, through the same path as real snapshots
     (`multiplayer/ghosts.ts`). Measured in a headless Chrome on the host (WebGPU, 1400×800):
     with four others in view, all with spray, smoke and tracks, the frame took 6.5–6.7 ms of
     CPU against 6.5 ms alone, still 60 fps, with draw calls within the scene's own variation
     (each vehicle is about ten merged meshes). Beams were already limited to the two nearest
     lit vehicles. Sound was the one cost without a limit (some thirty audio nodes and an
     engine processor per vehicle within 300 m): now only the three nearest are heard, and
     with a lean voice (`VehicleAudio` `lean`): engine, gears, knocks and splashes, but no
     tyre squeal, wet hiss or body scrape, and a ground's tyre sound only once one of its
     wheels has been on it. The
     developer read-out (F3) shows how many others are drawn, heard and with effects.

## Testing

- **Unit tests:** interpolation and extrapolation, the state message both ways against the
  schema, the authority handover (`multiplayer/towing.test.ts` runs three browsers, each with
  its own physics, through the server's towing rules).
- **Server tests** (like `server.test.ts`): several headless WebSocket clients join, send state,
  fell a tree, leave, rejoin; a late joiner gets the full list.
- **Headless screenshots:** two pages in one browser, each driving a scripted route, each
  capturing the other's vehicle.
- **Real test:** two or three computers on your network. The host's firewall must allow port
  8080.
