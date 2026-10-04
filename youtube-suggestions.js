const youtubeDl = require('youtube-dl-exec');

const AUTOCOMPLETE_TIMEOUT_MS = 5000;
const CACHE_TTL_MS = 60_000;
const MAX_CACHE_ENTRIES = 80;
const MAX_SUGGESTIONS = 8;

function normalize(value) {
  return String(value || '')
    .normalize('NFKC')
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function cleanTitle(value) {
  return String(value || '')
    .replace(/#[\p{L}\p{N}_]+/gu, ' ')
    .replace(/\s*[\[(](?:official\s+)?(?:music\s+video|audio|video|lyrics?|visuali[sz]er|hd|4k)[^\])]*[\])]/gi, ' ')
    .replace(/\s*(?:[-|]\s*)?(?:official\s+(?:music\s+)?video|official\s+audio|official\s+lyrics?|music\s+video|lyrics?\s+video)\s*$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function formatDuration(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return '';
  const totalSeconds = Math.floor(seconds);
  const minutes = Math.floor(totalSeconds / 60);
  return ` ${minutes}:${String(totalSeconds % 60).padStart(2, '0')}`;
}

function scoreSuggestion(suggestion, query) {
  const normalizedTitle = normalize(suggestion.title);
  const normalizedChannel = normalize(suggestion.channel);
  const normalizedQuery = normalize(query);
  const queryTerms = normalizedQuery.split(' ').filter(Boolean);
  const matchingTitleTerms = queryTerms.filter((term) => normalizedTitle.includes(term)).length;
  const matchingChannelTerms = queryTerms.filter((term) => normalizedChannel.includes(term)).length;
  let score = suggestion.rank * -0.01;

  if (normalizedTitle === normalizedQuery) score += 100;
  else if (normalizedTitle.includes(normalizedQuery)) score += 60;
  if (queryTerms.length && matchingTitleTerms === queryTerms.length) score += 30;
  score += matchingTitleTerms * 5;
  score += matchingChannelTerms * 2;
  return score;
}

function makeSuggestions(entries, query) {
  const seen = new Set();
  const suggestions = [];
  for (const entry of entries || []) {
    if (!entry?.id || entry.is_private || entry.availability && !['public', 'unlisted'].includes(entry.availability)) {
      continue;
    }
    const title = cleanTitle(entry.track || entry.title);
    if (!title) continue;
    const channel = cleanTitle(entry.artist || entry.channel || entry.uploader);
    const uniqueKey = `${normalize(title)}|${normalize(channel)}`;
    if (seen.has(uniqueKey)) continue;
    seen.add(uniqueKey);

    const labelParts = [title];
    if (channel && !normalize(title).includes(normalize(channel))) labelParts.push(channel);
    const displayName = `${labelParts.join(' - ')}${formatDuration(entry.duration)}`.slice(0, 100);
    suggestions.push({
      name: displayName,
      value: `https://www.youtube.com/watch?v=${encodeURIComponent(entry.id)}`,
      title,
      channel,
      rank: suggestions.length
    });
  }

  return suggestions
    .sort((left, right) => scoreSuggestion(right, query) - scoreSuggestion(left, query))
    .slice(0, MAX_SUGGESTIONS)
    .map(({ name, value }) => ({ name, value }));
}

function createYouTubeSuggestionSearch(search = youtubeDl) {
  const cache = new Map();
  const requests = new Map();

  async function fetchSuggestions(query) {
    const result = await search(`ytsearch10:${query}`, {
      dumpSingleJson: true,
      skipDownload: true,
      noWarnings: true,
      noPlaylist: true,
      flatPlaylist: true,
      ignoreErrors: true
    }, { timeout: AUTOCOMPLETE_TIMEOUT_MS });
    return makeSuggestions(result.entries, query);
  }

  function getCached(query) {
    const entry = cache.get(query);
    if (!entry) return null;
    if (entry.expiresAt <= Date.now()) {
      cache.delete(query);
      return null;
    }
    return entry.suggestions;
  }

  function remember(query, suggestions) {
    cache.delete(query);
    cache.set(query, { suggestions, expiresAt: Date.now() + CACHE_TTL_MS });
    while (cache.size > MAX_CACHE_ENTRIES) cache.delete(cache.keys().next().value);
  }

  return async function searchYouTubeSuggestions(input) {
    const query = String(input || '').trim().replace(/\s+/g, ' ');
    const normalizedQuery = normalize(query);
    if (normalizedQuery.length < 2 || /^https?:\/\//i.test(query)) return [];

    const cached = getCached(normalizedQuery);
    if (cached) return cached;
    if (requests.has(normalizedQuery)) return requests.get(normalizedQuery);

    const request = fetchSuggestions(query)
      .then((suggestions) => {
        remember(normalizedQuery, suggestions);
        return suggestions;
      })
      .catch((error) => {
        console.warn('YouTube autocomplete search failed:', error.message);
        const previousQuery = [...cache.keys()]
          .filter((key) => normalizedQuery.startsWith(key) && getCached(key)?.length)
          .sort((left, right) => right.length - left.length)[0];
        if (!previousQuery) return [];

        const previousSuggestions = getCached(previousQuery);
        return previousSuggestions
          .map((suggestion, index) => ({ ...suggestion, rank: index }))
          .sort((left, right) => scoreSuggestion(right, query) - scoreSuggestion(left, query))
          .slice(0, MAX_SUGGESTIONS)
          .map(({ name, value }) => ({ name, value }));
      })
      .finally(() => {
        requests.delete(normalizedQuery);
      });
    requests.set(normalizedQuery, request);
    return request;
  };
}

const searchYouTubeSuggestions = createYouTubeSuggestionSearch();

module.exports = { createYouTubeSuggestionSearch, searchYouTubeSuggestions };
