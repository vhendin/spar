# Open questions

Questions waiting for an answer or a play-test. New ones are added as they come up; answered
ones move to the bottom with the answer, so the reasoning stays findable.

## Open

### Freezes of a few seconds (this commit)

- **Asked:** playing online with a friend, the game froze for a couple of seconds every so
  often; the user guessed the ground loading in (2026-11-26).
- **Found:** not the ground (it is built off the main thread). The freezes were the graphics
  card building shaders, which the frame waits for: up to a few tenths of a second each,
  seconds for a handful when the driver has not built them before (after an update).
  - Every material's shaders are built for the lights in the scene. The other drivers'
    headlight beams hung on their vehicles, so opening the map (which hides the others), a
    friend going to the start screen, changing vehicle or leaving, or the beams passing to
    another vehicle, changed the lights, and everything on screen was built again. With a
    friend's lights on, closing the map froze the game for 3.4 s in the test.
  - Each plant material, and its shadow, was built the first time that plant came into view:
    about 20 builds in a minute of driving, each a short stall.
- **Done:**
  - Headlight beams stay in the scene for good, never hidden or moved to another parent, and
    follow their vehicle; ours is one pair made at start, the others' two pairs made as soon
    as the server says anyone else is online. Opening and closing the map now builds nothing.
  - Stand-ins for every plant material, the buildings and lines, the spray and the exhaust
    are drawn for the first three frames, so their shaders are built while loading. A
    minute of low flight with two players then built nothing and stalled no frame over
    100 ms (before: about 20 builds and stalls of 160–230 ms).
- **Costs:** loading takes a little longer (the same builds, moved there). Nothing per frame.
- **Open:**
  - A friend who comes online while you are already driving still makes everything build
    once, when their beams are made. Making the beams always, even alone, would avoid it but
    cost about 0.3 ms of GPU time per frame (4 more lights on every pixel). Worth it?
  - Other things first met while driving (the winch, the drone, campfire) may still stall
    once; not seen in the test.

### Leafy trees in winter (f32cecd)

- **Asked:** the user found the far forest odd while driving in winter (2026-11-26). Not the
  fog of war: the code from before it gives the same trees. Close by, bare broadleaf trees
  were solid dark grey lumps; far away, a white snowy speckle much lighter than the near
  trees.
- **Decided** (the user, 2026-11-26): bare branches; a little snow on top of them; the crown
  thins to the branches in autumn and grows back in spring; far pictures that match the
  near trees.
- **Done:**
  - Birch, aspen, rowan, alder and mountain birch grow a side branch out to every leaf blob,
    with three fine twigs inside each blob, in the species' winter colour. As the leaves
    fall, the blobs shrink onto their twigs, a little apart from each other; in winter only
    the stems, branches and twigs are left. The branches face the right way, so their upper
    sides catch a little snow.
  - The simpler trees in the middle distance (55–220 m) keep their main branches, straight,
    and the leaf blobs on their ends.
  - The far pictures are drawn without light, plus a second sheet of which way each pixel
    faces. The game lights them with the same sun and sky as the near trees, so a spruce
    across the lake has its shaded side towards you when you look into the sun. In winter
    they are no longer brighter and whiter than the trees close by. Bare trees are drawn
    with thicker twigs in the pictures, so a bare birch wood stays visible far off.
  - `?atlas=normals` shows the facing sheet, as `?atlas=1` shows the pictures.
- **Costs:** a near leafy tree is about 500 triangles instead of about 300 (budget 600), a
  middle-distance one about 90 instead of 66 (budget 100). The picture sheet is drawn twice
  at start and when the season turns. Worth a run of the benchmark.
- **To try:** drive in winter (or with `?time=2027-02-10T12:00`), in late September and
  October as the leaves fall, and in summer, looking both towards and away from the sun.
  The far forest is now darker when you look into the sun, in summer too.
- **Open:**
  - Enough twigs? Three per blob reads as bare branches up close but sparse; more would cost
    triangles.
  - One broadleaf tree in the middle distance shows as a tall green block on a thin trunk, in
    summer (across the lake from 9372, 4528 in Vålådalen). Not looked into yet.
  - Summer far forest: darker than before, most when looking into the sun. Right, or too dark?

### Trails to drive (4206e6a)

- **Asked:** idea 3 of `docs/OVERTHEHILL.md`, next in its suggested order. Decided before
  building (the user, 2026-11-26, one question at a time):
  - **Kinds:** hiking routes (the named route relations: Kungsleden, Pilegrimsleden, the
    summer routes between huts), snowmobile trails (skoterleder, imported for this), power-line
    corridors and ascents (the steepest drivable line from a road to a summit).
  - **Snowmobile trails in winter only:** offered when there is snow on the ground, drawn as a
    packed, marked lane. In summer the red-cross poles stand but the trail is not offered.
  - **Starting:** drive to its start. Trailheads show on the map once seen; stopping at one
    offers the trail with a quiet prompt, as camping does.
  - **Straying:** checkpoints every few hundred metres; more than about 100 m off the line, a
    gentle note, then back to the last checkpoint, facing on. Never from the beginning.
  - **Finishing:** a line in the logbook (date, vehicle, time taken) and the trail drawn in full
    ink on the map. No unlocks.
  - **Time:** kept quietly: the logbook has the time taken and the best time; nothing shows
    while driving.
  - **Marks:** the real ones: red crosses on poles for snowmobile trails, orange-painted
    cairns and posts for hiking routes, the pylons for power lines, small wands for ascents. The
    next checkpoint's pole has a ribbon; the line shows on the minimap.
  - **Length:** long routes cut at huts, shelters, roads or crossings into stretches of
    2–8 km, each its own trail ("Kungsleden: Sälka – Tjäktja").
  - **Multiplayer:** each on their own; no server changes.
- **Done:**
  - The importer (`trails.py`) joins the ways of each named hiking route, the snowmobile ways
    and the power lines into paths, clipped to the area, and cuts them into 2–8 km
    stretches, at huts, shelters, lodges and camp sites or where a drivable road is crossed.
    A stretch lying mostly on one already kept (E1 and Södra Kungsleden) is left out.
  - Ascents: from each named summit, the shortest way down on a 15 m grid with no step steeper
    than 27° and none through water, to a drivable road at least 500 m off and 80 m lower.
  - Names: "Route: A – B" from named places within 200 m of the ends, else a village within
    1.5 km, else a bearing ("2.1 km NE of Ottsjö"); "Ascent of Ottfjället Östertoppen".
  - Trails per region: Vålådalen 32 (17 hiking, 8 snowmobile, 3 power, 4 ascents), Åre 31,
    Tandådalen 10, Kebnekaise 2, the proving ground one of each. Järvsö and Björnrike none:
    their areas are too small for any 1.5 km stretch. About 30 kB more per big region.
  - Snowmobile ways now have a 5 m strip cleared of trees, as power lines have theirs.
  - Stopped within 20 m of either end (an ascent only at its foot), the line at the bottom
    offers "Drive Proving round · 2.4 km hiking route · J". A card names the trail, its length,
    climb and checkpoints. A checkpoint about every 300 m, passed within 25 m; the line shows
    "checkpoint 3 of 8". More than 100 m off the line for 5 s: back at the last checkpoint,
    facing on. J again gives it up; being put somewhere else (the map, a start) does too.
  - At the end: "Trail driven · 23 min · written in the logbook" ("your best" when quicker).
    Kept per region (`spar.trails`: first, last, runs, best time) and with the account.
  - Marks: a red cross on a 2.6 m pole every 70 m along snowmobile trails, a small cairn with
    an orange top every 110 m along hiking routes, a thin wand every 50 m up an ascent; none on
    roads or in lakes. The next checkpoint has a white pole with orange tape in the wind.
  - Map: trails dotted in their colour (hiking orange, snowmobile red, power grey, ascents
    purple), those driven in full ink, a small flag at each start once seen; snowmobile trails
    only in winter. The trail on the way is drawn bold on the map and minimap, with a ring at the
    next checkpoint. The logbook: "Hiking routes 2 of 17 · …" and each trail with its best time.
- **To try:** on the proving ground, stop at the power line's north end by the road and press
  J, then drive south; the ascent starts at the road's bend below the fell. In Vålådalen, the
  map shows the flags once seen.
- **Open:**
  - J starts a trail (C is camping). Another key?
  - The packed winter lane along a snowmobile trail is not drawn yet: the ground shader has no
    room for another surface. In winter only the crosses and the map mark the trail. Needed?
  - 300 m between checkpoints, 25 m to pass one, 100 m and 5 s before being put back: right?
  - Names from bearings read stiffly ("Snowmobile trail: 3.9 km S of Vikböle – 3.6 km SW of
    Vikböle"), and some come out as "… by Åre kommun" or with "(2)". Better ideas?
  - Ascents: 27° the steepest step. Kebnekaise has none (no drivable road); Tandådalen's two
    climb only 80–90 m. Steeper, or allow starting from tracks and paths?
  - Should ski runs, lift lines or streams make trails too (left out for now)?

### The map fills in as you drive (5f6c679; over lakes 0af2341)

- **Asked:** idea 1 of `docs/OVERTHEHILL.md`. Decided before building: unseen ground pale (the
  relief, contours and lakes still faintly there), roads, paths, buildings and places hidden
  until seen; seeing by line of sight over the real ground, blocked by hills and forest; the
  driven trail not saved; each driver their own map.
- **Done:**
  - Every 25 m driven (at most once a second) the game looks round 1.5 km from the driver's
    eyes (2.5 m up) over the map's 8 m heights and the tree heights from the canopy mask. Hills
    hide what is behind them; trees let sight through for about 80 m, then are a wall. In a wood
    you see some 100 m, on the open fjäll the full 1.5 km.
  - Over open water sight goes further: a ray still out on a lake at 1.5 km goes on over the
    water, up to 4 km, and sees 150 m of the far shore. From Ottsjö the whole of the lake and
    its south shore open up (7 % of Vålådalen after 40 s of driving, against 3 % before).
  - Standing within 30 m of a summit, viewpoint or lift top looks 5 km round, once per visit.
  - The drone sees from where it flies; the fly camera (F) does not.
  - Huts and lodges always show. Places already in the logbook show 300 m round them the first
    time, so nobody starts blank.
  - The proving ground is always whole. Settings → Map: "Fills in as you go" or "Whole".
  - Kept per region in the browser (`spar.seen.<region>`, about 2 kB for 3 % of Vålådalen)
    and with the account, merged across devices.
  - Seen share in the F3 read-out and the logbook; the map's trip list says how many are seen.
  - `?seen=none` forgets a region, `?seen=all` sees all of it.
  - A look takes about 4 ms (33 ms from a summit) and is spread over frames, at most 2 ms each.
- **Decided:** sight reaches further over lakes (the user, 2026-11-26).
- **To try:** drive from Ottsjö along the lake, then up to a summit or a viewpoint, and open the
  map (M). Do it twice, with a reload between.
- **Open:**
  - Are 1.5 km and 5 km right, and the 80 m into a wood?
  - Is the pale too pale or not pale enough?
  - The edge of what is seen is soft but a little speckled along forest edges. Fine?
  - Over water: are 4 km and 150 m of far shore right? A long lake is cut straight at 4 km.
  - Should the summits that the map finds itself (the spot heights) count as lookouts too? Now
    only summits from the map data do.

### Camp at a shelter (this commit)

- **Asked:** idea 7 of `docs/OVERTHEHILL.md`, next in its suggested order. Decided before
  building (the user, 2026-11-26, one question at a time):
  - Camping always rests until the **next dawn**. Where the sun neither rises nor sets in the
    next 24 hours (midnight sun, polar night) it rests **8 hours**, and the card says "The sun
    never set" or "The sun never rose".
  - The night is **watched**: the camera settles on the fire, the clock runs fast for about
    15–20 s through dusk, stars and moon to dawn, and the fire burns down to embers. Any key
    ends it early at dawn.
  - **Where:** shelters, camp sites, huts and lodges, the real places with somewhere to sleep.
    No tent anywhere.
  - **Starting:** a quiet prompt when stopped within about 30 m ("Camp at Stensdalsstugan: C",
    a button on touch). Nothing happens without pressing it.
  - **Multiplayer:** everyone within about 50 m of the fire must press Camp; others see a line
    that someone is camping. When all near have agreed, the night passes for everyone; those
    further off just see it go by.
  - **Kept:** each night in the logbook (place, date, season, vehicle), "Nights out: 4, at 3
    places", the list folded away, and a small mark on the map at a place camped. No score.
  - **At huts and lodges:** windows glow and smoke rises from the chimney. At shelters and camp
    sites the fire in the ring is lit, with flickering light and sparks.
- **Done:**
  - Stopped (under 0.6 m/s) within 30 m of a shelter, camp site, hut or lodge, a line at the
    bottom offers "Camp at Stensdalen until dawn · C" (tap it on a touch screen). C no longer
    opens the credits; they are in the menu. Not offered again at the same place until driven 40 m away.
  - The rest ends at the next sunrise (sun's centre 0.83° below the horizon), worked out in
    the browser from the region's latitude and the clock; 8 hours when there is none in the
    next day.
  - The server keeps one camp at a time (the clock is the whole server's): it knows where each
    vehicle is from its snapshots, waits until everyone within 50 m has agreed, then runs the
    clock to dawn over 18 s, stops there and goes back to its old pace. Anyone changing the
    clock (T) ends the night where it is. A waiting camp is given up when the one waiting
    drives 40 m off. The chat says who camped where.
  - The night: the camera comes in front of the fire over 3 s, looking back across it at the
    shelter (at a hut, from the vehicle's side, at the house and the sky), drifting a little
    and lifting towards the sky in the small hours. Dashboard and minimap hide. The fire has
    flames, sparks, smoke and a warm glow on the ground; a hut's windows glow and its chimney
    smokes (huts to camp at always get one now, and windows even when small). No real light
    is added: a new light would rebuild every material's shader. The fire burns down over 12 s
    after dawn. Any key (or a tap on the line) wakes everyone at dawn.
  - Morning: a card with the place's name and "Dawn", "The sun never set" or "The sun never
    rose".
  - Logbook: "Nights out: 3 nights, at 2 places", each night folded away (place, date, vehicle,
    who else, and whether the sun set). A small tent on the map by each place camped at.
    Kept in the browser (`spar.nights`) and with the account, merged.
  - Proving ground: a shelter, a camp site and a hut east of the road, between the finds and
    the forest.
  - Protocol 11: a `camp` message each way, and `until` on the world's time.
- **Answered (the user, 2026-11-26):** all fine as built: 18 s for every night, no gamepad
  button for now; the credits need no key of their own, so C is camping only.

### More kinds of places to find (this commit)

- **Asked:** idea 2 of `docs/OVERTHEHILL.md`. Decided before building (the user, 2026-11-26):
  all four groups (summer farms; waterfalls, rapids and springs; historic places and cairns;
  fords and passes); quiet finds rather than destinations; a small model at each; and also the
  highest point per region and the shores of named lakes. Fords thinned, not all of them.
- **Done:**
  - The importer writes a `finds` list from OpenStreetMap: named summer farms
    (`place=isolated_dwelling`), waterfalls, rapids, springs, historic places (boundary stones,
    memorials, monuments, aircraft wrecks, mines, ruins, graves, wayside crosses), cairns,
    passes and saddles, and fords. Unnamed ones are named like destinations ("Ford 1.1 km W of
    Ottsjö"). One within 25 m of a destination is left to the destination (Vålåforsen stays a
    sight).
  - Fords: on a track you may drive first, then in an order from a hash of their id, keeping
    only one per 1 km. 23 in Åre (of over 300), 6 in Vålådalen.
  - What there is now: Vålådalen 2 waterfalls, 6 fords, the aircraft wreck on Ottfjället and
    Yngves grav, and 7 named lakes; Åre 5 waterfalls, 23 fords, 2 passes and 13 lakes; Järvsö
    2 summer farms. The 14 summer farms counted round Vålådalen lie outside its 10 km.
  - Found by driving within 30 m (a ford within 10 m, so you drive through it; a pass within
    60 m; a named lake within 15 m of its shore or out on it). Not from the drone or the fly
    camera. A card says "Found · boundary stone" and the like; nothing else happens.
  - On the map: a small diamond once seen, hollow until found, filled after; a found lake gets
    its name. Not in the destination list. The map's "N found" for destinations now says "N seen".
  - Models: a boundary stone with a cross cut in it, a memorial stone with a plaque, an aircraft
    wreck (fuselage, wing, plates), the timber mouth of a mine in a bank with a spoil heap, low
    ruined walls, a grave cairn, a log trough and pipe at a spring, a cairn at a pass, and two or
    three small barns at a summer farm with no mapped buildings. Waterfalls, rapids and fords
    keep their water.
  - The highest ground reached in each region, with vehicle and date.
  - Logbook: "Found on the way: springs 1 of 1 · historic places 0 of 7 …", the highest point,
    and the finds folded away. Kept in the browser (`spar.finds`, `spar.highest`) and with the
    account, merged across devices.
  - The proving ground has one of each by the road south of the clear-cuts, a waterfall on the
    stream into the lake and a ford on the forest track.
- **Decided (the user, 2026-11-26):** 1 km between fords; the reach as it is; named lakes
  only. More work on the wreck, the mine and the stones, and grey log barns: done (this
  commit):
  - the wreck: the front of the fuselage with a stripe, the engine and a bent two-bladed
    propeller, a torn-off wing with its tip bent up and a worn marking, the tail lying apart
    with its fin and tailplane, plates strewn round;
  - the mine: faces downhill, into a turfed mound; a sagging timber frame, rails on sleepers
    with a rusty ore tub on them, the spoil heap beside;
  - the boundary stone and the memorial: lumpy natural stones of many faces, some tinted with
    lichen; the boundary stone flat on top with its cross, small stones at its foot;
  - summer farm barns: grey unpainted log with dark seams and crossed log ends, dark roofs.
- **Open:** are the new models good enough, or does one still look off?
- **To try:** the proving ground's row of finds; in Vålådalen a ford (1.1 km W of Ottsjö) and a
  lake shore; the logbook (Esc → Logbook).

### Ideas from Over the Hill (`docs/OVERTHEHILL.md`)

- **Asked:** explore overthehill.app (the fan wiki for Over the Hill) and write down what Spår
  could take from it, thinking broader since our world is real map data.
- **Done:** `docs/OVERTHEHILL.md`: what they do with numbers, 17 ideas turned to Spår, a list
  only real data allows (weight-limited bridges, gates, ice roads, midnight sun), and an order.
- **Decided:** the map that fills in first, then more kinds of places (both built, above).
- **Open:** what next? Suggested: camping at a shelter until dawn.
  Upgrades: earned by doing, or simply free choices in the garage (no money, by the pillars)?

### Trees that hold (this commit)

- **Asked:** "The bigger trees fall too easy. Even a car at pretty high speed wouldn't knock
  down a tree. The car would wreck." Trunks up to 30 cm gave way, a 15 cm one at about 10 km/h,
  and the crash jolt itself counted as a push, so a forest was punched through at speed.
- **Done:** only trunks up to 20 cm give way (a spruce some 7 m tall); what it takes rises
  steeply: 6 cm at walking pace, 10 cm at ~13 km/h, 15 cm at ~33 km/h, 20 cm at ~63 km/h
  (for a 2.4 t vehicle; a lighter one needs more speed), each hit taking most of the speed it
  needed. Pushing over in low range counts only while nearly still against the trunk. What
  breaks goes by the trunk as drawn, so saplings are not as strong as the thicker collider
  they get. Anything bigger stops the vehicle dead.
- **Open:** there is no damage. A hard hit on a grown tree stops the vehicle but leaves it
  whole; should a crash wreck it (bent, slower, a breakdown to recover from)?
- **To try:** driving into a forest at speed; pushing a small tree over in low range.

### Something to see at the places (this commit)

- **Asked:** "I arrived at a shelter, and there was no shelter." The places worth driving to
  were only points from the map data; unless the place was also mapped as a building, nothing
  stood there.
- **Done:** built in the browser from the points already downloaded (no new import needed):
  - shelter: a lean-to of logs on a plank floor, open at the front under a roof sloping to the
    back, a fire ring in front and a log to sit on;
  - summit: a cairn of stones;
  - viewpoint: a bench facing downhill, and a small brown sign;
  - camp site: a fire ring, two picnic tables and a ridge tent;
  - sight: an information board with a little roof;
  - hut: a small cabin, lodge: a two-storey house (the usual building generator);
  - lift tops: nothing more (the station is there).
  A place with a mapped building within 8 m is left as it is. Each faces the nearest road or
  path within 120 m, so a shelter's open side greets whoever arrives; otherwise it faces
  downhill. Trees and bushes keep off them; the vehicle and the drone hit them.
- **To try:** the shelter you missed, and a summit, a viewpoint and a hut.
- **Open:** a viewpoint could get a railing or a tower where the map says so; a lodge could be
  bigger, or several buildings; a wind shelter (vindskydd) mapped as a closed building looks
  like a shed.

### Drone on the phone (this commit)

- **Asked:** the drone's touch controls felt odd (the stick slid and climbed, the pedals flew
  forward and back). Wanted, in the user's words: "Left stick strafes (left/right) and goes
  forwards and back. On the right is up/down and you can swipe to turn."
- **Done:** the stick flies forward, back and sideways; the two pedals become Up and Down
  (analogue, as when driving); a swipe on the picture turns it and tilts its camera, as before.
  Keyboard and gamepad are unchanged.
- **To try:** flying it on the phone; the swipe's turning speed.

### Menus fitted to a phone, and tidied up (this commit: step 1 of 4)

- **Asked:** fit the menus to a phone screen; part of a bigger overhaul, since things were added
  along the way.
- **Found:** sideways the iPhone gives about 756 × 402 clear of the notch, and height runs out.
  The pause menu is about 950 px tall, the start screen 780 px wide with Drive at the bottom, the
  map's side panel takes nearly half the width, Time and weather sits on the pedals with no
  close for a finger, buttons are 26–32 px tall.
- **Decided:** one design on the laptop and the phone (only more compact on a short screen); the
  start screen in tabs (Area · Start · Vehicle · Driver) with Drive always shown; moving through
  menus with a gamepad later, separately.
- **Steps:** (1) one paper "sheet" with a close button for every panel, compact and
  finger-sized CSS, shared DOM helpers, Time and weather and the chat moved clear of the touch
  controls; (2) the pause menu in two panes, Settings in tabs, Controls slimmed; (3) the start
  screen; (4) the map as a drawer, the garage side by side, the logbook as cards.
- **Step 1:** every paper panel (menu, map, Time and weather, garage, credits) has a × in its
  top right corner that stays in view while it scrolls; the map's Close button went into it.
  On a short screen (under 500 px high: a phone on its side, a small window) the panels tighten
  up and drop the lead line and motto; with a finger, buttons are 44 px tall. Panels keep clear
  of the notch and use the height the iPhone really shows. With the touch controls, Time and
  weather opens beside the minimap instead of over the pedals, and the chat sits under the
  minimap. The five copies of the menus' building helpers are one (ui/dom.ts).
- **To try (step 1):** each panel on the phone and closing it with the ×; Time and weather while
  driving; the menus in a short laptop window.
- **Tried (step 1):** the picture behind the menu went back to the computer's layout (big dials,
  big minimap at the bottom left); and no Back button at the bottom, but a ← at the top left
  (the × closes). Done: the touch layout stays while the menu or map is open; the menu's pages
  and the garage go back with a ← beside their title, and the Back buttons at the bottom are
  gone (a page opened by itself from the start screen has only the ×).
- **Tried (the fixes):** "It's fine for now."
- **Open:** menus driven by the gamepad (D-pad, A, B), as its own step later?

### Phones: fullscreen and touch controls (this commit: step 4 of 4)

- **Asked:** touch controls for phones, and fullscreen. Both Android and iPhone; a thumb stick
  to steer with tilt as a choice; every action on a button; fullscreen on the laptop too.
- **Done so far (step 1):** P or the menu's Fullscreen button, and a corner button on touch
  screens, put the page fullscreen (on a phone also turned sideways and kept so). iPhone Safari
  cannot do that for a page: the menu says to add Spår to the home screen, which opens it
  without bars (a web app manifest and icon). A phone held upright is asked to turn sideways.
  The page no longer zooms or scrolls under a finger. A touch screen with nothing chosen yet
  starts on the low graphics preset.
- **Tried on an iPhone 17 (home-screen app):** it ran, but the picture was squashed and had
  black bars at both sides. Turned sideways, the window's resize came before the new layout, so
  the picture kept the upright shape; it now follows the canvas's own size (a ResizeObserver).
  The picture now fills the whole screen (`viewport-fit=cover`), and what sits at the edges
  (minimap, gauges, chat, the drone's corner view, the map's side panel) keeps inside the safe
  area, clear of the Dynamic Island and the home bar.
- **Step 2, touch driving:**
  - A thumb stick appears wherever the left thumb lands on the lower left, and steers. The
    response is the gamepad stick's curve, with a small dead zone.
  - Drive and Brake pedals sit at the right edge, pressed harder the higher the finger. A
    handbrake sits above Brake: a double tap when stopped parks, as with the key.
  - A pause button sits in the top left.
  - Dragging elsewhere on the picture looks round, and two fingers pinch the camera nearer or
    further.
  - The controls show after a touch of the screen and go away on a key or a gamepad button.
    Settings → Touch controls: Automatic, Always or Never.
  - While they show, the gauges move left of the pedals and the minimap moves to the top left.
    The key hint line is hidden.
- **Tried (step 2):** works very well. Suggested: a tap on the minimap for the map; the dash's
  lamps (diff locks, low range…) as buttons; time of day can stay in the menu; the menu needs
  fitting to a small screen.
- **Step 3, the rest of the buttons** (following those suggestions instead of a 4×4 tray):
  - Top right: camera view, back on the wheels, winch, drone.
  - The lamps on the dash are buttons: LOW, CRAWL (next speed, then off), AIR (up to the
    highest level, then down to the lowest), each DIFF on its own, LIGHTS (auto, on, off).
  - The minimap is always shown with the touch controls (near, if hidden by choice), and a tap
    opens the map; there one finger drags, two pinch to zoom, a tap picks a spot.
  - Winch: while choosing, Hook on, Next and Cancel over the pedals (a drag aims); hooked, In
    and Out held, and Unhook.
  - Drone: the stick slides and climbs, the pedals go forward and back, a drag on the picture
    turns it and tilts its camera; the vehicle's buttons go away meanwhile.
  - The menu has Say something on a touch screen (no Enter key). Prompts, the winch's and the
    drone's help name the buttons instead of keys, and sit at the top.
- **Tried (step 3, new layout):** "This looks fine."
- **Step 4, tilt steering:** Settings → Steering: Stick or Tilt (per phone, not in the presets).
  Hold the phone sideways like a wheel and turn it: full lock at 30°, a 2° dead zone, read from
  gravity in the screen's plane so tipping the phone back does not matter, the same either way
  round. On an iPhone choosing Tilt asks for the motion sensor; refused, it goes back to the
  stick and says so. Chosen on an earlier visit, the sensor is asked for again at the first tap.
  With tilt, the stick's corner drags the view like the rest of the picture; flying the drone,
  the stick is back.
- **Tried (step 4):** works really well; the angles and feel can be tweaked later.
- **Next:** the menu fitted to a phone screen: planned, see "Menus fitted to a phone".
- **Open:**
  - The stick: is the curve right for a thumb (1.5, as the gamepad's)? Should the steering
    come back to straight at once when the thumb lifts, as now, or ease back?
  - Pedals felt by height (0.3 at the foot, full from three quarters up), or just on and off?
  - Sizes and places: pedals 84 px wide, the stick 112 px across; the gauges made smaller.
  - The lamps as buttons are small (about 26 px tall); big enough to hit?
  - No touch way to the far minimap, to hide it, or back to the start (the menu has that).
  - Does the login (Cloudflare Access) work inside the home-screen app on an iPhone, or does it
    jump out to Safari? The manifest is fetched with the login cookie for that reason.
  - How a phone copes: is low smooth, and does the phone get hot?
  - Tilt: is 30° for full lock right, and the 2° dead zone? Linear now; a curve like the
    stick's (gentle near the middle)? Does the steering tremble with the hand?
  - Tilt on an iPhone: is the sensor asked for once only, or every time Spår is opened (it
    should pass silently at the first tap after the first yes)?
  - Step 3 feedback: the gauges, pedals and minimap hid the car. Done (this commit, before
    tilt): the lamps in one row low in the middle (34 px tall), a small digital readout
    above them (gear, km/h, rev bar with the red zone), pedals 66×84 and 54×132 that look
    like pedals (ribbed, leaning back), still felt by height; the handbrake a round lever
    button over the brake; minimap 110 px; top buttons 40 px; the chase camera a little
    higher on touch. Open: is the shorter pedal still easy to feel? Is the car clear now?
- **To try:** P on the laptop; on a phone at the public address, the corner button (Android),
  or Add to Home Screen (iPhone).

### Winch speed

- **Asked:** the winch is really slow.
- **Found:** the cable came in at 0.5 m/s with no load, and the speed fell in a straight line
  with the pull, so up a slope (a third of the winch's pull) it crawled at about 0.3 m/s.
  Slack was wound in at 1.6 m/s and paid out at 1.2 m/s.
- **Done:** 1.5 m/s with no load on every vehicle, and the speed falls with the square of the
  load, holding up like a motor's power and dropping only near the stall (a third of the pull
  still gives 1.3 m/s). Slack comes in at 3 m/s, paying out 2.5 m/s. Up a 32° slope the vehicle
  now climbs about 11 m in 10 s, against about 2 m.
- **Open:** real winches are slower still (about 0.15 m/s); is 1.5 right for play? Should the
  vehicles differ (the small ones faster, the trucks slower)?
- **To try:** winching out of a bog, and up a steep slope.

### Handbrake slides and park

- **Asked:** the handbrake feels weak and does not let the vehicle slide; a double tap
  should put it in park.
- **Found:** the handbrake only added brake force on the rear wheels, which Rapier's friction
  circle shared with sideways grip, so the rear barely let go. On a driven axle Rapier drops
  the brake altogether while the engine pushes, so with the throttle on it did nothing.
- **Done:** rolling (from 1 m/s, fully from 3 m/s) the handbrake locks its wheels: they take
  no drive and slide, pushing against the way the tyre moves with 0.8 of its grip, so the
  tail comes round (about 50° off its path after a second at full lock from 50 km/h, against
  2–3° without). Slower it holds as before. Locked wheels are shown standing still and leave
  skid marks. A double tap (within 0.35 s, under about 11 km/h) parks; the next tap or a pedal
  lets go. The P lamp shows it.
- **Then:** "kicks around real hard, just tapping it spins it 180°". The lever grabbed fully in
  one step and a locked wheel kept no sideways grip. Now the lever takes 0.3 s to pull fully on
  (0.1 s to let go) and a locked wheel keeps 0.4 of its sideways grip. At 50 km/h at full lock,
  a 0.1–0.3 s tap turns the vehicle 3–28° further than steering alone (before: up to 57°); held
  half a second it comes round 85–110°.
- **Open:** is 0.8 of the grip right? It also slows the vehicle hard (50 to about 20 km/h in a
  second at full lock). Should park release on a pedal, or only on a tap?
- **To try:** a handbrake turn on gravel and on tarmac; a short pull mid-corner; double tap
  to park on a hill.

### Bumps, landings and lift stations

- **Asked:** downhill every small bump throws the vehicle about and it slides; hard to
  build speed for a jump without crashing. Stuck on a lift station's deck.
- **Found:** (1) a strut could close only about 10 cm from standing, and Rapier's spring
  pushes no harder past that, so any lump at speed or any landing put the body on the ground
  (a 0.8 m drop did on the lc200 and ltb4). (2) Wheels are single rays on the raw 1 m height
  grid: every crease and small lump in it was a kick a real tyre would roll over. (3) Wheels
  feel only the ground, so they fell through the station's deck and the body sat on it.
- **Done:** struts close to 4 cm, with a bump stop that damps harder over the last three
  quarters (damping, not a stiffer spring, so landings are not handed back as a bounce); a
  0.8 m drop now lands clear on all three test vehicles. The physics ground is smoothed over
  about a tyre's footprint (features of a few metres stay). Lift station decks are ground
  the wheels stand on.
- **Not done, could follow:** steadying the vehicle in the air so it lands on its wheels
  (arcade); physics at 120 Hz so fast landings are caught a step sooner; drops of 1.2 m and
  more still touch the lower vehicles' undersides.
- **To try:** fast downhill on rough ground; a jump; the lift station.

### Roads drawn from their lines (this commit)

- **Asked:** straight, clean road edges, and paths blended rather than pixelated: for looks,
  not speed.
- **Done:** each ground patch now gets a small texture worked out from the road, path and
  stream lines: every texel's distance from the nearest edge, and which road it is. Close up
  that is a texel every 25 cm (it was 2 m), and the shader cuts between texels, so edges are
  straight lines. Asphalt and boardwalks are sharp, gravel nearly so; trails, dirt tracks and
  stream banks blend over 0.3–0.4 m each side with a ragged edge. Far off, roads too thin for
  their patch are drawn a little wider but fainter. Bog pools still come from the mask.
  Built when a patch loads, under 1 ms each, off the main thread; no region rebuild needed.
- **Not changed:** grip, plant placement and the minimap still use the 2 m mask, so a bush can
  stand a little into a crisp road edge, and grip changes up to a metre off the drawn edge.
  Say if either shows.
- **Junctions (next commit):** where a dirt road or path met asphalt, each texel took the
  surface of whichever road's middle was nearest, which came out as stairs. Now the better
  road lies on top (asphalt, boardwalk, gravel, dirt, trail, then streams), and the cut
  between it and what lies under follows its own edge.
- **Buildings (same commit):** the curved building in Tandådalen (OSM building=yes, about
  3,700 m², a C round a yard) had trees growing through its roof: plants did not know about
  buildings at all. They now keep 1.2 m clear of every footprint. Buildings of no simple
  shape had one box collider round the whole outline, which stood across the road in their
  bends: the invisible wall. They now get a thin box along each wall. Such buildings can
  still be landed on from above and fallen into, as their roof has no collider; say if that
  happens.
- **To look at:** edges of roads and paths close up and far; where roads meet; streams.
- **Later, if wanted:** wheel ruts and a grass strip down forest tracks (the distance from the
  centre line makes them possible); road meshes with their own texture.

### Performance: recorder, frame rate limit, benchmarks, cheaper ground and sky

- **Recorder:** F9 starts and stops (fn+F9 on a Mac keyboard), F8 drops a numbered mark (say
  what each mark was, e.g. "mark 2: fan spun up"). Saved in `data/perf/` on the server; from
  another computer without a login it downloads instead. Each frame: time per part, CPU, GPU
  (two ways: `gpuWait`, from handing the frame over until the GPU is done, is the one to trust;
  `gpu`, the sum of render passes, overlaps on Apple GPUs and reads high), draws, triangles,
  place, what was loading, memory; Chrome-family browsers also name the scripts behind long
  stalls. Firefox gives no stalls and no memory.
- **Frame rate limit (decided by me, say if not):** new setting, 60 by default; before, the
  game drew as fast as the screen (120 on ProMotion). The menus and start screen draw at 30.
  `?fps=0` lifts it for one visit, `?gpu=0` turns GPU timing off.
- **Benchmark route (done):** `?bench=1` waits for the start to load, then flies 80 s: 50 s
  along Ottsjövägen into Ottsjö at driving height (72 km/h), a climb to 220 m and a full turn
  over the valley; 15 August 13:00, clear, on your own settings (add `&quality=…` or `&fps=0`
  to change them for one run). Saved like F9 with `bench` in the name; the results show when
  it is done. Headless here: 60 fps, 5.8 ms CPU, 8.6 ms GPU a frame (not your GPU).
- **First benchmark (yours, Arc, Medium, 2586×1605):** 60 fps, CPU 4.9 ms, GPU 11.9 ms a frame
  (95%: 17.1) — the GPU is the limit. Headless runs with one thing off at a time (rough,
  single runs): grade and glow off −38% GPU, buildings/fences/lines off −37%, shadows off
  −12%, plants off −8%. Two GPU hitches (66, 137 ms) right after new terrain patches arrive.
- **Glow at a quarter of the picture's width (done):** was half. Your runs: GPU 12.6 → 11.2 ms
  a frame (−11%). The 137 ms hitch did not come back (slowest frame 23 ms in both runs).
- **Buildings are not the cost (found):** your recording shows the GPU at about 11 ms all along
  the route, through the village as much as in the forest and 220 m up; near Ottsjö buildings,
  fences and lines are only ~195,000 triangles. A flat cost like that is work per pixel, so the
  headless −37% was wrong. Nothing changed for them.
- **What each part costs (found):** the first `?bench=parts` run (Arc, medium, 2586×1605):
  in Ottsjö the full picture is 10.0 ms; the near ground costs 3.7 of that, the full resolution
  2.8, the sky 1.3. High over the valley 16.9 ms: the near ground 8.6, the resolution 8.0, the
  sky 2.5. Shadows, glow, finishing pass, far ground, plants, far trees and buildings save
  nothing measurable. Removing the ground drops only 0.2 of 1.24 million triangles, so its cost
  is its per-pixel shading.
- **Ground and sky made cheaper (done):** the ground's snow noise is worked out only where snow
  can lie, and the sky dome is drawn last, only where it shows. Second run: Ottsjö 10.0 → 8.5 ms,
  over the valley 16.9 → 10.7 ms. The ground's remaining noise cost 2.0–2.8 ms of that, all its
  shading beyond a flat colour 3.1–4.5 ms.
- **Ground noise from a texture (done):** the ground's colour and border noise reads a
  repeating texture made at start. Third run: Ottsjö 8.5 → 6.9 ms, over the valley 10.7 →
  8.1 ms (from 10.0 and 16.9 at the start). What is left, roughly: the ground's shading beyond a
  flat colour 1.6–1.9 ms, the sky 1.2–1.5, the resolution 1.6–2.0; the rest about nothing.
- **Wanted from you:** a look at the ground close up and far (patterned or repeating?), and one
  or two normal drives with F9, marking with F8 when the fan spins up. With the GPU at about half
  of each 60 fps frame, the CPU (4–7 ms) may now matter as much.
- **Next if needed:** the sky's clouds from a texture too (about 1 ms); resolution.
- **Open, your call later:** medium draws 1.5 pixels per point; 1 saves about 2 ms now. Lowering it, or
  a resolution that drops by itself when frames run long, is the next big step if needed.

### Scouting drone (this commit)

- **Left out for now, say if any should come:** the gamepad has no button for it until one is
  set on the Controls page (Q on the keyboard); while another browser runs your vehicle (on a
  cable) the others do not see your drone; it does not show on the map or minimap.
- **Sound and solids (done):** a whirring buzz from four rotors, higher climbing or pushing
  ahead, heard where it is (others' drones too). Trunks, rocks and buildings stop it; leaves
  and needles do not (decided). Flying home it climbs over what is in the way.
- **Mouse and back to driving (done):** W S ahead and back, A D sideways, the mouse looks
  round (pointer held on launch, or click the picture); the arrows still turn. On the pad the
  left stick slides and climbs, the right stick looks. Q while flying hands the vehicle back at
  once and the drone flies home by itself, following the vehicle as it drives; Q takes it back
  while it is on its way, with the vehicle stopped. Running out of range or battery also hands
  the vehicle back.
- **Play-test:** speed (16 m/s), mouse sensitivity, the camera tilt and the size of the
  picture of the vehicle in the corner; the loudness and pitch of the whirr; whether it keeps
  up with a fast vehicle (it carries the vehicle's speed on top of its own).

### Rear wheels gone (bug, waiting for it to happen again)

- Stuck on a forest slope at night, swapped through many vehicles, then teleported away: the
  vehicle stood with its rear wheels missing, also at the new place. Not reproduced: twelve
  swaps through every vehicle in one world, and setting each down on slopes up to 35° inside
  the ground, all keep their wheels. Setting down now tilts to the slope and avoids rocks
  (adc81cf), which may have been the cause. Next time: which vehicle, how it was moved, and a
  screenshot with F3.

### Vehicle menu (TODO 9)

- **Where does it open?** On the start screen when picking a vehicle, from a key while
  driving (then switching vehicle there too?), or both?
- **Which stats?** Suggested: mass, power and torque, gears and ranges, locks, ground
  clearance, wading depth, ground pressure, winch pull, top speed, and climbing angle.
  Real figures or bars to compare vehicles side by side?
- **The view:** a turning model on a plain stage, or the vehicle where it stands in the world
  with an orbit camera? Choice of colour in the menu?
- (Done, with my own answers until you say otherwise: "Look at them all…" under the vehicles
  on the start screen and in the menu (Esc), where choosing one swaps it where it stands. A
  turning model on a plain stage (drag to turn, ← → for the next), shown in the chosen paint;
  paint is still picked on the start screen. Real figures with a bar against the strongest of
  the vehicles: drive, weight, power, torque, top speed, climbing angle, gearbox, differentials,
  ground clearance (the range with air suspension), wading, ground pressure, winch and extras.
  Top speed and climbing are worked out from gearing, torque curve and drag, not real figures.)

### Ski lifts and runs (this commit)

- **Lifts from the map**: chair lifts, gondolas, cable cars, T-bars, button lifts, rope tows
  and moving walkways (`aerialway` in OpenStreetMap; zip lines left out). Most are mapped by
  their two end stations only, so the towers are placed from the ground: spans up to 260 m
  (chair), 420 m (gondola) or 130 m (drag lift), and a tower wherever the rope would come
  closer than 6 / 8 / 4.2 m to the ground. Towers are 9–12.5 m (chair), 13–18 m (gondola),
  6–7.5 m (drag). Do they look right next to the real ones you know?
- **Ski runs** (`piste:type=downhill`) are cleared of trees and turn to grass where there was
  forest. Runs drawn as a line are taken as 30 m wide unless a width is mapped. Too wide,
  too narrow?

### Fences, edges and the compass (this commit)

- **How hard is hard?** Wire fence goes at about 10 km/h head on (10 kJ, or 12 kN of steady
  push), roundpole fence at about 15 km/h (20 kJ, 18 kN), in `defs/objects/*.json`
  (`breakEnergy`, `breakPush`). Stone walls never give way. A stretch is about 6 m; it tips over
  flat and stays down for the session, like felled trees, for everyone in the region.
- **Glancing off edges.** When the body (not the wheels) hits the ground hard, it gets 65 % of
  the lost speed and 70 % of the nose-up spin back (`GLANCE_*` in `sim.ts`). A 1.4 m bank at
  55 km/h used to stop the 4×4 dead; now it hops over and drives on at about 15 km/h. Banks of
  2.5 m still stop you, and so do trees, rocks and buildings. Too bouncy, or not enough?
- **Compass**: shown on the road and while flying (not on the map or the start screen). The
  destinations are dots on it with the name and distance under them; the line with the arrow
  is gone, and the line at the top now only says "Arrived at …". Wanted as a setting?

### Multiplayer stage 4, winching each other

- **Your own vehicle is drawn about 100 ms late while you are on someone's cable**, the same
  delay as other players' vehicles, because their browser runs it. Steering and throttle reach
  it about 50 ms late on top of that. Does it feel sluggish? (To be tried with a few
  more people.)

### Multiplayer stage 3, one world (1a75282)

(Both questions answered, see below.)

### Mud and water (f536609)

- **How stuck is stuck?** Spinning digs a tyre down to at most 25 cm. With open diffs that leaves
  the vehicle stuck in a wet bog; low range with both locks crawls out on the flat; a slope needs
  the winch. Too punishing, too easy, or about right?
- **Lighter patches on shallow water** near the shore, seen in headless screenshots. A shading
  quirk to fix, or not visible in normal play?
- **Pace off road.** Rolling resistance now acts under throttle too (it was being ignored
  whenever the wheels were driven), so grass and sand feel a little slower. Noticeable? Better?

### Night sky (88319b4, 4ff8f19)

- **Live check of the real stars, moon and aurora** in a normal browser (only seen headless so far).
- **Frame rate** at night with the aurora (`?aurora=1`) and in dense forest: the F3 read-out on
  your machine. Never measured outside the headless browser.
- **Moon glint on lakes** (this commit): a path of white glints towards the moon, four times
  brighter than its light alone would make it. Too strong, too faint?

### Light 4×4 (ltb4)

- **Feel.** Now built on the Willys M38A1's figures (this commit): 1300 kg with a driver,
  3.52 m long, 2.06 m wheelbase, 155 Nm, three gears, governed at 4000 rpm (105 km/h),
  0.375 m wheels, 23 cm clearance. Quicker and twitchier than the Terrängbil; it turns
  sharply at low speed. Too tippy, too slow, about right?

### Terrängkombi V8 (lc200, this commit)

A Land Cruiser J200 with the European 4.5 V8 diesel, without Toyota names or badges (like the
Terrängbil without Volvo's): 2700 kg, 650 Nm at 1600–2800 rpm, six-speed automatic, low range
2.62, 0.40 m road-biased all-terrain tyres, 22.5 cm clearance, 0.7 m wading, an add-on 42 kN
winch. 0–100 km/h in about 9 s, about 200 km/h flat out.

- **Feel.** On dry grass it climbs 25° in high range and 27.5° in low, grip-limited; it is
  quick and comfortable on roads but with the lower clearance and road tyres no better than
  the Terrängbil in a bog. Right balance?

### Elpickup (elpickup, this commit)

An electric pickup on the Cybertruck's AWD dual-motor figures, without Tesla names or badges:
3020 kg (3100 with a driver), 447 kW, 10,081 Nm at the wheels, governed at 180 km/h, 5.68 m
long, 3.64 m wheelbase, 0.44 m (35") tyres, 30 cm clearance, 0.79 m wading, rear wheels
steering up to 10°, an electronically locking front differential (Digit1) and traction
control at the back. Measured: 0–100 km/h in 4.5 s (the real one about 4.3), 181 km/h flat
out; on dry grass 27.5° from standstill, grip-limited, with or without the lock; bog 10°, the
same as the Terrängkombi.

- **The sound.** No engine: a whine from the motors in a few orders of their speed (louder
  pulling or regenerating than coasting), a thin inverter whistle at low speed under load,
  the reduction gears, and below 20 km/h the soft two-note warning hum electric vehicles play
  for people on foot. Only checked headless (it plays, with no errors); how does it sound?
  Too quiet next to the tyres, too sci-fi, the warning hum annoying?
- **Regeneration.** Lifting off brakes at about 0.15 g down to a crawl, much harder than an
  engine. One-pedal driving feels like that in the real one; too strong in a game?
- **Locks.** Wikipedia names a front locker on the dual-motor; the rear is shown as traction
  control. Lockable rear too?
- **Look.** The wedge comes from a new `body.profile` (a side outline) and light bars across
  front and back. Close enough? Stainless steel is shown as flat light grey; a metallic sheen
  would need a separate material.
- **Water.** Past 0.79 m the motors cut out ("water in the electrics") and come back a few
  seconds after leaving the water, like the engines. Should an electric vehicle wade deeper,
  or not stop at all?
- **The power dial** shows kW drawn instead of revs, and the gear lamp shows D or R. Should it
  show regeneration (a needle below zero) too?

### Interface after the mood board (this commit, `docs/DESIGN.md`)

- **Paper and glass.** Menus and panels are now birch paper with spruce ink and serif titles;
  what sits over the driving (instruments, notes, the way to go) is dark spruce glass, with
  mustard as the one accent. Right balance, or should the menus be dark too?
- **Chapter cards.** The start place fades in large over the view when you set off ("Ottsjö ·
  Vålådalen–Ottsjö · Elpickup") and the destination when you arrive. Too much, too long
  (about 4 s)? Should the line say something else, like the season or the road ("14 km
  grusväg")?
- **The beacon and the arrow** to a destination are mustard now (were orange). Still easy to
  see against autumn hills and at dusk?
- **The map itself** keeps its topographic colours, with Inter for its labels as the board
  says. Should the map be redrawn in the palette too (muted greens, birch roads)?
- **Next from the board:** the world's own light and colour ("only the palette turns": dawn
  fog in the hollows, dusk, night), and the mustard 4×4 as a vehicle colour. Wanted next?

### Seasons: colours (a0d0cec)

- **Bare trees.** Out of leaf, birch, aspen, rowan and alder crowns turn a grey-brown haze of
  the same shape. Reads as winter, or as dead trees? Real twigs would cost more triangles.
- **Calendar.** Leaves out 1–15 June, autumn colours peak around 15 September, bare from early
  October (`defs/seasons.json`). The same at every height, though spring comes later and autumn
  earlier up the fell. Right for Vålådalen? Should height shift the dates?
- **Autumn heath.** Red-brown on the open fell in September. Too strong?
- **Choosing the season.** The time panel (T) has a date slider and Winter/Spring/Summer/Autumn
  buttons. Also wanted in the start menu? The server still starts on 15 August.

### Seasons: winter snow (1f044da)

- **Snow calendar.** Snow from late October, 0.4 m by mid-December, 0.75 m at the end of March,
  gone by mid-May at 600 m; 12 % deeper per hundred metres up. Right for Vålådalen?
- **Roofs, fences and cabins** carry no snow yet. Wanted?
- **Bare birches** under snow read as grey-brown lumps at a distance; see the bare-tree question above.

### Lake ice (648da29)

- **Ice calendar.** Lakes freeze mid-November, 25 cm by mid-December, 65 cm at the end of
  March, open again early June. Right?
- **What the ice carries.** Gold's rule with a margin (7 kg per cm² squared): the 4×4 needs
  18.5 cm, the 6×6 20 cm, the light 4×4 14 cm. So in early December the light one can cross
  where the military ones go through. Too strict, too lenient?
- **Thin ice near streams.** A quarter of the full thickness where a stream runs in or out,
  back to full about 50 m away; on streams themselves 30 %. It shows dark and bare of snow.
  Enough warning, or should it be more obvious (or less)?
- **Holes.** A break-through leaves a 3.5 m hole of open water; the last 8 are kept until the
  spring thaw. Should holes freeze over again after a few in-game days?
- **Grip on ice** is 0.15; with snow on top it is the snow's 0.32.

### Driving on snow (407766a, 8657af6, 9e43570)

- **Ploughed roads.** Asphalt keeps 10 % of the snow, gravel 12 %, dirt tracks 15 %; paths are
  not cleared. The plough takes the verges too. Right?
- **Snow spray** clods look grey against the light. Mostly powder instead?

### Trips and the logbook (a5334ff)

- **Destinations.** 30 in Vålådalen from OpenStreetMap: 5 summits, 3 lodges, 2 camp sites,
  Vålåforsen, 8 viewpoints and 11 shelters. Unnamed ones are called "Viewpoint 2.4 km W of
  Ottsjö" and the like. The mountain huts are all outside the area. Leaving out the many
  shelters? (Lakes: answered, see below.)
- **What counts.** The clock runs only while driving (not paused, not on the map, not flying).
  Jumping to a start point or back to the start voids the trip; swapping vehicle on the way
  does not, and the arrival is logged with the vehicle you arrive in. Fair?
- **Arriving** means coming within 30 m. Summits sit on rough ground: should a summit count
  from a little further off?
- **The logbook lives in this browser** (local storage). Fine for now; with multiplayer it could
  move to the server.
- **Next layers:** timed challenges, a best-time board per place? (Fuel is set aside, see below.)

### Exhaust fumes (8b1c66c, 0d36826)

- **Strength, after the change (this commit).** Puffs now leave the pipe slower (about 1 m/s at
  idle, 4 m/s pushed) and the air stops them within about 0.3 m at idle and a metre when
  pushed, then they drift; the idle haze is fainter. Right now?
- **Air temperature** is a rough guess from the month and the sun (about -10 °C in January,
  12 °C in July, 5 °C warmer by day than at night). The plume shows below about 8 °C. Should
  the weather (clouds, rain) change the temperature too, or the height above sea level?

### Proving ground (`docs/PLAYTEST.md`)

- **Stations.** Ground strips, ramps of 10–35°, a side slope of 10–35°, a twist lane, steps,
  ditches, a boulder field, clear-cuts, a bog with a mud track, a lake with a beach, a fell
  and a forest. Anything missing, or anything to measure more exactly (a ramp at 40°, a
  deeper ford, a rock ramp without boulders)?
- **Read-outs.** Would a measuring aid help: the slope and side tilt under the vehicle in the
  F3 read-out, or a timer between two points for comparing ground?

### Big minimap (d68c603)

- **Hold Tab** and the minimap grows from the corner to about 600 px (at most 80 % of the
  window), at the same scale, so it shows about three times as far around. Big enough, too
  big? Should it grow in the corner (as now) or open in the middle of the screen? On a
  gamepad there is no hold yet; the minimap button still steps near, far, hidden.

### Real figures (this commit)

- **Climbing with the real engines.** After 920a053 felt better, the engines went back to
  their real figures: the military B30's 206 Nm (920a053 had 230, wrongly called the B30's
  figure; the civilian one gives 224), the M38A1's 155 Nm and three gears. The clutch and
  grip changes stay. On dry grass from a standstill: the 4×4 climbs 17.5° in high range (was
  20° in 920a053, 15° before) and 25° in low with the locks (was 30°); the 6×6 12.5° and 30°;
  the light 4×4 17.5° and 30°. Still feels right, or back to the stronger engine?
- **Top speed and air drag.** Air drag is now worked out from the speed (Cd·A 3.6 m² for the
  military trucks, 2.0 for the light one), replacing a hidden damping that slowed every
  movement. Flat-out on asphalt: 4×4 about 106 km/h, 6×6 104, light 4×4 105 at its governor.
  Wikipedia gives the C303 about 100 km/h. Right?
- **Load.** The trucks' gross weights (3300 kg and 4400 kg) mean up to 900 and 1580 kg in
  the back. Worth having a load to carry (heavier, lower, sinks deeper)?
- **A third truck.** The Tgb 20 (C306): 6×6, 6.05 m long, 3390 kg, bigger and taller. Wanted?

## Answered

- Lakes as places to reach (asked under "Trips and the logbook"), decided 2026-11-26 (done):
  yes, as finds rather than destinations. Reaching the shore of a named lake is logged; see
  "More kinds of places to find".

- Scouting drone, decided 2026-11-23 (done):
  - The driver flies it, launched from the roof with the vehicle stopped; the driving keys or
    stick fly it (forward and back, turn, up and down).
  - About 1 km from the vehicle and 5 minutes of battery; a warning near either limit, then it
    flies home and lands by itself. A key also sends it home.
  - The drone camera full screen, a small picture of the vehicle in a corner, and a height,
    distance and battery readout.
  - Others in the session see it: a small drone with a blinking light and the name tag.
  - Weather has no effect on it.
  - Every vehicle carries one.

- Decisions of 2026-11-23 (to do unless marked otherwise):
  - Moving chairs, cabins and hangers on the lifts: later; they stand still for now.
  - Cross-country tracks (`piste:type=nordic`): clear a narrow strip, about 4–6 m. (Done: 5 m.)
  - Lift top stations become destinations ("Top of VM6:an"), every kind of lift. (Done.)
  - `landuse=winter_sports` stays as built: forest between the runs, only runs and lift lines
    open. (Done.)
  - Felled trees and broken fences stay session-only; the server does not save them. (As is.)
  - Join in another region stays: it switches you to their region. (As is.)
  - Light 4×4: no locks at all, like the real M38A1 (drop the rear lock). (Done.)
  - Sinking: count ground pressure (load per tyre area), so light vehicles and wide tyres
    float better over bog and heavy ones sink deeper. (Done: load over tyre width × diameter,
    against 24 kPa for the Terrängbil 11.)
  - Colours: keep the defaults (faded red light 4×4, dark grey Terrängkombi). (As is.)
  - Terrängkombi: no rear locker, traction control only. (As is.)
  - Terrängkombi body: add body options for a sloping, rounded bonnet and a slanted tailgate. (Done: bonnet `rise` and `nose`, `tailgateRake`.)
  - Terrängkombi: crawl control, a key in low range with a few speeds of about 1–5 km/h. (Done: X steps
    through 1–5 km/h and off, Shift+X off; a pedal takes over while held.)
  - Elpickup rear-wheel steering like the real one: against the front at low speed, with it
    (a few degrees) at high speed. (Done: against up to 10° at a standstill, straight at
    60 km/h, with it up to 3° at full lock from 90 km/h; `steerWith` on the axle.)
  - Elpickup air suspension: a key to raise and lower it (road, normal, high, extract 44 cm),
    high settings only at low speed. (Done: Z higher, Shift+Z lower; road 25 cm, normal 30, high 37
    up to 50 km/h, extract 44 up to 15 km/h, coming down by itself beyond that; 5 cm a second;
    AIR lamp on the dashboard; `chassis.airSuspension`. Guessed: the heights of road and
    high, the speed limits and the rate.)

- Logins: Cloudflare Access (email one-time code) in front of `spar.vhendin.se`, and the
  game ties each driver to their login email. Kept per account on the server: name and
  paint, the logbook, where they left off (region, vehicle, start, last position), and
  settings with minimap zoom and gamepad bindings. Players on the home network stay guests,
  keeping things in their own browser.
- Hosting: the game runs in Docker on an Intel NUC at home, reached from outside through a
  Cloudflare Tunnel. Added the `tunnel` service (profile `tunnel`, `TUNNEL_TOKEN` in `.env`),
  and `ADDRESS` takes several addresses, comma separated, all shown in the start menu.
- Multiplayer stage 5, after the first build: a shared destination does not replace your own;
  both show (the shared one in blue), and sharing never removes anyone's own. Chat tells
  arrivals at the shared destination and at places from the map data, not at marked spots.
  Each arrival is told, and once everyone in the region has arrived, that is told too. Three
  heard engines are enough, and the other vehicles' slide sounds (squeal, hiss, scrape) are
  dropped, keeping their engines.
- Multiplayer winching, after trying stage 4: pausing no longer freezes the vehicles you run
  for others. The server gives them, and your own, to a browser in the group that is not
  paused (`pause { paused }`, protocol 8); your paused screen follows along. Holding the brake
  holds, winch or no winch: only the automatic parking hold lets go while winched, the pedal
  and handbrake still brake. The hook goes on the tow point you aim at, front or rear, and the
  help line names it ("Bo's rear").

- Multiplayer winching (stage 4): anyone can hook onto anyone, without asking. The puller's
  browser runs the physics while hooked, and about 50 ms of delay on the towed driver's
  controls is fine. Chains are wanted if they work: every vehicle joined by cables is run by
  one browser (see "Winching each other" in `MULTIPLAYER.md`).

- Multiplayer touching (stage 2): a parked vehicle keeps its hold brake against pushes ("parked
  means parked"). Hits were a bit harsh: a steady shove (up to 0.5 m/s of change per message)
  still passes whole, anything harder at half, at most 2 m/s. The chase camera now rises over
  another vehicle in the way instead of going inside it. Others' volume stays as it is.
- Power on slopes: the vehicles struggled on slopes that should be easy; both power and grip
  were raised in 920a053, which felt better. The engines then went back to their real
  figures (see "Real figures" above).
- Exhaust: shot out like a water cannon, even standing still; slowed and softened.

- Drowned engine: restarting by itself three seconds after leaving the water is fine.
- Wading depths: 0.75 m for the 4×4 and 0.9 m for the 6×6 are fine.
- Lake depth: deeper, so a vehicle really disappears. Now at most 3.5 m (was 2.2), reached a
  little more slowly from the shore: about 2 m some 10 m out, deeper than a 4×4's roof about
  15 m out.
- Moonlight glinting on lakes: yes.
- Eased W on a key (9e43570): feels right together with the deep-snow retune.
- Exhaust fumes from the pipe: yes.
- Something to do on a drive: trips and the logbook (a5334ff) are the first answer; see the
  open questions about them above.
- Fuel: not now. It would take away from the experience; maybe later as an option that can be
  switched on.
- Winch keys: Z and X sat awkwardly below WASD. I winds in and K pays out (K also cancels
  choosing an anchor); low range stays on L. The developer collider view moved from K to U.
- Second vehicle: a light Jeep-style 4×4, lighter than the others. Not an ATV (a rider would have
  to be shown) and not a tractor (too dull). Added as `ltb4`.
- Keyboard throttle: ease W in gently where grip is low.
- Deep snow after the retune (8657af6) and eased W: works very well.
- Driving on snow: next after the ice. First tuning was far too hard (stuck at once); retuned.
- Frozen lakes: yes, drivable, with thin ice near streams that breaks and drowns the engine.
- Seasons: the colours first (trees, plants and ground through the year), winter snow, snow
  driving and ice after.
- Light 4×4 body: a hard top, not open, so there is no empty driver's seat to see.

- Multiplayer stage 1, after trying it: works well. Others' headlights should light the road
  (the nearest two with lights on get real beams). A dropped player keeps their place for a
  minute. Enter for chat is fine. Nine paints are enough as long as they are clearly different
  (now one of each hue: red, orange, mustard, green, blue, heather, white, night, and the
  vehicle's own). Drivers starting at the same point were set down inside each other; now each
  is set down behind anyone already there.
- Multiplayer: started on 2026-11-19 with nothing blocking it; single-player tuning carries
  on alongside. Each region is a room (others are drawn only in the same region); anyone may
  change the time and weather, and a chat line says who did; vehicles will be solid to each
  other (stage 2); winching each other comes last; up to 5 players; each picks a paint for
  their vehicle, with name tags; text chat only; a shared destination on everyone's map, each
  arrival in your own logbook.
- Animals are on hold.
- Mountain areas are the focus; cities and flat test areas were dropped.
