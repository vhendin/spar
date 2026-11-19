# Open questions

Questions waiting for an answer or a play-test. New ones are added as they come up; answered
ones move to the bottom with the answer, so the reasoning stays findable.

## Open

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

- **Feel.** 1450 kg, short wheelbase, 150 Nm, 0.36 m wheels, 23 cm clearance. Quicker and
  twitchier than the Terrängbil; it turns sharply at low speed. Too tippy, too slow, about right?
- **Differentials.** Open at the front, lockable at the back (Digit2 only), so it is clearly
  weaker off road than the military ones. Keep, or make the front lockable too?
- **Sinking.** How deep a tyre settles depends on its size and the ground, not on the weight, so
  the light vehicle sinks about as far (relative to its wheels) as the heavy ones. Should ground
  pressure count, so it floats better over bog?
- **Colour.** Faded red. Another colour, or several to choose from?

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

- **Strength.** A faint grey haze at idle, darker when the engine is pushed or winching, and a
  white plume in cold air that lasts longer. The wind carries it off quickly; in a breeze it is
  easy to miss. Stronger, or right as it is?
- **Air temperature** is a rough guess from the month and the sun (about -10 °C in January,
  12 °C in July, 5 °C warmer by day than at night). The plume shows below about 8 °C. Should
  the weather (clouds, rain) change the temperature too, or the height above sea level?

## Answered

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

- Multiplayer (step 6) waits until single player is complete.
- Animals are on hold.
- Mountain areas are the focus; cities and flat test areas were dropped.
