# Open questions

Questions waiting for an answer or a play-test. New ones are added as they come up; answered
ones move to the bottom with the answer, so the reasoning stays findable.

## Open

### Phones: fullscreen and touch controls (this commit: step 1 of 4)

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
- **Next:** touch driving (stick, pedals, handbrake, pause, pinch to zoom); then the other
  buttons (winch, camera, 4×4, map, drone, lights); then tilt steering.
- **Open:**
  - Does the login (Cloudflare Access) work inside the home-screen app on an iPhone, or does it
    jump out to Safari? The manifest is fetched with the login cookie for that reason.
  - How a phone copes: is low smooth, and does the phone get hot?
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
  Ottsjö" and the like. The mountain huts are all outside the area. Worth adding lakes (reach
  the shore), or leaving out the many shelters?
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
