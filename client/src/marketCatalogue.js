export async function loadMarketCatalogue(url, request = fetch) {
  const response = await request(url);
  if (!response.ok) throw new Error("Player catalogue unavailable");
  const data = await response.json();
  if (!Array.isArray(data.players)) throw new Error("Invalid player catalogue");
  return data.players;
}
