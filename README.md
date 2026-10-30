# Sage Canyon 開車趣 Sage Canyon Drive

A driving game on the real streets around Sage Canyon School in Carmel Valley, San Diego. You can drive the family
SUV, a school bus, a garbage truck, an ice cream truck or a police car, run errands around the neighbourhood, and
learn the rules of the road on the way.

Play online: https://ywchen0711.github.io/sage-canyon-drive/

Plain HTML + JavaScript with Three.js, no build step.

## The map

The street network was traced by hand from a map of the area. The houses come from the building footprints on
that map, and the canyons and the park come from its green areas.

| Area | Streets |
|---|---|
| North of Carmel Mountain Rd | Cherry Hill Dr, Foxhound Way, Ridge Dr, Birch Hill Point, Spur Point Ct, Village Haven Trl |
| South of Carmel Mountain Rd | Harvest Run Dr, Quaker Hill Ln, Gaylemont Ln, Whispering Hills Ln, Hunters Glen Dr, Havenridge Way |
| Main road | Carmel Mountain Rd |

The map also has:

- Sage Canyon School, with its drop-off loop, car park, blacktop, playgrounds and flagpole.
- Sage Canyon Park, with a soccer field and restrooms.
- The chaparral canyons between the neighbourhoods, which you can drive down into.
- The divided Carmel Mountain Rd, with trees along its median.
- Traffic lights where Carmel Mountain Rd meets Harvest Run Dr and Foxhound Way.
- Stop signs, street-name signs, speed-limit signs, school-zone signs, street lights, mailboxes and parked cars.
- Road-closed barricades where streets run off the edge of the map.

House numbers are made up. The game generates them so that each address can be a delivery target.

## The open city

Choose **Open city** from the menu to drive or walk anywhere you like.

- **Full map:** press M. Drag to pan, scroll or pinch to zoom, and tap to set a waypoint; the GPS then routes you
  there.
- **Getting out:** press F to get out and walk around as Jasper. Press F next to a car to get in, either one you left
  or one parked on a driveway.
- **Money:** you earn money from missions (more for each new star), from giving hitchhikers (🙋) a ride (taxis earn
  more), from stunt jumps and from the stars you find.
- **Stunt ramps (⤴️):** there are ramps in the park, on the school blacktop, at a cul-de-sac and on canyon rims. The
  longer you stay in the air, the more you earn.
- **The police:** breaking the rules raises your wanted level (★). Police cars then chase you. Stay out of their way
  to lose them, or get caught and pay a ticket.
- **Paint & repair (🔧):** drive in to fix the car, get a new colour and lose the police.
- **Carmel Cars (🚗):** buy the taxi, the sports car, the bus, the garbage truck, the ice cream truck or the police
  car.
- **Home (🏠):** take any car you own out of the garage, or start the missions that begin at home.
- **Mission start points:** these are spread around the map. Drive into one and press E to start it.

Cars take damage, and smoke when they are badly hurt. If one breaks down, call a tow truck with R, or get out and
find another car.

## Missions

| | Mission | Vehicle |
|---|---|---|
| 🚦 | Driving lesson: learn the controls and the rules, then drive to school | SUV |
| 🏫 | Take Jasper to school before the 8:00 bell | SUV |
| 🧒 | Carpool: pick up three classmates, then go to school | Minivan |
| 🍕 | Pizza delivery: five orders, with tips for hot pizza | Hatchback |
| 🍦 | Ice cream truck: serve ten children in four minutes | Ice cream truck |
| 🗑️ | Trash day: empty twelve bins, keeping them on your right | Garbage truck |
| 🚌 | School bus: four bus stops, then school | School bus |
| 📋 | Driving test: six checkpoints; lose more than 20 points and you fail | Sedan |
| 🐶 | Find the lost dog: follow the barking into the canyon and bring him home | SUV |
| 🚓 | Police chase: catch the speeding sports car by bumping it three times | Police car |
| 🏁 | Carmel Mountain time trial: ten gates | Sports car |
| 🌙 | Night pick-up: soccer practice at the park, then take everyone home | Minivan |
| 🅿️ | Parking challenge: park neatly in the school car park | SUV |

Each mission awards up to three stars. Earning stars unlocks the sports car and the police car for free drive.
Free drive also hides 20 stars around the neighbourhood.

## Rules of the road

The game notices when you break these rules:

- **Speed limits:** 25 mph on neighbourhood streets, 40 mph on Carmel Mountain Rd.
- **Stop signs:** come to a full stop.
- **Traffic lights:** stop at red.
- **Lanes:** keep right.
- **Bumps and pedestrians:** bumping into things and startling people both count.

The GPS plans a route along the real streets. It shows green arrows on the road and gives turn-by-turn directions
with street names, and it can read them aloud.

## Controls

| | Keyboard | Gamepad | Touch |
|---|---|---|---|
| Throttle | W / ↑ | RT | GAS |
| Brake / reverse | S / ↓ | LT | BRAKE |
| Steer | A D / ← → | left stick | ◀ ▶, or tilt the iPad |
| Handbrake | Space | A | 🅿️ |
| Horn | H | B | 📯 |
| Camera | C | Y | 🎥 |
| Headlights | L | | |
| Back onto the road / tow | R | | ↺ |
| Full map | M | | 🗺️ |
| Get in / out | F | | 🚪 |
| Interact | E | | ✋ |
| Run / jump (on foot) | Shift / Space | | 🏃 / 🅿️ |
| Pause | Esc | Start | ⏸ |

In Settings you can choose which house is home. Missions that start at home will start from there.

## Files

| File | What it holds |
|---|---|
| `js/mapdata.js` | Generated: the roads, road graph, houses, trees, stop signs and terrain heights. |
| `assets/ground.jpg` | Generated: the painted ground (asphalt, markings, sidewalks, driveways, lawns, canyons). |
| `js/roads.js` | Nearest-road lookups, the terrain, and GPS routing. |
| `js/world.js` | Houses, trees, signs, the school and the park. |
| `js/car.js` | Vehicle models and the driving model. |
| `js/traffic.js` | Other cars, traffic lights and pedestrians. |
| `js/missions.js` | The missions. |
| `js/city.js` | The open city: money, police, hitchhikers, ramps, shops and mission start points. |
| `js/onfoot.js` | Walking around as Jasper. |
| `js/bigmap.js` | The full-screen map. |
| `js/roadmesh.js` | The 3D road surfaces, kerbs, sidewalks and markings. |
| `js/hud.js` | The HUD: street name, GPS, mini-map and speedometer. |
| `js/audio.js` | Sound. |
| `js/main.js` | The game loop, menus and input. |
