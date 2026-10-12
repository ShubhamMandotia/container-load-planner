// Standard inside dimensions (mm), max payload (kg) and the rated CBM most
// forwarders quote as a practical full load. Real equipment varies by line and
// build year, so every value can be adjusted in the app.
export const EQUIPMENT = [
  {
    id: '20GP',
    name: "20' GP",
    kind: 'Dry container',
    iso: '22G1',
    L: 5898, W: 2352, H: 2393,
    door: { W: 2343, H: 2280 },
    payload: 28200,
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
    rated: 72,
  },
  {
    id: '53TL',
    name: "53' TL",
    kind: 'Dry van trailer',
    iso: 'Truckload',
    L: 16002, W: 2540, H: 2794,
    door: { W: 2515, H: 2769 },
    payload: 20412,
    rated: 98,
  },
];

export const byId = (id) => EQUIPMENT.find((e) => e.id === id) || EQUIPMENT[1];
