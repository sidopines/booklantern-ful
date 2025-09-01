// utils/relevance.js
// Search relevance scoring and filtering

// Simple English stopwords
const STOPWORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'for', 'from', 'has', 'he',
  'in', 'is', 'it', 'its', 'of', 'on', 'that', 'the', 'to', 'was', 'will', 'with',
  'the', 'and', 'for', 'are', 'but', 'not', 'you', 'all', 'can', 'had', 'her', 'were',
  'she', 'been', 'one', 'do', 'no', 'had', 'by', 'word', 'if', 'look', 'now', 'my',
  'up', 'over', 'them', 'then', 'so', 'some', 'her', 'would', 'make', 'like', 'into',
  'him', 'time', 'two', 'more', 'go', 'no', 'way', 'could', 'my', 'than', 'first',
  'been', 'call', 'who', 'oil', 'sit', 'now', 'find', 'down', 'day', 'did', 'get',
  'come', 'made', 'may', 'part', 'also', 'new', 'work', 'first', 'well', 'should',
  'because', 'through', 'each', 'just', 'those', 'people', 'take', 'into', 'years',
  'your', 'good', 'some', 'could', 'them', 'see', 'other', 'than', 'then', 'now',
  'look', 'only', 'come', 'its', 'over', 'think', 'also', 'back', 'after', 'use',
  'two', 'how', 'our', 'work', 'first', 'well', 'way', 'even', 'new', 'want',
  'because', 'any', 'these', 'give', 'day', 'most', 'us', 'time', 'very', 'say',
  'after', 'right', 'think', 'also', 'around', 'another', 'came', 'come', 'work',
  'three', 'word', 'while', 'place', 'year', 'here', 'thing', 'take', 'once',
  'upon', 'always', 'show', 'together', 'got', 'group', 'often', 'run', 'important',
  'until', 'children', 'side', 'feet', 'car', 'mile', 'night', 'walk', 'white',
  'sea', 'began', 'grow', 'took', 'river', 'four', 'carry', 'state', 'once',
  'book', 'hear', 'stop', 'without', 'second', 'later', 'miss', 'idea', 'enough',
  'eat', 'face', 'watch', 'far', 'Indian', 'real', 'almost', 'let', 'above',
  'girl', 'sometimes', 'mountain', 'cut', 'young', 'talk', 'soon', 'list',
  'song', 'being', 'leave', 'family', 'it\'s'
]);

function tokenize(query) {
  if (!query || typeof query !== 'string') return [];
  
  return query
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ') // Replace punctuation with spaces
    .split(/\s+/)
    .filter(token => 
      token.length >= 3 && 
      !STOPWORDS.has(token) &&
      !/^\d+$/.test(token) // Filter out pure numbers
    );
}

function score(item, tokens) {
  if (!tokens || tokens.length === 0) return 0;
  
  let score = 0;
  const title = (item.title || '').toLowerCase();
  const author = (item.author || item.creator || '').toLowerCase();
  const subject = (item.subject || item.description || '').toLowerCase();
  
  // Exact title phrase match (highest priority)
  const queryLower = tokens.join(' ').toLowerCase();
  if (title.includes(queryLower)) {
    score += 2;
  }
  
  // Token matches in title
  for (const token of tokens) {
    if (title.includes(token)) {
      score += 1;
    }
  }
  
  // Token matches in author
  for (const token of tokens) {
    if (author.includes(token)) {
      score += 0.5;
    }
  }
  
  // Token matches in subject/description (optional bonus)
  for (const token of tokens) {
    if (subject.includes(token)) {
      score += 0.25;
    }
  }
  
  return score;
}

function isBookLike(item) {
  // Must have a title and be readable
  if (!item.title || !item.readable) return false;
  
  // Must have a href for navigation
  if (!item.href && !item.readerUrl) return false;
  
  // Filter out obvious collections/periodicals
  const title = item.title.toLowerCase();
  const author = (item.author || item.creator || '').toLowerCase();
  
  // Skip collection indicators
  if (title.includes('collection') || title.includes('anthology') || 
      title.includes('series') || title.includes('volume') ||
      title.includes('complete works') || title.includes('selected works')) {
    return false;
  }
  
  // Skip periodical indicators
  if (title.includes('journal') || title.includes('magazine') || 
      title.includes('newsletter') || title.includes('bulletin')) {
    return false;
  }
  
  // Skip very short titles that might be incomplete
  if (title.length < 5) return false;
  
  return true;
}

function sortResults(items, tokens) {
  return items
    .filter(item => isBookLike(item))
    .map(item => ({
      ...item,
      relevanceScore: score(item, tokens)
    }))
    .filter(item => item.relevanceScore >= 1) // Must match at least one token
    .sort((a, b) => {
      // Primary: relevance score (desc)
      if (b.relevanceScore !== a.relevanceScore) {
        return b.relevanceScore - a.relevanceScore;
      }
      
      // Secondary: year (desc) if available
      const yearA = parseInt(a.year) || 0;
      const yearB = parseInt(b.year) || 0;
      if (yearB !== yearA) {
        return yearB - yearA;
      }
      
      // Tertiary: source priority
      const sourcePriority = {
        'gutenberg': 5,
        'archive': 4,
        'openlibrary': 3,
        'loc': 2,
        'wikisource': 1
      };
      
      const priorityA = sourcePriority[a.source] || 0;
      const priorityB = sourcePriority[b.source] || 0;
      
      return priorityB - priorityA;
    });
}

module.exports = {
  tokenize,
  score,
  isBookLike,
  sortResults
};
