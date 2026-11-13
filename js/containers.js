// Equipment the planner knows about. All sizes are INSIDE dimensions in mm and
// weights in kg.
//
// Sources for the defaults (checked Nov 2026): ISO dry-container tables as
// published by carriers and lessors (Hapag-Lloyd, Triton, DSV, Pier2Pier) and
// US dry-van listings (Wabash, Great Dane, Vanguard). Individual units differ
// by a few millimetres between manufacturers, so every value can be changed
// in the app under "Edit CBM & sizes".
//
//   L, W, H    inside length, width and height
//   door       clear door opening; a carton must be able to pass through it
//   payload    most cargo weight the unit is built to carry
//   roadLimit  typical cargo weight that stays legal on US roads (80,000 lb
//              gross) on a standard chassis; above it the plan shows a warning
//   rated      practical full load in CBM, used for every % figure
export const EQUIPMENT = [
  {
    id: '20GP',
    name: "20' GP",
    kind: 'Dry container',
    iso: '22G1',
    L: 5898, W: 2352, H: 2393,
    door: { W: 2340, H: 2280 },
    payload: 28200,
    roadLimit: 17237, // 38,000 lb
    rated: 28,
  },
  {
    id: '40HQ',
    name: "40' HQ",
    kind: 'High cube',
    iso: '45G1',
    L: 12032, W: 2352, H: 2698,
    door: { W: 2340, H: 2585 },
    payload: 26580,
    roadLimit: 19958, // 44,000 lb
    rated: 65,
  },
  {
    id: '45HQ',
    name: "45' HQ",
    kind: 'High cube',
    iso: 'L5G1',
    L: 13556, W: 2352, H: 2698,
    door: { W: 2340, H: 2585 },
    payload: 27700,
    roadLimit: 19958, // 44,000 lb
    rated: 72,
  },
  {
    // 53' dry van: 630 in long inside. Plate-wall vans are about 101 in wide
    // and sheet-and-post vans 98.5 to 100 in; 100 x 110 in is a safe middle.
    // Swing-door openings run a few inches under the inside size.
    id: '53TL',
    name: "53' TL",
    kind: 'Dry van trailer',
    iso: 'Truckload',
    trailer: true,
    L: 16002, W: 2540, H: 2794,
    door: { W: 2489, H: 2667 },
    payload: 20412, // 45,000 lb, already a road figure
    rated: 98,
  },
  {
    // Standard US (GMA) pallet: 48 x 40 in deck. H is the tallest the loaded
    // pallet may stand INCLUDING the pallet itself (72 in is the usual LTL and
    // retailer limit); `deck` is the height of the pallet under the cartons.
    id: 'PLT',
    name: 'Pallet 48×40',
    kind: 'Pallet',
    iso: 'GMA',
    pallet: true,
    L: 1219, W: 1016, H: 1829,
    deck: 152,
    payload: 1134, // 2,500 lb
    rated: 2.08,
  },
];

export const byId = (id) => EQUIPMENT.find((e) => e.id === id) || EQUIPMENT[1];

// Height available for cartons: the full inside height, less the pallet deck.
export const stackHeight = (e) => e.H - (e.deck || 0);
