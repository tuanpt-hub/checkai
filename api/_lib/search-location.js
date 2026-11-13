/** Country support differs between search providers; don't copy OpenAI's VN default to Claude. */
export function searchLocation(engine) {
  const location = {
    type: 'approximate',
    city: process.env.SEARCH_CITY || 'Hanoi',
    region: process.env.SEARCH_REGION || 'Hanoi',
    timezone: process.env.SEARCH_TIMEZONE || 'Asia/Ho_Chi_Minh',
  };
  const country = engine === 'claude' ? process.env.ANTHROPIC_SEARCH_COUNTRY : (process.env.SEARCH_COUNTRY || 'VN');
  if (country?.trim()) location.country = country.trim().toUpperCase();
  return location;
}
