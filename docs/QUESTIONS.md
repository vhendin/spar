# Open questions

Questions waiting for an answer or a play-test. New ones are added as they come up; answered
ones move to the bottom with the answer, so the reasoning stays findable.

## Open

### Mud and water (f536609)

- **Keyboard throttle in low range.** W is all or nothing, so there is no feathering the throttle
  to avoid spinning. Getting out of a bog relies on low range and the diff locks instead. Should
  W ease in gently while in low range?
- **How stuck is stuck?** Spinning digs a tyre down to at most 25 cm. With open diffs that leaves
  the vehicle stuck in a wet bog; low range with both locks crawls out on the flat; a slope needs
  the winch. Too punishing, too easy, or about right?
- **Drowned engine.** It restarts by itself three seconds after leaving the water. Should it
  instead need something more (a wait, a key, a tow to a road)?
- **Wading depths.** 0.75 m for the 4×4, 0.9 m for the 6×6. Right for these vehicles?
- **Lake depth.** About 1 m some 10 m from the shore, at most 2.2 m. Steep enough?
- **Lighter patches on shallow water** near the shore, seen in headless screenshots. A shading
  quirk to fix, or not visible in normal play?
- **Pace off road.** Rolling resistance now acts under throttle too (it was being ignored
  whenever the wheels were driven), so grass and sand feel a little slower. Noticeable? Better?

### Night sky (88319b4, 4ff8f19)

- **Live check of the real stars, moon and aurora** in a normal browser (only seen headless so far).
- **Frame rate** at night with the aurora (`?aurora=1`) and in dense forest: the F3 read-out on
  your machine. Never measured outside the headless browser.
- **Moonlight glinting on lakes:** wanted?

### Light 4×4 (ltb4)

- **Feel.** 1450 kg, short wheelbase, 150 Nm, 0.36 m wheels, 23 cm clearance. Quicker and
  twitchier than the Terrängbil; it turns sharply at low speed. Too tippy, too slow, about right?
- **Differentials.** Open at the front, lockable at the back (Digit2 only), so it is clearly
  weaker off road than the military ones. Keep, or make the front lockable too?
- **Sinking.** How deep a tyre settles depends on its size and the ground, not on the weight, so
  the light vehicle sinks about as far (relative to its wheels) as the heavy ones. Should ground
  pressure count, so it floats better over bog?
- **Colour.** Faded red. Another colour, or several to choose from?

### Seasons: colours (this commit)

- **Bare trees.** Out of leaf, birch, aspen, rowan and alder crowns turn a grey-brown haze of
  the same shape. Reads as winter, or as dead trees? Real twigs would cost more triangles.
- **Calendar.** Leaves out 1–15 June, autumn colours peak around 15 September, bare from early
  October (`defs/seasons.json`). The same at every height, though spring comes later and autumn
  earlier up the fell. Right for Vålådalen? Should height shift the dates?
- **Autumn heath.** Red-brown on the open fell in September. Too strong?
- **Choosing the season.** The time panel (T) has a date slider and Winter/Spring/Summer/Autumn
  buttons. Also wanted in the start menu? The server still starts on 15 August.

### Seasons: winter snow (this commit)

- **Snow calendar.** Snow from late October, 0.4 m by mid-December, 0.75 m at the end of March,
  gone by mid-May at 600 m; 12 % deeper per hundred metres up. Right for Vålådalen?
- **Roofs, fences and cabins** carry no snow yet. Wanted?
- **Bare birches** under snow read as grey-brown lumps at a distance; see the bare-tree question above.

### Lake ice (this commit)

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

### Driving on snow (this commit)

- **How hard is deep snow?** I chose: it can get you stuck. Tyres pack it to about half its
  depth (at most 20 cm for the 4×4), it drags, and spinning digs on, though half as fast as
  in mud. At the end of March off-road, high range on open differentials bogs down within
  seconds; low range with both locks crawls at about 9 km/h on the flat. Too hard?
- **Flooring it on a snowy road.** With W all or nothing, the wheels spin and the vehicle
  slides off a cambered road into the deep snow beside it. This makes the earlier keyboard
  throttle question more pressing: ease W in gently on low grip?
- **Ploughed roads.** Asphalt keeps 10 % of the snow, gravel 12 %, dirt tracks 15 %; paths are
  not cleared. The plough takes the verges too. Right?
- **Snow spray** clods look grey against the light. Mostly powder instead?

### What next

- **Something to do on a drive:** timed routes, summit challenges, fuel and depots?

## Answered

- Second vehicle: a light Jeep-style 4×4, lighter than the others. Not an ATV (a rider would have
  to be shown) and not a tractor (too dull). Added as `ltb4`.
- Driving on snow: next after the ice (done; see the questions on how hard it is).
- Frozen lakes: yes, drivable, with thin ice near streams that breaks and drowns the engine.
- Seasons: the colours first (trees, plants and ground through the year), winter snow, snow
  driving and ice after.
- Light 4×4 body: a hard top, not open, so there is no empty driver's seat to see.

- Multiplayer (step 6) waits until single player is complete.
- Animals are on hold.
- Mountain areas are the focus; cities and flat test areas were dropped.
