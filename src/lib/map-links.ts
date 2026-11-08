/** Google Maps universal URLs; destinations and waypoints are URL-encoded. */
export type GoogleTravelMode = 'driving' | 'walking' | 'bicycling' | 'transit';
export interface DirectionsOptions {
  origin: string; destination: string; waypoints?: string[]; travelmode?: GoogleTravelMode;
}
function place(value: string): string {
  const result = value.trim();
  if (!result || result.length > 300 || /[\u0000-\u001f\u007f|]/.test(result)) throw new Error('Invalid map location');
  return result;
}
export function directionsUrl(options: DirectionsOptions): string {
  const origin = place(options.origin), destination = place(options.destination);
  const waypoints = options.waypoints ?? [];
  if (waypoints.length > 5) throw new Error('At most five waypoints are supported');
  if (options.travelmode && !['driving', 'walking', 'bicycling', 'transit'].includes(options.travelmode)) throw new Error('Invalid travel mode');
  const url = new URL('https://www.google.com/maps/dir/');
  url.searchParams.set('api', '1'); url.searchParams.set('origin', origin); url.searchParams.set('destination', destination);
  if (waypoints.length) url.searchParams.set('waypoints', waypoints.map(place).join('|'));
  if (options.travelmode) url.searchParams.set('travelmode', options.travelmode);
  return url.toString();
}
export function placeSearchUrl(query: string): string {
  const url = new URL('https://www.google.com/maps/search/');
  url.searchParams.set('api', '1'); url.searchParams.set('query', place(query));
  return url.toString();
}
