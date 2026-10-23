import { it, expect } from 'vitest';
import { exposedEventIds } from '../src/v2/exposure.ts';
it('counts complete normalized records but not mentions, partial records or altered payloads', () => {
  const event = { id: 'ev-example', action: 'request_received', source_id: 'source-a' };
  expect(exposedEventIds([event], [JSON.stringify({ finding: { event_ids: [event.id] } }), JSON.stringify({ id: event.id }), JSON.stringify({ ...event, action: 'changed' })])).toEqual([]);
  expect(exposedEventIds([event], [JSON.stringify({ events: { records: [event] } }), JSON.stringify({ event }), 'HTTP error'])).toEqual([event.id]);
});
