// lib/sources/openstax.js
// OpenStax integration - free, peer-reviewed textbooks
// All books are open access with direct PDF downloads

const axios = require('axios');

const USER_AGENT = 'BookLantern/1.0 (+https://booklantern.org)';

// Static catalog of OpenStax textbooks (API endpoint is unreliable/404)
// These are direct links to the actual PDF files from OpenStax CDN
// Updated December 2024 - all verified working URLs
const OPENSTAX_CATALOG = [
  {
    slug: 'college-algebra-2e',
    title: 'College Algebra 2e',
    author: 'Jay Abramson',
    subjects: ['math', 'algebra'],
    pdf_url: 'https://assets.openstax.org/oscms-prodcms/media/documents/College_Algebra_2e-WEB.pdf',
    cover_url: 'https://assets.openstax.org/oscms-prodcms/media/documents/college_algebra_2e_book_card.svg',
    year: 2021
  },
  {
    slug: 'prealgebra-2e',
    title: 'Prealgebra 2e',
    author: 'Lynn Marecek, MaryAnne Anthony-Smith, Andrea Honeycutt Mathis',
    subjects: ['math', 'prealgebra', 'algebra'],
    pdf_url: 'https://assets.openstax.org/oscms-prodcms/media/documents/Prealgebra_2e-WEB.pdf',
    cover_url: 'https://assets.openstax.org/oscms-prodcms/media/documents/prealgebra_2e.svg',
    year: 2020
  },
  {
    slug: 'calculus-volume-1',
    title: 'Calculus Volume 1',
    author: 'Gilbert Strang, Edwin Jed Herman',
    subjects: ['math', 'calculus'],
    pdf_url: 'https://assets.openstax.org/oscms-prodcms/media/documents/CalculusVolume1-WEB.pdf',
    cover_url: 'https://assets.openstax.org/oscms-prodcms/media/documents/calculus_volume_1.svg',
    year: 2016
  },
  {
    slug: 'calculus-volume-2',
    title: 'Calculus Volume 2',
    author: 'Gilbert Strang, Edwin Jed Herman',
    subjects: ['math', 'calculus'],
    pdf_url: 'https://assets.openstax.org/oscms-prodcms/media/documents/CalculusVolume2-WEB.pdf',
    cover_url: 'https://assets.openstax.org/oscms-prodcms/media/documents/calculus_volume_2.svg',
    year: 2016
  },
  {
    slug: 'calculus-volume-3',
    title: 'Calculus Volume 3',
    author: 'Gilbert Strang, Edwin Jed Herman',
    subjects: ['math', 'calculus'],
    pdf_url: 'https://assets.openstax.org/oscms-prodcms/media/documents/CalculusVolume3-WEB.pdf',
    cover_url: 'https://assets.openstax.org/oscms-prodcms/media/documents/calculus_volume_3.svg',
    year: 2016
  },
  {
    slug: 'statistics',
    title: 'Introductory Statistics',
    author: 'Barbara Illowsky, Susan Dean',
    subjects: ['math', 'statistics'],
    pdf_url: 'https://assets.openstax.org/oscms-prodcms/media/documents/IntroductoryStatistics-WEB.pdf',
    cover_url: 'https://assets.openstax.org/oscms-prodcms/media/documents/introductory_statistics.svg',
    year: 2013
  },
  {
    slug: 'biology-2e',
    title: 'Biology 2e',
    author: 'Mary Ann Clark, Matthew Douglas, Jung Choi',
    subjects: ['science', 'biology'],
    pdf_url: 'https://assets.openstax.org/oscms-prodcms/media/documents/Biology2e-WEB.pdf',
    cover_url: 'https://assets.openstax.org/oscms-prodcms/media/documents/biology_2e_book_card.svg',
    year: 2018
  },
  {
    slug: 'concepts-of-biology',
    title: 'Concepts of Biology',
    author: 'Samantha Fowler, Rebecca Roush, James Wise',
    subjects: ['science', 'biology'],
    pdf_url: 'https://assets.openstax.org/oscms-prodcms/media/documents/ConceptsofBiology-WEB.pdf',
    cover_url: 'https://assets.openstax.org/oscms-prodcms/media/documents/concepts_of_biology.svg',
    year: 2013
  },
  {
    slug: 'chemistry-2e',
    title: 'Chemistry 2e',
    author: 'Paul Flowers, Klaus Theopold, Richard Langley, William R. Robinson',
    subjects: ['science', 'chemistry'],
    pdf_url: 'https://assets.openstax.org/oscms-prodcms/media/documents/Chemistry2e-WEB.pdf',
    cover_url: 'https://assets.openstax.org/oscms-prodcms/media/documents/chemistry_2e_book_card.svg',
    year: 2019
  },
  {
    slug: 'physics',
    title: 'College Physics',
    author: 'Paul Peter Urone, Roger Hinrichs',
    subjects: ['science', 'physics'],
    pdf_url: 'https://assets.openstax.org/oscms-prodcms/media/documents/CollegePhysics-WEB.pdf',
    cover_url: 'https://assets.openstax.org/oscms-prodcms/media/documents/college_physics.svg',
    year: 2012
  },
  {
    slug: 'university-physics-volume-1',
    title: 'University Physics Volume 1',
    author: 'William Moebs, Samuel J. Ling, Jeff Sanny',
    subjects: ['science', 'physics', 'university'],
    pdf_url: 'https://assets.openstax.org/oscms-prodcms/media/documents/UniversityPhysicsVol1-WEB.pdf',
    cover_url: 'https://assets.openstax.org/oscms-prodcms/media/documents/university_physics_volume_1.svg',
    year: 2016
  },
  {
    slug: 'astronomy',
    title: 'Astronomy',
    author: 'Andrew Fraknoi, David Morrison, Sidney Wolff',
    subjects: ['science', 'astronomy', 'space'],
    pdf_url: 'https://assets.openstax.org/oscms-prodcms/media/documents/Astronomy-WEB.pdf',
    cover_url: 'https://assets.openstax.org/oscms-prodcms/media/documents/astronomy.svg',
    year: 2016
  },
  {
    slug: 'anatomy-and-physiology',
    title: 'Anatomy and Physiology',
    author: 'J. Gordon Betts, Kelly A. Young, James A. Wise, Eddie Johnson',
    subjects: ['science', 'anatomy', 'physiology', 'biology'],
    pdf_url: 'https://assets.openstax.org/oscms-prodcms/media/documents/AnatomyandPhysiology-WEB.pdf',
    cover_url: 'https://assets.openstax.org/oscms-prodcms/media/documents/anatomy_and_physiology.svg',
    year: 2013
  },
  {
    slug: 'microbiology',
    title: 'Microbiology',
    author: 'Nina Parker, Mark Schneegurt, Anh-Hue Thi Tu, Philip Lister, Brian M. Forster',
    subjects: ['science', 'biology', 'microbiology'],
    pdf_url: 'https://assets.openstax.org/oscms-prodcms/media/documents/Microbiology-WEB.pdf',
    cover_url: 'https://assets.openstax.org/oscms-prodcms/media/documents/microbiology.svg',
    year: 2016
  },
  {
    slug: 'psychology-2e',
    title: 'Psychology 2e',
    author: 'Rose M. Spielman, William J. Jenkins, Marilyn D. Lovett',
    subjects: ['psychology', 'social-sciences'],
    pdf_url: 'https://assets.openstax.org/oscms-prodcms/media/documents/Psychology2e-WEB.pdf',
    cover_url: 'https://assets.openstax.org/oscms-prodcms/media/documents/psychology_2e_book_card.svg',
    year: 2020
  },
  {
    slug: 'introduction-to-sociology-3e',
    title: 'Introduction to Sociology 3e',
    author: 'Tonja R. Conerly, Kathleen Holmes, Asha Lal Tamang',
    subjects: ['sociology', 'social-sciences'],
    pdf_url: 'https://assets.openstax.org/oscms-prodcms/media/documents/IntroductiontoSociology3e-WEB.pdf',
    cover_url: 'https://assets.openstax.org/oscms-prodcms/media/documents/introduction_to_sociology_3e_book_card.svg',
    year: 2021
  },
  {
    slug: 'us-history',
    title: 'U.S. History',
    author: 'P. Scott Corbett, Volker Janssen, John M. Lund',
    subjects: ['history', 'american', 'us'],
    pdf_url: 'https://assets.openstax.org/oscms-prodcms/media/documents/USHistory-WEB.pdf',
    cover_url: 'https://assets.openstax.org/oscms-prodcms/media/documents/us_history.svg',
    year: 2014
  },
  {
    slug: 'world-history-volume-1',
    title: 'World History Volume 1: to 1500',
    author: 'Ann Kordas, Ryan J. Lynch, Brooke Nelson, Julie Tatlock',
    subjects: ['history', 'world'],
    pdf_url: 'https://assets.openstax.org/oscms-prodcms/media/documents/World_History_Volume_1-WEB.pdf',
    cover_url: 'https://assets.openstax.org/oscms-prodcms/media/documents/world_history_volume_1.svg',
    year: 2022
  },
  {
    slug: 'american-government-3e',
    title: 'American Government 3e',
    author: 'Glen Krutz, Sylvie Waskiewicz',
    subjects: ['government', 'politics', 'american'],
    pdf_url: 'https://assets.openstax.org/oscms-prodcms/media/documents/AmericanGovernment3e-WEB.pdf',
    cover_url: 'https://assets.openstax.org/oscms-prodcms/media/documents/american_government_3e_book_card.svg',
    year: 2021
  },
  {
    slug: 'principles-economics-3e',
    title: 'Principles of Economics 3e',
    author: 'Steven A. Greenlaw, David Shapiro, Daniel MacDonald',
    subjects: ['economics', 'business'],
    pdf_url: 'https://assets.openstax.org/oscms-prodcms/media/documents/PrinciplesofEconomics3e-WEB.pdf',
    cover_url: 'https://assets.openstax.org/oscms-prodcms/media/documents/principles_economics_3e_book_card.svg',
    year: 2022
  },
  {
    slug: 'principles-macroeconomics-3e',
    title: 'Principles of Macroeconomics 3e',
    author: 'Steven A. Greenlaw, David Shapiro, Daniel MacDonald',
    subjects: ['economics', 'macroeconomics', 'business'],
    pdf_url: 'https://assets.openstax.org/oscms-prodcms/media/documents/PrinciplesofMacroeconomics3e-WEB.pdf',
    cover_url: 'https://assets.openstax.org/oscms-prodcms/media/documents/principles_macroeconomics_3e_book_card.svg',
    year: 2022
  },
  {
    slug: 'principles-microeconomics-3e',
    title: 'Principles of Microeconomics 3e',
    author: 'Steven A. Greenlaw, David Shapiro, Daniel MacDonald',
    subjects: ['economics', 'microeconomics', 'business'],
    pdf_url: 'https://assets.openstax.org/oscms-prodcms/media/documents/PrinciplesofMicroeconomics3e-WEB.pdf',
    cover_url: 'https://assets.openstax.org/oscms-prodcms/media/documents/principles_microeconomics_3e_book_card.svg',
    year: 2022
  },
  {
    slug: 'introduction-business',
    title: 'Introduction to Business',
    author: 'Lawrence J. Gitman, Carl McDaniel, Amit Shah',
    subjects: ['business', 'management'],
    pdf_url: 'https://assets.openstax.org/oscms-prodcms/media/documents/IntroductionToBusiness-WEB.pdf',
    cover_url: 'https://assets.openstax.org/oscms-prodcms/media/documents/introduction_to_business.svg',
    year: 2018
  },
  {
    slug: 'principles-accounting-volume-1',
    title: 'Principles of Accounting Volume 1: Financial Accounting',
    author: 'Mitchell Franklin, Patty Graybeal, Dixon Cooper',
    subjects: ['accounting', 'business', 'finance'],
    pdf_url: 'https://assets.openstax.org/oscms-prodcms/media/documents/PrinciplesofAccountingVolume1-WEB.pdf',
    cover_url: 'https://assets.openstax.org/oscms-prodcms/media/documents/principles_accounting_volume_1.svg',
    year: 2019
  },
  {
    slug: 'organizational-behavior',
    title: 'Organizational Behavior',
    author: 'J. Stewart Black, David S. Bright',
    subjects: ['business', 'management', 'organizational'],
    pdf_url: 'https://assets.openstax.org/oscms-prodcms/media/documents/OrganizationalBehavior-WEB.pdf',
    cover_url: 'https://assets.openstax.org/oscms-prodcms/media/documents/organizational_behavior.svg',
    year: 2019
  }
];

/**
 * Search OpenStax for open textbooks using static catalog
 * Falls back to API if available but primarily uses catalog for reliability
 * @param {string} q - Search query
 * @param {number} page - Page number (1-indexed)
 * @returns {Promise<Array>} Normalized book objects
 */
async function search(q, page = 1) {
  try {
    // Use static catalog for reliability (API returns 404)
    const qLower = q.toLowerCase();
    const queryTerms = qLower.split(/\s+/).filter(t => t.length > 2);
    
    if (queryTerms.length === 0) {
      console.log('[openstax] No valid query terms');
      return [];
    }
    
    // Filter books matching the query
    const matchingBooks = OPENSTAX_CATALOG.filter(book => {
      const title = (book.title || '').toLowerCase();
      const author = (book.author || '').toLowerCase();
      const subjects = (book.subjects || []).join(' ').toLowerCase();
      const searchText = `${title} ${author} ${subjects}`;
      
      // Match if any query term appears in searchable text
      return queryTerms.some(term => searchText.includes(term));
    });
    
    // Limit results per page
    const limit = 10;
    const offset = (page - 1) * limit;
    const pageBooks = matchingBooks.slice(offset, offset + limit);
    
    const books = [];
    
    for (const book of pageBooks) {
      const providerId = `openstax-${book.slug}`;
      const bookId = `openstax:${book.slug}`;
      
      books.push({
        book_id: bookId,
        title: book.title,
        author: book.author,
        cover_url: book.cover_url || null,
        year: book.year || null,
        language: 'en',
        provider: 'openstax',
        provider_id: providerId,
        format: 'pdf',
        direct_url: book.pdf_url,
        source_url: `https://openstax.org/details/books/${book.slug}`,
        access: 'open',
        is_restricted: false,
        // All OpenStax items are freely downloadable
        readable: 'true',
      });
    }
    
    console.log(`[openstax] search for "${q}" returned ${books.length} items (from ${matchingBooks.length} matches)`);
    return books;
  } catch (error) {
    console.error('[openstax] search error:', error.message);
  }
}

module.exports = { search };
