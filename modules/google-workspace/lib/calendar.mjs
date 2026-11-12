export function calendarReader(request) {
  async function pages(resource, params, maxResults) {
    const output = [], seen = new Set(); let pageToken;
    do {
      const response = await request(resource, { params: { ...params, pageToken, maxResults } });
      if (!Array.isArray(response.items ?? [])) throw new Error('Calendar API returned invalid items.');
      output.push(...(response.items ?? []));
      pageToken = response.nextPageToken;
      if (pageToken && seen.has(pageToken)) throw new Error('Calendar API repeated a pagination token.');
      if (pageToken) seen.add(pageToken);
    } while (pageToken);
    return output;
  }
  return {
    calendars: () => pages('users/me/calendarList', {}, 250),
    events: (calendar, from, to, { timeZone, showDeleted = false } = {}) => {
      if (!calendar || !Number.isFinite(Date.parse(from)) || !Number.isFinite(Date.parse(to)) || Date.parse(from) >= Date.parse(to)) throw new Error('Calendar and an increasing date range are required.');
      if (timeZone) { try { new Intl.DateTimeFormat('en', { timeZone }); } catch { throw new Error('Invalid time zone.'); } }
      return pages(`calendars/${encodeURIComponent(calendar)}/events`, { timeMin: from, timeMax: to, singleEvents: true, orderBy: 'startTime', showDeleted, timeZone }, 2500);
    },
    event: (calendar, event) => {
      if (!calendar || !event) throw new Error('Calendar and event identifiers are required.');
      return request(`calendars/${encodeURIComponent(calendar)}/events/${encodeURIComponent(event)}`);
    },
  };
}
