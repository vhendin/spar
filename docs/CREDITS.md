# Credits

Spår builds its world from open data. The game shows these credits on the C key; the
lines for each region come from that region's `index.json`, written by the importer.

## Data

| Data | Used for | Source and licence |
| --- | --- | --- |
| Markhöjdmodell (1 m bare-earth elevation) | Terrain inside the area | © Lantmäteriet, [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Downloaded through Lantmäteriet's STAC API; needs a free Geotorget account. |
| Copernicus DEM GLO-30 | Distant terrain, and the whole area when the 1 m model is missing | © DLR e.V. 2010–2014 and © Airbus Defence and Space GmbH 2014–2018, provided under COPERNICUS by the European Union and ESA. Free to use with this credit. |
| OpenStreetMap | Land cover, roads, paths, streams, lakes, buildings, power lines, fences, place names | © OpenStreetMap contributors, [ODbL](https://opendatacommons.org/licenses/odbl/). |
| Utförd avverkning (performed fellings) | Clear-cuts and young regrowth | © Skogsstyrelsen. Open data; the download service states that no conditions apply. Credited all the same. |

Derived in the importer, not downloaded:

- Slope, wetness and bog pools come from the elevation model.
- Field fences come from the outlines of OpenStreetMap farmland and meadows.
- Log piles stand beside fresh clear-cuts.
- Tree heights are estimated from land cover, elevation and the age of clear-cuts. They are not measured.

## Software

| Package | Licence |
| --- | --- |
| [three.js](https://threejs.org) | MIT |
| [Rapier](https://rapier.rs) (`@dimforge/rapier3d-compat`) | Apache 2.0 |
| [ws](https://github.com/websockets/ws) | MIT |
| [Ajv](https://ajv.js.org) | MIT |
| [GDAL](https://gdal.org) (importer only) | MIT |
| [osmium-tool](https://osmcode.org/osmium-tool/) (importer only) | GPL 3.0, run as a separate program |

## Look

The vehicle is inspired by the Swedish Army's Terrängbil 11 and 13. It uses a generic
military look and no manufacturer names or badges.
