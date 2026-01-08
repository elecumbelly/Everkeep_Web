export function getPlaceName(places, id) {
  if (!id) return '';
  const place = places.find((item) => item.id === id);
  return place ? place.name : '';
}
