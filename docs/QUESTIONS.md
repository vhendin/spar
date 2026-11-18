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
- **Look.** Open top with a roll bar, faded red. A canvas top, another colour, or several colours
  to choose from?

### What next

- **Something to do on a drive:** timed routes, summit challenges, fuel and depots?

## Answered

- Second vehicle: a light Jeep-style 4×4, lighter than the others. Not an ATV (a rider would have
  to be shown) and not a tractor (too dull). Added as `ltb4`.

- Multiplayer (step 6) waits until single player is complete.
- Animals are on hold.
- Mountain areas are the focus; cities and flat test areas were dropped.
