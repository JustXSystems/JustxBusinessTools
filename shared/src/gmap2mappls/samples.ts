import { mapplsPointUrl, roundCoord, type MapplsSide } from "./types";

export type SampleFixture = {
  id: string;
  label: string;
  input: string;
  lat: number;
  lng: number;
  googleName: string;
  mapplsAddress: string;
  locality?: string;
  city?: string;
  state?: string;
  pincode?: string;
};

/** Acceptance / demo fixtures — same lat/lng on both sides. */
export const SAMPLE_FIXTURES: SampleFixture[] = [
  {
    id: "hulimavu-coords",
    label: "Maps link · Hulimavu @12.8804,77.5958",
    input: "https://www.google.com/maps/@12.8804,77.5958,18z",
    lat: 12.8804,
    lng: 77.5958,
    googleName: "Hulimavu / Bannerghatta Road area, Bengaluru",
    mapplsAddress:
      "Near Bannerghatta Road, Hulimavu, Bengaluru, Karnataka 560076 (sample)",
    locality: "Hulimavu",
    city: "Bengaluru",
    state: "Karnataka",
    pincode: "560076",
  },
  {
    id: "brindavan-address",
    label: "Long Bengaluru address · Brindavan / Hulimavu",
    input:
      "Brindavan Enclaves, near Meenakshi Temple, Hulimavu, Bannerghatta Road, Bengaluru, Karnataka 560076",
    lat: 12.8769,
    lng: 77.5952,
    googleName: "Brindavan Enclaves, Hulimavu, Bengaluru",
    mapplsAddress:
      "Hulimavu, Bannerghatta Road, Bengaluru, Karnataka 560076 (sample)",
    locality: "Hulimavu",
    city: "Bengaluru",
    state: "Karnataka",
    pincode: "560076",
  },
  {
    id: "india-gate",
    label: "India Gate, New Delhi",
    input: "India Gate, New Delhi",
    lat: 28.6129,
    lng: 77.2295,
    googleName: "India Gate, New Delhi",
    mapplsAddress: "India Gate, Rajpath, New Delhi, Delhi 110001 (sample)",
    locality: "Central Delhi",
    city: "New Delhi",
    state: "Delhi",
    pincode: "110001",
  },
];

export function matchSampleByCoords(lat: number, lng: number, tol = 0.008): SampleFixture | null {
  for (const s of SAMPLE_FIXTURES) {
    if (Math.abs(s.lat - lat) <= tol && Math.abs(s.lng - lng) <= tol) return s;
  }
  return null;
}

export function sampleMapplsSide(lat: number, lng: number): MapplsSide {
  const hit = matchSampleByCoords(lat, lng);
  if (hit) {
    return {
      formattedAddress: hit.mapplsAddress,
      locality: hit.locality,
      city: hit.city,
      state: hit.state,
      pincode: hit.pincode,
      lat: roundCoord(lat),
      lng: roundCoord(lng),
      mapplsUrl: mapplsPointUrl(lat, lng),
      sampleMode: true,
    };
  }
  return {
    formattedAddress: `Sample reverse-geocode at ${roundCoord(lat)}, ${roundCoord(lng)} — set MAPPLS_ACCESS_TOKEN for live Mappls address`,
    lat: roundCoord(lat),
    lng: roundCoord(lng),
    mapplsUrl: mapplsPointUrl(lat, lng),
    sampleMode: true,
  };
}
