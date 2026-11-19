# Multiplayer plan

Step 6 of `PLAN.md`, revisited. Started on 2026-11-19 with the recommendations below accepted
(see "Answered" in `QUESTIONS.md`). Stages 1 and 2 are built; see "Stages" for what they do and
do not do yet.

## What exists today

- **The server** already owns what everyone must agree on: the clock and the weather
  (`server/src/world.ts`), sent to every client every 2 s. Any client can change them with
  `set_world`. Messages have JSON Schemas and a protocol version (now 5), and the server
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
| A vehicle being winched by another player | The puller's browser, for as long as the cable is on | the `authority` field moves (see Winching) |
| Logbook, settings | Your browser | nothing |

The server stays a relay with a memory. It runs no physics. That suits up to 5 players on one
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
- winch: its state, the anchor's key or the hooked vehicle's id, cable length
- `authority`: who simulates it

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
  paused. The world clock keeps running.
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

The same machinery would later allow towing with a strap, and pushing a stuck vehicle out.

## Joining, names, chat

- **Address:** friends open `http://<host-ip>:8080`. The host's start menu shows that address,
  because the server knows its own network interfaces.
- **Name and colour:** asked for the first time and remembered in the browser. No passwords; it
  is a home network. A player who reconnects within a minute keeps their slot (built).
- **Chat:** Enter opens a line at the bottom; messages fade after a while. Arrivals, players
  joining and leaving, and world changes are also shown there.
- **Player list:** in the menu (Esc) and the start menu; the other players also show on the
  minimap, so holding Tab for the big minimap shows where everyone is.

## Trips together

Kept simple to begin with. A destination can be shared: it shows on everyone's map and compass.
Each player's arrival goes into their own logbook, noting who else arrived within a minute. A
shared logbook on the server can come later.

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
   which the server passes to that driver only; their browser applies it to their body, at
   most 3 m/s of change per message, and hears it as a knock. A parked vehicle's hold brake
   resists pushes (see `QUESTIONS.md`).
3. **One world.** Felled trees and ice holes shared and sent to late joiners; regions as rooms;
   who changed the clock or weather shown in chat; "join a friend".
4. **Winching each other.** Authority moves to the puller while hooked.
5. **Together.** Shared destinations, the host's address in the start menu, the
   performance pass with 5 vehicles (draw calls, sound sources, particles).

## Testing

- **Unit tests:** interpolation and extrapolation, the state message both ways against the
  schema, the authority handover.
- **Server tests** (like `server.test.ts`): several headless WebSocket clients join, send state,
  fell a tree, leave, rejoin; a late joiner gets the full list.
- **Headless screenshots:** two pages in one browser, each driving a scripted route, each
  capturing the other's vehicle.
- **Real test:** two or three computers on your network. The host's firewall must allow port
  8080.
